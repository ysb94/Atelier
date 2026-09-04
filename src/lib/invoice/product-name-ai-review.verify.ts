/**
 * 품목명 AI 검수표 초안·키보드·공식명칭 판정 검증.
 * 실행: npm run verify:product-name-ai-review
 */
import {
  generateProductNameCandidates,
  generateProductNameRegistrationCandidates,
  similarProductSearchText,
} from '@/lib/invoice/product-name-patterns'
import {
  classifyInlineReservationShippingDateTags,
  classifyLeadingTags,
} from '@/lib/invoice/product-name-tags'
import {
  applyProductNameAiQuickSlotStyle,
  dedupeProductNameAiCombos,
  applyProductNameAiQuickSlotText,
  applyProductNameAiRecommendation,
  applyProductNameAiRowSlots,
  applyProductNameLookupKey,
  buildProductNameAiReviewRow,
  canonicalizeProductNameAiLookupKey,
  normalizeProductNameAiReviewLookupKey,
  countProductNameAiWorkflow,
  countProductNameAiPendingResolve,
  decideProductNameAiConfirmedSaves,
  decideProductNameAiEnterAction,
  decideProductNameAiQuickSlotMatch,
  decideProductNameAiRowConfirm,
  decideProductNameAiSaves,
  emptyProductNameAiQuickSlot,
  isProductNameAiSaveFailed,
  markProductNameAiDuplicates,
  clampProductNameAiReviewPage,
  expandProductNameAiExtrasToUnitSlots,
  nextProductNameAiQuickFocus,
  nextProductNameAiReviewPage,
  nextProductNameAiRowMark,
  paginateProductNameAiReviewKeys,
  PRODUCT_NAME_AI_EXTRA_DUPLICATE_MESSAGE,
  PRODUCT_NAME_AI_LOOKUP_KEY_CONFLICT_MESSAGE,
  PRODUCT_NAME_AI_MAIN_REQUIRED_MESSAGE,
  PRODUCT_NAME_AI_QUICK_SLOT_LIMIT,
  PRODUCT_NAME_AI_STYLE_REQUIRED_MESSAGE,
  countProductNameAiReviewCauses,
  findProductNameAiReviewPage,
  productNameAiCandidateSearchKeys,
  productNameAiCollectFailed,
  productNameAiReviewCause,
  productNameAiSearchKeys,
  productNameAiRowIssue,
  productNameAiRowReadyToCommit,
  productNameAiSlotsNeedAi,
  stageProductNameAiRowConfirm,
  productNameAiWorkflowTab,
  reconcileProductNameAiReviewState,
  selectLatestFailedSaveRetries,
  shouldIgnoreProductNameAiQuickKey,
  isProductNameAiAddExtraKey,
  removeProductNameAiQuickSlot,
  type ProductNameAiReviewRow,
} from '@/lib/invoice/product-name-ai-review'
import {
  giftSourceGroupKey,
  protectedGiftSourceComboKeys,
} from '@/lib/invoice/gift-source-transform'
import {
  applyProductNameExclusions,
  applyProductNameMapDelta,
  buildProductNameCandidateRowIndex,
  buildProductNameRowKeyIndex,
  catalogFromStyles,
  collectExclusionGuardedContexts,
  snapshotProductNameMaps,
  transformInvoiceProductNames,
  type ExclusionGuardedContext,
  type InvoiceProductNameTransformRow,
  type UnresolvedProductNameCombo,
} from '@/lib/invoice/product-name-transform'
import {
  buildOrderFingerprint,
  orderKeyOf,
  shipmentKeyOf,
} from '@/lib/invoice/gift-assign'
import { normalizeInvoiceText } from '@/lib/invoice/prefix-transform'
import type { SabangnetOrderRow } from '@/lib/invoice/sabangnet'
import type {
  InvoiceProductNameExclusion,
  InvoiceProductNameMap,
  InvoiceProductNameTagRoleEntry,
  StyleRef,
} from '@/lib/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function style(id: string, no: string, name: string): StyleRef {
  return { styleId: id, styleNo: no, name }
}

const tagRoles: InvoiceProductNameTagRoleEntry[] = [
  {
    id: 'tag-role-single',
    brandId: 'brand',
    tagText: '[단독]',
    normalizedTag: '[단독]',
    role: 'event_marketing',
    isActive: true,
    note: '',
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T00:00:00.000Z',
  },
]

function combo(overrides: Partial<UnresolvedProductNameCombo> = {}): UnresolvedProductNameCombo {
  const productName = overrides.productName ?? '[단독] 래빗에코백'
  const itemName = overrides.itemName ?? 'Color: 블랙'
  const candidates =
    overrides.candidates ??
    generateProductNameCandidates({
      productName,
      itemName,
      matchingProductName: '래빗에코백',
    })
  return {
    key: overrides.key ?? 'combo-1',
    mallName: overrides.mallName ?? '무신사',
    productName,
    itemName,
    ownProductCode: overrides.ownProductCode ?? '',
    rowCount: overrides.rowCount ?? 2,
    status: overrides.status ?? 'unresolved',
    appliedRule: overrides.appliedRule ?? 'product',
    appliedLookupKey: overrides.appliedLookupKey ?? productName,
    candidateStyles: overrides.candidateStyles ?? [],
    candidates,
    tags: overrides.tags ?? classifyLeadingTags(productName, tagRoles),
    itemTags: overrides.itemTags ?? [],
  }
}

const rabbit = style('s-rabbit', 'M0328', '래빗에코백 트와일라잇 블랙')
const tassel = style('s-tassel', 'M1999', '스파 트리플 블루테슬')

const tagged = buildProductNameAiReviewRow(
  combo({
    appliedLookupKey: '래빗에코백',
    appliedRule: 'product',
  }),
)
assert(
  tagged.lookupKey === '래빗에코백 Color: 블랙',
  '기본 조회 키는 품목명 + 내품명',
)
assert(tagged.appliedRule === 'product_item', '기본 등록 규칙은 품목명 + 내품명')
assert(tagged.candidates.length > 1, '태그 전·후 후보를 유지')
assert(
  tagged.registrationCandidates.length === 3 &&
    tagged.registrationCandidates.map((item) => item.rule).join(',') ===
      'product,item_full,product_item',
  '검수표 신규 등록 후보는 표준 3종만 유지',
)
assert(!productNameAiRowReadyToCommit(tagged), '본품 없으면 저장 불가')

const filled = applyProductNameAiRecommendation(
  tagged,
  {
    lookupKey: '래빗에코백',
    products: [
      {
        styleId: rabbit.styleId,
        styleNo: rabbit.styleNo,
        name: rabbit.name,
        reason: '원장',
        confidence: 0.91,
      },
    ],
    source: 'local',
    cacheId: 'cache-1',
    provider: 'openai',
    modelId: 'gpt',
    reason: '원장 추천',
  },
  0.72,
)
assert(filled.style?.styleId === rabbit.styleId, '전체 추천이 본품 초안을 채움')
assert(
  filled.lookupKey === '래빗에코백 Color: 블랙',
  '로컬 추천은 품목명 + 내품명을 유지한다',
)
assert(productNameAiRowReadyToCommit(filled), '확신 높은 추천은 저장 가능')
assert(filled.source === 'local', '수정 전 추천 출처 유지')
assert(filled.suggestedStyleId === rabbit.styleId, '최초 제안 본품을 보존')

const low = applyProductNameAiRecommendation(
  tagged,
  {
    lookupKey: '래빗에코백',
    products: [
      {
        styleId: rabbit.styleId,
        styleNo: rabbit.styleNo,
        name: rabbit.name,
        reason: '추정',
        confidence: 0.4,
      },
    ],
    source: 'ai',
    cacheId: 'cache-2',
    provider: 'openai',
    modelId: 'gpt',
    reason: '낮음',
  },
  0.72,
)
assert(low.holdReason === 'low_confidence', '저확신은 검토 필요')
assert(low.style?.styleId === rabbit.styleId, '저확신도 초안 본품은 채움')
assert(
  low.lookupKey === '래빗에코백 Color: 블랙',
  '저확신 AI는 품목명 + 내품명을 고른다',
)

const conflict = applyProductNameAiRecommendation(
  buildProductNameAiReviewRow(combo({ key: 'conflict', status: 'conflict' })),
  {
    lookupKey: '래빗에코백',
    products: [
      {
        styleId: rabbit.styleId,
        styleNo: rabbit.styleNo,
        name: rabbit.name,
        reason: '추정',
        confidence: 0.9,
      },
    ],
    source: 'ai',
    cacheId: null,
    provider: 'openai',
    modelId: 'gpt',
    reason: '',
  },
  0.72,
)
assert(conflict.holdReason === 'conflict', '충돌은 검토 필요')

