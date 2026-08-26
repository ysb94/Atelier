/**
 * 사은품 원본행 감지·균등 배정·품목명 오버레이·출력 검증.
 * 실행: npm run verify:gift-source
 */
import { planInvoicePrefixes } from '@/lib/invoice/prefix-transform'
import { formatGiftProductName, planGiftAssignments } from '@/lib/invoice/gift-assign'
import {
  assignGiftSourceSlots,
  collectGiftSourceSlots,
  collectGiftSourceSlotsForGroup,
  effectiveGiftSourceAppliedKeys,
  giftSourceGroupKey,
  inspectGiftSourceGroup,
  isGiftSourceCandidate,
  planGiftSourceTransform,
  recommendsGiftSourceBalancedRandom,
} from '@/lib/invoice/gift-source-transform'
import { transformInvoiceItemNames } from '@/lib/invoice/item-name-transform'
import { buildInvoiceOutputRows } from '@/lib/invoice/invoice-output'
import { buildOutgoingComponentRowsFromStages } from '@/lib/invoice/item-name-transform'
import {
  overlayGiftSourceOnProductNames,
  transformInvoiceProductNames,
} from '@/lib/invoice/product-name-transform'
import {
  buildProductNameAiReviewRow,
  reconcileProductNameAiReviewState,
} from '@/lib/invoice/product-name-ai-review'
import type { SabangnetOrderRow } from '@/lib/invoice/sabangnet'
import type {
  InvoiceGiftRequest,
  InvoiceGiftSourceAllocation,
  InvoiceGiftSourceMap,
  StyleRef,
} from '@/lib/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function row(
  partial: Partial<SabangnetOrderRow> & { rowNumber: number },
): SabangnetOrderRow {
  return {
    productName: '[사은품] 마스마룰즈 파우치 (컬러랜덤)',
    itemName: '',
    quantity: '1',
    recipientName: `받는분${partial.rowNumber}`,
    recipientPhone: `0100000${String(partial.rowNumber).padStart(4, '0')}`,
    recipientOtherPhone: '',
    shippingType: '',
    recipientAddress: `서울 ${partial.rowNumber}`,
    shippingMessage: '',
    customerOrderNo: `ORD-${partial.rowNumber}`,
    mallName: '테스트몰',
    orderedAt: '2026-08-24 10:00',
    ownProductCode: '',
    ...partial,
  }
}

function style(id: string, no: string, name: string): StyleRef {
  return { styleId: id, styleNo: no, name }
}

const a = style('style-a', 'M0001', '파우치 블랙')
const b = style('style-b', 'M0002', '파우치 아이보리')
const c = style('style-c', 'M0003', '파우치 카키')

assert(
  isGiftSourceCandidate(row({ rowNumber: 1 })),
  '[사은품] 선행 태그는 사은품 후보',
)
assert(
  isGiftSourceCandidate(
    row({ rowNumber: 2, productName: '[증정] 미니 파우치' }),
  ),
  '[증정] 선행 태그는 사은품 후보',
)
assert(
  !isGiftSourceCandidate(
    row({ rowNumber: 3, productName: '마스마룰즈 파우치 (컬러랜덤)' }),
  ),
  '컬러랜덤 단독은 사은품으로 보지 않음',
)
assert(
  !isGiftSourceCandidate(
    row({ rowNumber: 31, productName: '[비치볼 증정] 본품' }),
  ),
  '저장 전 [비치볼 증정]은 태그 추천만 하고 변환하지 않음',
)
assert(
  recommendsGiftSourceBalancedRandom('[사은품] 파우치 (컬러랜덤)'),
  '컬러랜덤은 균등 랜덤 추천만',
)
assert(
  !isGiftSourceCandidate(row({ rowNumber: 4 }), [], new Set([
    giftSourceGroupKey('테스트몰', '[사은품] 마스마룰즈 파우치 (컬러랜덤)'),
  ])),
  '일반 상품으로 처리한 조합은 현재 파일에서만 감지 해제',
)

