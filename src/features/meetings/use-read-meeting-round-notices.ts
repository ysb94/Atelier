import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNotificationDetailVisibility } from '@/lib/inbox/use-notification-visibility'
import { useAuth } from '@/lib/supabase/auth'
import { listMeetingInvitations, readMeetingRoundNotice } from '@/lib/supabase/meetings'
import type { MeetingRound } from './meeting-schedule'

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
      try {
        const notices = invitations.data ?? []
        let changed = false
        for (const notice of notices) {
          if (cancelled || notice.readAt || !['meeting_result', 'meeting_removed'].includes(notice.kind)) continue
          const url = new URL(notice.href, 'https://atelier.local')
          if (url.searchParams.get('round') !== round.id) continue
          // The rendered publication must exist, not just its round's schedule.
          if (notice.kind === 'meeting_result' && !round.sharedResults?.some(result => `result:${result.version}` === url.searchParams.get('resultVersion'))) continue
          await readMeetingRoundNotice(notice.id, notice.createdAt)
          changed = true
        }
        if (!cancelled) setError(null)
        if (changed) await cache.invalidateQueries({ queryKey: ['meeting-invitations', profile?.id] })
      } catch (cause) {
        console.warn('[meetings] 회차 결과 읽음 저장 실패', { roundId: round.id, cause })
        if (!cancelled) setError('읽음 기록을 저장하지 못했습니다. 다시 시도해 주세요.')
      }
    }
    void read()
    return () => { cancelled = true }
  }, [active, enabled, profile?.id, round.id, round.detailAccess, round.sharedResults, invitations.data, cache, retry])
  return { error, retry: () => setRetry(value => value + 1) }
}
