import { formatItemNameFromComponents } from '@/lib/invoice/item-name-transform'
import { normalizeInvoiceText } from '@/lib/invoice/prefix-transform'
import {
  accessoryContextId,
  findExistingLookupRule,
  type AccessoryLookupComponent,
} from '@/lib/invoice/accessory-suggest'
import {
  formatProductCompositionUnitLines,
  productCompositionFromStyle,
  richerProductComposition,
  type ProductCompositionItem,
} from '@/lib/invoice/product-composition'
import type { InvoiceItemNameRuleInput } from '@/lib/supabase/invoice-item-name-rules'
import type {
  AiAccessoryContextDecision,
  AiRecommendProduct,
  AiRecommendationSource,
  InvoiceItemNameRule,
  InvoiceItemNameRuleAction,
  StyleRef,
} from '@/lib/types'
import type { UnresolvedItemNameCombo } from '@/lib/invoice/item-name-transform'

export type ItemNameAiAction = InvoiceItemNameRuleAction | 'hold'

export type ItemNameAiContext = {
  contextId: string
  groupKey: string
  itemName: string
  productLookupKey: string
  mainStyle: StyleRef | null
  productComponents: ProductCompositionItem[]
  sourceProductName: string
  productConnectionExcluded: boolean
  rowCount: number
}

export type ItemNameAiGroup = {
  key: string
  itemName: string
  rowCount: number
  contexts: ItemNameAiContext[]
}

export type ItemNameAiReviewRow = ItemNameAiContext & {
  key: string
  action: ItemNameAiAction
  components: AccessoryLookupComponent[]
  originalSignature: string
  reason: string
  confidence: number
  passesGate: boolean
  validationError: string | null
  existingRuleId: string | null
  existingGlobalRuleId: string | null
}

export type ItemNameAiSavePlan = {
  globals: Array<{
    groupKey: string
    reviewKeys: string[]
    input: InvoiceItemNameRuleInput
    existingRuleId: string | null
  }>
  lookups: Array<{
    reviewKey: string
    input: InvoiceItemNameRuleInput
    existingRuleId: string | null
  }>
  blocked: Array<{ reviewKey: string; message: string }>
}

function findGlobalRule(rules: InvoiceItemNameRule[], itemName: string) {
  const normalized = normalizeInvoiceText(itemName)
  return (
    rules.find(
      (rule) =>
        rule.isActive &&
        rule.scope === 'global' &&
        rule.normalizedItemName === normalized,
    ) ?? null
  )
}

export function collectItemNameAiGroups(
  combos: UnresolvedItemNameCombo[],
): ItemNameAiGroup[] {
  const byGroup = new Map<string, ItemNameAiGroup>()
  for (const combo of combos) {
    const itemName = combo.itemName.trim()
    const groupKey = normalizeInvoiceText(itemName)
    if (!itemName || !groupKey) continue
    const contextId = accessoryContextId({
      itemName,
      productLookupKey: combo.productLookupKey,
      mainStyle: combo.productStyle,
    })
    const productComponents =
      combo.productComponents && combo.productComponents.length > 0
        ? combo.productComponents
        : productCompositionFromStyle(combo.productStyle)
    const group = byGroup.get(groupKey) ?? {
      key: groupKey,
      itemName,
      rowCount: 0,
      contexts: [],
    }
    group.rowCount += combo.rowCount
    const existing = group.contexts.find(
      (context) => context.contextId === contextId,
    )
    if (existing) {
      existing.rowCount += combo.rowCount
      existing.productConnectionExcluded =
        existing.productConnectionExcluded || combo.productConnectionExcluded
      existing.productComponents = richerProductComposition(
        existing.productComponents,
        productComponents,
      )
    } else {
      group.contexts.push({
        contextId,
        groupKey,
        itemName,
        productLookupKey: combo.productLookupKey,
        mainStyle: combo.productStyle,
        productComponents,
        sourceProductName: combo.productName,
        productConnectionExcluded: combo.productConnectionExcluded,
        rowCount: combo.rowCount,
      })
    }
    byGroup.set(groupKey, group)
  }
  return [...byGroup.values()]
    .map((group) => ({
      ...group,
      contexts: [...group.contexts].sort(
        (left, right) =>
          left.productLookupKey.localeCompare(right.productLookupKey, 'ko-KR') ||
          (left.mainStyle?.styleNo ?? '').localeCompare(
            right.mainStyle?.styleNo ?? '',
            'ko-KR',
          ),
      ),
    }))
    .sort(
      (left, right) =>
        right.rowCount - left.rowCount ||
        left.itemName.localeCompare(right.itemName, 'ko-KR'),
    )
}

