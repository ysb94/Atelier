import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  DEFAULT_DECISION_CONFIG,
  buildLocalRecommendation,
  evaluateHybridDecision,
} from '@/lib/ai/gateway-core'
import { createSlotGate, withRecommendSlot } from '@/lib/ai/recommend-queue'
import {
  getAiFeatureRoute,
  isFatalAiError,
  recommendInvoiceProduct,
  searchInvoiceProductCandidates,
} from '@/lib/api'
import { optionMapItemNameForRule } from '@/lib/invoice/product-name-patterns'
import {
  applyProductNameAiRecommendation,
  applyProductNameLookupKey,
  buildProductNameAiReviewRows,
  stageProductNameAiRowConfirm,
  dedupeProductNameAiCombos,
  productNameAiCandidateSearchKeys,
  productNameAiSearchKeys,
  countProductNameAiWorkflow,
  decideProductNameAiConfirmedSaves,
  isProductNameAiSaveFailed,
  markProductNameAiCollectFailure,
  markProductNameAiDuplicates,
  normalizeProductNameAiReviewLookupKey,
  overlayProductNameAiDrafts,
  productNameAiCollectFailed,
  productNameAiRowReadyToCommit,
  reconcileProductNameAiReviewState,
  selectLatestFailedSaveRetries,
  validateProductNameAiReviewRow,
  type ProductNameAiEnterDecision,
  type ProductNameAiExtra,
  type ProductNameAiQuickSlot,
  type ProductNameAiReviewRow,
} from '@/lib/invoice/product-name-ai-review'
import {
  isProtectedGiftSourceCombo,
  rejectProtectedGiftSourceSave,
} from '@/lib/invoice/gift-source-transform'
import type { UnresolvedProductNameCombo } from '@/lib/invoice/product-name-transform'
import type { AiProductCandidate, AiProductRecommendation } from '@/lib/types'
import type { OptionExtraDraft } from './InvoiceOptionExtrasEditor'
import type {
  ProductMapEnqueueInput,
  ProductMapHistoryEntry,
  ProductMapHistoryStatus,
} from './useInvoiceProductNameSaveQueue'

export type BulkAiApplyPhase = 'idle' | 'collecting' | 'review' | 'applied'

const FEATURE_KEY = 'invoice_product_recommendation'
const COLLECT_WORKERS = 6
const SEARCH_WORKERS = 4
const PUBLISH_MS = 80

export function extrasOfProductNameAiRow(
  row: ProductNameAiReviewRow,
): OptionExtraDraft[] {
  return row.extras.map((item, index) => ({
    key: `${item.style.styleId}-${index}`,
    style: item.style,
    role: item.role,
    quantity: item.quantity,
  }))
}

function extrasFromDrafts(extras: OptionExtraDraft[]): ProductNameAiExtra[] {
  return extras.flatMap((item) =>
    item.style
      ? [
          {
            style: item.style,
            role: item.role,
            quantity: Math.max(1, Math.floor(item.quantity || 1)),
          },
        ]
      : [],
  )
}

