import { koreanHolidayNames } from './korean-holidays.ts'

export const ATTENDANCE_STATUSES = [
  { id: 'unset', label: '미기록' }, { id: 'present', label: '출근' },
  { id: 'remote', label: '재택' }, { id: 'offsite', label: '외근' }, { id: 'annual', label: '연차' },
  { id: 'half-am', label: '오전 반차' }, { id: 'half-pm', label: '오후 반차' },
  { id: 'official', label: '예비군·공가' }, { id: 'absent', label: '결근' },
  { id: 'holiday', label: '휴무' },
] as const
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number]['id']
export type AttendanceRecord = { status: AttendanceStatus; start: string; end: string; expectedStart: string; note: string; reviewed: boolean }
export type AttendanceSchedule = { start: string; grace: number }
export type AttendanceRecords = Record<string, Record<string, AttendanceRecord>>
export type WorkdayOverrides = Record<string, boolean>
export const EMPTY_ATTENDANCE: AttendanceRecord = { status: 'unset', start: '', end: '', expectedStart: '', note: '', reviewed: false }
export const EMPTY_SCHEDULE: AttendanceSchedule = { start: '', grace: 5 }

export function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function shiftMonth(month: string, amount: number) {
  const [year, number] = month.split('-').map(Number)
  return localDateKey(new Date(year, number - 1 + amount, 1)).slice(0, 7)
}
export function monthLabel(month: string) { const [year, number] = month.split('-'); return `${year}년 ${Number(number)}월` }
export function monthDates(month: string) {
  const [year, number] = month.split('-').map(Number)
  const count = new Date(year, number, 0).getDate()
  return Array.from({ length: count }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`)
}
export function isWorkday(key: string, overrides: WorkdayOverrides) {
  if (Object.hasOwn(overrides, key)) return overrides[key]
  if (koreanHolidayNames(key).length > 0) return false
  const weekday = new Date(`${key}T12:00:00`).getDay()
  return weekday !== 0 && weekday !== 6
}
export function timeSeconds(value: string) {
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(value)) return null
  const [hour, minute, second = 0] = value.split(':').map(Number)
  return hour < 24 && minute < 60 && second < 60 ? hour * 3600 + minute * 60 + second : null
}
export function formatTime(value: number | null) {
  if (value == null) return '—'
  const seconds = Math.round(value)
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(part => String(part).padStart(2, '0')).join(':')
}
export function needsArrival(status: AttendanceStatus) { return ['present', 'remote', 'half-am', 'half-pm'].includes(status) }
export function recordTiming(record: AttendanceRecord, schedule: AttendanceSchedule) {
  const actual = needsArrival(record.status) ? timeSeconds(record.start) : null
  const expected = record.expectedStart || (record.status === 'half-am' ? '' : schedule.start)
  const baseline = timeSeconds(expected)
  return {
    actual, baseline,
    after: actual != null && baseline != null && actual > baseline,
    exceeded: actual != null && baseline != null && actual > baseline + schedule.grace * 60,
  }
}

export function monthlyAttendance(memberId: string, month: string, records: AttendanceRecords, schedule: AttendanceSchedule, overrides: WorkdayOverrides, today: string) {
  let annual = 0, half = 0, official = 0, absent = 0, after = 0, exceeded = 0
  const arrivals: number[] = [], missingDates: string[] = [], pendingDates: string[] = []
  let dueDays = 0
  for (const date of monthDates(month)) {
    if (date > today) continue
    const workday = isWorkday(date, overrides)
    const record = records[date]?.[memberId] ?? EMPTY_ATTENDANCE
    if (workday && record.status !== 'holiday') dueDays++
    const timing = recordTiming(record, schedule)
    if (timing.actual != null) arrivals.push(timing.actual)
    if (timing.after) after++
    if (timing.exceeded) exceeded++
    if (workday && record.status === 'annual') annual++
    if (workday && (record.status === 'half-am' || record.status === 'half-pm')) half++
    if (workday && record.status === 'official') official++
    if (workday && record.status === 'absent') absent++
    const missing = workday && (record.status === 'unset' || (needsArrival(record.status) && timing.actual == null))
    if (missing) missingDates.push(date)
    const exception = workday && ['half-am', 'half-pm', 'official', 'absent'].includes(record.status)
    if (missing || (!record.reviewed && (timing.exceeded || exception))) pendingDates.push(date)
  }
  const scheduleMissing = timeSeconds(schedule.start) == null && dueDays > 0
  return {
    records: arrivals.length, dueDays, annual, half, official, absent, after, exceeded,
    average: arrivals.length ? arrivals.reduce((sum, value) => sum + value, 0) / arrivals.length : null,
    earliest: arrivals.length ? Math.min(...arrivals) : null,
    latest: arrivals.length ? Math.max(...arrivals) : null,
    missingDates, pendingDates, scheduleMissing,
    pending: pendingDates.length + (scheduleMissing ? 1 : 0),
  }
}
export type MonthlyAttendance = ReturnType<typeof monthlyAttendance>
