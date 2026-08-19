import { normalizeInvoiceText } from '@/lib/invoice/prefix-transform'
import {
  resolveInvoiceAccessories,
  accessoryStyleNameIndex,
} from '@/lib/invoice/accessory-resolve'
import { formatItemNameFromComponents } from '@/lib/invoice/item-name-transform'
import type { AccessorySuggestRule } from '@/lib/ai/gateway-core'
import type {
  InvoiceAccessoryRule,
  InvoiceAccessoryRuleType,
  InvoiceItemNameRule,
  InvoiceItemNameRuleAction,
  StyleRef,
} from '@/lib/types'
import type { UnresolvedItemNameCombo } from '@/lib/invoice/item-name-transform'
import type { InvoiceItemNameRuleInput } from '@/lib/supabase/invoice-item-name-rules'

export type AccessoryUnknownGroup = {
  key: string
  pattern: string
  unknownLabel: string
  rowCount: number
  itemNames: string[]
  lookupKeys: string[]
  mainProducts: string[]
  mainStyles: StyleRef[]
  contexts: AccessorySuggestContext[]
}

export type AccessorySuggestContext = {
  contextId?: string
  itemName: string
  productLookupKey: string
  mainStyle: StyleRef | null
  unknownPieces: string[]
  rowCount: number
}

export type AccessorySuggestHoldReason =
  | 'invalid_type'
  | 'incomplete'
  | 'invalid_style'
  | 'conflict'
  | 'no_effect'
  | 'no_rule'
  | 'failed'
  | 'context_conflict'
  | 'unsafe_global'

export type AccessoryContextPreview = {
  contextId: string
  itemName: string
  productLookupKey: string
  mainStyle: StyleRef | null
  rowCount: number
  unknownBefore: number
  unknownAfter: number
  componentsBefore: string
  componentsAfter: string
  styleIdsBefore: string[]
  styleIdsAfter: string[]
  improved: boolean
  sameAsMainSuppressed: boolean
  regressing: boolean
}

export type AccessoryPlanSafety = {
  partialResolution: boolean
  contextConflict: boolean
  unsafeGlobal: boolean
  globalScope: boolean
  affectedItemNameCount: number
  affectedLookupKeyCount: number
  affectedMainStyleCount: number
}

export type AccessoryDryRun = {
  ok: boolean
  holdReason: AccessorySuggestHoldReason | null
  holdMessage: string
  unknownBefore: number
  unknownAfter: number
  componentsBefore: number
  componentsAfter: number
  rowCount: number
  contexts: AccessoryContextPreview[]
  safety: AccessoryPlanSafety
}

export type AccessoryLookupComponent = {
  style: StyleRef
  quantity: number
}

export type AccessoryLookupDraft = {
  contextId: string
  itemName: string
  productLookupKey: string
  mainStyle: StyleRef
  action: InvoiceItemNameRuleAction
  components: AccessoryLookupComponent[]
  reason: string
  confidence: number
  existingRuleId: string | null
  duplicateOf: string | null
}

export type AccessoryContextDecision = {
  contextId: string
  action: 'components' | 'delete' | 'hold'
  components: Array<{
    styleId: string
    styleNo: string
    name: string
    quantity: number
  }>
  reason: string
}

export type AccessorySuggestDraft = {
  ruleType: InvoiceAccessoryRuleType
  pattern: string
  accessoryKind: string
  namePrefix: string
  colorName: string
  targetStyle: StyleRef | null
  confidence: number
  reason: string
}

const now = '2026-08-19T00:00:00.000Z'
const COLOR_TOKEN_RE =
  /^(pink|hot\s*pink|red|black|white|blue|green|yellow|gray|grey|ivory|navy|brown|beige|gold|silver|orange|purple|khaki|핑크|핫핑크|레드|블랙|화이트|블루|그린|옐로우|그레이|아이보리|네이비|브라운|베이지|골드|실버)$/iu

export function accessoryUnknownPattern(unknown: string) {
  return unknown.replace(/\s+\([^)]+\)\s*$/u, '').trim()
}

export function accessoryContextId(context: {
  itemName: string
  productLookupKey: string
  mainStyle: StyleRef | null
}) {
  return [
    normalizeInvoiceText(context.itemName),
    normalizeInvoiceText(context.productLookupKey),
    context.mainStyle?.styleId ?? '',
  ].join('\u0000')
}

