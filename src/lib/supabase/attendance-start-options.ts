import { getSupabase } from './client'

type OptionRow = { start_time: string }

export async function listAttendanceStartOptions(): Promise<string[]> {
  const { data, error } = await getSupabase().from('attendance_start_options').select('start_time').order('start_time')
  if (error) {
    console.warn('[attendance-start] 출근시간 목록 조회 실패', error)
    throw new Error(error.message)
  }
  return ((data ?? []) as OptionRow[]).map(row => row.start_time.slice(0, 5))
}

export async function addAttendanceStartOption(start: string) {
  const { error } = await getSupabase().rpc('add_attendance_start_option', { p_start: start })
  if (error) {
    console.warn('[attendance-start] 출근시간 추가 실패', error)
    throw new Error(error.message)
  }
}

export async function removeAttendanceStartOption(start: string) {
  const { error } = await getSupabase().rpc('remove_attendance_start_option', { p_start: start })
  if (error) {
    console.warn('[attendance-start] 출근시간 삭제 실패', error)
    throw new Error(error.message)
  }
}
