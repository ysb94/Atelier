import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/supabase/auth'
import { usePagePreview } from '@/lib/company/page-preview-context'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { sharedReadPolicy, readPollInterval } from '@/lib/query/shared-read-policy'
import { changeHolidayWork, listHolidayWork, type HolidayAction } from '@/lib/supabase/holiday-work'
import { startWorkflow } from '@/lib/diagnostics/workflow-trace'
import { useDiagnosticGate } from '@/lib/diagnostics/use-diagnostic-gate'
import { emptyList } from '@/lib/utils'
import type { HolidayWork } from './holiday-work'

export function useHolidayWork(month: string, scope: 'mine' | 'review' | 'operations') {
  const { profile, session } = useAuth(), preview = usePagePreview(), active = useWorkspaceTabActivity(), cache = useQueryClient()
  const enabled = Boolean(active && !preview?.active && profile?.companyId && profile?.status === 'active' && session?.user.id === profile.id)
  useDiagnosticGate('offsite','holiday_access',enabled,enabled?'enabled':preview?.active?'preview':!active?'hidden_tab':!session?'no_session':profile?.status!=='active'?'inactive_employee':'identity_mismatch')
  const query = useQuery({ queryKey: ['holiday-work', profile?.id, profile?.companyId, scope, month], queryFn: () => listHolidayWork(month, scope), ...sharedReadPolicy, enabled, refetchInterval: readPollInterval(30_000, enabled) })
  const save = useMutation({ mutationFn: ({ action, payload }: { action: HolidayAction; payload: object }) => changeHolidayWork(action, payload), onSuccess: async () => {
    const trace = startWorkflow('offsite', 'holiday_refresh')
    try {
      await trace.run('refresh_queries', () => Promise.all(['holiday-work', 'my-home-work-notices', 'employee-extra-leave', 'my-extra-leave', 'company-work-requests', 'offsite-settlements'].map(key => cache.invalidateQueries({ queryKey: [key] }))), { writeOutcome: 'committed' })
      trace.done({ writeOutcome: 'committed' })
    } catch (error) { trace.fail(error, { writeOutcome: 'committed' }); throw new Error('서버 저장은 완료했지만 화면 갱신에 실패했습니다. 새로 조회해 처리 상태를 확인해 주세요.', { cause: error }) }
  } })
  return { ...query, save, enabled, rows: query.data?.rows ?? emptyList<HolidayWork>() }
}
