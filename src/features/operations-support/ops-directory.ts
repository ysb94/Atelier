import { useCallback, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listDepartments, listOrgChartMembers, type Department, type OrgChartMember } from '@/lib/supabase/profiles'
import { emptyList } from '@/lib/utils'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { sharedReadPolicy, readPollInterval } from '@/lib/query/shared-read-policy'
import { useAuth } from '@/lib/supabase/auth'
import { isHeadOfficeMember, isPersonnelMember } from '@/lib/company/workforce-management'
import { useWorkforceManagement } from '@/lib/company/workforce-management-context'
import { listAttendanceEnrollments, type AttendanceEnrollment } from '@/lib/supabase/attendance-enrollments'
import { attendanceTrackingStart } from './attendance-period'

export function useOpsDirectory(scope: 'all' | 'head-office' | 'personnel' = 'all') {
  const workforce = useWorkforceManagement()
  const active = useWorkspaceTabActivity()
  const { session, profile } = useAuth()
  const userId = session?.user.id
  const companyId = profile?.companyId
  const allowed = Boolean(userId && companyId && profile?.id === userId && profile.status === 'active')
  const enabled = active && allowed
  const departmentsQuery = useQuery({
    queryKey: ['departments', 'active', userId, companyId],
    queryFn: () => listDepartments(true),
    ...sharedReadPolicy,
    enabled,
  })
  const membersQuery = useQuery({
    queryKey: ['orgChartMembers', userId, companyId],
    queryFn: () => listOrgChartMembers(),
    ...sharedReadPolicy,
    enabled,
    refetchInterval: readPollInterval(30_000, enabled),
  })
  const sourceMembers = allowed ? membersQuery.data ?? emptyList<OrgChartMember>() : emptyList<OrgChartMember>()
  const rosterVersion = useMemo(() => {
    // Cache version only: avoid placing employee identifiers in diagnostic query labels.
    let fingerprint = 2166136261
    for (const character of sourceMembers.map(member => member.id).sort().join('|')) fingerprint = Math.imul(fingerprint ^ character.charCodeAt(0), 16777619)
    return `${sourceMembers.length}:${fingerprint >>> 0}`
  }, [sourceMembers])
  const needsEnrollment = scope === 'head-office'
  const enrollmentQuery = useQuery({
    queryKey: ['attendance-enrollments', userId, companyId, rosterVersion], queryFn: listAttendanceEnrollments,
    ...sharedReadPolicy, enabled: enabled && needsEnrollment && membersQuery.isSuccess,
    refetchInterval: readPollInterval(30_000, enabled && needsEnrollment && membersQuery.isSuccess),
  })
  const enrollments = allowed && needsEnrollment ? enrollmentQuery.data ?? emptyList<AttendanceEnrollment>() : emptyList<AttendanceEnrollment>()
  const enrollmentById = useMemo(() => new Map(enrollments.map(row => [row.employeeId, row.startsOn])), [enrollments])
  const missingEnrollment = needsEnrollment && enrollmentQuery.isSuccess && sourceMembers.some(member => !enrollmentById.has(member.id))
  const missingEnrollmentError = useMemo(() => missingEnrollment ? new Error('새 직원의 근태 시작일을 확인하고 있습니다. 다시 조회해 주세요.') : null, [missingEnrollment])
  const enrollmentError = needsEnrollment ? enrollmentQuery.error || missingEnrollmentError : null

  useEffect(() => {
    if (departmentsQuery.error) {
      console.warn('[operations-support] 부서 목록 조회 실패', departmentsQuery.error)
    }
  }, [departmentsQuery.error])
  useEffect(() => {
    if (membersQuery.error) {
      console.warn('[operations-support] 직원 목록 조회 실패', membersQuery.error)
    }
  }, [membersQuery.error])
  useEffect(() => {
    if (enrollmentError) console.warn('[attendance-enrollment] 집계 시작일 조회 실패', { code: 'query' })
  }, [enrollmentError])

  const departments = allowed ? departmentsQuery.data ?? emptyList<Department>() : emptyList<Department>()
  const members = useMemo(() => {
    if (scope !== 'all' && (workforce?.loading || workforce?.error)) return emptyList<OrgChartMember>()
    if (needsEnrollment && (enrollmentQuery.isPending || enrollmentError)) return emptyList<OrgChartMember>()
    const decorated = workforce ? sourceMembers.map(workforce.decorate) : sourceMembers
    const filtered = scope === 'all' ? decorated : decorated.filter(scope === 'head-office' ? isHeadOfficeMember : isPersonnelMember)
    return needsEnrollment ? filtered.map(member => ({ ...member, attendanceTrackedFrom: attendanceTrackingStart(member.hireDate, member.attendanceTrackedFrom, enrollmentById.get(member.id)) })) : filtered
  }, [sourceMembers, scope, workforce, needsEnrollment, enrollmentQuery.isPending, enrollmentError, enrollmentById])
  const departmentNames = useMemo(
    () => new Map(departments.map((dept) => [dept.id, dept.name])),
    [departments],
  )
  const departmentName = useCallback(
    (id: string | null) => (id && departmentNames.get(id)) || '소속 없음',
    [departmentNames],
  )

  return {
    departments,
    members,
    departmentName,
    loading: allowed && (departmentsQuery.isPending || membersQuery.isPending || (needsEnrollment && enrollmentQuery.isPending) || (scope !== 'all' && Boolean(workforce?.loading))),
    error: departmentsQuery.error || membersQuery.error || enrollmentError || (scope !== 'all' ? workforce?.error : null),
    refetch: () => {
      if (!enabled) return
      void departmentsQuery.refetch()
      void membersQuery.refetch()
      if (scope !== 'all') void workforce?.refresh()
      if (needsEnrollment) void enrollmentQuery.refetch()
    },
  }
}