const confidentAi = applyProductNameAiRecommendation(
  tagged,
  {
    lookupKey: '래빗에코백',
    products: [
      {
        styleId: rabbit.styleId,
        styleNo: rabbit.styleNo,
        name: rabbit.name,
        reason: '원장',
        confidence: 0.91,
      },
    ],
    source: 'ai',
    cacheId: 'cache-ai',
    provider: 'openai',
    modelId: 'gpt',
    reason: '고확신',
  },
  0.72,
)
assert(
  confidentAi.lookupKey === '래빗에코백' &&
    confidentAi.appliedRule === 'product',
  '고확신 AI가 품목명으로 맞추면 그 조회 키를 유지한다',
)
assert(
  normalizeProductNameAiReviewLookupKey(filled).lookupKey ===
    '래빗에코백 Color: 블랙',
  '이미 모은 로컬 행도 품목명 + 내품명으로 맞춘다',
)
assert(
  normalizeProductNameAiReviewLookupKey(confidentAi).lookupKey === '래빗에코백',
  '고확신 AI 행은 정규화해도 조회 키를 유지한다',
)

const other = applyProductNameAiRecommendation(
  buildProductNameAiReviewRow(
    combo({ key: 'combo-2', itemName: 'Color: 화이트' }),
  ),
  {
    lookupKey: '래빗에코백',
    products: [
      {
        styleId: rabbit.styleId,
        styleNo: rabbit.styleNo,
        name: rabbit.name,
        reason: '',
        confidence: 0.8,
      },
    ],
    source: 'ai',
    cacheId: null,
    provider: 'openai',
    modelId: 'gpt',
    reason: '',
  },
  0.72,
)
const duped = markProductNameAiDuplicates([filled, other])
assert(
  duped.every(
    (row) => !row.lookupKeyConflict && productNameAiRowReadyToCommit(row),
  ),
  '같은 등록 키와 같은 M번호를 공유하는 조합은 함께 저장 가능',
)

const registrationChoice = filled.registrationCandidates[1]!.text
const edited = applyProductNameLookupKey(filled, registrationChoice)
assert(edited.lookupKey === registrationChoice, '표준 등록 조회 키 수동 변경')
assert(edited.source === 'manual', '조회 키를 바꾸면 수동 출처')
assert(
  applyProductNameLookupKey(filled, filled.candidates[0]!.text).lookupKey ===
    filled.lookupKey,
  '자동 조회 전용 후보는 신규 등록 키로 직접 선택할 수 없음',
)

const prefixRow = buildProductNameAiReviewRow(
  combo({
    key: 'prefix',
    productName: '에코백',
    itemName: 'Blue / Large',
    appliedLookupKey: '에코백 Blue',
    appliedRule: 'product_item_slash_prefix',
  }),
)
assert(
  prefixRow.lookupKey === '에코백 Blue / Large' &&
    prefixRow.appliedRule === 'product_item',
  '품목명+내품명 앞부분 조회는 전체 결합 등록 키로 변환',
)
const itemPrefixRow = buildProductNameAiReviewRow(
  combo({
    key: 'item-prefix',
    productName: '에코백',
    itemName: 'Blue / Large',
    appliedLookupKey: 'Blue',
    appliedRule: 'item_slash_prefix',
  }),
)
assert(
  itemPrefixRow.lookupKey === '에코백 Blue / Large' &&
    itemPrefixRow.appliedRule === 'product_item',
  '고확신이 없으면 내품명 앞부분 조회도 품목명 + 내품명을 고른다',
)

const reservedItemName = 'Color: [9/1예약배송]트와일라잇 블랙'
const reservedItemRoles: InvoiceProductNameTagRoleEntry[] = [
  {
    id: 'tag-role-reserve',
    brandId: 'brand',
    tagText: '[8/14예약배송]',
    normalizedTag: '[8/14예약배송]',
    role: 'event_marketing',
    isActive: true,
    note: '',
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T00:00:00.000Z',
  },
]
const reservedReview = buildProductNameAiReviewRow(
  combo({
    key: 'reserved-option',
    productName: '[단독] 래빗에코백',
    itemName: reservedItemName,
    itemTags: classifyInlineReservationShippingDateTags(
      reservedItemName,
      reservedItemRoles,
    ),
  }),
)
assert(reservedReview.itemName === reservedItemName, '검수표 내품명 표시는 원문')
assert(
  reservedReview.registrationCandidates.find((item) => item.rule === 'item_full')
    ?.text === 'Color: 트와일라잇 블랙',
  '등록 내품명은 저장된 역할의 안정적인 비교값',
)
assert(
  reservedReview.registrationCandidates.find(
    (item) => item.rule === 'product_item',
  )?.text === '래빗에코백 Color: 트와일라잇 블랙',
  '등록 품목명+내품명도 정리된 옵션값을 사용',
)

const conflictingStyle = style('s-other', 'M0999', '다른 본품')
const sameKeyOther = {
  ...other,
  lookupKey: filled.lookupKey,
  appliedRule: filled.appliedRule,
  registrationCandidates: filled.registrationCandidates,
  source: 'manual' as const,
  style: conflictingStyle,
}
const keyConflicts = markProductNameAiDuplicates([filled, sameKeyOther])
assert(
  keyConflicts.every(
    (row) =>
      row.lookupKeyConflict &&
      row.holdReason === 'conflict' &&
      !productNameAiRowReadyToCommit(row),
  ),
  '같은 등록 키가 서로 다른 M번호를 가리키면 모두 검토 대상으로 차단',
)
assert(
  decideProductNameAiSaves([filled, sameKeyOther]).items.length === 0,
  '서로 다른 M번호의 등록 키 충돌은 저장 계획에서도 제외',
)

assert(
  productNameAiRowIssue(tagged)?.level === 'input' &&
    productNameAiRowIssue(tagged)?.message ===
      PRODUCT_NAME_AI_STYLE_REQUIRED_MESSAGE,
  '본품만 채우면 되는 행은 입력 대기 등급',
)
assert(
  productNameAiRowIssue(filled) === null,
  '본품이 채워지고 충돌이 없으면 경고 없음',
)
assert(
  keyConflicts.every((row) => productNameAiRowIssue(row)?.level === 'review'),
  '등록 키 충돌은 검수 중 맞추는 회색 안내',
)
assert(
  keyConflicts.every(
    (row) =>
      productNameAiRowIssue(row, PRODUCT_NAME_AI_LOOKUP_KEY_CONFLICT_MESSAGE)
        ?.level === 'review',
  ),
  'Enter로 충돌을 확인해도 빨간 오류로 올리지 않는다',
)
assert(
  keyConflicts.every((row) => !productNameAiRowReadyToCommit(row)),
  '조회 키 충돌은 준비 완료·저장을 계속 막는다',
)
const guardedIssue = productNameAiRowIssue(
  buildProductNameAiReviewRow(
    combo({ key: 'combo-guarded', status: 'exclusion_guarded' }),
  ),
)
assert(
  guardedIssue?.level === 'blocker' &&
    guardedIssue.message.includes('예외 보류'),
  '예외 보류도 차단 등급으로 표시',
)
assert(
  productNameAiRowIssue(tagged, PRODUCT_NAME_AI_MAIN_REQUIRED_MESSAGE)
    ?.level === 'input',
  '본품 칸이 비어 Enter가 막힌 것은 입력 대기 등급',
)
assert(
  productNameAiRowIssue(filled, PRODUCT_NAME_AI_EXTRA_DUPLICATE_MESSAGE)
    ?.level === 'invalid',
  '구성품 M번호 중복은 값 자체가 틀린 등급',
)
assert(
  productNameAiReviewCause(tagged) === 'awaiting_input',
  '본품 미정은 입력 대기 원인',
)
assert(
  productNameAiReviewCause(filled) === 'awaiting_confirm',
  '본품이 채워진 행은 Enter 대기 원인',
)
assert(
  keyConflicts.every(
    (row) => productNameAiReviewCause(row) === 'awaiting_confirm',
  ),
  '등록 키 충돌은 전용 원인이 아니라 Enter 대기 검수로 본다',
)
assert(
  productNameAiReviewCause(
    buildProductNameAiReviewRow(
      combo({ key: 'combo-guarded-cause', status: 'exclusion_guarded' }),
    ),
  ) === 'exclusion_guarded',
  '예외 보류 원인은 그대로 유지',
)
assert(
  productNameAiReviewCause(filled, PRODUCT_NAME_AI_EXTRA_DUPLICATE_MESSAGE) ===
    'invalid',
  '구성품 중복은 입력값 오류 원인',
)
const causeCounts = countProductNameAiReviewCauses(
  [
    tagged,
    { ...filled, key: 'combo-filled-count' },
    keyConflicts[0]!,
    buildProductNameAiReviewRow(
      combo({ key: 'combo-guarded-count', status: 'exclusion_guarded' }),
    ),
  ],
  new Map([['combo-filled-count', PRODUCT_NAME_AI_EXTRA_DUPLICATE_MESSAGE]]),
)
assert(
  causeCounts.awaiting_input === 1 &&
    causeCounts.invalid === 1 &&
    causeCounts.awaiting_confirm === 1 &&
    causeCounts.exclusion_guarded === 1,
  '원인별 건수는 겹치지 않게 센다',
)

