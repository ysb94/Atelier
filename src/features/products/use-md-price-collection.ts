import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { interactionContext } from '@/lib/diagnostics/perf-watch'
import { listMdPriceChecks, refreshMdPrice, type MdPriceCheck, type MdPriceTiming, type MdPriceMode } from '@/lib/supabase/md-price-checks'
import { priceSearchEvidence } from '@/lib/products/md-price-search-evidence'
import { runPriceQueue } from '@/lib/products/md-price-queue'
import { emptyList } from '@/lib/utils'
export type PriceLink = { id: string; label: string; url: string }
export type PriceRunRow = {id:string;label:string;status:string;reused:boolean;timing:MdPriceTiming;requestMs:number;candidate?:boolean}
export function useMdPriceCollection(links: PriceLink[]) {
  const queryClient = useQueryClient()
  const [mode,setMode] = useState<MdPriceMode>('page')
  const [runMode,setRunMode] = useState<MdPriceMode>('page')
  const ids = useMemo(() => [...new Set(links.map(l => l.id))].sort(),[links])
  const key = useMemo(() => ['mdPriceChecks',ids] as const,[ids])
  const query = useQuery({queryKey:key,queryFn:() => listMdPriceChecks(ids),enabled:ids.length > 0})
  const [running,setRunning] = useState(false), [progress,setProgress] = useState({done:0,total:0,label:''}), [error,setError] = useState('')
  const [elapsedMs,setElapsedMs] = useState(0), [runRows,setRunRows] = useState<PriceRunRow[]>([]), [cancelled,setCancelled] = useState(false)
  const busy = useRef(false), stop = useRef(false), startedAt = useRef(0)
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setElapsedMs(Date.now()-startedAt.current),1000)
    return () => clearInterval(timer)
  },[running])
  useEffect(() => () => {stop.current=true},[])
  const checks = useMemo(() => new Map((query.data ?? emptyList<MdPriceCheck>()).map(c => [c.url_id,c])),[query.data])
  async function refresh(targets: PriceLink[]) {
    if (busy.current) return
    busy.current = true; stop.current = false; startedAt.current = Date.now()
    setRunning(true); setRunMode(mode); setError(''); setElapsedMs(0); setRunRows([]); setCancelled(false)
    // Each DB link needs its own observation, even when two rows happen to share a URL.
    const unique = [...new Map(targets.map(l => [l.id,l])).values()]
    let failed = 0, done = 0
    const active = new Map<string,string>()
    const updateProgress = () => setProgress({done,total:unique.length,label:[...new Set(active.values())].join(' · ')})
    updateProgress()
    try {
      await runPriceQueue(unique,link => {try {return new URL(link.url).hostname.replace(/^www\./,'')} catch (error) {console.warn('[md-price] 수집 주소 형식 오류',{urlId:link.id,error,...interactionContext()});return link.id}},async link => {
        active.set(link.id,link.label); updateProgress()
        const requestStarted = Date.now()
        try {
          const result = await refreshMdPrice(link.id,mode), {check,timing,reused} = result
          queryClient.setQueryData<MdPriceCheck[]>(key,previous => [{...previous?.find(c=>c.url_id===check.url_id),...check,...(check.status==='ok' ? {last_success_price:check.price,last_success_at:check.checked_at} : {})},...(previous ?? []).filter(c => c.url_id !== check.url_id)])
          setRunRows(previous => [...previous,{id:link.id,label:link.label,status:check.status,reused,timing,requestMs:Date.now()-requestStarted,candidate:priceSearchEvidence(check)?.candidatePrice != null}])
          console.info('[md-price] 링크 처리 완료',{urlId:link.id,status:check.status,reused,...timing,requestMs:Date.now()-requestStarted,...interactionContext()})
        } catch (e) {
          failed++
          setRunRows(previous => [...previous,{id:link.id,label:link.label,status:'request_failed',reused:false,timing:{crawlMs:0,extractMs:0,aiMs:0,totalMs:0,inputChars:0,inputTokens:0,outputTokens:0},requestMs:Date.now()-requestStarted}])
          console.warn('[md-price] 링크 최신화 실패',{urlId:link.id,error:e,...interactionContext()})
          setError(e instanceof Error ? e.message : '가격 최신화 실패')
        } finally {done++; active.delete(link.id); updateProgress()}
      },() => stop.current)
      if (failed) setError(previous => `${failed}개 요청 실패 · ${previous}`)
      await queryClient.invalidateQueries({queryKey:['mdPriceChecks']})
    } catch (e) {console.warn('[md-price] 최신화 마무리 실패',{error:e,...interactionContext()});setError(e instanceof Error ? e.message : '최신화 결과 조회 실패')}
    finally {
      const duration = Date.now()-startedAt.current
      setElapsedMs(duration); setCancelled(stop.current && done < unique.length)
      console.info('[md-price] 목록 최신화 완료',{done,total:unique.length,requestFailures:failed,elapsedMs:duration,cancelled:stop.current,...interactionContext()})
      busy.current=false; setRunning(false)
    }
  }
  return {checks,mode,setMode,runMode,running,progress,elapsedMs,runRows,cancelled,error:error || (query.error instanceof Error ? query.error.message : ''),refresh,cancel:() => {stop.current=true;setCancelled(true)}}
}
