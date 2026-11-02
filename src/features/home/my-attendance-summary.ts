import { isWorkday, timeSeconds } from '../operations-support/monthly-attendance.ts'
import { monthlyOvertimeHours } from '../operations-support/overtime-hours.ts'
import type { AttendanceClock } from '../settings/my-attendance.ts'
import type { PersonalRequest } from '../settings/personal-requests.ts'

/** 근무일이고 출근 기준+유예보다 늦은 기록 수. 기준이 없으면 null. */
export function countMyLateDays(clocks: readonly { date: string; clockIn: string }[], start: string, grace: number, today: string): number | null {
  const baseline = timeSeconds(start)
  if (baseline == null) return null
  const limit = baseline + grace * 60
  let count = 0
  for (const clock of clocks) {
    if (clock.date > today || !isWorkday(clock.date, {})) continue
    const actual = timeSeconds(clock.clockIn)
    if (actual != null && actual > limit) count += 1
  }
  return count
}

/** 본인 출퇴근 기록을 운영지원과 같은 기준으로 집계한다. 퇴근 미기록은 제외한다. */
export function actualOvertimeHours(clocks: readonly AttendanceClock[], requests: readonly PersonalRequest[], lunchStart: string, lunchEnd: string, month: string, today: string): number {
  const rows = monthlyOvertimeHours(
    clocks.map(clock => ({ ...clock, employeeId: 'self' })),
    requests.map(request => ({ ...request, employeeId: 'self' })),
    lunchStart, lunchEnd, month, today,
  )
  return (rows[0]?.extraMinutes ?? 0) / 60
}
