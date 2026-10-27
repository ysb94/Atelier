import type { MeetingSeries } from './meeting-schedule'

export const MEETING_REMINDER_LEAD_MS = 30 * 60_000

export type MeetingStartNotice = {
  seriesId: string
  roundId: string
  round: number
  title: string
  role: '호스트' | '멤버'
  startsAt: string
  startsAtMs: number
  roomId: string
  durationMinutes: number
  token: string
  href: string
}

/** DB의 날짜 문자열은 한국 시각이다. 기기의 시간대와 관계없이 같은 순간에 알린다. */
export function upcomingMeetingNotices(series: readonly MeetingSeries[], personId: string): MeetingStartNotice[] {
  if (!personId) return []
  const notices: MeetingStartNotice[] = []
  for (const meeting of series) {
    if (meeting.status !== 'in_progress' || meeting.phase !== 'published') continue
    const host = meeting.host.id === personId
    if (!host && !meeting.members.some(member => member.id === personId)) continue
    for (const round of meeting.rounds) {
      if (!round.confirmed || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(round.startsAt)) continue
      const startsAtMs = Date.parse(`${round.startsAt}:00+09:00`)
      if (!Number.isFinite(startsAtMs)) continue
      const durationMinutes = round.durationMinutes ?? meeting.durationMinutes
      notices.push({
        seriesId: meeting.id, roundId: round.id, round: round.round, title: meeting.title,
        role: host ? '호스트' : '멤버', startsAt: round.startsAt, startsAtMs,
        roomId: round.roomId, durationMinutes,
        token: JSON.stringify([round.scheduleVersion ?? 0, round.startsAt, round.roomId, durationMinutes]),
        href: `/settings/profile?part=meetings&meeting=${encodeURIComponent(meeting.id)}&round=${encodeURIComponent(round.id)}`,
      })
    }
  }
  return notices.sort((a, b) => a.startsAtMs - b.startsAtMs || a.roundId.localeCompare(b.roundId))
}

export function meetingNoticeDue(notice: MeetingStartNotice, now: number): boolean {
  return now >= notice.startsAtMs - MEETING_REMINDER_LEAD_MS && now < notice.startsAtMs
}

export function meetingNoticeStorageKey(companyId: string, personId: string, roundId: string): string {
  return `atelier:meeting-start-confirmed:${companyId}:${personId}:${roundId}`
}