export function lookupDraftKey(
  itemName: string,
  mainStyleId: string,
  productLookupKey: string,
) {
  return [
    normalizeInvoiceText(itemName),
    mainStyleId,
    normalizeInvoiceText(productLookupKey),
  ].join('\u0000')
}

export function withAccessoryContextId(
  context: Omit<AccessorySuggestContext, 'contextId'> & { contextId?: string },
): AccessorySuggestContext & { contextId: string } {
  return {
    ...context,
    contextId: context.contextId || accessoryContextId(context),
  }
}

export function collectUnknownAccessoryPieces(
  combos: UnresolvedItemNameCombo[],
): AccessoryUnknownGroup[] {
  const byKey = new Map<string, AccessoryUnknownGroup>()
  for (const combo of combos) {
    for (const unknown of combo.unknownPieces) {
      const pattern = accessoryUnknownPattern(unknown)
      if (!pattern) continue
      const key = normalizeInvoiceText(pattern)
      if (!key) continue
      const context = withAccessoryContextId({
        itemName: combo.itemName,
        productLookupKey: combo.productLookupKey,
        mainStyle: combo.productStyle,
        unknownPieces: combo.unknownPieces,
        rowCount: combo.rowCount,
      })
      const current = byKey.get(key)
      if (current) {
        current.rowCount += combo.rowCount
        current.unknownLabel = current.unknownLabel || unknown
        if (!current.itemNames.includes(combo.itemName)) {
          current.itemNames.push(combo.itemName)
        }
        if (
          combo.productLookupKey &&
          !current.lookupKeys.includes(combo.productLookupKey)
        ) {
          current.lookupKeys.push(combo.productLookupKey)
        }
        if (
          combo.productStyle &&
          !current.mainStyles.some(
            (item) => item.styleId === combo.productStyle?.styleId,
          )
        ) {
          current.mainStyles.push(combo.productStyle)
          current.mainProducts.push(
            `${combo.productStyle.styleNo} ${combo.productStyle.name}`,
          )
        }
        const existing = current.contexts.find(
          (item) => item.contextId === context.contextId,
        )
        if (existing) existing.rowCount += combo.rowCount
        else current.contexts.push(context)
        continue
      }
      byKey.set(key, {
        key,
        pattern,
        unknownLabel: unknown,
        rowCount: combo.rowCount,
        itemNames: [combo.itemName],
        lookupKeys: combo.productLookupKey ? [combo.productLookupKey] : [],
        mainProducts: combo.productStyle
          ? [`${combo.productStyle.styleNo} ${combo.productStyle.name}`]
          : [],
        mainStyles: combo.productStyle ? [combo.productStyle] : [],
        contexts: [context],
      })
    }
  }
  return [...byKey.values()].sort((left, right) => right.rowCount - left.rowCount)
}

export function draftFromAccessorySuggest(
  rule: AccessorySuggestRule,
): AccessorySuggestDraft {
  return {
    ruleType: rule.ruleType,
    pattern: rule.pattern,
    accessoryKind: rule.accessoryKind,
    namePrefix: rule.namePrefix,
    colorName: rule.colorName,
    targetStyle:
      rule.ruleType === 'token' && rule.styleId
        ? {
            styleId: rule.styleId,
            styleNo: rule.styleNo,
            name: rule.name,
          }
        : null,
    confidence: rule.confidence,
    reason: rule.reason,
  }
}

export function toPreviewAccessoryRule(
  draft: AccessorySuggestDraft,
  id = 'preview',
): InvoiceAccessoryRule {
  return {
    id,
    brandId: 'preview',
    ruleType: draft.ruleType,
    pattern: draft.pattern,
    normalizedPattern: normalizeInvoiceText(draft.pattern),
    accessoryKind: draft.accessoryKind,
    namePrefix: draft.namePrefix,
    colorName: draft.colorName,
    targetStyle: draft.targetStyle,
    isActive: true,
    note: draft.reason,
    createdAt: now,
    updatedAt: now,
  }
}

