import { isWorkday, timeSeconds } from '../operations-support/monthly-attendance.ts'
import { minuteOf, type PersonalRequest } from '../settings/personal-requests.ts'

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

/** 해당 월에 승인된 야근 신청 시간의 합. */
export function approvedOvertimeHours(requests: readonly PersonalRequest[], month: string): number {
  let minutes = 0
  for (const request of requests) {
    if (request.kind !== 'overtime' || request.status !== 'approved' || !request.from.startsWith(month)) continue
    const start = minuteOf(request.start)
    const end = minuteOf(request.end)
    if (start == null || end == null || end <= start) continue
    minutes += end - start
  }
  return minutes / 60
}
