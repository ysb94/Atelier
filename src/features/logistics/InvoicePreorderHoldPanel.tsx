import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarCheck, CalendarPlus, Pencil, Plus, Trash2 } from 'lucide-react'
import { StylePicker, formatStyleRef } from '@/components/style-picker'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  createInvoicePreorderHold,
  deleteInvoicePreorderHold,
  endInvoicePreorderHold,
  extendInvoicePreorderHold,
  getInvoicePreorderHolds,
  listStyleRefsByStyleNos,
  updateInvoicePreorderHold,
} from '@/lib/api'
import { normalizeStyleNo } from '@/lib/import/transform'
import type {
  InvoicePreorderHold,
  InvoicePreorderHoldExtension,
  StyleRef,
} from '@/lib/types'
import { cn, formatNumber } from '@/lib/utils'

export const PREORDER_REASON_SUGGESTIONS = [
  '입고 지연',
  '출고량 급증',
  '재고 부족',
] as const

type ListTab = 'active' | 'past'

type DraftRow = {
  key: string
  style: StyleRef | null
  rawStyleNo: string
  startedOn: string
  shipOn: string
  reason: string
  resolveError: string | null
}

function todayYmd() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function formatYmd(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const [year, month, day] = value.split('-')
  return `${year}.${month}.${day}`
}

function daysBetween(fromYmd: string, toYmd: string) {
  const from = new Date(`${fromYmd}T00:00:00`)
  const to = new Date(`${toYmd}T00:00:00`)
  return Math.round((to.getTime() - from.getTime()) / 86_400_000)
}

