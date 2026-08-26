import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { DEFAULT_DECISION_CONFIG } from '@/lib/ai/gateway-core'
import { withRecommendSlot } from '@/lib/ai/recommend-queue'
import {
  getAiFeatureRoute,
  recommendInvoiceProduct,
  searchInvoiceProductCandidates,
} from '@/lib/api'
import { optionMapItemNameForRule } from '@/lib/invoice/product-name-patterns'
import {
  applyProductNameAiRecommendation,
  applyProductNameAiRowSlots,
  applyProductNameLookupKey,
  buildProductNameAiReviewRows,
  productNameAiSearchKeys,
  countProductNameAiWorkflow,
  decideProductNameAiConfirmedSaves,
  isProductNameAiSaveFailed,
  markProductNameAiCollectFailure,
  markProductNameAiDuplicates,
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
import type { UnresolvedProductNameCombo } from '@/lib/invoice/product-name-transform'
import type { AiProductRecommendation } from '@/lib/types'
import type { OptionExtraDraft } from './InvoiceOptionExtrasEditor'
import type {
  ProductMapEnqueueInput,
  ProductMapHistoryEntry,
  ProductMapHistoryStatus,
} from './useInvoiceProductNameSaveQueue'

export type BulkAiApplyPhase = 'idle' | 'collecting' | 'review' | 'applied'

const FEATURE_KEY = 'invoice_product_recommendation'
const COLLECT_WORKERS = 6

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
}: {
  brandId: string
  combos: UnresolvedProductNameCombo[]
  enqueue: (input: ProductMapEnqueueInput) => void
  saveStatusByKey?: ReadonlyMap<string, ProductMapHistoryStatus>
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
  const cancelRef = useRef(false)
  const collectGenerationRef = useRef(0)
  const combosRef = useRef(combos)
  combosRef.current = combos
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
    (combo: UnresolvedProductNameCombo, lookupKeys: string[]) =>
      queryClient.fetchQuery({
        queryKey: [
          'ai-product-recommendation',
          brandId,
          combo.key,
          route?.provider ?? '',
          route?.modelId ?? '',
          route?.recommendationPolicy ?? 'hybrid_auto',
          JSON.stringify(route?.decisionConfig ?? {}),
        ],
        staleTime: Infinity,
        retry: false,
        queryFn: async (): Promise<AiProductRecommendation> =>
          withRecommendSlot(async () => {
            const candidates = await searchInvoiceProductCandidates(
              brandId,
              lookupKeys,
              20,
            )
            return recommendInvoiceProduct({
              brandId,
              lookupKeys,
              candidates,
              productName: combo.productName,
              itemName: combo.itemName,
              mallName: combo.mallName,
            })
          }),
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
  }, [liveComboKey])

  const shownRows = useMemo(
    () =>
      markProductNameAiDuplicates(
        overlayProductNameAiDrafts(reviewRows, draftByKey),
      ),
    [draftByKey, reviewRows],
  )

  const writeDraft = useCallback((row: ProductNameAiReviewRow) => {
    setDraftByKey((current) => {
      const next = new Map(current)
      next.set(row.key, row)
      return next
    })
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

  const applySlots = useCallback(
    (
      key: string,
      slots: ProductNameAiQuickSlot[],
      mode: 'edit' | 'confirm' | 'resolved',
    ): { ok: boolean; error?: string; decision?: ProductNameAiEnterDecision } => {
      const current =
        draftByKey.get(key) ?? reviewRows.find((row) => row.key === key)
      if (!current) return { ok: false, error: '행을 찾지 못했습니다.' }
      const result = applyProductNameAiRowSlots(current, slots, mode)
      if (!result.ok) return { ok: false, error: result.error, decision: result.decision }
      writeDraft(result.row)
      if (mode === 'confirm') {
        if (result.decision.status === 'needs_ai') markPendingAi(key)
        else confirmRow(key)
      } else {
        unconfirmRow(key)
      }
      return { ok: true, decision: result.decision }
    },
    [confirmRow, draftByKey, markPendingAi, reviewRows, unconfirmRow, writeDraft],
  )

  const collect = useCallback(async () => {
    if (phase === 'collecting') return
    const generation = collectGenerationRef.current + 1
    collectGenerationRef.current = generation
    cancelRef.current = false
    const targets = combosRef.current
    setPhase('collecting')
    setAppliedCount(0)
    setApplyError(null)
    setDraftByKey(new Map())
    setConfirmedKeys(new Set())
    setPendingAiKeys(new Set())
    setCommittedKeys(new Set())
    setProgress({ done: 0, total: targets.length })
    const rows = buildProductNameAiReviewRows(targets)
    setReviewRows(rows)
    const comboByKey = new Map(targets.map((combo) => [combo.key, combo]))
    let cursor = 0
    let done = 0

    const collectOne = async (row: ProductNameAiReviewRow) => {
      if (row.holdReason === 'exclusion_guarded') return row
      const source = comboByKey.get(row.key)
      const lookupKeys = productNameAiSearchKeys(row)
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
        const recommendation = await fetchRecommendation(source, lookupKeys)
        return applyProductNameAiRecommendation(
          row,
          recommendation,
          minConfidence,
        )
      } catch (error) {
        return markProductNameAiCollectFailure(
          row,
          'failed',
          error instanceof Error ? error.message : '추천을 받지 못했습니다.',
        )
      }
    }

    const nextRows = rows.map((row) => ({ ...row }))
    const publish = () => {
      if (generation !== collectGenerationRef.current) return
      setReviewRows(nextRows.map((row) => ({ ...row })))
    }
    const worker = async () => {
      while (!cancelRef.current && generation === collectGenerationRef.current) {
        const index = cursor
        cursor += 1
        const row = nextRows[index]
        if (!row) return
        nextRows[index] = await collectOne(row)
        done += 1
        setProgress({ done, total: targets.length })
        publish()
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(COLLECT_WORKERS, targets.length) }, worker),
    )
    if (generation !== collectGenerationRef.current) return
    const marked = markProductNameAiDuplicates(nextRows)
    setReviewRows(marked)
    setConfirmedKeys(new Set())
    setPendingAiKeys(new Set())
    setPhase('review')
  }, [fetchRecommendation, minConfidence, phase])

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
    const worker = async () => {
      while (!cancelRef.current && generation === collectGenerationRef.current) {
        const index = cursor
        cursor += 1
        const row = nextRows[index]
        if (!row) return
        if (!failedKeys.has(row.key)) continue
        const source = comboByKey.get(row.key)
        const lookupKeys = productNameAiSearchKeys(row)
        if (!source || lookupKeys.length === 0) {
          nextRows[index] = markProductNameAiCollectFailure(
            row,
            lookupKeys.length === 0 ? 'no_lookup_key' : 'failed',
            source ? null : '원본 조합을 찾지 못했습니다.',
          )
        } else {
          try {
            const recommendation = await fetchRecommendation(source, lookupKeys)
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
          setReviewRows(nextRows.map((item) => ({ ...item })))
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(COLLECT_WORKERS, failedKeys.size) }, worker),
    )
    if (generation !== collectGenerationRef.current) return
    const marked = markProductNameAiDuplicates(nextRows)
    setReviewRows(marked)
    setConfirmedKeys((current) => {
      const next = new Set(current)
      for (const key of failedKeys) next.delete(key)
      return next
    })
    setPendingAiKeys((current) => {
      const next = new Set(current)
      for (const key of failedKeys) next.delete(key)
      return next
    })
    setPhase('review')
  }, [draftByKey, fetchRecommendation, minConfidence, phase, reviewRows])

  const applyReady = useCallback(() => {
    const live = markProductNameAiDuplicates(
      overlayProductNameAiDrafts(reviewRows, draftByKey),
    )
    const saveFailedKeys = new Set<string>()
    for (const [key, status] of saveStatusByKey ?? []) {
      if (isProductNameAiSaveFailed(status)) saveFailedKeys.add(key)
    }
    const counts = countProductNameAiWorkflow({
      rows: live,
      confirmedKeys,
      saveFailedKeys,
    })
    if (counts.reviewCount > 0) {
      setApplyError('검토 필요한 행이 남아 있습니다.')
      return
    }
    const ready = live.filter(
      (row) =>
        confirmedKeys.has(row.key) &&
        productNameAiRowReadyToCommit(row) &&
        saveStatusByKey?.get(row.key) !== 'queued' &&
        saveStatusByKey?.get(row.key) !== 'saving',
    )
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
  }, [confirmedKeys, draftByKey, enqueue, reviewRows, saveStatusByKey])

  const retrySaveFailed = useCallback(
    (history: ProductMapHistoryEntry[]) => {
      for (const entry of selectLatestFailedSaveRetries(history)) {
        const status = saveStatusByKey?.get(entry.comboKey)
        if (status === 'queued' || status === 'saving') continue
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
  const failedCollectCount = useMemo(
    () => shownRows.filter((row) => productNameAiCollectFailed(row)).length,
    [shownRows],
  )
  const canCommit =
    workflowCounts.reviewCount === 0 &&
    workflowCounts.readyCount > 0 &&
    phase !== 'collecting'

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
    readyCount: workflowCounts.readyCount,
    reviewCount: workflowCounts.reviewCount,
    saveFailedCount: workflowCounts.saveFailedCount,
    failedCollectCount,
    targetCount: combos.length,
    queueCount: shownRows.length,
    appliedCount,
    applyError,
    canCommit,
    collect,
    retryFailed,
    retrySaveFailed,
    cancel,
    reset,
    updateRow,
    applySlots,
    confirmRow,
    markPendingAi,
    unconfirmRow,
    applyReady,
  }
}