assert(
  findProductNameAiReviewPage(['a', 'b', 'c', 'd'], 2, 'c') === 2,
  '대상 키가 있는 페이지를 찾는다',
)
assert(
  findProductNameAiReviewPage(['a', 'b'], 2, 'missing') === null,
  '없는 키는 페이지를 찾지 못한다',
)
assert(
  findProductNameAiReviewPage(['only'], 20, 'only') === 1,
  '한 페이지면 1쪽',
)

function sourceRow(input: {
  rowNumber: number
  productName: string
  itemName: string
  customerOrderNo?: string
  orderedAt?: string
  recipientName?: string
  mallName?: string
}): SabangnetOrderRow {
  return {
    rowNumber: input.rowNumber,
    productName: input.productName,
    itemName: input.itemName,
    quantity: '1',
    recipientName: input.recipientName ?? '홍길동',
    recipientPhone: '010-1111-2222',
    recipientOtherPhone: '',
    shippingType: '',
    recipientAddress: '서울',
    shippingMessage: '',
    customerOrderNo: input.customerOrderNo ?? 'ORD-1',
    mallName: input.mallName ?? '스마트스토어',
    orderedAt: input.orderedAt ?? '2026-09-01 10:00:00',
    ownProductCode: '',
  }
}

function transformRow(
  input: Parameters<typeof sourceRow>[0] & {
    status: InvoiceProductNameTransformRow['status']
  },
): InvoiceProductNameTransformRow {
  const source = sourceRow(input)
  return {
    source,
    status: input.status,
    mapId: null,
    style: null,
    transformedProductName: source.productName,
    appliedRule: input.status === 'exclusion_guarded' ? 'exclusion' : null,
    appliedLookupKey: null,
    itemNameConsumed: false,
    effectiveItemName: source.itemName,
    candidates: [],
    candidateStyles: [],
    tags: [],
    itemTags: [],
  }
}

const guardedWithSibling = collectExclusionGuardedContexts([
  transformRow({
    rowNumber: 1,
    productName: '선택안함',
    itemName: 'Tassel: 선택안함',
    status: 'exclusion_guarded',
  }),
  transformRow({
    rowNumber: 2,
    productName: '베이직파우치',
    itemName: 'Color: 블랙',
    status: 'unresolved',
  }),
])
const guardedCombo = [...guardedWithSibling.values()][0]
assert(
  guardedCombo?.orderCount === 1 &&
    guardedCombo.ordersWithoutSibling === 0 &&
    guardedCombo.siblings.length === 1 &&
    guardedCombo.siblings[0]?.productName === '베이직파우치',
  '같은 주문의 본품 후보를 형제로 모은다',
)

const guardedAlone = collectExclusionGuardedContexts([
  transformRow({
    rowNumber: 3,
    productName: '선택안함',
    itemName: 'Keyring: 선택안함',
    customerOrderNo: 'ORD-2',
    status: 'exclusion_guarded',
  }),
])
const aloneCombo = [...guardedAlone.values()][0]
assert(
  aloneCombo?.orderCount === 1 &&
    aloneCombo.ordersWithoutSibling === 1 &&
    aloneCombo.siblings.length === 0,
  '형제 없는 주문은 따로 센다',
)

function bruteForceExclusionGuardedContexts(
  rows: InvoiceProductNameTransformRow[],
): Map<string, ExclusionGuardedContext> {
  const comboKeyOf = (row: InvoiceProductNameTransformRow) =>
    [
      normalizeInvoiceText(row.source.mallName),
      normalizeInvoiceText(row.source.productName),
      normalizeInvoiceText(row.source.itemName),
    ].join('\u0000')
  const shipmentOrderKeyOf = (source: SabangnetOrderRow) =>
    `${shipmentKeyOf(source)}\u0000${orderKeyOf(source)}`
  const sharesOrder = (left: SabangnetOrderRow, right: SabangnetOrderRow) =>
    buildOrderFingerprint(left) === buildOrderFingerprint(right) ||
    shipmentOrderKeyOf(left) === shipmentOrderKeyOf(right)
  const guarded = rows.filter((row) => row.status === 'exclusion_guarded')
  if (guarded.length === 0) return new Map()
  const byCombo = new Map<string, InvoiceProductNameTransformRow[]>()
  for (const row of guarded) {
    const key = comboKeyOf(row)
    const group = byCombo.get(key) ?? []
    group.push(row)
    byCombo.set(key, group)
  }
  const result = new Map<string, ExclusionGuardedContext>()
  for (const [guardedKey, comboRows] of byCombo) {
    const orders = new Map<string, InvoiceProductNameTransformRow>()
    for (const row of comboRows) {
      const id = `${buildOrderFingerprint(row.source)}\u0001${shipmentOrderKeyOf(row.source)}`
      if (!orders.has(id)) orders.set(id, row)
    }
    const siblings = new Map<string, ExclusionGuardedContext['siblings'][number]>()
    let ordersWithoutSibling = 0
    for (const anchor of orders.values()) {
      const related = rows.filter(
        (row) =>
          comboKeyOf(row) !== guardedKey && sharesOrder(anchor.source, row.source),
      )
      if (related.length === 0) {
        ordersWithoutSibling += 1
        continue
      }
      for (const row of related) {
        const key = comboKeyOf(row)
        const current = siblings.get(key)
        if (current) {
          current.rowCount += 1
          if (
            current.status === 'mapped' ||
            current.status === 'candidate' ||
            current.status === 'excluded'
          ) {
            current.status = row.status
          }
          continue
        }
        siblings.set(key, {
          key,
          mallName: row.source.mallName,
          productName: row.source.productName,
          itemName: row.source.itemName,
          status: row.status,
          rowCount: 1,
        })
      }
    }
    result.set(guardedKey, {
      comboKey: guardedKey,
      orderCount: orders.size,
      ordersWithoutSibling,
      siblings: [...siblings.values()].sort(
        (left, right) =>
          left.productName.localeCompare(right.productName, 'ko-KR') ||
          left.itemName.localeCompare(right.itemName, 'ko-KR'),
      ),
    })
  }
  return result
}

function sameGuardedContexts(
  left: Map<string, ExclusionGuardedContext>,
  right: Map<string, ExclusionGuardedContext>,
) {
  if (left.size !== right.size) return false
  for (const [key, context] of left) {
    const other = right.get(key)
    if (
      !other ||
      other.orderCount !== context.orderCount ||
      other.ordersWithoutSibling !== context.ordersWithoutSibling ||
      JSON.stringify(other.siblings) !== JSON.stringify(context.siblings)
    ) {
      return false
    }
  }
  return true
}

const indexedGuarded = collectExclusionGuardedContexts(
  [
    transformRow({
      rowNumber: 1,
      productName: '선택안함',
      itemName: 'Tassel: 선택안함',
      status: 'exclusion_guarded',
    }),
    transformRow({
      rowNumber: 2,
      productName: '베이직파우치',
      itemName: 'Color: 블랙',
      status: 'unresolved',
    }),
  ],
  buildProductNameRowKeyIndex([
    transformRow({
      rowNumber: 1,
      productName: '선택안함',
      itemName: 'Tassel: 선택안함',
      status: 'exclusion_guarded',
    }),
    transformRow({
      rowNumber: 2,
      productName: '베이직파우치',
      itemName: 'Color: 블랙',
      status: 'unresolved',
    }),
  ]),
)
assert(
  sameGuardedContexts(indexedGuarded, guardedWithSibling) &&
    sameGuardedContexts(
      guardedWithSibling,
      bruteForceExclusionGuardedContexts([
        transformRow({
          rowNumber: 1,
          productName: '선택안함',
          itemName: 'Tassel: 선택안함',
          status: 'exclusion_guarded',
        }),
        transformRow({
          rowNumber: 2,
          productName: '베이직파우치',
          itemName: 'Color: 블랙',
          status: 'unresolved',
        }),
      ]),
    ),
  '인덱스 기반 예외 보류 형제는 기존 결과와 같다',
)

