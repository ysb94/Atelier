import { getSupabase } from './client'

export type AdvancePeriod = { period: string; expires: string; authorized: number; imported: number; unclassified: number; outstanding: number; settled: number }
export type AdvanceEmployee = { employeeId: string; limit: number; baseBalance: number | null; remainingBalance: number | null; outstanding: number; unclassified: number; nextDate: string | null; needsReview: boolean; periods: AdvancePeriod[] }
export type AdvanceEvent = { id: string; employeeId: string; kind: string; days: number; source: string | null; target: string | null; requestId: string | null; note: string; actor: string | null; created: string }
export type AdvanceRecords = { ready: boolean; employees: AdvanceEmployee[]; events: AdvanceEvent[] }
export async function listLeaveAdvances(manage = false): Promise<AdvanceRecords> {
  const { data, error } = await getSupabase().rpc('employee_leave_advances', { p_manage: manage })
  if (error) {
    console.warn('[leave-advance] 연차 선사용 조회 실패', { code: error.code, message: error.message })
    if (['PGRST202', '42883'].includes(error.code)) return { ready: false, employees: [], events: [] }
    throw new Error('연차 선사용 내역을 불러오지 못했습니다. 다시 조회해 주세요.')
  }
  return data as AdvanceRecords
}
export async function manageLeaveAdvance(input: { employeeId: string; action: 'limit' | 'import' | 'import_cancel'; days: number; note: string; period?: string }) {
  const { error } = await getSupabase().rpc('manage_leave_advance', {
    p_employee: input.employeeId, p_action: input.action, p_days: input.days, p_note: input.note.trim(), p_period: input.period || null,
  })
  if (error) { console.warn('[leave-advance] 선사용 관리 저장 실패', { code: error.code, message: error.message }); throw new Error(error.message) }
}