const thirtyOne = Array.from({ length: 31 }, (_, index) =>
  row({
    rowNumber: index + 1,
    customerOrderNo: `BAL-${index + 1}`,
  }),
)
const slots = collectGiftSourceSlots(thirtyOne)
assert(slots.length === 31, '31행은 수량 슬롯 31개')
const assigned = assignGiftSourceSlots({
  slots,
  assignmentMode: 'balanced_random',
  poolStyles: [a, b, c],
  existingByKey: new Map(),
})
const counts = new Map<string, number>()
for (const styleRef of assigned.values()) {
  counts.set(styleRef.styleId, (counts.get(styleRef.styleId) ?? 0) + 1)
}
assert(
  [...counts.values()].sort((left, right) => right - left).join('/') ===
    '11/10/10',
  '31행 3종은 11/10/10',
)
const again = assignGiftSourceSlots({
  slots,
  assignmentMode: 'balanced_random',
  poolStyles: [a, b, c],
  existingByKey: assigned,
})
assert(
  [...assigned.entries()].every(
    ([key, styleRef]) => again.get(key)?.styleId === styleRef.styleId,
  ),
  '같은 키 재계산은 동일 StyleRef 재사용',
)

const qtyTwoSamePerson = collectGiftSourceSlots([
  row({ rowNumber: 91, quantity: '2', customerOrderNo: 'UNIQ-1' }),
])
const uniqueQtyTwo = assignGiftSourceSlots({
  slots: qtyTwoSamePerson,
  assignmentMode: 'balanced_random',
  poolStyles: [a, b],
  existingByKey: new Map(),
})
assert(
  new Set([...uniqueQtyTwo.values()].map((styleRef) => styleRef.styleId)).size ===
    2,
  '같은 주문자 수량 2는 서로 다른 M번호',
)
const twoRowsSamePerson = collectGiftSourceSlots([
  row({
    rowNumber: 92,
    customerOrderNo: 'UNIQ-A',
    recipientName: '같은이',
    recipientPhone: '01011112222',
    recipientAddress: '서울 동일',
  }),
  row({
    rowNumber: 93,
    customerOrderNo: 'UNIQ-B',
    recipientName: '같은이',
    recipientPhone: '01011112222',
    recipientAddress: '서울 동일',
  }),
])
const uniqueTwoRows = assignGiftSourceSlots({
  slots: twoRowsSamePerson,
  assignmentMode: 'balanced_random',
  poolStyles: [a, b],
  existingByKey: new Map(),
})
assert(
  new Set([...uniqueTwoRows.values()].map((styleRef) => styleRef.styleId))
    .size === 2,
  '같은 주문자 2행은 서로 다른 M번호',
)
const uniqueOverflow = assignGiftSourceSlots({
  slots: collectGiftSourceSlots([
    row({ rowNumber: 94, quantity: '3', customerOrderNo: 'UNIQ-3' }),
  ]),
  assignmentMode: 'balanced_random',
  poolStyles: [a, b],
  existingByKey: new Map(),
})
assert(
  new Set([...uniqueOverflow.values()].map((styleRef) => styleRef.styleId))
    .size === 2,
  '후보보다 개수가 많으면 한 번은 반복',
)

const otherMall = planGiftSourceTransform({
  rows: [
    row({ rowNumber: 1, mallName: 'A몰' }),
    row({ rowNumber: 2, mallName: 'B몰' }),
  ],
  sessionRules: new Map([
    [
      giftSourceGroupKey('A몰', '[사은품] 마스마룰즈 파우치 (컬러랜덤)'),
      { assignmentMode: 'fixed', poolStyles: [a] },
    ],
  ]),
})
assert(otherMall.groups.length === 2, '쇼핑몰 exact 경계로 그룹이 나뉨')
assert(
  otherMall.groups.find((group) => group.mallName === 'A몰')?.status ===
    'assigned',
  'A몰만 이번 파일 규칙이 적용됨',
)
assert(
  otherMall.groups.find((group) => group.mallName === 'B몰')?.status ===
    'unset',
  'B몰은 미설정',
)

