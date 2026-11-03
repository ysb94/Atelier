import { workdayGuidance, workInstant } from '../home/attendance-guidance.ts'
import { clockOutLabel } from '../settings/my-attendance.ts'
import type { LeaveRequest } from '../../lib/supabase/leave-requests.ts'
import { resolveAttendanceStart, type attendanceStartIndex } from './attendance-start-settings.ts'
import { isWorkday, monthDates } from './monthly-attendance.ts'

function registeredMinutes(date: string, from: number, to: number, lunch: { start: string; end: string }) {
  if (to <= from) return 0
  let duration = to - from
  const lunchStart = workInstant(date, lunch.start), lunchEnd = workInstant(date, lunch.end)
  if (lunchStart != null && lunchEnd != null && lunchEnd > lunchStart) {
    for (let start = lunchStart, end = lunchEnd; start < to; start += 86_400_000, end += 86_400_000) {
      duration -= Math.max(0, Math.min(to, end) - Math.max(from, start))
    }
  }
  return Math.max(0, Math.floor(duration / 60_000))
}

/** 외근 등록 구간 중 예정 퇴근 이후 시간. 실제 야근 입력/급여 누적과는 별개다. */
export function offsiteExtraHours(request: LeaveRequest, month: string, starts: ReturnType<typeof attendanceStartIndex>, lunch: { start: string; end: string }, leaves: readonly LeaveRequest[], departmentId = request.departmentId) {
  const dates = monthDates(month).filter(date => request.from <= date && date <= request.to
    && (request.from === request.to || isWorkday(date, {})))
  const baselines = new Set<string>()
  let minutes = 0
  if (request.kind !== 'offsite' || request.status !== 'approved') return { minutes: null, days: dates.length, baseline: '—' }
  const employeeLeaves = leaves.filter(leave => leave.employeeId === request.employeeId && leave.kind !== 'overtime')
  for (const date of dates) {
    const from = workInstant(date, request.start)
    const sameDayEnd = workInstant(date, request.end)
    if (from == null || sameDayEnd == null) return { minutes: null, days: dates.length, baseline: '시간 확인 필요' }
    const to = sameDayEnd + (request.endNextDay ? 86_400_000 : 0)
    if (to <= from) return { minutes: null, days: dates.length, baseline: '시간 확인 필요' }
    const holiday = !isWorkday(date, {})
    const schedule = resolveAttendanceStart(starts, request.employeeId, departmentId, date.slice(0, 7))
    const guidance = workdayGuidance(date, { date, start: schedule.start, configured: schedule.configured, lunchStart: lunch.start, lunchEnd: lunch.end }, employeeLeaves)
    if (holiday || guidance.fullLeave) {
      baselines.add(holiday ? '휴일' : '전일 휴가')
      minutes += registeredMinutes(date, from, to, lunch)
    } else {
      if (guidance.start == null || guidance.end == null) return { minutes: null, days: dates.length, baseline: '기준 미설정' }
      baselines.add(`${clockOutLabel(new Date(guidance.start).toISOString())}–${clockOutLabel(new Date(guidance.end).toISOString(), date)}`)
      minutes += registeredMinutes(date, Math.max(from, guidance.end), to, lunch)
    }
  }
  return { minutes, days: dates.length, baseline: [...baselines].join(' / ') || '해당 월 근무일 없음' }
}
