import { getSupabase } from './client'

export const LEAVE_NOTICE_PHASES = ['threeMonths', 'oneMonth', 'twoWeeks'] as const
export type LeaveNoticePhase = typeof LEAVE_NOTICE_PHASES[number]
export const LEAVE_NOTICE_LABELS: Record<LeaveNoticePhase, string> = { threeMonths: '3개월 전', oneMonth: '1개월 전', twoWeeks: '2주 전' }
export type LeaveUsageNotice = {
  id: string; company_id: string; employee_id: string; recipient_name: string; hire_date: string
  reset_date: string; expires_on: string; phase: LeaveNoticePhase; scheduled_on: string
  remaining_days: number; title: string; body: string; issued_at: string
  read_at: string | null; viewed_at: string | null; confirmed_at: string | null
}
export type LeaveNoticeEmployee = {
  id: string; display_name: string; department: string; hire_date: string | null; reset_date: string | null
  remaining_days: number | null; balance_current: boolean; resigned_on: string | null
}
export type LeaveNoticeManagement = { today: string; enabled: boolean; employees: LeaveNoticeEmployee[]; notices: LeaveUsageNotice[] }
const COLUMNS = 'id,company_id,employee_id,recipient_name,hire_date,reset_date,expires_on,phase,scheduled_on,remaining_days,title,body,issued_at,read_at,viewed_at,confirmed_at'

export async function listMyLeaveUsageNotices(employeeId: string) {
  const { data, error } = await getSupabase().from('leave_usage_notices').select(COLUMNS).eq('employee_id', employeeId).order('issued_at', { ascending: false })
  if (error) throw new Error(`연차 안내를 불러오지 못했습니다. ${error.message}`)
  return data as LeaveUsageNotice[]
}
export async function recordLeaveUsageNotice(id: string | null, action: 'read' | 'view' | 'confirm') {
  const { error } = await getSupabase().rpc('record_leave_usage_notice', { p_id: id, p_action: action })
  if (error) throw new Error(error.message)
}
export async function getLeaveNoticeManagement() {
  const { data, error } = await getSupabase().rpc('leave_usage_notice_management')
  if (error) throw new Error(`발송·확인 기록을 불러오지 못했습니다. ${error.message}`)
  return data as LeaveNoticeManagement
}