const duplicateOrder = planGiftSourceTransform({
  rows: [
    row({ rowNumber: 1, customerOrderNo: 'DUP-1', quantity: '2' }),
    row({ rowNumber: 2, customerOrderNo: 'DUP-1', quantity: '1' }),
  ],
  sessionRules: new Map([
    [
      giftSourceGroupKey(
        '테스트몰',
        '[사은품] 마스마룰즈 파우치 (컬러랜덤)',
      ),
      { assignmentMode: 'balanced_random', poolStyles: [a, b] },
    ],
  ]),
})
assert(duplicateOrder.slots.length === 3, '중복 원본 행과 수량 2는 슬롯 3개')
assert(
  new Set(duplicateOrder.slots.map((slot) => slot.allocationKey)).size === 3,
  '같은 주문의 중복 행·수량 슬롯 키가 서로 다름',
)
assert(duplicateOrder.replacementsByRow.get(1)?.length, '수량 2 행도 치환됨')

const storedMap: InvoiceGiftSourceMap = {
  id: 'map-1',
  brandId: 'brand',
  mallName: '테스트몰',
  normalizedMallName: '테스트몰',
  productName: '[사은품] 마스마룰즈 파우치 (컬러랜덤)',
  normalizedProductName: '[사은품] 마스마룰즈 파우치 (컬러랜덤)',
  assignmentMode: 'balanced_random',
  uniquePerRecipient: false,
  poolStyles: [a, b, c],
  isActive: true,
  note: '',
  createdAt: '2026-08-24T00:00:00.000Z',
  updatedAt: '2026-08-24T00:00:00.000Z',
}
const firstKey = slots[0]!.allocationKey
const kept: InvoiceGiftSourceAllocation = {
  id: 'alloc-1',
  mapId: 'map-1',
  styleId: a.styleId,
  styleNo: a.styleNo,
  styleName: a.name,
  allocationKey: firstKey,
  orderFingerprint: slots[0]!.orderFingerprint,
  quantitySlot: 1,
  mallName: '테스트몰',
  customerOrderNo: slots[0]!.source.customerOrderNo,
  orderedAt: '2026-08-24 10:00',
  sourceFileName: 'file.xlsx',
  createdAt: '2026-08-24T00:00:00.000Z',
}
const storedGroupKey = giftSourceGroupKey(
  '테스트몰',
  '[사은품] 마스마룰즈 파우치 (컬러랜덤)',
)
assert(
  effectiveGiftSourceAppliedKeys({
    maps: [{ ...storedMap, poolStyles: [b, c] }],
  }).has(storedGroupKey),
  '활성 저장 매핑은 기본 적용 키',
)
assert(
  !effectiveGiftSourceAppliedKeys({
    maps: [{ ...storedMap, isActive: false }],
  }).has(storedGroupKey),
  '비활성 매핑은 기본 적용 키가 아님',
)
assert(
  !effectiveGiftSourceAppliedKeys({
    maps: [storedMap],
    ignoredKeys: new Set([storedGroupKey]),
  }).has(storedGroupKey),
  '명시 제외 키는 자동 적용하지 않음',
)
const storedOnly = planGiftSourceTransform({
  rows: thirtyOne.slice(0, 1),
  maps: [{ ...storedMap, poolStyles: [b, c] }],
  allocations: [kept],
})
assert(
  storedOnly.groups[0]?.status === 'assigned',
  '활성 저장 매핑은 자동 치환',
)
assert(
  storedOnly.mappedRowCount === 1,
  '활성 저장 매핑은 별도 적용 없이 치환',
)
assert(
  storedOnly.replacementsByRow.get(1)?.[0]?.style.styleId === a.styleId,
  '자동 적용 때도 기존 allocation을 재사용',
)
const afterPoolChange = planGiftSourceTransform({
  rows: thirtyOne.slice(0, 1),
  maps: [{ ...storedMap, poolStyles: [b, c] }],
  allocations: [kept],
})
assert(
  afterPoolChange.replacementsByRow.get(1)?.[0]?.style.styleId === a.styleId,
  '후보 풀이 바뀌어도 기존 배정은 재추첨하지 않음',
)
const nextFileAuto = planGiftSourceTransform({
  rows: [
    row({
      rowNumber: 1,
      customerOrderNo: 'NEW-99',
      orderedAt: '2026-08-26 10:00',
    }),
  ],
  maps: [storedMap],
})
assert(
  nextFileAuto.mappedRowCount === 1 && nextFileAuto.groups[0]?.status === 'assigned',
  '새 파일은 같은 활성 매핑을 자동 재적용',
)
assert(
  nextFileAuto.replacementsByRow.get(1)?.[0]?.style.styleId !== undefined,
  '신규 슬롯은 저장된 후보 풀로 배정',
)
const inactiveStored = planGiftSourceTransform({
  rows: thirtyOne.slice(0, 1),
  maps: [{ ...storedMap, isActive: false }],
})
assert(
  inactiveStored.mappedRowCount === 0 &&
    inactiveStored.groups[0]?.status === 'unset',
  '비활성 매핑은 자동 적용하지 않음',
)
const mallMismatch = planGiftSourceTransform({
  rows: [row({ rowNumber: 1, mallName: '다른몰' })],
  maps: [storedMap],
})
assert(
  mallMismatch.mappedRowCount === 0 &&
    mallMismatch.groups.every((group) => group.status === 'unset'),
  '쇼핑몰이 다른 저장 매핑은 적용하지 않음',
)
const ignoredStored = planGiftSourceTransform({
  rows: thirtyOne.slice(0, 1),
  maps: [storedMap],
  ignoredKeys: new Set([storedGroupKey]),
})
assert(
  ignoredStored.mappedRowCount === 0 && ignoredStored.groups.length === 0,
  '파일에서 제외한 키는 자동 적용하지 않음',
)
const emptyPoolStored = planGiftSourceTransform({
  rows: thirtyOne.slice(0, 1),
  maps: [{ ...storedMap, poolStyles: [] }],
})
assert(
  emptyPoolStored.groups[0]?.status === 'map_found' &&
    emptyPoolStored.mappedRowCount === 0,
  '후보가 없는 저장 매핑은 예외 상태로만 표시',
)

