import { useMemo, useSyncExternalStore } from 'react'
import { useAuth } from '@/lib/supabase/auth'
import { emptyList } from '@/lib/utils'
import type { InboxNotification } from '@/lib/inbox/types'
import { meetingNoticeItems, pendingMeetingNoticeCount } from './meeting-notices'
import { useMeetingNoticeContext } from './use-meeting-notice-context'
import { useMeetingRealtime } from './use-meeting-realtime'

function subscribeVisibility(listener: () => void) {
  document.addEventListener('visibilitychange', listener)
  return () => document.removeEventListener('visibilitychange', listener)
}
const hidden = () => document.visibilityState === 'hidden'

export function useMeetingNotices({ realtime = true, background = false }: { realtime?: boolean; background?: boolean } = {}) {
  const { profile } = useAuth()
  const active = profile?.status === 'active'
  useMeetingRealtime(Boolean(active && realtime), profile?.id, profile?.companyId ?? undefined)
  // MeetingStartReminder owns foreground polling, including standalone chat windows.
  // Only the desktop notification coordinator polls while the application is hidden.
  const isHidden = useSyncExternalStore(subscribeVisibility, hidden)
  const backgroundPoll = realtime && background && isHidden
  const query = useMeetingNoticeContext(active, backgroundPoll, backgroundPoll)
  const context = active && query.isSuccess ? query.data : undefined
  const items = useMemo(() => context ? meetingNoticeItems(context.invitations, context.series) : emptyList<InboxNotification>(), [context])
  return { ready: Boolean(context), items, series: context?.series, pending: pendingMeetingNoticeCount(items), error: query.error }
}