/**
 * 조회 키만 다르고 옵션명·확정 본품이 같은 조합은 AI가 같은 답을 준다.
 * 대표 하나만 물어보고 나머지에 결정을 복사해 호출 수를 줄인다.
 */
export function itemNameAiDecisionKey(context: ItemNameAiContext) {
  return [
    normalizeInvoiceText(context.itemName),
    context.mainStyle?.styleId ?? '',
  ].join('\u0000')
}

export function dedupeItemNameAiContexts(contexts: ItemNameAiContext[]) {
  const requests: ItemNameAiContext[] = []
  const mirrors = new Map<string, string[]>()
  const representatives = new Map<string, string>()
  for (const context of contexts) {
    const key = itemNameAiDecisionKey(context)
    const representative = representatives.get(key)
    if (representative) {
      mirrors.set(representative, [
        ...(mirrors.get(representative) ?? []),
        context.contextId,
      ])
      continue
    }
    representatives.set(key, context.contextId)
    requests.push(context)
  }
  return { requests, mirrors }
}

export function mirrorItemNameAiDecisions(
  decisions: AiAccessoryContextDecision[],
  mirrors: Map<string, string[]>,
): AiAccessoryContextDecision[] {
  if (mirrors.size === 0) return decisions
  return decisions.flatMap((decision) => [
    decision,
    ...(mirrors.get(decision.contextId) ?? []).map((contextId) => ({
      ...decision,
      contextId,
    })),
  ])
}

/**
 * 한 옵션명의 조합을 같은 요청에 담아 후보 검색과 프롬프트를 좁히고,
 * 남는 자리는 다음 옵션명으로 채워 요청 수가 늘어나지 않게 한다.
 */
export function planItemNameAiBatches(
  contexts: ItemNameAiContext[],
  size: number,
): ItemNameAiContext[][] {
  const perSize = Math.max(1, size)
  const byGroup = new Map<string, ItemNameAiContext[]>()
  for (const context of contexts) {
    byGroup.set(context.groupKey, [
      ...(byGroup.get(context.groupKey) ?? []),
      context,
    ])
  }
  const batches: ItemNameAiContext[][] = []
  let current: ItemNameAiContext[] = []
  for (const group of byGroup.values()) {
    for (let index = 0; index < group.length; index += perSize) {
      const slice = group.slice(index, index + perSize)
      if (slice.length === perSize) {
        batches.push(slice)
        continue
      }
      if (current.length + slice.length > perSize) {
        batches.push(current)
        current = []
      }
      current = [...current, ...slice]
      if (current.length === perSize) {
        batches.push(current)
        current = []
      }
    }
  }
  if (current.length > 0) batches.push(current)
  return batches
}

export function itemNameAiCandidateTexts(
  contexts: ItemNameAiContext[],
  maxTexts = 24,
) {
  const pickers: Array<(context: ItemNameAiContext) => string> = [
    (context) => context.itemName,
    (context) => context.productLookupKey,
    (context) => context.mainStyle?.name ?? '',
    (context) => context.sourceProductName,
    (context) => context.mainStyle?.styleNo ?? '',
  ]
  const seen = new Set<string>()
  const texts: string[] = []
  for (const pick of pickers) {
    for (const context of contexts) {
      const text = pick(context).trim()
      const key = normalizeInvoiceText(text)
      if (!text || !key || seen.has(key)) continue
      seen.add(key)
      texts.push(text)
      if (texts.length >= maxTexts) return texts
    }
  }
  return texts
}

export function itemNameAiGroupsForContexts(
  groups: ItemNameAiGroup[],
  contextIds: Set<string>,
): ItemNameAiGroup[] {
  return groups.flatMap((group) => {
    const contexts = group.contexts.filter((context) =>
      contextIds.has(context.contextId),
    )
    return contexts.length > 0 ? [{ ...group, contexts }] : []
  })
}

export function itemNameAiSignature(
  action: ItemNameAiAction,
  components: AccessoryLookupComponent[],
) {
  if (action !== 'components') return action
  return components
    .map((item) => `${item.style.styleId}:${item.quantity}`)
    .sort()
    .join('|')
}

export function isItemNameAiReviewDirty(row: ItemNameAiReviewRow) {
  return (
    itemNameAiSignature(row.action, row.components) !== row.originalSignature
  )
}

