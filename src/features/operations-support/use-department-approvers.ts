import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/supabase/auth'
import { hasPermission } from '@/lib/company/permissions'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { emptyList } from '@/lib/utils'
import { listDepartmentApprovers, saveDepartmentApprovers, type DepartmentApprover } from '@/lib/supabase/department-approvers'

export function useDepartmentApprovers() {
  const { profile, session } = useAuth()
  const active = useWorkspaceTabActivity()
  const allowed = profile?.status === 'active'
  const canEdit = hasPermission(profile, 'approvers.manage')
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['department-approvers', session?.user.id, allowed], queryFn: listDepartmentApprovers,
    enabled: allowed, refetchInterval: active && allowed ? 30_000 : false })
  useEffect(() => { if (query.error) console.warn('[department-approvers] 설정 불러오기 실패', query.error) }, [query.error])
  const save = useMutation({ mutationFn: (input: Parameters<typeof saveDepartmentApprovers>) => {
    if (!canEdit) throw new Error('승인자 지정 권한이 필요합니다.')
    return saveDepartmentApprovers(...input)
  }, onSuccess: async () => { await Promise.all([
    client.invalidateQueries({ queryKey: ['department-approvers'] }),
    client.invalidateQueries({ queryKey: ['company-leave-requests'] }),
  ]) } })
  return { settings: allowed ? query.data ?? emptyList<DepartmentApprover>() : emptyList<DepartmentApprover>(),
    save, canEdit, loading: allowed && query.isPending, error: query.error, refresh: query.refetch }
}
