// Actual attendance tracking started on this date. Earlier source records remain intact.
export const ATTENDANCE_TRACKING_START = '2026-11-02'

export function attendanceTrackingStart(hireDate?: string | null, managedFrom?: string | null) {
  let start = ATTENDANCE_TRACKING_START
  for (const input of [hireDate, managedFrom]) {
    const value = input?.trim() ?? ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) continue
    const parsed = new Date(`${value}T00:00:00Z`)
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value && value > start) start = value
  }
  return start
}
