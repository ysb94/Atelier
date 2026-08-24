import {
  generateProductNameRegistrationCandidates,
  pickProductNameRegistrationCandidate,
  type ProductNameCandidate,
} from '@/lib/invoice/product-name-patterns'
import { normalizeInvoiceText } from '@/lib/invoice/prefix-transform'
import { matchingProductNameFromTags } from '@/lib/invoice/product-name-tags'
import type { UnresolvedProductNameCombo } from '@/lib/invoice/product-name-transform'
import type {
  AiProductRecommendation,
  AiRecommendProduct,
  AiRecommendationSource,
  StyleRef,
} from '@/lib/types'

export const PRODUCT_NAME_AI_QUICK_SLOT_LIMIT = 3

export type ProductNameAiHoldReason =
  | 'no_lookup_key'
  | 'no_product'
  | 'failed'
  | 'low_confidence'
  | 'conflict'
  | 'duplicate'
  | 'incomplete'
  | 'exclusion_guarded'

export type ProductNameAiReviewKind = 'queue' | 'hold' | 'ready' | 'failed'

export type ProductNameAiExtra = {
  style: StyleRef
  role: 'included' | 'required' | 'paid_add'
  quantity: number
}

export type ProductNameAiReviewRow = {
  key: string
  productName: string
  itemName: string
  mallName: string
  ownProductCode: string
  rowCount: number
  /** 기존 원장·AI 탐색용 전체 후보. */
  candidates: ProductNameCandidate[]
  /** 신규 원장에 저장할 품목명·내품명·두 열 전체 조합 후보. */
  registrationCandidates: ProductNameCandidate[]
  lookupKey: string
  appliedRule: string | null
  style: StyleRef | null
  extras: ProductNameAiExtra[]
  confidence: number
  source: 'local' | 'ai' | 'manual' | null
  cacheId: string | null
  provider: AiProductRecommendation['provider'] | null
  modelId: string | null
  shownRank: number | null
  passesGate: boolean
  isConflict: boolean
  /** 동일 등록 키가 서로 다른 본품 M번호를 가리키는 검수표 내부 충돌. */
  lookupKeyConflict: boolean
  duplicateOf: string | null
  holdReason: ProductNameAiHoldReason | null
  message: string | null
  validationError: string | null
  originalSignature: string
}

export type ProductNameAiQuickSlotStatus =
  | 'empty'
  | 'draft'
  | 'matched'
  | 'ambiguous'
  | 'unmatched'

export type ProductNameAiQuickSlot = {
  text: string
  quantity: number
  style: StyleRef | null
  status: ProductNameAiQuickSlotStatus
  candidates: StyleRef[]
  error: string | null
}

export type ProductNameAiSavePlanItem = {
  reviewKey: string
  productName: string
  itemName: string
  mallName: string
  ownProductCode: string
  lookupKey: string
  appliedRule: string | null
  style: StyleRef
  extras: ProductNameAiExtra[]
  source: 'local' | 'ai' | 'manual'
  cacheId: string | null
  shownRank: number | null
  provider: AiProductRecommendation['provider'] | null
  modelId: string | null
  sharesLookupKey: boolean
}

export type ProductNameAiSavePlan = {
  items: ProductNameAiSavePlanItem[]
  skipped: Array<{ reviewKey: string; message: string }>
}

export function productNameAiSignature(row: {
  lookupKey: string
  style: StyleRef | null
  extras: ProductNameAiExtra[]
}) {
  const extras = row.extras
    .map((item) => `${item.style.styleId}:${item.role}:${item.quantity}`)
    .sort()
    .join('|')
  return `${normalizeInvoiceText(row.lookupKey)}\u0000${row.style?.styleId ?? ''}\u0000${extras}`
}

export function isProductNameAiReviewDirty(row: ProductNameAiReviewRow) {
  return (
    productNameAiSignature(row) !== row.originalSignature ||
    row.source === 'manual'
  )
}

