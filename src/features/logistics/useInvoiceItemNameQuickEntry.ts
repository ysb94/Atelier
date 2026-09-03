import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  DEFAULT_DECISION_CONFIG,
  ITEM_NAME_FEATURE_KEY,
} from '@/lib/ai/gateway-core'
import { createSlotGate, withRecommendSlot } from '@/lib/ai/recommend-queue'
import {
  getAiFeatureRoute,
  recommendInvoiceProduct,
  searchInvoiceItemNameCases,
  searchInvoiceProductCandidates,
} from '@/lib/api'
import {
  applyItemNameAiQuickSlotStyle,
  applyItemNameAiQuickSlotText,
  countItemNameAiPendingResolve,
  decideItemNameAiEnterAction,
  decideItemNameAiQuickSlotMatch,
  emptyItemNameAiQuickSlot,
  formatItemNameAiStyleLabel,
  ITEM_NAME_AI_QUICK_SLOT_LIMIT,
  itemNameAiQuickSlotsFromComponents,
  nextItemNameAiQuickFocus,
  nextItemNameAiRowMark,
  removeItemNameAiQuickSlot,
  type ItemNameAiQuickSlot,
  type ItemNameAiReviewRow,
} from '@/lib/invoice/item-name-ai-review'
import type { AccessoryLookupComponent } from '@/lib/invoice/accessory-suggest'
import type { AiProductCandidate, StyleRef } from '@/lib/types'

const SEARCH_WORKERS = 4

function slotKey(rowKey: string, slotIndex: number) {
  return `${rowKey}:${slotIndex}`
}

function scrollFocusedRowToCenter(input: HTMLElement) {
  const container = input.closest<HTMLElement>('[data-item-name-ai-scroll]')
  const row = input.closest('tr')
  if (!container || !row) return
  const containerRect = container.getBoundingClientRect()
  const rowRect = row.getBoundingClientRect()
  const headerHeight =
    container.querySelector('thead')?.getBoundingClientRect().height ?? 0
  const workTop = containerRect.top + headerHeight
  const workHeight = Math.max(0, containerRect.height - headerHeight)
  const offset =
    rowRect.top + rowRect.height / 2 - (workTop + workHeight / 2)
  if (Math.abs(offset) < 4) return
  container.scrollTop += offset
}

function focusAndReveal(input: HTMLInputElement) {
  input.focus()
  requestAnimationFrame(() => {
    scrollFocusedRowToCenter(input)
  })
}

function slotsForRow(
  stored: ItemNameAiQuickSlot[] | undefined,
  row: ItemNameAiReviewRow,
) {
  return (
    stored ??
    itemNameAiQuickSlotsFromComponents(
      row.action === 'delete' ? [] : row.components,
    )
  )
}

