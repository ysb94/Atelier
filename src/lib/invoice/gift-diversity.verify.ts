/**
 * 받는분별 사은품 최대 다양성 검증. 실행: npm run verify:gift-diversity
 */
import {
  giftRecipientKey,
  planGiftAssignments,
} from '@/lib/invoice/gift-assign'
import { resolveGiftDiversity, type GiftDiversityClaim } from '@/lib/invoice/gift-diversity'
import {
  collectGiftSourceSlots,
  giftSourceGroupKey,
  planGiftSourceTransform,
} from '@/lib/invoice/gift-source-transform'
import { planUnifiedGifts } from '@/lib/invoice/gift-unified'
import { planInvoicePrefixes } from '@/lib/invoice/prefix-transform'
import type { SabangnetOrderRow } from '@/lib/invoice/sabangnet'
import type {
  InvoiceGiftRequest,
  StyleRef,
} from '@/lib/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function row(
  partial: Partial<SabangnetOrderRow> & { rowNumber: number },
): SabangnetOrderRow {
  return {
    productName: '대상상품',
    itemName: '대상상품',
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

const a = style('1', 'M1', '사은품1')
const b = style('2', 'M2', '사은품2')
const c = style('3', 'M3', '사은품3')
const d = style('4', 'M4', '사은품4')
const e = style('5', 'M5', '사은품5')
const f = style('6', 'M6', '사은품6')

function claim(
  partial: Omit<GiftDiversityClaim, 'candidates' | 'sortKey' | 'groupId'> & {
    candidates?: StyleRef[]
    sortKey?: string
    groupId?: string
  },
): GiftDiversityClaim {
  return {
    candidates: [a, b],
    sortKey: partial.id,
    groupId: partial.id,
    skipUnit: 'claim',
    ...partial,
  }
}

assert(
  giftRecipientKey(
    row({
      rowNumber: 1,
      recipientName: '김고객',
      recipientPhone: '010-1111-2222',
      recipientAddress: '서울 강남',
      mallName: 'A몰',
    }),
  ) ===
    giftRecipientKey(
      row({
        rowNumber: 2,
        recipientName: '김고객',
        recipientPhone: '01011112222',
        recipientAddress: '서울 강남',
        mallName: 'B몰',
      }),
    ),
  '받는분 키는 쇼핑몰을 제외한다',
)

const emptyId = giftRecipientKey(
  row({
    rowNumber: 9,
    recipientName: '',
    recipientPhone: '',
    recipientAddress: '',
    customerOrderNo: 'EMPTY-1',
  }),
)
const otherEmpty = giftRecipientKey(
  row({
    rowNumber: 10,
    recipientName: '',
    recipientPhone: '',
    recipientAddress: '',
    customerOrderNo: 'EMPTY-2',
  }),
)
assert(emptyId.startsWith('fp:'), '식별 필드가 비면 주문 지문으로 폴백')
assert(emptyId !== otherEmpty, '빈 식별 필드는 무관한 주문을 합치지 않는다')

const overlap = resolveGiftDiversity({
  seed: 1,
  claims: [
    claim({
      id: 'A',
      recipientKey: 'same',
      candidates: [a, b],
    }),
    claim({
      id: 'B',
      recipientKey: 'same',
      candidates: [a],
    }),
  ],
})
assert(
  overlap.byClaimId.get('A')?.style.styleId === '2' &&
    overlap.byClaimId.get('B')?.style.styleId === '1',
  '{1,2} 대 {1}은 2와 1로 최대 매칭',
)
assert(overlap.unavoidableDuplicateCount === 0, '최대 매칭이면 중복 없음')

const overflow = resolveGiftDiversity({
  seed: 1,
  claims: [
    claim({ id: 'q1', recipientKey: 'one', candidates: [a, b] }),
    claim({ id: 'q2', recipientKey: 'one', candidates: [a, b] }),
    claim({ id: 'q3', recipientKey: 'one', candidates: [a, b] }),
  ],
})
assert(
  new Set(
    [...overflow.byClaimId.values()].map((item) => item.style.styleId),
  ).size === 2,
  '후보 2개에 권리 3개면 한 번만 반복',
)
assert(overflow.unavoidableDuplicateCount === 1, '후보 부족 중복 1회')

const otherCustomer = resolveGiftDiversity({
  seed: 1,
  claims: [
    claim({ id: 'c1', recipientKey: '갑', candidates: [a] }),
    claim({ id: 'c2', recipientKey: '을', candidates: [a] }),
  ],
})
assert(
  otherCustomer.byClaimId.get('c1')?.style.styleId === '1' &&
    otherCustomer.byClaimId.get('c2')?.style.styleId === '1',
  '다른 고객은 같은 M번호를 받을 수 있다',
)
assert(otherCustomer.unavoidableDuplicateCount === 0, '다른 고객 동일 M은 중복이 아니다')

const lockedDup = resolveGiftDiversity({
  seed: 1,
  claims: [
    claim({
      id: 'f1',
      recipientKey: '고정',
      candidates: [a],
      lockedStyle: a,
    }),
    claim({
      id: 'f2',
      recipientKey: '고정',
      candidates: [a],
      lockedStyle: a,
    }),
  ],
})
assert(lockedDup.unavoidableDuplicateCount === 1, '고정 중복은 안내만')
assert(
  [...lockedDup.byClaimId.values()].every((item) => item.style.styleId === '1'),
  '고정은 잠근 M번호를 유지',
)

function campaignRequest(options: {
  id: string
  mallName: string
  productName: string
  styles: StyleRef[]
  isRandom?: boolean
}): InvoiceGiftRequest {
  return {
    id: options.id,
    brandId: 'brand',
    title: options.id,
    taskNo: '',
    mallName: options.mallName,
    normalizedMallName: options.mallName,
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
        id: `${options.id}-item`,
        requestId: options.id,
        productName: options.productName,
        normalizedProductName: options.productName,
        prefix: '',
        outgoingProducts: options.styles,
        isRandom: options.isRandom ?? true,
      },
    ],
    quotas: [],
    createdAt: '',
    updatedAt: '',
  }
}

