import { formatItemNameFromComponents } from '@/lib/invoice/item-name-transform'
import { formatProductCompositionLines } from '@/lib/invoice/product-composition'
import {
  accessoryContextId,
  evaluateLookupKeyDraft,
  findExistingLookupRule,
  inputFromLookupDraft,
  lookupDraftKey,
  type AccessoryContextPreview,
  type AccessoryLookupComponent,
  type AccessorySuggestDraft,
} from '@/lib/invoice/accessory-suggest'
import type {
  InvoiceAccessoryRuleType,
  InvoiceItemNameRule,
  InvoiceItemNameRuleAction,
  StyleRef,
} from '@/lib/types'
import type { InvoiceAccessoryRuleInput } from '@/lib/supabase/invoice-accessory-rules'
import type { InvoiceItemNameRuleInput } from '@/lib/supabase/invoice-item-name-rules'

export type AccessoryFlattenSource = {
  key: string
  kind: 'dictionary' | 'lookup_key'
  groupKey: string
  pattern: string
  ruleType: InvoiceAccessoryRuleType
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
  contexts: AccessoryContextPreview[]
  revalidationError: string | null
  allowedStyleIds: string[]
}

export type AccessoryReviewRow = {
  key: string
  sourceKey: string
  sourceKind: 'dictionary' | 'lookup_key'
  groupKey: string
  contextId: string
  itemName: string
  productLookupKey: string
  mainStyle: StyleRef | null
  rowCount: number
  action: InvoiceItemNameRuleAction
  components: AccessoryLookupComponent[]
  originalSignature: string
  existingRuleId: string | null
  reason: string
  confidence: number
  passesGate: boolean
  revalidationError: string | null
  allowedStyleIds: string[]
  dictionary: AccessorySuggestDraft | null
}

export type AccessoryReviewSavePlan = {
  dictionaries: Array<{
    sourceKey: string
    input: InvoiceAccessoryRuleInput
    reviewKeys: string[]
  }>
  lookups: Array<{
    reviewKey: string
    input: InvoiceItemNameRuleInput
    existingRuleId: string | null
  }>
}

export function accessoryReviewSignature(
  action: InvoiceItemNameRuleAction,
  components: AccessoryLookupComponent[],
) {
  if (action === 'delete') return 'delete'
  return components
    .map((item) => `${item.style.styleId}:${item.quantity}`)
    .sort()
    .join('|')
}

export function isAccessoryReviewDirty(row: AccessoryReviewRow) {
  return (
    accessoryReviewSignature(row.action, row.components) !== row.originalSignature
  )
}

export function formatAccessoryReviewExpected(
  action: InvoiceItemNameRuleAction,
  components: AccessoryLookupComponent[],
) {
  if (action === 'delete') return '내품명을 비움'
  if (components.length === 0) return '구성품 없음'
  return formatItemNameFromComponents(components)
}

export function accessoryReviewExpectedLines(
  action: InvoiceItemNameRuleAction,
  components: AccessoryLookupComponent[],
) {
  if (action === 'delete') return ['내품명을 비움']
  if (components.length === 0) return ['구성품 없음']
  return formatProductCompositionLines(components)
}

export function componentsFromStyleIds(
  styleIds: string[],
  styles: StyleRef[],
): AccessoryLookupComponent[] {
  const byId = new Map<string, AccessoryLookupComponent>()
  for (const styleId of styleIds) {
    const current = byId.get(styleId)
    if (current) {
      current.quantity += 1
      continue
    }
    const style = styles.find((item) => item.styleId === styleId)
    if (!style) continue
    byId.set(styleId, { style, quantity: 1 })
  }
  return [...byId.values()]
}

function comboKey(
  itemName: string,
  mainStyleId: string | null | undefined,
  productLookupKey: string,
) {
  return lookupDraftKey(itemName, mainStyleId ?? '', productLookupKey)
}

