export type LeaveResetAlarmKind = 'threeMonths' | 'oneMonth' | 'twoWeeks'

export type LeaveResetAlarm = {
  kind: LeaveResetAlarmKind
  label: string
  date: string
}

export type LeaveResetSchedule = {
  resetDate: string
  alarms: LeaveResetAlarm[]
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function parseDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const last = new Date(year, month, 0).getDate()
  if (day > last) return null
  return { year, month, day }
}

function dateKey(year: number, monthIndex: number, day: number) {
  const last = new Date(year, monthIndex + 1, 0).getDate()
  return `${year}-${pad(monthIndex + 1)}-${pad(Math.min(day, last))}`
}

function shiftMonths(key: string, months: number) {
  const parsed = parseDateKey(key)
  if (!parsed) return key
  const index = parsed.month - 1 + months
  const year = parsed.year + Math.floor(index / 12)
  const month = ((index % 12) + 12) % 12
  return dateKey(year, month, parsed.day)
}

function shiftDays(key: string, days: number) {
  const parsed = parseDateKey(key)
  if (!parsed) return key
  const date = new Date(parsed.year, parsed.month - 1, parsed.day)
  date.setDate(date.getDate() + days)
  return dateKey(date.getFullYear(), date.getMonth(), date.getDate())
}

export function todayKey(now = new Date()) {
  return dateKey(now.getFullYear(), now.getMonth(), now.getDate())
}

/** 입사 다음 해부터, 오늘 이후(오늘 포함) 가장 가까운 입사 월·일. */
export function nextLeaveResetDate(hireDate: string, today: string) {
  const hire = parseDateKey(hireDate)
  const now = parseDateKey(today)
  if (!hire || !now) return null
  let year = hire.year + 1
  let reset = dateKey(year, hire.month - 1, hire.day)
  while (reset < today) {
    year += 1
    reset = dateKey(year, hire.month - 1, hire.day)
  }
  return reset
}

export function leaveResetSchedule(hireDate: string, today: string): LeaveResetSchedule | null {
  const resetDate = nextLeaveResetDate(hireDate, today)
  if (!resetDate) return null
  return {
    resetDate,
    alarms: [
      { kind: 'threeMonths', label: '3개월 전', date: shiftMonths(resetDate, -3) },
      { kind: 'oneMonth', label: '1개월 전', date: shiftMonths(resetDate, -1) },
      { kind: 'twoWeeks', label: '2주 전', date: shiftDays(resetDate, -14) },
    ],
  }
}

export function alarmWasDue(alarmDate: string, today: string) {
  return alarmDate <= today
}

/** 세 알람 중 하나라도 날짜가 된 사람. 아직 먼 직원은 대상이 아니다. */
export function isLeaveAlarmTarget(schedule: LeaveResetSchedule, today: string) {
  return schedule.alarms.some((alarm) => alarmWasDue(alarm.date, today))
}
