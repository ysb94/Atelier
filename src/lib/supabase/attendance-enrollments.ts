import { getSupabase } from './client'
import { diagnosticQuery } from './diagnostic-query'

export type AttendanceEnrollment = { employeeId: string; startsOn: string }

export async function listAttendanceEnrollments(): Promise<AttendanceEnrollment[]> {
  try {
    return await diagnosticQuery<AttendanceEnrollment[]>('app', 'attendance_enrollment_load', getSupabase().rpc('list_attendance_enrollments')) ?? []
  } catch (error) {
    throw new Error('승인 기준 근태 집계 시작일을 불러오지 못했습니다. 다시 조회해 주세요.', { cause: error })
  }
}