export function buildProductNameAiReviewRow(
  combo: UnresolvedProductNameCombo,
): ProductNameAiReviewRow {
  const matchedCandidate =
    (combo.appliedLookupKey
      ? combo.candidates.find(
          (candidate) => candidate.text === combo.appliedLookupKey,
        )
      : null) ??
    (combo.appliedRule
      ? combo.candidates.find(
          (candidate) => candidate.rule === combo.appliedRule,
        )
      : null)
  const registrationCandidates = generateProductNameRegistrationCandidates({
    productName: matchingProductNameFromTags(combo.productName, combo.tags),
    itemName: combo.itemName,
  })
  const selectedRegistration = pickProductNameRegistrationCandidate(
    registrationCandidates,
    matchedCandidate?.rule ?? combo.appliedRule,
  )
  const lookupKey = selectedRegistration?.text ?? ''
  const isGuarded = combo.status === 'exclusion_guarded'
  const row: ProductNameAiReviewRow = {
    key: combo.key,
    productName: combo.productName,
    itemName: combo.itemName,
    mallName: combo.mallName,
    ownProductCode: combo.ownProductCode,
    rowCount: combo.rowCount,
    candidates: combo.candidates,
    registrationCandidates,
    lookupKey,
    appliedRule: selectedRegistration?.rule ?? combo.appliedRule,
    style: combo.candidateStyles.length === 1 ? combo.candidateStyles[0]! : null,
    extras: [],
    confidence: 0,
    source: null,
    cacheId: null,
    provider: null,
    modelId: null,
    shownRank: null,
    passesGate: false,
    isConflict: combo.status === 'conflict',
    lookupKeyConflict: false,
    duplicateOf: null,
    holdReason: isGuarded
      ? 'exclusion_guarded'
      : combo.status === 'conflict'
        ? 'conflict'
        : lookupKey
          ? 'incomplete'
          : 'no_lookup_key',
    message: isGuarded
      ? '같은 주문에 본품이 없어 예외 보류입니다.'
      : combo.status === 'conflict'
        ? '본품 후보가 여러 개입니다.'
        : null,
    validationError: null,
    originalSignature: '',
  }
  row.originalSignature = productNameAiSignature(row)
  return validateProductNameAiReviewRow(row)
}

export function buildProductNameAiReviewRows(
  combos: UnresolvedProductNameCombo[],
): ProductNameAiReviewRow[] {
  return combos.map(buildProductNameAiReviewRow)
}

export function applyProductNameLookupKey(
  row: ProductNameAiReviewRow,
  lookupKey: string,
): ProductNameAiReviewRow {
  const candidate = row.registrationCandidates.find(
    (item) => item.text === lookupKey,
  )
  if (!candidate) return row
  return validateProductNameAiReviewRow({
    ...row,
    lookupKey,
    appliedRule: candidate?.rule ?? row.appliedRule,
    source: row.source && row.source !== 'manual' ? 'manual' : row.source,
  })
}

export function applyProductNameAiRecommendation(
  row: ProductNameAiReviewRow,
  recommendation: Pick<
    AiProductRecommendation,
    'lookupKey' | 'products' | 'source' | 'cacheId' | 'provider' | 'modelId' | 'reason'
  >,
  minConfidence: number,
): ProductNameAiReviewRow {
  if (row.holdReason === 'exclusion_guarded') return row
  const matchedCandidate = recommendation.lookupKey
    ? row.candidates.find(
        (candidate) => candidate.text === recommendation.lookupKey,
      )
    : null
  const selectedRegistration = pickProductNameRegistrationCandidate(
    row.registrationCandidates,
    matchedCandidate?.rule ?? row.appliedRule,
  )
  const lookupKey = selectedRegistration?.text ?? row.lookupKey
  const top = recommendation.products[0]
  if (!top) {
    return validateProductNameAiReviewRow({
      ...row,
      lookupKey,
      style: null,
      confidence: 0,
      source: recommendation.source === 'local' ? 'local' : 'ai',
      cacheId: recommendation.cacheId,
      provider: recommendation.provider,
      modelId: recommendation.modelId,
      shownRank: null,
      passesGate: false,
      holdReason: 'no_product',
      message: recommendation.reason || '추천 상품이 없습니다.',
    })
  }
  const style: StyleRef = {
    styleId: top.styleId,
    styleNo: top.styleNo,
    name: top.name,
  }
  const passesGate = top.confidence >= minConfidence
  const holdReason = row.isConflict
    ? 'conflict'
    : passesGate
      ? null
      : 'low_confidence'
  return validateProductNameAiReviewRow({
    ...row,
    lookupKey,
    appliedRule: selectedRegistration?.rule ?? row.appliedRule,
    style,
    confidence: top.confidence,
    source: recommendation.source === 'local' ? 'local' : 'ai',
    cacheId: recommendation.cacheId,
    provider: recommendation.provider,
    modelId: recommendation.modelId,
    shownRank: 1,
    passesGate,
    holdReason,
    message: row.isConflict
      ? '본품 후보가 여러 개입니다.'
      : passesGate
        ? null
        : '확실도가 낮아 확인이 필요합니다.',
  })
}

