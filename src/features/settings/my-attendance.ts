import type { PersonalRequest } from './personal-requests'

export type AttendanceClock = { date: string; clockIn: string; clockOutAt: string | null; clockOutReportedAt?: string | null; autoClosedAt?: string | null; workConfirmedAt?: string | null }
export type AttendanceDay = AttendanceClock & { requests: PersonalRequest[]; correction: PersonalRequest | null; future: boolean }
export type DayClock = { start: string; end: string; corrected: boolean }
const koreaDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' })
const koreaTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

export function koreaDateKey(date = new Date()): string {
  const parts = koreaDate.formatToParts(date)
  const part = (name: string) => parts.find(item => item.type === name)!.value
  return `${part('year')}-${part('month')}-${part('day')}`
}
export function clockOutLabel(value: string | null, workDate?: string): string {
  if (!value) return ''
  const stamp = new Date(value), time = koreaTime.format(stamp), date = koreaDateKey(stamp)
  if (!workDate || date <= workDate) return time
  return `${date} ${time}`
}
export function validAttendanceMonth(month: string): boolean { return /^(19\d{2}|[2-9]\d{3})-(0[1-9]|1[0-2])$/.test(month) }
export function attendanceMonthDates(month: string): string[] {
  if (!validAttendanceMonth(month)) throw new Error('조회할 월을 확인해 주세요.')
  const [year, number] = month.split('-').map(Number)
  return Array.from({ length: new Date(Date.UTC(year, number, 0)).getUTCDate() }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`)
}
export function buildMyAttendance(month: string, clocks: AttendanceClock[], requests: PersonalRequest[], today: string): AttendanceDay[] {
  const index = new Map(clocks.map(clock => [clock.date, clock]))
  const corrections = requests.filter(request => request.kind === 'correction' && request.status === 'approved')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return attendanceMonthDates(month).map(date => ({
    ...(index.get(date) ?? { date, clockIn: '', clockOutAt: null }),
    requests: requests.filter(request => request.from <= date && date <= request.to),
    correction: corrections.find(request => request.from === date) ?? null,
    future: date > today,
  }))
}
/** 승인된 정정은 표시에만 덮어쓴다. 출퇴근 원본은 바꾸지 않는다. */
export function dayClock(day: AttendanceDay): DayClock {
  if (day.correction) return { start: day.correction.start, end: day.correction.end, corrected: true }
  if (!day.clockOutAt && day.autoClosedAt) return { start: day.clockIn, end: '자동 퇴근 · 확인 필요', corrected: false }
  return { start: day.clockIn, end: clockOutLabel(day.clockOutAt, day.date), corrected: false }
}
