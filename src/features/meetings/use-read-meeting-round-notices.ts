import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNotificationDetailVisibility } from '@/lib/inbox/use-notification-visibility'
import { useAuth } from '@/lib/supabase/auth'
import { listMeetingInvitations, readMeetingRoundNotice } from '@/lib/supabase/meetings'
import type { MeetingRound } from './meeting-schedule'
import { startWorkflow } from '@/lib/diagnostics/workflow-trace'

export function useReadMeetingRoundNotices(round: MeetingRound, enabled: boolean) {
  const active = useNotificationDetailVisibility()
  const { profile } = useAuth()
  const cache = useQueryClient()
  const invitations = useQuery({ queryKey: ['meeting-invitations', profile?.id], queryFn: listMeetingInvitations, enabled: false })
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!active || !enabled || !profile?.id || !invitations.data || round.detailAccess === 'none' || document.visibilityState !== 'visible') return
    let cancelled = false
    async function read() {
      const trace=startWorkflow('notification','read_meeting_result')
      trace.step('match_displayed_version')
      try {
        const notices = invitations.data ?? []
        let changed = false
        for (const notice of notices) {
          if (cancelled || notice.readAt || !['meeting_result', 'meeting_removed'].includes(notice.kind)) continue
          const url = new URL(notice.href, 'https://atelier.local')
          if (url.searchParams.get('round') !== round.id) continue
          // The rendered publication must exist, not just its round's schedule.
          if (notice.kind === 'meeting_result' && !round.sharedResults?.some(result => `result:${result.version}` === url.searchParams.get('resultVersion'))) continue
          await trace.run('save_read',context=>readMeetingRoundNotice(notice.id, notice.createdAt,context))
          changed = true
        }
        if (!cancelled) setError(null)
        if (changed) await trace.run('refresh_queries',()=>cache.invalidateQueries({ queryKey: ['meeting-invitations', profile?.id] }),{writeOutcome:'committed'})
        trace.done({state:changed?'read_saved':'no_current_unread'})
      } catch (cause) {
        trace.fail(cause)
        if (!cancelled) setError('읽음 기록을 저장하지 못했습니다. 다시 시도해 주세요.')
      }
    }
    void read()
    return () => { cancelled = true }
  }, [active, enabled, profile?.id, round.id, round.detailAccess, round.sharedResults, invitations.data, cache, retry])
  return { error, retry: () => setRetry(value => value + 1) }
}
