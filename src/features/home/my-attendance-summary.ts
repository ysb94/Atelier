import { isWorkday, timeSeconds } from '../operations-support/monthly-attendance.ts'
import type { OvertimeActual } from '../operations-support/overtime-actuals.ts'
import { monthlyOvertimeHours } from '../operations-support/overtime-hours.ts'
import type { AttendanceClock } from '../settings/my-attendance.ts'
import type { PersonalRequest } from '../settings/personal-requests.ts'
import { offsiteWorkdayStart } from '../operations-support/offsite-workday-start.ts'

/** 근무일이고 출근 기준+유예보다 늦은 기록 수. 기준이 없으면 null. */
export function countMyLateDays(clocks: readonly { date: string; clockIn: string }[], start: string, grace: number, today: string, requests: readonly PersonalRequest[] = []): number | null {
  const baseline = timeSeconds(start)
  if (baseline == null) return null
  let count = 0
  for (const clock of clocks) {
    if (clock.date > today || !isWorkday(clock.date, {})) continue
    const actual = timeSeconds(clock.clockIn)
    const limit = (timeSeconds(offsiteWorkdayStart(requests, clock.date) ?? start) ?? baseline) + grace * 60
    if (actual != null && actual > limit) count += 1
  }
  return count
}

/** 승인된 야근의 실제 입력을 운영지원과 같은 기준으로 합산한다. */
export function actualOvertimeHours(clocks: readonly AttendanceClock[], requests: readonly PersonalRequest[], lunchStart: string, lunchEnd: string, month: string, today: string, start: string, actuals: readonly OvertimeActual[] = []): number | null {
  const rows = monthlyOvertimeHours(
    clocks.map(clock => ({ ...clock, employeeId: 'self' })),
    requests.map(request => ({ ...request, employeeId: 'self' })),
    lunchStart, lunchEnd, month, today, new Map([['self', start]]), actuals,
  )
  if (rows[0]?.unconfiguredDays) return null
  return (rows[0]?.extraMinutes ?? 0) / 60
}
