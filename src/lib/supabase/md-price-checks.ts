import { getSupabase } from './client'
import { interactionContext } from '@/lib/diagnostics/perf-watch'
export type MdPriceCheck = {
  id: string; url_id: string; checked_at: string; status: 'ok' | 'sold_out' | 'ended' | 'blocked' | 'unknown' | 'failed'
  price: number | null; source: 'rule' | 'discovered' | 'ai' | 'none'; basis: string; message: string
  rule_state: string | null; evidence: string; page_name: string; option_verified: boolean
  last_success_price?: number | null; last_success_at?: string | null
}
export type MdPriceMode = 'page' | 'web-search'
export type MdPriceTiming = {crawlMs:number;extractMs:number;aiMs:number;totalMs:number;inputChars:number;inputTokens:number;outputTokens:number;webSearchCalls?:number;webToolCalls?:number}
export type MdPriceRefreshResult = {check:MdPriceCheck;reused:boolean;timing:MdPriceTiming}
export async function listMdPriceChecks(urlIds: string[]): Promise<MdPriceCheck[]> {
  if (!urlIds.length) return []
  const { data, error } = await getSupabase().from('md_price_latest_checks').select('*').in('url_id',urlIds).order('checked_at',{ascending:false})
  if (error) throw new Error(`가격 기록 조회 실패: ${error.message}`)
  const seen = new Set<string>()
  return (data as MdPriceCheck[]).filter(row => { if (seen.has(row.url_id)) return false; seen.add(row.url_id); return true })
}
export async function refreshMdPrice(urlId: string, mode:MdPriceMode = 'page'): Promise<MdPriceRefreshResult> {
  if(import.meta.env.DEV && mode === 'page'){
    const {data:{session},error:sessionError}=await getSupabase().auth.getSession()
    if(sessionError||!session)throw new Error('로그인이 필요합니다.')
    const response=await fetch('/__md-price-refresh',{
      method:'POST',signal:AbortSignal.timeout(150_000),headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},
      body:JSON.stringify({urlId,context:interactionContext()}),
    })
    if(!response.headers.get('content-type')?.includes('application/json'))throw new Error('브라우저 가격 수집기가 연결되지 않았습니다. 개발 서버를 다시 시작해 주세요.')
    const data=await response.json()
    if(!response.ok||!data?.ok)throw new Error(data?.error ?? '브라우저 가격 수집 실패')
    if(!data.timing||data.check?.rule_state!=='browser-text-v1')throw new Error('브라우저 가격 분석 서버가 아직 적용되지 않았습니다.')
    return data as MdPriceRefreshResult
  }
  const { data, error } = await getSupabase().functions.invoke('md-price-refresh',{body:{urlId,mode,context:interactionContext()},timeout:75_000})
  if (error || !data?.ok) {
    let message = data?.error ?? error?.message ?? '가격 최신화 실패'
    if (error && 'context' in error && error.context instanceof Response) {
      try { message = (await error.context.json()).error ?? message } catch (parseError) { console.warn('[md-price] 오류 응답 해석 실패',{urlId,error:parseError,...interactionContext()}) }
    }
    throw new Error(message)
  }
  if (!data.timing || data.check?.rule_state !== (mode === 'web-search' ? 'web-search-v1' : 'text-v1')) throw new Error('선택한 가격 분석 서버가 아직 적용되지 않았습니다. 잠시 후 다시 시도해 주세요.')
  return data as MdPriceRefreshResult
}
