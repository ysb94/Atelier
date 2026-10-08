import { getSupabase } from './client'
import type { AttendanceStartSetting } from '@/features/operations-support/attendance-start-settings'

type SettingRow = { id: string; month: string; department_id: string | null; employee_id: string | null; source: 'department' | 'individual'; start_time: string | null; grace_minutes: number }
export async function listAttendanceStartSettings(): Promise<AttendanceStartSetting[]> {
  const settings: AttendanceStartSetting[] = []
  for (let offset=0; ; offset+=500) {
    const { data, error } = await getSupabase().from('attendance_start_settings').select('id,month,department_id,employee_id,source,start_time,grace_minutes').order('month').order('id').range(offset,offset+499)
    if (error) { console.warn('[attendance-start] 출근시간 조회 실패', error); throw new Error(error.message) }
    settings.push(...(data as SettingRow[]).map(row => ({ id: row.id, month: row.month.slice(0,7), departmentId: row.department_id, employeeId: row.employee_id, source: row.source, start: row.start_time?.slice(0,5) ?? '', grace: row.grace_minutes })))
    if (data.length<500) return settings
  }
}
export type SaveAttendanceStart = { month: string; until: string; departmentId: string | null; employeeId: string | null; start: string | null; grace: number }
export async function saveAttendanceStartSettings(input: SaveAttendanceStart): Promise<number> {
  const { data, error } = await getSupabase().rpc('save_attendance_start_settings', {
    p_month: `${input.month}-01`, p_until: `${input.until}-01`, p_department_id: input.departmentId,
    p_employee_id: input.employeeId, p_start: input.start, p_grace: input.grace,
  })
  if (error) { console.warn('[attendance-start] 출근시간 저장 실패', error); throw new Error(error.message) }
  return data as number
}