const syntheticGuardedRows: InvoiceProductNameTransformRow[] = []
for (let order = 0; order < 300; order += 1) {
  const orderNo = order % 17 === 0 ? '' : `ORD-${order}`
  const recipient = `수령${order % 11}`
  const orderedAt = `2026-09-01 10:${String(order % 60).padStart(2, '0')}:00`
  for (let combo = 0; combo < 4; combo += 1) {
    const comboIndex = (order + combo * 7) % 40
    const guarded = comboIndex < 5
    syntheticGuardedRows.push(
      transformRow({
        rowNumber: order * 4 + combo + 1,
        productName: guarded ? `선택안함-${comboIndex}` : `본품-${comboIndex}`,
        itemName: guarded ? `옵션:${comboIndex}` : `Color:${comboIndex}`,
        customerOrderNo: orderNo,
        orderedAt,
        recipientName: recipient,
        status: guarded ? 'exclusion_guarded' : 'unresolved',
      }),
    )
  }
}
const syntheticIndexed = collectExclusionGuardedContexts(
  syntheticGuardedRows,
  buildProductNameRowKeyIndex(syntheticGuardedRows),
)
assert(
  sameGuardedContexts(
    syntheticIndexed,
    bruteForceExclusionGuardedContexts(syntheticGuardedRows),
  ),
  '합성 데이터에서 인덱스 구현이 기존 형제 판정과 같다',
)

const exclusionMatch = transformInvoiceProductNames(
  [
    sourceRow({
      rowNumber: 21,
      productName: rabbit.name,
      itemName: '',
    }),
    sourceRow({
      rowNumber: 22,
      productName: '선택안함',
      itemName: 'Tassel: 선택안함',
    }),
  ],
  [],
  catalogFromStyles([rabbit]),
)
const dummyExclusion: InvoiceProductNameExclusion = {
  id: 'ex-1',
  brandId: 'brand',
  mallName: '스마트스토어',
  normalizedMallName: '스마트스토어',
  productName: '선택안함',
  normalizedProductName: '선택안함',
  itemName: 'Tassel: 선택안함',
  normalizedItemName: 'tassel: 선택안함',
  isActive: true,
  note: '',
  createdAt: '2026-09-04T00:00:00.000Z',
  updatedAt: '2026-09-04T00:00:00.000Z',
}
assert(
  applyProductNameExclusions(exclusionMatch, []) === exclusionMatch,
  '활성 예외가 없으면 같은 참조를 반환한다',
)
const overlaidExclusion = applyProductNameExclusions(
  exclusionMatch,
  [dummyExclusion],
  buildProductNameRowKeyIndex(exclusionMatch.rows),
)
assert(
  overlaidExclusion.rows[0] === exclusionMatch.rows[0] &&
    overlaidExclusion.rows[1] !== exclusionMatch.rows[1] &&
    overlaidExclusion.rows[1]?.status === 'excluded',
  '예외에 안 걸린 행은 객체 참조를 유지한다',
)
const fullExclusion = transformInvoiceProductNames(
  exclusionMatch.rows.map((row) => row.source),
  [],
  catalogFromStyles([rabbit]),
  [],
  [dummyExclusion],
)
assert(
  overlaidExclusion.rows.length === fullExclusion.rows.length &&
    overlaidExclusion.rows.every(
      (row, index) =>
        row.status === fullExclusion.rows[index]?.status &&
        row.source.rowNumber === fullExclusion.rows[index]?.source.rowNumber,
    ),
  '예외 오버레이는 전체 변환 결과와 행 단위로 같다',
)

function productMap(input: {
  id: string
  lookupKey: string
  style: StyleRef
  mallName?: string
  isActive?: boolean
  updatedAt?: string
}): InvoiceProductNameMap {
  const mallName = input.mallName ?? ''
  return {
    id: input.id,
    brandId: 'brand',
    mallName,
    normalizedMallName: normalizeInvoiceText(mallName),
    productName: input.lookupKey,
    normalizedProductName: normalizeInvoiceText(input.lookupKey),
    itemNameContext: '',
    normalizedItemNameContext: '',
    ownProductCode: '',
    normalizedOwnProductCode: '',
    lookupKey: input.lookupKey,
    normalizedLookupKey: normalizeInvoiceText(input.lookupKey),
    style: input.style,
    isActive: input.isActive ?? true,
    note: '',
    createdAt: '2026-09-04T00:00:00.000Z',
    updatedAt: input.updatedAt ?? '2026-09-04T00:00:00.000Z',
  }
}

function sameProductNameMatch(
  left: ReturnType<typeof transformInvoiceProductNames>,
  right: ReturnType<typeof transformInvoiceProductNames>,
) {
  return (
    left.mappedRowCount === right.mappedRowCount &&
    left.candidateRowCount === right.candidateRowCount &&
    left.missingStyleRowCount === right.missingStyleRowCount &&
    left.conflictRowCount === right.conflictRowCount &&
    left.unresolvedRowCount === right.unresolvedRowCount &&
    left.rows.length === right.rows.length &&
    left.rows.every((row, index) => {
      const other = right.rows[index]
      return (
        row.status === other?.status &&
        row.mapId === other.mapId &&
        row.style?.styleId === other.style?.styleId &&
        row.appliedLookupKey === other.appliedLookupKey &&
        row.transformedProductName === other.transformedProductName
      )
    })
  )
}

function applyDeltaAgainst(
  sources: SabangnetOrderRow[],
  baseMaps: InvoiceProductNameMap[],
  nextMaps: InvoiceProductNameMap[],
  styles: StyleRef[],
) {
  const catalog = catalogFromStyles(styles)
  const base = transformInvoiceProductNames(sources, baseMaps, catalog)
  return {
    base,
    delta: applyProductNameMapDelta({
      base,
      baseSnapshot: snapshotProductNameMaps(baseMaps, []),
      candidateRowIndex: buildProductNameCandidateRowIndex(base.rows),
      maps: nextMaps,
      tagRoles: [],
      catalog,
    }),
    full: transformInvoiceProductNames(sources, nextMaps, catalog),
  }
}

const deltaSources = [
  sourceRow({
    rowNumber: 31,
    productName: rabbit.name,
    itemName: '',
  }),
  sourceRow({
    rowNumber: 32,
    productName: tassel.name,
    itemName: '',
  }),
]
const fox = style('s-fox', 'M0400', '폭스에코백 블랙')
const rabbitMap = productMap({
  id: 'map-rabbit',
  lookupKey: rabbit.name,
  style: rabbit,
})
const tasselMap = productMap({
  id: 'map-tassel',
  lookupKey: tassel.name,
  style: tassel,
})
const unusedMap = productMap({
  id: 'map-unused',
  lookupKey: '완전히다른상품XYZ',
  style: fox,
})

const addedMap = applyDeltaAgainst(
  deltaSources,
  [],
  [rabbitMap],
  [rabbit, tassel, fox],
)
assert(
  sameProductNameMatch(addedMap.delta.transformation, addedMap.full) &&
    addedMap.delta.affectedRowCount === 1 &&
    addedMap.delta.transformation.rows[0]?.status === 'mapped',
  '원장 추가는 해당 행만 다시 맞추고 전체 결과와 같다',
)

const removedMap = applyDeltaAgainst(
  deltaSources,
  [rabbitMap, tasselMap],
  [tasselMap],
  [rabbit, tassel],
)
assert(
  sameProductNameMatch(removedMap.delta.transformation, removedMap.full) &&
    removedMap.delta.transformation.rows[0]?.status !== 'mapped',
  '원장 삭제는 해당 행을 풀고 전체 결과와 같다',
)

const restyledMap = applyDeltaAgainst(
  deltaSources,
  [rabbitMap],
  [
    productMap({
      id: rabbitMap.id,
      lookupKey: rabbit.name,
      style: fox,
      updatedAt: '2026-09-04T01:00:00.000Z',
    }),
  ],
  [rabbit, tassel, fox],
)
assert(
  sameProductNameMatch(restyledMap.delta.transformation, restyledMap.full) &&
    restyledMap.delta.transformation.rows[0]?.style?.styleId === fox.styleId,
  '원장 스타일 변경은 해당 행만 바꾸고 전체 결과와 같다',
)

const deactivatedMap = applyDeltaAgainst(
  deltaSources,
  [rabbitMap],
  [
    productMap({
      id: rabbitMap.id,
      lookupKey: rabbit.name,
      style: rabbit,
      isActive: false,
      updatedAt: '2026-09-04T02:00:00.000Z',
    }),
  ],
  [rabbit, tassel],
)
assert(
  sameProductNameMatch(
    deactivatedMap.delta.transformation,
    deactivatedMap.full,
  ) && deactivatedMap.delta.transformation.rows[0]?.status !== 'mapped',
  '원장 비활성화는 해당 행을 풀고 전체 결과와 같다',
)

const unusedDelta = applyDeltaAgainst(
  deltaSources,
  [rabbitMap],
  [rabbitMap, unusedMap],
  [rabbit, tassel, fox],
)
assert(
  unusedDelta.delta.transformation === unusedDelta.base &&
    unusedDelta.delta.affectedRowCount === 0,
  '파일 후보에 안 걸리는 원장만 바뀌면 같은 참조를 반환한다',
)

