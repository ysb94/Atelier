import type { InboxNotification, MeetingNotice } from '@/lib/inbox/types'
import type { MeetingSeries } from './meeting-schedule'
import { meetingStartSchedule, type MeetingStartSchedule } from './meeting-start-reminders'

type NoticeSeries = Pick<MeetingSeries, 'id' | 'status'> & {
  rounds: { id: string; scheduleVersion: number; response: MeetingNotice['status']; finalized: boolean }[]
}

export type MeetingNoticeContext = { invitations: InboxNotification[]; series: NoticeSeries[]; starts: MeetingStartSchedule[] }

/** Same projection for servers still serving the previous RPCs. */
export function legacyMeetingNoticeContext(invitations: InboxNotification[], rows: MeetingSeries[], personId: string): MeetingNoticeContext {
  return {
    invitations, starts: meetingStartSchedule(rows, personId),
    series: rows.map(s => ({
      id: s.id, status: s.status, rounds: s.rounds.map(r => ({
        id: r.id, scheduleVersion: r.scheduleVersion ?? 1,
        response: r.responses?.find(p => p.profileId === personId)?.status ?? 'pending',
        finalized: Boolean(r.manualConfirmation),
      })),
    })),
  }
}

function roundFromHref(href: string, series: readonly NoticeSeries[]) {
  const url = new URL(href, 'https://atelier.local')
  const meetingId = url.searchParams.get('meeting')
  const roundId = url.searchParams.get('round')
  if (!meetingId || !roundId) return null
  const item = series.find((row) => row.id === meetingId)
  const round = item?.rounds.find((row) => row.id === roundId)
  if (!item || !round) return null
  return { item, round }
}

function memberNotice(item: InboxNotification, series: readonly NoticeSeries[]): MeetingNotice | null {
  if (item.kind !== 'meeting_invitation' || item.meeting?.role === 'host') return null
  const found = roundFromHref(item.href, series)
  if (!found) return null
  return {
    roundId: found.round.id,
    scheduleVersion: found.round.scheduleVersion,
    status: found.round.response,
    role: 'member',
    finalized: found.round.finalized,
  }
}

export function meetingNoticeItems(invitations: readonly InboxNotification[], series: readonly NoticeSeries[]): InboxNotification[] {
  const memberItems = invitations.map((item) => {
    const meeting = memberNotice(item, series)
    return meeting ? { ...item, meeting } : item
  })
  return [...new Map(memberItems.map(item => [item.id, item])).values()]
}

export function pendingMeetingNoticeCount(items: readonly InboxNotification[]) {
  return items.filter((item) => item.meeting?.status === 'pending').length
}