const sessionThenReset = planGiftSourceTransform({
  rows: thirtyOne.slice(0, 3),
})
assert(
  sessionThenReset.groups.every((group) => group.status === 'unset'),
  '현재 파일 규칙을 버리면 다시 미설정',
)

const base = transformInvoiceProductNames(
  [
    row({ rowNumber: 1 }),
    row({
      rowNumber: 2,
      productName: '일반 본품',
      customerOrderNo: 'N-2',
    }),
  ],
  [],
  { byName: new Map(), byCompactName: new Map() },
)
const giftPlan = planGiftSourceTransform({
  rows: [
    row({ rowNumber: 1 }),
    row({
      rowNumber: 2,
      productName: '일반 본품',
      customerOrderNo: 'N-2',
    }),
  ],
  sessionRules: new Map([
    [
      giftSourceGroupKey(
        '테스트몰',
        '[사은품] 마스마룰즈 파우치 (컬러랜덤)',
      ),
      { assignmentMode: 'fixed', poolStyles: [a] },
    ],
  ]),
})
const overlaid = overlayGiftSourceOnProductNames(base, giftPlan)
assert(overlaid.giftMappedRowCount === 1, '사은품 변환 완료 집계')
assert(
  overlaid.unresolvedCombos.every(
    (combo) => combo.productName !== '[사은품] 마스마룰즈 파우치 (컬러랜덤)',
  ),
  '사은품 조합은 AI unresolved에서 제외',
)
assert(
  overlaid.unresolvedCombos.some((combo) => combo.productName === '일반 본품'),
  '일반 행 객체와 조합 키는 유지',
)
const afterApplyReview = reconcileProductNameAiReviewState({
  combos: overlaid.unresolvedCombos,
  reviewRows: [
    buildProductNameAiReviewRow(
      base.unresolvedCombos.find(
        (combo) => combo.productName.startsWith('[사은품]'),
      ) ?? base.unresolvedCombos[0]!,
    ),
    buildProductNameAiReviewRow(
      base.unresolvedCombos.find((combo) => combo.productName === '일반 본품') ??
        base.unresolvedCombos[0]!,
    ),
  ],
  drafts: new Map(),
  confirmedKeys: new Set(),
  pendingAiKeys: new Set(),
  committedKeys: new Set(),
})
assert(
  afterApplyReview.reviewRows.every(
    (item) => item.productName !== '[사은품] 마스마룰즈 파우치 (컬러랜덤)',
  ),
  '명시적 적용 후 해당 사은품 조합만 검수표에서 제거',
)
assert(
  afterApplyReview.reviewRows.some((item) => item.productName === '일반 본품'),
  '명시적 적용 후에도 다른 조합은 검수표에 유지',
)

