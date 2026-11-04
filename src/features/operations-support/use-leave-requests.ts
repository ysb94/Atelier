import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/supabase/auth'
import { canAccessOperationsSupport } from '@/lib/company/capabilities'
import { listLeaveRequests, submitLeaveRequest, transitionLeaveRequest, type LeaveRequest } from '@/lib/supabase/leave-requests'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { emptyList } from '@/lib/utils'
import type { RequestForm } from '@/features/settings/personal-requests'
import { sharedReadPolicy, readPollInterval } from '@/lib/query/shared-read-policy'
import { diagnosticOperation, inputDiagnosticContext, newDiagnosticContext, tracedInput, type DiagnosticContext } from '@/lib/diagnostics/workflow-trace'

export function useLeaveRequests(scope: 'mine' | 'approvals' | 'all' = 'mine') {
  const { session, profile } = useAuth()
  const userId = session?.user.id
  const active = useWorkspaceTabActivity()
  const allowed = profile?.status === 'active' && (scope !== 'all' || canAccessOperationsSupport(profile))
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ['company-leave-requests', userId, scope, allowed],
    queryFn: () => listLeaveRequests(scope === 'mine' ? userId : undefined, scope === 'approvals'),
    ...sharedReadPolicy,
    enabled: active && Boolean(userId && allowed),
    refetchInterval: readPollInterval(30_000, active && allowed),
  })
  useEffect(() => { if (query.error) console.warn('[leave-requests] 신청 조회 실패', query.error) }, [query.error])
  async function refresh(context?: DiagnosticContext, outcome = 'unknown') {
    return diagnosticOperation('leave', 'refresh_queries', trace => trace.run('invalidate_queries', async () => {
    await Promise.all([
      'company-leave-requests', 'company-leave-cover', 'my-attendance-basis', 'home-my-leave', 'my-extra-leave',
      'employee-roster', 'employee-extra-leave', 'employee-leave-advances', 'leave-notice-management', 'meeting-availability',
      'attendance-clock-ins', 'company-attendance-spans', 'company-deferred-clock-outs', 'attendance-presence',
      'offsite-groups', 'my-offsite-attendance', 'overtime-checkout-preview', 'my-home-work-notices',
      'my-workday-basis', 'company-attendance-clocks', 'late-arrival-statements', 'late-statement-notices', 'late-statement-tasks',
      'late-arrival-cumulative',
    ].map(key => client.invalidateQueries({ queryKey: [key] })))
    }, { writeOutcome: outcome }), context)
  }
  const create = useMutation({
    mutationFn: (form: RequestForm) => {
      if (!userId) throw new Error('로그인 상태를 확인해 주세요.')
      if (!inputDiagnosticContext(form)) tracedInput(form, newDiagnosticContext(form.kind === 'offsite' ? 'offsite' : 'leave', 'submit'))
      return submitLeaveRequest(userId, form, inputDiagnosticContext(form))
    },
    onSuccess: (_data, form) => refresh(inputDiagnosticContext(form), 'committed'),
  })
  const transition = useMutation({
    mutationFn: (input: { id: string; status: 'approved' | 'rejected' | 'cancelled'; note?: string }) => {
      if (!inputDiagnosticContext(input)) tracedInput(input, newDiagnosticContext('leave', input.status))
      return transitionLeaveRequest(input.id, input.status, input.note, inputDiagnosticContext(input))
    },
    onSuccess: (_data, input) => refresh(inputDiagnosticContext(input), 'committed'),
    onError: (_error, input) => refresh(inputDiagnosticContext(input)),
  })
  return { requests: allowed ? query.data ?? emptyList<LeaveRequest>() : emptyList<LeaveRequest>(),
    loading: query.isPending && Boolean(allowed), error: query.error,
    refresh: () => query.refetch(), create, transition, userId,
    busy: create.isPending || transition.isPending }
}
