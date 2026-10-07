import { Fragment, useMemo, useState } from 'react'
import { CalendarDays, CheckCircle2, CircleHelp, AlertCircle, ChevronDown, ChevronUp, ExternalLink, Shuffle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input, Select } from '@/components/ui/input'
import { useRenderWatch } from '@/lib/diagnostics'
import { cn, formatCurrency } from '@/lib/utils'
import { useMdPriceCollection } from './use-md-price-collection'
import { PriceRefreshControls, PriceCheckLabel } from './MdPriceRefreshPanel'

type CheckStatus = 'match' | 'mismatch' | 'unknown'
export type MdEventPreviewProduct = {
  id: string; name: string; code: string; m: string; provider: string; url: string
  otherLinks: { id: string; label: string; url: string; name: string }[]
}
const EVENTS = [
  { id: 'autumn', name: 'A · 가을 기획전', period: '2026.10.01 — 10.14', state: '진행 중', discount: '상품별 20% 할인', basis: '상품 페이지 표시 판매가' },
  { id: 'member', name: 'B · 멤버십 위크', period: '2026.10.05 — 10.11', state: '진행 중', discount: '회원 쿠폰 15%', basis: '회원 쿠폰 적용가' },
  { id: 'ended', name: '지난 시즌 프로모션', period: '2026.09.15 — 09.30', state: '종료', discount: '상품별 10% 할인', basis: '상품 페이지 표시 판매가' },
] as const
const SAMPLE_PRODUCTS = [
  { id: 'sample-1', event: 'autumn', name: '미니 토트백 · 블랙', code: '예시 100001', m: '예시 M0001', normal: 39000, agreed: 31200, actual: 31200 },
  { id: 'sample-2', event: 'autumn', name: '나일론 숄더백 · 아이보리', code: '예시 100002', m: '예시 M0002', normal: 59000, agreed: 47200, actual: 53100 },
  { id: 'sample-3', event: 'autumn', name: '리본 파우치 · 핑크', code: '예시 100003', m: '미연결', normal: 19000, agreed: 15200, actual: null },
  { id: 'sample-4', event: 'autumn', name: '로고 볼캡 · 버건디', code: '예시 100004', m: '예시 M0004', normal: 29000, agreed: 23200, actual: 23200 },
  { id: 'sample-5', event: 'member', name: '미니 크로스백 · 실버', code: '예시 100005', m: '예시 M0005', normal: 49000, agreed: 41650, actual: 44100 },
  { id: 'sample-6', event: 'member', name: '스트랩 파우치 · 체크', code: '예시 100006', m: '예시 M0006', normal: 24000, agreed: 20400, actual: 20400 },
  { id: 'sample-7', event: 'ended', name: '캔버스 에코백 · 그린', code: '예시 100007', m: '예시 M0007', normal: 35000, agreed: 31500, actual: 31500 },
]
const STATUS_LABEL: Record<CheckStatus, string> = { match: '가격 일치', mismatch: '가격 불일치', unknown: '미확인' }
function statusOf(row: typeof SAMPLE_PRODUCTS[number]): CheckStatus {
  return row.actual == null ? 'unknown' : row.agreed === row.actual ? 'match' : 'mismatch'
}