export function markProductNameAiCollectFailure(
  row: ProductNameAiReviewRow,
  reason: Extract<ProductNameAiHoldReason, 'no_lookup_key' | 'failed'>,
  message: string | null,
): ProductNameAiReviewRow {
  if (row.holdReason === 'exclusion_guarded') return row
  return validateProductNameAiReviewRow({
    ...row,
    style: reason === 'failed' ? row.style : null,
    passesGate: false,
    holdReason: reason,
    message,
  })
}

export function markProductNameAiDuplicates(rows: ProductNameAiReviewRow[]) {
  const rowsByKey = new Map<string, ProductNameAiReviewRow[]>()
  for (const row of rows) {
    const key = normalizeInvoiceText(row.lookupKey)
    if (!key || !row.style) continue
    const group = rowsByKey.get(key) ?? []
    group.push(row)
    rowsByKey.set(key, group)
  }
  return rows.map((row) => {
    const key = normalizeInvoiceText(row.lookupKey)
    const group = key ? rowsByKey.get(key) ?? [] : []
    const styleIds = new Set(
      group.map((item) => item.style?.styleId).filter(Boolean),
    )
    const hasConflict = styleIds.size > 1
    if (!hasConflict) {
      if (!row.lookupKeyConflict && row.holdReason !== 'duplicate') return row
      return validateProductNameAiReviewRow({
        ...row,
        lookupKeyConflict: false,
        duplicateOf: null,
        holdReason: row.isConflict
          ? 'conflict'
          : row.style
            ? row.passesGate
              ? null
              : 'low_confidence'
            : 'incomplete',
        message: row.isConflict ? '본품 후보가 여러 개입니다.' : null,
      })
    }
    const conflicting = group.find(
      (item) => item.style?.styleId !== row.style?.styleId,
    )
    return validateProductNameAiReviewRow({
      ...row,
      lookupKeyConflict: true,
      duplicateOf: conflicting?.productName ?? null,
      holdReason: 'conflict',
      message:
        '같은 등록 조회 키가 서로 다른 본품 M번호를 가리킵니다. 조회 키나 본품을 맞춰 주세요.',
    })
  })
}

export function validateProductNameAiReviewRow(
  row: ProductNameAiReviewRow,
): ProductNameAiReviewRow {
  let validationError: string | null = null
  if (row.holdReason === 'exclusion_guarded') {
    validationError = row.message
  } else if (!row.lookupKey.trim()) {
    validationError = '조회 키를 고르세요.'
  } else if (!row.style) {
    validationError = '본품 공식명칭을 완성하세요.'
  } else {
    const seen = new Set<string>([row.style.styleId])
    for (const extra of row.extras) {
      if (seen.has(extra.style.styleId)) {
        validationError = '본품과 추가 구성품의 M번호는 겹칠 수 없습니다.'
        break
      }
      seen.add(extra.style.styleId)
      if (!Number.isInteger(extra.quantity) || extra.quantity < 1) {
        validationError = '구성 수량은 1 이상이어야 합니다.'
        break
      }
    }
  }
  const holdReason =
    row.holdReason === 'exclusion_guarded'
      ? row.holdReason
      : validationError && !row.style
        ? row.holdReason ?? 'incomplete'
        : row.holdReason === 'incomplete' && row.style
          ? row.isConflict
            ? 'conflict'
            : row.duplicateOf
              ? 'duplicate'
              : row.passesGate
                ? null
                : row.holdReason
          : row.holdReason
  return {
    ...row,
    validationError,
    holdReason,
    originalSignature: row.originalSignature || productNameAiSignature(row),
  }
}

export function markProductNameAiDecisionNeeded(
  row: ProductNameAiReviewRow,
): ProductNameAiReviewRow {
  if (row.holdReason === 'exclusion_guarded') return row
  return validateProductNameAiReviewRow({
    ...row,
    holdReason: row.style ? row.holdReason ?? 'low_confidence' : 'incomplete',
    message: row.message ?? '사람이 다시 확인해야 합니다.',
  })
}

export function productNameAiRowReadyToCommit(row: ProductNameAiReviewRow) {
  return Boolean(
    row.style &&
      row.lookupKey.trim() &&
      !row.validationError &&
      !row.lookupKeyConflict &&
      row.holdReason !== 'exclusion_guarded',
  )
}

