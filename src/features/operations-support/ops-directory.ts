import { useCallback, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listDepartments, listOrgChartMembers, type Department, type OrgChartMember } from '@/lib/supabase/profiles'
import { emptyList } from '@/lib/utils'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'

export function useOpsDirectory() {
  const active = useWorkspaceTabActivity()
  const departmentsQuery = useQuery({
    queryKey: ['departments', 'active'],
    queryFn: () => listDepartments(true),
  })
  const membersQuery = useQuery({
    queryKey: ['orgChartMembers'],
    queryFn: () => listOrgChartMembers(),
    refetchInterval: active ? 30_000 : false,
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

  const departments = departmentsQuery.data ?? emptyList<Department>()
  const members = membersQuery.data ?? emptyList<OrgChartMember>()
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
    loading: departmentsQuery.isPending || membersQuery.isPending,
    error: departmentsQuery.error || membersQuery.error,
    refetch: () => {
      void departmentsQuery.refetch()
      void membersQuery.refetch()
    },
  }
}