const mallBaseMap = productMap({
  id: 'map-any-mall',
  lookupKey: rabbit.name,
  style: rabbit,
})
const mallExactMap = productMap({
  id: 'map-store-mall',
  lookupKey: rabbit.name,
  style: fox,
  mallName: '스마트스토어',
})
const mallDelta = applyDeltaAgainst(
  [
    sourceRow({
      rowNumber: 41,
      productName: rabbit.name,
      itemName: '',
      mallName: '스마트스토어',
    }),
    sourceRow({
      rowNumber: 42,
      productName: rabbit.name,
      itemName: '',
      mallName: '무신사',
    }),
  ],
  [mallBaseMap],
  [mallBaseMap, mallExactMap],
  [rabbit, fox],
)
assert(
  sameProductNameMatch(mallDelta.delta.transformation, mallDelta.full) &&
    mallDelta.delta.transformation.rows[0]?.style?.styleId === fox.styleId &&
    mallDelta.delta.transformation.rows[1]?.style?.styleId === rabbit.styleId,
  '몰 우선 원장을 추가하면 해당 몰 행만 다른 본품으로 바뀐다',
)

const syntheticNames = [rabbit.name, tassel.name, fox.name, '미등록상품']
const syntheticSources = Array.from({ length: 12 }, (_, index) =>
  sourceRow({
    rowNumber: 50 + index,
    productName: syntheticNames[index % syntheticNames.length]!,
    itemName: '',
    mallName: index % 2 === 0 ? '스마트스토어' : '무신사',
  }),
)
const syntheticStyles = [rabbit, tassel, fox]
const syntheticMapPool = [
  productMap({ id: 'syn-1', lookupKey: rabbit.name, style: rabbit }),
  productMap({
    id: 'syn-2',
    lookupKey: tassel.name,
    style: tassel,
    mallName: '스마트스토어',
  }),
  productMap({
    id: 'syn-3',
    lookupKey: fox.name,
    style: fox,
    updatedAt: '2026-09-04T03:00:00.000Z',
  }),
  productMap({
    id: 'syn-1',
    lookupKey: rabbit.name,
    style: fox,
    updatedAt: '2026-09-04T04:00:00.000Z',
  }),
  productMap({
    id: 'syn-2',
    lookupKey: tassel.name,
    style: tassel,
    isActive: false,
    mallName: '스마트스토어',
    updatedAt: '2026-09-04T05:00:00.000Z',
  }),
]
let syntheticMaps: InvoiceProductNameMap[] = []
for (const next of [
  [syntheticMapPool[0]!],
  [syntheticMapPool[0]!, syntheticMapPool[1]!],
  [syntheticMapPool[3]!, syntheticMapPool[1]!],
  [syntheticMapPool[3]!, syntheticMapPool[4]!, syntheticMapPool[2]!],
  [syntheticMapPool[2]!],
  [],
]) {
  const compared = applyDeltaAgainst(
    syntheticSources,
    syntheticMaps,
    next,
    syntheticStyles,
  )
  assert(
    sameProductNameMatch(compared.delta.transformation, compared.full),
    '합성 원장 변경에서도 델타와 전체 재매칭이 같다',
  )
  syntheticMaps = next
}

const draftSlot = applyProductNameAiQuickSlotText(
  emptyProductNameAiQuickSlot(),
  '래빗에코백 블랙',
)
assert(draftSlot.status === 'draft', '이름 입력은 공식명칭 확인 대기')
assert(productNameAiSlotsNeedAi([draftSlot]), '대기 칸은 완성 대상')

const matchedSlot = applyProductNameAiQuickSlotStyle(draftSlot, rabbit)
assert(matchedSlot.status === 'matched', '선택하면 공식명칭으로 치환')
assert(
  applyProductNameAiQuickSlotText(matchedSlot, rabbit.name).status ===
    'matched',
  '입력칸에 상품명만 있어도 매칭을 유지',
)

assert(
  decideProductNameAiEnterAction([
    applyProductNameAiQuickSlotStyle(emptyProductNameAiQuickSlot(), rabbit),
    applyProductNameAiQuickSlotStyle(emptyProductNameAiQuickSlot(), tassel),
  ]).status === 'ready',
  '본품+구성이 완성되면 행 확정',
)
assert(
  decideProductNameAiEnterAction([
    applyProductNameAiQuickSlotStyle(emptyProductNameAiQuickSlot(), rabbit),
    applyProductNameAiQuickSlotStyle(emptyProductNameAiQuickSlot(), rabbit),
  ]).status === 'invalid',
  '본품과 구성품 중복 M번호는 막음',
)
const twoSameExtras = decideProductNameAiEnterAction([
  applyProductNameAiQuickSlotStyle(emptyProductNameAiQuickSlot(), rabbit),
  applyProductNameAiQuickSlotStyle(emptyProductNameAiQuickSlot(), tassel),
  applyProductNameAiQuickSlotStyle(emptyProductNameAiQuickSlot(), tassel),
])
assert(
  twoSameExtras.status === 'ready' &&
    twoSameExtras.extras.length === 1 &&
    twoSameExtras.extras[0]?.quantity === 2,
  '같은 구성품 두 칸은 수량 2가 아니라 1+1을 합쳐 저장한다',
)
assert(
  expandProductNameAiExtrasToUnitSlots([
    { style: tassel, role: 'included', quantity: 2 },
  ]).length === 2,
  '저장된 수량 2는 검수표에서 칸 두 개로 다시 펼친다',
)
assert(
  decideProductNameAiEnterAction([
    applyProductNameAiQuickSlotText(emptyProductNameAiQuickSlot(), '미완성'),
  ]).status === 'needs_ai',
  '이름만 있으면 공식명칭 완성 필요',
)
assert(
  decideProductNameAiEnterAction([emptyProductNameAiQuickSlot()]).status ===
    'invalid',
  '본품 칸이 비면 확정하지 않음',
)

const slotted = applyProductNameAiRowSlots(
  filled,
  [
    applyProductNameAiQuickSlotStyle(emptyProductNameAiQuickSlot(), rabbit),
    applyProductNameAiQuickSlotStyle(emptyProductNameAiQuickSlot(), tassel),
  ],
  'confirm',
)
assert(slotted.ok && slotted.row.extras.length === 1, '구성품 초안을 행에 반영')
assert(slotted.ok && slotted.row.source === 'manual', '슬롯 수정은 수동 출처')

const plan = decideProductNameAiSaves([
  slotted.ok ? slotted.row : filled,
  {
    ...other,
    lookupKey: filled.lookupKey,
    appliedRule: filled.appliedRule,
    registrationCandidates: filled.registrationCandidates,
    source: 'manual' as const,
    style: rabbit,
    extras: [{ style: tassel, role: 'included', quantity: 1 }],
    holdReason: null,
    validationError: null,
  } satisfies ProductNameAiReviewRow,
  tagged,
])
assert(plan.items.length === 2, '저장 가능한 초안만 등록 대상')
assert(plan.skipped.length === 1, '미완성 행은 제외하고 안내')
assert(
  plan.items.some((item) => item.sharesLookupKey) &&
    plan.items.every((item) => item.extras.length === 1),
  '조회 키는 합치되 조합별 구성품은 보존',
)
assert(
  plan.items.every(
    (item) =>
      item.mallName.length > 0 &&
      item.productName.length > 0 &&
      item.extras.length === 1,
  ) &&
    new Set(
      plan.items.map(
        (item) =>
          `${item.mallName}\u0000${item.productName}\u0000${item.itemName}`,
      ),
    ).size === plan.items.length,
  '1:N 저장은 쇼핑몰·품목명·내품명 조합별로 구성품을 유지한다',
)