function ShipOnWithDelayHistory({
  shipOn,
  extensions,
  open,
  onToggle,
}: {
  shipOn: string
  extensions: InvoicePreorderHoldExtension[]
  open: boolean
  onToggle: () => void
}) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{
    left: number
    maxHeight: number
    placement: 'above' | 'below'
    anchor: number
  } | null>(null)
  const delayCount = extensions.length

  function updatePosition() {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const width = Math.min(352, window.innerWidth * 0.7)
    const margin = 8
    const gap = 4
    const spaceBelow = window.innerHeight - rect.bottom - gap - margin
    const spaceAbove = rect.top - gap - margin
    const preferredMax = Math.min(window.innerHeight * 0.5, 384)
    const placement: 'above' | 'below' =
      spaceBelow >= 180 || spaceBelow >= spaceAbove ? 'below' : 'above'
    const available = placement === 'below' ? spaceBelow : spaceAbove
    const maxHeight = Math.max(120, Math.min(preferredMax, available))
    const left = Math.min(
      Math.max(margin, rect.left),
      window.innerWidth - width - margin,
    )
    setPos({
      left,
      maxHeight,
      placement,
      anchor: placement === 'below' ? rect.bottom + gap : window.innerHeight - rect.top + gap,
    })
  }

  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    updatePosition()
  }, [open, delayCount])

  useEffect(() => {
    if (!open) return
    const onMove = () => updatePosition()
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [open])

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span>{formatYmd(shipOn)}</span>
      {delayCount > 0 ? (
        <button
          ref={triggerRef}
          type="button"
          onClick={onToggle}
          className="rounded-full border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning"
          aria-expanded={open}
        >
          {formatNumber(delayCount)}회 지연
        </button>
      ) : null}
      {open && delayCount > 0 && pos
        ? createPortal(
            <>
              <button
                type="button"
                aria-label="지연 이력 닫기"
                className="fixed inset-0 z-[60] cursor-default bg-transparent"
                onClick={onToggle}
              />
              <div
                role="dialog"
                aria-label="지연 이력"
                className="fixed z-[70] w-[min(22rem,70vw)] overflow-auto rounded-lg border border-border bg-card p-3 text-left shadow-xl"
                style={{
                  left: pos.left,
                  maxHeight: pos.maxHeight,
                  ...(pos.placement === 'below'
                    ? { top: pos.anchor }
                    : { bottom: pos.anchor }),
                }}
              >
                <p className="mb-2 text-[11px] font-medium text-foreground">
                  지연 이력
                </p>
                <ul className="space-y-2">
                  {extensions.map((entry) => {
                    const days = daysBetween(
                      entry.previousShipOn,
                      entry.newShipOn,
                    )
                    return (
                      <li
                        key={entry.id}
                        className="rounded-md border border-border/80 bg-muted/20 px-2.5 py-2 text-[11px]"
                      >
                        <p className="font-medium text-foreground">
                          {formatYmd(entry.previousShipOn)} →{' '}
                          {formatYmd(entry.newShipOn)}
                          <span className="ml-1.5 text-muted-foreground">
                            ({days > 0 ? `+${days}` : days}일)
                          </span>
                        </p>
                        <p className="mt-0.5 text-muted-foreground">
                          {entry.reason}
                        </p>
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          {new Date(entry.createdAt).toLocaleString('ko-KR', {
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </li>
                    )
                  })}
                </ul>
              </div>
            </>,
            document.body,
          )
        : null}
    </div>
  )
}

function newDraftKey() {
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function emptyDraft(
  seed: Partial<Pick<DraftRow, 'startedOn' | 'shipOn' | 'reason'>> = {},
): DraftRow {
  return {
    key: newDraftKey(),
    style: null,
    rawStyleNo: '',
    startedOn: seed.startedOn ?? todayYmd(),
    shipOn: seed.shipOn ?? '',
    reason: seed.reason ?? '',
    resolveError: null,
  }
}

/** 줄바꿈·쉼표·공백으로 나뉜 M번호를 순서 유지·중복 제거해 뽑는다. */
export function parsePreorderStyleNos(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const token of text.split(/[\n,;\t\s]+/)) {
    const trimmed = token.trim()
    if (!trimmed) continue
    const key = normalizeStyleNo(trimmed)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
  }
  return out
}

function resolveStyleRef(
  byStyleNo: Map<string, StyleRef>,
  raw: string,
): StyleRef | undefined {
  const normalized = normalizeStyleNo(raw)
  return (
    byStyleNo.get(normalized) ??
    byStyleNo.get(raw.trim().toLocaleLowerCase('ko-KR'))
  )
}

function draftReady(row: DraftRow) {
  return Boolean(
    row.style &&
      row.startedOn.trim() &&
      row.shipOn.trim() &&
      row.reason.trim() &&
      row.shipOn >= row.startedOn &&
      !row.resolveError,
  )
}

export function InvoicePreorderHoldPanel({ brandId }: { brandId: string }) {
  const queryClient = useQueryClient()
  const queryKey = ['invoice-preorder-holds', brandId] as const
  const listQuery = useQuery({
    queryKey,
    queryFn: () => getInvoicePreorderHolds(brandId, 'all'),
  })

  const [tab, setTab] = useState<ListTab>('active')
  const [drafts, setDrafts] = useState<DraftRow[]>(() => [emptyDraft()])
  const [pasteBusy, setPasteBusy] = useState(false)
  const [duplicateErrors, setDuplicateErrors] = useState<string[] | null>(null)
  const [editingHold, setEditingHold] = useState<InvoicePreorderHold | null>(
    null,
  )
  const [editStartedOn, setEditStartedOn] = useState('')
  const [editShipOn, setEditShipOn] = useState('')
  const [editReason, setEditReason] = useState('')
  const [extendingHold, setExtendingHold] =
    useState<InvoicePreorderHold | null>(null)
  const [extendShipOn, setExtendShipOn] = useState('')
  const [extendReason, setExtendReason] = useState('')
  const [endingHold, setEndingHold] = useState<InvoicePreorderHold | null>(null)
  const [endOn, setEndOn] = useState(todayYmd)
  const [endReason, setEndReason] = useState('')
  const [deletingHold, setDeletingHold] =
    useState<InvoicePreorderHold | null>(null)
  const [historyHoldId, setHistoryHoldId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [messageIsError, setMessageIsError] = useState(false)

  const items = listQuery.data ?? []
  const activeItems = useMemo(
    () => items.filter((item) => item.status === 'active'),
    [items],
  )
  const pastItems = useMemo(
    () => items.filter((item) => item.status === 'ended'),
    [items],
  )
  const tabItems = tab === 'active' ? activeItems : pastItems
  const readyCount = drafts.filter(draftReady).length
  const today = todayYmd()

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ko-KR')
    const rows = needle
      ? tabItems.filter((item) =>
          `${item.styleNo} ${item.name} ${item.reason} ${item.startedOn} ${item.shipOn}`
            .toLocaleLowerCase('ko-KR')
            .includes(needle),
        )
      : tabItems
    return [...rows].sort((left, right) => {
      if (tab === 'past') {
        return (
          (right.clearedAt ?? '').localeCompare(left.clearedAt ?? '') ||
          right.shipOn.localeCompare(left.shipOn) ||
          left.styleNo.localeCompare(right.styleNo, 'ko-KR')
        )
      }
      return (
        left.shipOn.localeCompare(right.shipOn) ||
        left.startedOn.localeCompare(right.startedOn) ||
        left.styleNo.localeCompare(right.styleNo, 'ko-KR')
      )
    })
  }, [query, tab, tabItems])

  function setCache(
    updater: (current: InvoicePreorderHold[]) => InvoicePreorderHold[],
  ) {
    queryClient.setQueryData<InvoicePreorderHold[]>(queryKey, (current) =>
      current ? updater(current) : current,
    )
  }

  function patchDraft(key: string, patch: Partial<DraftRow>) {
    setDrafts((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    )
  }

  function removeDraft(key: string) {
    setDrafts((current) => {
      const next = current.filter((row) => row.key !== key)
      return next.length > 0 ? next : [emptyDraft()]
    })
  }

  async function expandFromStyleNos(
    styleNos: string[],
    seed: Pick<DraftRow, 'startedOn' | 'shipOn' | 'reason'>,
  ) {
    setPasteBusy(true)
    try {
      const byStyleNo = await listStyleRefsByStyleNos(brandId, styleNos)
      const activeIds = new Set(activeItems.map((item) => item.styleId))
      const alreadyActive: string[] = []
      setDrafts(
        styleNos.map((raw) => {
          const style = resolveStyleRef(byStyleNo, raw) ?? null
          const already =
            style != null && activeIds.has(style.styleId)
              ? '이미 진행 중 예발에 등록된 상품'
              : null
          if (already && style) alreadyActive.push(style.styleNo)
          return {
            key: newDraftKey(),
            style,
            rawStyleNo: raw,
            startedOn: seed.startedOn || todayYmd(),
            // 번호마다 다르게 적도록 예정일·사유는 비워 둔다.
            shipOn: '',
            reason: '',
            resolveError: style
              ? already
              : '데이터 시트에 없는 M번호',
          }
        }),
      )
      if (alreadyActive.length > 0) {
        setDuplicateErrors([...new Set(alreadyActive)])
      }
      setMessageIsError(false)
      setMessage(
        `${formatNumber(styleNos.length)}개 행으로 펼쳤습니다. 번호마다 시작일·예정일·사유를 맞춘 뒤 추가하세요.`,
      )
    } catch (reason) {
      setMessageIsError(true)
      setMessage(
        reason instanceof Error
          ? reason.message
          : 'M번호를 펼치지 못했습니다.',
      )
    } finally {
      setPasteBusy(false)
    }
  }

  function handleStyleNosPaste(
    event: ClipboardEvent,
    seed: Pick<DraftRow, 'startedOn' | 'shipOn' | 'reason'>,
  ) {
    const text = event.clipboardData.getData('text')
    const styleNos = parsePreorderStyleNos(text)
    if (styleNos.length <= 1) return
    event.preventDefault()
    void expandFromStyleNos(styleNos, seed)
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      const targets = drafts.filter(draftReady)
      if (targets.length === 0) {
        throw new Error('상품·시작일·예정일·사유를 채운 행이 없습니다.')
      }
      for (const row of targets) {
        if (row.shipOn < row.startedOn) {
          throw new Error(
            `${row.style?.styleNo ?? row.rawStyleNo}: 출고 예정일은 예발 시작일 이후여야 합니다.`,
          )
        }
      }

      const activeIds = new Set(activeItems.map((item) => item.styleId))
      const created: InvoicePreorderHold[] = []
      const duplicates: string[] = []
      const failed: string[] = []
      const seenDraft = new Set<string>()

      for (const row of targets) {
        const style = row.style!
        if (seenDraft.has(style.styleId)) {
          duplicates.push(style.styleNo)
          continue
        }
        if (activeIds.has(style.styleId)) {
          duplicates.push(style.styleNo)
          continue
        }
        seenDraft.add(style.styleId)
        try {
          const hold = await createInvoicePreorderHold(brandId, {
            styleId: style.styleId,
            startedOn: row.startedOn,
            shipOn: row.shipOn,
            reason: row.reason,
          })
          created.push(hold)
          activeIds.add(style.styleId)
        } catch (reason) {
          if (
            reason instanceof Error &&
            /이미 진행 중|unique|duplicate/i.test(reason.message)
          ) {
            duplicates.push(style.styleNo)
            activeIds.add(style.styleId)
            continue
          }
          failed.push(style.styleNo)
        }
      }

      return { created, duplicates, failed }
    },
    onSuccess: ({ created, duplicates, failed }) => {
      const createdIds = new Set(created.map((item) => item.styleId))
      const duplicateNos = new Set(duplicates)

      if (created.length > 0) {
        setCache((current) => [...created, ...current])
        setTab('active')
      }

      setDrafts((current) => {
        const remaining = current
          .filter((row) => {
            if (!row.style) return true
            if (createdIds.has(row.style.styleId)) return false
            return true
          })
          .map((row) =>
            row.style && duplicateNos.has(row.style.styleNo)
              ? {
                  ...row,
                  resolveError: '이미 진행 중 예발에 등록된 상품',
                }
              : row,
          )
        return remaining.length > 0 ? remaining : [emptyDraft()]
      })

      if (duplicates.length > 0) {
        setDuplicateErrors([...new Set(duplicates)])
      }

      const parts: string[] = []
      if (created.length > 0) {
        parts.push(`${formatNumber(created.length)}건 저장`)
      }
      if (duplicates.length > 0) {
        parts.push(
          `이미 등록 ${formatNumber(new Set(duplicates).size)}건은 제외`,
        )
      }
      if (failed.length > 0) {
        parts.push(
          `저장 실패 ${failed.slice(0, 8).join(', ')}${failed.length > 8 ? '…' : ''}`,
        )
      }
      setMessageIsError(failed.length > 0 && created.length === 0)
      setMessage(parts.join(' · ') || '저장할 항목이 없습니다.')
    },
    onError: (reason) => {
      setMessageIsError(true)
      setMessage(
        reason instanceof Error ? reason.message : '예발을 저장하지 못했습니다.',
      )
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({
      holdId,
      startedOn,
      shipOn,
      reason,
    }: {
      holdId: string
      startedOn: string
      shipOn: string
      reason: string
    }) =>
      updateInvoicePreorderHold(brandId, holdId, {
        startedOn,
        shipOn,
        reason,
      }),
    onSuccess: (updated) => {
      setCache((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      )
      setEditingHold(null)
      setMessageIsError(false)
      setMessage('예발 정보를 수정했습니다.')
    },
    onError: (reason) => {
      setMessageIsError(true)
      setMessage(
        reason instanceof Error
          ? reason.message
          : '예발 정보를 바꾸지 못했습니다.',
      )
      void queryClient.invalidateQueries({ queryKey })
    },
  })

  const extendMutation = useMutation({
    mutationFn: ({
      holdId,
      newShipOn,
      reason,
    }: {
      holdId: string
      newShipOn: string
      reason: string
    }) =>
      extendInvoicePreorderHold(brandId, holdId, {
        newShipOn,
        reason,
      }),
    onSuccess: (updated) => {
      setCache((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      )
      setExtendingHold(null)
      setExtendShipOn('')
      setExtendReason('')
      setMessageIsError(false)
      setMessage(
        `${updated.styleNo} 출고 예정일을 ${formatYmd(updated.shipOn)}로 연장했습니다.`,
      )
    },
    onError: (reason) => {
      setMessageIsError(true)
      setMessage(
        reason instanceof Error
          ? reason.message
          : '출고 예정일을 연장하지 못했습니다.',
      )
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (holdId: string) => deleteInvoicePreorderHold(brandId, holdId),
    onSuccess: (_result, holdId) => {
      const removed = deletingHold
      setCache((current) => current.filter((item) => item.id !== holdId))
      setDeletingHold(null)
      setMessageIsError(false)
      setMessage(
        removed
          ? `${removed.styleNo} 잘못 등록한 예발을 삭제했습니다.`
          : '잘못 등록한 예발을 삭제했습니다.',
      )
    },
    onError: (reason) => {
      setMessageIsError(true)
      setMessage(
        reason instanceof Error
          ? reason.message
          : '예발을 삭제하지 못했습니다.',
      )
    },
  })

  const endMutation = useMutation({
    mutationFn: ({
      holdId,
      endedOn,
      endedReason,
    }: {
      holdId: string
      endedOn: string
      endedReason: string
    }) => endInvoicePreorderHold(brandId, holdId, { endedOn, endedReason }),
    onSuccess: (ended) => {
      setCache((current) =>
        current.map((item) => (item.id === ended.id ? ended : item)),
      )
      setEndingHold(null)
      setEndReason('')
      setMessageIsError(false)
      setMessage(
        `${ended.styleNo} 예발을 ${formatYmd(ended.endedOn ?? '')}에 종료했습니다.`,
      )
    },
    onError: (reason) => {
      setMessageIsError(true)
      setMessage(
        reason instanceof Error ? reason.message : '예발을 종료하지 못했습니다.',
      )
    },
  })

  function openEdit(hold: InvoicePreorderHold) {
    setEditingHold(hold)
    setEditStartedOn(hold.startedOn)
    setEditShipOn(hold.shipOn)
    setEditReason(hold.reason)
  }

  function openExtend(hold: InvoicePreorderHold) {
    setExtendingHold(hold)
    setExtendShipOn('')
    setExtendReason('')
  }

  function openEnd(hold: InvoicePreorderHold) {
    setEndingHold(hold)
    setEndOn(todayYmd())
    setEndReason('')
  }

  function saveEdit() {
    if (!editingHold) return
    if (!editStartedOn.trim() || !editShipOn.trim()) {
      setMessageIsError(true)
      setMessage('예발 시작일과 출고 예정일은 비울 수 없습니다.')
      return
    }
    if (editShipOn < editStartedOn) {
      setMessageIsError(true)
      setMessage('출고 예정일은 예발 시작일 이후여야 합니다.')
      return
    }
    if (!editReason.trim()) {
      setMessageIsError(true)
      setMessage('예발 사유는 비울 수 없습니다.')
      return
    }
    updateMutation.mutate({
      holdId: editingHold.id,
      startedOn: editStartedOn,
      shipOn: editShipOn,
      reason: editReason,
    })
  }

  function saveExtend() {
    if (!extendingHold) return
    if (!extendShipOn.trim()) {
      setMessageIsError(true)
      setMessage('연장 출고 예정일을 정하세요.')
      return
    }
    if (extendShipOn <= extendingHold.shipOn) {
      setMessageIsError(true)
      setMessage('연장 출고 예정일은 현재 예정일보다 뒤여야 합니다.')
      return
    }
    if (!extendReason.trim()) {
      setMessageIsError(true)
      setMessage('연장 사유를 적으세요.')
      return
    }
    extendMutation.mutate({
      holdId: extendingHold.id,
      newShipOn: extendShipOn,
      reason: extendReason,
    })
  }

  function saveEnd() {
    if (!endingHold) return
    if (!endOn.trim()) {
      setMessageIsError(true)
      setMessage('종료일을 정하세요.')
      return
    }
    if (endOn < endingHold.startedOn) {
      setMessageIsError(true)
      setMessage('종료일은 예발 시작일 이후여야 합니다.')
      return
    }
    if (endOn !== endingHold.shipOn && !endReason.trim()) {
      setMessageIsError(true)
      setMessage('종료일이 출고 예정일과 다르면 사유를 적으세요.')
      return
    }
    endMutation.mutate({
      holdId: endingHold.id,
      endedOn: endOn,
      endedReason: endReason,
    })
  }

  const busy =
    createMutation.isPending ||
    updateMutation.isPending ||
    extendMutation.isPending ||
    endMutation.isPending ||
    deleteMutation.isPending ||
    pasteBusy

  return (
    <>
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>예발 목록</CardTitle>
          <CardDescription className="mt-1">
            기본은 한 줄입니다. M번호를 여러 줄로 붙여 넣으면 번호마다
            시작일·예정일·사유를 따로 적습니다. 예정일이 지나도 「종료」하기
            전까지는 예발 상태로 둡니다.
          </CardDescription>
        </div>
        <Badge variant="warning">
          진행 {formatNumber(activeItems.length)} · 과거{' '}
          {formatNumber(pastItems.length)}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 rounded-lg border border-border bg-muted/10 p-3">
          <div className="space-y-2">
            {drafts.map((row, index) => (
              <div key={row.key} className="space-y-1">
                <div className="grid items-end gap-2 xl:grid-cols-[minmax(0,1.5fr)_9.5rem_9.5rem_minmax(0,1fr)_auto]">
                  <div className="min-w-0 space-y-1">
                    {index === 0 ? (
                      <p className="text-[11px] font-medium text-muted-foreground">
                        상품 / M번호 붙여넣기
                      </p>
                    ) : (
                      <p className="sr-only">상품 {index + 1}</p>
                    )}
                    {row.style ? (
                      <div className="flex min-w-0 items-center gap-1">
                        <span className="inline-flex min-w-0 flex-1 items-center rounded-md border border-amber-500/35 bg-amber-500/10 px-2 py-1.5 text-xs">
                          <span className="shrink-0 font-semibold tabular-nums">
                            {row.style.styleNo}
                          </span>
                          <span className="mx-1 shrink-0 text-muted-foreground/70">
                            ·
                          </span>
                          <span className="min-w-0 truncate text-muted-foreground">
                            {row.style.name}
                          </span>
                        </span>
                        <button
                          type="button"
                          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                          disabled={busy}
                          onClick={() =>
                            patchDraft(row.key, {
                              style: null,
                              rawStyleNo: '',
                              resolveError: null,
                            })
                          }
                          aria-label="선택 해제"
                        >
                          ×
                        </button>
                      </div>
                    ) : row.resolveError ? (
                      <div className="flex min-w-0 items-center gap-1">
                        <Input
                          value={row.rawStyleNo}
                          readOnly
                          className="h-9 font-mono text-xs text-danger"
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-9 px-2 text-danger"
                          disabled={busy}
                          onClick={() => removeDraft(row.key)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <div
                        onPasteCapture={(event) =>
                          handleStyleNosPaste(event, {
                            startedOn: row.startedOn,
                            shipOn: row.shipOn,
                            reason: row.reason,
                          })
                        }
                      >
                        <StylePicker
                          brandId={brandId}
                          value={row.style}
                          onChange={(style) => {
                            const already =
                              style != null &&
                              activeItems.some(
                                (item) => item.styleId === style.styleId,
                              )
                            patchDraft(row.key, {
                              style,
                              rawStyleNo: style?.styleNo ?? '',
                              resolveError: already
                                ? '이미 진행 중 예발에 등록된 상품'
                                : null,
                            })
                            if (already && style) {
                              setDuplicateErrors([style.styleNo])
                            }
                          }}
                          inputClassName="h-9"
                          disabled={busy}
                        />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 space-y-1">
                    {index === 0 ? (
                      <p className="text-[11px] font-medium text-muted-foreground">
                        예발 시작일
                      </p>
                    ) : (
                      <p className="sr-only">예발 시작일</p>
                    )}
                    <Input
                      type="date"
                      value={row.startedOn}
                      disabled={busy}
                      onChange={(event) =>
                        patchDraft(row.key, {
                          startedOn: event.target.value,
                        })
                      }
                      aria-label={`${row.style?.styleNo ?? index + 1} 예발 시작일`}
                      className="h-9 text-xs"
                    />
                  </div>
                  <div className="min-w-0 space-y-1">
                    {index === 0 ? (
                      <p className="text-[11px] font-medium text-muted-foreground">
                        출고 예정일
                      </p>
                    ) : (
                      <p className="sr-only">출고 예정일</p>
                    )}
                    <Input
                      type="date"
                      value={row.shipOn}
                      min={row.startedOn || todayYmd()}
                      disabled={busy}
                      onChange={(event) =>
                        patchDraft(row.key, { shipOn: event.target.value })
                      }
                      aria-label={`${row.style?.styleNo ?? index + 1} 출고 예정일`}
                      className="h-9 text-xs"
                    />
                  </div>
                  <div className="min-w-0 space-y-1">
                    {index === 0 ? (
                      <p className="text-[11px] font-medium text-muted-foreground">
                        예발 사유
                      </p>
                    ) : (
                      <p className="sr-only">예발 사유</p>
                    )}
                    <Input
                      list="preorder-reason-suggestions"
                      value={row.reason}
                      disabled={busy}
                      onChange={(event) =>
                        patchDraft(row.key, { reason: event.target.value })
                      }
                      placeholder="입고 지연, 출고량 급증…"
                      className="h-9 text-xs"
                    />
                  </div>
                  <div className="flex items-end gap-1">
                    {drafts.length > 1 ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-9 px-2 text-danger"
                        disabled={busy}
                        onClick={() => removeDraft(row.key)}
                        aria-label="행 삭제"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    ) : null}
                    {index === drafts.length - 1 ? (
                      <Button
                        type="button"
                        size="sm"
                        className="h-9"
                        disabled={busy || readyCount === 0}
                        onClick={() => createMutation.mutate()}
                      >
                        <Plus className="size-3.5" />
                        {createMutation.isPending
                          ? '저장 중'
                          : readyCount > 1
                            ? `${formatNumber(readyCount)}건 추가`
                            : '예발 추가'}
                      </Button>
                    ) : (
                      <span className="inline-block h-9 w-[5.5rem]" />
                    )}
                  </div>
                </div>
                {row.resolveError ? (
                  <p className="text-[11px] text-danger">{row.resolveError}</p>
                ) : null}
              </div>
            ))}
          </div>

          <datalist id="preorder-reason-suggestions">
            {PREORDER_REASON_SUGGESTIONS.map((reason) => (
              <option key={reason} value={reason} />
            ))}
          </datalist>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1.5">
              {PREORDER_REASON_SUGGESTIONS.map((reason) => (
                <button
                  key={reason}
                  type="button"
                  disabled={busy || drafts.length !== 1}
                  onClick={() =>
                    setDrafts((current) =>
                      current.map((row, index) =>
                        index === 0 ? { ...row, reason } : row,
                      ),
                    )
                  }
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-[11px]',
                    drafts.length === 1 && drafts[0]?.reason === reason
                      ? 'border-primary/40 bg-primary/10 text-foreground'
                      : 'border-border text-muted-foreground hover:bg-muted/50',
                    drafts.length !== 1 && 'opacity-50',
                  )}
                >
                  {reason}
                </button>
              ))}
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              disabled={busy}
              onClick={() =>
                setDrafts((current) => [
                  ...current,
                  emptyDraft({
                    startedOn: current[0]?.startedOn,
                    shipOn: '',
                    reason: '',
                  }),
                ])
              }
            >
              행 추가
            </Button>
          </div>
        </div>

        {listQuery.isError ? (
          <p className="text-xs text-danger">
            {listQuery.error instanceof Error
              ? listQuery.error.message
              : '예발 목록을 불러오지 못했습니다.'}
          </p>
        ) : null}

        {message ? (
          <p
            className={cn(
              'text-xs',
              messageIsError ? 'text-danger' : 'text-muted-foreground',
            )}
          >
            {message}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-border p-0.5">
            {(
              [
                ['active', '진행 중', activeItems.length],
                ['past', '과거 기록', pastItems.length],
              ] as const
            ).map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                aria-pressed={tab === value}
                onClick={() => setTab(value)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-[11px] font-medium',
                  tab === value
                    ? 'bg-primary/10 text-foreground'
                    : 'text-muted-foreground hover:bg-muted/40',
                )}
              >
                {label} {formatNumber(count)}
              </button>
            ))}
          </div>
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="M번호·상품명·사유·날짜 검색"
            aria-label="예발 목록 검색"
            className="h-8 max-w-xs text-xs"
          />
        </div>

        <div className="max-h-[min(60vh,32rem)] overflow-auto rounded-lg border border-border">
          <table className="w-full min-w-[1080px] text-left text-xs">
            <thead className="sticky top-0 z-10 bg-muted/90">
              <tr>
                <th className="px-3 py-2 font-medium">M번호</th>
                <th className="px-3 py-2 font-medium">상품명</th>
                <th className="px-3 py-2 font-medium">예발 시작일</th>
                <th className="px-3 py-2 font-medium">출고 예정일</th>
                <th className="px-3 py-2 font-medium">예발 사유</th>
                {tab === 'past' ? (
                  <th className="px-3 py-2 font-medium">종료</th>
                ) : (
                  <th className="px-3 py-2 font-medium">관리</th>
                )}
              </tr>
            </thead>
            <tbody>
              {listQuery.isLoading ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-10 text-center text-muted-foreground"
                  >
                    불러오는 중…
                  </td>
                </tr>
              ) : visible.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-10 text-center text-muted-foreground"
                  >
                    {tabItems.length === 0
                      ? tab === 'active'
                        ? '진행 중 예발이 없습니다. 위에서 한 줄씩 추가하거나 M번호를 붙여넣으세요.'
                        : '과거 예발 기록이 없습니다. 종료하면 여기에 남습니다.'
                      : '검색 결과가 없습니다.'}
                  </td>
                </tr>
              ) : (
                visible.map((item) => (
                  <tr key={item.id} className="border-t border-border">
                    <td className="px-3 py-2 font-mono">{item.styleNo}</td>
                    <td className="max-w-56 truncate px-3 py-2 font-medium">
                      {item.name}
                    </td>
                    {tab === 'active' ? (
                      <>
                        <td className="px-3 py-2 text-muted-foreground">
                          {formatYmd(item.startedOn)}
                        </td>
                        <td className="px-3 py-2">
                          <div className="space-y-1">
                            <ShipOnWithDelayHistory
                              shipOn={item.shipOn}
                              extensions={item.extensions ?? []}
                              open={historyHoldId === item.id}
                              onToggle={() =>
                                setHistoryHoldId((current) =>
                                  current === item.id ? null : item.id,
                                )
                              }
                            />
                            {item.shipOn < today ? (
                              <p className="text-[10px] text-warning">
                                예정일 지남 · 종료 전까지 예발 유지
                              </p>
                            ) : null}
                          </div>
                        </td>
                        <td className="max-w-64 truncate px-3 py-2">
                          {item.reason}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2"
                              disabled={busy}
                              onClick={() => openEdit(item)}
                            >
                              <Pencil className="size-3.5" />
                              수정
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2"
                              disabled={busy}
                              onClick={() => openExtend(item)}
                            >
                              <CalendarPlus className="size-3.5" />
                              연장
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2"
                              disabled={busy}
                              onClick={() => openEnd(item)}
                            >
                              <CalendarCheck className="size-3.5" />
                              종료
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-danger"
                              disabled={busy}
                              onClick={() => setDeletingHold(item)}
                              aria-label={`${formatStyleRef({
                                styleId: item.styleId,
                                styleNo: item.styleNo,
                                name: item.name,
                              })} 제거`}
                            >
                              <Trash2 className="size-3.5" />
                              제거
                            </Button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2 text-muted-foreground">
                          {formatYmd(item.startedOn)}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          <ShipOnWithDelayHistory
                            shipOn={item.shipOn}
                            extensions={item.extensions ?? []}
                            open={historyHoldId === item.id}
                            onToggle={() =>
                              setHistoryHoldId((current) =>
                                current === item.id ? null : item.id,
                              )
                            }
                          />
                        </td>
                        <td className="max-w-64 truncate px-3 py-2">
                          {item.reason}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          <div className="space-y-0.5">
                            <p>
                              종료 {formatYmd(item.endedOn ?? '')}
                              {item.endedOn && item.endedOn < item.shipOn
                                ? ' · 조기'
                                : item.endedOn && item.endedOn > item.shipOn
                                  ? ' · 지연 종료'
                                  : ''}
                            </p>
                            {item.endedReason ? (
                              <p className="text-[10px] text-muted-foreground">
                                {item.endedReason}
                              </p>
                            ) : null}
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>

    {duplicateErrors && duplicateErrors.length > 0 ? (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <button
          type="button"
          aria-label="닫기"
          className="absolute inset-0 bg-black/40"
          onClick={() => setDuplicateErrors(null)}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="preorder-duplicate-title"
          className="relative z-10 w-full max-w-md overflow-hidden rounded-xl border border-danger/30 bg-card shadow-xl"
        >
          <div className="border-b border-border px-5 py-4">
            <h2
              id="preorder-duplicate-title"
              className="text-base font-semibold tracking-tight text-danger"
            >
              이미 등록된 예발
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              아래 M번호는 진행 중 예발에 있어 등록하지 않았습니다. 나머지
              상품은 그대로 저장됩니다.
            </p>
          </div>
          <div className="max-h-[min(50vh,20rem)] overflow-auto px-5 py-3">
            <ul className="space-y-1.5 font-mono text-sm">
              {duplicateErrors.map((styleNo) => (
                <li key={styleNo} className="text-foreground">
                  {styleNo}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex justify-end border-t border-border px-5 py-3">
            <Button
              type="button"
              size="sm"
              onClick={() => setDuplicateErrors(null)}
            >
              확인
            </Button>
          </div>
        </div>
      </div>
    ) : null}

    {editingHold ? (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <button
          type="button"
          aria-label="닫기"
          className="absolute inset-0 bg-black/40"
          onClick={() => setEditingHold(null)}
          disabled={updateMutation.isPending}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="preorder-edit-title"
          className="relative z-10 w-full max-w-md overflow-hidden rounded-xl border border-border bg-card shadow-xl"
        >
          <div className="border-b border-border px-5 py-4">
            <h2
              id="preorder-edit-title"
              className="text-base font-semibold tracking-tight"
            >
              예발 수정
            </h2>
            <p className="mt-1 font-mono text-sm text-muted-foreground">
              {editingHold.styleNo} · {editingHold.name}
            </p>
          </div>
          <div className="space-y-3 px-5 py-4">
            <div className="space-y-1">
              <p className="text-[11px] font-medium text-muted-foreground">
                예발 시작일
              </p>
              <Input
                type="date"
                value={editStartedOn}
                onChange={(event) => setEditStartedOn(event.target.value)}
                className="h-9 text-xs"
              />
            </div>
            <div className="space-y-1">
              <p className="text-[11px] font-medium text-muted-foreground">
                출고 예정일
              </p>
              <Input
                type="date"
                value={editShipOn}
                min={editStartedOn || todayYmd()}
                onChange={(event) => setEditShipOn(event.target.value)}
                className="h-9 text-xs"
              />
              <p className="text-[10px] text-muted-foreground">
                단순 수정은 지연 이력에 남기지 않습니다. 예정일을 미루려면
                연장을 쓰세요.
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-[11px] font-medium text-muted-foreground">
                예발 사유
              </p>
              <Input
                list="preorder-reason-suggestions"
                value={editReason}
                onChange={(event) => setEditReason(event.target.value)}
                className="h-9 text-xs"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={updateMutation.isPending}
              onClick={() => setEditingHold(null)}
            >
              취소
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={updateMutation.isPending}
              onClick={saveEdit}
            >
              {updateMutation.isPending ? '저장 중' : '저장'}
            </Button>
          </div>
        </div>
      </div>
    ) : null}

    {extendingHold ? (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <button
          type="button"
          aria-label="닫기"
          className="absolute inset-0 bg-black/40"
          onClick={() => setExtendingHold(null)}
          disabled={extendMutation.isPending}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="preorder-extend-title"
          className="relative z-10 w-full max-w-md overflow-hidden rounded-xl border border-border bg-card shadow-xl"
        >
          <div className="border-b border-border px-5 py-4">
            <h2
              id="preorder-extend-title"
              className="text-base font-semibold tracking-tight"
            >
              예발 연장
            </h2>
            <p className="mt-1 font-mono text-sm text-muted-foreground">
              {extendingHold.styleNo} · {extendingHold.name}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              현재 출고 예정일 {formatYmd(extendingHold.shipOn)}
              {extendingHold.extensions.length > 0
                ? ` · 지연 ${formatNumber(extendingHold.extensions.length)}회`
                : ''}
            </p>
          </div>
          <div className="space-y-3 px-5 py-4">
            <div className="space-y-1">
              <p className="text-[11px] font-medium text-muted-foreground">
                연장 출고 예정일
              </p>
              <Input
                type="date"
                value={extendShipOn}
                min={extendingHold.shipOn}
                onChange={(event) => setExtendShipOn(event.target.value)}
                className="h-9 text-xs"
              />
            </div>
            <div className="space-y-1">
              <p className="text-[11px] font-medium text-muted-foreground">
                연장 사유
              </p>
              <Input
                list="preorder-reason-suggestions"
                value={extendReason}
                onChange={(event) => setExtendReason(event.target.value)}
                placeholder="예: 입고 추가 지연"
                className="h-9 text-xs"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={extendMutation.isPending}
              onClick={() => setExtendingHold(null)}
            >
              취소
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={
                extendMutation.isPending ||
                !extendShipOn ||
                !extendReason.trim()
              }
              onClick={saveExtend}
            >
              {extendMutation.isPending ? '저장 중' : '연장 저장'}
            </Button>
          </div>
        </div>
      </div>
    ) : null}

    {endingHold ? (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <button
          type="button"
          aria-label="닫기"
          className="absolute inset-0 bg-black/40"
          onClick={() => setEndingHold(null)}
          disabled={endMutation.isPending}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="preorder-end-title"
          className="relative z-10 w-full max-w-md overflow-hidden rounded-xl border border-border bg-card shadow-xl"
        >
          <div className="border-b border-border px-5 py-4">
            <h2
              id="preorder-end-title"
              className="text-base font-semibold tracking-tight"
            >
              예발 종료
            </h2>
            <p className="mt-1 font-mono text-sm text-muted-foreground">
              {endingHold.styleNo} · {endingHold.name}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              출고 예정일 {formatYmd(endingHold.shipOn)}. 예정일보다 일찍
              끝낼 수 있고, 예정일이 지나도 종료하기 전까지는 예발로
              남아 있습니다.
            </p>
          </div>
          <div className="space-y-3 px-5 py-4">
            <div className="space-y-1">
              <p className="text-[11px] font-medium text-muted-foreground">
                종료일
              </p>
              <Input
                type="date"
                value={endOn}
                min={endingHold.startedOn}
                onChange={(event) => setEndOn(event.target.value)}
                className="h-9 text-xs"
              />
              {endOn && endOn < endingHold.shipOn ? (
                <p className="text-[10px] text-muted-foreground">
                  예정일보다 이른 조기 종료입니다. 사유를 남겨 주세요.
                </p>
              ) : null}
              {endOn && endOn > endingHold.shipOn ? (
                <p className="text-[10px] text-warning">
                  예정일보다 늦은 종료입니다. 사유를 남겨 주세요.
                </p>
              ) : null}
              {endingHold.shipOn < today &&
              endOn &&
              endOn === endingHold.shipOn ? (
                <p className="text-[10px] text-muted-foreground">
                  예정일과 같은 날로 종료합니다.
                </p>
              ) : null}
            </div>
            {endOn && endOn !== endingHold.shipOn ? (
              <div className="space-y-1">
                <p className="text-[11px] font-medium text-muted-foreground">
                  종료 사유
                </p>
                <Input
                  value={endReason}
                  onChange={(event) => setEndReason(event.target.value)}
                  placeholder={
                    endOn < endingHold.shipOn
                      ? '예: 재고 조기 확보'
                      : '예: 연장 누락 후 입고'
                  }
                  className="h-9 text-xs"
                />
              </div>
            ) : null}
          </div>
          <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={endMutation.isPending}
              onClick={() => setEndingHold(null)}
            >
              취소
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={
                endMutation.isPending ||
                !endOn ||
                (endOn !== endingHold.shipOn && !endReason.trim())
              }
              onClick={saveEnd}
            >
              {endMutation.isPending ? '저장 중' : '종료'}
            </Button>
          </div>
        </div>
      </div>
    ) : null}

    {deletingHold ? (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <button
          type="button"
          aria-label="닫기"
          className="absolute inset-0 bg-black/40"
          onClick={() => setDeletingHold(null)}
          disabled={deleteMutation.isPending}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="preorder-delete-title"
          className="relative z-10 w-full max-w-md overflow-hidden rounded-xl border border-danger/30 bg-card shadow-xl"
        >
          <div className="border-b border-border px-5 py-4">
            <h2
              id="preorder-delete-title"
              className="text-base font-semibold tracking-tight text-danger"
            >
              예발 삭제
            </h2>
            <p className="mt-1 font-mono text-sm text-muted-foreground">
              {deletingHold.styleNo} · {deletingHold.name}
            </p>
          </div>
          <div className="space-y-2 px-5 py-4 text-sm">
            <p className="text-foreground">
              잘못 등록한 예발을 삭제합니다. 삭제하면 되돌릴 수 없고, 과거
              기록에도 남지 않습니다.
            </p>
            <p className="text-xs text-muted-foreground">
              예발 구간을 끝내려면 삭제가 아니라 「종료」를 쓰세요.
            </p>
          </div>
          <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={deleteMutation.isPending}
              onClick={() => setDeletingHold(null)}
            >
              취소
            </Button>
            <Button
              type="button"
              size="sm"
              className="bg-danger text-white hover:bg-danger/90"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate(deletingHold.id)}
            >
              {deleteMutation.isPending ? '삭제 중' : '삭제'}
            </Button>
          </div>
        </div>
      </div>
    ) : null}
    </>
  )
}
