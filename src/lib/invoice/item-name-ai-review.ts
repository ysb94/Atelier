import { formatItemNameFromComponents } from '@/lib/invoice/item-name-transform'
import { normalizeInvoiceText } from '@/lib/invoice/prefix-transform'
import {
  accessoryContextId,
  findExistingLookupRule,
  type AccessoryLookupComponent,
} from '@/lib/invoice/accessory-suggest'
import {
  formatProductCompositionLines,
  productCompositionFromStyle,
  richerProductComposition,
  type ProductCompositionItem,
} from '@/lib/invoice/product-composition'
import type { InvoiceItemNameRuleInput } from '@/lib/supabase/invoice-item-name-rules'
import type {
  AiAccessoryContextDecision,
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
    if (!canSaveGlobal) continue
    const first = siblings[0]!
    globals.push({
      groupKey,
      reviewKeys: siblings.map((row) => row.key),
      input: inputFromReviewRow(first, 'global'),
      existingRuleId: first.existingGlobalRuleId,
    })
    for (const row of siblings) used.add(row.key)
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

export function itemNameAiReviewKind(
  row: Pick<ItemNameAiReviewRow, 'action' | 'components'>,
): ItemNameAiReviewKind {
  if (row.action === 'delete') return 'delete'
  if (row.action === 'components' && row.components.length >= 2) return 'bundle'
  if (row.action === 'components' && row.components.length === 1) return 'single'
  return 'hold'
}

export function itemNameAiExpectedLines(row: ItemNameAiReviewRow) {
  if (row.action === 'hold') return ['결정 필요']
  if (row.action === 'delete') return ['내품명을 비움']
  if (row.components.length === 0) return ['구성품 없음']
  return formatProductCompositionLines(row.components)
}

export function formatItemNameAiExpected(row: ItemNameAiReviewRow) {
  if (row.action === 'hold') return '결정 필요'
  if (row.action === 'delete') return '내품명을 비움'
  return formatItemNameFromComponents(row.components)
}