assert(
  nextProductNameAiReviewPage(1, 3, ['a', 'b'], 'b') === 2,
  '페이지 마지막 행 Enter는 다음 페이지',
)
assert(
  nextProductNameAiReviewPage(1, 3, ['a', 'b'], 'a') === null,
  '중간 행 Enter는 페이지를 바꾸지 않는다',
)
assert(
  nextProductNameAiReviewPage(3, 3, ['a', 'b'], 'b') === null,
  '마지막 페이지에서는 더 이상 넘기지 않는다',
)
assert(
  clampProductNameAiReviewPage(9, 2) === 2,
  '필터로 페이지가 줄면 마지막 페이지로 보정한다',
)
assert(
  paginateProductNameAiReviewKeys(['a', 'b', 'c'], 2, 2).keys.join(',') === 'c',
  '2페이지는 남은 행만 보여 준다',
)
assert(
  paginateProductNameAiReviewKeys(['a', 'b', 'c'], 4, 2).page === 2,
  '없는 페이지는 마지막 페이지로 되돌린다',
)
const down = nextProductNameAiQuickFocus(['a', 'b'], 'a', 0, 'down')
assert(down?.rowKey === 'b' && down.slotIndex === 0, 'Enter는 다음 행 같은 칸')
const right = nextProductNameAiQuickFocus(['a', 'b'], 'a', 0, 'right')
assert(
  right?.rowKey === 'a' && right.slotIndex === 1 && right.ensureCount === 2,
  'Tab은 같은 행 다음 구성 칸을 만듦',
)
const wrap = nextProductNameAiQuickFocus(
  ['a', 'b'],
  'a',
  PRODUCT_NAME_AI_QUICK_SLOT_LIMIT - 1,
  'right',
)
assert(wrap?.rowKey === 'b', '마지막 칸 Tab은 다음 행으로')
assert(
  shouldIgnoreProductNameAiQuickKey({ isComposing: true, key: 'Enter' }),
  '한글 조합 중 Enter는 무시',
)
assert(
  shouldIgnoreProductNameAiQuickKey({ key: 'Process' }),
  '한글 조합 Process 키는 무시',
)
assert(
  !shouldIgnoreProductNameAiQuickKey({ key: 'Enter' }),
  '완성된 Enter는 다음 행으로 이동',
)
assert(
  !shouldIgnoreProductNameAiQuickKey({ key: 'Tab' }),
  '완성된 Tab은 다음 구성 칸으로 이동',
)
assert(
  isProductNameAiAddExtraKey({ key: '+' }),
  '이름 칸 + 는 구성품 칸을 추가한다',
)
assert(
  isProductNameAiAddExtraKey({ key: 'Add' }),
  '숫자패드 + 도 구성품 칸을 추가한다',
)
assert(
  !isProductNameAiAddExtraKey({ key: '+', isComposing: true }),
  '한글 조합 중 + 는 글자로 남긴다',
)
assert(
  !isProductNameAiAddExtraKey({ key: '+', ctrlKey: true }),
  'Ctrl+Plus는 구성품 추가가 아니다',
)
const extraSlots = [
  emptyProductNameAiQuickSlot(),
  emptyProductNameAiQuickSlot(),
  emptyProductNameAiQuickSlot(),
]
assert(
  removeProductNameAiQuickSlot(extraSlots, 1).length === 2,
  '추가 구성품 칸은 지울 수 있다',
)
assert(
  removeProductNameAiQuickSlot(extraSlots, 0).length === 3,
  '본품 칸은 휴지통으로 지우지 않는다',
)

assert(
  decideProductNameAiQuickSlotMatch(
    [
      {
        styleId: rabbit.styleId,
        styleNo: rabbit.styleNo,
        name: rabbit.name,
        reason: '',
        confidence: 0.9,
      },
    ],
    'ai',
    0.72,
  ).status === 'matched',
  '확신 높은 단독 후보는 자동 완성',
)
assert(
  decideProductNameAiQuickSlotMatch(
    [
      {
        styleId: rabbit.styleId,
        styleNo: rabbit.styleNo,
        name: rabbit.name,
        reason: '',
        confidence: 0.8,
      },
      {
        styleId: tassel.styleId,
        styleNo: tassel.styleNo,
        name: tassel.name,
        reason: '',
        confidence: 0.78,
      },
    ],
    'ai',
    0.72,
  ).status === 'ambiguous',
  '가까운 후보가 여럿이면 사람이 고름',
)
assert(
  decideProductNameAiQuickSlotMatch([], 'ai', 0.72).status === 'unmatched',
  '못 찾으면 직접 검색',
)
assert(
  decideProductNameAiQuickSlotMatch(
    [
      {
        styleId: rabbit.styleId,
        styleNo: rabbit.styleNo,
        name: rabbit.name,
        reason: '',
        confidence: 0.9,
      },
    ],
    'manual',
    0.72,
  ).status === 'unmatched',
  '수동 확인 결과는 자동 완성하지 않음',
)

assert(
  similarProductSearchText('Strap pouch _ 오렌지퍼플믹스') === 'Strap pouch',
  '비슷한 상품 검색은 구분자 앞부분만 남긴다',
)
assert(
  similarProductSearchText('마스마룰즈 브리즈 리본 더플백') ===
    '마스마룰즈 브리즈 리본 더플백',
  '구분자가 없으면 조회 키를 그대로 쓴다',
)
assert(
  similarProductSearchText('A_블랙') === 'A_블랙',
  '앞부분이 두 글자 미만이면 원본을 유지한다',
)
assert(
  similarProductSearchText('Color: beige') === 'Color',
  '콜론 앞부분도 같은 규칙으로 자른다',
)

assert(
  productNameAiWorkflowTab({
    confirmed: false,
    saveFailed: false,
    readyToCommit: productNameAiRowReadyToCommit(filled),
  }) === 'review',
  'AI 추천 결과는 공식 M번호가 있어도 작업자 Enter 전에는 검토 필요',
)
assert(
  productNameAiCollectFailed({ ...tagged, holdReason: 'failed' }) &&
    productNameAiCollectFailed({ ...tagged, holdReason: 'no_product' }),
  '수집 실패와 후보 없음은 검토 필요에서 재시도한다',
)
assert(
  !isProductNameAiSaveFailed('undo_failed') &&
    !isProductNameAiSaveFailed('ok') &&
    isProductNameAiSaveFailed('failed'),
  '저장 실패 탭은 최신 이력이 failed인 행만 포함한다',
)

const editedConfirm = applyProductNameAiRowSlots(
  filled,
  [applyProductNameAiQuickSlotText(emptyProductNameAiQuickSlot(), '래빗에코백 블랙')],
  'confirm',
)
assert(
  editedConfirm.ok &&
    editedConfirm.decision.status === 'needs_ai' &&
    !productNameAiRowReadyToCommit(editedConfirm.row) &&
    productNameAiWorkflowTab({
      confirmed: false,
      saveFailed: false,
      readyToCommit: productNameAiRowReadyToCommit(editedConfirm.row),
    }) === 'review',
  '수정값 Enter는 AI 완성 대기만 만들며 준비 완료가 아니다',
)

const resolvedOfficial = applyProductNameAiRowSlots(
  editedConfirm.ok ? editedConfirm.row : filled,
  [applyProductNameAiQuickSlotStyle(emptyProductNameAiQuickSlot(), rabbit)],
  'resolved',
)
assert(
  resolvedOfficial.ok &&
    resolvedOfficial.decision.status === 'ready' &&
    productNameAiRowReadyToCommit(resolvedOfficial.row) &&
    productNameAiWorkflowTab({
      confirmed: false,
      saveFailed: false,
      readyToCommit: true,
    }) === 'review',
  'AI 공식명칭 완성 후에도 다시 Enter하기 전에는 검토 필요',
)
assert(
  nextProductNameAiRowMark('confirm', 'needs_ai') === 'pending_ai' &&
    nextProductNameAiRowMark('resolved', 'ready') === 'keep' &&
    nextProductNameAiRowMark('edit', 'ready') === 'unconfirm',
  'Enter 표시는 공식명칭 완성 후에도 유지하고 칸을 고치면 푼다',
)
assert(
  countProductNameAiPendingResolve(
    new Set(['needs-ai', 'filled']),
    new Map([
      [
        'needs-ai',
        [
          applyProductNameAiQuickSlotText(
            emptyProductNameAiQuickSlot(),
            '미완성',
          ),
        ],
      ],
      [
        'filled',
        [applyProductNameAiQuickSlotStyle(emptyProductNameAiQuickSlot(), rabbit)],
      ],
    ]),
  ) === 1,
  '공식명칭이 채워진 행은 완성 버튼 개수에서 뺀다',
)
assert(
  productNameAiWorkflowTab({
    confirmed: true,
    saveFailed: false,
    readyToCommit: true,
  }) === 'ready',
  '작업자가 Enter로 확인하면 준비 완료',
)

const officialSlot = [
  applyProductNameAiQuickSlotStyle(emptyProductNameAiQuickSlot(), rabbit),
]
const confirmAfterOfficial = applyProductNameAiRowSlots(
  resolvedOfficial.row,
  officialSlot,
  'confirm',
)
assert(
  confirmAfterOfficial.ok &&
    confirmAfterOfficial.decision.status === 'ready' &&
    productNameAiRowReadyToCommit(confirmAfterOfficial.row),
  '공식명칭 완성 후 Enter는 최신 행을 준비 완료로 만든다',
)
const stagedReady = stageProductNameAiRowConfirm({
  row: resolvedOfficial.row,
  slots: officialSlot,
  mode: 'confirm',
})
assert(
  stagedReady.ok &&
    stagedReady.confirmed &&
    stagedReady.mark === 'confirmed' &&
    !stagedReady.error &&
    productNameAiWorkflowTab({
      confirmed: stagedReady.confirmed,
      saveFailed: false,
      readyToCommit: productNameAiRowReadyToCommit(stagedReady.row),
    }) === 'ready',
  '이름 수정 → AI 완성 → Enter 전이가 준비 완료 집계로 이어진다',
)
assert(
  decideProductNameAiRowConfirm({
    mode: 'confirm',
    decision: { status: 'ready', style: rabbit, extras: [] },
    row: resolvedOfficial.row,
  }).confirmed,
  '최신 행이 준비되면 확정 마킹은 한 곳에서만 결정한다',
)

