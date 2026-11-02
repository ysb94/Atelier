import type { MeetingSeries } from '../meetings/meeting-schedule'
import type { MeetingKind } from '../meetings/meeting-kinds'

export type MyScheduleMeeting = {
  id: string
  date: string
  start: string
  end: string
  title: string
  hostName: string
  isHost: boolean
  kind: MeetingKind
  round: number
  href: string
}

/** 호스트의 등록 일정, 참석 가능으로 응답한 회차, 응답 없는 미팅만 본인 달력에 표시한다. */
export function myScheduleMeetings(series: readonly MeetingSeries[], userId: string, month: string): MyScheduleMeeting[] {
  if (!userId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return []
  const events: MyScheduleMeeting[] = []
  for (const item of series) {
    const isHost = item.host.id === userId
    if (!isHost && (item.phase === 'preparing' || !item.members.some(member => member.id === userId))) continue
    for (const round of item.rounds) {
      const date = round.startsAt.slice(0, 10), start = round.startsAt.slice(11, 16)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.slice(0, 7) !== month || !/^([01]\d|2[0-3]):[0-5]\d$/.test(start)) continue
      if (!isHost) {
        if (!round.confirmed || round.manualConfirmation?.excludedIds.includes(userId)) continue
        if (item.kind !== 'meeting' && !round.responses?.some(response => response.profileId === userId && response.status === 'available')) continue
      }
      const duration = round.durationMinutes ?? item.durationMinutes
      const endMinutes = Number(start.slice(0, 2)) * 60 + Number(start.slice(3)) + duration
      const end = `${endMinutes >= 1440 ? '다음 날 ' : ''}${String(Math.floor(endMinutes / 60) % 24).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`
      const params = new URLSearchParams({ part: 'meetings', meeting: item.id, round: round.id })
      events.push({ id: round.id, date, start, end, title: item.title.trim() || '제목 없는 회의', hostName: item.host.name,
        isHost, kind: item.kind ?? 'project', round: round.round, href: `/settings/profile?${params}` })
    }
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.title.localeCompare(b.title, 'ko') || a.id.localeCompare(b.id))
}
