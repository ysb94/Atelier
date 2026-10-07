import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/input'
import { useRenderWatch } from '@/lib/diagnostics'
import type { MdPriceCheck, MdPriceMode } from '@/lib/supabase/md-price-checks'
import { priceSearchEvidence } from '@/lib/products/md-price-search-evidence'
import { formatCurrency } from '@/lib/utils'
import type { PriceLink, useMdPriceCollection } from './use-md-price-collection'
const STATE: Record<MdPriceCheck['status'], string> = {ok:'가격 수집',sold_out:'품절',ended:'판매 중지 / 페이지 없음',blocked:'접근 제한',unknown:'확인 필요',failed:'수집 실패'}
const seconds = (ms:number) => `${(ms/1000).toFixed(1)}초`
export function PriceRefreshControls({collection,links}: {collection:ReturnType<typeof useMdPriceCollection>;links:PriceLink[]}) {
  useRenderWatch('PriceRefreshControls')
  const {running,progress,error,checks,elapsedMs,runRows,cancelled,mode,runMode} = collection
  const webSearch = mode === 'web-search'
  const retry = links.filter(l => {const check = checks.get(l.id);return !check || (webSearch ? check.rule_state !== 'web-search-v1' || priceSearchEvidence(check)?.candidatePrice == null : check.rule_state === 'web-search-v1' || ['failed','blocked','unknown'].includes(check.status))})
  const current = [...new Map(links.map(l=>[l.id,checks.get(l.id)])).values()].filter((c): c is MdPriceCheck => !!c)
  const ok = current.filter(c=>c.status==='ok').length, excluded = current.filter(c=>['sold_out','ended'].includes(c.status)).length
  const candidates = current.filter(c=>priceSearchEvidence(c)?.candidatePrice != null).length
  const fresh = runRows.filter(row => !row.reused && row.status !== 'request_failed')
  const analyzed = fresh.filter(row => row.timing.aiMs > 0)
  const freshOk = fresh.filter(row => row.status === 'ok').length
  const avg = (values:number[]) => values.length ? seconds(values.reduce((a,b)=>a+b,0)/values.length) : '—'
  return <div className="space-y-3 rounded-lg border border-border bg-card p-4">
    <div className="flex flex-wrap items-center gap-2">
      <Select aria-label="가격 수집 방식" disabled={running} value={mode} onChange={e=>collection.setMode(e.target.value as MdPriceMode)}><option value="page">페이지 직접 수집</option><option value="web-search">AI 웹 검색 · 시험</option></Select>
      <Button disabled={running || !links.length} onClick={() => void collection.refresh(links)}>{running ? `최신화 중 ${progress.done}/${progress.total}` : '가격 최신화'}</Button>
      {running ? <Button variant="outline" disabled={cancelled} onClick={collection.cancel}>{cancelled ? '진행 중인 요청 마무리 중' : '진행 중인 요청 후 중지'}</Button> : <Button variant="outline" disabled={!retry.length} onClick={() => void collection.refresh(retry)}>미확인만 재시도</Button>}
      <span className="text-xs text-muted-foreground">현재 이벤트 {new Set(links.map(l=>l.id)).size}개 링크 · {webSearch ? '웹 검색으로 가격·출처 조사' : `${import.meta.env.DEV ? '브라우저 화면' : '수집 본문'}에서 가격 확인`}</span>
      {progress.total > 0 ? <span className="ml-auto text-sm font-medium tabular-nums">{running ? '경과' : cancelled ? '중지까지' : '총 소요'} {seconds(elapsedMs)}</span> : null}
    </div>
    {running ? <p role="status" className="text-xs text-muted-foreground">{progress.label || '준비 중'} 확인 중 · 완료된 결과부터 반영합니다. 이벤트를 바꿔도 시작한 목록의 작업은 유지됩니다.</p> : <p role="status" className="text-xs text-muted-foreground">{progress.total ? `최근 실행 ${progress.done}/${progress.total} 처리 · ` : ''}현재 이벤트: 가격 수집 {ok} · 검색 참고가 {candidates} · 판매 중지/품절 등 {excluded} · 기타 미확인 {current.length-ok-excluded-candidates} · 미수집 {new Set(links.map(l=>l.id)).size-current.length}</p>}
    {runRows.length ? <div className="space-y-2 rounded-md bg-muted/40 p-3">
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs"><span>{runMode === 'web-search' ? '이번 실행 검색 참고가' : '이번 실행 새 가격'} <b>{runMode === 'web-search' ? fresh.filter(r=>r.candidate).length : freshOk}건</b></span><span>AI 분석 {analyzed.length}건</span><span>1분 이내 기록 재사용 {runRows.filter(r=>r.reused).length}건</span>{runMode === 'web-search' ? <span>웹 검색 {fresh.reduce((sum,r)=>sum+(r.timing.webSearchCalls ?? 0),0)}회</span> : <span>수집 평균 <b>{avg(fresh.map(r=>r.timing.crawlMs))}</b></span>}<span>AI 평균 <b>{avg(analyzed.map(r=>r.timing.aiMs))}</b></span></div>
      <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">링크별 속도와 결과 보기</summary><div className="mt-2 overflow-x-auto"><table className="w-full min-w-[520px] text-left tabular-nums"><thead><tr>{['업체','결과','수집','AI','응답까지'].map(label=><th key={label} className="py-1 pr-3 font-medium">{label}</th>)}</tr></thead><tbody>{runRows.map(row=><tr key={row.id}><td className="py-1 pr-3">{row.label}</td><td className="pr-3">{row.reused ? '기록 재사용' : row.candidate ? '검색 참고가' : STATE[row.status as MdPriceCheck['status']] ?? '요청 실패'}</td><td className="pr-3">{runMode === 'web-search' || row.reused || row.status==='request_failed' ? '—' : seconds(row.timing.crawlMs)}</td><td className="pr-3">{row.timing.aiMs ? seconds(row.timing.aiMs) : '—'}</td><td>{seconds(row.requestMs)}</td></tr>)}</tbody></table></div><p className="mt-2 text-muted-foreground">동시에 처리하므로 각 시간의 합과 총 소요 시간은 다릅니다. 기록 재사용은 수집·AI 평균에서 제외합니다.</p></details>
    </div> : null}
    {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
    {!webSearch && import.meta.env.DEV && links.some(link=>/^https?:\/\/(?:[\w-]+\.)*ssg\.com(?:[/:]|$)/i.test(link.url)) ? <p className="text-xs text-muted-foreground">SSG 확인 중에는 별도 브라우저 창이 잠시 열립니다. 확인이 끝나면 자동으로 닫힙니다.</p> : null}
    {webSearch ? <p className="text-xs text-muted-foreground">AI가 같은 업체·상품 URL의 가격과 출처를 검색합니다. 검색 참고가는 최신 판매가·판매 상태·색상·사이즈를 보장하지 않아 자동 가격 비교에서 제외합니다. 확장 프로그램 설치는 필요 없으며, 실행 시 AI·웹 검색 사용료가 발생합니다. 같은 방식·링크의 1분 이내 결과는 재사용합니다.</p> : <p className="text-xs text-muted-foreground">등록된 링크의 상품 표시 가격을 확인합니다. 업체별 상품명 차이는 허용하며 색상·사이즈 일치 여부는 확인하지 않습니다. 상품 쿠폰은 적용 조건과 함께 표시합니다. 접근 제한·본문 부족·품절은 비교에서 제외하며, 원문 근거가 없는 금액은 입력하지 않습니다. 같은 링크를 1분 안에 다시 누르면 최근 결과를 재사용합니다.</p>}
  </div>
}
export function PriceCheckLabel({check}: {check?:MdPriceCheck}) {
  if (!check) return <span className="text-xs text-muted-foreground">미수집</span>
  const browserMode = check.rule_state === 'browser-text-v1'
  const textMode = check.rule_state === 'text-v1' || browserMode
  const search = priceSearchEvidence(check), webMode = check.rule_state === 'web-search-v1'
  return <span className="block text-xs" title={`${check.basis}\n${check.message}\n${search ? search.quote : check.evidence}`}>
    <span className="font-medium">{search?.candidatePrice != null ? `검색 참고 ${formatCurrency(search.candidatePrice)}` : check.status === 'ok' && check.price != null ? formatCurrency(check.price) : STATE[check.status]}</span>
    {check.status!=='ok' ? <span className="mt-1 block max-w-64 whitespace-normal text-muted-foreground">{check.message}</span> : <span className="mt-1 block max-w-64 whitespace-normal text-muted-foreground">{check.basis}</span>}
    {check.status!=='ok' && check.last_success_price ? <span className="block text-muted-foreground">이전 {formatCurrency(check.last_success_price)} · 현재 비교 제외</span> : null}
    {search?.conditions ? <span className="block max-w-64 whitespace-normal text-muted-foreground">조건: {search.conditions}</span> : null}
    {search?.quote ? <span className="mt-1 block max-w-64 whitespace-normal text-muted-foreground">AI가 인용한 가격: “{search.quote}”</span> : null}
    {search?.sources.map((source,index)=><a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer" className="mt-1 block max-w-64 whitespace-normal text-primary underline" title={source.title}>검색 출처 {index+1} ↗</a>)}
    <span className="mt-1 block text-muted-foreground">{webMode ? search?.evidenceType === 'product_page' ? 'AI 보고: 상품 본문 · 미검증' : search?.evidenceType === 'search_snippet' ? '검색 요약 · 최신 여부 미확인' : 'AI 웹 검색' : textMode ? check.source==='ai' ? browserMode ? '브라우저 화면 분석' : '본문 AI 분석' : '페이지 수집 결과' : '이전 방식 기록 · 최신화로 재확인'}</span>
    <span className="block text-muted-foreground">{webMode ? '검색 시각 ' : ''}{new Date(check.checked_at).toLocaleString('ko-KR',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</span>
  </span>
}