export function validateItemNameAiReviewRow(
  row: ItemNameAiReviewRow,
  knownStyleIds?: Set<string>,
): ItemNameAiReviewRow {
  let validationError: string | null = null
  if (!row.itemName.trim()) {
    validationError = '옵션명이 없습니다.'
  } else if (row.action === 'hold') {
    validationError = '구성품 또는 비움을 정하세요.'
  } else if (row.action === 'delete' && row.components.length > 0) {
    validationError = '비우는 행에는 구성품을 넣지 않습니다.'
  } else if (row.action === 'components' && row.components.length === 0) {
    validationError = '구성품 M번호를 하나 이상 고르세요.'
  } else {
    const seen = new Set<string>()
    for (const component of row.components) {
      if (
        knownStyleIds &&
        !knownStyleIds.has(component.style.styleId)
      ) {
        validationError = '등록되지 않은 구성품입니다.'
        break
      }
      if (seen.has(component.style.styleId)) {
        validationError = '같은 구성품 M번호는 한 번만 넣을 수 있습니다.'
        break
      }
      seen.add(component.style.styleId)
      if (!Number.isInteger(component.quantity) || component.quantity < 1) {
        validationError = '구성 수량은 1 이상이어야 합니다.'
        break
      }
    }
  }
  return {
    ...row,
    validationError,
    passesGate:
      !validationError &&
      row.action !== 'hold' &&
      row.passesGate,
  }
}

export function markItemNameAiDecisionNeeded(
  row: ItemNameAiReviewRow,
  knownStyleIds?: Set<string>,
): ItemNameAiReviewRow {
  return validateItemNameAiReviewRow(
    {
      ...row,
      action: 'hold',
    },
    knownStyleIds,
  )
}

export const ITEM_NAME_AI_QUICK_SLOT_LIMIT = 3

export type ItemNameAiQuickSlotStatus =
  | 'empty'
  | 'draft'
  | 'matched'
  | 'ambiguous'
  | 'unmatched'

export type ItemNameAiQuickSlot = {
  text: string
  quantity: number
  style: StyleRef | null
  status: ItemNameAiQuickSlotStatus
  candidates: StyleRef[]
  error: string | null
}

export function formatItemNameAiStyleLabel(style: StyleRef) {
  return `${style.styleNo} · ${style.name}`
}

export function emptyItemNameAiQuickSlot(): ItemNameAiQuickSlot {
  return {
    text: '',
    quantity: 1,
    style: null,
    status: 'empty',
    candidates: [],
    error: null,
  }
}

export function itemNameAiQuickSlotsFromComponents(
  components: AccessoryLookupComponent[],
): ItemNameAiQuickSlot[] {
  const filled = components
    .slice(0, ITEM_NAME_AI_QUICK_SLOT_LIMIT)
    .map((item) => ({
      text: formatItemNameAiStyleLabel(item.style),
      quantity: item.quantity,
      style: item.style,
      status: 'matched' as const,
      candidates: [],
      error: null,
    }))
  return filled.length > 0 ? filled : [emptyItemNameAiQuickSlot()]
}

export function applyItemNameAiQuickSlotText(
  slot: ItemNameAiQuickSlot,
  text: string,
): ItemNameAiQuickSlot {
  if (!text.trim()) return emptyItemNameAiQuickSlot()
  if (slot.style && text === formatItemNameAiStyleLabel(slot.style)) {
    return { ...slot, text, status: 'matched', error: null }
  }
  return {
    text,
    quantity: 1,
    style: null,
    status: 'draft',
    candidates: [],
    error: null,
  }
}

export function applyItemNameAiQuickSlotStyle(
  slot: ItemNameAiQuickSlot,
  style: StyleRef,
): ItemNameAiQuickSlot {
  return {
    text: formatItemNameAiStyleLabel(style),
    quantity: Math.max(1, Math.floor(slot.quantity || 1)),
    style,
    status: 'matched',
    candidates: [],
    error: null,
  }
}

export function itemNameAiQuickRowComponents(slots: ItemNameAiQuickSlot[]):
  | { ok: true; components: AccessoryLookupComponent[] }
  | { ok: false; reason: 'empty' | 'incomplete' | 'duplicate' } {
  const filled = slots.filter((slot) => slot.text.trim())
  if (filled.length === 0) return { ok: false, reason: 'empty' }
  if (filled.some((slot) => !slot.style)) {
    return { ok: false, reason: 'incomplete' }
  }
  const seen = new Set<string>()
  const components: AccessoryLookupComponent[] = []
  for (const slot of filled) {
    const style = slot.style!
    if (seen.has(style.styleId)) return { ok: false, reason: 'duplicate' }
    seen.add(style.styleId)
    components.push({
      style,
      quantity: Math.max(1, Math.floor(slot.quantity || 1)),
    })
  }
  return { ok: true, components }
}

export function replaceItemNameAiRowComponents(
  row: ItemNameAiReviewRow,
  components: AccessoryLookupComponent[],
  knownStyleIds?: Set<string>,
):
  | { ok: true; row: ItemNameAiReviewRow }
  | { ok: false; error: string; row: ItemNameAiReviewRow } {
  const next = validateItemNameAiReviewRow(
    {
      ...row,
      action: components.length > 0 ? 'components' : 'hold',
      components,
    },
    knownStyleIds,
  )
  if (next.validationError) {
    return { ok: false, error: next.validationError, row }
  }
  return { ok: true, row: next }
}

