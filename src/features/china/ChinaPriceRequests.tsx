import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { FilterTabs } from '@/components/ui/filter-tabs'
import { Input } from '@/components/ui/input'
import { DraftPhoto } from '@/features/drafts/DraftSheetRow'
import { useRenderWatch } from '@/lib/diagnostics'
import { sampleElapsedDays } from '@/lib/drafts/sample-work-order'
import { useAuth } from '@/lib/supabase/auth'
import { draftPriceError, getDraftPricePhoto, type DraftPriceColor, type DraftPriceRequest } from '@/lib/supabase/draft-price-requests'
import type { ProductDraft } from '@/lib/types'
import { cn } from '@/lib/utils'

const requestDate = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
})
const quoteAmount = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 })

type RequestFilter = 'all' | 'first' | 'repeat' | 'confirmed'
type SelectedPhoto = { requestId: string; color: DraftPriceColor }
export type DraftPriceInputs = Record<string, Record<string, string>>

function groupPriceRequests(requests: readonly DraftPriceRequest[]) {
  const byDraft = new Map<string, DraftPriceRequest[]>()
  for (const request of requests) {
    const rounds = byDraft.get(request.draftId)
    if (rounds) rounds.push(request)
    else byDraft.set(request.draftId, [request])
  }
  return Array.from(byDraft.values(), rounds => {
    rounds.sort((a, b) => a.round - b.round)
    return { request: rounds[rounds.length - 1], earlier: rounds.slice(0, -1) }
  }).sort(({ request: a }, { request: b }) =>
    Number(a.round > 1) - Number(b.round > 1)
    || Number(Boolean(a.answeredAt)) - Number(Boolean(b.answeredAt))
    || Date.parse(a.requestedAt) - Date.parse(b.requestedAt))
}

function ChinaPricePhoto({ photo, onClose }: { photo: SelectedPhoto; onClose: () => void }) {
  const { session } = useAuth()
  const active = useWorkspaceTabActivity()
  const dialog = useRef<HTMLDialogElement>(null)
  const query = useQuery({
    queryKey: ['draft-price-photo', session?.user.id, photo.requestId, photo.color.id],
    queryFn: ({ signal }) => getDraftPricePhoto(photo.requestId, photo.color.id, signal),
    enabled: active && Boolean(session), gcTime: 0, retry: false,
  })
  useEffect(() => {
    if (!active) return
    const current = dialog.current
    current?.showModal()
    return () => current?.close()
  }, [active])
  if (!active) return null
  return createPortal(<dialog ref={dialog} className="draft-photo-dialog fixed inset-0 m-auto w-fit max-w-[calc(100%-2rem)] rounded-xl border border-border bg-card p-4 text-foreground shadow-xl"
    aria-label={`${photo.color.name} 컬러 사진 크게 보기`} onCancel={event => { event.preventDefault(); onClose() }}
    onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <header><strong>{photo.color.name} 컬러</strong><button type="button" aria-label="사진 크게 보기 닫기" onClick={onClose}><X size={20} /></button></header>
    {query.isPending ? <p role="status">사진을 불러오는 중입니다.</p>
      : query.isError ? <p role="alert">{draftPriceError(query.error, '컬러 사진을 불러오지 못했습니다.')}</p>
      : query.data ? <img src={query.data} alt={`${photo.color.name} 컬러`} /> : <p>첨부 사진이 없습니다.</p>}
  </dialog>, document.body)
}

