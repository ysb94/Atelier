import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/lib/supabase/auth'
import { listOffsiteSettlements } from '@/lib/supabase/offsite-settlements'
import { useReadMyHomeNotification } from './use-my-home-notifications'
import { workDurationLabel } from '@/features/operations-support/overtime-hours'

export function OffsiteSettlementResult({ requestId }: { requestId: string }) {
  const { profile }=useAuth()
  const records=useQuery({queryKey:['offsite-settlements',profile?.id],queryFn:listOffsiteSettlements,enabled:Boolean(profile?.id),refetchInterval:30_000})
  useEffect(()=>{if(records.error)console.warn('[offsite-settlement] 본인 결과 조회 실패',records.error)},[records.error])
  const result=records.data?.rows.find(row=>row.request_id===requestId)
  const read=useReadMyHomeNotification('request',requestId,`offsite-settlement:${requestId}`,Boolean(result && !records.error))
  if(records.error)return <p role="alert" className="text-warning">외근 후처리 결과를 불러오지 못했습니다.</p>
  if(!result)return null
  return <section className="space-y-2 rounded-xl border border-border p-3" aria-label="외근 후처리 결과"><h3 className="font-semibold">외근 후처리 결과</h3><p>{result.mode==='leave'?`추가 휴가 ${result.leave_days}일 · ${result.expires_on}까지 · 야근 누적 제외`:result.mode==='overtime'?`야근 누적 ${workDurationLabel(Object.values(result.minutes_by_date).reduce((sum,value)=>sum+Number(value),0))}`:'실제 추가 근무 없음'}</p><p className="whitespace-pre-wrap text-sm">{result.note}</p>{read.error&&<p role="alert">{read.error}<button type="button" onClick={read.retry}>읽음 저장 재시도</button></p>}</section>
}
