import type { AttendanceClock } from '../settings/my-attendance'
type Request = { kind: string; status: string; from: string; to: string }

/** Only an unfinished shift can continue into the next morning. A recorded checkout ends it. */
export function continuingOvertimeClock(rows: readonly AttendanceClock[], requests: readonly Request[], today: string, start: string | null | undefined, now = Date.now()) {
  const limit = start ? Date.parse(`${today}T${start}:00+09:00`) : NaN
  if (!Number.isFinite(limit) || now >= limit) return null
  const yesterday = new Date(Date.parse(`${today}T12:00:00+09:00`) - 86_400_000).toISOString().slice(0, 10)
  if (!requests.some(r => r.kind === 'overtime' && ['pending', 'approved'].includes(r.status) && r.from === yesterday && r.to === yesterday)) return null
  return rows.find(row => row.date === yesterday && !row.clockOutAt && !row.autoClosedAt) ?? null
}