export type ItemNameAiEnterDecision =
  | { status: 'delete' }
  | { status: 'components'; components: AccessoryLookupComponent[] }
  | { status: 'needs_ai' }
  | { status: 'invalid'; reason: 'duplicate' }

export function itemNameAiSlotsAreAllEmpty(slots: ItemNameAiQuickSlot[]) {
  return slots.every((slot) => !slot.text.trim())
}

export function itemNameAiSlotsNeedAi(slots: ItemNameAiQuickSlot[]) {
  return slots.some(
    (slot) =>
      Boolean(slot.text.trim()) &&
      (slot.status === 'draft' ||
        slot.status === 'ambiguous' ||
        slot.status === 'unmatched'),
  )
}

export function decideItemNameAiEnterAction(
  slots: ItemNameAiQuickSlot[],
): ItemNameAiEnterDecision {
  const filled = slots.filter((slot) => slot.text.trim())
  if (filled.length === 0) return { status: 'delete' }
  if (filled.some((slot) => !slot.style)) return { status: 'needs_ai' }
  const result = itemNameAiQuickRowComponents(slots)
  if (result.ok) return { status: 'components', components: result.components }
  if (result.reason === 'duplicate') {
    return { status: 'invalid', reason: 'duplicate' }
  }
  return { status: 'needs_ai' }
}

export function applyItemNameAiRowAction(
  row: ItemNameAiReviewRow,
  next:
    | { action: 'delete' }
    | { action: 'hold' }
    | { action: 'components'; components: AccessoryLookupComponent[] },
  knownStyleIds?: Set<string>,
):
  | { ok: true; row: ItemNameAiReviewRow }
  | { ok: false; error: string; row: ItemNameAiReviewRow } {
  if (next.action === 'hold') {
    return {
      ok: true,
      row: markItemNameAiDecisionNeeded(row, knownStyleIds),
    }
  }
  if (next.action === 'delete') {
    const validated = validateItemNameAiReviewRow(
      {
        ...row,
        action: 'delete',
        components: [],
      },
      knownStyleIds,
    )
    if (validated.validationError) {
      return { ok: false, error: validated.validationError, row }
    }
    return { ok: true, row: validated }
  }
  return replaceItemNameAiRowComponents(row, next.components, knownStyleIds)
}

export type ItemNameAiQueueProgress =
  | 'pending'
  | 'needs_ai'
  | 'ready_delete'
  | 'ready_hold'
  | 'ready_components'
  | 'committed'

export function itemNameAiQueueProgress(input: {
  confirmed: boolean
  committed: boolean
  pendingAi: boolean
  draft?: Pick<ItemNameAiReviewRow, 'action'> | null
  row?: Pick<ItemNameAiReviewRow, 'action'> | null
}): ItemNameAiQueueProgress {
  if (input.committed) return 'committed'
  if (input.pendingAi) return 'needs_ai'
  if (!input.confirmed) return 'pending'
  const action = input.draft?.action ?? input.row?.action
  if (!input.draft && action === 'hold') return 'pending'
  if (action === 'delete') return 'ready_delete'
  if (action === 'hold') return 'ready_hold'
  if (action === 'components') return 'ready_components'
  return 'pending'
}

export function itemNameAiQueueProgressLabel(
  progress: ItemNameAiQueueProgress,
) {
  if (progress === 'needs_ai') return 'AI 정리 필요'
  if (progress === 'ready_components') return '공식명칭 확정'
  if (progress === 'ready_delete' || progress === 'ready_hold') {
    return '입력 완료'
  }
  if (progress === 'committed') return '저장 완료'
  return null
}

export type ItemNameAiQueueFilter = 'queue' | ItemNameAiReviewKind

export function itemNameAiMatchesQueueFilter(
  row: Pick<ItemNameAiReviewRow, 'key' | 'action' | 'components'>,
  filter: ItemNameAiQueueFilter,
  committedKeys: ReadonlySet<string>,
) {
  const committed = committedKeys.has(row.key)
  if (filter === 'queue') return !committed
  return committed && itemNameAiReviewKind(row) === filter
}

export function itemNameAiRowReadyToCommit(
  row: Pick<ItemNameAiReviewRow, 'action' | 'validationError'>,
  hasDraft = true,
) {
  if (row.action === 'hold') return hasDraft
  if (row.validationError) return false
  return row.action === 'components' || row.action === 'delete'
}