const existingPrefill = inspectGiftSourceGroup({
  rows: [row({ rowNumber: 1 })],
  mallName: '테스트몰',
  productName: '[사은품] 마스마룰즈 파우치 (컬러랜덤)',
  maps: [storedMap],
  allocations: [kept],
})
assert(existingPrefill.status === 'assigned', '기존 매핑은 자동 치환')
assert(existingPrefill.poolStyles.length === 3, '기존 후보 풀을 그대로 채움')
const existingApplied = planGiftSourceTransform({
  rows: [row({ rowNumber: 1 })],
  maps: [storedMap],
  allocations: [kept],
})
assert(existingApplied.mappedRowCount === 1, '기존 설정은 자동 치환')

const detectedOnly = planGiftSourceTransform({
  rows: [
    row({ rowNumber: 1 }),
    row({
      rowNumber: 2,
      productName: '일반 본품',
      customerOrderNo: 'N-2',
    }),
  ],
})
const detectedOverlay = overlayGiftSourceOnProductNames(base, detectedOnly)
assert(
  detectedOverlay.unresolvedCombos.some((combo) =>
    combo.productName.startsWith('[사은품]'),
  ),
  '자동 감지만으로는 AI 큐에서 빼지 않음',
)
assert(
  detectedOverlay.giftPendingRowCount === 0,
  '자동 감지는 gift_pending 오버레이를 만들지 않음',
)
assert(
  detectedOverlay.giftMappedRowCount === 0,
  '자동 감지는 gift_mapped 오버레이를 만들지 않음',
)
assert(
  detectedOnly.groups.some((group) => group.status === 'unset'),
  '감지된 사은품은 추천 그룹으로만 남음',
)

const cancelled = planGiftSourceTransform({
  rows: [row({ rowNumber: 1 })],
})
assert(cancelled.mappedRowCount === 0, '팝업 취소는 치환 계획을 만들지 않음')
assert(cancelled.pendingRowCount === 0, '팝업 취소는 pending 행을 만들지 않음')

const previousReview = [
  buildProductNameAiReviewRow(
    base.unresolvedCombos.find(
      (combo) => combo.productName.startsWith('[사은품]'),
    ) ?? base.unresolvedCombos[0]!,
  ),
  buildProductNameAiReviewRow(
    base.unresolvedCombos.find((combo) => combo.productName === '일반 본품') ??
      base.unresolvedCombos[0]!,
  ),
]
const stillQueued = reconcileProductNameAiReviewState({
  combos: detectedOverlay.unresolvedCombos,
  reviewRows: previousReview,
  drafts: new Map(previousReview.map((item) => [item.key, item])),
  confirmedKeys: new Set(previousReview.map((item) => item.key)),
  pendingAiKeys: new Set(),
  committedKeys: new Set(),
})
assert(
  stillQueued.reviewRows.some((item) =>
    item.productName.startsWith('[사은품]'),
  ),
  '적용 전 사은품 조합은 검수표에 유지',
)
assert(
  stillQueued.reviewRows.some((item) => item.productName === '일반 본품'),
  '다른 AI 초안은 보존',
)

