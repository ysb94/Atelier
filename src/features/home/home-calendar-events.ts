import type { MeetingSeries } from '../meetings/meeting-schedule.ts'
import { requestLabel, type PersonalRequest } from '../settings/personal-requests.ts'
import { addDays, parseDateKey, toDateKey } from './home-events.ts'

export type HomeCalendarCategory = 'meeting' | 'leave'
export type HomeCalendarEvent = {
  id: string
  date: string
  time: string
  title: string
  category: HomeCalendarCategory
  note: string
}

/** 보이는 달 앞뒤로 일주일. 주간 보기에서 달이 바뀌는 칸까지 포함한다. */
export function homeCalendarWindow(month: string): { from: string; to: string } {
  const [year, number] = month.split('-').map(Number)
  const start = new Date(year, number - 1, 1)
  const end = new Date(year, number, 0)
  return { from: toDateKey(addDays(start, -7)), to: toDateKey(addDays(end, 7)) }
}

function datesBetween(from: string, to: string): string[] {
  const dates: string[] = []
  let cursor = parseDateKey(from)
  const last = toDateKey(parseDateKey(to))
  for (let guard = 0; guard < 400 && toDateKey(cursor) <= last; guard += 1) {
    dates.push(toDateKey(cursor))
    cursor = addDays(cursor, 1)
  }
  return dates
}

function leaveTitle(request: PersonalRequest): string {
  const pending = request.status === 'pending' ? ' (승인 대기)' : ''
  if (request.kind === 'half') return `${request.start < '13:00' ? '오전' : '오후'} 반차${pending}`
  if (request.kind === 'quarter') return `반반차 ${request.start}–${request.end}${pending}`
  if (request.kind === 'overtime') return `야근 ${request.start}–${request.end}${pending}`
  if (request.kind === 'annual') return `연차${pending}`
  return `${requestLabel(request.kind)}${pending}`
}

function leaveTime(request: PersonalRequest): string {
  if (request.kind === 'annual' || request.kind === 'official') return '종일'
  return request.start
}

function leaveNote(request: PersonalRequest): string {
  return [request.place.trim(), request.note.trim()].filter(Boolean).join(' · ')
}

/** 확정됐고 내가 호스트이거나 멤버인 회의만. 달력 RPC는 제목·참석자가 비어 회사 전체 예약을 돌려준다. */
export function homeMeetingEvents(series: readonly MeetingSeries[], userId: string, from: string, to: string): HomeCalendarEvent[] {
  const events: HomeCalendarEvent[] = []
  for (const item of series) {
    const mine = item.host.id === userId || item.members.some(member => member.id === userId)
    if (!mine) continue
    for (const round of item.rounds) {
      const date = round.startsAt.slice(0, 10)
      if (!round.confirmed || date < from || date > to) continue
      const title = item.title.trim() || '제목 없는 회의'
      events.push({
        id: `meeting:${round.id}`,
        date,
        time: round.startsAt.slice(11, 16),
        title,
        category: 'meeting',
        note: [item.host.name, `${round.durationMinutes || item.durationMinutes}분`].filter(Boolean).join(' · '),
      })
    }
  }
  return events
}

/** 대기·승인된 내 휴가·외근·야근. 출퇴근 정정은 일정이 아니므로 뺀다. */
export function homeLeaveEvents(requests: readonly PersonalRequest[], from: string, to: string): HomeCalendarEvent[] {
  const events: HomeCalendarEvent[] = []
  for (const request of requests) {
    if (request.status !== 'pending' && request.status !== 'approved') continue
    if (request.kind === 'correction') continue
    const start = request.from > from ? request.from : from
    const end = request.to < to ? request.to : to
    if (start > end) continue
    for (const date of datesBetween(start, end)) {
      events.push({
        id: `leave:${request.id}:${date}`,
        date,
        time: leaveTime(request),
        title: leaveTitle(request),
        category: 'leave',
        note: leaveNote(request),
      })
    }
  }
  return events
}

export function sortHomeCalendarEvents(events: readonly HomeCalendarEvent[]): HomeCalendarEvent[] {
  return [...events].sort((left, right) => left.date.localeCompare(right.date) || left.time.localeCompare(right.time, 'ko') || left.title.localeCompare(right.title, 'ko'))
}