function ChinaPriceRequestRow({ request, earlier, draft, confirmed, brandName, amounts, disabled, onEdit, onReply, onPhoto }: {
  request: DraftPriceRequest
  earlier: readonly DraftPriceRequest[]
  draft: ProductDraft | undefined
  confirmed: boolean
  brandName: string | undefined
  amounts: Record<string, string> | undefined
  disabled: boolean
  onEdit: (colorId: string, value: string) => void
  onReply: (amounts: Record<string, number>) => Promise<unknown>
  onPhoto: (color: DraftPriceColor) => void
}) {
  const formId = useId()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { answeredAt, draftNo, colors } = request
  const sentEarlier = earlier.filter(round => round.answeredAt).reverse()

  async function reply() {
    if (busy || disabled || answeredAt) return
    const values = Object.fromEntries(colors.map(color => [color.id, Number(amounts?.[color.id] || NaN)]))
    if (Object.values(values).some(value => !Number.isFinite(value))) {
      setError('요청된 컬러의 단가를 모두 입력해 주세요.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await onReply(values)
    } catch (cause) {
      setError(draftPriceError(cause, '단가를 전송하지 못했습니다. 요청 상태를 확인하고 다시 시도해 주세요.'))
    } finally {
      setBusy(false)
    }
  }

  return <tr className="border-b border-primary/25 last:border-b-0">
    <td className="border-r border-border/60 px-4 py-4 align-top">
      <div className="mx-auto max-w-36 space-y-1.5">
        <p className="break-words text-center text-sm font-medium text-primary">{brandName ?? '브랜드 미정'}</p>
        <div className="draft-sheet-image-cell">
          <DraftPhoto src={draft?.imageUrl ?? null} name={draft?.nameKo || draftNo} />
        </div>
        <p className="break-words text-xs text-muted-foreground">Designer <strong className="text-foreground">{draft?.owner || '—'}</strong></p>
        <p className="text-sm font-semibold">No. {draftNo}</p>
        <div className="break-words text-sm text-primary">
          {draft?.nameKo && <p>{draft.nameKo}</p>}
          {draft?.nameEn && <p>{draft.nameEn}</p>}
        </div>
      </div>
    </td>
    <td className="border-r border-border/60 px-3 py-4 text-center align-top">
      <ol aria-label="요청 차수" className="divide-y divide-border/60">
        {[...earlier, request].map(round => {
          const current = round.id === request.id
          const first = round.round === 1
          const days = sampleElapsedDays(round.requestedAt, round.answeredAt ? new Date(round.answeredAt) : undefined)
          return <li key={round.id} aria-current={current ? 'step' : undefined} className="space-y-1.5 py-2 first:pt-0 last:pb-0">
            <p className="whitespace-nowrap text-[10px] text-muted-foreground"><time dateTime={round.requestedAt}>{requestDate.format(new Date(round.requestedAt))}</time> 발송</p>
            <Badge variant={!current ? 'muted' : first ? 'default' : 'warning'}
              className={cn('rounded-md', current && first && 'border-transparent bg-primary text-primary-foreground')}>
              {first ? '1차 요청' : `단가 재요청 · ${round.round}차`}
            </Badge>
            {current && confirmed && <div><Badge variant="success" className="rounded-md">확정</Badge></div>}
            <p className={cn('text-sm font-medium tabular-nums', !current ? 'text-muted-foreground' : round.answeredAt ? 'text-foreground' : 'text-primary')}>
              {round.answeredAt ? `${days} days` : `+ ${days} days`}
            </p>
          </li>
        })}
      </ol>
    </td>
    <td className="py-4 pl-3 align-top">
      <div className="divide-y divide-primary/20">
        {colors.map(color => <div key={color.id} className="flex h-9 items-center gap-2 pr-2">
          <span className="flex w-2 shrink-0 justify-center" aria-hidden="true">{color.hasPhoto && <span className="size-1 rounded-full bg-primary" />}</span>
          <span title={color.name} className="min-w-0 flex-1 truncate text-sm">{color.name}</span>
          {color.hasPhoto && <Button type="button" variant="outline" size="sm" className="h-6 shrink-0 px-1.5 text-xs text-primary"
            aria-label={`${color.name} 컬러 사진 크게 보기`} onClick={() => onPhoto(color)}>Image</Button>}
        </div>)}
      </div>
    </td>
    <td className="border-r border-border/60 py-4 pr-4 align-top">
      <div className="divide-y divide-primary/20">
        {colors.map(color => <div key={color.id} className="flex h-9 items-center justify-center gap-2">
          <Input form={formId} aria-label={`${color.name} 단가 (위안)`} type="number" inputMode="decimal" min="0" max="99999999.99" step="0.01" required readOnly={Boolean(answeredAt) || busy}
            className="h-7 w-24 px-1 text-center tabular-nums" value={answeredAt ? request.amounts?.[color.id] ?? '' : amounts?.[color.id] ?? ''}
            onChange={event => onEdit(color.id, event.target.value)} />
          <span aria-hidden="true" className="text-sm">¥</span>
        </div>)}
      </div>
    </td>
    <td className="px-4 py-4 align-top">
      <div className="flex flex-wrap items-start gap-3">
        <form id={formId} className="flex max-w-32 shrink-0 flex-col items-center gap-2" onSubmit={event => {
          event.preventDefault()
          void reply()
        }}>
          {answeredAt ? <>
            <Badge variant="success" role="status">전송 완료</Badge>
            <time dateTime={answeredAt} className="text-xs text-muted-foreground">{requestDate.format(new Date(answeredAt))}</time>
          </> : <Button type="submit" variant="outline" size="sm" disabled={busy || disabled}>{busy ? '전송 중' : '단가 전송'}</Button>}
          {error && !answeredAt && <p role="alert" className="text-sm text-danger">{error}</p>}
        </form>
        {sentEarlier.length > 0 && <section aria-label="이전 전송 단가" className="min-w-32 flex-1 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
          <p className="font-medium text-muted-foreground">이전 전송 단가</p>
          <ol className="mt-1 divide-y divide-border/70">
            {sentEarlier.map(round => <li key={round.id} className="space-y-1 py-2 last:pb-0">
              <p className="font-medium">{round.round}차 회신</p>
              <dl className="space-y-1">
                {round.colors.map(color => {
                  const amount = round.amounts?.[color.id]
                  return <div key={color.id} className="flex items-baseline justify-between gap-2">
                    <dt className="min-w-0 break-words text-muted-foreground">{color.name}</dt>
                    <dd className="shrink-0 font-medium tabular-nums">{amount == null ? '—' : `¥${quoteAmount.format(amount)}`}</dd>
                  </div>
                })}
              </dl>
            </li>)}
          </ol>
        </section>}
      </div>
    </td>
  </tr>
}

export function ChinaPriceRequests({ requests, drafts, brandById, inputs, loading, error, onRetry, onEdit, onReply }: {
  requests: readonly DraftPriceRequest[]
  drafts: readonly ProductDraft[]
  brandById: ReadonlyMap<string, { name: string }> | undefined
  inputs: DraftPriceInputs
  loading: boolean
  error: string
  onRetry: () => void
  onEdit: (requestId: string, colorId: string, value: string) => void
  onReply: (requestId: string, amounts: Record<string, number>) => Promise<unknown>
}) {
  useRenderWatch('ChinaPriceRequests')
  const [filter, setFilter] = useState<RequestFilter>('all')
  const [photo, setPhoto] = useState<SelectedPhoto | null>(null)
  const byDraft = useMemo(() => new Map(drafts.map(draft => [draft.id, draft])), [drafts])
  const groups = useMemo(() => groupPriceRequests(requests).map(group => {
    const { request } = group
    const draft = byDraft.get(request.draftId)
    const confirmed = request.answeredAt && draft?.specs.confirmedPriceRequestId === request.id
    const status = confirmed ? 'confirmed' : request.round === 1 ? 'first' : 'repeat'
    return { ...group, draft, status }
  }), [byDraft, requests])
  const pending = groups.filter(({ request }) => !request.answeredAt)
  const shown = groups.filter(({ status }) => filter === 'all' ? status !== 'confirmed' : status === filter)

  return <section aria-labelledby="china-price-requests-title">
    <h2 id="china-price-requests-title" className="sr-only">단가요청</h2>
    <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4">
      <FilterTabs<RequestFilter> value={filter} onChange={setFilter} ariaLabel="단가요청 구분" variant="underline" className="border-b-0"
        tabs={[
          { value: 'all', label: `ALL (${pending.length})` },
          { value: 'first', label: `1차 요청 (${pending.filter(({ status }) => status === 'first').length})` },
          { value: 'repeat', label: `재요청 (${pending.filter(({ status }) => status === 'repeat').length})` },
          { value: 'confirmed', label: `확정 (${groups.filter(({ status }) => status === 'confirmed').length})` },
        ]} />
      <p className="px-4 py-2 text-xs text-muted-foreground">위안화(¥) · 기획안에 컬러별 단가 회신</p>
    </div>
    {error && <div className="mb-3 flex items-center gap-2 text-sm text-danger">
      <p role="alert">{error}</p><Button type="button" variant="outline" size="sm" onClick={onRetry}>다시 조회</Button>
    </div>}
    <Card className="overflow-x-auto">
      <table aria-label="단가요청 목록" className="w-full min-w-[880px] table-fixed text-left">
        <colgroup><col className="w-40" /><col className="w-36" /><col className="w-36" /><col className="w-36" /><col /></colgroup>
        <thead className="bg-primary text-primary-foreground">
          <tr>
            <th scope="col" className="px-4 py-3 text-center text-sm font-medium">Product</th>
            <th scope="col" className="px-3 py-3 text-center text-sm font-medium">구분</th>
            <th scope="col" className="px-3 py-3 text-center text-sm font-medium">Color</th>
            <th scope="col" className="px-3 py-3 text-center text-sm font-medium">단가</th>
            <th scope="col"><span className="sr-only">전송</span></th>
          </tr>
        </thead>
        <tbody>
          {shown.map(({ request, earlier, draft, status }) =>
            <ChinaPriceRequestRow key={request.id} request={request} earlier={earlier} draft={draft} confirmed={status === 'confirmed'}
              brandName={draft?.brandId ? brandById?.get(draft.brandId)?.name : undefined} amounts={inputs[request.id]} disabled={Boolean(error)}
              onEdit={(id, value) => onEdit(request.id, id, value)} onReply={values => onReply(request.id, values)}
              onPhoto={color => setPhoto({ requestId: request.id, color })} />)}
          {shown.length === 0 && <tr><td colSpan={5} className="px-4 py-12 text-center text-sm text-muted-foreground">
            {loading ? '단가요청을 불러오는 중입니다.' : error ? '단가요청 목록을 다시 조회해 주세요.' : '해당 단가요청이 없습니다.'}
          </td></tr>}
        </tbody>
      </table>
    </Card>
    {photo && requests.some(request => request.id === photo.requestId) && <ChinaPricePhoto photo={photo} onClose={() => setPhoto(null)} />}
  </section>
}
