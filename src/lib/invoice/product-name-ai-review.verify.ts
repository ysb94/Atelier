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
  normalizeProductNameAiReviewLookupKey,
  countProductNameAiWorkflow,
  countProductNameAiPendingResolve,
  decideProductNameAiConfirmedSaves,
  decideProductNameAiEnterAction,
  decideProductNameAiQuickSlotMatch,
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
  PRODUCT_NAME_AI_QUICK_SLOT_LIMIT,
  productNameAiCandidateSearchKeys,
  productNameAiCollectFailed,
  productNameAiSearchKeys,
  productNameAiRowReadyToCommit,
  productNameAiSlotsNeedAi,
  productNameAiWorkflowTab,
  reconcileProductNameAiReviewState,
  selectLatestFailedSaveRetries,
  shouldIgnoreProductNameAiQuickKey,
  isProductNameAiAddExtraKey,
  removeProductNameAiQuickSlot,
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

console.log('product-name-ai-review verify: ok')
