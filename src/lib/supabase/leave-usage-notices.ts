import { getSupabase } from './client'

export const LEAVE_NOTICE_PHASES = ['threeMonths', 'oneMonth', 'twoWeeks'] as const
export type BaseLeaveNoticePhase = typeof LEAVE_NOTICE_PHASES[number]
export type LeaveNoticePhase = BaseLeaveNoticePhase | 'registered' | 'oneWeek'
export const LEAVE_NOTICE_LABELS: Record<LeaveNoticePhase, string> = { threeMonths: '3개월 전', oneMonth: '1개월 전', twoWeeks: '2주 전', registered: '등록 안내', oneWeek: '1주일 전' }
export type LeaveNoticeSource = 'base' | 'extra' | 'birthday'
export type LeaveUsageNotice = {
  id: string; company_id: string; employee_id: string; recipient_name: string; hire_date: string
  reset_date: string; expires_on: string; phase: LeaveNoticePhase; scheduled_on: string
  remaining_days: number; title: string; body: string; issued_at: string
  read_at: string | null; viewed_at: string | null; confirmed_at: string | null
  notice_source?: LeaveNoticeSource; grant_id?: string; grant_version?: number; reason?: string
  granted_days?: number; reserved_days?: number; invalidated_at?: string | null
}
export type LeaveNoticeEmployee = {
  id: string; display_name: string; department: string; hire_date: string | null; reset_date: string | null
  remaining_days: number | null; balance_current: boolean; resigned_on: string | null
}
export type ExtraNoticeGrant = { id: string; employee_id: string; notice_source: 'extra' | 'birthday'; days: number; starts_on: string; expires_on: string; reason: string; version: number; available: number; reserved: number; deleted_at: string | null; created_on: string; updated_on: string }
export type LeaveNoticeManagement = { today: string; enabled: boolean; employees: LeaveNoticeEmployee[]; notices: LeaveUsageNotice[]; extraEnabled?: boolean; extraGrants?: ExtraNoticeGrant[]; extraNotices?: LeaveUsageNotice[] }
const COLUMNS = 'id,company_id,employee_id,recipient_name,hire_date,reset_date,expires_on,phase,scheduled_on,remaining_days,title,body,issued_at,read_at,viewed_at,confirmed_at'

export async function listMyLeaveUsageNotices(employeeId: string) {
  const [{ data, error }, extra] = await Promise.all([
    getSupabase().from('leave_usage_notices').select(COLUMNS).eq('employee_id', employeeId).order('issued_at', { ascending: false }),
    getSupabase().rpc('list_my_extra_leave_notices'),
  ])
  if (error) throw new Error(`연차 안내를 불러오지 못했습니다. ${error.message}`)
  if (extra.error && !['PGRST202', '42883'].includes(extra.error.code)) throw new Error(`추가 연차 안내를 불러오지 못했습니다. ${extra.error.message}`)
  return [...data as LeaveUsageNotice[], ...((extra.data ?? []) as LeaveUsageNotice[])].sort((a, b) => b.issued_at.localeCompare(a.issued_at))
}
export async function recordLeaveUsageNotice(id: string | null, action: 'read' | 'view' | 'confirm', source: LeaveNoticeSource = 'base') {
  const { error } = await getSupabase().rpc(source === 'base' ? 'record_leave_usage_notice' : 'record_extra_leave_notice', { p_id: id, p_action: action })
  if (error) throw new Error(error.message)
}
export async function getLeaveNoticeManagement() {
  let { data, error } = await getSupabase().rpc('leave_notice_management_v2')
  if (error && ['PGRST202', '42883'].includes(error.code)) ({ data, error } = await getSupabase().rpc('leave_usage_notice_management'))
  if (error) throw new Error(`발송·확인 기록을 불러오지 못했습니다. ${error.message}`)
  const payload = data as LeaveNoticeManagement
  return { ...payload, notices: [...payload.notices, ...(payload.extraNotices ?? [])].sort((a, b) => b.issued_at.localeCompare(a.issued_at)) }
}
