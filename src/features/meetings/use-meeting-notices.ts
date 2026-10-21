import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/lib/supabase/auth'
import { emptyList } from '@/lib/utils'
import type { InboxNotification } from '@/lib/inbox/types'
import { listCompanyMeetings, listMeetingInvitations } from '@/lib/supabase/meetings'
import { meetingNoticeItems, pendingMeetingNoticeCount } from './meeting-notices'
import { useMeetingRealtime } from './use-meeting-realtime'

export function useMeetingNotices() {
  const { profile } = useAuth()
  const enabled = profile?.status === 'active'
  const connected = useMeetingRealtime(Boolean(enabled), profile?.id, profile?.companyId ?? undefined)
  const invitations = useQuery({
    queryKey: ['meeting-invitations', profile?.id],
    queryFn: listMeetingInvitations,
    enabled,
    refetchInterval: enabled && !connected ? 30000 : false,
  })
  const meetings = useQuery({
    queryKey: ['company-meetings', profile?.id, profile?.companyId],
    queryFn: listCompanyMeetings,
    enabled,
    refetchInterval: enabled && !connected ? 30000 : false,
  })
  const items = useMemo(() => {
    return meetingNoticeItems(invitations.data ?? emptyList<InboxNotification>(), meetings.data, profile?.id).map((item) => {
      if (item.meeting?.role === 'member' && item.meeting.status === 'pending') return { ...item, readAt: null }
      return item
    })
  }, [invitations.data, meetings.data, profile?.id])
  return {
    items,
    pending: pendingMeetingNoticeCount(items),
    error: invitations.error ?? meetings.error,
  }
}
