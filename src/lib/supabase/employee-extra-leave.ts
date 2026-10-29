import { getSupabase } from './client'

export type ExtraLeave = { id: string; employeeId: string; days: number; expires: string; note: string; created: string; version: number; used: number }
export type LeaveEvent = { id: string; employeeId: string; source: string; kind: string; days: number; date: string; note?: string; reason?: string; expires?: string; actorName?: string; recalculated?: boolean }
export type ExtraLeaveRecords = { ready: boolean; fefoReady?: boolean; entries: ExtraLeave[]; balances: { profileId: string; available: number; shortfall?: number }[]; events?: LeaveEvent[] }
export async function listExtraLeave(): Promise<ExtraLeaveRecords> {
  const { data, error } = await getSupabase().rpc('employee_extra_leave_records')
  if (error) {
    if (['PGRST202', '42883'].includes(error.code)) {
      console.warn('[extra-leave] 추가 연차 서버 연결 대기', error.code)
      return { ready: false, entries: [], balances: [] }
    }
    console.warn('[extra-leave] 추가 연차 조회 실패', error)
    throw new Error('추가 연차를 조회하지 못했습니다. 다시 조회해 주세요.')
  }
  const result = data as ExtraLeaveRecords
  return { ready: result.ready, fefoReady: result.fefoReady === true, entries: result.entries.map(row => ({ ...row, days: Number(row.days), used: Number(row.used) })), balances: result.balances.map(row => ({ ...row, available: Number(row.available), shortfall: Number(row.shortfall ?? 0) })), events: result.events?.map(row => ({ ...row, days: Number(row.days) })) }
}
export type SaveExtraLeave = { id: string; employeeId: string; days: number; expires: string; note: string; version: number; remove?: boolean }
export async function saveExtraLeave(input: SaveExtraLeave) {
  const { error } = await getSupabase().rpc('save_employee_extra_leave', {
    p_id: input.id, p_employee: input.employeeId, p_days: input.days, p_expires: input.expires,
    p_note: input.note, p_version: input.version, p_delete: input.remove ?? false,
  })
  if (error) { console.warn('[extra-leave] 추가 연차 저장 실패', error); throw new Error(error.message) }
}
