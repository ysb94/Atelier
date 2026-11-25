import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useHeadOfficeSelfService, useWorkforceManagement } from '@/lib/company/workforce-management-context'
import { useAuth } from '@/lib/supabase/auth'
import { usePagePreview } from '@/lib/company/page-preview-context'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { sharedReadPolicy, readPollInterval } from '@/lib/query/shared-read-policy'
import { changeHolidayWork, listHolidayOvertimeCredits, listHolidayWork, type HolidayAction } from '@/lib/supabase/holiday-work'
import { startWorkflow } from '@/lib/diagnostics/workflow-trace'
import { useDiagnosticGate } from '@/lib/diagnostics/use-diagnostic-gate'
import { emptyList } from '@/lib/utils'
import type { HolidayOvertimeCredit, HolidayWork } from './holiday-work'

export function useHolidayOvertimeCredits(month: string, scope: 'mine' | 'operations') {
  const { profile, session } = useAuth()
  const active = useWorkspaceTabActivity()
  const preview = usePagePreview()
  const allowed = Boolean(!preview?.active && profile?.companyId && profile?.status === 'active' && session?.user.id === profile.id)
  const enabled = allowed && active
  const query = useQuery({
    queryKey: ['holiday-overtime-credits', profile?.id, profile?.companyId, scope, month],
    queryFn: () => listHolidayOvertimeCredits(month, scope), ...sharedReadPolicy,
    enabled, refetchInterval: readPollInterval(30_000, enabled),
  })
  return { ...query, isPending: allowed && query.isPending, rows: allowed ? query.data ?? emptyList<HolidayOvertimeCredit>() : emptyList<HolidayOvertimeCredit>() }
}

export function useHolidayWork(month: string, scope: 'mine' | 'review' | 'operations', requestId?: string, freshDetail = false) {
  const { profile, session } = useAuth(), preview = usePagePreview(), active = useWorkspaceTabActivity(), cache = useQueryClient()
  const workforce = useWorkforceManagement(), selfService = useHeadOfficeSelfService()
  const enabled = Boolean(active && !preview?.active && profile?.companyId && profile?.status === 'active' && session?.user.id === profile.id && (scope !== 'mine' || selfService))
  useDiagnosticGate('offsite','holiday_access',enabled,enabled?'enabled':preview?.active?'preview':!active?'hidden_tab':!session?'no_session':profile?.status!=='active'?'inactive_employee':'identity_mismatch')
  const query = useQuery({ queryKey: ['holiday-work', profile?.id, profile?.companyId, scope, month, requestId ?? null], queryFn: () => listHolidayWork(month, scope, requestId), ...sharedReadPolicy, enabled,
    refetchOnMount: freshDetail ? 'always' : sharedReadPolicy.refetchOnMount, refetchInterval: readPollInterval(30_000, enabled) })
  const save = useMutation({ mutationFn: ({ action, payload }: { action: HolidayAction; payload: object }) => changeHolidayWork(action, payload), onSuccess: async (_, { action }) => {
    const trace = startWorkflow('offsite', 'holiday_refresh')
    const keys = ['holiday-work', 'my-home-work-notices', 'employee-extra-leave', 'my-extra-leave', 'company-work-requests', 'offsite-settlements']
    if (action === 'settle-confirmed') keys.push('holiday-overtime-credits', 'my-attendance-basis', 'employee-roster', 'leave-notice-management')
    try {
      await trace.run('refresh_queries', () => Promise.all(keys.map(key => cache.invalidateQueries({ queryKey: [key] }))), { writeOutcome: 'committed' })
      trace.done({ writeOutcome: 'committed' })
    } catch (error) { trace.fail(error, { writeOutcome: 'committed' }); throw new Error('서버 저장은 완료했지만 화면 갱신에 실패했습니다. 새로 조회해 처리 상태를 확인해 주세요.', { cause: error }) }
  } })
  const source = enabled && !workforce?.loading && !workforce?.error ? query.data?.rows ?? emptyList<HolidayWork>() : emptyList<HolidayWork>()
  const rows = useMemo(() => source.filter(row => (workforce?.byId.get(row.employeeId)?.mode ?? 'head-office') === 'head-office'), [source, workforce])
  return { ...query, isPending: query.isPending || Boolean(workforce?.loading), error: workforce?.error || query.error, refetch: () => Promise.all([query.refetch(), workforce?.refresh()]), save, enabled, rows }
}
