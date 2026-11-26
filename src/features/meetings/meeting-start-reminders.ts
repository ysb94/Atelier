import { roundRole } from './meeting-round-members'
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

export type MeetingStartSchedule = Omit<MeetingStartNotice, 'startsAtMs' | 'token' | 'href'> & { scheduleVersion: number }

export function startNoticesFromSchedule(rows: readonly MeetingStartSchedule[]): MeetingStartNotice[] {
  return rows.flatMap(row => {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(row.startsAt)) return []
    const startsAtMs = Date.parse(`${row.startsAt}:00+09:00`)
    if (!Number.isFinite(startsAtMs)) return []
    return [{ ...row, startsAtMs,
      token: JSON.stringify([row.scheduleVersion, row.startsAt, row.roomId, row.durationMinutes]),
      href: `/settings/profile?part=meetings&meeting=${encodeURIComponent(row.seriesId)}&round=${encodeURIComponent(row.roundId)}` }]
  }).sort((a, b) => a.startsAtMs - b.startsAtMs || a.roundId.localeCompare(b.roundId))
}

/** DB의 날짜 문자열은 한국 시각이다. 기기의 시간대와 관계없이 같은 순간에 알린다. */
export function meetingStartSchedule(series: readonly MeetingSeries[], personId: string): MeetingStartSchedule[] {
  if (!personId) return []
  const notices: MeetingStartSchedule[] = []
  for (const meeting of series) {
    if (meeting.status !== 'in_progress' || meeting.phase !== 'published') continue
    const host = meeting.host.id === personId

    for (const round of meeting.rounds) {
      if (!host && roundRole(meeting, round, personId) !== 'attendee') continue
      if (round.manualConfirmation?.excludedIds.includes(personId)) continue
      if (!round.confirmed) continue
      const durationMinutes = round.durationMinutes ?? meeting.durationMinutes
      notices.push({
        seriesId: meeting.id, roundId: round.id, round: round.round, title: meeting.title,
        role: host ? '호스트' : '멤버', startsAt: round.startsAt,
        roomId: round.roomId, durationMinutes,
        scheduleVersion: round.scheduleVersion ?? 0,
      })
    }
  }
  return notices
}

export function upcomingMeetingNotices(series: readonly MeetingSeries[], personId: string): MeetingStartNotice[] {
  return startNoticesFromSchedule(meetingStartSchedule(series, personId))
}

export function meetingNoticeDue(notice: MeetingStartNotice, now: number): boolean {
  return now >= notice.startsAtMs - MEETING_REMINDER_LEAD_MS && now < notice.startsAtMs
}

export function meetingNoticeStorageKey(companyId: string, personId: string, roundId: string): string {
  return `atelier:meeting-start-confirmed:${companyId}:${personId}:${roundId}`
}
