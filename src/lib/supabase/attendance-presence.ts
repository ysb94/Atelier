import { getSupabase } from './client'

export type AttendancePresence = {
  serverNow: string
  state: 'inactive' | 'unconfigured' | 'scheduled' | 'awaiting_delivery' | 'waiting' | 'auto_closed' | 'clocked_out'
  clockDate?: string
  autoClosedAt?: string | null
  lastConfirmedAt?: string | null
  missedCount?: number
  nextPromptAt?: string | null
  check?: { id: string; dueAt: string; deliveredAt: string | null; deadlineAt: string | null } | null
}

export async function attendancePresence(action: 'poll' | 'present' | 'continue' | 'clock_out' = 'poll', checkId?: string): Promise<AttendancePresence> {
  const { data, error } = await getSupabase().rpc('my_attendance_presence', { p_action: action, p_check_id: checkId ?? null })
  if (error) {
    console.warn('[attendance-presence] 근무 확인 처리 실패', { action, checkId, error })
    throw new Error(error.message)
  }
  return data as AttendancePresence
}
