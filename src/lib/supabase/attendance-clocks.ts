import { getSupabase } from './client'
import { attendanceMonthDates, type AttendanceClock } from '@/features/settings/my-attendance'

type ClockRow = { work_date: string; clock_in: string; clock_out_at: string | null }
export async function listMyAttendanceClocks(employeeId: string, month?: string): Promise<AttendanceClock[]> {
  if (!employeeId) throw new Error('로그인 상태를 확인해 주세요.')
  let query = getSupabase().from('attendance_clock_ins').select('work_date,clock_in,clock_out_at')
    .eq('employee_id', employeeId).order('work_date', { ascending: false })
  if (month) {
    const dates = attendanceMonthDates(month)
    query = query.gte('work_date', dates[0]).lte('work_date', dates[dates.length - 1])
  } else query = query.limit(400)
  const { data, error } = await query
  if (error) { console.warn('[attendance-clock] 내 출퇴근 기록 조회 실패', { month, error }); throw new Error(error.message) }
  return ((data ?? []) as ClockRow[]).map(row => ({ date: row.work_date, clockIn: row.clock_in.slice(0, 5), clockOutAt: row.clock_out_at }))
}
export async function clockOutToday(): Promise<string> {
  const { data, error } = await getSupabase().rpc('clock_out_today')
  if (error) { console.warn('[attendance-clock] 퇴근 기록 실패', error); throw new Error(error.message) }
  return String(data)
}
export async function undoClockOutToday(): Promise<void> {
  const { error } = await getSupabase().rpc('undo_clock_out_today')
  if (error) { console.warn('[attendance-clock] 퇴근 취소 실패', error); throw new Error(error.message) }
}