export function isUnsafeGlobalToken(pattern: string) {
  const trimmed = pattern.trim()
  const compact = normalizeInvoiceText(trimmed).replace(/\s+/g, '')
  if (!compact) return true
  if (COLOR_TOKEN_RE.test(trimmed) || COLOR_TOKEN_RE.test(compact)) return true
  return compact.length < 3
}

function emptySafety(
  contexts: AccessorySuggestContext[],
  extra: Partial<AccessoryPlanSafety> = {},
): AccessoryPlanSafety {
  return {
    partialResolution: false,
    contextConflict: false,
    unsafeGlobal: false,
    globalScope: true,
    affectedItemNameCount: new Set(contexts.map((item) => item.itemName)).size,
    affectedLookupKeyCount: new Set(
      contexts.map((item) => item.productLookupKey).filter(Boolean),
    ).size,
    affectedMainStyleCount: new Set(
      contexts
        .map((item) => item.mainStyle?.styleId)
        .filter((item): item is string => Boolean(item)),
    ).size,
    ...extra,
  }
}

function formatResolvedComponents(
  components: Array<{ style: StyleRef; quantity: number }>,
) {
  return formatItemNameFromComponents(components)
}

function previewOf(
  context: AccessorySuggestContext,
  before: ReturnType<typeof resolveInvoiceAccessories>,
  after: ReturnType<typeof resolveInvoiceAccessories>,
): AccessoryContextPreview {
  const styleIdsBefore = before.components.map((item) => item.style.styleId)
  const styleIdsAfter = after.components.map((item) => item.style.styleId)
  const beforeIds = new Set(styleIdsBefore)
  const afterIds = new Set(styleIdsAfter)
  const lost = styleIdsBefore.some((id) => !afterIds.has(id))
  const addedOnClean =
    before.unknown.length === 0 &&
    styleIdsAfter.some((id) => !beforeIds.has(id))
  const unknownGrew = after.unknown.length > before.unknown.length
  const improved =
    after.unknown.length < before.unknown.length ||
    (after.unknown.length === 0 &&
      after.components.length > before.components.length &&
      before.unknown.length > 0)
  return {
    contextId: context.contextId || accessoryContextId(context),
    itemName: context.itemName,
    productLookupKey: context.productLookupKey,
    mainStyle: context.mainStyle,
    rowCount: context.rowCount,
    unknownBefore: before.unknown.length,
    unknownAfter: after.unknown.length,
    componentsBefore: formatResolvedComponents(before.components),
    componentsAfter: formatResolvedComponents(after.components),
    styleIdsBefore,
    styleIdsAfter,
    improved,
    sameAsMainSuppressed: after.ignored.some((item) => item.includes('본품 되풀이')),
    regressing: lost || addedOnClean || unknownGrew,
  }
}

function safetyFromPreviews(
  contexts: AccessorySuggestContext[],
  previews: AccessoryContextPreview[],
  extra: Partial<AccessoryPlanSafety> = {},
): AccessoryPlanSafety {
  const improved = previews.filter((item) => item.improved)
  const leftoverUnknown = previews.some((item) => item.unknownAfter > 0)
  const outcomeKeys = new Set(
    previews.map((item) =>
      item.unknownAfter > 0
        ? `unknown:${item.unknownAfter}`
        : `done:${item.styleIdsAfter.slice().sort().join(',')}`,
    ),
  )
  return emptySafety(contexts, {
    partialResolution:
      (improved.length > 0 && improved.length < previews.length) ||
      (improved.length > 0 && leftoverUnknown),
    contextConflict: outcomeKeys.size > 1 && improved.length > 0,
    ...extra,
  })
}

