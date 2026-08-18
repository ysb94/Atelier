import { useCallback, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { DEFAULT_DECISION_CONFIG } from '@/lib/ai/gateway-core'
import { withRecommendSlot } from '@/lib/ai/recommend-queue'
import {
  getAiFeatureRoute,
  recommendInvoiceProduct,
  searchInvoiceProductCandidates,
} from '@/lib/api'
import type { UnresolvedProductNameCombo } from '@/lib/invoice/product-name-transform'
import { optionMapItemNameForRule } from '@/lib/invoice/product-name-patterns'
import { normalizeInvoiceText } from '@/lib/invoice/prefix-transform'
import type { AiProductRecommendation, StyleRef } from '@/lib/types'
import type { ProductMapEnqueueInput } from './useInvoiceProductNameSaveQueue'

export type BulkAiApplyPhase = 'idle' | 'collecting' | 'review' | 'applied'

export type BulkAiApplyHoldReason =
  | 'no_lookup_key'
  | 'no_product'
  | 'failed'

/** 추천을 받은 항목. 사람이 체크한 것만 원장에 넣는다. */
export type BulkAiApplyPlanRow = {
  comboKey: string
  productName: string
  itemName: string
  mallName: string
  rowCount: number
  isConflict: boolean
  lookupKey: string
  appliedRule: string | null
  style: StyleRef
  confidence: number
  source: 'local' | 'ai'
  cacheId: string | null
  provider: AiProductRecommendation['provider']
  modelId: string
  /** 확실도 기준을 넘겼는지. 기본 체크 여부를 정한다. */
  passesGate: boolean
  /** 앞선 행이 같은 조회 키를 이미 쓰고 있으면 그 품목명. */
  duplicateOf: string | null
}

/** 추천 자체를 못 받아 사람이 직접 봐야 하는 항목. */
export type BulkAiApplyHoldRow = {
  comboKey: string
  productName: string
  itemName: string
  reason: BulkAiApplyHoldReason
  message: string | null
}

const FEATURE_KEY = 'invoice_product_recommendation'

/** 동시에 진행할 항목 수. 실제 동시 호출 수는 추천 큐가 다시 제한한다. */
const COLLECT_WORKERS = 6

/**
 * 미해결 품목의 AI 추천을 먼저 모으고, 사람이 승인한 것만 원장에 등록한다.
 *
 * 추천은 화면에서 펼친 그룹만 계산되므로 최종 품목명에 곧바로 흘려보내지 않는다.
 * 등록을 거쳐 원장에 남긴 값만 출력에 쓰고, 그 등록을 사람이 확인하게 만든다.
 */
export function useInvoiceProductNameBulkAiApply({
  brandId,
  combos,
  enqueue,
}: {
  brandId: string
  combos: UnresolvedProductNameCombo[]
  enqueue: (input: ProductMapEnqueueInput) => void
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
  const [planRows, setPlanRows] = useState<BulkAiApplyPlanRow[]>([])
  const [holdRows, setHoldRows] = useState<BulkAiApplyHoldRow[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [appliedCount, setAppliedCount] = useState(0)
  const cancelRef = useRef(false)

  /** AiRecommendPanel과 같은 캐시 키를 써서 이미 받은 추천을 다시 사지 않는다. */
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
  }, [])

  const reset = useCallback(() => {
    setPhase('idle')
    setPlanRows([])
    setHoldRows([])
    setSelected(new Set())
    setAppliedCount(0)
    setProgress({ done: 0, total: 0 })
  }, [])

  /** 추천만 모은다. 이 단계에서는 원장을 건드리지 않는다. */
  const collect = useCallback(async () => {
    if (phase === 'collecting') return
    cancelRef.current = false
    setPhase('collecting')
    setPlanRows([])
    setHoldRows([])
    setSelected(new Set())
    setAppliedCount(0)
    setProgress({ done: 0, total: combos.length })

    const plan: BulkAiApplyPlanRow[] = []
    const holds: BulkAiApplyHoldRow[] = []
    let cursor = 0
    let done = 0

    const collectOne = async (combo: UnresolvedProductNameCombo) => {
      const lookupKeys = combo.candidates
        .map((candidate) => candidate.text.trim())
        .filter(Boolean)

      if (lookupKeys.length === 0) {
        holds.push({
          comboKey: combo.key,
          productName: combo.productName,
          itemName: combo.itemName,
          reason: 'no_lookup_key',
          message: null,
        })
        return
      }

      try {
        const recommendation = await fetchRecommendation(combo, lookupKeys)
        const top = recommendation.products[0]
        if (!top) {
          holds.push({
            comboKey: combo.key,
            productName: combo.productName,
            itemName: combo.itemName,
            reason: 'no_product',
            message: recommendation.reason || null,
          })
          return
        }
        plan.push({
          comboKey: combo.key,
          productName: combo.productName,
          itemName: combo.itemName,
          mallName: combo.mallName,
          rowCount: combo.rowCount,
          isConflict: combo.status === 'conflict',
          lookupKey: recommendation.lookupKey || lookupKeys[0]!,
          appliedRule:
            combo.candidates.find(
              (candidate) => candidate.text === recommendation.lookupKey,
            )?.rule ?? combo.appliedRule,
          style: {
            styleId: top.styleId,
            styleNo: top.styleNo,
            name: top.name,
          },
          confidence: top.confidence,
          source: recommendation.source === 'local' ? 'local' : 'ai',
          cacheId: recommendation.cacheId,
          provider: recommendation.provider,
          modelId: recommendation.modelId,
          passesGate: top.confidence >= minConfidence,
          duplicateOf: null,
        })
      } catch (error) {
        holds.push({
          comboKey: combo.key,
          productName: combo.productName,
          itemName: combo.itemName,
          reason: 'failed',
          message:
            error instanceof Error ? error.message : '추천을 받지 못했습니다.',
        })
      }
    }

    // 한 건마다 LLM 왕복을 기다리므로 순차로 돌리면 100건에 몇 분이 걸린다.
    // 여러 건을 동시에 진행하고, 실제 동시 실행 수는 추천 큐가 제한한다.
    const worker = async () => {
      while (!cancelRef.current) {
        const combo = combos[cursor]
        if (!combo) return
        cursor += 1
        await collectOne(combo)
        done += 1
        setProgress({ done, total: combos.length })
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(COLLECT_WORKERS, combos.length) }, worker),
    )

    // 같은 조회 키는 원장에 하나만 들어간다. 확실도가 가장 높은 행을 남기고
    // 나머지는 중복으로 표시해 기본 선택에서 뺀다.
    const ownerByKey = new Map<string, BulkAiApplyPlanRow>()
    for (const item of plan) {
      const key = normalizeInvoiceText(item.lookupKey)
      const owner = ownerByKey.get(key)
      if (!owner || item.confidence > owner.confidence) {
        ownerByKey.set(key, item)
      }
    }
    for (const item of plan) {
      const owner = ownerByKey.get(normalizeInvoiceText(item.lookupKey))
      item.duplicateOf = owner === item ? null : (owner?.productName ?? null)
    }

    // 확실도 낮은 순. 사람이 먼저 봐야 하는 것이 위로 온다.
    plan.sort(
      (left, right) =>
        left.confidence - right.confidence ||
        left.productName.localeCompare(right.productName, 'ko-KR'),
    )
    setPlanRows(plan)
    setHoldRows(holds)
    setSelected(
      new Set(
        plan
          .filter((item) => item.passesGate && !item.duplicateOf)
          .map((item) => item.comboKey),
      ),
    )
    setPhase('review')
  }, [combos, fetchRecommendation, minConfidence, phase])

  const toggle = useCallback((comboKey: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(comboKey)) next.delete(comboKey)
      else next.add(comboKey)
      return next
    })
  }, [])

  const selectRecommended = useCallback(() => {
    setSelected(
      new Set(
        planRows
          .filter((item) => item.passesGate && !item.duplicateOf)
          .map((item) => item.comboKey),
      ),
    )
  }, [planRows])

  const clearSelection = useCallback(() => setSelected(new Set()), [])

  /** 승인한 항목만 저장 큐에 넣는다. 여기서 처음 원장이 바뀐다. */
  const applySelected = useCallback(() => {
    const usedLookupKeys = new Set<string>()
    let applied = 0
    for (const item of planRows) {
      if (!selected.has(item.comboKey)) continue
      const normalizedLookupKey = normalizeInvoiceText(item.lookupKey)
      // 같은 조회 키를 병렬로 저장하면 원장이 중복된다.
      if (usedLookupKeys.has(normalizedLookupKey)) continue
      usedLookupKeys.add(normalizedLookupKey)
      enqueue({
        comboKey: item.comboKey,
        productName: item.productName,
        itemName: optionMapItemNameForRule(item.appliedRule, item.itemName),
        originalItemName: item.itemName,
        mallName: item.mallName,
        lookupKey: item.lookupKey,
        style: item.style,
        appliedRule: item.appliedRule,
        feedback: {
          source: item.source,
          cacheId: item.cacheId,
          shownRank: 1,
          provider: item.provider,
          modelId: item.modelId,
        },
        reviewReasons: [
          item.source === 'local' ? '원장 추천' : 'AI 추천',
          '일괄 승인',
          ...(item.isConflict ? ['충돌'] : []),
          ...(item.passesGate ? [] : ['확실도 미달 수동 승인']),
        ],
      })
      applied += 1
    }
    setAppliedCount(applied)
    setPlanRows([])
    setHoldRows([])
    setSelected(new Set())
    setPhase('applied')
  }, [enqueue, planRows, selected])

  const recommendedCount = useMemo(
    () =>
      planRows.filter((item) => item.passesGate && !item.duplicateOf).length,
    [planRows],
  )

  return {
    routeReady: Boolean(route?.isActive),
    routeLoading: routeQuery.isLoading,
    minConfidence,
    phase,
    progress,
    planRows,
    holdRows,
    selected,
    selectedCount: selected.size,
    recommendedCount,
    appliedCount,
    collect,
    cancel,
    toggle,
    selectRecommended,
    clearSelection,
    applySelected,
    reset,
  }
}