export function useInvoiceProductNameBulkAiApply({
  brandId,
  combos,
  enqueue,
  saveStatusByKey,
  protectedKeys,
  giftDisplayCombos = [],
}: {
  brandId: string
  combos: UnresolvedProductNameCombo[]
  enqueue: (input: ProductMapEnqueueInput) => void
  saveStatusByKey?: ReadonlyMap<string, ProductMapHistoryStatus>
  protectedKeys?: ReadonlySet<string>
  giftDisplayCombos?: UnresolvedProductNameCombo[]
}) {
  const queryClient = useQueryClient()
  const routeQuery = useQuery({
    queryKey: ['ai-feature-route', brandId, FEATURE_KEY],
    queryFn: () => getAiFeatureRoute(brandId, FEATURE_KEY),
    staleTime: 5 * 60_000,
  })
  const route = routeQuery.data ?? null
  const minConfidence =
    route?.decisionConfig?.high ?? DEFAULT_DECISION_CONFIG.high

  const [phase, setPhase] = useState<BulkAiApplyPhase>('idle')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [reviewRows, setReviewRows] = useState<ProductNameAiReviewRow[]>([])
  const [draftByKey, setDraftByKey] = useState<
    Map<string, ProductNameAiReviewRow>
  >(() => new Map())
  const [confirmedKeys, setConfirmedKeys] = useState<Set<string>>(
    () => new Set(),
  )
  const [pendingAiKeys, setPendingAiKeys] = useState<Set<string>>(
    () => new Set(),
  )
  const [committedKeys, setCommittedKeys] = useState<Set<string>>(
    () => new Set(),
  )
  const [appliedCount, setAppliedCount] = useState(0)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [extrasDraftByKey, setExtrasDraftByKey] = useState<
    Map<string, OptionExtraDraft[]>
  >(() => new Map())
  const cancelRef = useRef(false)
  const collectGenerationRef = useRef(0)
  const combosRef = useRef(combos)
  const liveComboKeysCacheRef = useRef<{
    source: UnresolvedProductNameCombo[]
    keys: Set<string>
  }>({
    source: combos,
    keys: new Set(combos.map((combo) => combo.key)),
  })
  if (liveComboKeysCacheRef.current.source !== combos) {
    liveComboKeysCacheRef.current = {
      source: combos,
      keys: new Set(combos.map((combo) => combo.key)),
    }
  }
  combosRef.current = combos
  const protectedKeysRef = useRef(protectedKeys)
  protectedKeysRef.current = protectedKeys
  const liveComboKey = useMemo(
    () =>
      combos
        .map((combo) =>
          [
            combo.key,
            combo.candidates
              .map((candidate) => `${candidate.rule}:${candidate.text}`)
              .join('\u0002'),
            combo.tags.map((tag) => `${tag.raw}:${tag.role}`).join('\u0002'),
            combo.itemTags
              .map((tag) => `${tag.raw}:${tag.role}`)
              .join('\u0002'),
          ].join('\u0001'),
        )
        .sort()
        .join('\u0000'),
    [combos],
  )
  const stateRef = useRef({
    reviewRows,
    draftByKey,
    confirmedKeys,
    pendingAiKeys,
    committedKeys,
  })
  stateRef.current = {
    reviewRows,
    draftByKey,
    confirmedKeys,
    pendingAiKeys,
    committedKeys,
  }

  const fetchRecommendation = useCallback(
    (
      combo: UnresolvedProductNameCombo,
      lookupKeys: string[],
      search: (keys: string[]) => Promise<AiProductCandidate[]>,
      searchKeys = lookupKeys,
    ) =>
      queryClient.fetchQuery({
        queryKey: [
          'ai-product-recommendation',
          brandId,
          combo.key,
          route?.provider ?? '',
          route?.modelId ?? '',
          route?.recommendationPolicy ?? 'hybrid_auto',
          JSON.stringify(route?.decisionConfig ?? {}),
          searchKeys.join('\u0001'),
        ],
        staleTime: Infinity,
        retry: false,
        queryFn: async (): Promise<AiProductRecommendation> => {
          const candidates = await search(searchKeys)
          const decision = evaluateHybridDecision(
            candidates,
            route?.decisionConfig ?? DEFAULT_DECISION_CONFIG,
          )
          const policy = route?.recommendationPolicy ?? 'hybrid_auto'
          const action =
            policy === 'always_ai' && decision.ranked.length >= 2
              ? 'ai'
              : policy === 'local_only' && decision.action === 'ai'
                ? 'local'
                : decision.action
          if (action === 'manual') {
            return {
              lookupKey: lookupKeys[0] ?? '',
              reason: decision.reason,
              products: [],
              provider: route?.provider ?? 'openai',
              modelId: route?.modelId ?? '',
              source: 'manual',
              cacheId: null,
              skippedAi: true,
              cacheHit: false,
            }
          }
          if (action === 'local') {
            const recommendation = buildLocalRecommendation(
              lookupKeys,
              decision.ranked,
            )
            return {
              ...recommendation,
              provider: route?.provider ?? 'openai',
              modelId: route?.modelId ?? '',
              source: 'local',
              cacheId: null,
              skippedAi: true,
              cacheHit: false,
            }
          }
          return withRecommendSlot(() =>
            recommendInvoiceProduct({
              brandId,
              lookupKeys,
              candidates,
              productName: combo.productName,
              itemName: combo.itemName,
              mallName: combo.mallName,
            }),
          )
        },
      }),
    [
      brandId,
      queryClient,
      route?.decisionConfig,
      route?.modelId,
      route?.provider,
      route?.recommendationPolicy,
    ],
  )

  const cancel = useCallback(() => {
    cancelRef.current = true
    setPhase((current) => (current === 'collecting' ? 'review' : current))
  }, [])

  const reset = useCallback(() => {
    cancelRef.current = true
    collectGenerationRef.current += 1
    setPhase('idle')
    setReviewRows([])
    setDraftByKey(new Map())
    setConfirmedKeys(new Set())
    setPendingAiKeys(new Set())
    setCommittedKeys(new Set())
    setExtrasDraftByKey(new Map())
    setAppliedCount(0)
    setApplyError(null)
    setProgress({ done: 0, total: 0 })
  }, [])

  useEffect(() => {
    const current = stateRef.current
    if (current.reviewRows.length === 0) return
    const next = reconcileProductNameAiReviewState({
      combos: combosRef.current,
      reviewRows: current.reviewRows,
      drafts: current.draftByKey,
      confirmedKeys: current.confirmedKeys,
      pendingAiKeys: current.pendingAiKeys,
      committedKeys: current.committedKeys,
    })
    setReviewRows(next.reviewRows)
    setDraftByKey(next.drafts)
    setConfirmedKeys(next.confirmedKeys)
    setPendingAiKeys(next.pendingAiKeys)
    setCommittedKeys(next.committedKeys)
    setExtrasDraftByKey((current) => {
      const liveKeys = new Set(next.reviewRows.map((row) => row.key))
      let changed = false
      const extras = new Map<string, OptionExtraDraft[]>()
      for (const [key, draft] of current) {
        if (liveKeys.has(key)) extras.set(key, draft)
        else changed = true
      }
      return changed ? extras : current
    })
  }, [liveComboKey])

  useEffect(() => {
    setReviewRows((current) => {
      if (current.length === 0) return current
      const next = markProductNameAiDuplicates(
        current.map(normalizeProductNameAiReviewLookupKey),
      )
      return next.some((row, index) => row.lookupKey !== current[index]?.lookupKey)
        ? next
        : current
    })
    setDraftByKey((current) => {
      if (current.size === 0) return current
      let changed = false
      const next = new Map<string, ProductNameAiReviewRow>()
      for (const [key, row] of current) {
        const normalized = normalizeProductNameAiReviewLookupKey(row)
        if (normalized !== row) changed = true
        next.set(key, normalized)
      }
      return changed ? next : current
    })
  }, [])

  const giftDisplayRows = useMemo(
    () => buildProductNameAiReviewRows(giftDisplayCombos),
    [giftDisplayCombos],
  )

  const shownRows = useMemo(() => {
    const aiRows = markProductNameAiDuplicates(
      overlayProductNameAiDrafts(reviewRows, draftByKey),
    )
    const aiKeys = new Set(aiRows.map((row) => row.key))
    return [
      ...aiRows,
      ...giftDisplayRows.filter((row) => !aiKeys.has(row.key)),
    ]
  }, [draftByKey, giftDisplayRows, reviewRows])

  const writeDraft = useCallback((row: ProductNameAiReviewRow) => {
    setDraftByKey((current) => {
      const next = new Map(current)
      next.set(row.key, row)
      return next
    })
  }, [])

  const liveComboKeys = useCallback(() => {
    const source = combosRef.current
    const cached = liveComboKeysCacheRef.current
    if (cached.source === source) return cached.keys
    const keys = new Set(source.map((combo) => combo.key))
    liveComboKeysCacheRef.current = { source, keys }
    return keys
  }, [])

  const publishRows = useCallback((rows: ProductNameAiReviewRow[]) => {
    const current = stateRef.current
    const reconciled = reconcileProductNameAiReviewState({
      combos: combosRef.current,
      reviewRows: rows,
      drafts: current.draftByKey,
      confirmedKeys: current.confirmedKeys,
      pendingAiKeys: current.pendingAiKeys,
      committedKeys: current.committedKeys,
    })
    const nextRows = markProductNameAiDuplicates(reconciled.reviewRows)
    setReviewRows(nextRows)
    setDraftByKey(reconciled.drafts)
    setConfirmedKeys(reconciled.confirmedKeys)
    setPendingAiKeys(reconciled.pendingAiKeys)
    setCommittedKeys(reconciled.committedKeys)
    stateRef.current = {
      reviewRows: nextRows,
      draftByKey: reconciled.drafts,
      confirmedKeys: reconciled.confirmedKeys,
      pendingAiKeys: reconciled.pendingAiKeys,
      committedKeys: reconciled.committedKeys,
    }
    setExtrasDraftByKey((currentExtras) => {
      const liveKeys = new Set(nextRows.map((row) => row.key))
      let changed = false
      const extras = new Map<string, OptionExtraDraft[]>()
      for (const [key, draft] of currentExtras) {
        if (liveKeys.has(key)) extras.set(key, draft)
        else changed = true
      }
      return changed ? extras : currentExtras
    })
    return {
      ...reconciled,
      reviewRows: nextRows,
    }
  }, [])

  const clearReviewMarks = useCallback(() => {
    const emptyDrafts = new Map<string, ProductNameAiReviewRow>()
    const emptyKeys = new Set<string>()
    setDraftByKey(emptyDrafts)
    setConfirmedKeys(emptyKeys)
    setPendingAiKeys(emptyKeys)
    setCommittedKeys(emptyKeys)
    setExtrasDraftByKey(new Map())
    stateRef.current = {
      ...stateRef.current,
      draftByKey: emptyDrafts,
      confirmedKeys: emptyKeys,
      pendingAiKeys: emptyKeys,
      committedKeys: emptyKeys,
    }
  }, [])

  const confirmRow = useCallback((key: string) => {
    setConfirmedKeys((current) => {
      if (current.has(key)) return current
      const next = new Set(current)
      next.add(key)
      return next
    })
    setPendingAiKeys((current) => {
      if (!current.has(key)) return current
      const next = new Set(current)
      next.delete(key)
      return next
    })
  }, [])

  const markPendingAi = useCallback((key: string) => {
    setConfirmedKeys((current) => {
      if (!current.has(key)) return current
      const next = new Set(current)
      next.delete(key)
      return next
    })
    setPendingAiKeys((current) => {
      if (current.has(key)) return current
      const next = new Set(current)
      next.add(key)
      return next
    })
  }, [])

  const unconfirmRow = useCallback((key: string) => {
    setConfirmedKeys((current) => {
      if (!current.has(key)) return current
      const next = new Set(current)
      next.delete(key)
      return next
    })
    setPendingAiKeys((current) => {
      if (!current.has(key)) return current
      const next = new Set(current)
      next.delete(key)
      return next
    })
  }, [])

  const updateRow = useCallback(
    (
      key: string,
      patch: {
        lookupKey?: string
        extras?: OptionExtraDraft[]
      },
    ): { ok: boolean; error?: string } => {
      const current =
        draftByKey.get(key) ?? reviewRows.find((row) => row.key === key)
      if (!current) return { ok: false, error: '행을 찾지 못했습니다.' }
      let next = current
      if (patch.lookupKey !== undefined) {
        next = applyProductNameLookupKey(next, patch.lookupKey)
      }
      if (patch.extras) {
        setExtrasDraftByKey((current) => {
          const extras = new Map(current)
          extras.set(key, patch.extras!)
          return extras
        })
        next = validateProductNameAiReviewRow({
          ...next,
          extras: extrasFromDrafts(patch.extras),
          source: 'manual',
        })
      }
      if (next.validationError && patch.extras) {
        return { ok: false, error: next.validationError }
      }
      writeDraft(next)
      unconfirmRow(key)
      return { ok: true }
    },
    [draftByKey, reviewRows, unconfirmRow, writeDraft],
  )

  const extrasDraftOf = useCallback(
    (row: ProductNameAiReviewRow) =>
      extrasDraftByKey.get(row.key) ?? extrasOfProductNameAiRow(row),
    [extrasDraftByKey],
  )

  const setExtrasDraft = useCallback(
    (key: string, extras: OptionExtraDraft[]) =>
      updateRow(key, { extras }),
    [updateRow],
  )

  const applySlots = useCallback(
    (
      key: string,
      slots: ProductNameAiQuickSlot[],
      mode: 'edit' | 'confirm' | 'resolved',
    ): {
      ok: boolean
      error?: string
      decision?: ProductNameAiEnterDecision
      confirmed?: boolean
    } => {
      const currentState = stateRef.current
      const current =
        currentState.draftByKey.get(key) ??
        currentState.reviewRows.find((row) => row.key === key)
      if (!current) return { ok: false, error: '행을 찾지 못했습니다.' }
      const siblings = overlayProductNameAiDrafts(
        currentState.reviewRows,
        currentState.draftByKey,
      )
      const staged = stageProductNameAiRowConfirm({
        row: current,
        slots,
        mode,
        siblings,
      })
      writeDraft(staged.draftRow)
      if (staged.decision.status === 'ready') {
        setExtrasDraftByKey((currentDrafts) => {
          const extras = new Map(currentDrafts)
          extras.set(key, extrasOfProductNameAiRow(staged.draftRow))
          return extras
        })
      }
      if (staged.mark === 'pending_ai') markPendingAi(key)
      else if (staged.mark === 'confirmed') confirmRow(key)
      else if (staged.mark === 'unconfirm') unconfirmRow(key)
      return {
        ok: staged.ok,
        error: staged.error ?? undefined,
        decision: staged.decision,
        confirmed: staged.confirmed,
      }
    },
    [confirmRow, markPendingAi, unconfirmRow, writeDraft],
  )

  const collect = useCallback(async () => {
    if (phase === 'collecting') return
    const generation = collectGenerationRef.current + 1
    collectGenerationRef.current = generation
    cancelRef.current = false
    const targets = combosRef.current.filter(
      (combo) =>
        !isProtectedGiftSourceCombo(
          combo,
          protectedKeysRef.current ?? new Set(),
        ),
    )
    const { requests, mirrors } = dedupeProductNameAiCombos(targets)
    setPhase('collecting')
    setAppliedCount(0)
    setApplyError(null)
    clearReviewMarks()
    setProgress({ done: 0, total: targets.length })
    const rows = buildProductNameAiReviewRows(targets)
    publishRows(rows)
    const comboByKey = new Map(targets.map((combo) => [combo.key, combo]))
    const requestKeys = new Set(requests.map((combo) => combo.key))
    let cursor = 0
    let done = 0
    let fatalMessage: string | null = null
    const searchGate = createSlotGate(SEARCH_WORKERS)
    const searchCache = new Map<string, Promise<AiProductCandidate[]>>()
    const search = (lookupKeys: string[]) => {
      const cacheKey = lookupKeys.map((key) => key.trim()).join('\u0000')
      const cached = searchCache.get(cacheKey)
      if (cached) return cached
      const request = searchGate(() =>
        searchInvoiceProductCandidates(brandId, lookupKeys, 20),
      )
      searchCache.set(cacheKey, request)
      return request
    }

    const collectOne = async (row: ProductNameAiReviewRow) => {
      if (row.holdReason === 'exclusion_guarded') return row
      // 크레딧·키 오류가 한 번 나오면 남은 행은 묻지 않는다.
      if (fatalMessage) {
        return markProductNameAiCollectFailure(row, 'failed', fatalMessage)
      }
      const source = comboByKey.get(row.key)
      const lookupKeys = productNameAiSearchKeys(row)
      const searchKeys = productNameAiCandidateSearchKeys(row)
      if (lookupKeys.length === 0) {
        return markProductNameAiCollectFailure(row, 'no_lookup_key', null)
      }
      if (!source) {
        return markProductNameAiCollectFailure(
          row,
          'failed',
          '원본 조합을 찾지 못했습니다.',
        )
      }
      try {
        const recommendation = await fetchRecommendation(
          source,
          lookupKeys,
          search,
          searchKeys,
        )
        return applyProductNameAiRecommendation(
          row,
          recommendation,
          minConfidence,
        )
      } catch (error) {
        if (isFatalAiError(error)) fatalMessage = error.actionMessage
        return markProductNameAiCollectFailure(
          row,
          'failed',
          isFatalAiError(error)
            ? error.actionMessage
            : error instanceof Error
              ? error.message
              : '추천을 받지 못했습니다.',
        )
      }
    }

    const nextRows = rows.map((row) => ({ ...row }))
    let publishTimer: number | null = null
    const publish = () => {
      if (generation !== collectGenerationRef.current) return
      publishRows(nextRows)
    }
    const schedulePublish = () => {
      if (publishTimer !== null) return
      publishTimer = window.setTimeout(() => {
        publishTimer = null
        publish()
      }, PUBLISH_MS)
    }
    const applyMirrors = (row: ProductNameAiReviewRow) => {
      for (const key of mirrors.get(row.key) ?? []) {
        const index = nextRows.findIndex((item) => item.key === key)
        if (index < 0) continue
        nextRows[index] = {
          ...row,
          key,
          productName: nextRows[index]!.productName,
          itemName: nextRows[index]!.itemName,
          mallName: nextRows[index]!.mallName,
          ownProductCode: nextRows[index]!.ownProductCode,
          rowCount: nextRows[index]!.rowCount,
        }
      }
    }
    const requestIndexes = nextRows
      .map((_, index) => index)
      .filter((index) => requestKeys.has(nextRows[index]!.key))
    const worker = async () => {
      while (!cancelRef.current && generation === collectGenerationRef.current) {
        const cursorIndex = cursor
        cursor += 1
        const index = requestIndexes[cursorIndex]
        if (index === undefined) return
        const row = nextRows[index]!
        if (!liveComboKeys().has(row.key)) {
          done += 1 + (mirrors.get(row.key)?.length ?? 0)
          setProgress({ done, total: targets.length })
          schedulePublish()
          continue
        }
        nextRows[index] = await collectOne(row)
        applyMirrors(nextRows[index]!)
        done += 1 + (mirrors.get(row.key)?.length ?? 0)
        setProgress({ done, total: targets.length })
        schedulePublish()
      }
    }
    await Promise.all(
      Array.from(
        { length: Math.min(COLLECT_WORKERS, requestIndexes.length || 1) },
        worker,
      ),
    )
    if (publishTimer !== null) window.clearTimeout(publishTimer)
    if (generation !== collectGenerationRef.current) return
    publishRows(nextRows)
    setPhase('review')
  }, [
    brandId,
    clearReviewMarks,
    fetchRecommendation,
    liveComboKeys,
    minConfidence,
    phase,
    publishRows,
  ])

  const retryFailed = useCallback(async () => {
    if (phase === 'collecting') return
    const live = overlayProductNameAiDrafts(reviewRows, draftByKey)
    const failedKeys = new Set(
      live
        .filter(
          (row) =>
            row.holdReason === 'failed' || row.holdReason === 'no_product',
        )
        .map((row) => row.key),
    )
    if (failedKeys.size === 0) return
    const generation = collectGenerationRef.current + 1
    collectGenerationRef.current = generation
    cancelRef.current = false
    setPhase('collecting')
    setApplyError(null)
    setDraftByKey((current) => {
      const next = new Map(current)
      for (const key of failedKeys) next.delete(key)
      return next
    })
    setProgress({ done: 0, total: failedKeys.size })
    const comboByKey = new Map(
      combosRef.current.map((combo) => [combo.key, combo]),
    )
    const nextRows = live.map((row) => ({ ...row }))
    let cursor = 0
    let done = 0
    const searchGate = createSlotGate(SEARCH_WORKERS)
    const searchCache = new Map<string, Promise<AiProductCandidate[]>>()
    const search = (lookupKeys: string[]) => {
      const cacheKey = lookupKeys.map((key) => key.trim()).join('\u0000')
      const cached = searchCache.get(cacheKey)
      if (cached) return cached
      const request = searchGate(() =>
        searchInvoiceProductCandidates(brandId, lookupKeys, 20),
      )
      searchCache.set(cacheKey, request)
      return request
    }
    const worker = async () => {
      while (!cancelRef.current && generation === collectGenerationRef.current) {
        const index = cursor
        cursor += 1
        const row = nextRows[index]
        if (!row) return
        if (!failedKeys.has(row.key)) continue
        if (!liveComboKeys().has(row.key)) {
          done += 1
          setProgress({ done, total: failedKeys.size })
          if (generation === collectGenerationRef.current) {
            publishRows(nextRows)
          }
          continue
        }
        const source = comboByKey.get(row.key)
        const lookupKeys = productNameAiSearchKeys(row)
        const searchKeys = productNameAiCandidateSearchKeys(row)
        if (!source || lookupKeys.length === 0) {
          nextRows[index] = markProductNameAiCollectFailure(
            row,
            lookupKeys.length === 0 ? 'no_lookup_key' : 'failed',
            source ? null : '원본 조합을 찾지 못했습니다.',
          )
        } else {
          try {
            const recommendation = await fetchRecommendation(
              source,
              lookupKeys,
              search,
              searchKeys,
            )
            nextRows[index] = applyProductNameAiRecommendation(
              row,
              recommendation,
              minConfidence,
            )
          } catch (error) {
            nextRows[index] = markProductNameAiCollectFailure(
              row,
              'failed',
              error instanceof Error ? error.message : '추천을 받지 못했습니다.',
            )
          }
        }
        done += 1
        setProgress({ done, total: failedKeys.size })
        if (generation === collectGenerationRef.current) {
          publishRows(nextRows)
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(COLLECT_WORKERS, failedKeys.size) }, worker),
    )
    if (generation !== collectGenerationRef.current) return
    const published = publishRows(nextRows)
    const confirmed = new Set(published.confirmedKeys)
    const pendingAi = new Set(published.pendingAiKeys)
    for (const key of failedKeys) {
      confirmed.delete(key)
      pendingAi.delete(key)
    }
    setConfirmedKeys(confirmed)
    setPendingAiKeys(pendingAi)
    stateRef.current = {
      ...stateRef.current,
      confirmedKeys: confirmed,
      pendingAiKeys: pendingAi,
    }
    setPhase('review')
  }, [
    brandId,
    draftByKey,
    fetchRecommendation,
    liveComboKeys,
    minConfidence,
    phase,
    publishRows,
    reviewRows,
  ])

  const applyReady = useCallback(() => {
    const live = markProductNameAiDuplicates(
      overlayProductNameAiDrafts(reviewRows, draftByKey),
    )
    const saveFailedKeys = new Set<string>()
    for (const [key, status] of saveStatusByKey ?? []) {
      if (isProductNameAiSaveFailed(status)) saveFailedKeys.add(key)
    }
    const guarded = protectedKeysRef.current ?? new Set<string>()
    const ready = live.filter((row) => {
      if (isProtectedGiftSourceCombo(row, guarded)) return false
      return (
        confirmedKeys.has(row.key) &&
        !committedKeys.has(row.key) &&
        productNameAiRowReadyToCommit(row) &&
        saveStatusByKey?.get(row.key) !== 'queued' &&
        saveStatusByKey?.get(row.key) !== 'saving' &&
        saveStatusByKey?.get(row.key) !== 'saved'
      )
    })
    const plan = decideProductNameAiConfirmedSaves(
      ready,
      confirmedKeys,
      saveFailedKeys,
    )
    if (plan.items.length === 0) {
      setApplyError(
        plan.skipped[0]?.message ?? '등록할 수 있는 공식명칭이 없습니다.',
      )
      return
    }
    for (const item of plan.items) {
      const blocked = rejectProtectedGiftSourceSave(item, guarded)
      if (blocked) continue
      enqueue({
        comboKey: item.reviewKey,
        productName: item.productName,
        itemName: optionMapItemNameForRule(item.appliedRule, item.itemName),
        originalItemName: item.itemName,
        mallName: item.mallName,
        ownProductCode: item.ownProductCode,
        lookupKey: item.lookupKey,
        style: item.style,
        extras: extrasOfProductNameAiRow({
          ...live.find((row) => row.key === item.reviewKey)!,
          extras: item.extras,
        }),
        appliedRule: item.appliedRule,
        feedback: {
          source: item.source,
          cacheId: item.cacheId,
          shownRank: item.shownRank,
          provider: item.provider,
          modelId: item.modelId,
          suggestedStyleId: item.suggestedStyleId,
          outcome: item.outcome,
        },
        reviewReasons: [
          item.source === 'local'
            ? '원장 추천'
            : item.source === 'ai'
              ? 'AI 추천'
              : '수동 입력',
          '검수표 일괄 등록',
          ...(item.sharesLookupKey ? ['조회 키 공유'] : []),
        ],
      })
    }
    setCommittedKeys((current) => {
      const next = new Set(current)
      for (const item of plan.items) next.add(item.reviewKey)
      return next
    })
    setAppliedCount(plan.items.length)
    setApplyError(
      plan.skipped.length > 0
        ? `${plan.skipped.length}개는 본품 공식명칭이 없어 건너뛰었습니다.`
        : null,
    )
    setPhase('applied')
  }, [
    committedKeys,
    confirmedKeys,
    draftByKey,
    enqueue,
    reviewRows,
    saveStatusByKey,
  ])

  const retrySaveFailed = useCallback(
    (history: ProductMapHistoryEntry[]) => {
      const guarded = protectedKeysRef.current ?? new Set<string>()
      for (const entry of selectLatestFailedSaveRetries(history)) {
        const status = saveStatusByKey?.get(entry.comboKey)
        if (status === 'queued' || status === 'saving') continue
        if (rejectProtectedGiftSourceSave(entry, guarded)) continue
        enqueue({
          historyId: entry.id,
          comboKey: entry.comboKey,
          productName: entry.productName,
          itemName: entry.itemName,
          originalItemName: entry.originalItemName,
          mallName: entry.mallName,
          ownProductCode: entry.ownProductCode,
          lookupKey: entry.lookupKey,
          style: entry.style,
          extras: entry.extras,
          appliedRule: entry.appliedRule,
          feedback: entry.feedback,
          reviewReasons: entry.reviewReasons,
        })
      }
    },
    [enqueue, saveStatusByKey],
  )

  const saveFailedKeys = useMemo(() => {
    const next = new Set<string>()
    for (const [key, status] of saveStatusByKey ?? []) {
      if (isProductNameAiSaveFailed(status)) next.add(key)
    }
    return next
  }, [saveStatusByKey])

  const workflowCounts = useMemo(
    () =>
      countProductNameAiWorkflow({
        rows: shownRows,
        confirmedKeys,
        saveFailedKeys,
      }),
    [confirmedKeys, saveFailedKeys, shownRows],
  )
  const readyCommitCount = useMemo(() => {
    const guarded = protectedKeys ?? new Set<string>()
    let count = 0
    for (const row of shownRows) {
      if (isProtectedGiftSourceCombo(row, guarded)) continue
      if (!confirmedKeys.has(row.key) || committedKeys.has(row.key)) continue
      if (saveFailedKeys.has(row.key)) continue
      if (!productNameAiRowReadyToCommit(row)) continue
      const status = saveStatusByKey?.get(row.key)
      if (status === 'queued' || status === 'saving' || status === 'saved') {
        continue
      }
      count += 1
    }
    return count
  }, [
    committedKeys,
    confirmedKeys,
    protectedKeys,
    saveFailedKeys,
    saveStatusByKey,
    shownRows,
  ])
  const failedCollectCount = useMemo(
    () => shownRows.filter((row) => productNameAiCollectFailed(row)).length,
    [shownRows],
  )
  const canCommit = readyCommitCount > 0 && phase !== 'collecting'

  return {
    brandId,
    routeReady: Boolean(route?.isActive),
    routeLoading: routeQuery.isLoading,
    minConfidence,
    phase,
    progress,
    reviewRows: shownRows,
    draftByKey,
    confirmedKeys,
    pendingAiKeys,
    committedKeys,
    saveFailedKeys,
    readyCount: readyCommitCount,
    reviewCount: workflowCounts.reviewCount,
    saveFailedCount: workflowCounts.saveFailedCount,
    failedCollectCount,
    targetCount: combos.filter(
      (combo) =>
        !isProtectedGiftSourceCombo(combo, protectedKeys ?? new Set()),
    ).length,
    queueCount: shownRows.length,
    appliedCount,
    applyError,
    canCommit,
    collect,
    retryFailed,
    retrySaveFailed,
    cancel,
    reset,
    extrasDraftByKey,
    extrasDraftOf,
    setExtrasDraft,
    updateRow,
    applySlots,
    confirmRow,
    markPendingAi,
    unconfirmRow,
    applyReady,
  }
}