const regularName = '태그 없는 일반 사은품'
const regularKey = giftSourceGroupKey('테스트몰', regularName)
const regularRows = [
  row({
    rowNumber: 8,
    productName: regularName,
    customerOrderNo: 'MAN-8',
  }),
]
assert(
  !isGiftSourceCandidate(regularRows[0]!),
  '태그 없는 행은 자동 후보가 아님',
)
const manualSlots = collectGiftSourceSlotsForGroup(
  regularRows,
  '테스트몰',
  regularName,
)
assert(manualSlots.length === 1, '태그 없는 행도 수동 처리 슬롯을 모음')
const manualPlan = planGiftSourceTransform({
  rows: regularRows,
  sessionRules: new Map([
    [regularKey, { assignmentMode: 'fixed', poolStyles: [a] }],
  ]),
})
assert(manualPlan.mappedRowCount === 1, '태그 없는 행도 명시적 적용 후 치환')
assert(
  inspectGiftSourceGroup({
    rows: regularRows,
    mallName: '테스트몰',
    productName: regularName,
    maps: [
      {
        ...storedMap,
        productName: regularName,
        normalizedProductName: regularName,
      },
    ],
  }).status === 'assigned',
  '태그 없는 행의 기존 매핑도 자동 치환',
)

const storedAutoOverlay = overlayGiftSourceOnProductNames(
  base,
  planGiftSourceTransform({
    rows: [
      row({ rowNumber: 1 }),
      row({
        rowNumber: 2,
        productName: '일반 본품',
        customerOrderNo: 'N-2',
      }),
    ],
    maps: [storedMap],
  }),
)
assert(
  storedAutoOverlay.giftMappedRowCount === 1,
  '활성 저장 매핑 overlay는 gift_mapped',
)
assert(
  storedAutoOverlay.unresolvedCombos.every(
    (combo) => combo.productName !== '[사은품] 마스마룰즈 파우치 (컬러랜덤)',
  ),
  '자동 적용된 사은품은 AI 미해결 목록에서 제외',
)
assert(
  storedAutoOverlay.unresolvedCombos.some((combo) => combo.productName === '일반 본품'),
  '자동 적용 후에도 일반 조합은 검수표에 유지',
)

const mappedOverlay = overlayGiftSourceOnProductNames(
  transformInvoiceProductNames(
    [row({ rowNumber: 1, quantity: '2' })],
    [],
    { byName: new Map(), byCompactName: new Map() },
  ),
  planGiftSourceTransform({
    rows: [row({ rowNumber: 1, quantity: '2' })],
    sessionRules: new Map([
      [
        giftSourceGroupKey(
          '테스트몰',
          '[사은품] 마스마룰즈 파우치 (컬러랜덤)',
        ),
        { assignmentMode: 'fixed', poolStyles: [a] },
      ],
    ]),
  }),
)
const itemTransformation = transformInvoiceItemNames(
  [row({ rowNumber: 1, quantity: '2' })],
  [],
  mappedOverlay.rows,
)
assert(
  itemTransformation.rows[0]?.transformedItemName === '',
  '사은품 변환 행은 내품명을 비움',
)
assert(
  !itemTransformation.unresolvedCombos.some((combo) =>
    combo.productName.startsWith('[사은품]'),
  ),
  '사은품 행은 내품명 검토 목록에서 제외',
)

const output = buildInvoiceOutputRows({
  transformedRows: mappedOverlay.rows.map((item) => ({
    source: item.source,
    status: 'missing_code',
    matchedRuleId: null,
    transformedName: item.source.productName,
  })),
  workMatches: new Map(),
  giftRowsBySource: new Map(),
  productTransformation: mappedOverlay,
  itemTransformation,
  applyItemName: true,
})
assert(output.length === 1, '원본 1행은 치환 1행')
assert(output[0]?.kind === 'gift', '치환 행 kind=gift')
assert(
  output[0]?.finalProductName === formatGiftProductName(1, a.name),
  '품목명 대체도 사은품(1) : 공식명',
)
assert(output[0]?.productName === formatGiftProductName(1, a.name), '품목명 표시 통일')
assert(output[0]?.finalItemName === '', '내품명 빈 값')
assert(output[0]?.ownProductCode === '', '자체품번코드 빈 값')
assert(output[0]?.sourceRowNumber === 1, '원본 행 번호 보존')