export function productNameAiReviewKind(row: ProductNameAiReviewRow): ProductNameAiReviewKind {
  if (row.holdReason === 'failed') return 'failed'
  if (
    row.holdReason &&
    row.holdReason !== 'incomplete' &&
    !productNameAiRowReadyToCommit(row)
  ) {
    return 'hold'
  }
  if (productNameAiRowReadyToCommit(row) && (!row.holdReason || row.style)) {
    if (
      row.holdReason === 'low_confidence' ||
      row.holdReason === 'conflict' ||
      row.holdReason === 'duplicate'
    ) {
      return 'hold'
    }
    return 'ready'
  }
  if (row.holdReason) return 'hold'
  return 'queue'
}

export type ProductNameAiQueueFilter = ProductNameAiReviewKind

export function productNameAiMatchesQueueFilter(
  row: ProductNameAiReviewRow,
  filter: ProductNameAiQueueFilter,
  saveFailed: boolean,
) {
  if (saveFailed) return filter === 'failed'
  if (filter === 'failed') return false
  return productNameAiReviewKind(row) === filter
}

export function formatProductNameAiStyleLabel(style: StyleRef) {
  return `${style.styleNo} · ${style.name}`
}

export function shouldIgnoreProductNameAiQuickKey(event: {
  isComposing?: boolean
  key: string
}) {
  return Boolean(event.isComposing) || event.key === 'Process'
}

export function emptyProductNameAiQuickSlot(): ProductNameAiQuickSlot {
  return {
    text: '',
    quantity: 1,
    style: null,
    status: 'empty',
    candidates: [],
    error: null,
  }
}

export function productNameAiQuickSlotsFromRow(
  row: ProductNameAiReviewRow,
): ProductNameAiQuickSlot[] {
  const main: ProductNameAiQuickSlot = row.style
    ? {
        text: formatProductNameAiStyleLabel(row.style),
        quantity: 1,
        style: row.style,
        status: 'matched',
        candidates: [],
        error: null,
      }
    : row.lookupKey || row.productName
      ? {
          text: row.style ? formatProductNameAiStyleLabel(row.style) : '',
          quantity: 1,
          style: null,
          status: row.holdReason === 'failed' || row.holdReason === 'no_product'
            ? 'unmatched'
            : 'empty',
          candidates: [],
          error: row.message,
        }
      : emptyProductNameAiQuickSlot()
  const extras = row.extras
    .slice(0, PRODUCT_NAME_AI_QUICK_SLOT_LIMIT - 1)
    .map((item) => ({
      text: formatProductNameAiStyleLabel(item.style),
      quantity: item.quantity,
      style: item.style,
      status: 'matched' as const,
      candidates: [],
      error: null,
    }))
  const slots = [main, ...extras]
  return slots.length > 0 ? slots : [emptyProductNameAiQuickSlot()]
}

