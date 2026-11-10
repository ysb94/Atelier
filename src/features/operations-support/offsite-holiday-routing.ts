import type { PersonalRequest } from '../settings/personal-requests.ts'
import { isWorkday } from './monthly-attendance.ts'
import { offsiteEnd } from './offsite-period.ts'

type OffsiteSpan = Pick<PersonalRequest,'id'|'kind'|'from'|'to'|'start'|'end'|'endNextDay'|'offsiteContinuous'>
/** Classify the whole actual span, even when its holiday is in another month. */
export function firstOffsiteHoliday(request: OffsiteSpan): string | null {
  if (request.kind !== 'offsite' || (!request.offsiteContinuous && request.from !== request.to)) return null
  const start = Date.parse(`${request.from}T${request.start}:00+09:00`), end = offsiteEnd(request)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
  for (let stamp = Date.parse(`${request.from}T00:00:00+09:00`); stamp < end; stamp += 86_400_000) {
    const day = new Date(stamp + 9*3_600_000).toISOString().slice(0,10)
    if (stamp + 86_400_000 > start && !isWorkday(day, {})) return day
  }
  return null
}
export function holidayOffsiteHref(request: OffsiteSpan) {
  return `/operations-support/attendance?attendanceView=holiday&holidayMonth=${request.from.slice(0,7)}&offsiteCase=${encodeURIComponent(request.id)}`
}