export function evaluateAccessorySuggestion(
  draft: AccessorySuggestDraft,
  existing: InvoiceAccessoryRule[],
  contexts: AccessorySuggestContext[],
  styles: StyleRef[],
  allowedStyleIds: Set<string>,
): AccessoryDryRun {
  const normalizedContexts = contexts.map(withAccessoryContextId)
  const rowCount = normalizedContexts.reduce((sum, item) => sum + item.rowCount, 0)
  if (!draft.pattern.trim()) {
    return hold('incomplete', '패턴이 없습니다.', rowCount, normalizedContexts)
  }
  if (draft.ruleType === 'token') {
    if (!draft.targetStyle || !allowedStyleIds.has(draft.targetStyle.styleId)) {
      return hold('invalid_style', '후보에 없는 구성품입니다.', rowCount, normalizedContexts)
    }
  }
  if (
    (draft.ruleType === 'label' || draft.ruleType === 'default') &&
    (!draft.accessoryKind.trim() || !draft.namePrefix.trim())
  ) {
    return hold(
      'incomplete',
      '종류와 상품명 접두어가 필요합니다.',
      rowCount,
      normalizedContexts,
    )
  }
  if (draft.ruleType === 'color' && !draft.colorName.trim()) {
    return hold('incomplete', '한글 색상이 필요합니다.', rowCount, normalizedContexts)
  }

  const normalized = normalizeInvoiceText(draft.pattern)
  const conflict = existing.find(
    (rule) =>
      rule.isActive &&
      rule.ruleType === draft.ruleType &&
      rule.normalizedPattern === normalized,
  )
  if (conflict) {
    return hold(
      'conflict',
      '같은 패턴이 이미 사전에 있습니다.',
      rowCount,
      normalizedContexts,
    )
  }

  const preview = toPreviewAccessoryRule(draft)
  const styleByName = accessoryStyleNameIndex(styles)
  const contextPreviews: AccessoryContextPreview[] = []
  let unknownBefore = 0
  let unknownAfter = 0
  let componentsBefore = 0
  let componentsAfter = 0
  for (const context of normalizedContexts) {
    const before = resolveInvoiceAccessories({
      itemName: context.itemName,
      productLookupKey: context.productLookupKey,
      mainStyle: context.mainStyle,
      dictionary: existing,
      styleByName,
    })
    const after = resolveInvoiceAccessories({
      itemName: context.itemName,
      productLookupKey: context.productLookupKey,
      mainStyle: context.mainStyle,
      dictionary: [...existing, preview],
      styleByName,
    })
    const contextPreview = previewOf(context, before, after)
    contextPreviews.push(contextPreview)
    unknownBefore += before.unknown.length
    unknownAfter += after.unknown.length
    componentsBefore += before.components.reduce(
      (sum, item) => sum + item.quantity,
      0,
    )
    componentsAfter += after.components.reduce(
      (sum, item) => sum + item.quantity,
      0,
    )
  }

  const safety = safetyFromPreviews(normalizedContexts, contextPreviews)
  if (
    draft.ruleType === 'token' &&
    (isUnsafeGlobalToken(draft.pattern) || safety.contextConflict)
  ) {
    safety.unsafeGlobal = true
    safety.contextConflict =
      safety.contextConflict || normalizedContexts.length > 1
  }

  const anyRegress = contextPreviews.some((item) => item.regressing)
  const anyImproved = contextPreviews.some((item) => item.improved)
  if (anyRegress) {
    return {
      ok: false,
      holdReason: 'no_effect',
      holdMessage: '다른 조회 키·본품 문맥의 결과를 깨뜨립니다.',
      unknownBefore,
      unknownAfter,
      componentsBefore,
      componentsAfter,
      rowCount,
      contexts: contextPreviews,
      safety,
    }
  }
  if (safety.unsafeGlobal || (draft.ruleType === 'token' && safety.contextConflict)) {
    const unsafeToken = draft.ruleType === 'token' && isUnsafeGlobalToken(draft.pattern)
    return {
      ok: false,
      holdReason: unsafeToken ? 'unsafe_global' : 'context_conflict',
      holdMessage: unsafeToken
        ? '짧은 색상·일반 단어는 전역 토큰으로 쓰지 않습니다. 조회 키 규칙으로 나눕니다.'
        : '같은 조각이 본품·조회 키마다 다른 구성품을 뜻합니다.',
      unknownBefore,
      unknownAfter,
      componentsBefore,
      componentsAfter,
      rowCount,
      contexts: contextPreviews,
      safety: { ...safety, unsafeGlobal: true },
    }
  }
  if (!anyImproved) {
    return {
      ok: false,
      holdReason: 'no_effect',
      holdMessage: '이 규칙을 넣어도 모르는 조각이 줄지 않습니다.',
      unknownBefore,
      unknownAfter,
      componentsBefore,
      componentsAfter,
      rowCount,
      contexts: contextPreviews,
      safety,
    }
  }

  return {
    ok: true,
    holdReason: null,
    holdMessage: '',
    unknownBefore,
    unknownAfter,
    componentsBefore,
    componentsAfter,
    rowCount,
    contexts: contextPreviews,
    safety,
  }
}