const stagedConflict = stageProductNameAiRowConfirm({
  row: resolvedOfficial.row,
  slots: officialSlot,
  mode: 'confirm',
  siblings: [
    resolvedOfficial.row,
    {
      ...sameKeyOther,
      key: 'conflict-sibling',
      lookupKey: resolvedOfficial.row.lookupKey,
    },
  ],
})
assert(
  stagedConflict.ok &&
    stagedConflict.confirmed &&
    stagedConflict.mark === 'confirmed' &&
    !stagedConflict.error &&
    !stagedConflict.row.lookupKeyConflict &&
    stagedConflict.affectedKeys.length === 2 &&
    stagedConflict.readyKeys.length === 2 &&
    stagedConflict.propagatedRows.every(
      (row) =>
        row.style?.styleId === rabbit.styleId &&
        productNameAiRowReadyToCommit(row),
    ) &&
    productNameAiWorkflowTab({
      confirmed: stagedConflict.confirmed,
      saveFailed: false,
      readyToCommit: productNameAiRowReadyToCommit(stagedConflict.row),
    }) === 'ready',
  '조회 키 충돌에서 Enter로 고른 M번호를 같은 키 전체에 전파한다',
)
const propagatedPlan = decideProductNameAiSaves(
  stagedConflict.propagatedRows,
)
assert(
  propagatedPlan.items.length === 2 &&
    propagatedPlan.items.filter((item) => item.sharesLookupKey).length === 1 &&
    propagatedPlan.skipped.length === 0,
  '전파된 행은 같은 조회 키 원장을 공유하면서 모두 저장 대상이 된다',
)
const differentLookup = {
  ...sameKeyOther,
  key: 'different-lookup',
  lookupKey: '다른 등록 조회 키',
}
const duplicateExtra = {
  ...sameKeyOther,
  key: 'duplicate-extra',
  extras: [
    {
      style: rabbit,
      role: 'included' as const,
      quantity: 1,
    },
  ],
}
const edgeCanonicalized = canonicalizeProductNameAiLookupKey({
  rows: [resolvedOfficial.row, differentLookup, duplicateExtra],
  confirmedRow: resolvedOfficial.row,
})
assert(
  edgeCanonicalized.affectedKeys.length === 2 &&
    edgeCanonicalized.readyKeys.length === 1 &&
    edgeCanonicalized.blockedKeys[0] === duplicateExtra.key &&
    edgeCanonicalized.rows.find((row) => row.key === differentLookup.key)?.style
      ?.styleId === conflictingStyle.styleId,
  '다른 조회 키는 건드리지 않고 실제 구성 중복 행만 검토에 남긴다',
)
const guardedCanonicalRow = {
  ...buildProductNameAiReviewRow(
    combo({ key: 'canonical-guarded', status: 'exclusion_guarded' }),
  ),
  lookupKey: resolvedOfficial.row.lookupKey,
  style: conflictingStyle,
}
const guardedCanonicalized = canonicalizeProductNameAiLookupKey({
  rows: [resolvedOfficial.row, guardedCanonicalRow],
  confirmedRow: resolvedOfficial.row,
})
assert(
  guardedCanonicalized.affectedKeys.length === 1 &&
    guardedCanonicalized.rows.find(
      (row) => row.key === guardedCanonicalRow.key,
    )?.style?.styleId === conflictingStyle.styleId,
  '예외 보류 행은 같은 조회 키 확정 전파에서 제외한다',
)
const protectedCanonicalized = canonicalizeProductNameAiLookupKey({
  rows: [resolvedOfficial.row, sameKeyOther],
  confirmedRow: resolvedOfficial.row,
  excludedKeys: new Set([sameKeyOther.key]),
})
assert(
  protectedCanonicalized.affectedKeys.length === 1 &&
    protectedCanonicalized.readyKeys[0] === resolvedOfficial.row.key &&
    protectedCanonicalized.rows.find((row) => row.key === sameKeyOther.key)
      ?.style?.styleId === conflictingStyle.styleId,
  '사은품 보호 행은 전파와 충돌 판정에서 제외한다',
)
const markedExcluded = markProductNameAiDuplicates(
  [filled, sameKeyOther],
  new Set([sameKeyOther.key]),
)
assert(
  markedExcluded.every((row) => !row.lookupKeyConflict) &&
    markedExcluded.find((row) => row.key === sameKeyOther.key)?.style
      ?.styleId === conflictingStyle.styleId,
  '제외 행은 충돌 표시를 받지 않고 그대로 반환한다',
)
const stagedEditDraft = stageProductNameAiRowConfirm({
  row: resolvedOfficial.row,
  slots: officialSlot,
  mode: 'edit',
  siblings: [
    resolvedOfficial.row,
    {
      ...sameKeyOther,
      key: 'edit-conflict-sibling',
      lookupKey: resolvedOfficial.row.lookupKey,
    },
  ],
})
assert(
  stagedEditDraft.affectedKeys.length === 0 &&
    stagedEditDraft.propagatedRows.length === 0 &&
    !stagedEditDraft.draftRow.lookupKeyConflict &&
    stagedEditDraft.draftRow.holdReason !== 'conflict',
  '비전파 편집 초안은 충돌 플래그를 갖지 않는다',
)
const giftProtectedRow = {
  ...sameKeyOther,
  key: 'gift-protected-combo',
  mallName: '카카오톡선물하기',
  productName: '[브로콜리 증정] 래빗에코백',
  lookupKey: resolvedOfficial.row.lookupKey,
}
const giftGroupKeys = new Set([
  giftSourceGroupKey(giftProtectedRow.mallName, giftProtectedRow.productName),
])
const convertedGiftKeys = protectedGiftSourceComboKeys(
  [resolvedOfficial.row, giftProtectedRow],
  giftGroupKeys,
)
assert(
  convertedGiftKeys.has(giftProtectedRow.key) &&
    !convertedGiftKeys.has(resolvedOfficial.row.key) &&
    ![...giftGroupKeys].some((key) => convertedGiftKeys.has(key)),
  '사은품 그룹 키로 보호된 조합을 검수 행 키 집합으로 바꾼다',
)
const convertedCanonicalized = canonicalizeProductNameAiLookupKey({
  rows: [resolvedOfficial.row, giftProtectedRow],
  confirmedRow: resolvedOfficial.row,
  excludedKeys: convertedGiftKeys,
})
assert(
  convertedCanonicalized.affectedKeys.length === 1 &&
    convertedCanonicalized.rows.find((row) => row.key === giftProtectedRow.key)
      ?.style?.styleId === conflictingStyle.styleId,
  '변환된 행 키로 보호된 사은품은 전파·충돌 계산에서 빠진다',
)

const stagedInvalid = stageProductNameAiRowConfirm({
  row: filled,
  slots: [emptyProductNameAiQuickSlot()],
  mode: 'confirm',
})
assert(
  !stagedInvalid.ok &&
    !stagedInvalid.confirmed &&
    stagedInvalid.mark === 'unconfirm' &&
    stagedInvalid.error === '본품 이름을 입력하세요.',
  '검증 실패는 현재 행에 오류를 남긴다',
)

const unconfirmedPlan = decideProductNameAiConfirmedSaves(
  [filled, other],
  new Set(),
)
assert(
  unconfirmedPlan.items.length === 0,
  '확인되지 않은 행은 저장 계획에서 제외된다',
)
const partialConfirmPlan = decideProductNameAiConfirmedSaves(
  [filled, other],
  new Set([filled.key]),
)
assert(
  partialConfirmPlan.items.length === 1 &&
    partialConfirmPlan.items[0]?.reviewKey === filled.key,
  '확인된 행만 저장 계획에 넣는다',
)
const leftoverReview = countProductNameAiWorkflow({
  rows: [filled, other],
  confirmedKeys: new Set([filled.key]),
  saveFailedKeys: new Set(),
})
assert(
  leftoverReview.reviewCount === 1 && leftoverReview.readyCount === 1,
  '검토 필요가 남아도 준비 완료 건수는 따로 센다',
)
const allReady = countProductNameAiWorkflow({
  rows: [filled, other],
  confirmedKeys: new Set([filled.key, other.key]),
  saveFailedKeys: new Set(),
})
assert(
  allReady.reviewCount === 0 && allReady.readyCount === 2,
  '모든 행을 확인하면 일괄 등록할 수 있다',
)
assert(
  productNameAiWorkflowTab({
    confirmed: true,
    saveFailed: true,
    readyToCommit: true,
  }) === 'failed',
  '최신 저장 실패는 준비 완료보다 저장 실패 탭이 우선한다',
)

const saveRetries = selectLatestFailedSaveRetries([
  { comboKey: 'a', status: 'failed' },
  { comboKey: 'a', status: 'ok' },
  { comboKey: 'b', status: 'undo_failed' },
  { comboKey: 'c', status: 'ok' },
  { comboKey: 'd', status: 'failed' },
])
assert(
  saveRetries.map((entry) => entry.comboKey).join(',') === 'a,d',
  '저장 실패 재시도는 최신 이력이 failed인 행만 대상으로 한다',
)

