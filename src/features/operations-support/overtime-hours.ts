import { registeredOvertime, type OvertimeActual } from './overtime-actuals.ts'

export type OvertimeSpan = { employeeId: string; date: string; clockIn: string; clockOutAt: string | null }
export type OvertimeLeave = { id?: string; employeeId: string; kind: string; status: string; from: string; to: string; start: string; end: string; endNextDay?: boolean }
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

/** 승인 신청에 연결된 실제 입력만 합산한다. 출퇴근 기록으로 야근을 추정하지 않는다. */
export function monthlyOvertimeHours(_spans: readonly OvertimeSpan[], leaves: readonly OvertimeLeave[], _lunchStart: string, _lunchEnd: string, month: string, today: string, _starts: ReadonlyMap<string, string>, actuals: readonly OvertimeActual[] = []): MonthlyOvertime[] {
  const rows = new Map<string, MonthlyOvertime>()
  const requests = leaves.filter((leave): leave is OvertimeLeave & { id: string } => typeof leave.id === 'string')
  for (const item of registeredOvertime(requests, actuals, month, today)) {
    const row = rows.get(item.request.employeeId) ?? { employeeId: item.request.employeeId, workedMinutes: 0, extraMinutes: 0, approvedMinutes: 0, completeDays: 0, openDays: 0, unconfiguredDays: 0 }
    row.workedMinutes += item.minutes
    row.extraMinutes += item.minutes
    row.approvedMinutes += item.approvedMinutes
    row.completeDays += 1
    rows.set(row.employeeId, row)
  }
  return [...rows.values()]
}

export function workDurationLabel(minutes: number): string {
  const whole = Math.max(0, Math.floor(minutes))
  const hours = Math.floor(whole / 60)
  const rest = whole % 60
  if (!hours) return `${rest}분`
  if (!rest) return `${hours}시간`
  return `${hours}시간 ${rest}분`
}
