import { isWorkday } from './monthly-attendance.ts'

const REGULAR_MINUTES = 480
const HALF_MINUTES = 240
const QUARTER_MINUTES = 360

export type OvertimeSpan = { employeeId: string; date: string; clockIn: string; clockOutAt: string | null }
export type OvertimeLeave = { employeeId: string; kind: string; status: string; from: string; to: string; start: string; end: string; endNextDay?: boolean }
export type MonthlyOvertime = {
  employeeId: string
  workedMinutes: number
  extraMinutes: number
  approvedMinutes: number
  completeDays: number
  openDays: number
  unconfiguredDays: number
}

function minutesOf(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)/.exec(value)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

function at(date: string, time: string): number {
  return Date.parse(`${date}T${time.slice(0, 5)}:00+09:00`)
}

/** 점심과 겹친 시간을 뺀 실제 체류. 퇴근이 출근보다 이르면 계산하지 않는다. */
export function workedMinutes(date: string, clockIn: string, clockOutAt: string, lunchStart: string, lunchEnd: string): number | null {
  const start = at(date, clockIn)
  const end = Date.parse(clockOutAt)
  const lunchFrom = minutesOf(lunchStart)
  const lunchTo = minutesOf(lunchEnd)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
  let minutes = Math.floor((end - start) / 60_000)
  if (lunchFrom != null && lunchTo != null && lunchTo > lunchFrom) {
    const overlap = Math.min(end, at(date, lunchEnd)) - Math.max(start, at(date, lunchStart))
    if (overlap > 0) minutes -= Math.floor(overlap / 60_000)
  }
  return Math.max(0, minutes)
}

function expectedMinutes(date: string, covers: ReadonlyMap<string, number | null>, employeeId: string): number | null {
  const covered = covers.get(`${employeeId}:${date}`)
  if (covered === null) return null
  if (covered != null) return covered
  return isWorkday(date, {}) ? REGULAR_MINUTES : 0
}

function coverMap(leaves: readonly OvertimeLeave[], month: string, today: string) {
  const covers = new Map<string, number | null>()
  for (const leave of leaves) {
    if (leave.status !== 'approved') continue
    const expected = leave.kind === 'annual' || leave.kind === 'official' ? null : leave.kind === 'half' ? HALF_MINUTES : leave.kind === 'quarter' ? QUARTER_MINUTES : undefined
    if (expected === undefined || leave.from > leave.to) continue
    const cursor = new Date(`${month}-01T12:00:00+09:00`)
    const end = new Date(`${month}-01T12:00:00+09:00`)
    end.setUTCMonth(end.getUTCMonth() + 1)
    for (; cursor < end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      const date = cursor.toISOString().slice(0, 10)
      if (date > today || date < leave.from || date > leave.to) continue
      const key = `${leave.employeeId}:${date}`
      const current = covers.get(key)
      if (current === undefined) covers.set(key, expected)
      else if (current === null || expected === null) covers.set(key, null)
      else covers.set(key, Math.min(current, expected))
    }
  }
  return covers
}

function approvedMinutes(leaves: readonly OvertimeLeave[], month: string) {
  const totals = new Map<string, number>()
  for (const leave of leaves) {
    if (leave.kind !== 'overtime' || leave.status !== 'approved' || leave.from.slice(0, 7) !== month || leave.from !== leave.to) continue
    const start = minutesOf(leave.start)
    const end = minutesOf(leave.end)
    if (start == null || end == null) continue
    const actualEnd = end + (leave.endNextDay ? 1440 : 0)
    if (actualEnd <= start) continue
    totals.set(leave.employeeId, (totals.get(leave.employeeId) ?? 0) + actualEnd - start)
  }
  return totals
}

/** 월별 추가 근무. 연차·공가는 빼고, 평일은 8시간·반차는 4시간·반반차는 6시간·휴일 출근은 전부 추가다. */
export function monthlyOvertimeHours(spans: readonly OvertimeSpan[], leaves: readonly OvertimeLeave[], lunchStart: string, lunchEnd: string, month: string, today: string, starts: ReadonlyMap<string, string>): MonthlyOvertime[] {
  const covers = coverMap(leaves, month, today)
  const approved = approvedMinutes(leaves, month)
  const rows = new Map<string, MonthlyOvertime>()
  const ensure = (employeeId: string) => {
    const current = rows.get(employeeId)
    if (current) return current
    const created = { employeeId, workedMinutes: 0, extraMinutes: 0, approvedMinutes: approved.get(employeeId) ?? 0, completeDays: 0, openDays: 0, unconfiguredDays: 0 }
    rows.set(employeeId, created)
    return created
  }
  for (const [employeeId, minutes] of approved) ensure(employeeId).approvedMinutes = minutes
  for (const span of spans) {
    if (span.date.slice(0, 7) !== month || span.date > today) continue
    const expected = expectedMinutes(span.date, covers, span.employeeId)
    if (expected == null) continue
    const row = ensure(span.employeeId)
    if (!span.clockOutAt) { row.openDays += 1; continue }
    const worked = workedMinutes(span.date, span.clockIn, span.clockOutAt, lunchStart, lunchEnd)
    if (worked == null) continue
    row.completeDays += 1
    row.workedMinutes += worked
    if (!isWorkday(span.date, {})) { row.extraMinutes += worked; continue }
    const startTime = starts.get(span.employeeId)
    if (!startTime || minutesOf(startTime) == null) { row.unconfiguredDays += 1; continue }
    const startAt = at(span.date, startTime), lunchFrom = at(span.date, lunchStart), lunchTo = at(span.date, lunchEnd)
    if (![startAt, lunchFrom, lunchTo].every(Number.isFinite) || lunchTo < lunchFrom) { row.unconfiguredDays += 1; continue }
    let endAt = startAt + REGULAR_MINUTES * 60_000
    if (startAt < lunchTo && endAt > lunchFrom) endAt += lunchTo - Math.max(startAt, lunchFrom)
    // 오후 휴가가 예정 퇴근을 앞당긴다. 중간 휴가는 이후 근무 구간을 유지한다.
    for (const leave of leaves) {
      if (leave.employeeId !== span.employeeId || leave.status !== 'approved' || (leave.kind !== 'half' && leave.kind !== 'quarter') || leave.from > span.date || leave.to < span.date) continue
      const from = at(span.date, leave.start), to = at(span.date, leave.end)
      if (Number.isFinite(from) && Number.isFinite(to) && from < endAt && to >= endAt) endAt = Math.max(startAt, from)
    }
    const actualStart = at(span.date, span.clockIn), actualEnd = Date.parse(span.clockOutAt)
    const extraStart = Math.max(actualStart, endAt)
    const overlap = Math.max(0, Math.min(actualEnd, lunchTo) - Math.max(extraStart, lunchFrom))
    row.extraMinutes += Math.max(0, Math.floor((actualEnd - extraStart - overlap) / 60_000))
  }
  return [...rows.values()].filter(row => row.completeDays > 0 || row.openDays > 0 || row.approvedMinutes > 0)
}

export function workDurationLabel(minutes: number): string {
  const whole = Math.max(0, Math.floor(minutes))
  const hours = Math.floor(whole / 60)
  const rest = whole % 60
  if (!hours) return `${rest}분`
  if (!rest) return `${hours}시간`
  return `${hours}시간 ${rest}분`
}
