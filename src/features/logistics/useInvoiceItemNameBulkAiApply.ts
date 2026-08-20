import { useCallback, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ACCESSORY_FEATURE_KEY,
  DEFAULT_DECISION_CONFIG,
} from '@/lib/ai/gateway-core'
import { createSlotGate, withRecommendSlot } from '@/lib/ai/recommend-queue'
import {
  getAiFeatureRoute,
  recommendInvoiceItemNameRules,
  saveInvoiceItemNameRules,
  searchInvoiceProductCandidates,
} from '@/lib/api'
import {
  appendItemNameAiComponent,
  buildItemNameAiReviewRows,
  collectItemNameAiGroups,
  decideItemNameAiSaves,
  dedupeItemNameAiContexts,
  itemNameAiCandidateTexts,
  itemNameAiGroupsForContexts,
  mergeItemNameAiDrafts,
  mirrorItemNameAiDecisions,
  overlayItemNameAiDrafts,
  planItemNameAiBatches,
  restoreItemNameAiDrafts,
  validateItemNameAiReviewRow,
  type ItemNameAiContext,
  type ItemNameAiReviewRow,
  type ItemNameAiAction,
  type ItemNameAiLastAppend,
} from '@/lib/invoice/item-name-ai-review'
import { normalizeInvoiceText } from '@/lib/invoice/prefix-transform'
import {
  candidatesForContext,
  findExistingLookupRule,
  mergeAccessoryStyleCandidates,
  type AccessoryLookupComponent,
} from '@/lib/invoice/accessory-suggest'
import type {
  AiAccessoryContextDecision,
  AiProductCandidate,
  InvoiceAccessoryRule,
  InvoiceItemNameRule,
  StyleRef,
} from '@/lib/types'
import type { UnresolvedItemNameCombo } from '@/lib/invoice/item-name-transform'
import type { OptionExtraDraft } from './InvoiceOptionExtrasEditor'

export type ItemNameAiBulkPhase = 'idle' | 'collecting' | 'review' | 'applied'

const CONTEXTS_PER_REQUEST = 8
/** 실제 상한은 추천 큐가 잡는다. 여기서는 큐를 굶기지 않을 만큼만 띄운다. */
const COLLECT_WORKERS = 8
const CANDIDATE_WORKERS = 4
const CANDIDATE_LIMIT = 40

function componentsFromExtras(
  extras: OptionExtraDraft[],
): AccessoryLookupComponent[] {
  return extras.flatMap((item) =>
    item.style
      ? [{ style: item.style, quantity: Math.max(1, item.quantity || 1) }]
      : [],
  )
}

export function extrasOfItemNameAiRow(
  row: ItemNameAiReviewRow,
): OptionExtraDraft[] {
  return row.components.map((item, index) => ({
    key: `${item.style.styleId}-${index}`,
    style: item.style,
    role: 'included',
    quantity: item.quantity,
  }))
}

function inputIdentity(input: {
  scope: string
  itemName: string
  mainStyleId?: string | null
  productLookupKey?: string | null
}) {
  return [
    input.scope,
    normalizeInvoiceText(input.itemName),
    input.mainStyleId ?? '',
    normalizeInvoiceText(input.productLookupKey ?? ''),
  ].join('\u0000')
}

