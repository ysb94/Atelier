import type { AttendanceClock } from '../settings/my-attendance.ts'
import { minuteOf, type PersonalRequest } from '../settings/personal-requests.ts'
import type { WorkdayBasis } from '../../lib/supabase/attendance-entry.ts'

export const ATTENDANCE_GUIDANCE_START = '2026-10-26'
const MINUTE = 60_000
type Interval = [number, number]

export function workInstant(date: string, time: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || minuteOf(time) == null) return null
  const day = Date.parse(`${date}T00:00:00Z`)
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== date) return null
  const value = Date.parse(`${date}T${time}:00+09:00`)
  return Number.isFinite(value) ? value : null
}

function subtract(intervals: Interval[], from: number, to: number): Interval[] {
  return intervals.flatMap(([start, end]): Interval[] => {
    if (to <= start || from >= end) return [[start, end]]
    return [...(from > start ? [[start, from] as Interval] : []), ...(to < end ? [[to, end] as Interval] : [])]
  })
}

/** 저장된 휴가 시간대를 제외하며, 휴가 유형 이름으로 시간을 추측하지 않는다. */
export function workdayGuidance(date: string, basis: WorkdayBasis | null | undefined, requests: readonly PersonalRequest[]) {
  const approved = requests.filter(r => r.status === 'approved' && r.from <= date && r.to >= date)
  const fullLeave = approved.some(r => r.kind === 'annual' || r.kind === 'official')
  const empty = { start: null as number | null, end: null as number | null, fullLeave }
  if (fullLeave || !basis?.configured || !basis.start) return empty
  const start = workInstant(date, basis.start), lunchStart = workInstant(date, basis.lunchStart), lunchEnd = workInstant(date, basis.lunchEnd)
  if (start == null || lunchStart == null || lunchEnd == null || lunchEnd < lunchStart) return empty
  let end = start + 480 * MINUTE
  if (start < lunchEnd && end > lunchStart) end += lunchEnd - Math.max(start, lunchStart)
  let work: Interval[] = subtract([[start, end]], lunchStart, lunchEnd)
  for (const request of approved) {
    if (request.kind !== 'half' && request.kind !== 'quarter') continue
    const from = workInstant(date, request.start), to = workInstant(date, request.end)
    if (from != null && to != null && to > from) work = subtract(work, from, to)
  }
  const overtime = approved.filter(r => r.kind === 'overtime').flatMap((r): Interval[] => {
    const from = workInstant(date, r.start), to = workInstant(date, r.end)
    return from != null && to != null && to > from ? [[from, to]] : []
  })
  const all = [...work, ...overtime]
  return all.length ? { start: Math.min(...all.map(r => r[0])), end: Math.max(...all.map(r => r[1])), fullLeave: false } : { ...empty, fullLeave: true }
}

export function previousClock(rows: readonly AttendanceClock[], today: string): AttendanceClock | null {
  return rows.reduce<AttendanceClock | null>((latest, row) => row.date < today && (!latest || row.date > latest.date) ? row : latest, null)
}

export function previousMissingClock(rows: readonly AttendanceClock[], requests: readonly PersonalRequest[], today: string): AttendanceClock | null {
  const row = previousClock(rows, today)
  if (!row || row.date < ATTENDANCE_GUIDANCE_START || row.clockOutAt) return null
  return requests.some(r => r.kind === 'correction' && r.from === row.date && (r.status === 'approved' || r.status === 'pending')) ? null : row
}

export function validatePreviousClockOut(previous: AttendanceClock, current: AttendanceClock, value: number | null): string {
  const start = workInstant(previous.date, previous.clockIn), limit = workInstant(current.date, current.clockIn)
  return value == null || start == null || limit == null || value < start || value > limit || value % MINUTE !== 0
    ? '퇴근 시각은 직전 출근 시각부터 오늘 출근 시각 사이로 입력해 주세요.' : ''
}
