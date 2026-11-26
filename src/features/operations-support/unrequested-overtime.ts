import { workdayGuidance, workInstant } from '../home/attendance-guidance.ts'
import { koreaDateKey } from '../settings/my-attendance.ts'
import type { CompanyAttendanceSpan } from '../../lib/supabase/attendance-clocks.ts'
import type { LeaveRequest } from '../../lib/supabase/leave-requests.ts'
import type { OrgChartMember } from '../../lib/supabase/profiles.ts'
import { attendanceTrackingStart } from './attendance-period.ts'
import { attendanceStartIndex, resolveAttendanceStart } from './attendance-start-settings.ts'
import { isWorkday } from './monthly-attendance.ts'

const minuteMs = 60_000
const dayMs = 24 * 60 * minuteMs

export type UnrequestedOvertimeEntry = { date: string; expectedEnd: string; checkoutAt: string; minutes: number }
type Employee = Pick<OrgChartMember, 'id' | 'departmentId' | 'hireDate' | 'attendanceTrackedFrom' | 'attendanceExempt'>

export function unrequestedOvertime(
  clocks: readonly CompanyAttendanceSpan[], members: readonly Employee[], requests: readonly LeaveRequest[],
  schedules: ReturnType<typeof attendanceStartIndex>, lunch: { start: string; end: string }, month: string, now: number,
) {
  const byEmployee = new Map<string, UnrequestedOvertimeEntry[]>()
  const employees = new Map(members.filter(member => !member.attendanceExempt).map(member => [member.id, member]))
  const requestsByEmployee = new Map<string, LeaveRequest[]>()
  const today = koreaDateKey(new Date(now))
  for (const request of requests) {
    const employeeRequests = requestsByEmployee.get(request.employeeId) ?? []
    employeeRequests.push(request)
    requestsByEmployee.set(request.employeeId, employeeRequests)
  }

  for (const clock of clocks) {
    const { date, employeeId, clockOutAt, clockOutSource } = clock
    const employee = employees.get(employeeId)
    if (!employee || !date.startsWith(`${month}-`) || date > today || !isWorkday(date, {}) ||
      date < attendanceTrackingStart(employee.hireDate, employee.attendanceTrackedFrom)) continue
    if (!clockOutAt || (clockOutSource !== 'manual' && clockOutSource !== 'correction')) continue
    const checkin = workInstant(date, clock.clockIn)
    const checkout = Date.parse(clockOutAt)
    const midnight = workInstant(date, '00:00')
    if (checkin === null || midnight === null || !Number.isFinite(checkout) || checkout > now) continue
    const dailyRequests = (requestsByEmployee.get(employeeId) ?? []).filter(request => request.from <= date && request.to >= date)
    if (dailyRequests.some(request => request.kind === 'overtime' ||
      (request.kind === 'offsite' && request.status === 'approved'))) continue
    const basis = resolveAttendanceStart(schedules, employeeId, employee.departmentId, month)
    const { end } = workdayGuidance(date, { ...basis, date, lunchStart: lunch.start, lunchEnd: lunch.end }, dailyRequests)
    if (end === null) continue

    // A weekday checkout can cross midnight. Time from a holiday onward uses the separate holiday process.
    let countedEnd = checkout
    for (let boundary = midnight + dayMs; boundary < checkout; boundary += dayMs) {
      if (isWorkday(koreaDateKey(new Date(boundary)), {})) continue
      countedEnd = boundary
      break
    }
    const countedStart = Math.max(end, checkin)
    const lunchStart = workInstant(date, lunch.start)
    const lunchEnd = workInstant(date, lunch.end)
    if (lunchStart === null || lunchEnd === null) continue
    const overlap = Math.max(0, Math.min(countedEnd, lunchEnd) - Math.max(countedStart, lunchStart))
    const minutes = Math.floor((countedEnd - countedStart - overlap) / minuteMs)
    if (minutes <= 0) continue
    const entries = byEmployee.get(employeeId) ?? []
    entries.push({ date, expectedEnd: new Date(end).toISOString(), checkoutAt: clockOutAt, minutes })
    byEmployee.set(employeeId, entries)
  }
  return byEmployee
}
