import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  DEFAULT_DECISION_CONFIG,
  ITEM_NAME_FEATURE_KEY,
} from '@/lib/ai/gateway-core'
import {
  decideItemNameLocalDraft,
  pickItemNamePriorExamples,
} from '@/lib/ai/learning-core'
import { invalidateAiRecommendationQueries } from '@/lib/ai/query-cache'
import {
  INVOICE_ITEM_NAME_RULES_QUERY_KEY,
  INVOICE_ITEM_NAME_RULES_WORK_QUERY_KEY,
} from '@/lib/invoice/invoice-work-query-keys'
import { createSlotGate, withRecommendSlot } from '@/lib/ai/recommend-queue'
import {
  getAiFeatureRoute,
  isFatalAiError,
  recommendInvoiceItemNameRules,
  saveInvoiceItemNameRules,
  searchInvoiceItemNameCases,
  searchInvoiceProductCandidates,
} from '@/lib/api'
import {
  appendItemNameAiComponent,
  applyItemNameAiRowAction,
  buildItemNameAiReviewRows,
  collectItemNameAiGroups,
  commitReadyItemNameAiDrafts,
  itemNameAiRowReadyToCommit,
  reopenItemNameAiCommittedRow,
  decideItemNameAiSaves,
  dedupeItemNameAiContexts,
  itemNameAiCandidateTexts,
  itemNameAiGroupsForContexts,
  selectItemNameSafeCandidateIds,
  mergeItemNameAiComponents,
  mergeItemNameAiDrafts,
  mirrorItemNameAiDecisions,
  overlayItemNameAiDrafts,
  planItemNameAiBatches,
  reconcileItemNameAiReviewState,
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

export type ItemNameAiStageResult =
  | { ok: true }
  | { ok: false; error: string }

const CONTEXTS_PER_REQUEST = 8
/** 실제 상한은 추천 큐가 잡는다. 여기서는 큐를 굶기지 않을 만큼만 띄운다. */
const COLLECT_WORKERS = 8
const CANDIDATE_WORKERS = 4
const CANDIDATE_LIMIT = 40

function componentsFromExtras(
  extras: OptionExtraDraft[],
): AccessoryLookupComponent[] {
  return mergeItemNameAiComponents(
    extras.flatMap((item) =>
      item.style
        ? [{ style: item.style, quantity: Math.max(1, item.quantity || 1) }]
        : [],
    ),
  )
}

export function extrasOfItemNameAiRow(
  row: ItemNameAiReviewRow,
): OptionExtraDraft[] {
  return row.components.flatMap((item, index) =>
    Array.from({ length: Math.max(1, item.quantity) }, (_, unit) => ({
      key: `${item.style.styleId}-${index}-${unit}`,
      style: item.style,
      role: 'included' as const,
      quantity: 1,
    })),
  )
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
    queryKey: ['ai-feature-route', brandId, ITEM_NAME_FEATURE_KEY],
    queryFn: () => getAiFeatureRoute(brandId, ITEM_NAME_FEATURE_KEY),
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
  const [failedCount, setFailedCount] = useState(0)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const cancelRef = useRef(false)
  const collectGenerationRef = useRef(0)
  const contextsRef = useRef(contexts)
  contextsRef.current = contexts
  const liveContextIds = useMemo(
    () =>
      contexts
        .map((context) => context.contextId)
        .filter((id) => id.trim())
        .sort(),
    [contexts],
  )
  const liveContextKey = liveContextIds.join('\u0000')
  const liveContextIdsRef = useRef(liveContextIds)
  liveContextIdsRef.current = liveContextIds
  const reviewStateRef = useRef({
    phase,
    reviewRows,
    draftByKey,
    selected,
    confirmedKeys,
    pendingAiKeys,
    committedKeys,
    lastAppend,
  })
  reviewStateRef.current = {
    phase,
    reviewRows,
    draftByKey,
    selected,
    confirmedKeys,
    pendingAiKeys,
    committedKeys,
    lastAppend,
  }

  const invalidateCollect = useCallback((markCancel = true) => {
    collectGenerationRef.current += 1
    if (markCancel) cancelRef.current = true
  }, [])

  useEffect(() => {
    const current = reviewStateRef.current
    const next = reconcileItemNameAiReviewState({
      liveContextIds: liveContextIdsRef.current,
      rows: current.reviewRows,
      drafts: current.draftByKey,
      selected: current.selected,
      confirmedKeys: current.confirmedKeys,
      pendingAiKeys: current.pendingAiKeys,
      committedKeys: current.committedKeys,
      lastAppend: current.lastAppend,
    })
    const collecting = current.phase === 'collecting'
    if (!next.changed && !collecting) return
    invalidateCollect()
    if (next.changed) {
      setReviewRows(next.rows)
      setDraftByKey(next.drafts)
      setSelected(next.selected)
      setConfirmedKeys(next.confirmedKeys)
      setPendingAiKeys(next.pendingAiKeys)
      setCommittedKeys(next.committedKeys)
      setLastAppend(next.lastAppend)
      setAppliedCount(0)
      setFailedCount(0)
      setApplyError(null)
      setProgress({ done: 0, total: 0 })
    }
    setPhase(next.phase)
  }, [invalidateCollect, liveContextKey])

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
        priorExamples?: Array<{
          itemName: string
          productLookupKey: string
          action: 'delete' | 'components'
          components: Array<{ styleId: string; quantity: number }>
        }>
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
          requestContexts
            .map((item) =>
              (item.priorExamples ?? [])
                .map((example) => `${example.action}:${example.itemName}`)
                .join(','),
            )
            .join('|'),
        ],
        staleTime: Infinity,
        retry: false,
        queryFn: () =>
          withRecommendSlot(() =>
            recommendInvoiceItemNameRules({
              brandId,
              featureKey: ITEM_NAME_FEATURE_KEY,
              contexts: requestContexts,
              candidates,
            }),
          ),
      }),
    [brandId, queryClient, route?.modelId, route?.provider],
  )

  const learningMode = route?.learningMode ?? 'observe'

  const cancel = useCallback(() => {
    invalidateCollect()
    setPhase((current) => (current === 'collecting' ? 'review' : current))
  }, [invalidateCollect])

  const reset = useCallback(() => {
    invalidateCollect()
    setPhase('idle')
    setReviewRows([])
    setSelected(new Set())
    setDraftByKey(new Map())
    setLastAppend(null)
    setConfirmedKeys(new Set())
    setPendingAiKeys(new Set())
    setCommittedKeys(new Set())
    setAppliedCount(0)
    setFailedCount(0)
    setApplyError(null)
    setProgress({ done: 0, total: 0 })
  }, [invalidateCollect])

  const collect = useCallback(async () => {
    if (phase === 'collecting' || contexts.length === 0) return
    const generation = collectGenerationRef.current + 1
    collectGenerationRef.current = generation
    cancelRef.current = false
    setPhase('collecting')
    setReviewRows([])
    setSelected(new Set())
    setDraftByKey(new Map())
    setLastAppend(null)
    setConfirmedKeys(new Set())
    setPendingAiKeys(new Set())
    setCommittedKeys(new Set())
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
    let fatalMessage: string | null = null

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
          priorExamples: [] as Array<{
            itemName: string
            productLookupKey: string
            action: 'delete' | 'components'
            components: Array<{ styleId: string; quantity: number }>
          }>,
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

    const publish = (
      decisions: AiAccessoryContextDecision[],
      meta?: {
        source: 'local' | 'ai' | 'manual'
        cacheId: string | null
        provider: 'openai' | 'anthropic' | 'gemini' | null
        modelId: string | null
      },
    ) => {
      if (
        generation !== collectGenerationRef.current ||
        cancelRef.current
      ) {
        return
      }
      const liveIds = new Set(
        contextsRef.current.map((context) => context.contextId),
      )
      const mirrored = mirrorItemNameAiDecisions(decisions, mirrors).filter(
        (item) => liveIds.has(item.contextId),
      )
      if (mirrored.length === 0) return
      const contextIds = new Set(mirrored.map((item) => item.contextId))
      for (const contextId of contextIds) decidedIds.add(contextId)
      const rows = buildItemNameAiReviewRows({
        groups: itemNameAiGroupsForContexts(groups, contextIds),
        decisions: mirrored,
        styles,
        itemNameRules,
        minConfidence,
        recommendationMeta: meta,
      })
      // 검수 표를 모으는 동안 채워 사용자가 끝까지 기다리지 않게 한다.
      setReviewRows((current) =>
        [...current, ...rows].sort(
          (left, right) =>
            (orderByContextId.get(left.key) ?? 0) -
            (orderByContextId.get(right.key) ?? 0),
        ),
      )
      done += contextIds.size
      setProgress({ done, total: contextsRef.current.length })
    }

    const worker = async () => {
      while (!cancelRef.current) {
        const index = cursor
        const batch = batches[index]
        if (!batch) return
        cursor += 1
        // 크레딧·키 오류가 한 번 나오면 남은 배치는 묻지 않는다.
        if (fatalMessage) {
          publish(holdsFor(batch, fatalMessage))
          continue
        }
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
          const cases = await searchInvoiceItemNameCases(
            brandId,
            batch.map((context) => ({
              contextId: context.contextId,
              itemName: context.itemName,
              mainStyleId: context.mainStyle?.styleId ?? null,
              productLookupKey: context.productLookupKey,
            })),
          )
          const localDecisions: AiAccessoryContextDecision[] = []
          const aiContexts: typeof settled.value.requestContexts = []
          for (const context of batch) {
            const request = settled.value.requestContexts.find(
              (item) => item.contextId === context.contextId,
            )
            if (!request) continue
            const contextCases = cases.filter(
              (item) => item.contextId === context.contextId,
            )
            const local =
              learningMode === 'assist'
                ? decideItemNameLocalDraft(contextCases)
                : null
            if (local) {
              localDecisions.push({
                contextId: context.contextId,
                action: local.action,
                components: local.components.map((item) => ({
                  styleId: item.styleId,
                  styleNo: item.styleNo ?? '',
                  name: item.name ?? '',
                  quantity: item.quantity,
                })),
                confidence: local.confidence,
                reason: local.reason,
              })
              continue
            }
            const priorExamples =
              learningMode === 'assist'
                ? pickItemNamePriorExamples(contextCases, 5).map((item) => ({
                    itemName: item.itemName,
                    productLookupKey: item.productLookupKey,
                    action: item.action,
                    components: item.components.map((component) => ({
                      styleId: component.styleId,
                      quantity: component.quantity,
                    })),
                  }))
                : []
            const requiredStyleIds = priorExamples.flatMap((example) =>
              example.components.map((component) => component.styleId),
            )
            const rankedStyleIds = settled.value.candidates.map(
              (item) => item.styleId,
            )
            const safe = selectItemNameSafeCandidateIds(
              request.candidateStyleIds,
              rankedStyleIds,
              requiredStyleIds,
            )
            aiContexts.push({
              ...request,
              priorExamples,
              candidateStyleIds: safe.ids,
            })
          }
          if (localDecisions.length > 0) {
            publish(localDecisions, {
              source: 'local',
              cacheId: null,
              provider: route?.provider ?? null,
              modelId: route?.modelId ?? null,
            })
          }
          if (aiContexts.length === 0) continue
          const recommendation = await fetchRecommendation(
            batch.filter((context) =>
              aiContexts.some((item) => item.contextId === context.contextId),
            ),
            settled.value.candidates,
            aiContexts,
          )
          const returned = new Set(
            recommendation.contexts.map((item) => item.contextId),
          )
          publish(
            [
              ...recommendation.contexts,
              ...holdsFor(
                batch.filter(
                  (context) =>
                    !returned.has(context.contextId) &&
                    !localDecisions.some(
                      (item) => item.contextId === context.contextId,
                    ),
                ),
                recommendation.reason || '추천 결과가 없습니다.',
              ),
            ],
            {
              source: recommendation.source === 'local' ? 'local' : 'ai',
              cacheId: recommendation.cacheId,
              provider: recommendation.provider,
              modelId: recommendation.modelId,
            },
          )
        } catch (error) {
          if (isFatalAiError(error)) fatalMessage = error.actionMessage
          publish(
            holdsFor(
              batch,
              isFatalAiError(error)
                ? error.actionMessage
                : error instanceof Error
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

    if (generation !== collectGenerationRef.current) return
    if (!cancelRef.current) {
      const missing = contextsRef.current.filter(
        (context) => !decidedIds.has(context.contextId),
      )
      if (missing.length > 0) {
        publish(holdsFor(missing, '추천 결과가 없습니다.'))
      }
    }
    if (generation !== collectGenerationRef.current) return
    setPhase('review')
  }, [
    accessoryRules,
    brandId,
    contexts,
    fetchRecommendation,
    groups,
    itemNameRules,
    learningMode,
    minConfidence,
    phase,
    route?.modelId,
    route?.provider,
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

  const writeDrafts = useCallback(
    (drafts: Map<string, ItemNameAiReviewRow>) => {
      reviewStateRef.current = {
        ...reviewStateRef.current,
        draftByKey: drafts,
      }
      setDraftByKey(drafts)
    },
    [],
  )

  const confirmRow = useCallback((key: string, pendingAi = false) => {
    const current = reviewStateRef.current
    const nextConfirmed = new Set(current.confirmedKeys)
    nextConfirmed.add(key)
    const nextPending = new Set(current.pendingAiKeys)
    if (pendingAi) nextPending.add(key)
    else nextPending.delete(key)
    reviewStateRef.current = {
      ...current,
      confirmedKeys: nextConfirmed,
      pendingAiKeys: nextPending,
    }
    setConfirmedKeys(nextConfirmed)
    setPendingAiKeys(nextPending)
  }, [])

  const unconfirmRow = useCallback((key: string) => {
    const current = reviewStateRef.current
    if (!current.confirmedKeys.has(key) && !current.pendingAiKeys.has(key)) {
      return
    }
    const nextConfirmed = new Set(current.confirmedKeys)
    nextConfirmed.delete(key)
    const nextPending = new Set(current.pendingAiKeys)
    nextPending.delete(key)
    reviewStateRef.current = {
      ...current,
      confirmedKeys: nextConfirmed,
      pendingAiKeys: nextPending,
    }
    setConfirmedKeys(nextConfirmed)
    setPendingAiKeys(nextPending)
  }, [])

  const unstageRow = useCallback((key: string) => {
    const current = reviewStateRef.current.draftByKey
    if (!current.has(key)) return
    const next = new Map(current)
    next.delete(key)
    writeDrafts(next)
  }, [writeDrafts])

  const stageRowAction = useCallback(
    (
      key: string,
      next:
        | { action: 'delete' }
        | { action: 'hold' }
        | { action: 'components'; components: AccessoryLookupComponent[] },
    ): ItemNameAiStageResult => {
      const current = reviewStateRef.current
      const base =
        current.draftByKey.get(key) ??
        current.reviewRows.find((row) => row.key === key)
      if (!base) return { ok: false, error: '행을 찾을 수 없습니다.' }
      const knownIds =
        next.action === 'components'
          ? new Set([
              ...knownStyleIds,
              ...next.components.map((item) => item.style.styleId),
            ])
          : knownStyleIds
      const applied = applyItemNameAiRowAction(base, next, knownIds)
      if (!applied.ok) return { ok: false, error: applied.error }
      const drafts = new Map(current.draftByKey)
      drafts.set(key, applied.row)
      writeDrafts(drafts)
      confirmRow(key, false)
      return { ok: true }
    },
    [confirmRow, knownStyleIds, writeDrafts],
  )

  const updateRow = useCallback(
    (
      key: string,
      patch: {
        action?: ItemNameAiAction
        extras?: OptionExtraDraft[]
        components?: AccessoryLookupComponent[]
      },
    ): ItemNameAiStageResult => {
      const action = patch.action
      if (action === 'delete') {
        return stageRowAction(key, { action: 'delete' })
      }
      if (action === 'hold') {
        return stageRowAction(key, { action: 'hold' })
      }
      const components =
        patch.components ??
        (patch.extras ? componentsFromExtras(patch.extras) : undefined)
      if (!components) {
        return { ok: false, error: '구성품 M번호를 하나 이상 고르세요.' }
      }
      return stageRowAction(key, { action: 'components', components })
    },
    [stageRowAction],
  )

  const markDecisionNeeded = useCallback(
    (key: string) => {
      stageRowAction(key, { action: 'hold' })
    },
    [stageRowAction],
  )

  const appendComponentToRows = useCallback(
    (keys: Iterable<string>, component: AccessoryLookupComponent) => {
      const current = reviewStateRef.current
      const appended = appendItemNameAiComponent(
        overlayItemNameAiDrafts(current.reviewRows, current.draftByKey),
        keys,
        component,
        knownStyleIds,
      )
      const result: ItemNameAiLastAppend = {
        addedKeys: appended.addedKeys,
        skippedKeys: appended.skippedKeys,
        previous: appended.previous,
      }
      writeDrafts(mergeItemNameAiDrafts(current.draftByKey, appended))
      setLastAppend(result)
      if (appended.addedKeys.length > 0) {
        const nextConfirmed = new Set(current.confirmedKeys)
        for (const key of appended.addedKeys) nextConfirmed.add(key)
        const nextPending = new Set(current.pendingAiKeys)
        for (const key of appended.addedKeys) nextPending.delete(key)
        reviewStateRef.current = {
          ...reviewStateRef.current,
          confirmedKeys: nextConfirmed,
          pendingAiKeys: nextPending,
        }
        setConfirmedKeys(nextConfirmed)
        setPendingAiKeys(nextPending)
      }
      return result
    },
    [knownStyleIds, writeDrafts],
  )

  const undoLastAppend = useCallback(() => {
    if (!lastAppend || lastAppend.previous.length === 0) return
    const current = reviewStateRef.current
    writeDrafts(
      restoreItemNameAiDrafts(
        current.draftByKey,
        lastAppend.previous,
        current.reviewRows,
      ),
    )
    const nextConfirmed = new Set(current.confirmedKeys)
    for (const key of lastAppend.addedKeys) nextConfirmed.delete(key)
    reviewStateRef.current = {
      ...reviewStateRef.current,
      confirmedKeys: nextConfirmed,
    }
    setConfirmedKeys(nextConfirmed)
    setLastAppend(null)
  }, [lastAppend, writeDrafts])

  const commitDrafts = useCallback(() => {
    const result = commitReadyItemNameAiDrafts({
      rows: reviewRows,
      drafts: draftByKey,
      confirmedKeys,
      pendingAiKeys,
      committedKeys,
    })
    if (result.committedKeys.size === committedKeys.size) return
    setReviewRows(result.rows)
    setDraftByKey(result.drafts)
    setCommittedKeys(result.committedKeys)
    if (result.selectedKeys.length > 0) {
      setSelected((current) => {
        const next = new Set(current)
        for (const key of result.selectedKeys) next.add(key)
        return next
      })
    }
    setLastAppend(null)
  }, [
    committedKeys,
    confirmedKeys,
    draftByKey,
    pendingAiKeys,
    reviewRows,
  ])

  const discardDrafts = useCallback(() => {
    setDraftByKey(new Map())
    setLastAppend(null)
    setConfirmedKeys(new Set())
    setPendingAiKeys(new Set())
  }, [])

  const reopenRow = useCallback((key: string) => {
    const next = reopenItemNameAiCommittedRow({
      committedKeys,
      selectedKeys: selected,
      confirmedKeys,
      pendingAiKeys,
      key,
    })
    setCommittedKeys(next.committedKeys)
    setSelected(next.selectedKeys)
    setConfirmedKeys(next.confirmedKeys)
    setPendingAiKeys(next.pendingAiKeys)
  }, [committedKeys, confirmedKeys, pendingAiKeys, selected])

  const stageRowComponents = useCallback(
    (key: string, components: AccessoryLookupComponent[]) =>
      stageRowAction(key, { action: 'components', components }),
    [stageRowAction],
  )

  const stageRowDelete = useCallback(
    (key: string) => stageRowAction(key, { action: 'delete' }),
    [stageRowAction],
  )

  const selectRecommended = useCallback(() => {
    setSelected(
      new Set(
        reviewRows
          .filter(
            (row) =>
              committedKeys.has(row.key) &&
              row.passesGate &&
              !row.validationError &&
              row.action !== 'hold',
          )
          .map((row) => row.key),
      ),
    )
  }, [committedKeys, reviewRows])

  const clearSelection = useCallback(() => setSelected(new Set()), [])

  const applySelected = useCallback(async () => {
    if (selected.size === 0) return 0
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
        feedback: item.feedback,
      })),
      ...plan.lookups.map((item) => ({
        input: item.input,
        ruleId: item.existingRuleId ?? undefined,
        feedback: item.feedback,
      })),
    ]
    if (requests.length === 0) {
      setApplyError(
        plan.blocked[0]?.message ?? '저장할 수 있는 추천이 없습니다.',
      )
      setFailedCount(plan.blocked.length)
      setApplying(false)
      return 0
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
      setDraftByKey((current) => {
        if (succeeded.size === 0) return current
        const next = new Map(current)
        for (const key of succeeded) next.delete(key)
        return next
      })
      setLastAppend(null)
      setCommittedKeys((current) => {
        const next = new Set(current)
        for (const key of succeeded) next.delete(key)
        return next
      })
      setConfirmedKeys((current) => {
        const next = new Set(current)
        for (const key of succeeded) next.delete(key)
        return next
      })
      setPendingAiKeys((current) => {
        const next = new Set(current)
        for (const key of succeeded) next.delete(key)
        return next
      })
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
        queryKey: [INVOICE_ITEM_NAME_RULES_QUERY_KEY, brandId],
      })
      await queryClient.invalidateQueries({
        queryKey: [INVOICE_ITEM_NAME_RULES_WORK_QUERY_KEY, brandId],
      })
      await invalidateAiRecommendationQueries(queryClient, brandId)
      if (result.failed.length === 0 && plan.blocked.length === 0) {
        setPhase(succeeded.size < rechecked.length ? 'review' : 'applied')
      }
      return succeeded.size
    } catch (error) {
      setApplyError(
        error instanceof Error
          ? error.message
          : '선택한 내품명 규칙을 저장하지 못했습니다.',
      )
      return 0
    } finally {
      setApplying(false)
    }
  }, [
    brandId,
    itemNameRules,
    knownStyleIds,
    queryClient,
    reviewRows,
    selected,
  ])

  const recommendedCount = useMemo(
    () =>
      reviewRows.filter(
        (row) =>
          committedKeys.has(row.key) &&
          row.passesGate &&
          row.action !== 'hold',
      ).length,
    [committedKeys, reviewRows],
  )
  const pendingDecisionCount = useMemo(
    () =>
      reviewRows.filter(
        (row) => committedKeys.has(row.key) && row.action === 'hold',
      ).length,
    [committedKeys, reviewRows],
  )
  const queueCount = useMemo(
    () => reviewRows.filter((row) => !committedKeys.has(row.key)).length,
    [committedKeys, reviewRows],
  )
  const committedCount = committedKeys.size
  const canCommit = useMemo(() => {
    for (const key of confirmedKeys) {
      if (pendingAiKeys.has(key) || committedKeys.has(key)) continue
      const draft = draftByKey.get(key)
      const row = draft ?? reviewRows.find((item) => item.key === key)
      if (row && itemNameAiRowReadyToCommit(row, Boolean(draft))) return true
    }
    return false
  }, [
    committedKeys,
    confirmedKeys,
    draftByKey,
    pendingAiKeys,
    reviewRows,
  ])
  const hasQueueChanges =
    draftByKey.size > 0 ||
    [...confirmedKeys].some((key) => !committedKeys.has(key))

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
    confirmedKeys,
    pendingAiKeys,
    committedKeys,
    hasDraftChanges: hasQueueChanges,
    canCommit,
    queueCount,
    committedCount,
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
    markDecisionNeeded,
    appendComponentToRows,
    undoLastAppend,
    commitDrafts,
    discardDrafts,
    stageRowComponents,
    stageRowDelete,
    unstageRow,
    confirmRow,
    unconfirmRow,
    reopenRow,
    selectRecommended,
    clearSelection,
    applySelected,
    reset,
  }
}
