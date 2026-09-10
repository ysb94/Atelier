/** 회의실 날짜·시작 시각 가능 여부. 표는 날짜만 보고, 시간은 팝업에서 고른다. */

import {
  timeFromDateTime,
  toDateKey,
  type DayQuarterId,
  type MeetingDay,
  type MeetingDraft,
  type MeetingPerson,
} from './meeting-schedule'

export const DAY_QUARTERS = [
  {
    id: 'q1',
    label: '오전 전반',
    shortLabel: '오전1',
    start: '09:00',
    end: '11:00',
  },
  {
    id: 'q2',
    label: '오전 후반',
    shortLabel: '오전2',
    start: '11:00',
    end: '13:00',
  },
  {
    id: 'q3',
    label: '오후 전반',
    shortLabel: '오후1',
    start: '13:00',
    end: '16:00',
  },
  {
    id: 'q4',
    label: '오후 후반',
    shortLabel: '오후2',
    start: '16:00',
    end: '18:00',
  },
] as const

export type { DayQuarterId } from './meeting-schedule'
export type DayQuarter = (typeof DAY_QUARTERS)[number]

export type AttendanceKind =
  | 'annual'
  | 'field'
  | 'am_half'
  | 'pm_half'
  | 'am_quarter'
  | 'pm_quarter'

export const ATTENDANCE_KIND_LABEL: Record<AttendanceKind, string> = {
  annual: '연차',
  field: '외근',
  am_half: '오전반차',
  pm_half: '오후반차',
  am_quarter: '오전반반차',
  pm_quarter: '오후반반차',
}

const BLOCKED_QUARTERS: Record<AttendanceKind, readonly DayQuarterId[]> = {
  annual: ['q1', 'q2', 'q3', 'q4'],
  field: ['q1', 'q2', 'q3', 'q4'],
  am_half: ['q1', 'q2'],
  pm_half: ['q3', 'q4'],
  am_quarter: ['q1'],
  pm_quarter: ['q4'],
}

export type AttendanceEntry = {
  personId: string
  dateKey: string
  kind: AttendanceKind
}

export type AttendanceBlock = {
  id: string
  name: string
  kind: AttendanceKind
}

export type SlotBlock =
  | { type: 'inactive' }
  | { type: 'weekend' }
  | { type: 'past' }
  | { type: 'attendance'; people: AttendanceBlock[] }
  | { type: 'room_taken'; title: string; seriesId: string }

export type SlotState = {
  available: boolean
  blocks: SlotBlock[]
  occupant: MeetingDraft | null
}

export function dayQuarterById(id: DayQuarterId): DayQuarter {
  const found = DAY_QUARTERS.find((item) => item.id === id)
  if (!found) return DAY_QUARTERS[0]
  return found
}

export function quartersBlockedByKind(
  kind: AttendanceKind,
): readonly DayQuarterId[] {
  return BLOCKED_QUARTERS[kind]
}

export function quarterFromTime(time: string): DayQuarterId {
  if (time < '11:00') return 'q1'
  if (time < '13:00') return 'q2'
  if (time < '16:00') return 'q3'
  return 'q4'
}

export function roomDayQuarterKey(
  roomId: string,
  dateKey: string,
  quarterId: DayQuarterId,
): string {
  return `${roomId}:${dateKey}:${quarterId}`
}

export function isQuarterPast(
  dateKey: string,
  quarter: DayQuarter,
  now: Date,
): boolean {
  const todayKey = toDateKey(now)
  if (dateKey > todayKey) return false
  if (dateKey < todayKey) return true
  const [hour, minute] = quarter.end.split(':').map(Number)
  const endsAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute)
  return now.getTime() >= endsAt.getTime()
}

export const WORK_DAY_START_MINUTES = 9 * 60
export const WORK_DAY_END_MINUTES = 19 * 60
export const WORK_DAY_SPAN_MINUTES =
  WORK_DAY_END_MINUTES - WORK_DAY_START_MINUTES
export const MEETING_SLOT_STEP_MINUTES = 30
export const MEETING_DAY_LANE_HEIGHT_PX = 144

