import { attendanceStartIndex, resolveAttendanceStart, type AttendanceStartSetting } from '@/features/operations-support/attendance-start-settings'
import { getSupabase } from './client'

export type MyAttendanceBasis = {
  departmentId: string | null
  baseAnnualLeave: number | null
  additionalAnnualLeave: number | null
  remainingAnnualLeave: number | null
  start: string
  grace: number
  configured: boolean
}
type BasisSetting = {
  id: string
  month: string
  departmentId: string | null
  employeeId: string | null
  source: 'department' | 'individual'
  start: string | null
  grace: number
}
type BasisPayload = {
  departmentId: string | null
  baseAnnualLeave?: number | string | null
  additionalAnnualLeave?: number | string | null
  remainingAnnualLeave: number | string | null
  settings: BasisSetting[]
}

function leaveDays(value: number | string | null | undefined): number | null {
  if (value == null || value === '') return null
  const days = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(days) ? days : null
}

/** 본인 출근 기준과 남은 연차. 다른 직원 정보는 함수가 반환하지 않는다. */
export async function getMyAttendanceBasis(userId: string, month: string): Promise<MyAttendanceBasis> {
  const { data, error } = await getSupabase().rpc('get_my_attendance_basis', { p_month: `${month}-01` })
  if (error) { console.warn('[attendance-basis] 본인 근태 기준 조회 실패', { month, error }); throw new Error(error.message) }
  const payload = data as BasisPayload
  const settings: AttendanceStartSetting[] = (payload.settings ?? []).map(row => ({
    id: row.id,
    month: String(row.month).slice(0, 7),
    departmentId: row.departmentId,
    employeeId: row.employeeId,
    source: row.source,
    start: row.start?.slice(0, 5) ?? '',
    grace: row.grace,
  }))
  const resolved = resolveAttendanceStart(attendanceStartIndex(settings), userId, payload.departmentId, month)
  return {
    departmentId: payload.departmentId,
    baseAnnualLeave: leaveDays(payload.baseAnnualLeave),
    additionalAnnualLeave: leaveDays(payload.additionalAnnualLeave),
    remainingAnnualLeave: leaveDays(payload.remainingAnnualLeave),
    start: resolved.start,
    grace: resolved.grace,
    configured: resolved.configured,
  }
}