const outgoing = buildOutgoingComponentRowsFromStages({
  productRows: mappedOverlay.rows,
  itemRows: itemTransformation.rows,
  giftRowsBySource: new Map(),
})
assert(outgoing[0]?.role === 'gift', '출고구성 역할 gift')
assert(outgoing[0]?.styleNo === a.styleNo, '출고구성에 실제 M번호')
assert(outgoing[0]?.styleName === a.name, '출고구성 공식명')
assert(outgoing[0]?.quantity === 2, '수량 2는 스타일별 합쳐 유지')

const sameShipment = {
  recipientName: '합포고객',
  recipientPhone: '01012345678',
  recipientAddress: '서울 합포장',
}
const mappedSame = row({ rowNumber: 21, quantity: '1', ...sameShipment })
const regularSame = row({
  rowNumber: 22,
  productName: '일반 본품',
  quantity: '1',
  ...sameShipment,
})
const mappedOther = row({
  rowNumber: 23,
  quantity: '1',
  recipientName: '다른고객',
  recipientPhone: '01087654321',
  recipientAddress: '부산 단독',
})
const mixedOverlay = overlayGiftSourceOnProductNames(
  transformInvoiceProductNames(
    [mappedSame, regularSame, mappedOther],
    [],
    { byName: new Map(), byCompactName: new Map() },
  ),
  planGiftSourceTransform({
    rows: [mappedSame, regularSame, mappedOther],
    sessionRules: new Map([
      [
        giftSourceGroupKey(
          '테스트몰',
          '[사은품] 마스마룰즈 파우치 (컬러랜덤)',
        ),
        { assignmentMode: 'fixed', poolStyles: [a] },
      ],
    ]),
  }),
)
const mixedOutput = buildInvoiceOutputRows({
  transformedRows: mixedOverlay.rows.map((item) => ({
    source: item.source,
    status: 'missing_code',
    matchedRuleId: null,
    transformedName: item.source.productName,
  })),
  workMatches: new Map(),
  giftRowsBySource: new Map([
    [
      22,
      [
        row({
          rowNumber: 2201,
          productName: formatGiftProductName(1, b.name),
          itemName: '',
          quantity: '1',
          ...sameShipment,
        }),
      ],
    ],
  ]),
  productTransformation: mixedOverlay,
})
const mixedGifts = mixedOutput.filter((item) => item.kind === 'gift')
assert(mixedGifts.length === 3, '대체 2행 + 추가 사은품 1행')
assert(
  mixedGifts[0]?.finalProductName === formatGiftProductName(1, a.name),
  '같은 합포장 첫 사은품은 1번',
)
assert(
  mixedGifts[1]?.finalProductName === formatGiftProductName(2, b.name),
  '품목명 대체와 추가 사은품은 번호를 이어 씀',
)
assert(
  mixedGifts[2]?.finalProductName === formatGiftProductName(1, a.name),
  '다른 합포장은 사은품(1)부터 다시',
)
assert(
  mixedOutput.find((item) => item.sourceRowNumber === 22 && item.kind === 'order')
    ?.finalProductName === '일반 본품',
  '본품 행은 사은품 번호를 쓰지 않음',
)

const campaignRequest: InvoiceGiftRequest = {
  id: 'req-1',
  brandId: 'brand',
  title: '캠페인',
  taskNo: '',
  mallName: '테스트몰',
  normalizedMallName: '테스트몰',
  startsAt: '2026-08-01 00:00',
  endsAt: '2026-08-31 23:59',
  countBasis: 'per_order',
  mergeBasis: 'per_order',
  usesFirstCome: false,
  firstComeLimitMode: 'per_style',
  firstComeTotalLimit: null,
  firstComeUsedCount: 0,
  hasAllocationHistory: false,
  isActive: true,
  note: '',
  items: [
    {
      id: 'item-1',
      requestId: 'req-1',
      productName: '[사은품] 마스마룰즈 파우치 (컬러랜덤)',
      normalizedProductName: '[사은품] 마스마룰즈 파우치 (컬러랜덤)',
      prefix: '',
      outgoingProducts: [b],
      isRandom: false,
    },
  ],
  quotas: [],
  createdAt: '2026-08-24T00:00:00.000Z',
  updatedAt: '2026-08-24T00:00:00.000Z',
}
const giftRows = [row({ rowNumber: 1 })]
const eligibility = planInvoicePrefixes(giftRows, [campaignRequest], {})
const campaignPlan = planGiftAssignments(giftRows, eligibility, [campaignRequest], {
  seed: 1,
})
assert(campaignPlan.giftCount > 0, '캠페인 입력에 넣으면 추가 행이 생김')
const filteredEligibility = planInvoicePrefixes([], [campaignRequest], {})
const filteredCampaign = planGiftAssignments(
  [],
  filteredEligibility,
  [campaignRequest],
  { seed: 1 },
)
assert(
  filteredCampaign.giftCount === 0,
  '원본 사은품 후보를 캠페인 입력에서 빼면 중복 추가 없음',
)

