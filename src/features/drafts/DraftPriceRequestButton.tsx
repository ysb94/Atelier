import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Heart } from 'lucide-react'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { elapsedMaterialRequestDays } from '@/features/planning/material-request-days'
import { DRAFT_PRICE_DESTINATIONS, isDraftManualPriceDestination, parseDraftManualAmount } from '@/lib/drafts/manual-price'
import { CHINA_TEAM_DESTINATION } from '@/lib/drafts/sample-receipt'
import { draftPriceError, type DraftPriceRequest } from '@/lib/supabase/draft-price-requests'
import { COST_CURRENCY_LABEL, type CostCurrency, type DraftColorRow, type DraftManualPrice } from '@/lib/types'
import { cn, formatNumber } from '@/lib/utils'

export type DraftPriceControls = {
  latest?: DraftPriceRequest
  reply?: DraftPriceRequest
  loading: boolean
  error: string
  retry: () => void
  request: () => Promise<unknown>
  confirm?: (reply: DraftPriceRequest) => Promise<void>
  saveManual?: (price: Omit<DraftManualPrice, 'savedAt'>) => Promise<void>
}

const replyDate = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short',
})
const requestDay = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric',
})
const requestClock = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: true,
})

export function DraftPriceRequestButton({ readOnly, hasColors, missingColors, controls, confirmedRequestId, colors = [], manualPrice }: {
  readOnly: boolean
  hasColors: boolean
  missingColors: string[]
  controls?: DraftPriceControls
  confirmedRequestId?: string
  colors?: readonly Pick<DraftColorRow, 'id' | 'name'>[]
  manualPrice?: DraftManualPrice
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [destination, setDestination] = useState('')
  const [vendor, setVendor] = useState('')
  const [currency, setCurrency] = useState<CostCurrency>('CNY')
  const [manualAmounts, setManualAmounts] = useState<Record<string, string>>({})
  const active = useWorkspaceTabActivity()
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const latest = controls?.latest
  const reply = controls?.reply
  const amounts = reply?.amounts
  const showingManual = Boolean(manualPrice && (!latest || Date.parse(manualPrice.savedAt) >= Date.parse(latest.requestedAt)))
  const displayedAmounts = showingManual ? manualPrice?.amounts : amounts
  const manualCurrency = showingManual && manualPrice ? COST_CURRENCY_LABEL[manualPrice.currency] : undefined
  const hasReply = Boolean(reply?.answeredAt && reply.id === latest?.id)
  const confirmed = !showingManual && hasReply && reply?.id === confirmedRequestId
  const confirm = controls?.confirm
  const showReplyActions = !showingManual && hasReply && !readOnly
  const waiting = Boolean(latest && !latest.answeredAt)
  const waitingForRepeat = waiting && (latest?.round ?? 0) > 1
  const requestedAt = waiting && latest ? new Date(latest.requestedAt) : null
  const sentAt = requestedAt && Number.isFinite(requestedAt.getTime()) ? requestedAt : null
  const ready = hasColors && missingColors.length === 0
  const chinaSelected = destination === CHINA_TEAM_DESTINATION.value
  const manualSelected = isDraftManualPriceDestination(destination)
  const canSend = Boolean(chinaSelected && controls && ready && !readOnly && !waiting && !controls.loading && !controls.error)
  const canSaveManual = Boolean(manualSelected && controls?.saveManual && !readOnly && !waiting &&
    colors.length && colors.every(color => parseDraftManualAmount(manualAmounts[color.id] ?? '') !== null))
  const visible = open && active && (!readOnly || Boolean(latest || manualPrice))

  useEffect(() => {
    if (!visible) return
    const current = dialog.current
    current?.showModal()
    return () => current?.close()
  }, [visible])

  async function send() {
    if (!controls || !canSend || busy) return
    setBusy(true)
    setError('')
    try {
      await controls.request()
      if (latest) setOpen(false)
    } catch (cause) {
      setError(draftPriceError(cause, '단가요청을 저장하지 못했습니다. 요청 상태를 확인하고 다시 시도해 주세요.'))
    } finally {
      setBusy(false)
    }
  }

  async function confirmReply() {
    if (!showReplyActions || !confirm || !reply || confirmed || busy || controls?.loading || controls?.error) return
    setBusy(true)
    setError('')
    try {
      await confirm(reply)
    } catch (cause) {
      setError(draftPriceError(cause, '단가를 확정하지 못했습니다.'))
    } finally {
      setBusy(false)
    }
  }

  function selectDestination(value: string) {
    const saved = manualPrice?.destination === value ? manualPrice : undefined
    setDestination(value)
    setVendor(saved?.vendor ?? '')
    setCurrency(saved?.currency ?? (value === '한국' ? 'KRW' : value === 'other' ? 'USD' : 'CNY'))
    setManualAmounts(saved ? Object.fromEntries(Object.entries(saved.amounts).map(([id, amount]) => [id, String(amount)])) : {})
    setError('')
  }

  function openDetails(value = '') {
    selectDestination(value)
    setOpen(true)
  }

  async function saveManual() {
    if (!canSaveManual || !controls?.saveManual || busy) return
    const amounts: Record<string, number> = {}
    for (const color of colors) {
      const amount = parseDraftManualAmount(manualAmounts[color.id] ?? '')
      if (amount === null) return
      amounts[color.id] = amount
    }
    setBusy(true)
    setError('')
    try {
      await controls.saveManual({ destination, vendor: vendor.trim(), currency, amounts })
      setOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '단가를 저장하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return <>
    {displayedAmounts && colors.length ? <>
      <div className="draft-color-pad justify-center">
        {showingManual && manualPrice && <span className="text-xs text-muted-foreground">{manualPrice.currency}</span>}
        {confirmed && <span role="img" aria-label="단가 확정" className="text-primary">
          <Heart size={20} fill="currentColor" aria-hidden="true" />
        </span>}
      </div>
      <div className="draft-color-lines draft-price-amounts">
        {colors.map((color, index) => {
          const amount = displayedAmounts[color.id]
          const amountLabel = typeof amount === 'number' ? formatNumber(amount) : '—'
          return (
            <div key={color.id} className={cn('draft-color-line', index % 2 === 1 && 'is-alt')}>
              <span className="group/price relative inline-grid place-items-center px-1 text-sm font-semibold tabular-nums text-blue-700">
                <span title={`${color.name} 단가 (${manualCurrency ?? '위안'})`}>{amountLabel}</span>
                {confirmed && !readOnly && typeof amount === 'number' && (
                  <Button type="button" size="sm" variant="ghost"
                    className="pointer-events-none absolute inset-y-0 left-1/2 z-10 my-auto h-7 -translate-x-1/2 bg-blue-700 px-1.5 text-white opacity-0 hover:bg-blue-800 group-hover/price:pointer-events-auto group-hover/price:opacity-100 group-focus-within/price:pointer-events-auto group-focus-within/price:opacity-100"
                    aria-label={`${color.name} 단가 ${amountLabel}위안 재요청`}
                    aria-haspopup="dialog" disabled={busy || controls?.loading} onClick={() => openDetails()}>
                    단가 재요청
                  </Button>
                )}
              </span>
            </div>
          )
        })}
      </div>
    </> : null}
    {(!confirmed || (error && !visible)) && <div className="grid justify-items-center gap-2.5 text-center">
      {sentAt && <time dateTime={latest?.requestedAt} className="whitespace-nowrap text-xs leading-snug text-muted-foreground">
        {requestDay.format(sentAt)}<br />{requestClock.format(sentAt)} 발송
      </time>}
      {!confirmed && (waitingForRepeat
        ? <span role="status" className="inline-flex h-7 items-center whitespace-nowrap rounded-md bg-neutral-500 px-2.5 text-xs font-medium text-white">
          재요청중
        </span>
        : <Button type="button" size="sm" variant={waiting || showReplyActions ? 'ghost' : ready && !readOnly ? 'default' : 'outline'}
          className={waiting || showReplyActions ? 'h-7 bg-blue-700 px-1.5 text-white hover:bg-blue-800' : 'h-7 px-2.5'}
          disabled={busy || (readOnly && !latest && !manualPrice) || (showReplyActions && controls?.loading)}
          aria-haspopup="dialog" onClick={() => openDetails(showingManual ? manualPrice?.destination : undefined)}>
          {waiting ? '단가 계산중' : showingManual ? '단가 기록' : showReplyActions ? '단가 재요청' : reply ? '단가 확인' : '단가 요청'}
        </Button>)}
      {!confirmed && showReplyActions && confirm && <Button type="button" size="sm" className="h-7"
          disabled={busy || controls?.loading || Boolean(controls?.error)} onClick={() => void confirmReply()}>
          확정
        </Button>}
      {error && !visible && <p role="alert" className="break-words text-xs text-danger">{error}</p>}
      {sentAt && <p className="whitespace-nowrap text-sm font-semibold tabular-nums text-primary">
        + {elapsedMaterialRequestDays(sentAt.getTime(), Date.now())}days
      </p>}
    </div>}
    {visible && createPortal(
      <dialog ref={dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!busy) setOpen(false) }}
        className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-sm overflow-y-auto rounded-xl border border-border bg-card p-5 text-left text-card-foreground shadow-xl backdrop:bg-black/40">
        <h2 id={titleId} className="font-semibold">{latest ? `${latest.draftNo} 단가요청` : '단가 요청'}</h2>
        {waiting && <p role="status" className="mt-2 text-sm text-muted-foreground">{latest?.round}차 요청이 접수되어 중국팀 회신을 기다리고 있습니다.</p>}
        {!waiting && !readOnly && <label className="mt-3 grid gap-1.5 text-sm font-medium">
          제조국·제조처
          <Select value={destination} disabled={busy} onChange={event => selectDestination(event.currentTarget.value)}>
            <option value="" disabled>제조국·제조처 선택</option>
            {DRAFT_PRICE_DESTINATIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Select>
        </label>}
        {reply?.answeredAt && amounts && <div className="mt-3 rounded-lg border border-border px-3 py-2 text-sm">
          <p className="font-medium">{reply.round}차 회신 단가</p>
          <time dateTime={reply.answeredAt} className="text-xs text-muted-foreground">{replyDate.format(new Date(reply.answeredAt))} 회신</time>
          <dl className="mt-1 divide-y divide-border">
            {reply.colors.map(color => <div key={color.id} className="flex justify-between gap-3 py-1.5">
              <dt className="min-w-0 break-words">{color.name}</dt>
              <dd className="shrink-0 font-medium tabular-nums">¥{formatNumber(amounts[color.id])}</dd>
            </div>)}
          </dl>
        </div>}
        {manualPrice && (readOnly || destination !== manualPrice.destination) && <div className="mt-3 rounded-lg border border-border px-3 py-2 text-sm">
          <p className="font-medium">{DRAFT_PRICE_DESTINATIONS.find(option => option.value === manualPrice.destination)?.label} 단가 기록</p>
          {manualPrice.vendor && <p className="text-xs text-muted-foreground">{manualPrice.vendor}</p>}
          <dl className="mt-1 divide-y divide-border">
            {colors.map(color => {
              const amount = manualPrice.amounts[color.id]
              return <div key={color.id} className="flex justify-between gap-3 py-1.5">
                <dt className="min-w-0 break-words">{color.name}</dt>
                <dd className="shrink-0 tabular-nums">{typeof amount === 'number' ? `${formatNumber(amount)} ${manualPrice.currency}` : '—'}</dd>
              </div>
            })}
          </dl>
        </div>}
        {!waiting && !readOnly && chinaSelected && <div className="mt-3 space-y-2 text-sm text-muted-foreground">
          {!hasColors ? <p>컬러를 먼저 추가해 주세요.</p> : missingColors.length > 0 ? <>
            <p className="break-words text-danger">미등록 컬러 · {missingColors.join(', ')}</p>
            <p>컬러 문서에서 사진을 첨부하거나 None을 선택해 저장해 주세요.</p>
          </> : <p>등록된 컬러의 단가를 중국팀에 {latest ? '다시 ' : ''}요청합니다.</p>}
        </div>}
        {!waiting && !readOnly && manualSelected && <div className="mt-3 space-y-3 text-sm">
          <label className="grid gap-1.5">업체명 (선택)
            <Input value={vendor} maxLength={120} disabled={busy} onChange={event => setVendor(event.currentTarget.value)} />
          </label>
          <label className="grid gap-1.5">통화
            <Select value={currency} disabled={busy} onChange={event => setCurrency(event.currentTarget.value as CostCurrency)}>
              {Object.entries(COST_CURRENCY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </label>
          {!colors.length && <p className="text-muted-foreground">컬러를 먼저 추가해 주세요.</p>}
          {colors.map((color, index) => <label key={color.id} className="grid grid-cols-[minmax(0,1fr)_8rem] items-center gap-2">
            <span className="break-words">{color.name.trim() || `${index + 1}번 컬러`} 단가</span>
            <Input inputMode="decimal" maxLength={11} value={manualAmounts[color.id] ?? ''} disabled={busy}
              aria-invalid={Boolean(manualAmounts[color.id]) && parseDraftManualAmount(manualAmounts[color.id]) === null}
              onChange={event => {
                const value = event.currentTarget.value
                setManualAmounts(current => ({ ...current, [color.id]: value }))
              }} />
          </label>)}
        </div>}
        {!manualSelected && controls?.loading && <p role="status" className="mt-2 text-sm text-muted-foreground">단가요청을 불러오는 중입니다.</p>}
        {!manualSelected && controls?.error && <p role="alert" className="mt-2 text-sm text-danger">{controls.error}</p>}
        {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setOpen(false)}>닫기</Button>
          {!manualSelected && controls?.error && <Button type="button" size="sm" variant="outline" onClick={controls.retry}>다시 조회</Button>}
          {canSend && <Button type="button" size="sm" disabled={busy} onClick={() => void send()}>
            {busy ? '요청 저장 중' : '단가 요청 보내기'}
          </Button>}
          {!waiting && !readOnly && manualSelected && <Button type="button" size="sm" disabled={busy || !canSaveManual} onClick={() => void saveManual()}>
            {busy ? '저장 중' : '단가 기록 저장'}
          </Button>}
        </div>
      </dialog>, document.body,
    )}
  </>
}