export function commitReadyItemNameAiDrafts(options: {
  rows: ItemNameAiReviewRow[]
  drafts: ReadonlyMap<string, ItemNameAiReviewRow>
  confirmedKeys: ReadonlySet<string>
  pendingAiKeys: ReadonlySet<string>
  committedKeys: ReadonlySet<string>
}) {
  const overlay = new Map<string, ItemNameAiReviewRow>()
  const nextDrafts = new Map(options.drafts)
  const nextCommitted = new Set(options.committedKeys)
  const selectedKeys: string[] = []
  const originalByKey = new Map(options.rows.map((row) => [row.key, row]))
  for (const key of options.confirmedKeys) {
    if (options.pendingAiKeys.has(key) || nextCommitted.has(key)) continue
    const draft = options.drafts.get(key)
    const row = draft ?? originalByKey.get(key)
    if (!row) continue
    if (!itemNameAiRowReadyToCommit(row, Boolean(draft))) continue
    overlay.set(key, row)
    nextDrafts.delete(key)
    nextCommitted.add(key)
    if (row.action !== 'hold' && !row.validationError) {
      selectedKeys.push(key)
    }
  }
  return {
    rows: options.rows.map((row) => overlay.get(row.key) ?? row),
    drafts: nextDrafts,
    committedKeys: nextCommitted,
    selectedKeys,
  }
}

export function reopenItemNameAiCommittedRow(options: {
  committedKeys: ReadonlySet<string>
  selectedKeys?: ReadonlySet<string>
  confirmedKeys?: ReadonlySet<string>
  pendingAiKeys?: ReadonlySet<string>
  key: string
}) {
  const committedKeys = new Set(options.committedKeys)
  const selectedKeys = new Set(options.selectedKeys ?? [])
  const confirmedKeys = new Set(options.confirmedKeys ?? [])
  const pendingAiKeys = new Set(options.pendingAiKeys ?? [])
  committedKeys.delete(options.key)
  selectedKeys.delete(options.key)
  confirmedKeys.delete(options.key)
  pendingAiKeys.delete(options.key)
  return { committedKeys, selectedKeys, confirmedKeys, pendingAiKeys }
}

function itemNameAiQuickSlotCount(
  slotCountByKey: ReadonlyMap<string, number> | Readonly<Record<string, number>> | undefined,
  rowKey: string,
) {
  if (!slotCountByKey) return 1
  const count =
    slotCountByKey instanceof Map
      ? slotCountByKey.get(rowKey)
      : (slotCountByKey as Record<string, number>)[rowKey]
  return Math.max(1, count ?? 1)
}

export function nextItemNameAiQuickFocus(
  visibleKeys: string[],
  rowKey: string,
  slotIndex: number,
  direction: 'down' | 'right',
  slotCountByKey?: ReadonlyMap<string, number> | Readonly<Record<string, number>>,
): { rowKey: string; slotIndex: number; ensureCount: number } | null {
  const rowIndex = visibleKeys.indexOf(rowKey)
  if (rowIndex < 0) return null
  if (direction === 'down') {
    const nextKey = visibleKeys[rowIndex + 1]
    if (!nextKey) return null
    const existing = itemNameAiQuickSlotCount(slotCountByKey, nextKey)
    return {
      rowKey: nextKey,
      slotIndex: Math.min(slotIndex, existing - 1),
      ensureCount: existing,
    }
  }
  if (slotIndex < ITEM_NAME_AI_QUICK_SLOT_LIMIT - 1) {
    return {
      rowKey,
      slotIndex: slotIndex + 1,
      ensureCount: slotIndex + 2,
    }
  }
  return nextItemNameAiQuickFocus(visibleKeys, rowKey, 0, 'down', slotCountByKey)
}

export function decideItemNameAiQuickSlotMatch(
  products: AiRecommendProduct[],
  source: AiRecommendationSource,
  minConfidence: number,
  excludeStyleId?: string | null,
) {
  const filtered = products.filter(
    (item) => item.styleId !== excludeStyleId,
  )
  if (source === 'manual' || filtered.length === 0) {
    return {
      status: 'unmatched' as const,
      style: null,
      candidates: [] as StyleRef[],
    }
  }
  const top = filtered[0]!
  const second = filtered[1]
  const candidates = filtered.slice(0, 3).map((item) => ({
    styleId: item.styleId,
    styleNo: item.styleNo,
    name: item.name,
  }))
  const style = candidates[0]!
  if (
    top.confidence >= minConfidence &&
    (!second || top.confidence - second.confidence >= 0.1)
  ) {
    return { status: 'matched' as const, style, candidates: [] as StyleRef[] }
  }
  return { status: 'ambiguous' as const, style: null, candidates }
}

export type ItemNameAiAppendResult = {
  rows: ItemNameAiReviewRow[]
  addedKeys: string[]
  skippedKeys: string[]
  previous: ItemNameAiReviewRow[]
}