export const MEETING_DAY_LANE_MARKS = [
  { clock: '09:00', label: '9' },
  { clock: '13:00', label: '13' },
  { clock: '19:00', label: '19' },
] as const

export function clampWorkDayMinutes(totalMinutes: number): number {
  return Math.min(
    WORK_DAY_END_MINUTES,
    Math.max(WORK_DAY_START_MINUTES, totalMinutes),
  )
}

export function meetingLanePlacement(
  startsAt: string,
  durationMinutes: number,
): { topPx: number; heightPx: number } {
  const start = clampWorkDayMinutes(
    clockToMinutes(timeFromDateTime(startsAt) || '09:00'),
  )
  const end = clampWorkDayMinutes(
    start + Math.max(MEETING_SLOT_STEP_MINUTES, durationMinutes),
  )
  const topPx =
    ((start - WORK_DAY_START_MINUTES) / WORK_DAY_SPAN_MINUTES) *
    MEETING_DAY_LANE_HEIGHT_PX
  const heightPx =
    ((end - start) / WORK_DAY_SPAN_MINUTES) * MEETING_DAY_LANE_HEIGHT_PX
  return { topPx, heightPx }
}

export function meetingLaneMarkTop(clock: string): number {
  const start = clampWorkDayMinutes(clockToMinutes(clock))
  return (
    ((start - WORK_DAY_START_MINUTES) / WORK_DAY_SPAN_MINUTES) *
    MEETING_DAY_LANE_HEIGHT_PX
  )
}

