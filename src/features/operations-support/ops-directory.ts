import { useCallback, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listDepartments, listOrgChartMembers, type Department, type OrgChartMember } from '@/lib/supabase/profiles'
import { emptyList } from '@/lib/utils'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { sharedReadPolicy, readPollInterval } from '@/lib/query/shared-read-policy'
import { useAuth } from '@/lib/supabase/auth'
import { isHeadOfficeMember, isPersonnelMember } from '@/lib/company/workforce-management'
import { useWorkforceManagement } from '@/lib/company/workforce-management-context'

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

  const departments = allowed ? departmentsQuery.data ?? emptyList<Department>() : emptyList<Department>()
  const sourceMembers = allowed ? membersQuery.data ?? emptyList<OrgChartMember>() : emptyList<OrgChartMember>()
  const members = useMemo(() => {
    if (scope !== 'all' && (workforce?.loading || workforce?.error)) return emptyList<OrgChartMember>()
    const decorated = workforce ? sourceMembers.map(workforce.decorate) : sourceMembers
    return scope === 'all' ? decorated : decorated.filter(scope === 'head-office' ? isHeadOfficeMember : isPersonnelMember)
  }, [sourceMembers, scope, workforce])
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
    loading: allowed && (departmentsQuery.isPending || membersQuery.isPending || (scope !== 'all' && Boolean(workforce?.loading))),
    error: departmentsQuery.error || membersQuery.error || (scope !== 'all' ? workforce?.error : null),
    refetch: () => {
      if (!enabled) return
      void departmentsQuery.refetch()
      void membersQuery.refetch()
      if (scope !== 'all') void workforce?.refresh()
    },
  }
}
