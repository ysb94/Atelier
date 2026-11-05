// Actual attendance tracking started on this date. Earlier source records remain intact.
export const ATTENDANCE_TRACKING_START = '2026-11-02'

export function attendanceTrackingStart(hireDate?: string | null) {
  const value = hireDate?.trim() ?? ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return ATTENDANCE_TRACKING_START
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return ATTENDANCE_TRACKING_START
  return value > ATTENDANCE_TRACKING_START ? value : ATTENDANCE_TRACKING_START
}
