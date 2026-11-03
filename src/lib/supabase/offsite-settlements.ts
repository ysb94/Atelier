import { getSupabase } from './client'
export type OffsiteSettlement = { request_id: string; mode: 'overtime'|'leave'|'none'; minutes_by_date: Record<string, number>; leave_days: number|null; expires_on: string|null; note: string; decided_at: string }
export type OffsitePreview = { dates: { date: string; minutes: number|null }[]; settlement: OffsiteSettlement|null; serverNow: string }
export async function listOffsiteSettlements(): Promise<{ ready: boolean; rows: OffsiteSettlement[] }> {
  const rows: OffsiteSettlement[] = []
  for (let offset=0;;offset+=500) {
    const { data,error } = await getSupabase().from('offsite_settlements').select('*').order('request_id').range(offset,offset+499)
    if (error) {
      console.warn('[offsite-settlement] 이력 조회 실패',error)
      if (['42P01','PGRST205'].includes(error.code)) return {ready:false,rows:[]}
      throw new Error(error.message)
    }
    rows.push(...data as OffsiteSettlement[])
    if (data.length<500) return {ready:true,rows}
  }
}
export async function offsiteSettlementPreview(requestId: string): Promise<OffsitePreview> {
  const { data, error } = await getSupabase().rpc('offsite_settlement_preview', { p_request: requestId })
  if (error) { console.warn('[offsite-settlement] 후처리 조회 실패', { requestId, error }); throw new Error(error.code === 'PGRST202' ? '외근 후처리 서버 설정 적용 대기입니다.' : error.message) }
  return data as OffsitePreview
}
export async function saveOffsiteSettlement(input: { requestId: string; mode: OffsiteSettlement['mode']; minutes: Record<string,number>; days: number|null; expires: string|null; note: string }) {
  const { error } = await getSupabase().rpc('save_offsite_settlement', { p_request: input.requestId, p_mode: input.mode, p_minutes: input.minutes, p_days: input.days, p_expires: input.expires, p_note: input.note })
  if (error) { console.warn('[offsite-settlement] 후처리 저장 실패', { requestId: input.requestId, error }); throw new Error(error.message) }
}
