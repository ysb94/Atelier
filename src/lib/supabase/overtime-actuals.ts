import { getSupabase } from './client'
import type { OvertimeActual } from '@/features/operations-support/overtime-actuals'

type Row = { request_id: string; start_at: string; end_at: string; break_minutes: number; revision: number; saved_at: string }
export async function listOvertimeActuals(): Promise<{ ready: boolean; rows: OvertimeActual[] }> {
  const rows: OvertimeActual[] = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await getSupabase().from('overtime_actual_latest').select('*').order('request_id').range(offset, offset + 499)
    if (error) {
      console.warn('[overtime-actuals] 실제 야근 조회 실패', error)
      if (['42P01', 'PGRST205'].includes(error.code)) return { ready: false, rows: [] }
      throw new Error(error.message)
    }
    rows.push(...(data as Row[]).map(row => ({ requestId: row.request_id, startAt: row.start_at, endAt: row.end_at, breakMinutes: row.break_minutes, revision: Number(row.revision), savedAt: row.saved_at })))
    if (data.length < 500) return { ready: true, rows }
  }
}
export async function saveOvertimeActual(input: Omit<OvertimeActual, 'savedAt'>) {
  const { error } = await getSupabase().rpc('save_overtime_actual', { p_request: input.requestId, p_start: input.startAt, p_end: input.endAt, p_break: input.breakMinutes, p_revision: input.revision })
  if (error) {
    console.warn('[overtime-actuals] 실제 야근 저장 실패', { requestId: input.requestId, error })
    throw new Error(error.code === '40001' ? '다른 화면에서 기록이 변경됐습니다. 닫고 다시 열어 주세요.' : error.message)
  }
}
