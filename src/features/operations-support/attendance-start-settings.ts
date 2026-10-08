export type AttendanceStartSetting = {
  id: string; month: string; departmentId: string | null; employeeId: string | null
  source: 'department' | 'individual'; start: string; grace: number
}
export function attendanceStartIndex(settings: AttendanceStartSetting[]) {
  return new Map(settings.map(item => [`${item.month}:${item.employeeId ? `employee:${item.employeeId}` : `department:${item.departmentId}`}`, item]))
}
export function resolveAttendanceStart(index: ReturnType<typeof attendanceStartIndex>, employeeId: string, departmentId: string | null, month: string) {
  const setting = index.get(`${month}:employee:${employeeId}`) ?? index.get(`${month}:department:${departmentId}`)
  return { start: setting?.start ?? '', grace: setting?.grace ?? 5, source: setting?.source ?? 'department', configured: Boolean(setting?.start) }
}