export function minutesToClock(totalMinutes: number): string {
  const hour = Math.floor(totalMinutes / 60)
  const minute = totalMinutes % 60
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export function clockToMinutes(clock: string): number {
  const [hour, minute] = clock.split(':').map(Number)
  return hour * 60 + minute
}

export function listWorkDayClocks(): string[] {
  const times: string[] = []
  for (
    let start = WORK_DAY_START_MINUTES;
    start <= WORK_DAY_END_MINUTES;
    start += MEETING_SLOT_STEP_MINUTES
  ) {
    times.push(minutesToClock(start))
  }
  return times
}

export const WORK_DAY_CLOCKS = listWorkDayClocks()

export function listMeetingStartTimes(durationMinutes: number): string[] {
  return WORK_DAY_CLOCKS.filter(
    (clock) =>
      clockToMinutes(clock) + durationMinutes <= WORK_DAY_END_MINUTES,
  )
}

export function isClockPastOnDay(
  dateKey: string,
  clock: string,
  now: Date,
): boolean {
  const todayKey = toDateKey(now)
  if (dateKey > todayKey) return false
  if (dateKey < todayKey) return true
  return (
    clockToMinutes(clock) <= now.getHours() * 60 + now.getMinutes()
  )
}

export function meetingTimeOverlaps(
  startClock: string,
  durationMinutes: number,
  existing: readonly { startsAt: string; durationMinutes: number }[],
): boolean {
  return overlappingMeeting(startClock, durationMinutes, existing) !== null
}

export function overlappingMeeting<
  T extends { startsAt: string; durationMinutes: number },
>(
  startClock: string,
  durationMinutes: number,
  existing: readonly T[],
): T | null {
  const start = clockToMinutes(startClock)
  const end = start + durationMinutes
  return (
    existing.find((item) => {
      const otherStart = clockToMinutes(item.startsAt.slice(11, 16) || '00:00')
      const otherEnd = otherStart + item.durationMinutes
      return start < otherEnd && end > otherStart
    }) ?? null
  )
}

const ATTENDANCE_CLOCK_RANGES: Record<
  AttendanceKind,
  readonly { start: number; end: number }[]
> = {
  annual: [{ start: WORK_DAY_START_MINUTES, end: WORK_DAY_END_MINUTES }],
  field: [{ start: WORK_DAY_START_MINUTES, end: WORK_DAY_END_MINUTES }],
  am_half: [{ start: WORK_DAY_START_MINUTES, end: 13 * 60 }],
  pm_half: [{ start: 13 * 60, end: WORK_DAY_END_MINUTES }],
  am_quarter: [{ start: WORK_DAY_START_MINUTES, end: 11 * 60 }],
  pm_quarter: [{ start: 17 * 60, end: WORK_DAY_END_MINUTES }],
}

export function isAllDayAttendanceKind(kind: AttendanceKind): boolean {
  return kind === 'annual' || kind === 'field'
}

export function attendanceBlocksMeeting(
  kind: AttendanceKind,
  startClock: string,
  durationMinutes: number,
): boolean {
  const start = clockToMinutes(startClock)
  const end = start + durationMinutes
  return ATTENDANCE_CLOCK_RANGES[kind].some(
    (range) => start < range.end && end > range.start,
  )
}

export type DayBlock =
  | { type: 'inactive' }
  | { type: 'weekend' }
  | { type: 'past' }
  | { type: 'all_away' }
  | { type: 'room_full' }

export type DayState = {
  available: boolean
  blocks: DayBlock[]
}

export type StartTimeState = {
  available: boolean
  reason: string
}

export function attendancePeopleForStart(
  dateKey: string,
  startClock: string,
  durationMinutes: number,
  attendees: readonly Pick<MeetingPerson, 'id' | 'name'>[],
  attendance: readonly AttendanceEntry[],
): AttendanceBlock[] {
  return attendance.flatMap((entry) => {
    if (entry.dateKey !== dateKey) return []
    if (!attendanceBlocksMeeting(entry.kind, startClock, durationMinutes)) {
      return []
    }
    const person = attendees.find((row) => row.id === entry.personId)
    if (!person) return []
    return [{ id: person.id, name: person.name, kind: entry.kind }]
  })
}

export function resolveDayState(input: {
  composeReady: boolean
  day: MeetingDay
  durationMinutes: number
  attendees: readonly Pick<MeetingPerson, 'id'>[]
  attendance: readonly AttendanceEntry[]
  occupants: readonly MeetingDraft[]
  now: Date
}): DayState {
  const blocks: DayBlock[] = []
  if (!input.composeReady) blocks.push({ type: 'inactive' })
  if (input.day.isWeekend) blocks.push({ type: 'weekend' })

  const todayKey = toDateKey(input.now)
  const starts = listMeetingStartTimes(input.durationMinutes)
  const existing = input.occupants.map((item) => ({
    startsAt: item.startsAt,
    durationMinutes: item.durationMinutes,
  }))
  const openClock = starts.some(
    (clock) =>
      !isClockPastOnDay(input.day.key, clock, input.now) &&
      !meetingTimeOverlaps(clock, input.durationMinutes, existing),
  )
  const anyNotPast = starts.some(
    (clock) => !isClockPastOnDay(input.day.key, clock, input.now),
  )

  if (input.day.key < todayKey || (!input.day.isWeekend && !anyNotPast)) {
    blocks.push({ type: 'past' })
  }

  const allAway =
    input.attendees.length > 0 &&
    input.attendees.every((person) =>
      input.attendance.some(
        (entry) =>
          entry.personId === person.id &&
          entry.dateKey === input.day.key &&
          isAllDayAttendanceKind(entry.kind),
      ),
    )
  if (allAway) blocks.push({ type: 'all_away' })

  if (
    input.composeReady &&
    !input.day.isWeekend &&
    anyNotPast &&
    !openClock
  ) {
    blocks.push({ type: 'room_full' })
  }

  return {
    available: blocks.length === 0,
    blocks,
  }
}

export function formatDayBlockLabel(blocks: readonly DayBlock[]): string {
  const labels = blocks.flatMap((block) => {
    if (block.type === 'inactive') return []
    if (block.type === 'weekend') return ['주말']
    if (block.type === 'past') return ['지난 날']
    if (block.type === 'all_away') return ['전원 불가']
    return ['예약 마감']
  })
  return labels.join(' · ')
}

export function resolveStartTimeState(input: {
  composeReady?: boolean
  weekend?: boolean
  dateKey: string
  clock: string
  durationMinutes: number
  attendees: readonly Pick<MeetingPerson, 'id' | 'name'>[]
  attendance: readonly AttendanceEntry[]
  occupants: readonly MeetingDraft[]
  now: Date
}): StartTimeState {
  if (input.weekend) {
    return { available: false, reason: '주말' }
  }
  if (clockToMinutes(input.clock) + input.durationMinutes > WORK_DAY_END_MINUTES) {
    return { available: false, reason: '19시를 넘김' }
  }
  if (isClockPastOnDay(input.dateKey, input.clock, input.now)) {
    return { available: false, reason: '지난 시간' }
  }
  const taken = overlappingMeeting(
    input.clock,
    input.durationMinutes,
    input.occupants,
  )
  if (taken) {
    return { available: false, reason: `다른 팀 · ${taken.title}` }
  }
  const people = attendancePeopleForStart(
    input.dateKey,
    input.clock,
    input.durationMinutes,
    input.attendees,
    input.attendance,
  )
  if (people.length > 0) {
    return {
      available: false,
      reason: people
        .map((person) => `${person.name} ${ATTENDANCE_KIND_LABEL[person.kind]}`)
        .join(', '),
    }
  }
  if (input.composeReady === false) {
    return { available: false, reason: '주제를 먼저 정하세요' }
  }
  return { available: true, reason: '' }
}

export function formatMeetingClockRange(
  startClock: string,
  durationMinutes: number,
): string {
  return `${startClock}–${minutesToClock(clockToMinutes(startClock) + durationMinutes)}`
}

export function isClockCoveredByMeeting(
  clock: string,
  startClock: string,
  durationMinutes: number,
): boolean {
  const start = clockToMinutes(startClock)
  const at = clockToMinutes(clock)
  return at >= start && at < start + durationMinutes
}

export function groupMeetingsByRoomDayQuarter(
  items: readonly MeetingDraft[],
): Map<string, MeetingDraft> {
  const grouped = new Map<string, MeetingDraft>()
  for (const item of items) {
    grouped.set(
      roomDayQuarterKey(item.roomId, item.startsAt.slice(0, 10), item.quarterId),
      item,
    )
  }
  return grouped
}

export function resolveSlotState(input: {
  composeReady: boolean
  day: MeetingDay
  quarter: DayQuarter
  roomId: string
  attendees: readonly Pick<MeetingPerson, 'id' | 'name'>[]
  attendance: readonly AttendanceEntry[]
  occupant: MeetingDraft | null
  now: Date
}): SlotState {
  const blocks: SlotBlock[] = []
  if (!input.composeReady) blocks.push({ type: 'inactive' })
  if (input.day.isWeekend) blocks.push({ type: 'weekend' })
  if (isQuarterPast(input.day.key, input.quarter, input.now)) {
    blocks.push({ type: 'past' })
  }

  const people = input.attendance.flatMap((entry) => {
    if (entry.dateKey !== input.day.key) return []
    if (!quartersBlockedByKind(entry.kind).includes(input.quarter.id)) {
      return []
    }
    const person = input.attendees.find((row) => row.id === entry.personId)
    if (!person) return []
    return [{ id: person.id, name: person.name, kind: entry.kind }]
  })
  if (people.length > 0) blocks.push({ type: 'attendance', people })

  if (input.occupant) {
    blocks.push({
      type: 'room_taken',
      title: input.occupant.title,
      seriesId: input.occupant.seriesId,
    })
  }

  return {
    available: blocks.length === 0,
    blocks,
    occupant: input.occupant,
  }
}

export function formatSlotBlockLabel(blocks: readonly SlotBlock[]): string {
  const labels = blocks.map((block) => {
    if (block.type === 'inactive') return '주제를 먼저 정하세요'
    if (block.type === 'weekend') return '주말'
    if (block.type === 'past') return '지난 시간'
    if (block.type === 'room_taken') return `다른 팀 · ${block.title}`
    return block.people
      .map((person) => `${person.name} ${ATTENDANCE_KIND_LABEL[person.kind]}`)
      .join(', ')
  })
  return labels.join(' · ')
}