export type ItemNameAiLastAppend = Pick<
  ItemNameAiAppendResult,
  'addedKeys' | 'skippedKeys' | 'previous'
>

export function appendItemNameAiComponent(
  rows: ItemNameAiReviewRow[],
  targetKeys: Iterable<string>,
  component: AccessoryLookupComponent,
  knownStyleIds?: Set<string>,
): ItemNameAiAppendResult {
  const targets = new Set(targetKeys)
  const quantity = Math.max(1, Math.floor(component.quantity || 1))
  const styleId = component.style.styleId
  const addedKeys: string[] = []
  const skippedKeys: string[] = []
  const previous: ItemNameAiReviewRow[] = []
  const nextRows = rows.map((row) => {
    if (!targets.has(row.key)) return row
    if (row.components.some((item) => item.style.styleId === styleId)) {
      skippedKeys.push(row.key)
      return row
    }
    previous.push(row)
    addedKeys.push(row.key)
    return validateItemNameAiReviewRow(
      {
        ...row,
        action: 'components',
        components: [...row.components, { style: component.style, quantity }],
      },
      knownStyleIds,
    )
  })
  return { rows: nextRows, addedKeys, skippedKeys, previous }
}

export function overlayItemNameAiDrafts(
  rows: ItemNameAiReviewRow[],
  drafts: ReadonlyMap<string, ItemNameAiReviewRow>,
) {
  if (drafts.size === 0) return rows
  return rows.map((row) => drafts.get(row.key) ?? row)
}

export function mergeItemNameAiDrafts(
  drafts: ReadonlyMap<string, ItemNameAiReviewRow>,
  result: ItemNameAiAppendResult,
) {
  if (result.addedKeys.length === 0) return new Map(drafts)
  const added = new Set(result.addedKeys)
  const next = new Map(drafts)
  for (const row of result.rows) {
    if (added.has(row.key)) next.set(row.key, row)
  }
  return next
}

export function restoreItemNameAiDrafts(
  drafts: ReadonlyMap<string, ItemNameAiReviewRow>,
  previous: ItemNameAiReviewRow[],
  originals: ItemNameAiReviewRow[],
) {
  const originalByKey = new Map(originals.map((row) => [row.key, row]))
  const next = new Map(drafts)
  for (const prev of previous) {
    const original = originalByKey.get(prev.key)
    if (
      original &&
      original.action === prev.action &&
      itemNameAiSignature(original.action, original.components) ===
        itemNameAiSignature(prev.action, prev.components)
    ) {
      next.delete(prev.key)
    } else {
      next.set(prev.key, prev)
    }
  }
  return next
}

function keepItemNameAiKeyedMap<T>(
  source: ReadonlyMap<string, T>,
  liveKeys: ReadonlySet<string>,
) {
  let changed = false
  const next = new Map<string, T>()
  for (const [key, value] of source) {
    if (liveKeys.has(key)) next.set(key, value)
    else changed = true
  }
  return { next, changed }
}

function keepItemNameAiKeySet(
  source: Iterable<string>,
  liveKeys: ReadonlySet<string>,
) {
  let changed = false
  const next = new Set<string>()
  for (const key of source) {
    if (liveKeys.has(key)) next.add(key)
    else changed = true
  }
  return { next, changed }
}

function pruneItemNameAiLastAppend(
  lastAppend: ItemNameAiLastAppend | null | undefined,
  liveKeys: ReadonlySet<string>,
) {
  if (!lastAppend) return null
  const stale =
    lastAppend.addedKeys.some((key) => !liveKeys.has(key)) ||
    lastAppend.skippedKeys.some((key) => !liveKeys.has(key)) ||
    lastAppend.previous.some((row) => !liveKeys.has(row.key))
  return stale ? null : lastAppend
}

export type ItemNameAiReviewReconcile = {
  rows: ItemNameAiReviewRow[]
  drafts: Map<string, ItemNameAiReviewRow>
  selected: Set<string>
  confirmedKeys: Set<string>
  pendingAiKeys: Set<string>
  committedKeys: Set<string>
  lastAppend: ItemNameAiLastAppend | null
  removedKeys: string[]
  changed: boolean
  phase: 'idle' | 'review'
}

/**
 * 현재 조회 키 조합에 없는 검수 행만 빼고, 유효 초안·선택 상태는 그대로 둡니다.
 */