export function buildAccessoryPlanPreview(
  draft: AccessorySuggestDraft,
  existing: InvoiceAccessoryRule[],
  contexts: AccessorySuggestContext[],
  styles: StyleRef[],
  allowedStyleIds: Set<string>,
) {
  return evaluateAccessorySuggestion(
    draft,
    existing,
    contexts,
    styles,
    allowedStyleIds,
  )
}

function hold(
  reason: AccessorySuggestHoldReason,
  message: string,
  rowCount: number,
  contexts: AccessorySuggestContext[] = [],
  extra: Partial<AccessoryPlanSafety> = {},
): AccessoryDryRun {
  return {
    ok: false,
    holdReason: reason,
    holdMessage: message,
    unknownBefore: 0,
    unknownAfter: 0,
    componentsBefore: 0,
    componentsAfter: 0,
    rowCount,
    contexts: [],
    safety: emptySafety(contexts, extra),
  }
}

export function findExistingLookupRule(
  rules: InvoiceItemNameRule[],
  itemName: string,
  styleId: string,
  productLookupKey: string,
) {
  const item = normalizeInvoiceText(itemName)
  const lookup = normalizeInvoiceText(productLookupKey)
  if (!item || !styleId || !lookup) return null
  return (
    rules.find(
      (rule) =>
        rule.isActive &&
        rule.scope === 'lookup_key' &&
        rule.normalizedItemName === item &&
        rule.mainStyle?.styleId === styleId &&
        rule.normalizedProductLookupKey === lookup,
    ) ?? null
  )
}

function mergeLookupComponents(
  resolved: AccessoryLookupComponent[],
  extra: AccessoryLookupComponent[],
) {
  const byId = new Map<string, AccessoryLookupComponent>()
  for (const item of [...resolved, ...extra]) {
    const current = byId.get(item.style.styleId)
    if (current) current.quantity += item.quantity
    else byId.set(item.style.styleId, { style: item.style, quantity: item.quantity })
  }
  return [...byId.values()]
}

function resolveComponentsForContext(
  context: AccessorySuggestContext,
  dictionary: InvoiceAccessoryRule[],
  styles: StyleRef[],
) {
  return resolveInvoiceAccessories({
    itemName: context.itemName,
    productLookupKey: context.productLookupKey,
    mainStyle: context.mainStyle,
    dictionary,
    styleByName: accessoryStyleNameIndex(styles),
  })
}

export function evaluateLookupKeyDraft(
  draft: AccessoryLookupDraft,
  allowedStyleIds?: Set<string>,
): { ok: boolean; holdReason: AccessorySuggestHoldReason | null; holdMessage: string } {
  if (!draft.itemName.trim()) {
    return { ok: false, holdReason: 'incomplete', holdMessage: '내품명이 없습니다.' }
  }
  if (!draft.productLookupKey.trim() || !draft.mainStyle) {
    return {
      ok: false,
      holdReason: 'incomplete',
      holdMessage: '조회 키 규칙은 확정 본품과 조회 키가 필요합니다.',
    }
  }
  if (draft.action === 'delete' && draft.components.length > 0) {
    return {
      ok: false,
      holdReason: 'incomplete',
      holdMessage: '지우는 규칙에는 구성품을 넣지 않습니다.',
    }
  }
  if (draft.action === 'components' && draft.components.length === 0) {
    return {
      ok: false,
      holdReason: 'incomplete',
      holdMessage: '구성품 M번호를 하나 이상 고르세요.',
    }
  }
  const seen = new Set<string>()
  for (const item of draft.components) {
    if (allowedStyleIds && !allowedStyleIds.has(item.style.styleId)) {
      return {
        ok: false,
        holdReason: 'invalid_style',
        holdMessage: '후보에 없는 구성품입니다.',
      }
    }
    if (seen.has(item.style.styleId)) {
      return {
        ok: false,
        holdReason: 'incomplete',
        holdMessage: '같은 구성품 M번호는 한 번만 넣을 수 있습니다.',
      }
    }
    seen.add(item.style.styleId)
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      return {
        ok: false,
        holdReason: 'incomplete',
        holdMessage: '구성 수량은 1 이상이어야 합니다.',
      }
    }
  }
  return { ok: true, holdReason: null, holdMessage: '' }
}

