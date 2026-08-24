/**
 * 품목명 AI 검수표 초안·키보드·공식명칭 판정 검증.
 * 실행: npm run verify:product-name-ai-review
 */
import { generateProductNameCandidates } from '@/lib/invoice/product-name-patterns'
import { classifyLeadingTags } from '@/lib/invoice/product-name-tags'
import {
  applyProductNameAiQuickSlotStyle,
  applyProductNameAiQuickSlotText,
  applyProductNameAiRecommendation,
  applyProductNameAiRowSlots,
  applyProductNameLookupKey,
  buildProductNameAiReviewRow,
  decideProductNameAiEnterAction,
  decideProductNameAiQuickSlotMatch,
  decideProductNameAiSaves,
  emptyProductNameAiQuickSlot,
  markProductNameAiDuplicates,
  nextProductNameAiQuickFocus,
  productNameAiRowReadyToCommit,
  productNameAiSlotsNeedAi,
  shouldIgnoreProductNameAiQuickKey,
  type ProductNameAiReviewRow,
} from '@/lib/invoice/product-name-ai-review'
import type { UnresolvedProductNameCombo } from '@/lib/invoice/product-name-transform'
import type { InvoiceProductNameTagRoleEntry, StyleRef } from '@/lib/types'

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
assert(tagged.lookupKey === '래빗에코백', '기본 조회 키는 맞춘 후보 텍스트')
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
assert(productNameAiRowReadyToCommit(filled), '확신 높은 추천은 저장 가능')
assert(filled.source === 'local', '수정 전 추천 출처 유지')

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
  itemPrefixRow.lookupKey === 'Blue / Large' &&
    itemPrefixRow.appliedRule === 'item_full',
  '내품명 앞부분 조회는 내품명 전체 등록 키로 변환',
)

const conflictingStyle = style('s-other', 'M0999', '다른 본품')
const keyConflicts = markProductNameAiDuplicates([
  filled,
  { ...other, style: conflictingStyle },
])
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
  decideProductNameAiSaves([
    filled,
    { ...other, style: conflictingStyle },
  ]).items.length === 0,
  '서로 다른 M번호의 등록 키 충돌은 저장 계획에서도 제외',
)

const draftSlot = applyProductNameAiQuickSlotText(
  emptyProductNameAiQuickSlot(),
  '래빗에코백 블랙',
)
assert(draftSlot.status === 'draft', '이름 입력은 공식명칭 확인 대기')
assert(productNameAiSlotsNeedAi([draftSlot]), '대기 칸은 완성 대상')

const matchedSlot = applyProductNameAiQuickSlotStyle(draftSlot, rabbit)
assert(matchedSlot.status === 'matched', '선택하면 공식명칭으로 치환')

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

const down = nextProductNameAiQuickFocus(['a', 'b'], 'a', 0, 'down')
assert(down?.rowKey === 'b' && down.slotIndex === 0, 'Enter는 다음 행 같은 칸')
const right = nextProductNameAiQuickFocus(['a', 'b'], 'a', 0, 'right')
assert(
  right?.rowKey === 'a' && right.slotIndex === 1 && right.ensureCount === 2,
  'Tab은 같은 행 다음 구성 칸을 만듦',
)
const wrap = nextProductNameAiQuickFocus(['a', 'b'], 'a', 2, 'right')
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

console.log('product-name-ai-review verify: ok')
