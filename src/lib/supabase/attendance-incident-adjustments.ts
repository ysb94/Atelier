import { useQuery } from '@tanstack/react-query'
import { useAuth } from './auth'
import { getSupabase } from './client'

export type AttendanceIncidentKind = 'late' | 'absent'
export type AttendanceIncidentAdjustment = {
  employee_id: string
  work_date: string
  kind: AttendanceIncidentKind
  minutes: number | null
  reason: string | null
  revision: string | null
}

export const attendanceIncidentQueryKey = ['attendance-incident-adjustments'] as const
export const attendanceIncidentConfirmationKey = ['attendance-incident-confirmations'] as const

type AttendanceIncidentConfirmation = Pick<AttendanceIncidentAdjustment, 'employee_id' | 'work_date' | 'kind'> & {
  confirmed_at: string
}

export function useAttendanceIncidentConfirmations(from: string, to: string) {
  const { session, profile } = useAuth()
  const userId = session?.user.id
  return useQuery({
    queryKey: [...attendanceIncidentConfirmationKey, userId, profile?.id, from, to],
    enabled: Boolean(userId && from && to),
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('list_attendance_incident_confirmations', { p_from: from, p_to: to })
      if (error && ['PGRST202', '42883'].includes(error.code)) return { supported: false, rows: [] as AttendanceIncidentConfirmation[] }
      if (error) throw new Error('근태 확인 기록을 불러오지 못했습니다.')
      return { supported: true, rows: (data ?? []) as AttendanceIncidentConfirmation[] }
    },
  })
}

export async function confirmAttendanceIncident(employeeId: string, date: string, kind: AttendanceIncidentKind) {
  const { error } = await getSupabase().rpc('confirm_attendance_incident', {
    p_employee: employeeId, p_date: date, p_kind: kind,
  })
  if (error) throw new Error(error.message || '확인 상태를 저장하지 못했습니다.')
}

export async function listAttendanceIncidentAdjustments(from: string, to: string, employeeId?: string) {
  const { data, error } = await getSupabase().rpc('list_attendance_incident_adjustments', {
    p_from: from, p_to: to, p_employee: employeeId ?? null,
  })
  if (error && ['PGRST202', '42883'].includes(error.code)) {
    return { supported: false, rows: [] as AttendanceIncidentAdjustment[] }
  }
  if (error) throw new Error('근태 보정 내역을 불러오지 못했습니다.')
  return { supported: true, rows: (data ?? []) as AttendanceIncidentAdjustment[] }
}

export function useAttendanceIncidentAdjustments(from: string, to: string, employeeId?: string, enabled = true, refetchInterval?: number) {
  const { session, profile } = useAuth()
  const userId = session?.user.id
  return useQuery({
    queryKey: [...attendanceIncidentQueryKey, userId, profile?.id, from, to, employeeId],
    enabled: enabled && Boolean(userId && from && to),
    queryFn: () => listAttendanceIncidentAdjustments(from, to, employeeId),
    refetchInterval: enabled ? refetchInterval : false,
  })
}

export async function saveAttendanceIncidentAdjustment(
  employeeId: string, date: string, kind: AttendanceIncidentKind,
  minutes: number | null, reason: string, revision: string | null,
) {
  const { error } = await getSupabase().rpc('save_attendance_incident_adjustment', {
    p_employee: employeeId, p_date: date, p_kind: kind,
    p_minutes: minutes, p_reason: reason, p_revision: revision,
  })
  if (error) throw new Error(error.message || '근태 보정을 저장하지 못했습니다.')
}