const mixedRows = [
  row({
    rowNumber: 1,
    mallName: 'A몰',
    productName: '상품a',
    recipientName: '같은이',
    recipientPhone: '01011112222',
    recipientAddress: '서울 동일',
    customerOrderNo: 'A-1',
  }),
  row({
    rowNumber: 2,
    mallName: 'B몰',
    productName: '[사은품] 상품d',
    recipientName: '같은이',
    recipientPhone: '01011112222',
    recipientAddress: '서울 동일',
    customerOrderNo: 'B-1',
  }),
]
const mixedRequests = [
  campaignRequest({
    id: 'req-a',
    mallName: 'A몰',
    productName: '상품a',
    styles: [a, b, c, d],
  }),
]
const mixedPrefix = planInvoicePrefixes(mixedRows.slice(0, 1), mixedRequests, {})
const mixedSourceKey = giftSourceGroupKey('B몰', '[사은품] 상품d')
const mixed = planUnifiedGifts({
  campaignRows: mixedRows.slice(0, 1),
  sourceRows: mixedRows,
  prefixPlan: mixedPrefix,
  requests: mixedRequests,
  seed: 7,
  maps: [],
  sessionRules: new Map([
    [
      mixedSourceKey,
      { assignmentMode: 'balanced_random', poolStyles: [c, d, e, f] },
    ],
  ]),
  appliedKeys: new Set([mixedSourceKey]),
})
const mixedCampaignStyle = mixed.giftPlan.shipments[0]?.assignments[0]?.styleId
const mixedSourceStyle = mixed.giftSourcePlan.replacementsByRow.get(2)?.[0]?.style.styleId
assert(mixedCampaignStyle && mixedSourceStyle, '행 추가와 품목명 대체가 모두 배정')
assert(
  mixedCampaignStyle !== mixedSourceStyle,
  '한 파일에서 행 추가+대체는 서로 다른 M번호',
)
assert(mixed.unavoidableDuplicateCount === 0, '겹치는 풀이면 중복 없이 배정')

const twoQty = collectGiftSourceSlots([
  row({
    rowNumber: 21,
    quantity: '2',
    productName: '[사은품] 파우치',
    recipientName: '수량자',
    recipientPhone: '01033334444',
    recipientAddress: '서울 수량',
    customerOrderNo: 'Q2',
  }),
])
const twoQtyClaims = twoQty.map((slot) =>
  claim({
    id: `source:${slot.allocationKey}`,
    recipientKey: giftRecipientKey(slot.source),
    candidates: [a, b],
    sortKey: slot.allocationKey,
    groupId: `source:${slot.allocationKey}`,
  }),
)
const twoQtyResolved = resolveGiftDiversity({
  seed: 3,
  claims: twoQtyClaims,
})
assert(
  new Set(
    [...twoQtyResolved.byClaimId.values()].map((item) => item.style.styleId),
  ).size === 2,
  '수량 2는 서로 다른 M번호',
)