const broccoliWhite = style(
  'style-m2305',
  'M2305',
  '헤이트 브로콜리 크롭티셔츠 화이트 F',
)
const broccoliBlack = style(
  'style-m2306',
  'M2306',
  '헤이트 브로콜리 크롭티셔츠 블랙 F',
)
const broccoliRow = row({
  rowNumber: 1,
  mallName: 'Cafe24(신) 유튜브쇼핑',
  productName: '[사은품] 헤이트 브로콜리 크롭티셔츠 (컬러랜덤)',
  customerOrderNo: '2146235253',
  recipientName: '기존고객',
  recipientPhone: '01012345678',
  recipientAddress: '서울 기존',
})
const broccoliSlots = collectGiftSourceSlots([broccoliRow])
const broccoliMap: InvoiceGiftSourceMap = {
  ...storedMap,
  id: 'map-broccoli',
  mallName: broccoliRow.mallName,
  normalizedMallName: broccoliRow.mallName,
  productName: broccoliRow.productName,
  normalizedProductName: broccoliRow.productName,
  poolStyles: [broccoliWhite, broccoliBlack],
}
const broccoliPlan = planGiftSourceTransform({
  rows: [broccoliRow],
  maps: [broccoliMap],
  allocations: [
    {
      id: 'alloc-broccoli',
      mapId: 'map-broccoli',
      styleId: broccoliWhite.styleId,
      styleNo: broccoliWhite.styleNo,
      styleName: broccoliWhite.name,
      allocationKey: broccoliSlots[0]!.allocationKey,
      orderFingerprint: broccoliSlots[0]!.orderFingerprint,
      quantitySlot: 1,
      mallName: broccoliRow.mallName,
      customerOrderNo: broccoliRow.customerOrderNo,
      orderedAt: broccoliRow.orderedAt,
      sourceFileName: 'file.xlsx',
      createdAt: '2026-08-24T00:00:00.000Z',
    },
  ],
})
assert(
  broccoliPlan.groups[0]?.status === 'assigned' &&
    broccoliPlan.mappedRowCount === 1 &&
    broccoliPlan.replacementsByRow.get(1)?.[0]?.style.styleNo === 'M2305',
  '운영 사은품 행은 업로드 직후 기존 allocation M2305로 자동 치환',
)
const broccoliOverlay = overlayGiftSourceOnProductNames(
  transformInvoiceProductNames(
    [broccoliRow],
    [],
    { byName: new Map(), byCompactName: new Map() },
  ),
  broccoliPlan,
)
assert(
  broccoliOverlay.rows[0]?.status === 'gift_mapped' &&
    broccoliOverlay.unresolvedCombos.length === 0,
  '자동 치환된 브로콜리 사은품은 품목명 AI 검수표에 없음',
)
const broccoliNextFile = planGiftSourceTransform({
  rows: [
    row({
      rowNumber: 2,
      mallName: broccoliRow.mallName,
      productName: broccoliRow.productName,
      customerOrderNo: 'NEW-BROCCOLI',
    }),
  ],
  maps: [broccoliMap],
})
assert(
  broccoliNextFile.mappedRowCount === 1 &&
    broccoliNextFile.groups[0]?.status === 'assigned',
  '같은 활성 매핑은 다음 파일에서도 자동 완료',
)

console.log('gift-source-transform verify ok')
