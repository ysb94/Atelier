import type { DiagnosticContext } from '@/lib/diagnostics/workflow-trace'
import { diagnosticQuery } from './diagnostic-query'
import { getSupabase } from './client'

export type LogisticsEmployee = { id: string; name: string; hireDate: string | null }
export type LogisticsLeaveKind = 'annual' | 'half' | 'quarter' | 'official' | 'other'
export type LogisticsRecord = {
  id: string; employee_id: string; employee_name: string; kind: 'work' | 'leave'; from_date: string; to_date: string
  started_at: string | null; ended_at: string | null; break_minutes: number; leave_kind: LogisticsLeaveKind | null; leave_days: number | null
  note: string; version: number; cancelled_at: string | null; updated_at: string
}
export type LogisticsRecordInput = {
  id: string; employeeId: string; kind: 'work' | 'leave'; from: string; to: string; startedAt: string | null; endedAt: string | null
  breakMinutes: number; leaveKind: LogisticsLeaveKind | null; leaveDays: number | null; note: string; version: number; action?: 'save' | 'cancel'
}
export type LogisticsOperations = { ready: boolean; employees: LogisticsEmployee[]; entries: LogisticsRecord[] }
export async function getLogisticsOperations(from: string, to: string): Promise<LogisticsOperations> {
  const { data, error } = await getSupabase().rpc('get_logistics_operations', { p_from: from, p_to: to })
  if (error && ['PGRST202', '42883'].includes(error.code)) return { ready: false, employees: [], entries: [] }
  if (error) throw new Error('물류 운영관리 기록을 불러오지 못했습니다.', { cause: error })
  return { ready: true, employees: data.employees ?? [], entries: data.entries ?? [] }
}
export function saveLogisticsOperation(input: LogisticsRecordInput | { id: string; version: number; action: 'cancel' }, context?: DiagnosticContext) {
  return diagnosticQuery<{ id: string; version: number }>('app', 'logistics_operation_save', getSupabase().rpc('save_logistics_operation', { p_input: input }), context)
}