export function reconcileItemNameAiReviewState(options: {
  liveContextIds: Iterable<string>
  rows: ItemNameAiReviewRow[]
  drafts: ReadonlyMap<string, ItemNameAiReviewRow>
  selected?: Iterable<string>
  confirmedKeys?: Iterable<string>
  pendingAiKeys?: Iterable<string>
  committedKeys?: Iterable<string>
  lastAppend?: ItemNameAiLastAppend | null
}): ItemNameAiReviewReconcile {
  const liveKeys = new Set(
    [...options.liveContextIds].filter((id) => id.trim()),
  )
  const rows: ItemNameAiReviewRow[] = []
  const removedKeys: string[] = []
  for (const row of options.rows) {
    if (liveKeys.has(row.key)) rows.push(row)
    else removedKeys.push(row.key)
  }
  const drafts = keepItemNameAiKeyedMap(options.drafts, liveKeys)
  const selected = keepItemNameAiKeySet(options.selected ?? [], liveKeys)
  const confirmedKeys = keepItemNameAiKeySet(
    options.confirmedKeys ?? [],
    liveKeys,
  )
  const pendingAiKeys = keepItemNameAiKeySet(
    options.pendingAiKeys ?? [],
    liveKeys,
  )
  const committedKeys = keepItemNameAiKeySet(
    options.committedKeys ?? [],
    liveKeys,
  )
  const lastAppend = pruneItemNameAiLastAppend(options.lastAppend, liveKeys)
  const changed =
    removedKeys.length > 0 ||
    drafts.changed ||
    selected.changed ||
    confirmedKeys.changed ||
    pendingAiKeys.changed ||
    committedKeys.changed ||
    lastAppend !== (options.lastAppend ?? null)
  return {
    rows,
    drafts: drafts.next,
    selected: selected.next,
    confirmedKeys: confirmedKeys.next,
    pendingAiKeys: pendingAiKeys.next,
    committedKeys: committedKeys.next,
    lastAppend,
    removedKeys,
    changed,
    phase: rows.length > 0 ? 'review' : 'idle',
  }
}

export function buildItemNameAiReviewRows(options: {
  groups: ItemNameAiGroup[]
  decisions: AiAccessoryContextDecision[]
  styles: StyleRef[]
  itemNameRules: InvoiceItemNameRule[]
  minConfidence: number
}): ItemNameAiReviewRow[] {
  const decisionByContext = new Map(
    options.decisions.map((decision) => [decision.contextId, decision]),
  )
  const styleById = new Map(
    options.styles.map((item) => [item.styleId, item]),
  )
  const knownStyleIds = new Set(styleById.keys())
  const rows: ItemNameAiReviewRow[] = []
  for (const group of options.groups) {
    const globalRule = findGlobalRule(options.itemNameRules, group.itemName)
    for (const context of group.contexts) {
      const decision = decisionByContext.get(context.contextId)
      const action: ItemNameAiAction = decision?.action ?? 'hold'
      const components =
        action === 'components'
          ? (decision?.components ?? []).flatMap((component) => {
              const style = styleById.get(component.styleId)
              return style
                ? [{ style, quantity: Math.max(1, component.quantity) }]
                : []
            })
          : []
      const existingRule =
        context.mainStyle && context.productLookupKey.trim()
          ? findExistingLookupRule(
              options.itemNameRules,
              context.itemName,
              context.mainStyle.styleId,
              context.productLookupKey,
            )
          : null
      const confidence = decision?.confidence ?? 0
      const row: ItemNameAiReviewRow = {
        ...context,
        key: context.contextId,
        action,
        components,
        originalSignature: itemNameAiSignature(action, components),
        reason: decision?.reason ?? '',
        confidence,
        passesGate:
          action !== 'hold' && confidence >= options.minConfidence,
        validationError: null,
        existingRuleId: existingRule?.id ?? null,
        existingGlobalRuleId: globalRule?.id ?? null,
      }
      rows.push(validateItemNameAiReviewRow(row, knownStyleIds))
    }
  }
  return rows
}

function inputFromReviewRow(
  row: ItemNameAiReviewRow,
  scope: 'global' | 'lookup_key',
): InvoiceItemNameRuleInput {
  return {
    scope,
    mainStyleId: scope === 'lookup_key' ? row.mainStyle?.styleId ?? null : null,
    productLookupKey:
      scope === 'lookup_key' ? row.productLookupKey : null,
    itemName: row.itemName,
    action: row.action === 'hold' ? 'delete' : row.action,
    note: 'AI 내품명 추천 검수',
    components:
      row.action === 'components'
        ? row.components.map((component) => ({
            styleId: component.style.styleId,
            role: 'included',
            quantity: component.quantity,
          }))
        : [],
  }
}

