export const SUGGESTED_START = '10:00'
export const ATTENDANCE_GRACE_MINUTES = 5
export const FALLBACK_START_OPTIONS = ['09:00', '10:00']

export function startOptionLabel(start: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(start)
  if (!match) return start
  return match[2] === '00' ? `${Number(match[1])}시` : start
}
export function startTone(start: string) {
  if (start === '09:00') return { tone: 'is-nine', label: '9시' }
  if (start === '10:00') return { tone: 'is-ten', label: '10시' }
  if (start) return { tone: 'is-custom', label: start }
  return { tone: 'is-unset', label: '미설정' }
}
export function forgivenClock(start: string, grace: number) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(start)
  if (!match) return ''
  const total = Number(match[1]) * 60 + Number(match[2]) + grace
  if (total >= 24 * 60) return ''
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
export type AttendanceStartSetting = {
  id: string; month: string; departmentId: string | null; employeeId: string | null
  source: 'department' | 'individual'; start: string; grace: number
}
export function attendanceStartIndex(settings: AttendanceStartSetting[]) {
  return new Map(settings.map(item => [`${item.month}:${item.employeeId ? `employee:${item.employeeId}` : `department:${item.departmentId}`}`, item]))
}
export function resolveAttendanceStart(index: ReturnType<typeof attendanceStartIndex>, employeeId: string, departmentId: string | null, month: string) {
  const setting = index.get(`${month}:employee:${employeeId}`) ?? index.get(`${month}:department:${departmentId}`)
  return { start: setting?.start ?? '', grace: ATTENDANCE_GRACE_MINUTES, source: setting?.source ?? 'department', configured: Boolean(setting?.start) }
}