export function inputFromLookupDraft(
  draft: AccessoryLookupDraft,
): InvoiceItemNameRuleInput {
  return {
    scope: 'lookup_key',
    mainStyleId: draft.mainStyle.styleId,
    productLookupKey: draft.productLookupKey,
    itemName: draft.itemName,
    action: draft.action,
    note: draft.reason,
    components:
      draft.action === 'components'
        ? draft.components.map((item) => ({
            styleId: item.style.styleId,
            role: 'included' as const,
            quantity: item.quantity,
          }))
        : [],
  }
}

export function buildLookupKeyDraftsFromDecisions(options: {
  contexts: AccessorySuggestContext[]
  dictionary: InvoiceAccessoryRule[]
  styles: StyleRef[]
  itemNameRules: InvoiceItemNameRule[]
  decisions: AccessoryContextDecision[]
  allowedByContext?: Map<string, Set<string>>
  fallbackAllowed?: Set<string>
  reason: string
  confidence: number
}): AccessoryLookupDraft[] {
  const drafts: AccessoryLookupDraft[] = []
  const seen = new Map<string, AccessoryLookupDraft>()
  for (const raw of options.contexts.map(withAccessoryContextId)) {
    if (!raw.mainStyle || !raw.productLookupKey.trim()) continue
    const decision = options.decisions.find((item) => item.contextId === raw.contextId)
    if (!decision || decision.action === 'hold') continue
    const allowed =
      options.allowedByContext?.get(raw.contextId) ?? options.fallbackAllowed
    const resolved = resolveComponentsForContext(
      raw,
      options.dictionary,
      options.styles,
    )
    const extra = decision.components.flatMap((item) => {
      if (allowed && !allowed.has(item.styleId)) return []
      const style =
        options.styles.find((entry) => entry.styleId === item.styleId) ??
        (item.styleId
          ? {
              styleId: item.styleId,
              styleNo: item.styleNo,
              name: item.name,
            }
          : null)
      if (!style) return []
      return [{ style, quantity: Math.max(1, item.quantity || 1) }]
    })
    const merged =
      decision.action === 'delete'
        ? []
        : mergeLookupComponents(resolved.components, extra)
    if (decision.action === 'components' && merged.length === 0) continue
    if (decision.action === 'delete' && resolved.components.length > 0) continue
    const existing = findExistingLookupRule(
      options.itemNameRules,
      raw.itemName,
      raw.mainStyle.styleId,
      raw.productLookupKey,
    )
    const draft: AccessoryLookupDraft = {
      contextId: raw.contextId,
      itemName: raw.itemName,
      productLookupKey: raw.productLookupKey,
      mainStyle: raw.mainStyle,
      action: decision.action === 'delete' ? 'delete' : 'components',
      components: merged,
      reason: decision.reason || options.reason,
      confidence: options.confidence,
      existingRuleId: existing?.id ?? null,
      duplicateOf: null,
    }
    const checked = evaluateLookupKeyDraft(draft, allowed)
    if (!checked.ok) continue
    const key = lookupDraftKey(draft.itemName, draft.mainStyle.styleId, draft.productLookupKey)
    const previous = seen.get(key)
    if (previous) {
      if (draft.confidence > previous.confidence) {
        previous.duplicateOf = draft.contextId
        seen.set(key, draft)
      } else {
        draft.duplicateOf = previous.contextId
      }
    } else {
      seen.set(key, draft)
    }
    drafts.push(draft)
  }
  return drafts.filter((item) => !item.duplicateOf)
}

