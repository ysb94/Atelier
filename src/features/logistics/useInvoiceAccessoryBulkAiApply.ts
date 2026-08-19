import { useCallback, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ACCESSORY_FEATURE_KEY, DEFAULT_DECISION_CONFIG } from '@/lib/ai/gateway-core'
import { withRecommendSlot } from '@/lib/ai/recommend-queue'
import {
  getAiFeatureRoute,
  recommendInvoiceAccessoryRules,
  saveInvoiceAccessoryRules,
  saveInvoiceItemNameRules,
  searchInvoiceProductCandidates,
} from '@/lib/api'
import {
  decideAccessoryReviewSaves,
  flattenAccessoryPlanRows,
  revalidateAccessoryReviewRow,
  type AccessoryFlattenSource,
  type AccessoryReviewRow,
} from '@/lib/invoice/accessory-review-table'
import {
  accessoryCandidateTexts,
  accessorySuggestRequestContexts,
  buildLookupKeyDraftsFromDecisions,
  buildLookupKeyDraftsFromPreview,
  candidatesForContext,
  collectUnknownAccessoryPieces,
  draftFromAccessorySuggest,
  evaluateAccessorySuggestion,
  mergeAccessoryStyleCandidates,
  findExistingLookupRule,
  type AccessoryLookupComponent,
  type AccessorySuggestHoldReason,
  type AccessoryUnknownGroup,
} from '@/lib/invoice/accessory-suggest'
import type { UnresolvedItemNameCombo } from '@/lib/invoice/item-name-transform'
import type {
  InvoiceAccessoryRule,
  InvoiceItemNameRule,
  InvoiceItemNameRuleAction,
  StyleRef,
} from '@/lib/types'
import { type OptionExtraDraft } from './InvoiceOptionExtrasEditor'

export type AccessoryBulkPhase = 'idle' | 'collecting' | 'review' | 'applied'
export type AccessoryBulkReviewRow = AccessoryReviewRow

export type AccessoryBulkHoldRow = {
  key: string
  unknownLabel: string
  reason: AccessorySuggestHoldReason
  message: string
}

const COLLECT_WORKERS = 4

function extrasFromComponents(components: AccessoryLookupComponent[]) {
  return components.map((item, index) => ({
    key: `${item.style.styleId}-${index}`,
    style: item.style,
    role: 'included' as const,
    quantity: item.quantity,
  }))
}

function componentsFromExtras(extras: OptionExtraDraft[]): AccessoryLookupComponent[] {
  return extras.flatMap((item) =>
    item.style
      ? [{ style: item.style, quantity: Math.max(1, item.quantity || 1) }]
      : [],
  )
}

export function extrasOfReviewRow(row: AccessoryReviewRow): OptionExtraDraft[] {
  return extrasFromComponents(row.components)
}

function toFlattenSource(input: {
  key: string
  kind: AccessoryFlattenSource['kind']
  groupKey: string
  pattern: string
  ruleType: AccessoryFlattenSource['ruleType']
  accessoryKind: string
  namePrefix: string
  colorName: string
  targetStyle: StyleRef | null
  itemName: string
  productLookupKey: string
  mainStyle: StyleRef | null
  action: InvoiceItemNameRuleAction
  components: AccessoryLookupComponent[]
  existingRuleId: string | null
  reason: string
  confidence: number
  rowCount: number
  passesGate: boolean
  contexts: AccessoryFlattenSource['contexts']
  revalidationError: string | null
  allowedStyleIds: string[]
}): AccessoryFlattenSource {
  return input
}