function reviewFromLookup(
  source: AccessoryFlattenSource,
  itemNameRules: InvoiceItemNameRule[],
): AccessoryReviewRow | null {
  if (!source.mainStyle || !source.productLookupKey.trim() || !source.itemName.trim()) {
    return null
  }
  const contextId = accessoryContextId({
    itemName: source.itemName,
    productLookupKey: source.productLookupKey,
    mainStyle: source.mainStyle,
  })
  const existing =
    source.existingRuleId ??
    findExistingLookupRule(
      itemNameRules,
      source.itemName,
      source.mainStyle.styleId,
      source.productLookupKey,
    )?.id ??
    null
  return {
    key: source.key,
    sourceKey: source.key,
    sourceKind: 'lookup_key',
    groupKey: source.groupKey,
    contextId,
    itemName: source.itemName,
    productLookupKey: source.productLookupKey,
    mainStyle: source.mainStyle,
    rowCount: source.rowCount,
    action: source.action,
    components: source.components,
    originalSignature: accessoryReviewSignature(source.action, source.components),
    existingRuleId: existing,
    reason: source.reason,
    confidence: source.confidence,
    passesGate: source.passesGate && !source.revalidationError,
    revalidationError: source.revalidationError,
    allowedStyleIds: source.allowedStyleIds,
    dictionary: null,
  }
}

function reviewsFromDictionary(
  source: AccessoryFlattenSource,
  styles: StyleRef[],
  itemNameRules: InvoiceItemNameRule[],
): AccessoryReviewRow[] {
  const dictionary: AccessorySuggestDraft = {
    ruleType: source.ruleType,
    pattern: source.pattern,
    accessoryKind: source.accessoryKind,
    namePrefix: source.namePrefix,
    colorName: source.colorName,
    targetStyle: source.targetStyle,
    confidence: source.confidence,
    reason: source.reason,
  }
  return source.contexts.flatMap((context) => {
    if (!context.mainStyle || !context.productLookupKey.trim() || !context.itemName.trim()) {
      return []
    }
    const components = componentsFromStyleIds(context.styleIdsAfter, styles)
    const action: InvoiceItemNameRuleAction =
      components.length === 0 ? 'delete' : 'components'
    const existing =
      findExistingLookupRule(
        itemNameRules,
        context.itemName,
        context.mainStyle.styleId,
        context.productLookupKey,
      )?.id ?? null
    return [
      {
        key: `${source.key}::${context.contextId}`,
        sourceKey: source.key,
        sourceKind: 'dictionary' as const,
        groupKey: source.groupKey,
        contextId: context.contextId,
        itemName: context.itemName,
        productLookupKey: context.productLookupKey,
        mainStyle: context.mainStyle,
        rowCount: context.rowCount,
        action,
        components,
        originalSignature: accessoryReviewSignature(action, components),
        existingRuleId: existing,
        reason: source.reason,
        confidence: source.confidence,
        passesGate:
          source.passesGate &&
          context.improved &&
          !context.regressing &&
          !source.revalidationError,
        revalidationError: source.revalidationError,
        allowedStyleIds: source.allowedStyleIds,
        dictionary,
      },
    ]
  })
}

export function flattenAccessoryPlanRows(
  sources: AccessoryFlattenSource[],
  styles: StyleRef[],
  itemNameRules: InvoiceItemNameRule[],
): AccessoryReviewRow[] {
  const byCombo = new Map<string, AccessoryReviewRow>()
  const ordered: AccessoryFlattenSource[] = [
    ...sources.filter((item) => item.kind === 'lookup_key'),
    ...sources.filter((item) => item.kind === 'dictionary'),
  ]
  for (const source of ordered) {
    const rows =
      source.kind === 'lookup_key'
        ? [reviewFromLookup(source, itemNameRules)].filter(
            (item): item is AccessoryReviewRow => Boolean(item),
          )
        : reviewsFromDictionary(source, styles, itemNameRules)
    for (const row of rows) {
      const key = comboKey(
        row.itemName,
        row.mainStyle?.styleId,
        row.productLookupKey,
      )
      const current = byCombo.get(key)
      if (!current || row.confidence > current.confidence) {
        byCombo.set(key, row)
      }
    }
  }
  return [...byCombo.values()].sort(
    (left, right) =>
      left.productLookupKey.localeCompare(right.productLookupKey, 'ko-KR') ||
      left.itemName.localeCompare(right.itemName, 'ko-KR') ||
      (left.mainStyle?.styleNo ?? '').localeCompare(
        right.mainStyle?.styleNo ?? '',
        'ko-KR',
      ),
  )
}