export function useInvoiceItemNameBulkAiApply({
  brandId,
  combos,
  accessoryRules,
  itemNameRules,
  styles,
}: {
  brandId: string
  combos: UnresolvedItemNameCombo[]
  accessoryRules: InvoiceAccessoryRule[]
  itemNameRules: InvoiceItemNameRule[]
  styles: StyleRef[]
}) {
  const queryClient = useQueryClient()
  const routeQuery = useQuery({
    queryKey: ['ai-feature-route', brandId, ACCESSORY_FEATURE_KEY],
    queryFn: () => getAiFeatureRoute(brandId, ACCESSORY_FEATURE_KEY),
    staleTime: 5 * 60_000,
  })
  const route = routeQuery.data ?? null
  const minConfidence =
    route?.decisionConfig?.high ?? DEFAULT_DECISION_CONFIG.high
  const groups = useMemo(() => collectItemNameAiGroups(combos), [combos])
  const contexts = useMemo(
    () => groups.flatMap((group) => group.contexts),
    [groups],
  )
  const knownStyleIds = useMemo(
    () => new Set(styles.map((style) => style.styleId)),
    [styles],
  )

  const [phase, setPhase] = useState<ItemNameAiBulkPhase>('idle')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [reviewRows, setReviewRows] = useState<ItemNameAiReviewRow[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [draftByKey, setDraftByKey] = useState<Map<string, ItemNameAiReviewRow>>(
    () => new Map(),
  )
  const [lastAppend, setLastAppend] = useState<ItemNameAiLastAppend | null>(null)
  const [appliedCount, setAppliedCount] = useState(0)
  const [failedCount, setFailedCount] = useState(0)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const cancelRef = useRef(false)

  const fetchRecommendation = useCallback(
    (
      batch: ItemNameAiContext[],
      candidates: ReturnType<typeof mergeAccessoryStyleCandidates>,
      requestContexts: Array<{
        contextId: string
        itemName: string
        productLookupKey: string
        mainProduct: string
        candidateStyleIds: string[]
      }>,
    ) =>
      queryClient.fetchQuery({
        queryKey: [
          'ai-item-name-recommendation',
          brandId,
          route?.provider ?? '',
          route?.modelId ?? '',
          batch.map((item) => item.contextId).join('|'),
          candidates.map((item) => item.styleId).join('|'),
        ],
        staleTime: Infinity,
        retry: false,
        queryFn: () =>
          withRecommendSlot(() =>
            recommendInvoiceItemNameRules({
              brandId,
              contexts: requestContexts,
              candidates,
            }),
          ),
      }),
    [brandId, queryClient, route?.modelId, route?.provider],
  )

  const cancel = useCallback(() => {
    cancelRef.current = true
  }, [])

  const reset = useCallback(() => {
    cancelRef.current = false
    setPhase('idle')
    setReviewRows([])
    setSelected(new Set())
    setDraftByKey(new Map())
    setLastAppend(null)
    setAppliedCount(0)
    setFailedCount(0)
    setApplyError(null)
    setProgress({ done: 0, total: 0 })
  }, [])

  const collect = useCallback(async () => {
    if (phase === 'collecting' || contexts.length === 0) return
    cancelRef.current = false
    setPhase('collecting')
    setReviewRows([])
    setSelected(new Set())
    setDraftByKey(new Map())
    setLastAppend(null)
    setAppliedCount(0)
    setFailedCount(0)
    setApplyError(null)
    setProgress({ done: 0, total: contexts.length })

    const { requests, mirrors } = dedupeItemNameAiContexts(contexts)
    const batches = planItemNameAiBatches(requests, CONTEXTS_PER_REQUEST)
    const orderByContextId = new Map(
      contexts.map((context, index) => [context.contextId, index]),
    )
    const decidedIds = new Set<string>()
    let cursor = 0
    let done = 0

    const searchGate = createSlotGate(CANDIDATE_WORKERS)
    const searchCache = new Map<string, Promise<AiProductCandidate[]>>()
    const searchCandidates = (texts: string[]) => {
      const cacheKey = texts.join('\u0000')
      const cached = searchCache.get(cacheKey)
      if (cached) return cached
      const search = searchGate(() =>
        searchInvoiceProductCandidates(brandId, texts, CANDIDATE_LIMIT),
      )
      searchCache.set(cacheKey, search)
      return search
    }

    const prepare = async (batch: ItemNameAiContext[]) => {
      const searched = await searchCandidates(itemNameAiCandidateTexts(batch))
      const candidates = mergeAccessoryStyleCandidates(
        searched,
        styles,
        accessoryRules,
        60,
      )
      const requestContexts = batch.map((context) => {
        const scoped = candidatesForContext(candidates, {
          itemName: context.itemName,
          productLookupKey: context.productLookupKey,
          mainStyle: context.mainStyle,
          unknownPieces: [],
          rowCount: context.rowCount,
        }).filter(
          (candidate) => candidate.styleId !== context.mainStyle?.styleId,
        )
        return {
          contextId: context.contextId,
          itemName: context.itemName.slice(0, 200),
          productLookupKey: context.productLookupKey.slice(0, 200),
          mainProduct: context.mainStyle
            ? `${context.mainStyle.styleNo} ${context.mainStyle.name}`.slice(
                0,
                120,
              )
            : '',
          candidateStyleIds: scoped.map((item) => item.styleId),
        }
      })
      return { candidates, requestContexts }
    }

    // 후보 검색을 미리 돌려 LLM 왕복 시간 뒤에 숨긴다.
    const prepared = batches.map((batch) =>
      prepare(batch).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      ),
    )

    const holdsFor = (batch: ItemNameAiContext[], reason: string) =>
      batch.map((context) => ({
        contextId: context.contextId,
        action: 'hold' as const,
        components: [],
        confidence: 0,
        reason,
      }))

    const publish = (decisions: AiAccessoryContextDecision[]) => {
      const mirrored = mirrorItemNameAiDecisions(decisions, mirrors)
      const contextIds = new Set(mirrored.map((item) => item.contextId))
      for (const contextId of contextIds) decidedIds.add(contextId)
      const rows = buildItemNameAiReviewRows({
        groups: itemNameAiGroupsForContexts(groups, contextIds),
        decisions: mirrored,
        styles,
        itemNameRules,
        minConfidence,
      })
      // 검수 표를 모으는 동안 채워 사용자가 끝까지 기다리지 않게 한다.
      setReviewRows((current) =>
        [...current, ...rows].sort(
          (left, right) =>
            (orderByContextId.get(left.key) ?? 0) -
            (orderByContextId.get(right.key) ?? 0),
        ),
      )
      setSelected((current) => {
        const next = new Set(current)
        for (const row of rows) {
          if (row.passesGate && !row.validationError) next.add(row.key)
        }
        return next
      })
      done += contextIds.size
      setProgress({ done, total: contexts.length })
    }

    const worker = async () => {
      while (!cancelRef.current) {
        const index = cursor
        const batch = batches[index]
        if (!batch) return
        cursor += 1
        const settled = await prepared[index]!
        if (cancelRef.current) return
        if (!settled.ok) {
          publish(
            holdsFor(
              batch,
              settled.error instanceof Error
                ? settled.error.message
                : '유사 상품 후보를 찾지 못했습니다.',
            ),
          )
          continue
        }
        try {
          const recommendation = await fetchRecommendation(
            batch,
            settled.value.candidates,
            settled.value.requestContexts,
          )
          const returned = new Set(
            recommendation.contexts.map((item) => item.contextId),
          )
          publish([
            ...recommendation.contexts,
            ...holdsFor(
              batch.filter((context) => !returned.has(context.contextId)),
              recommendation.reason || '추천 결과가 없습니다.',
            ),
          ])
        } catch (error) {
          publish(
            holdsFor(
              batch,
              error instanceof Error
                ? error.message
                : '추천을 받지 못했습니다.',
            ),
          )
        }
      }
    }
    await Promise.all(
      Array.from(
        { length: Math.min(COLLECT_WORKERS, batches.length || 1) },
        worker,
      ),
    )

    if (!cancelRef.current) {
      const missing = contexts.filter(
        (context) => !decidedIds.has(context.contextId),
      )
      if (missing.length > 0) {
        publish(holdsFor(missing, '추천 결과가 없습니다.'))
      }
    }
    setPhase('review')
  }, [
    accessoryRules,
    brandId,
    contexts,
    fetchRecommendation,
    groups,
    itemNameRules,
    minConfidence,
    phase,
    styles,
  ])

  const toggle = useCallback((key: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const updateRow = useCallback(
    (
      key: string,
      patch: {
        action?: ItemNameAiAction
        extras?: OptionExtraDraft[]
        components?: AccessoryLookupComponent[]
      },
    ) => {
      if (draftByKey.size > 0) return
      setReviewRows((current) =>
        current.map((row) => {
          if (row.key !== key) return row
          const action = patch.action ?? row.action
          const components =
            patch.components ??
            (patch.extras ? componentsFromExtras(patch.extras) : row.components)
          const next = validateItemNameAiReviewRow(
            {
              ...row,
              action,
              components: action === 'components' ? components : [],
            },
            knownStyleIds,
          )
          if (next.validationError) {
            setSelected((selectedKeys) => {
              if (!selectedKeys.has(key)) return selectedKeys
              const copy = new Set(selectedKeys)
              copy.delete(key)
              return copy
            })
          }
          return next
        }),
      )
    },
    [draftByKey, knownStyleIds],
  )

  const appendComponentToRows = useCallback(
    (keys: Iterable<string>, component: AccessoryLookupComponent) => {
      let result: ItemNameAiLastAppend | null = null
      setDraftByKey((current) => {
        const next = appendItemNameAiComponent(
          overlayItemNameAiDrafts(reviewRows, current),
          keys,
          component,
          knownStyleIds,
        )
        result = {
          addedKeys: next.addedKeys,
          skippedKeys: next.skippedKeys,
          previous: next.previous,
        }
        return mergeItemNameAiDrafts(current, next)
      })
      setLastAppend(result)
      return result
    },
    [knownStyleIds, reviewRows],
  )

  const undoLastAppend = useCallback(() => {
    if (!lastAppend || lastAppend.previous.length === 0) return
    setDraftByKey((current) =>
      restoreItemNameAiDrafts(current, lastAppend.previous, reviewRows),
    )
    setLastAppend(null)
  }, [lastAppend, reviewRows])

  const commitDrafts = useCallback(() => {
    if (draftByKey.size === 0) return
    setReviewRows((current) => overlayItemNameAiDrafts(current, draftByKey))
    setDraftByKey(new Map())
    setLastAppend(null)
  }, [draftByKey])

  const discardDrafts = useCallback(() => {
    setDraftByKey(new Map())
    setLastAppend(null)
  }, [])

  const selectRecommended = useCallback(() => {
    setSelected(
      new Set(
        reviewRows
          .filter((row) => row.passesGate && !row.validationError)
          .map((row) => row.key),
      ),
    )
  }, [reviewRows])

  const clearSelection = useCallback(() => setSelected(new Set()), [])

  const applySelected = useCallback(async () => {
    if (selected.size === 0 || draftByKey.size > 0) return
    setApplying(true)
    setApplyError(null)

    const globalByItem = new Map(
      itemNameRules
        .filter((rule) => rule.isActive && rule.scope === 'global')
        .map((rule) => [rule.normalizedItemName, rule]),
    )
    const rechecked = reviewRows.map((row) => {
      if (!selected.has(row.key)) return row
      const exact =
        row.mainStyle && row.productLookupKey.trim()
          ? findExistingLookupRule(
              itemNameRules,
              row.itemName,
              row.mainStyle.styleId,
              row.productLookupKey,
            )
          : null
      return validateItemNameAiReviewRow(
        {
          ...row,
          existingRuleId: exact?.id ?? row.existingRuleId,
          existingGlobalRuleId:
            globalByItem.get(normalizeInvoiceText(row.itemName))?.id ??
            row.existingGlobalRuleId,
        },
        knownStyleIds,
      )
    })
    setReviewRows(rechecked)
    const plan = decideItemNameAiSaves(rechecked, selected)
    const requests = [
      ...plan.globals.map((item) => ({
        input: item.input,
        ruleId: item.existingRuleId ?? undefined,
      })),
      ...plan.lookups.map((item) => ({
        input: item.input,
        ruleId: item.existingRuleId ?? undefined,
      })),
    ]
    if (requests.length === 0) {
      setApplyError(
        plan.blocked[0]?.message ?? '저장할 수 있는 추천이 없습니다.',
      )
      setFailedCount(plan.blocked.length)
      setApplying(false)
      return
    }

    const reviewKeysByIdentity = new Map<string, string[]>()
    for (const item of plan.globals) {
      reviewKeysByIdentity.set(
        inputIdentity(item.input),
        item.reviewKeys,
      )
    }
    for (const item of plan.lookups) {
      reviewKeysByIdentity.set(inputIdentity(item.input), [item.reviewKey])
    }

    try {
      const result = await saveInvoiceItemNameRules(brandId, requests)
      const succeeded = new Set<string>()
      for (const rule of result.applied) {
        const identity = inputIdentity({
          scope: rule.scope,
          itemName: rule.itemName,
          mainStyleId: rule.mainStyle?.styleId,
          productLookupKey: rule.productLookupKey,
        })
        for (const key of reviewKeysByIdentity.get(identity) ?? []) {
          succeeded.add(key)
        }
      }
      setAppliedCount(succeeded.size)
      setFailedCount(result.failed.length + plan.blocked.length)
      setDraftByKey(new Map())
      setLastAppend(null)
      setApplyError(
        result.failed[0]?.message ?? plan.blocked[0]?.message ?? null,
      )
      setReviewRows((current) =>
        current.filter((row) => !succeeded.has(row.key)),
      )
      setSelected((current) => {
        const next = new Set(current)
        for (const key of succeeded) next.delete(key)
        return next
      })
      await queryClient.invalidateQueries({
        queryKey: ['invoice-item-name-rules', brandId],
      })
      if (result.failed.length === 0 && plan.blocked.length === 0) {
        setPhase('applied')
      }
    } catch (error) {
      setApplyError(
        error instanceof Error
          ? error.message
          : '선택한 내품명 규칙을 저장하지 못했습니다.',
      )
    } finally {
      setApplying(false)
    }
  }, [
    brandId,
    draftByKey,
    itemNameRules,
    knownStyleIds,
    queryClient,
    reviewRows,
    selected,
  ])

  const recommendedCount = useMemo(
    () => reviewRows.filter((row) => row.passesGate).length,
    [reviewRows],
  )
  const pendingDecisionCount = useMemo(
    () => reviewRows.filter((row) => row.action === 'hold').length,
    [reviewRows],
  )

  return {
    brandId,
    routeReady: Boolean(route?.isActive),
    routeLoading: routeQuery.isLoading,
    minConfidence,
    groupCount: groups.length,
    contextCount: contexts.length,
    phase,
    progress,
    reviewRows,
    selected,
    selectedCount: selected.size,
    draftByKey,
    hasDraftChanges: draftByKey.size > 0,
    lastAppend,
    recommendedCount,
    pendingDecisionCount,
    appliedCount,
    failedCount,
    applyError,
    applying,
    collect,
    cancel,
    toggle,
    updateRow,
    appendComponentToRows,
    undoLastAppend,
    commitDrafts,
    discardDrafts,
    selectRecommended,
    clearSelection,
    applySelected,
    reset,
  }
}