const twoRows = [
  row({
    rowNumber: 31,
    productName: '[사은품] 파우치',
    recipientName: '이행',
    recipientPhone: '01055556666',
    recipientAddress: '서울 이행',
    customerOrderNo: 'R-A',
  }),
  row({
    rowNumber: 32,
    productName: '[사은품] 파우치',
    recipientName: '이행',
    recipientPhone: '01055556666',
    recipientAddress: '서울 이행',
    customerOrderNo: 'R-B',
  }),
]
const twoRowPlan = planGiftSourceTransform({
  rows: twoRows,
  sessionRules: new Map([
    [
      giftSourceGroupKey('테스트몰', '[사은품] 파우치'),
      { assignmentMode: 'balanced_random', poolStyles: [a, b] },
    ],
  ]),
})
assert(
  new Set(
    [...twoRowPlan.replacementsByRow.values()]
      .flat()
      .map((item) => item.style.styleId),
  ).size === 2,
  '같은 받는분 2행은 서로 다른 M번호',
)

const existingKey = twoQty[0]!.allocationKey
const lockedExisting = resolveGiftDiversity({
  seed: 1,
  claims: [
    claim({
      id: `source:${existingKey}`,
      recipientKey: '잠금',
      candidates: [a],
      lockedStyle: a,
      isExisting: true,
    }),
    claim({
      id: 'new-random',
      recipientKey: '잠금',
      candidates: [a, b],
    }),
  ],
})
assert(
  lockedExisting.byClaimId.get(`source:${existingKey}`)?.style.styleId === '1',
  '기존 allocation은 잠근다',
)
assert(
  lockedExisting.byClaimId.get('new-random')?.style.styleId === '2',
  '잠긴 뒤 랜덤은 다른 M번호를 고른다',
)

const firstFile = planUnifiedGifts({
  campaignRows: [],
  sourceRows: twoRows,
  prefixPlan: planInvoicePrefixes([], [], {}),
  requests: [],
  seed: 11,
  sessionRules: new Map([
    [
      giftSourceGroupKey('테스트몰', '[사은품] 파우치'),
      { assignmentMode: 'balanced_random', poolStyles: [a, b] },
    ],
  ]),
  appliedKeys: new Set([giftSourceGroupKey('테스트몰', '[사은품] 파우치')]),
})
const secondFile = planUnifiedGifts({
  campaignRows: [],
  sourceRows: [
    row({
      rowNumber: 1,
      productName: '[사은품] 파우치',
      recipientName: '이행',
      recipientPhone: '01055556666',
      recipientAddress: '서울 이행',
      customerOrderNo: 'NEW-1',
    }),
  ],
  prefixPlan: planInvoicePrefixes([], [], {}),
  requests: [],
  seed: 11,
  sessionRules: new Map([
    [
      giftSourceGroupKey('테스트몰', '[사은품] 파우치'),
      { assignmentMode: 'balanced_random', poolStyles: [a] },
    ],
  ]),
  appliedKeys: new Set([giftSourceGroupKey('테스트몰', '[사은품] 파우치')]),
})
assert(
  secondFile.giftSourcePlan.replacementsByRow.get(1)?.[0]?.style.styleId === '1',
  '새 파일은 이전 파일의 받는분 중복 상태를 이어받지 않는다',
)
assert(firstFile.unavoidableDuplicateCount === 0, '첫 파일은 중복 없음')

const campaignOnly = planGiftAssignments(
  [
    row({
      rowNumber: 1,
      mallName: 'A몰',
      recipientName: '통합고객',
      recipientPhone: '01077778888',
      recipientAddress: '서울 통합',
      customerOrderNo: 'C-1',
    }),
  ],
  planInvoicePrefixes(
    [
      row({
        rowNumber: 1,
        mallName: 'A몰',
        recipientName: '통합고객',
        recipientPhone: '01077778888',
        recipientAddress: '서울 통합',
        customerOrderNo: 'C-1',
      }),
    ],
    [campaignRequest({ id: 'only', mallName: 'A몰', productName: '대상상품', styles: [a] })],
    {},
  ),
  [campaignRequest({ id: 'only', mallName: 'A몰', productName: '대상상품', styles: [a] })],
  { seed: 1 },
)
assert(campaignOnly.giftCount === 1, '캠페인 단독 배정도 유지')

console.log('gift-diversity verify: OK')