export function useInvoiceItemNameQuickEntry({
  brandId,
  rows,
  confirmedKeys,
  pendingAiKeys,
  stageRowComponents,
  stageRowDelete,
  unstageRow,
  confirmRow,
  unconfirmRow,
  commitRow,
}: {
  brandId: string
  rows: ItemNameAiReviewRow[]
  confirmedKeys: ReadonlySet<string>
  pendingAiKeys: ReadonlySet<string>
  stageRowComponents: (
    key: string,
    components: AccessoryLookupComponent[],
  ) => { ok: boolean; error?: string }
  stageRowDelete: (key: string) => { ok: boolean; error?: string }
  unstageRow: (key: string) => void
  confirmRow: (key: string, pendingAi?: boolean) => void
  unconfirmRow: (key: string) => void
  commitRow: (key: string) => void
}) {
  const queryClient = useQueryClient()
  const routeQuery = useQuery({
    queryKey: ['ai-feature-route', brandId, ITEM_NAME_FEATURE_KEY],
    queryFn: () => getAiFeatureRoute(brandId, ITEM_NAME_FEATURE_KEY),
    staleTime: 5 * 60_000,
  })
  const route = routeQuery.data ?? null
  const minConfidence =
    route?.decisionConfig?.high ?? DEFAULT_DECISION_CONFIG.high

  const [slotsByKey, setSlotsByKey] = useState<
    Map<string, ItemNameAiQuickSlot[]>
  >(() => new Map())
  const slotsByKeyRef = useRef(slotsByKey)
  const [resolving, setResolving] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [resolveError, setResolveError] = useState<string | null>(null)
  const [stageErrorByKey, setStageErrorByKey] = useState<Map<string, string>>(
    () => new Map(),
  )
  const inputsRef = useRef(new Map<string, HTMLInputElement>())
  const pendingFocusRef = useRef<{ rowKey: string; slotIndex: number } | null>(
    null,
  )
  const cancelRef = useRef(false)
  const resolveGenerationRef = useRef(0)
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const rowByKey = useMemo(
    () => new Map(rows.map((row) => [row.key, row])),
    [rows],
  )
  const liveRowKey = useMemo(
    () =>
      rows
        .map((row) => row.key)
        .sort()
        .join('\u0000'),
    [rows],
  )

  const replaceSlots = useCallback((next: Map<string, ItemNameAiQuickSlot[]>) => {
    slotsByKeyRef.current = next
    setSlotsByKey(next)
  }, [])

  useEffect(() => {
    const liveKeys = new Set(rowsRef.current.map((row) => row.key))
    const current = slotsByKeyRef.current
    let changed = false
    const next = new Map<string, ItemNameAiQuickSlot[]>()
    for (const [key, slots] of current) {
      if (liveKeys.has(key)) next.set(key, slots)
      else changed = true
    }
    if (changed) {
      resolveGenerationRef.current += 1
      cancelRef.current = true
      replaceSlots(next)
    }
    if (
      pendingFocusRef.current &&
      !liveKeys.has(pendingFocusRef.current.rowKey)
    ) {
      pendingFocusRef.current = null
    }
  }, [liveRowKey, replaceSlots])

  useEffect(() => {
    const pending = pendingFocusRef.current
    if (!pending) return
    pendingFocusRef.current = null
    const pendingInput = inputsRef.current.get(
      slotKey(pending.rowKey, pending.slotIndex),
    )
    if (pendingInput) focusAndReveal(pendingInput)
  })

  const getSlots = useCallback(
    (row: ItemNameAiReviewRow) =>
      slotsForRow(
        slotsByKeyRef.current.get(row.key) ?? slotsByKey.get(row.key),
        row,
      ),
    [slotsByKey],
  )

  const writeSlots = useCallback(
    (
      rowKey: string,
      updater: (current: ItemNameAiQuickSlot[]) => ItemNameAiQuickSlot[],
      row?: ItemNameAiReviewRow,
    ) => {
      const source = row ?? rowByKey.get(rowKey)
      if (!source) return [] as ItemNameAiQuickSlot[]
      const nextSlots = updater(
        slotsForRow(slotsByKeyRef.current.get(rowKey), source),
      )
      const next = new Map(slotsByKeyRef.current)
      next.set(rowKey, nextSlots)
      replaceSlots(next)
      return nextSlots
    },
    [replaceSlots, rowByKey],
  )

  const setStageError = useCallback((rowKey: string, error: string | null) => {
    setStageErrorByKey((current) => {
      const has = current.has(rowKey)
      if (!error && !has) return current
      if (error && current.get(rowKey) === error) return current
      const next = new Map(current)
      if (error) next.set(rowKey, error)
      else next.delete(rowKey)
      return next
    })
  }, [])

  const applyDecision = useCallback(
    (
      rowKey: string,
      slots: ItemNameAiQuickSlot[],
      mode: 'edit' | 'confirm' | 'resolved',
    ) => {
      const decision = decideItemNameAiEnterAction(slots)
      const mark = nextItemNameAiRowMark(mode, decision.status)
      if (decision.status === 'invalid') {
        unstageRow(rowKey)
        unconfirmRow(rowKey)
        setStageError(rowKey, '같은 구성품 M번호는 한 번만 넣을 수 있습니다.')
        return decision
      }
      if (decision.status === 'needs_ai') {
        unstageRow(rowKey)
        if (mark === 'pending_ai') confirmRow(rowKey, true)
        else if (mark === 'unconfirm') unconfirmRow(rowKey)
        setStageError(rowKey, null)
        return decision
      }
      const staged =
        decision.status === 'delete'
          ? stageRowDelete(rowKey)
          : stageRowComponents(rowKey, decision.components)
      if (!staged.ok) {
        setStageError(rowKey, staged.error ?? '반영하지 못했습니다.')
        return decision
      }
      if (decision.status === 'components') {
        const next = new Map(slotsByKeyRef.current)
        next.set(
          rowKey,
          itemNameAiQuickSlotsFromComponents(decision.components),
        )
        replaceSlots(next)
      }
      setStageError(rowKey, null)
      if (mark === 'committed') commitRow(rowKey)
      else if (mark === 'unconfirm') unconfirmRow(rowKey)
      return decision
    },
    [
      commitRow,
      confirmRow,
      replaceSlots,
      setStageError,
      stageRowComponents,
      stageRowDelete,
      unconfirmRow,
      unstageRow,
    ],
  )

  const setSlotText = useCallback(
    (rowKey: string, slotIndex: number, text: string) => {
      const nextSlots = writeSlots(rowKey, (slots) =>
        slots.map((slot, index) =>
          index === slotIndex ? applyItemNameAiQuickSlotText(slot, text) : slot,
        ),
      )
      applyDecision(rowKey, nextSlots, 'edit')
    },
    [applyDecision, writeSlots],
  )

  const pickSlotStyle = useCallback(
    (rowKey: string, slotIndex: number, style: StyleRef) => {
      const nextSlots = writeSlots(rowKey, (slots) =>
        slots.map((slot, index) =>
          index === slotIndex
            ? applyItemNameAiQuickSlotStyle(slot, style)
            : slot,
        ),
      )
      applyDecision(rowKey, nextSlots, 'resolved')
    },
    [applyDecision, writeSlots],
  )

  const clearSlot = useCallback(
    (rowKey: string, slotIndex: number) => {
      const nextSlots = writeSlots(rowKey, (slots) =>
        slots.map((slot, index) =>
          index === slotIndex ? emptyItemNameAiQuickSlot() : slot,
        ),
      )
      applyDecision(rowKey, nextSlots, 'edit')
    },
    [applyDecision, writeSlots],
  )

  const ensureSlotCount = useCallback(
    (rowKey: string, count: number, row?: ItemNameAiReviewRow) => {
      const target = Math.min(
        ITEM_NAME_AI_QUICK_SLOT_LIMIT,
        Math.max(1, count),
      )
      writeSlots(
        rowKey,
        (slots) => {
          if (slots.length >= target) return slots
          return [
            ...slots,
            ...Array.from(
              { length: target - slots.length },
              emptyItemNameAiQuickSlot,
            ),
          ]
        },
        row,
      )
    },
    [writeSlots],
  )

  const registerInput = useCallback(
    (rowKey: string, slotIndex: number, el: HTMLInputElement | null) => {
      const key = slotKey(rowKey, slotIndex)
      if (el) inputsRef.current.set(key, el)
      else inputsRef.current.delete(key)
    },
    [],
  )

  const focusSlot = useCallback((rowKey: string, slotIndex: number) => {
    pendingFocusRef.current = { rowKey, slotIndex }
    const current = inputsRef.current.get(slotKey(rowKey, slotIndex))
    if (current) {
      pendingFocusRef.current = null
      focusAndReveal(current)
    }
  }, [])

  const removeSlot = useCallback(
    (rowKey: string, slotIndex: number) => {
      const nextSlots = writeSlots(rowKey, (slots) =>
        removeItemNameAiQuickSlot(slots, slotIndex),
      )
      applyDecision(rowKey, nextSlots, 'edit')
      focusSlot(rowKey, Math.max(0, Math.min(slotIndex, nextSlots.length) - 1))
    },
    [applyDecision, focusSlot, writeSlots],
  )

  const moveFocus = useCallback(
    (
      visibleRows: ItemNameAiReviewRow[],
      rowKey: string,
      slotIndex: number,
      direction: 'down' | 'right',
    ) => {
      const slotCountByKey = Object.fromEntries(
        visibleRows.map((row) => [row.key, getSlots(row).length]),
      )
      const next = nextItemNameAiQuickFocus(
        visibleRows.map((row) => row.key),
        rowKey,
        slotIndex,
        direction,
        slotCountByKey,
      )
      if (!next) return
      const nextRow = visibleRows.find((row) => row.key === next.rowKey)
      if (direction === 'right') {
        ensureSlotCount(next.rowKey, next.ensureCount, nextRow)
      }
      focusSlot(next.rowKey, next.slotIndex)
    },
    [ensureSlotCount, focusSlot, getSlots],
  )

  const moveDown = useCallback(
    (visibleRows: ItemNameAiReviewRow[], rowKey: string, slotIndex: number) => {
      moveFocus(visibleRows, rowKey, slotIndex, 'down')
    },
    [moveFocus],
  )

  const confirmAndMove = useCallback(
    (
      visibleRows: ItemNameAiReviewRow[],
      rowKey: string,
      slotIndex: number,
    ) => {
      const row = rowByKey.get(rowKey)
      if (!row) return
      const slots = getSlots(row)
      applyDecision(rowKey, slots, 'confirm')
      moveFocus(visibleRows, rowKey, slotIndex, 'down')
    },
    [applyDecision, getSlots, moveFocus, rowByKey],
  )

  const moveRight = useCallback(
    (visibleRows: ItemNameAiReviewRow[], rowKey: string, slotIndex: number) => {
      moveFocus(visibleRows, rowKey, slotIndex, 'right')
    },
    [moveFocus],
  )

  const pendingCount = useMemo(
    () => countItemNameAiPendingResolve(pendingAiKeys, slotsByKey),
    [pendingAiKeys, slotsByKey],
  )

  const resolve = useCallback(async () => {
    const tasks: Array<{
      rowKey: string
      slotIndex: number
      text: string
      mainStyleId: string | null
      itemName: string
      productLookupKey: string
      mainProduct: string
    }> = []
    const currentSlots = slotsByKeyRef.current
    for (const [rowKey, slots] of currentSlots) {
      const row = rowByKey.get(rowKey)
      if (!row) continue
      if (!pendingAiKeys.has(rowKey)) continue
      slots.forEach((slot, slotIndex) => {
        if (
          !slot.text.trim() ||
          slot.status === 'matched' ||
          slot.status === 'empty'
        ) {
          return
        }
        tasks.push({
          rowKey,
          slotIndex,
          text: slot.text.trim(),
          mainStyleId: row.mainStyle?.styleId ?? null,
          itemName: row.itemName,
          productLookupKey: row.productLookupKey,
          mainProduct: row.mainStyle
            ? `${row.mainStyle.styleNo} ${row.mainStyle.name}`
            : '',
        })
      })
    }
    if (tasks.length === 0) return
    const generation = resolveGenerationRef.current + 1
    resolveGenerationRef.current = generation
    cancelRef.current = false
    setResolving(true)
    setResolveError(null)
    setProgress({ done: 0, total: tasks.length })

    const searchGate = createSlotGate(SEARCH_WORKERS)
    const searchCache = new Map<string, Promise<AiProductCandidate[]>>()
    const search = (text: string) => {
      const cached = searchCache.get(text)
      if (cached) return cached
      const request = searchGate(() =>
        searchInvoiceProductCandidates(brandId, [text], 20),
      )
      searchCache.set(text, request)
      return request
    }

    let done = 0
    const nextByRow = new Map<string, ItemNameAiQuickSlot[]>()
    for (const [rowKey, slots] of currentSlots) {
      nextByRow.set(rowKey, slots.map((slot) => ({ ...slot })))
    }

    try {
      await Promise.all(
        tasks.map((task) =>
          withRecommendSlot(async () => {
            if (
              cancelRef.current ||
              generation !== resolveGenerationRef.current
            ) {
              return
            }
            const rowSlots = nextByRow.get(task.rowKey)
            if (!rowSlots) return
            try {
              const [searched, cases] = await Promise.all([
                queryClient.fetchQuery({
                  queryKey: [
                    'ai-quick-slot-candidates',
                    brandId,
                    task.text,
                  ],
                  staleTime: 30_000,
                  queryFn: () => search(task.text),
                }),
                queryClient.fetchQuery({
                  queryKey: [
                    'ai-item-name-cases',
                    brandId,
                    task.itemName,
                    task.mainStyleId ?? '',
                    task.productLookupKey,
                  ],
                  staleTime: 30_000,
                  queryFn: () =>
                    searchInvoiceItemNameCases(brandId, [
                      {
                        contextId: task.rowKey,
                        itemName: task.itemName,
                        mainStyleId: task.mainStyleId,
                        productLookupKey: task.productLookupKey,
                      },
                    ]),
                }),
              ])
              const caseCandidates = cases.flatMap((item) =>
                item.components.map((component, index) => ({
                  source: 'history',
                  lookupKey: item.itemName,
                  styleId: component.styleId,
                  styleNo: component.styleNo ?? '',
                  name: component.name ?? '',
                  score: Math.max(0.4, item.score - index * 0.02),
                })),
              )
              const seen = new Set<string>()
              const candidates = [...searched, ...caseCandidates].filter((item) => {
                if (item.styleId === task.mainStyleId || seen.has(item.styleId)) {
                  return false
                }
                seen.add(item.styleId)
                return true
              })
              const recommendation = await queryClient.fetchQuery({
                queryKey: [
                  'ai-quick-slot-match',
                  brandId,
                  task.text,
                  task.itemName,
                  task.productLookupKey,
                  route?.provider ?? '',
                  route?.modelId ?? '',
                ],
                staleTime: Infinity,
                retry: false,
                queryFn: () =>
                  recommendInvoiceProduct({
                    brandId,
                    lookupKeys: [task.text],
                    candidates,
                    productName: task.text,
                    itemName: task.itemName,
                    mallName: task.mainProduct,
                  }),
              })
              if (
                cancelRef.current ||
                generation !== resolveGenerationRef.current ||
                !rowsRef.current.some((row) => row.key === task.rowKey)
              ) {
                return
              }
              const decided = decideItemNameAiQuickSlotMatch(
                recommendation.products,
                recommendation.source,
                minConfidence,
                task.mainStyleId,
              )
              const current = rowSlots[task.slotIndex]
              if (!current) return
              if (decided.status === 'matched' && decided.style) {
                rowSlots[task.slotIndex] = {
                  text: formatItemNameAiStyleLabel(decided.style),
                  quantity: current.quantity,
                  style: decided.style,
                  status: 'matched',
                  candidates: [],
                  error: null,
                }
              } else if (decided.status === 'ambiguous') {
                rowSlots[task.slotIndex] = {
                  ...current,
                  style: null,
                  status: 'ambiguous',
                  candidates: decided.candidates,
                  error: '후보를 고르세요.',
                }
              } else {
                rowSlots[task.slotIndex] = {
                  ...current,
                  style: null,
                  status: 'unmatched',
                  candidates: [],
                  error: '공식 상품을 찾지 못했습니다.',
                }
              }
            } catch (error) {
              if (cancelRef.current) return
              const current = rowSlots[task.slotIndex]
              if (!current) return
              rowSlots[task.slotIndex] = {
                ...current,
                style: null,
                status: 'unmatched',
                candidates: [],
                error:
                  error instanceof Error
                    ? error.message
                    : '공식 상품을 찾지 못했습니다.',
              }
            } finally {
              done += 1
              setProgress({ done, total: tasks.length })
            }
          }),
        ),
      )
      if (
        cancelRef.current ||
        generation !== resolveGenerationRef.current
      ) {
        return
      }
      const liveKeys = new Set(rowsRef.current.map((row) => row.key))
      for (const key of [...nextByRow.keys()]) {
        if (!liveKeys.has(key)) nextByRow.delete(key)
      }
      replaceSlots(new Map(nextByRow))
      const resolvedKeys = new Set(tasks.map((task) => task.rowKey))
      for (const [rowKey, slots] of nextByRow) {
        if (!liveKeys.has(rowKey)) continue
        if (resolvedKeys.has(rowKey) || confirmedKeys.has(rowKey)) {
          applyDecision(rowKey, slots, 'resolved')
        }
      }
    } finally {
      setResolving(false)
    }
  }, [
    brandId,
    minConfidence,
    queryClient,
    route?.modelId,
    route?.provider,
    rowByKey,
    applyDecision,
    confirmedKeys,
    pendingAiKeys,
    replaceSlots,
  ])

  const cancel = useCallback(() => {
    resolveGenerationRef.current += 1
    cancelRef.current = true
  }, [])

  const reset = useCallback(() => {
    resolveGenerationRef.current += 1
    cancelRef.current = true
    replaceSlots(new Map())
    pendingFocusRef.current = null
    setResolveError(null)
    setStageErrorByKey(new Map())
    setProgress({ done: 0, total: 0 })
  }, [replaceSlots])

  return {
    routeReady: Boolean(route?.isActive),
    routeLoading: routeQuery.isLoading,
    getSlots,
    setSlotText,
    pickSlotStyle,
    clearSlot,
    removeSlot,
    ensureSlotCount,
    registerInput,
    focusSlot,
    moveDown,
    moveRight,
    confirmAndMove,
    pendingCount,
    resolving,
    progress,
    resolveError,
    stageErrorByKey,
    resolve,
    cancel,
    reset,
  }
}