export function MdEventPricePreview({ mallName, products, onResample }: { mallName: string; products: MdEventPreviewProduct[]; onResample: () => void }) {
  useRenderWatch('MdEventPricePreview')
  const [eventId, setEventId] = useState('autumn')
  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const allLinks = useMemo(() => products.flatMap(p => [{id:p.id,label:p.provider,url:p.url},...p.otherLinks]),[products])
  const collection = useMdPriceCollection(allLinks)
  const event = EVENTS.find(item => item.id === eventId)
  const eventRows = useMemo(() => products.slice(0, SAMPLE_PRODUCTS.length).map((product, index) => ({ ...SAMPLE_PRODUCTS[index]!, ...product, actual: collection.checks.get(product.id)?.status === 'ok' ? collection.checks.get(product.id)!.price : null }))
    .filter(row => eventId === 'all' ? row.event !== 'ended' : row.event === eventId), [eventId, products, collection.checks])
  const counts = { all: eventRows.length, match: 0, mismatch: 0, unknown: 0 }
  eventRows.forEach(row => counts[statusOf(row)]++)
  const rows = eventRows.filter(row => (status === 'all' || statusOf(row) === status)
    && `${row.name} ${row.code} ${row.m}`.toLowerCase().includes(search.trim().toLowerCase()))
  const eventLinks = eventRows.flatMap(p => [{id:p.id,label:p.provider,url:p.url},...p.otherLinks])

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-primary/30 bg-primary/5 px-4 py-3">
      <div className="flex items-center gap-2"><span className="rounded bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">샘플 테스트</span><span className="text-sm">상품명·URL과 수집 가격은 실제 데이터입니다. 이벤트 참여·정상가·협의 가격은 예시입니다.</span></div>
      <div className="flex flex-wrap items-center gap-3"><span className="text-xs text-muted-foreground">등록 상품에서 무작위 {products.length}개 · 선택 이벤트의 수집·AI 분석 속도 테스트</span><Button variant="outline" size="sm" disabled={collection.running || !products.length} onClick={() => { setStatus('all'); setSearch(''); setExpanded(null); onResample() }}><Shuffle className="size-3.5" />샘플 다시 뽑기</Button></div>
    </div>

    <div role="tablist" aria-label="이벤트 선택" className="flex gap-2 overflow-x-auto pb-1">
      {[{ id: 'all', name: '전체 진행 이벤트' }, ...EVENTS].map(item => <button key={item.id} role="tab" type="button" aria-selected={eventId === item.id}
        onClick={() => { setEventId(item.id); setStatus('all'); setExpanded(null) }}
        className={cn('shrink-0 rounded-lg border px-4 py-2 text-sm transition-colors', eventId === item.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:bg-muted')}
      >{item.name}{item.id === 'ended' ? <span className="ml-2 text-xs opacity-70">종료</span> : null}</button>)}
    </div>

    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><div className="mb-2 flex items-center gap-2"><span className="text-xs font-medium text-muted-foreground">{mallName}</span><span className="rounded-full bg-muted px-2 py-0.5 text-xs">{event?.state ?? '진행 중'}</span></div>
          <h2 className="text-lg font-semibold">{event?.name ?? '전체 진행 이벤트'} <span className="ml-1 text-sm font-normal text-muted-foreground">가격 점검</span></h2>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground"><span className="flex items-center gap-1.5"><CalendarDays className="size-4" />{event?.period ?? '진행 중인 이벤트 모아보기'}</span><span>{event?.discount ?? '이벤트별 협의 조건 적용'}</span></div>
        </div>
        <div className="rounded-lg bg-muted/50 px-4 py-3 text-right"><p className="text-xs text-muted-foreground">이벤트 협의 조건 · 예시</p><p className="mt-1 text-sm font-medium">{event?.basis ?? '각 이벤트에 설정된 기준'}</p><p className="mt-1 text-xs text-muted-foreground">실제 수집 근거는 가격 상세에 표시</p></div>
      </div>
    </Card>

    <PriceRefreshControls collection={collection} links={eventLinks} />

    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {([{ id: 'all', label: '참여 상품', icon: null }, { id: 'match', label: '예시 협의가 일치', icon: CheckCircle2 }, { id: 'mismatch', label: '예시 협의가 불일치', icon: AlertCircle }, { id: 'unknown', label: '미확인', icon: CircleHelp }] as const).map(item => <button type="button" key={item.id} aria-pressed={status === item.id} onClick={() => setStatus(item.id)}
        className={cn('rounded-xl border bg-card p-4 text-left transition-colors hover:bg-muted/40', status === item.id ? 'border-primary ring-1 ring-primary/20' : 'border-border')}>
        <div className="flex items-center justify-between text-sm text-muted-foreground"><span>{item.label}</span>{item.icon ? <item.icon className={cn('size-4', item.id === 'mismatch' ? 'text-danger' : item.id === 'match' ? 'text-success' : '')} /> : null}</div>
        <div className={cn('mt-2 text-2xl font-semibold tabular-nums', item.id === 'mismatch' && counts.mismatch ? 'text-danger' : '')}>{counts[item.id]}<span className="ml-1 text-sm font-normal text-muted-foreground">개</span></div>
      </button>)}
    </div>

    <div className="flex flex-wrap items-center gap-2"><Input className="max-w-sm" aria-label="이벤트 상품 검색" placeholder="이벤트 상품명, 사방넷 코드, M번호 검색" value={search} onChange={e => setSearch(e.target.value)} /><Select aria-label="가격 점검 상태" value={status} onChange={e => setStatus(e.target.value)}><option value="all">전체 점검 상태</option><option value="mismatch">가격 불일치만</option><option value="unknown">미확인만</option><option value="match">가격 일치만</option></Select><span className="ml-auto text-xs text-muted-foreground">{rows.length}개 상품 · 금액 단위 원</span></div>

    <Card className="overflow-hidden"><div className="overflow-x-auto"><table className="w-full min-w-[1060px] text-left text-sm">
      <thead className="bg-muted/70 text-xs text-muted-foreground"><tr>{['업체 상품명 / 코드', '이벤트', '정상가 · 예시', '협의 가격 · 예시', '확인 가격 · 실제', '차이 · 예시 기준', '점검 상태', '가격 비교 링크'].map(label => <th key={label} className="whitespace-nowrap px-4 py-3 font-medium">{label}</th>)}</tr></thead>
      <tbody>{rows.map(row => { const check = statusOf(row); const difference = row.actual == null ? null : row.actual - row.agreed; return <Fragment key={row.id}>
        <tr className={cn('h-20 border-b border-border', check === 'mismatch' ? 'bg-danger/5' : 'hover:bg-muted/30')}><td className="min-w-64 max-w-sm px-4 py-3"><div className="font-medium">{row.name}</div><div className="mt-1 text-xs text-muted-foreground">{row.provider} · {row.code} · {row.m}</div></td>
          <td className="whitespace-nowrap px-4 text-xs text-muted-foreground">{EVENTS.find(item => item.id === row.event)?.name}</td><td className="whitespace-nowrap px-4 tabular-nums text-muted-foreground">{formatCurrency(row.normal)}</td><td className="whitespace-nowrap px-4 font-medium tabular-nums">{formatCurrency(row.agreed)}</td><td className={cn('whitespace-nowrap px-4 font-semibold tabular-nums', check === 'mismatch' && 'text-danger')}><PriceCheckLabel check={collection.checks.get(row.id)} /></td><td className={cn('whitespace-nowrap px-4 tabular-nums', check === 'mismatch' ? 'text-danger' : 'text-muted-foreground')}>{difference == null ? '—' : difference === 0 ? '0' : `${difference > 0 ? '+' : ''}${formatCurrency(difference)}`}</td>
          <td className="px-4"><span className={cn('whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium', check === 'match' ? 'bg-success/10 text-success' : check === 'mismatch' ? 'bg-danger/10 text-danger' : 'bg-muted text-muted-foreground')}>{STATUS_LABEL[check]}</span></td><td className="min-w-40 px-4"><a className="mb-1 inline-flex items-center gap-1 text-xs text-primary hover:underline" href={row.url} target="_blank" rel="noopener noreferrer">현재 업체<ExternalLink className="size-3" /></a><Button variant="outline" size="sm" className="flex" aria-expanded={expanded === row.id} onClick={() => setExpanded(expanded === row.id ? null : row.id)}>다른 업체 {row.otherLinks.length}곳{expanded === row.id ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}</Button></td></tr>
        {expanded === row.id ? <tr><td colSpan={8} className="bg-muted/30 px-5 py-4 text-sm"><p className="font-medium">같은 사방넷 코드 {row.code} · 다른 업체 가격 비교</p><div className="mt-3 flex flex-wrap gap-2">{row.otherLinks.map(link => <div key={link.id} className="rounded-md border border-border bg-card px-3 py-2 text-sm"><a title={link.name || '업체 상품명 미등록'} href={link.url} target="_blank" rel="noopener noreferrer" className="mb-1 inline-flex items-center gap-2 text-primary hover:underline">{link.label}<ExternalLink className="size-3.5" /></a><PriceCheckLabel check={collection.checks.get(link.id)} /></div>)}</div>{!row.otherLinks.length ? <p className="mt-2 text-muted-foreground">이 브랜드에서 활성화된 다른 출고업체의 URL이 없습니다.</p> : null}<p className="mt-3 text-xs text-muted-foreground">해당 브랜드의 출고업체에서 활성화된 업체만 비교합니다. 내 표시 업체 설정에서 숨긴 활성 업체도 포함합니다.</p></td></tr> : null}
      </Fragment> })}{!rows.length ? <tr><td colSpan={8} className="py-12 text-center text-muted-foreground">조건에 맞는 이벤트 상품이 없습니다.</td></tr> : null}</tbody>
    </table></div><div className="border-t border-border px-4 py-3 text-xs text-muted-foreground">협의 가격보다 높거나 낮아도 불일치로 표시합니다. 미확인 상품은 정상으로 처리하지 않습니다.</div></Card>
  </div>
}
