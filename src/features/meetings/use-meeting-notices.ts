import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/lib/supabase/auth'
import { emptyList } from '@/lib/utils'
import type { InboxNotification } from '@/lib/inbox/types'
import { listCompanyMeetings, listMeetingInvitations } from '@/lib/supabase/meetings'
import { meetingNoticeItems, pendingMeetingNoticeCount } from './meeting-notices'

const SEEN_HOST_KEY = 'atelier:meeting-host-notices:v1'
function readSeenHost(): Record<string, true> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(SEEN_HOST_KEY) ?? '{}')
    return saved && typeof saved === 'object' && !Array.isArray(saved)
      ? Object.fromEntries(Object.entries(saved).filter(([, value]) => value === true)) : {}
  } catch (error) {
    console.warn('[meetings] 호스트 알림 읽음 상태 조회 실패', { error })
    return {}
  }
}

export function useMeetingNotices() {
  const { profile } = useAuth()
  const enabled = profile?.status === 'active'
  const [seenHost, setSeenHost] = useState(readSeenHost)
  const invitations = useQuery({
    queryKey: ['meeting-invitations', profile?.id],
    queryFn: listMeetingInvitations,
    enabled,
    refetchInterval: enabled ? 15000 : false,
  })
  const meetings = useQuery({
    queryKey: ['company-meetings', profile?.id, profile?.companyId],
    queryFn: listCompanyMeetings,
    enabled,
    refetchInterval: enabled ? 15000 : false,
  })
  const items = useMemo(() => {
    return meetingNoticeItems(invitations.data ?? emptyList<InboxNotification>(), meetings.data, profile?.id).map((item) => {
      if (item.meeting?.role === 'member' && item.meeting.status === 'pending') return { ...item, readAt: null }
      if (item.meeting?.role === 'host' && seenHost[`${profile?.id}:${item.id}`]) {
        return { ...item, readAt: item.createdAt }
      }
      return item
    })
  }, [invitations.data, meetings.data, profile?.id, seenHost])
  function markHostRead(notices: readonly InboxNotification[]) {
    if (!profile?.id) return
    setSeenHost((current) => {
      const next = { ...current }
      for (const item of notices) {
        if (item.meeting?.role === 'host') next[`${profile.id}:${item.id}`] = true
      }
      try { localStorage.setItem(SEEN_HOST_KEY, JSON.stringify(next)) }
      catch (error) { console.warn('[meetings] 호스트 알림 읽음 상태 저장 실패', { error }) }
      return next
    })
  }
  return {
    items,
    pending: pendingMeetingNoticeCount(items),
    error: invitations.error ?? meetings.error,
    acknowledge: (item: InboxNotification) => markHostRead([item]),
    acknowledgeAll: () => markHostRead(items),
  }
}
