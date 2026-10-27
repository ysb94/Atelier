import type { MeetingDraft, MeetingPerson, MeetingSeries } from './meeting-schedule'
import { parseDateKey, toDateKey } from './meeting-schedule'
import { availabilityMinutes } from './meeting-availability'

/** 이 모델은 UI 미리보기 전용이다. 기존 회의 저장 모델/API로 전달하지 않는다. */
export const MEETING_KINDS = [
  { value: 'meeting', label: '미팅', short: '미팅', hint: '누구와 언제 미팅했는지 진행 기록만 남깁니다.' },
  { value: 'one_off', label: '1회성 회의', short: '1회성', hint: '한 번의 회의에 안내·내용·결과를 기록합니다.' },
  { value: 'project', label: '프로젝트 회의', short: '프로젝트', hint: '기존처럼 회차별로 준비하고 기록합니다.' },
  { value: 'routine', label: '루틴 회의', short: '루틴', hint: '종료일 없이 이어가며, 필요할 때 다음 회차를 잡습니다.' },
  { value: 'interview', label: '면접', short: '면접', hint: '공개 일정과 지원자 정보를 나눠 표시합니다.' },
] as const
export type MeetingKind = (typeof MEETING_KINDS)[number]['value']
export type PreviewResponse = 'pending' | 'available' | 'unavailable'
export type PreviewMeeting = {
  id: string; seriesId: string; kind: MeetingKind; title: string
  host: MeetingPerson; members: MeetingPerson[]; date: string; clock: string
  duration: number; roomId: string; round: number; content: string; result: string; finished?: boolean
  status: 'preparing' | 'in_progress' | 'done'; local: boolean
  responses: { profileId: string; status: PreviewResponse }[]
}
export type PreviewCandidate = { name: string; contact: string; notes: string }
export const PREVIEW_CLOCKS = Array.from({ length: 20 }, (_, index) => previewClock(540 + index * 30))
export const PREVIEW_WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']
export function previewClock(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}
export function shiftPreviewDay(date: string, offset: number) {
  const next = parseDateKey(date); next.setDate(next.getDate() + offset); return toDateKey(next)
}
export function validPreviewDate(date: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && toDateKey(parseDateKey(date)) === date
}
export function previewDateLabel(date: string) {
  return `${date.slice(5).replace('-', '/')} (${PREVIEW_WEEKDAYS[parseDateKey(date).getDay()]})`
}
export function previewTimeLabel(item: Pick<PreviewMeeting, 'clock' | 'duration'>) {
  return item.clock ? `${item.clock}–${previewClock(availabilityMinutes(item.clock) + item.duration)}` : '일정 미정'
}
export function previewOverlaps(clock: string, duration: number, otherClock: string, otherDuration: number) {
  return availabilityMinutes(clock) < availabilityMinutes(otherClock) + otherDuration && availabilityMinutes(clock) + duration > availabilityMinutes(otherClock)
}
export function isPreviewParticipant(item: PreviewMeeting, actorId: string) {
  return item.host.id === actorId || item.members.some(person => person.id === actorId)
}
export function previewKindLabel(kind: MeetingKind) { return MEETING_KINDS.find(item => item.value === kind)!.short }
export function previewHasRounds(kind: MeetingKind) { return kind === 'project' || kind === 'routine' }
export function previewCalendarMeetings(events: readonly PreviewMeeting[]) {
  return events.filter(item => item.kind !== 'meeting' && item.status !== 'preparing' && item.date && item.clock && item.roomId)
}

export function existingPreviewMeetings(series: readonly MeetingSeries[], bookings: readonly MeetingDraft[]): PreviewMeeting[] {
  const rows = new Map<string, PreviewMeeting>()
  for (const item of series) {
    for (const round of item.rounds) {
      rows.set(round.id, {
        id: round.id, seriesId: item.id, kind: 'project', title: item.title,
        host: item.host, members: item.members, date: round.startsAt.slice(0, 10), clock: round.startsAt.slice(11, 16),
        duration: round.durationMinutes ?? item.durationMinutes, roomId: round.roomId,
        round: round.round, content: round.content ?? '', result: round.result ?? '', local: false,
        status: item.status === 'done' ? 'done' : item.phase === 'preparing' || !round.startsAt || round.confirmed === false ? 'preparing' : 'in_progress',
        responses: round.responses ?? [],
      })
    }
  }
  for (const item of bookings) if (!rows.has(item.id)) rows.set(item.id, {
    id: item.id, seriesId: item.seriesId, kind: 'project', title: item.title,
    host: item.host, members: item.members ?? [], date: item.startsAt.slice(0, 10), clock: item.startsAt.slice(11, 16),
    duration: item.durationMinutes, roomId: item.roomId, round: item.round,
    content: '', result: '', local: false, status: 'in_progress', responses: [],
  })
  return [...rows.values()]
}

export function previewSlotProblem({ date, clock, roomId, duration, events, lunch, now = new Date() }: {
  date: string; clock: string; roomId: string; duration: number; events: readonly PreviewMeeting[]
  lunch?: { start: string; end: string }; now?: Date
}): string | null {
  if (!lunch) return '점심시간을 확인하는 중입니다.'
  if (!validPreviewDate(date) || !PREVIEW_CLOCKS.includes(clock) || !roomId || !Number.isFinite(duration) || duration <= 0) return '날짜·회의실·시간을 선택하세요.'
  if (parseDateKey(date).getDay() === 0 || parseDateKey(date).getDay() === 6) return '주말'
  if (new Date(`${date}T${clock}:00`) <= now) return '지난 시간'
  if (availabilityMinutes(clock) + duration > 19 * 60) return '19시를 넘는 일정'
  if (previewOverlaps(clock, duration, lunch.start, availabilityMinutes(lunch.end) - availabilityMinutes(lunch.start))) return `점심시간 ${lunch.start}–${lunch.end}`
  const taken = previewCalendarMeetings(events).find(item => item.date === date && item.roomId === roomId && previewOverlaps(clock, duration, item.clock, item.duration))
  return taken ? `회의실 예약 중 · ${taken.title}` : null
}

export function previewPeopleConflicts(date: string, clock: string, duration: number, people: readonly MeetingPerson[], events: readonly PreviewMeeting[]) {
  if (!clock) return []
  return previewCalendarMeetings(events).filter(item => item.date === date && previewOverlaps(clock, duration, item.clock, item.duration))
    .flatMap(item => people.filter(person => isPreviewParticipant(item, person.id)).map(person => ({ key: `${item.id}:${person.id}`, person, meeting: item })))
}