export function applyProductNameAiQuickSlotText(
  slot: ProductNameAiQuickSlot,
  text: string,
): ProductNameAiQuickSlot {
  if (!text.trim()) return emptyProductNameAiQuickSlot()
  if (slot.style && text === formatProductNameAiStyleLabel(slot.style)) {
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

export function applyProductNameAiQuickSlotStyle(
  slot: ProductNameAiQuickSlot,
  style: StyleRef,
): ProductNameAiQuickSlot {
  return {
    text: formatProductNameAiStyleLabel(style),
    quantity: Math.max(1, Math.floor(slot.quantity || 1)),
    style,
    status: 'matched',
    candidates: [],
    error: null,
  }
}

export type ProductNameAiEnterDecision =
  | { status: 'ready'; style: StyleRef; extras: ProductNameAiExtra[] }
  | { status: 'needs_ai' }
  | { status: 'invalid'; reason: 'duplicate' | 'no_main' }

export function productNameAiSlotsNeedAi(slots: ProductNameAiQuickSlot[]) {
  return slots.some(
    (slot) =>
      Boolean(slot.text.trim()) &&
      (slot.status === 'draft' ||
        slot.status === 'ambiguous' ||
        slot.status === 'unmatched'),
  )
}

export function decideProductNameAiEnterAction(
  slots: ProductNameAiQuickSlot[],
): ProductNameAiEnterDecision {
  const main = slots[0]
  if (!main?.text.trim()) return { status: 'invalid', reason: 'no_main' }
  if (productNameAiSlotsNeedAi(slots)) return { status: 'needs_ai' }
  if (!main.style) return { status: 'needs_ai' }
  const extras: ProductNameAiExtra[] = []
  const seen = new Set<string>([main.style.styleId])
  for (const slot of slots.slice(1)) {
    if (!slot.text.trim()) continue
    if (!slot.style) return { status: 'needs_ai' }
    if (seen.has(slot.style.styleId)) {
      return { status: 'invalid', reason: 'duplicate' }
    }
    seen.add(slot.style.styleId)
    extras.push({
      style: slot.style,
      role: 'included',
      quantity: Math.max(1, Math.floor(slot.quantity || 1)),
    })
  }
  return { status: 'ready', style: main.style, extras }
}

export function applyProductNameAiRowSlots(
  row: ProductNameAiReviewRow,
  slots: ProductNameAiQuickSlot[],
  mode: 'edit' | 'confirm' | 'resolved',
):
  | { ok: true; row: ProductNameAiReviewRow; decision: ProductNameAiEnterDecision }
  | {
      ok: false
      error: string
      row: ProductNameAiReviewRow
      decision: ProductNameAiEnterDecision
    } {
  const decision = decideProductNameAiEnterAction(slots)
  if (decision.status === 'invalid') {
    return {
      ok: false,
      error:
        decision.reason === 'duplicate'
          ? '본품과 추가 구성품의 M번호는 겹칠 수 없습니다.'
          : '본품 이름을 입력하세요.',
      row,
      decision,
    }
  }
  if (decision.status === 'needs_ai') {
    const next = validateProductNameAiReviewRow({
      ...row,
      style: mode === 'edit' ? row.style : null,
      extras: mode === 'edit' ? row.extras : [],
      source: 'manual',
      shownRank: null,
      cacheId: null,
      holdReason: 'incomplete',
      message: 'AI 공식명칭 완성이 필요합니다.',
    })
    return { ok: true, row: next, decision }
  }
  const next = validateProductNameAiReviewRow({
    ...row,
    style: decision.style,
    extras: decision.extras,
    source: 'manual',
    shownRank: null,
    cacheId: null,
    holdReason: row.isConflict ? 'conflict' : null,
    message: null,
    passesGate: true,
  })
  if (next.validationError) {
    return { ok: false, error: next.validationError, row, decision }
  }
  return { ok: true, row: next, decision }
}

function slotCountOf(
  slotCountByKey:
    | ReadonlyMap<string, number>
    | Readonly<Record<string, number>>
    | undefined,
  rowKey: string,
) {
  if (!slotCountByKey) return 1
  const count =
    typeof (slotCountByKey as { get?: unknown }).get === 'function'
      ? (slotCountByKey as ReadonlyMap<string, number>).get(rowKey)
      : (slotCountByKey as Readonly<Record<string, number>>)[rowKey]
  return Math.max(1, count ?? 1)
}

export function nextProductNameAiQuickFocus(
  visibleKeys: string[],
  rowKey: string,
  slotIndex: number,
  direction: 'down' | 'right',
  slotCountByKey?:
    | ReadonlyMap<string, number>
    | Readonly<Record<string, number>>,
): { rowKey: string; slotIndex: number; ensureCount: number } | null {
  const rowIndex = visibleKeys.indexOf(rowKey)
  if (rowIndex < 0) return null
  if (direction === 'down') {
    const nextKey = visibleKeys[rowIndex + 1]
    if (!nextKey) return null
    const existing = slotCountOf(slotCountByKey, nextKey)
    return {
      rowKey: nextKey,
      slotIndex: Math.min(slotIndex, existing - 1),
      ensureCount: existing,
    }
  }
  if (slotIndex < PRODUCT_NAME_AI_QUICK_SLOT_LIMIT - 1) {
    return {
      rowKey,
      slotIndex: slotIndex + 1,
      ensureCount: slotIndex + 2,
    }
  }
  return nextProductNameAiQuickFocus(
    visibleKeys,
    rowKey,
    0,
    'down',
    slotCountByKey,
  )
}

export function decideProductNameAiQuickSlotMatch(
  products: AiRecommendProduct[],
  source: AiRecommendationSource,
  minConfidence: number,
  excludeStyleId?: string | null,
) {
  const filtered = products.filter((item) => item.styleId !== excludeStyleId)
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

export function decideProductNameAiSaves(
  rows: ProductNameAiReviewRow[],
): ProductNameAiSavePlan {
  const items: ProductNameAiSavePlanItem[] = []
  const skipped: ProductNameAiSavePlan['skipped'] = []
  const ownerByKey = new Map<string, string>()
  for (const row of markProductNameAiDuplicates(rows)) {
    if (!productNameAiRowReadyToCommit(row) || !row.style) {
      skipped.push({
        reviewKey: row.key,
        message:
          row.validationError ||
          row.message ||
          '본품 공식명칭이 아직 완성되지 않았습니다.',
      })
      continue
    }
    const key = normalizeInvoiceText(row.lookupKey)
    const owner = ownerByKey.get(key)
    if (!owner) ownerByKey.set(key, row.key)
    items.push({
      reviewKey: row.key,
      productName: row.productName,
      itemName: row.itemName,
      mallName: row.mallName,
      ownProductCode: row.ownProductCode,
      lookupKey: row.lookupKey,
      appliedRule: row.appliedRule,
      style: row.style,
      extras: row.extras,
      source: row.source ?? 'manual',
      cacheId: row.source === 'manual' ? null : row.cacheId,
      shownRank: row.source === 'manual' ? null : row.shownRank,
      provider: row.source === 'manual' ? null : row.provider,
      modelId: row.source === 'manual' ? null : row.modelId,
      sharesLookupKey: Boolean(owner && owner !== row.key),
    })
  }
  return { items, skipped }
}

export function reconcileProductNameAiReviewRow(
  combo: UnresolvedProductNameCombo,
  row: ProductNameAiReviewRow,
): ProductNameAiReviewRow {
  const fresh = buildProductNameAiReviewRow(combo)
  const selected =
    fresh.registrationCandidates.find(
      (candidate) =>
        normalizeInvoiceText(candidate.text) ===
        normalizeInvoiceText(row.lookupKey),
    ) ??
    pickProductNameRegistrationCandidate(
      fresh.registrationCandidates,
      row.appliedRule,
    )
  const preserveOriginalSignature = isProductNameAiReviewDirty(row)
  return validateProductNameAiReviewRow({
    ...row,
    productName: combo.productName,
    itemName: combo.itemName,
    mallName: combo.mallName,
    ownProductCode: combo.ownProductCode,
    rowCount: combo.rowCount,
    candidates: combo.candidates,
    registrationCandidates: fresh.registrationCandidates,
    lookupKey: selected?.text ?? '',
    appliedRule: selected?.rule ?? null,
    isConflict: fresh.isConflict,
    originalSignature: preserveOriginalSignature ? row.originalSignature : '',
  })
}

export function reconcileProductNameAiReviewState(options: {
  combos: UnresolvedProductNameCombo[]
  reviewRows: ProductNameAiReviewRow[]
  drafts: ReadonlyMap<string, ProductNameAiReviewRow>
  confirmedKeys: ReadonlySet<string>
  pendingAiKeys: ReadonlySet<string>
  committedKeys: ReadonlySet<string>
}) {
  const live = new Set(options.combos.map((combo) => combo.key))
  const previous = new Map(options.reviewRows.map((row) => [row.key, row]))
  const reviewRows = options.combos.map((combo) => {
    const draft = options.drafts.get(combo.key)
    if (draft) return reconcileProductNameAiReviewRow(combo, draft)
    const existing = previous.get(combo.key)
    return existing
      ? reconcileProductNameAiReviewRow(combo, existing)
      : buildProductNameAiReviewRow(combo)
  })
  const rowByKey = new Map(reviewRows.map((row) => [row.key, row]))
  const keepKeys = (set: ReadonlySet<string>) => {
    const next = new Set<string>()
    for (const key of set) {
      if (live.has(key)) next.add(key)
    }
    return next
  }
  const drafts = new Map<string, ProductNameAiReviewRow>()
  for (const [key] of options.drafts) {
    const row = rowByKey.get(key)
    if (row) drafts.set(key, row)
  }
  return {
    reviewRows,
    drafts,
    confirmedKeys: keepKeys(options.confirmedKeys),
    pendingAiKeys: keepKeys(options.pendingAiKeys),
    committedKeys: keepKeys(options.committedKeys),
  }
}

export function overlayProductNameAiDrafts(
  rows: ProductNameAiReviewRow[],
  drafts: ReadonlyMap<string, ProductNameAiReviewRow>,
) {
  return rows.map((row) => drafts.get(row.key) ?? row)
}
