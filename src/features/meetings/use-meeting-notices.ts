import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/lib/supabase/auth'
import { emptyList } from '@/lib/utils'
import type { InboxNotification } from '@/lib/inbox/types'
import { listCompanyMeetings, listMeetingInvitations } from '@/lib/supabase/meetings'
import { meetingNoticeItems, pendingMeetingNoticeCount } from './meeting-notices'
import { useMeetingRealtime } from './use-meeting-realtime'
import { sharedReadPolicy, readPollInterval } from '@/lib/query/shared-read-policy'

/** 실시간 채널 이름이 사용자별 하나뿐이라 구독은 앱 상단 한 곳(realtime 기본값)만 맡는다. 같은 화면에 두 번째로 쓰는 곳은 realtime: false로 같은 쿼리 캐시만 읽는다. */
export function useMeetingNotices({ realtime = true, background = false }: { realtime?: boolean; background?: boolean } = {}) {
  const { profile } = useAuth()
  const enabled = profile?.status === 'active'
  useMeetingRealtime(Boolean(enabled && realtime), profile?.id, profile?.companyId ?? undefined)
  const polling = enabled && realtime
  const invitations = useQuery({
    queryKey: ['meeting-invitations', profile?.id],
    queryFn: listMeetingInvitations,
    ...sharedReadPolicy,
    enabled,
    refetchInterval: readPollInterval(30_000, polling),
    refetchIntervalInBackground: background && polling,
  })
  const meetings = useQuery({
    queryKey: ['company-meetings', profile?.id, profile?.companyId],
    queryFn: listCompanyMeetings,
    ...sharedReadPolicy,
    enabled,
    refetchInterval: readPollInterval(30_000, polling),
    refetchIntervalInBackground: background && polling,
  })
  const items = useMemo(() => {
    return meetingNoticeItems(invitations.data ?? emptyList<InboxNotification>(), meetings.data, profile?.id)
  }, [invitations.data, meetings.data, profile?.id])
  return {
    ready: invitations.isSuccess && meetings.isSuccess,
    items,
    series: meetings.data,
    pending: pendingMeetingNoticeCount(items),
    error: invitations.error ?? meetings.error,
  }
}
