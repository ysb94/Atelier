import type { InboxNotification, MeetingNotice } from '@/lib/inbox/types'
import type { MeetingSeries } from './meeting-schedule'

function roundFromHref(href: string, series: readonly MeetingSeries[]) {
  const url = new URL(href, 'https://atelier.local')
  const meetingId = url.searchParams.get('meeting')
  const roundId = url.searchParams.get('round')
  if (!meetingId || !roundId) return null
  const item = series.find((row) => row.id === meetingId)
  const round = item?.rounds.find((row) => row.id === roundId)
  if (!item || !round) return null
  return { item, round }
}

function memberNotice(item: InboxNotification, series: readonly MeetingSeries[], profileId: string): MeetingNotice | null {
  if (item.kind !== 'meeting_invitation' || item.meeting?.role === 'host') return null
  const found = roundFromHref(item.href, series)
  if (!found) return null
  const status = found.round.responses?.find((response) => response.profileId === profileId)?.status ?? 'pending'
  return {
    roundId: found.round.id,
    scheduleVersion: found.round.scheduleVersion ?? 1,
    status,
    role: 'member',
  }
}

export function meetingNoticeItems(invitations: readonly InboxNotification[], series: readonly MeetingSeries[] | undefined, profileId: string | undefined): InboxNotification[] {
  if (!profileId) return [...invitations]
  const rows = series ?? []
  const memberItems = invitations.map((item) => {
    const meeting = memberNotice(item, rows, profileId)
    return meeting ? { ...item, meeting } : item
  })
  return [...new Map(memberItems.map(item => [item.id, item])).values()]
}

export function pendingMeetingNoticeCount(items: readonly InboxNotification[]) {
  return items.filter((item) => item.meeting?.status === 'pending').length
}