export function buildLookupKeyDraftsFromPreview(options: {
  contexts: AccessoryContextPreview[]
  styles: StyleRef[]
  itemNameRules: InvoiceItemNameRule[]
  reason: string
  confidence: number
}): AccessoryLookupDraft[] {
  const drafts: AccessoryLookupDraft[] = []
  const seen = new Map<string, AccessoryLookupDraft>()
  for (const context of options.contexts) {
    if (!context.improved || context.regressing) continue
    if (!context.mainStyle || !context.productLookupKey.trim()) continue
    const components = context.styleIdsAfter.flatMap((styleId) => {
      const style = options.styles.find((item) => item.styleId === styleId)
      return style ? [{ style, quantity: 1 }] : []
    })
    const action: InvoiceItemNameRuleAction =
      components.length === 0 ? 'delete' : 'components'
    const existing = findExistingLookupRule(
      options.itemNameRules,
      context.itemName,
      context.mainStyle.styleId,
      context.productLookupKey,
    )
    const draft: AccessoryLookupDraft = {
      contextId: context.contextId,
      itemName: context.itemName,
      productLookupKey: context.productLookupKey,
      mainStyle: context.mainStyle,
      action,
      components,
      reason: options.reason,
      confidence: options.confidence,
      existingRuleId: existing?.id ?? null,
      duplicateOf: null,
    }
    const checked = evaluateLookupKeyDraft(draft)
    if (!checked.ok) continue
    const key = lookupDraftKey(draft.itemName, draft.mainStyle.styleId, draft.productLookupKey)
    if (seen.has(key)) {
      draft.duplicateOf = seen.get(key)!.contextId
      continue
    }
    seen.set(key, draft)
    drafts.push(draft)
  }
  return drafts
}

export function accessoryCandidateTexts(group: AccessoryUnknownGroup) {
  return [group.pattern, ...group.itemNames, ...group.lookupKeys]
    .map((item) => item.trim())
    .filter(Boolean)
}

export function accessorySuggestRequestContexts(group: AccessoryUnknownGroup) {
  return group.contexts.slice(0, 8).map((context) => ({
    contextId: context.contextId || accessoryContextId(context),
    itemName: context.itemName.slice(0, 200),
    productLookupKey: context.productLookupKey.slice(0, 200),
    mainProduct: context.mainStyle
      ? `${context.mainStyle.styleNo} ${context.mainStyle.name}`.slice(0, 120)
      : '',
    unknownPieces: context.unknownPieces.slice(0, 6).map((item) => item.slice(0, 120)),
  }))
}

export function candidatesForContext(
  all: Array<{
    source: string
    lookupKey: string
    styleId: string
    styleNo: string
    name: string
    score: number
  }>,
  context: AccessorySuggestContext,
) {
  const hay = normalizeInvoiceText(
    [context.itemName, context.productLookupKey, context.mainStyle?.name ?? ''].join(
      ' ',
    ),
  )
  return all.filter((item) => {
    if (item.score >= 0.5) return true
    const needle = normalizeInvoiceText(`${item.name} ${item.lookupKey}`)
    return Boolean(hay && needle && (hay.includes(needle) || needle.includes(hay.slice(0, 8))))
  })
}

export function mergeAccessoryStyleCandidates(
  searched: Array<{
    source: string
    lookupKey: string
    styleId: string
    styleNo: string
    name: string
    score: number
  }>,
  styles: StyleRef[],
  dictionary: InvoiceAccessoryRule[],
  limit = 20,
) {
  const prefixes = [
    ...new Set(
      dictionary
        .filter(
          (rule) =>
            rule.isActive &&
            (rule.ruleType === 'label' || rule.ruleType === 'default') &&
            rule.namePrefix.trim(),
        )
        .map((rule) => rule.namePrefix),
    ),
  ]
  const extra = styles.filter((style) =>
    prefixes.some((prefix) => style.name.startsWith(prefix)),
  )
  const tokens = dictionary
    .filter((rule) => rule.isActive && rule.ruleType === 'token' && rule.targetStyle)
    .map((rule) => rule.targetStyle!)
  const merged = new Map<
    string,
    {
      source: string
      lookupKey: string
      styleId: string
      styleNo: string
      name: string
      score: number
    }
  >()
  for (const item of searched) {
    merged.set(item.styleId, item)
  }
  for (const style of [...extra, ...tokens]) {
    if (merged.has(style.styleId)) continue
    merged.set(style.styleId, {
      source: 'dictionary',
      lookupKey: style.name,
      styleId: style.styleId,
      styleNo: style.styleNo,
      name: style.name,
      score: 0.35,
    })
  }
  return [...merged.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
}
