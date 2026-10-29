import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/supabase/auth'
import { canAccessOperationsSupport } from '@/lib/company/capabilities'
import { listLeaveRequests, submitLeaveRequest, transitionLeaveRequest, type LeaveRequest } from '@/lib/supabase/leave-requests'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { emptyList } from '@/lib/utils'
import type { RequestForm } from '@/features/settings/personal-requests'

export function useLeaveRequests(scope: 'mine' | 'approvals' | 'all' = 'mine') {
  const { session, profile } = useAuth()
  const userId = session?.user.id
  const active = useWorkspaceTabActivity()
  const allowed = profile?.status === 'active' && (scope !== 'all' || canAccessOperationsSupport(profile))
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ['company-leave-requests', userId, scope, allowed],
    queryFn: () => listLeaveRequests(scope === 'mine' ? userId : undefined, scope === 'approvals'),
    enabled: Boolean(userId && allowed),
    refetchInterval: active && allowed ? 30_000 : false,
  })
  useEffect(() => { if (query.error) console.warn('[leave-requests] 신청 조회 실패', query.error) }, [query.error])
  async function refresh() {
    await Promise.all([
      'company-leave-requests', 'company-leave-cover', 'my-attendance-basis', 'home-my-leave', 'my-extra-leave',
      'employee-roster', 'employee-extra-leave', 'leave-notice-management', 'meeting-availability',
    ].map(key => client.invalidateQueries({ queryKey: [key] })))
  }
  const create = useMutation({
    mutationFn: (form: RequestForm) => {
      if (!userId) throw new Error('로그인 상태를 확인해 주세요.')
      return submitLeaveRequest(userId, form)
    },
    onSuccess: refresh,
  })
  const transition = useMutation({
    mutationFn: (input: { id: string; status: 'approved' | 'rejected' | 'cancelled'; note?: string }) => transitionLeaveRequest(input.id, input.status, input.note),
    onSuccess: refresh,
    onError: refresh,
  })
  return { requests: allowed ? query.data ?? emptyList<LeaveRequest>() : emptyList<LeaveRequest>(),
    loading: query.isPending && Boolean(allowed), error: query.error,
    refresh: () => query.refetch(), create, transition, userId,
    busy: create.isPending || transition.isPending }
}
