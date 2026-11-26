import { useEffect, useId, useRef, useState } from 'react'
import { useDraftLoading } from './DraftLoading'
import { createPortal } from 'react-dom'
import { Heart } from 'lucide-react'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { elapsedMaterialRequestDays } from '@/features/planning/material-request-days'
import {
  currentDraftManualPrice, draftPriceDestinationLabel, isDraftManualPriceDestination, isSharedDraftPriceDestination, parseDraftManualAmount,
  type DraftPriceDestinationChoice, type DraftPriceDestinationOption,
} from '@/lib/drafts/manual-price'
import { CHINA_TEAM_DESTINATION } from '@/lib/drafts/sample-receipt'
import { draftPriceError, type DraftPriceRequest, type SharedDraftPriceDestination } from '@/lib/supabase/draft-price-requests'
import { COST_CURRENCY_LABEL, type CostCurrency, type DraftColorRow, type DraftManualPrice } from '@/lib/types'
import { cn, formatNumber } from '@/lib/utils'
import { DraftPriceDestinationPicker } from './DraftPriceDestinationPicker'

export type DraftPriceControls = {
  latest?: DraftPriceRequest
  reply?: DraftPriceRequest
  loading: boolean
  error: string
  retry: () => void
  request: () => Promise<unknown>
  confirm?: (reply: DraftPriceRequest) => Promise<void>
  saveManual?: (price: Omit<DraftManualPrice, 'savedAt'>) => Promise<void>
  destinations?: {
    rows?: readonly SharedDraftPriceDestination[]
    loading?: boolean
    ready: boolean
    error: string
    retry: () => void
    add: (name: string) => Promise<SharedDraftPriceDestination>
    change: (option: DraftPriceDestinationOption, name: string | null) => Promise<SharedDraftPriceDestination>
  }
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

export function DraftPriceRequestButton({ readOnly, hasColors, missingColors, controls, confirmedRequestId, colors = [], manualPrice, selectedDestination, onSelectDestination }: {
  readOnly: boolean
  hasColors: boolean
  missingColors: string[]
  controls?: DraftPriceControls
  confirmedRequestId?: string
  colors?: readonly Pick<DraftColorRow, 'id' | 'name'>[]
  manualPrice?: DraftManualPrice
  selectedDestination?: DraftPriceDestinationChoice
  onSelectDestination: (choice?: DraftPriceDestinationChoice) => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pendingDestination, setPendingDestination] = useState<{ value: string; label: string }>()
  const [vendor, setVendor] = useState('')
  const [currency, setCurrency] = useState<CostCurrency>('CNY')
  const [manualAmounts, setManualAmounts] = useState<Record<string, string>>({})
  const active = useWorkspaceTabActivity()
  const dialog = useRef<HTMLDialogElement>(null)
  const confirmation = useRef<HTMLDialogElement>(null)
  const firstAmount = useRef<HTMLInputElement>(null)
  const titleId = useId()
  const confirmationTitleId = useId()
  const latest = controls?.latest
  const destinations = controls?.destinations
  const reply = controls?.reply
  const amounts = reply?.amounts
  const currentManualPrice = currentDraftManualPrice(manualPrice, latest?.requestedAt)
  const showingManual = Boolean(currentManualPrice)
  const displayedAmounts = currentManualPrice?.amounts ?? amounts
  const manualCurrency = currentManualPrice && COST_CURRENCY_LABEL[currentManualPrice.currency]
  const hasReply = Boolean(reply?.answeredAt && reply.id === latest?.id)
  const confirmed = !showingManual && hasReply && reply?.id === confirmedRequestId
  const confirm = controls?.confirm
  const showReplyActions = !showingManual && hasReply && !readOnly
  const waiting = Boolean(latest && !latest.answeredAt)
  const waitingForRepeat = waiting && (latest?.round ?? 0) > 1
  const requestedAt = waiting && latest ? new Date(latest.requestedAt) : null
  const sentAt = requestedAt && Number.isFinite(requestedAt.getTime()) ? requestedAt : null
  const ready = hasColors && missingColors.length === 0
  const confirmingChina = pendingDestination?.value === CHINA_TEAM_DESTINATION.value
  const destination = selectedDestination?.value ?? ''
  const editingManual = isDraftManualPriceDestination(destination) && !readOnly && !waiting && Boolean(controls?.saveManual)
  const sharedDestination = isSharedDraftPriceDestination(destination)
  const destinationLabel = selectedDestination && draftPriceDestinationLabel(selectedDestination, destinations?.rows)
  const canSend = Boolean(confirmingChina && controls && ready && !readOnly && !waiting && !controls.loading && !controls.error)
  const canSaveManual = Boolean(editingManual &&
    (!sharedDestination || destinationLabel) && colors.length &&
    colors.every(color => parseDraftManualAmount(manualAmounts[color.id] ?? '') !== null))
  const visible = open && active && (!readOnly || Boolean(latest || manualPrice))
  const showingConfirmation = visible && !readOnly && Boolean(pendingDestination)
  useDraftLoading(visible && controls?.loading && '단가요청을 불러오는 중…')
  useDraftLoading(visible && !waiting && !readOnly && destinations?.loading && '공용 제조처를 불러오는 중…')
  useDraftLoading(busy && '단가 정보를 저장하는 중…', true)

  useEffect(() => {
    if (!visible) return
    const current = dialog.current
    current?.showModal()
    return () => current?.close()
  }, [visible])

  useEffect(() => {
    if (!showingConfirmation) return
    const current = confirmation.current
    current?.showModal()
    return () => current?.close()
  }, [showingConfirmation])

  useEffect(() => {
    if (editingManual && active && !visible) firstAmount.current?.focus({ preventScroll: true })
  }, [editingManual, active, visible, destination])

  async function send() {
    if (!controls || !canSend || busy) return
    setBusy(true)
    setError('')
    try {
      await controls.request()
      setPendingDestination(undefined)
      selectDestination()
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

  function selectDestination(option?: DraftPriceDestinationChoice) {
    const value = option?.value ?? ''
    const saved = manualPrice?.destination === value ? manualPrice : undefined
    onSelectDestination(option)
    setVendor(saved?.vendor ?? '')
    setCurrency(saved?.currency ?? (value === '한국' ? 'KRW' : value === 'other' || isSharedDraftPriceDestination(value) ? 'USD' : 'CNY'))
    setManualAmounts(saved ? Object.fromEntries(Object.entries(saved.amounts).map(([id, amount]) => [id, String(amount)])) : {})
    setError('')
  }

  function openDetails() {
    setError('')
    setPendingDestination(undefined)
    setOpen(true)
  }

  function askDestination(option: { value: string; label: string }) {
    setError('')
    setPendingDestination(option)
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
      await controls.saveManual({ destination, destinationLabel, vendor: vendor.trim(), currency, amounts })
      selectDestination()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '단가를 저장하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return <>
    {editingManual && <form className="draft-price-manual" onSubmit={event => { event.preventDefault(); void saveManual() }}>
      <div className="draft-color-pad justify-center">
        <Select aria-label="통화" value={currency} disabled={busy} className="h-7 w-full max-w-24 px-1 text-xs"
          onChange={event => setCurrency(event.currentTarget.value as CostCurrency)}>
          {Object.entries(COST_CURRENCY_LABEL).map(([value, label]) => <option key={value} value={value} title={label}>{value}</option>)}
        </Select>
      </div>
      <div className="draft-color-lines draft-price-amounts">
        {colors.map((color, index) => <div key={color.id} className={cn('draft-color-line', index % 2 === 1 && 'is-alt')}>
          <Input ref={index === 0 ? firstAmount : undefined} className="h-7 min-w-0 max-w-24 px-1 text-center text-xs tabular-nums"
            aria-label={`${color.name.trim() || `${index + 1}번 컬러`} 단가`} inputMode="decimal" maxLength={11}
            value={manualAmounts[color.id] ?? ''} disabled={busy}
            aria-invalid={Boolean(manualAmounts[color.id]) && parseDraftManualAmount(manualAmounts[color.id]) === null}
            onChange={event => {
              const value = event.currentTarget.value
              setManualAmounts(current => ({ ...current, [color.id]: value }))
            }} />
        </div>)}
      </div>
      <div className="mx-auto grid w-full max-w-28 gap-1.5">
        <p className="break-words text-xs font-medium" title={destinationLabel}>{destinationLabel}</p>
        <Input aria-label="업체명 (선택)" placeholder="업체명 (선택)" value={vendor} maxLength={120} disabled={busy}
          className="h-7 min-w-0 px-1 text-xs" onChange={event => setVendor(event.currentTarget.value)} />
        {!colors.length && <p className="text-xs text-muted-foreground">컬러를 먼저 추가해 주세요.</p>}
        <Button size="sm" type="submit" disabled={busy || !canSaveManual} className="h-7 px-1">
          {busy ? '저장 중' : '저장'}
        </Button>
        <Button size="sm" type="button" variant="outline" className="h-7 px-1" disabled={busy}
          aria-haspopup="dialog" onClick={openDetails}>제조국 변경</Button>
        <Button size="sm" type="button" variant="ghost" className="h-6 px-1 text-muted-foreground" disabled={busy}
          onClick={() => selectDestination()}>취소</Button>
        {error && !visible && <p role="alert" className="break-words text-xs text-danger">{error}</p>}
      </div>
    </form>}
    {!editingManual && displayedAmounts && colors.length ? <>
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
    {!editingManual && (!confirmed || (error && !visible)) && <div className="grid justify-items-center gap-2.5 text-center">
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
          aria-haspopup={showingManual && !readOnly && controls?.saveManual ? undefined : 'dialog'} onClick={() => {
            if (showingManual && manualPrice && !readOnly && !waiting && controls?.saveManual) {
              selectDestination({ value: manualPrice.destination, label: manualPrice.destinationLabel })
            } else openDetails()
          }}>
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
        className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-max min-w-[min(24rem,calc(100%-2rem))] max-w-[calc(100%-2rem)] overflow-y-auto rounded-xl border border-border bg-card p-5 text-left text-card-foreground shadow-xl backdrop:bg-black/40">
        <h2 id={titleId} className="font-semibold">{latest ? `${latest.draftNo} 단가요청` : '단가 요청'}</h2>
        {waiting && <p role="status" className="mt-2 text-sm text-muted-foreground">{latest?.round}차 요청이 접수되어 중국팀 회신을 기다리고 있습니다.</p>}
        {!waiting && !readOnly && <DraftPriceDestinationPicker value={destination} onChange={askDestination}
          disabled={busy} shared={destinations?.rows ?? []} ready={Boolean(destinations?.ready)}
          error={destinations?.error} retry={destinations?.retry}
          onAdd={destinations ? async name => {
            setBusy(true)
            try {
              const row = await destinations.add(name)
              askDestination({ value: row.preset_key ?? row.id, label: row.name })
            } finally {
              setBusy(false)
            }
          } : undefined}
          onEdit={destinations ? async (option, name) => {
            setBusy(true)
            try {
              await destinations.change(option, name)
              if (name === null && option.value === destination) selectDestination()
            } finally {
              setBusy(false)
            }
          } : undefined} />}
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
          <p className="font-medium">{draftPriceDestinationLabel({ value: manualPrice.destination, label: manualPrice.destinationLabel })} 단가 기록</p>
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
        {controls?.loading && <p role="status" className="mt-2 text-sm text-muted-foreground">단가요청을 불러오는 중입니다.</p>}
        {controls?.error && <p role="alert" className="mt-2 text-sm text-danger">{controls.error}</p>}
        {error && !showingConfirmation && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setOpen(false)}>닫기</Button>
          {controls?.error && <Button type="button" size="sm" variant="outline" onClick={controls.retry}>다시 조회</Button>}
        </div>
        {showingConfirmation && pendingDestination && <dialog ref={confirmation} aria-labelledby={confirmationTitleId}
          aria-describedby={`${confirmationTitleId}-description`}
          className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-sm overflow-y-auto rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xl backdrop:bg-black/40"
          onCancel={event => {
            event.preventDefault()
            event.stopPropagation()
            if (!busy) {
              setPendingDestination(undefined)
              setError('')
            }
          }}>
          <h2 id={confirmationTitleId} className="font-semibold">{confirmingChina ? '중국팀 단가 요청 확인' : '단가 수기 입력 확인'}</h2>
          <p id={`${confirmationTitleId}-description`} className="mt-2 break-words text-sm text-muted-foreground">
            <strong className="font-medium text-foreground">{pendingDestination.label}</strong>
            {confirmingChina ? '의 컬러별 단가를 중국팀에 요청합니다.' : '의 컬러별 단가를 기획안에 직접 입력해 저장합니다.'}
          </p>
          {confirmingChina && <div className="mt-2 space-y-1 text-sm text-muted-foreground">
            {waiting ? <p>이미 중국팀 회신을 기다리고 있습니다.</p>
              : !hasColors ? <p>컬러를 먼저 추가해 주세요.</p>
                : missingColors.length > 0 && <>
                  <p className="break-words text-danger">미등록 컬러 · {missingColors.join(', ')}</p>
                  <p>컬러 문서에서 사진을 첨부하거나 None을 선택해 저장해 주세요.</p>
                </>}
            {controls?.loading && <p role="status">단가요청을 불러오는 중입니다.</p>}
            {controls?.error && <p role="alert" className="text-danger">{controls.error}</p>}
          </div>}
          {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => {
              setPendingDestination(undefined)
              setError('')
            }}>취소</Button>
            {confirmingChina ? <Button type="button" size="sm" disabled={!canSend || busy} onClick={() => void send()}>
              {busy ? '요청 저장 중' : '중국팀에 요청 보내기'}
            </Button> : <Button type="button" size="sm" disabled={waiting || busy} onClick={() => {
              if (pendingDestination.value !== destination) selectDestination(pendingDestination)
              setPendingDestination(undefined)
              setOpen(false)
            }}>수기 입력 계속</Button>}
          </div>
        </dialog>}
      </dialog>, document.body,
    )}
  </>
}