export function revalidateAccessoryReviewRow(
  row: AccessoryReviewRow,
): AccessoryReviewRow {
  if (!row.mainStyle) {
    return {
      ...row,
      revalidationError: '확정 본품이 필요합니다.',
      passesGate: false,
    }
  }
  const checked = evaluateLookupKeyDraft(
    {
      contextId: row.contextId,
      itemName: row.itemName,
      productLookupKey: row.productLookupKey,
      mainStyle: row.mainStyle,
      action: row.action,
      components: row.components,
      reason: row.reason,
      confidence: row.confidence,
      existingRuleId: row.existingRuleId,
      duplicateOf: null,
    },
    new Set(row.allowedStyleIds),
  )
  return {
    ...row,
    revalidationError: checked.ok ? null : checked.holdMessage,
    passesGate: checked.ok,
  }
}

export function decideAccessoryReviewSaves(
  rows: AccessoryReviewRow[],
  selectedKeys: Iterable<string>,
): AccessoryReviewSavePlan {
  const selected = new Set(selectedKeys)
  const bySource = new Map<string, AccessoryReviewRow[]>()
  for (const row of rows) {
    const list = bySource.get(row.sourceKey) ?? []
    list.push(row)
    bySource.set(row.sourceKey, list)
  }

  const dictionaries: AccessoryReviewSavePlan['dictionaries'] = []
  const used = new Set<string>()

  for (const [sourceKey, siblings] of bySource) {
    const picked = siblings.filter(
      (row) => selected.has(row.key) && !row.revalidationError,
    )
    if (picked.length === 0) continue
    const dictionary = picked[0]?.dictionary
    const saveGlobal =
      siblings[0]?.sourceKind === 'dictionary' &&
      Boolean(dictionary) &&
      siblings.every((row) => selected.has(row.key)) &&
      siblings.every((row) => !isAccessoryReviewDirty(row) && !row.revalidationError)
    if (!saveGlobal || !dictionary) continue
    dictionaries.push({
      sourceKey,
      reviewKeys: picked.map((row) => row.key),
      input: {
        ruleType: dictionary.ruleType,
        pattern: dictionary.pattern,
        accessoryKind: dictionary.accessoryKind,
        namePrefix: dictionary.namePrefix,
        colorName: dictionary.colorName,
        targetStyleId: dictionary.targetStyle?.styleId,
        note: dictionary.reason,
      },
    })
    for (const row of picked) used.add(row.key)
  }

  const lookups: AccessoryReviewSavePlan['lookups'] = []
  for (const row of rows) {
    if (!selected.has(row.key) || used.has(row.key) || row.revalidationError) {
      continue
    }
    if (!row.mainStyle) continue
    lookups.push({
      reviewKey: row.key,
      existingRuleId: row.existingRuleId,
      input: inputFromLookupDraft({
        contextId: row.contextId,
        itemName: row.itemName,
        productLookupKey: row.productLookupKey,
        mainStyle: row.mainStyle,
        action: row.action,
        components: row.components,
        reason: row.reason,
        confidence: row.confidence,
        existingRuleId: row.existingRuleId,
        duplicateOf: null,
      }),
    })
  }

  return { dictionaries, lookups }
}