const corrected = decideProductNameAiSaves([
  {
    ...filled,
    style: tassel,
    source: 'manual',
  },
])
assert(
  corrected.items[0]?.suggestedStyleId === rabbit.styleId &&
    corrected.items[0]?.outcome === 'corrected',
  '최초 제안과 다른 본품은 corrected로 저장한다',
)
assert(
  decideProductNameAiSaves([filled]).items[0]?.outcome === 'confirmed',
  '같은 본품을 채택하면 confirmed로 저장한다',
)

const comboBase = {
  mallName: '테스트몰',
  productName: '울 코트',
  itemName: '블랙 / M',
  ownProductCode: '',
  rowCount: 1,
  status: 'unresolved' as const,
  appliedRule: null,
  appliedLookupKey: null,
  candidateStyles: [],
  candidates: [],
  tags: [],
  itemTags: [],
}
const deduped = dedupeProductNameAiCombos([
  { ...comboBase, key: 'row-1' },
  { ...comboBase, key: 'row-2' },
  { ...comboBase, key: 'row-3', itemName: '블랙 / L' },
])
assert(deduped.requests.length === 2, '같은 문맥만 한 번 수집한다')
assert(
  (deduped.mirrors.get('row-1') ?? []).join(',') === 'row-2',
  '같은 문맥 행을 미러로 붙인다',
)

const breezeProduct =
  '[단독선발매] [8/26예약배송]마스마룰즈 브리즈 리본 더플백 3컬러'
const breezeClean = '마스마룰즈 브리즈 리본 더플백 3컬러'
const beigeRow = {
  candidates: generateProductNameCandidates({
    productName: breezeProduct,
    itemName: 'COLORS: 펄 베이지',
    matchingProductName: breezeClean,
  }),
  registrationCandidates: generateProductNameRegistrationCandidates({
    productName: breezeClean,
    itemName: 'COLORS: 펄 베이지',
  }),
}
const beigeSearch = productNameAiSearchKeys(beigeRow)
const beigeCandidate = productNameAiCandidateSearchKeys(beigeRow)
assert(
  beigeSearch.includes('COLORS: 펄 베이지'),
  '옵션 단독은 조회·등록 키에 남긴다',
)
assert(
  !beigeCandidate.includes('COLORS: 펄 베이지'),
  '옵션 단독은 퍼지 후보 검색에서 뺀다',
)
assert(
  beigeCandidate.some((key) => key.includes('브리즈 리본 더플백') && key.includes('펄 베이지')),
  '품목명+옵션은 퍼지 후보 검색에 남긴다',
)

const pinkRow = {
  candidates: generateProductNameCandidates({
    productName: breezeProduct,
    itemName: 'COLORS: 파우더 핑크',
    matchingProductName: breezeClean,
  }),
  registrationCandidates: generateProductNameRegistrationCandidates({
    productName: breezeClean,
    itemName: 'COLORS: 파우더 핑크',
  }),
}
const pinkCandidate = productNameAiCandidateSearchKeys(pinkRow)
assert(
  !pinkCandidate.includes('COLORS: 파우더 핑크'),
  '핑크 옵션 단독도 퍼지 후보 검색에서 뺀다',
)
assert(
  pinkCandidate.some((key) => key.includes('브리즈 리본 더플백') && key.includes('파우더 핑크')),
  '핑크 품목명+옵션은 퍼지 후보 검색에 남긴다',
)

const itemOnlyRow = {
  candidates: [
    { text: 'COLORS: 펄 베이지', rule: 'item_full' },
  ],
  registrationCandidates: [
    { text: 'COLORS: 펄 베이지', rule: 'item_full' },
  ],
}
assert(
  productNameAiCandidateSearchKeys(itemOnlyRow).join('|') ===
    productNameAiSearchKeys(itemOnlyRow).join('|'),
  '품목 문맥 키가 없으면 기존 전체 키를 쓴다',
)

const savedCombo = combo({ key: 'saved-combo', itemName: 'Color: 블랙' })
const openCombo = combo({ key: 'open-combo', itemName: 'Color: 화이트' })
const savedAi = applyProductNameAiRecommendation(
  buildProductNameAiReviewRow(savedCombo),
  {
    lookupKey: '래빗에코백',
    products: [
      {
        styleId: rabbit.styleId,
        styleNo: rabbit.styleNo,
        name: rabbit.name,
        reason: '원장',
        confidence: 0.91,
      },
    ],
    source: 'ai',
    cacheId: 'cache-saved',
    provider: 'openai',
    modelId: 'gpt',
    reason: '고확신',
  },
  0.72,
)
const openAi = applyProductNameAiRecommendation(
  buildProductNameAiReviewRow(openCombo),
  {
    lookupKey: '래빗에코백',
    products: [
      {
        styleId: rabbit.styleId,
        styleNo: rabbit.styleNo,
        name: rabbit.name,
        reason: '원장',
        confidence: 0.88,
      },
    ],
    source: 'ai',
    cacheId: 'cache-open',
    provider: 'openai',
    modelId: 'gpt',
    reason: '고확신',
  },
  0.72,
)
const openEdited = applyProductNameLookupKey(
  openAi,
  openAi.registrationCandidates[1]!.text,
)
const afterPartialSave = reconcileProductNameAiReviewState({
  combos: [openCombo],
  reviewRows: [savedAi, openAi],
  drafts: new Map([[openCombo.key, openEdited]]),
  confirmedKeys: new Set([openCombo.key]),
  pendingAiKeys: new Set(),
  committedKeys: new Set([savedCombo.key]),
})
assert(afterPartialSave.reviewRows.length === 1, '저장한 행은 검토표에서 뺀다')
assert(
  afterPartialSave.reviewRows[0]?.key === openCombo.key,
  '미저장 행은 검토표에 남긴다',
)
assert(
  afterPartialSave.reviewRows[0]?.lookupKey === openEdited.lookupKey,
  '미저장 행의 수정 조회 키를 유지한다',
)
assert(
  afterPartialSave.reviewRows[0]?.source === 'manual',
  '미저장 행의 수동 수정 출처를 유지한다',
)
assert(
  afterPartialSave.reviewRows[0]?.style?.styleId === rabbit.styleId,
  '미저장 행의 AI 추천 본품을 유지한다',
)
assert(
  afterPartialSave.confirmedKeys.has(openCombo.key),
  '미저장 행의 확정 상태를 유지한다',
)
assert(
  !afterPartialSave.committedKeys.has(savedCombo.key),
  '저장한 행의 확정 대기 키는 제거한다',
)

const staleKeep = combo({ key: 'keep-live', itemName: 'Color: 유지' })
const staleGoneA = combo({ key: 'stale-a', itemName: 'Color: 삭제A' })
const staleGoneB = combo({ key: 'stale-b', itemName: 'Color: 삭제B' })
const freshCombo = combo({ key: 'fresh-live', itemName: 'Color: 신규' })
const snapshotShrink = reconcileProductNameAiReviewState({
  combos: [staleKeep, freshCombo],
  reviewRows: [
    buildProductNameAiReviewRow(staleGoneA),
    buildProductNameAiReviewRow(staleGoneB),
    buildProductNameAiReviewRow(staleKeep),
  ],
  drafts: new Map(),
  confirmedKeys: new Set([staleGoneA.key, staleKeep.key]),
  pendingAiKeys: new Set([staleGoneB.key]),
  committedKeys: new Set([staleGoneA.key]),
})
assert(snapshotShrink.reviewRows.length === 2, '수집 스냅숏은 살아 있는 조합만 남긴다')
assert(
  snapshotShrink.reviewRows.map((row) => row.key).sort().join(',') ===
    [freshCombo.key, staleKeep.key].sort().join(','),
  '사라진 키는 빼고 새 조합은 초안으로 넣는다',
)
assert(
  snapshotShrink.reviewRows.find((row) => row.key === freshCombo.key)
    ?.holdReason === 'incomplete',
  '새 조합은 incomplete 초안이다',
)
assert(
  snapshotShrink.confirmedKeys.has(staleKeep.key) &&
    !snapshotShrink.confirmedKeys.has(staleGoneA.key) &&
    !snapshotShrink.pendingAiKeys.has(staleGoneB.key) &&
    !snapshotShrink.committedKeys.has(staleGoneA.key),
  '사라진 키의 확정·대기 표시는 제거한다',
)
assert(
  countProductNameAiWorkflow({
    rows: snapshotShrink.reviewRows,
    confirmedKeys: snapshotShrink.confirmedKeys,
    saveFailedKeys: new Set(),
  }).reviewCount === 2,
  '살아 있는 조합만 검토 필요로 센다',
)

console.log('product-name-ai-review verify: ok')