export function useInvoiceAccessoryBulkAiApply({
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

  const groups = useMemo(
    () => collectUnknownAccessoryPieces(combos),
    [combos],
  )

  const [phase, setPhase] = useState<AccessoryBulkPhase>('idle')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [reviewRows, setReviewRows] = useState<AccessoryReviewRow[]>([])
  const [holdRows, setHoldRows] = useState<AccessoryBulkHoldRow[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [appliedCount, setAppliedCount] = useState(0)
  const [failedCount, setFailedCount] = useState(0)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const cancelRef = useRef(false)

  const fetchRecommendation = useCallback(
    (
      group: AccessoryUnknownGroup,
      candidates: ReturnType<typeof mergeAccessoryStyleCandidates>,
      contexts: ReturnType<typeof accessorySuggestRequestContexts>,
    ) =>
      queryClient.fetchQuery({
        queryKey: [
          'ai-accessory-recommendation',
          brandId,
          group.key,
          route?.provider ?? '',
          route?.modelId ?? '',
          contexts.map((item) => item.contextId).join('|'),
        ],
        staleTime: Infinity,
        retry: false,
        queryFn: () =>
          withRecommendSlot(() =>
            recommendInvoiceAccessoryRules({
              brandId,
              unknownPiece: group.pattern,
              itemNames: group.itemNames.slice(0, 8),
              lookupKeys: group.lookupKeys.slice(0, 8),
              mainProducts: group.mainProducts.slice(0, 8),
              contexts,
              dictionary: accessoryRules
                .filter((rule) => rule.isActive)
                .slice(0, 40)
                .map((rule) => ({
                  ruleType: rule.ruleType,
                  pattern: rule.pattern,
                  accessoryKind: rule.accessoryKind,
                  namePrefix: rule.namePrefix,
                  colorName: rule.colorName,
                })),
              candidates,
            }),
          ),
      }),
    [accessoryRules, brandId, queryClient, route?.modelId, route?.provider],
  )

  const cancel = useCallback(() => {
    cancelRef.current = true
  }, [])

  const reset = useCallback(() => {
    setPhase('idle')
    setReviewRows([])
    setHoldRows([])
    setSelected(new Set())
    setAppliedCount(0)
    setFailedCount(0)
    setApplyError(null)
    setProgress({ done: 0, total: 0 })
  }, [])

  const collect = useCallback(async () => {
    if (phase === 'collecting') return
    cancelRef.current = false
    setPhase('collecting')
    setReviewRows([])
    setHoldRows([])
    setSelected(new Set())
    setAppliedCount(0)
    setFailedCount(0)
    setApplyError(null)
    setProgress({ done: 0, total: groups.length })

    const sources: AccessoryFlattenSource[] = []
    const holds: AccessoryBulkHoldRow[] = []
    let cursor = 0
    let done = 0

    const collectOne = async (group: AccessoryUnknownGroup) => {
      try {
        const searched = await searchInvoiceProductCandidates(
          brandId,
          accessoryCandidateTexts(group),
          20,
        )
        const candidates = mergeAccessoryStyleCandidates(
          searched,
          styles,
          accessoryRules,
        )
        const allowed = new Set(candidates.map((item) => item.styleId))
        const requestContexts = accessorySuggestRequestContexts(group).map(
          (context) => {
            const match = group.contexts.find((item) => item.contextId === context.contextId)
            const scoped = match
              ? candidatesForContext(candidates, match)
              : candidates
            return {
              ...context,
              candidateStyleIds: scoped.map((item) => item.styleId),
            }
          },
        )
        const recommendation = await fetchRecommendation(
          group,
          candidates,
          requestContexts,
        )
        const allowedByContext = new Map(
          requestContexts.map((item) => [
            item.contextId,
            new Set(item.candidateStyleIds),
          ]),
        )
        if (recommendation.rules.length === 0 && recommendation.contexts.length === 0) {
          holds.push({
            key: group.key,
            unknownLabel: group.unknownLabel,
            reason: 'no_rule',
            message: recommendation.reason || '추천 규칙이 없습니다.',
          })
          return
        }

        let keptGlobal = 0
        let lastUnsafe: ReturnType<typeof evaluateAccessorySuggestion> | null = null
        for (const [index, rule] of recommendation.rules.entries()) {
          const draft = draftFromAccessorySuggest(rule)
          const dryRun = evaluateAccessorySuggestion(
            draft,
            accessoryRules,
            group.contexts,
            styles,
            allowed,
          )
          if (!dryRun.ok) {
            holds.push({
              key: `${group.key}-dict-${index}`,
              unknownLabel: group.unknownLabel,
              reason: dryRun.holdReason ?? 'no_effect',
              message: dryRun.holdMessage,
            })
            if (
              dryRun.holdReason === 'unsafe_global' ||
              dryRun.holdReason === 'context_conflict'
            ) {
              lastUnsafe = dryRun
            }
            continue
          }
          keptGlobal += 1
          sources.push(
            toFlattenSource({
              key: `${group.key}-dict-${index}`,
              kind: 'dictionary',
              groupKey: group.key,
              pattern: draft.pattern,
              ruleType: draft.ruleType,
              accessoryKind: draft.accessoryKind,
              namePrefix: draft.namePrefix,
              colorName: draft.colorName,
              targetStyle: draft.targetStyle,
              itemName: '',
              productLookupKey: '',
              mainStyle: null,
              action: 'components',
              components: [],
              existingRuleId: null,
              reason: draft.reason || recommendation.reason,
              confidence: draft.confidence,
              rowCount: group.rowCount,
              passesGate:
                draft.ruleType !== 'ignore' &&
                draft.confidence >= minConfidence &&
                !dryRun.safety.partialResolution &&
                !dryRun.safety.contextConflict &&
                !dryRun.safety.unsafeGlobal,
              contexts: dryRun.contexts,
              revalidationError: null,
              allowedStyleIds: [...allowed],
            }),
          )
        }

        const previewOutcomes = new Set(
          (lastUnsafe?.contexts ?? [])
            .filter((item) => item.improved && !item.regressing)
            .map((item) => item.styleIdsAfter.slice().sort().join(',')),
        )
        const lookupDrafts = [
          ...buildLookupKeyDraftsFromDecisions({
            contexts: group.contexts,
            dictionary: accessoryRules,
            styles,
            itemNameRules,
            decisions: recommendation.contexts,
            allowedByContext,
            fallbackAllowed: allowed,
            reason: recommendation.reason,
            confidence: recommendation.rules[0]?.confidence ?? minConfidence,
          }),
          ...(recommendation.contexts.length === 0 &&
          lastUnsafe &&
          previewOutcomes.size > 1
            ? buildLookupKeyDraftsFromPreview({
                contexts: lastUnsafe.contexts,
                styles,
                itemNameRules,
                reason: lastUnsafe.holdMessage || recommendation.reason,
                confidence: recommendation.rules[0]?.confidence ?? minConfidence,
              })
            : []),
        ]
        const preferLookup = keptGlobal === 0 || Boolean(lastUnsafe)
        for (const draft of lookupDrafts) {
          const preview = lastUnsafe?.contexts.find(
            (item) => item.contextId === draft.contextId,
          )
          sources.push(
            toFlattenSource({
              key: `${group.key}-lookup-${draft.contextId}`,
              kind: 'lookup_key',
              groupKey: group.key,
              pattern: group.pattern,
              ruleType: 'token',
              accessoryKind: '',
              namePrefix: '',
              colorName: '',
              targetStyle: draft.components[0]?.style ?? null,
              itemName: draft.itemName,
              productLookupKey: draft.productLookupKey,
              mainStyle: draft.mainStyle,
              action: draft.action,
              components: draft.components,
              existingRuleId: draft.existingRuleId,
              reason: draft.reason,
              confidence: draft.confidence,
              rowCount: preview?.rowCount ?? group.rowCount,
              passesGate:
                preferLookup &&
                draft.confidence >= minConfidence &&
                !draft.duplicateOf,
              contexts: preview ? [preview] : [],
              revalidationError: null,
              allowedStyleIds: [
                ...(allowedByContext.get(draft.contextId) ?? allowed),
              ],
            }),
          )
        }
      } catch (error) {
        holds.push({
          key: group.key,
          unknownLabel: group.unknownLabel,
          reason: 'failed',
          message:
            error instanceof Error ? error.message : '추천을 받지 못했습니다.',
        })
      }
    }

    const worker = async () => {
      while (!cancelRef.current) {
        const group = groups[cursor]
        if (!group) return
        cursor += 1
        await collectOne(group)
        done += 1
        setProgress({ done, total: groups.length })
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(COLLECT_WORKERS, groups.length || 1) }, worker),
    )

    const nextRows = flattenAccessoryPlanRows(sources, styles, itemNameRules)
    setReviewRows(nextRows)
    setHoldRows(holds)
    setSelected(
      new Set(nextRows.filter((item) => item.passesGate).map((item) => item.key)),
    )
    setPhase('review')
  }, [
    accessoryRules,
    brandId,
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
        action?: InvoiceItemNameRuleAction
        extras?: OptionExtraDraft[]
        components?: AccessoryLookupComponent[]
      },
    ) => {
      setReviewRows((current) =>
        current.map((row) => {
          if (row.key !== key) return row
          const action = patch.action ?? row.action
          const components =
            patch.components ??
            (patch.extras ? componentsFromExtras(patch.extras) : row.components)
          const next = revalidateAccessoryReviewRow({
            ...row,
            action,
            components: action === 'delete' ? [] : components,
          })
          if (next.revalidationError) {
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
    [],
  )

  const selectRecommended = useCallback(() => {
    setSelected(
      new Set(reviewRows.filter((item) => item.passesGate).map((item) => item.key)),
    )
  }, [reviewRows])

  const clearSelection = useCallback(() => setSelected(new Set()), [])

  const applySelected = useCallback(async () => {
    if (selected.size === 0) return
    setApplying(true)
    setApplyError(null)

    const rechecked = reviewRows.map((row) => {
      if (!selected.has(row.key)) return row
      const existing =
        row.mainStyle
          ? findExistingLookupRule(
              itemNameRules,
              row.itemName,
              row.mainStyle.styleId,
              row.productLookupKey,
            )?.id ?? row.existingRuleId
          : row.existingRuleId
      return revalidateAccessoryReviewRow({
        ...row,
        existingRuleId: existing,
      })
    })
    setReviewRows(rechecked)
    const plan = decideAccessoryReviewSaves(rechecked, selected)
    const blocked = rechecked.filter(
      (row) => selected.has(row.key) && row.revalidationError,
    )

    if (plan.dictionaries.length === 0 && plan.lookups.length === 0) {
      setApplyError(
        blocked[0]?.revalidationError ?? '저장할 수 있는 후보가 없습니다.',
      )
      setApplying(false)
      return
    }

    let applied = 0
    const failed: string[] = []
    const succeeded = new Set<string>()

    try {
      if (plan.dictionaries.length > 0) {
        const result = await saveInvoiceAccessoryRules(
          brandId,
          plan.dictionaries.map((item) => item.input),
        )
        applied += result.applied.length
        failed.push(...result.failed)
        const failedPatterns = new Set(
          result.failed.map((item) => item.split(':')[0]?.trim()),
        )
        for (const item of plan.dictionaries) {
          if (!failedPatterns.has(item.input.pattern)) {
            for (const key of item.reviewKeys) succeeded.add(key)
          }
        }
        await queryClient.invalidateQueries({
          queryKey: ['invoice-accessory-rules', brandId],
        })
      }
      if (plan.lookups.length > 0) {
        const result = await saveInvoiceItemNameRules(
          brandId,
          plan.lookups.map((item) => ({
            input: item.input,
            ruleId: item.existingRuleId ?? undefined,
          })),
        )
        applied += result.applied.length
        failed.push(
          ...result.failed.map(
            (item) =>
              `${item.productLookupKey || '(조회 키 없음)'}: ${item.message}`,
          ),
        )
        const failedKeys = new Set(
          result.failed.map((item) =>
            [item.mainStyleId, item.productLookupKey].join('\u0000'),
          ),
        )
        for (const item of plan.lookups) {
          const key = `${item.input.mainStyleId ?? ''}\u0000${item.input.productLookupKey ?? ''}`
          if (!failedKeys.has(key)) succeeded.add(item.reviewKey)
        }
        await queryClient.invalidateQueries({
          queryKey: ['invoice-item-name-rules', brandId],
        })
      }

      setAppliedCount(applied)
      setFailedCount(failed.length + blocked.length)
      setApplyError(failed[0] ?? blocked[0]?.revalidationError ?? null)
      setReviewRows((current) => current.filter((row) => !succeeded.has(row.key)))
      setSelected((current) => {
        const next = new Set(current)
        for (const key of succeeded) next.delete(key)
        return next
      })
      if (failed.length === 0 && blocked.length === 0) {
        setHoldRows([])
        setPhase('applied')
      }
    } catch (error) {
      setApplyError(
        error instanceof Error ? error.message : '선택한 규칙을 저장하지 못했습니다.',
      )
    } finally {
      setApplying(false)
    }
  }, [brandId, itemNameRules, queryClient, reviewRows, selected])

  const recommendedCount = useMemo(
    () => reviewRows.filter((item) => item.passesGate).length,
    [reviewRows],
  )

  return {
    brandId,
    routeReady: Boolean(route?.isActive),
    routeLoading: routeQuery.isLoading,
    minConfidence,
    unknownCount: groups.length,
    phase,
    progress,
    reviewRows,
    holdRows,
    selected,
    selectedCount: selected.size,
    recommendedCount,
    appliedCount,
    failedCount,
    applyError,
    applying,
    collect,
    cancel,
    toggle,
    updateRow,
    selectRecommended,
    clearSelection,
    applySelected,
    reset,
  }
}
