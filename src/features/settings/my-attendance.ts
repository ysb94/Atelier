import type { PersonalRequest } from './personal-requests'

export type AttendanceClock = { date: string; clockIn: string; clockOutAt: string | null }
export type AttendanceDay = AttendanceClock & { leaves: PersonalRequest[]; future: boolean }
const koreaDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' })
const koreaTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

export function koreaDateKey(date = new Date()): string {
  const parts = koreaDate.formatToParts(date)
  const part = (name: string) => parts.find(item => item.type === name)!.value
  return `${part('year')}-${part('month')}-${part('day')}`
}
export function clockOutLabel(value: string | null): string { return value ? koreaTime.format(new Date(value)) : '' }
export function validAttendanceMonth(month: string): boolean { return /^(19\d{2}|[2-9]\d{3})-(0[1-9]|1[0-2])$/.test(month) }
export function attendanceMonthDates(month: string): string[] {
  if (!validAttendanceMonth(month)) throw new Error('조회할 월을 확인해 주세요.')
  const [year, number] = month.split('-').map(Number)
  return Array.from({ length: new Date(Date.UTC(year, number, 0)).getUTCDate() }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`)
}
export function buildMyAttendance(month: string, clocks: AttendanceClock[], requests: PersonalRequest[], today: string): AttendanceDay[] {
  const index = new Map(clocks.map(clock => [clock.date, clock]))
  const leaves = requests.filter(request => request.status === 'approved' && ['annual', 'half', 'quarter'].includes(request.kind))
  return attendanceMonthDates(month).map(date => ({
    ...(index.get(date) ?? { date, clockIn: '', clockOutAt: null }),
    leaves: leaves.filter(request => request.from <= date && date <= request.to),
    future: date > today,
  }))
}