export function decideItemNameAiSaves(
  rows: ItemNameAiReviewRow[],
  selectedKeys: Iterable<string>,
): ItemNameAiSavePlan {
  const selected = new Set(selectedKeys)
  const globals: ItemNameAiSavePlan['globals'] = []
  const lookups: ItemNameAiSavePlan['lookups'] = []
  const blocked: ItemNameAiSavePlan['blocked'] = []
  const used = new Set<string>()
  const byGroup = new Map<string, ItemNameAiReviewRow[]>()
  for (const row of rows) {
    const group = byGroup.get(row.groupKey) ?? []
    group.push(row)
    byGroup.set(row.groupKey, group)
  }

  for (const [groupKey, siblings] of byGroup) {
    const signatures = new Set(
      siblings.map((row) => itemNameAiSignature(row.action, row.components)),
    )
    const canSaveGlobal =
      siblings.length > 1 &&
      siblings.every((row) => selected.has(row.key)) &&
      siblings.every(
        (row) =>
          !row.validationError &&
          row.action !== 'hold' &&
          row.passesGate &&
          !isItemNameAiReviewDirty(row),
      ) &&
      signatures.size === 1
    if (canSaveGlobal) {
      const first = siblings[0]!
      globals.push({
        groupKey,
        reviewKeys: siblings.map((row) => row.key),
        input: inputFromReviewRow(first, 'global'),
        existingRuleId: first.existingGlobalRuleId,
      })
      for (const row of siblings) used.add(row.key)
      continue
    }

    const selectedExceptionRows = siblings.filter((row) =>
      selected.has(row.key),
    )
    const exceptionSignatures = new Set(
      selectedExceptionRows.map((row) =>
        itemNameAiSignature(row.action, row.components),
      ),
    )
    const canSaveProductExceptionGlobal =
      siblings.every(
        (row) => row.productConnectionExcluded && !row.mainStyle,
      ) &&
      selectedExceptionRows.length > 0 &&
      selectedExceptionRows.every(
        (row) => !row.validationError && row.action !== 'hold',
      ) &&
      exceptionSignatures.size === 1
    if (!canSaveProductExceptionGlobal) continue
    const first = selectedExceptionRows[0]!
    globals.push({
      groupKey,
      reviewKeys: selectedExceptionRows.map((row) => row.key),
      input: inputFromReviewRow(first, 'global'),
      existingRuleId: first.existingGlobalRuleId,
    })
    for (const row of selectedExceptionRows) used.add(row.key)
  }

  for (const row of rows) {
    if (!selected.has(row.key) || used.has(row.key)) continue
    if (row.validationError || row.action === 'hold') {
      blocked.push({
        reviewKey: row.key,
        message: row.validationError ?? '변환 방식을 정하세요.',
      })
      continue
    }
    if (!row.mainStyle || !row.productLookupKey.trim()) {
      blocked.push({
        reviewKey: row.key,
        message: '개별 저장에는 확정 본품과 조회 키가 필요합니다.',
      })
      continue
    }
    lookups.push({
      reviewKey: row.key,
      input: inputFromReviewRow(row, 'lookup_key'),
      existingRuleId: row.existingRuleId,
    })
  }
  return { globals, lookups, blocked }
}

export const ITEM_NAME_AI_REVIEW_KINDS = [
  'delete',
  'single',
  'bundle',
  'hold',
] as const

export type ItemNameAiReviewKind = (typeof ITEM_NAME_AI_REVIEW_KINDS)[number]

export function mergeItemNameAiComponents(
  items: AccessoryLookupComponent[],
): AccessoryLookupComponent[] {
  const byId = new Map<string, AccessoryLookupComponent>()
  for (const item of items) {
    const quantity = Math.max(1, Math.floor(item.quantity || 1))
    const current = byId.get(item.style.styleId)
    if (current) current.quantity += quantity
    else byId.set(item.style.styleId, { style: item.style, quantity })
  }
  return [...byId.values()]
}

export function itemNameAiReviewKind(
  row: Pick<ItemNameAiReviewRow, 'action' | 'components'>,
): ItemNameAiReviewKind {
  if (row.action === 'delete') return 'delete'
  const total = row.components.reduce(
    (sum, item) => sum + Math.max(0, item.quantity || 0),
    0,
  )
  if (row.action === 'components' && total >= 2) return 'bundle'
  if (row.action === 'components' && total === 1) return 'single'
  return 'hold'
}

export function itemNameAiExpectedLines(row: ItemNameAiReviewRow) {
  if (row.action === 'hold') {
    if (row.components.length === 0) return ['결정 필요']
    return ['결정 필요', ...formatProductCompositionUnitLines(row.components)]
  }
  if (row.action === 'delete') return ['내품명을 비움']
  if (row.components.length === 0) return ['구성품 없음']
  return formatProductCompositionUnitLines(row.components)
}

export function formatItemNameAiExpected(row: ItemNameAiReviewRow) {
  if (row.action === 'hold') return '결정 필요'
  if (row.action === 'delete') return '내품명을 비움'
  return formatItemNameFromComponents(row.components)
}
