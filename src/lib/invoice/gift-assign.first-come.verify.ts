/**
 * 선착순 배정 집중 검증. 실행:
 * npx --yes esbuild src/lib/invoice/gift-assign.first-come.verify.ts --bundle --platform=node --format=esm --outfile=node_modules/.tmp/gift-first-come-verify.mjs --alias:@=./src && node node_modules/.tmp/gift-first-come-verify.mjs
 */
import {
  buildAllocationKey,
  buildOrderFingerprint,
  formatGiftProductName,
  planGiftAssignments,
} from '@/lib/invoice/gift-assign'
import type { InvoicePrefixPlan } from '@/lib/invoice/prefix-transform'
import type { SabangnetOrderRow } from '@/lib/invoice/sabangnet'
import type {
  InvoiceGiftAllocation,
  InvoiceGiftRequest,
  StyleRef,
} from '@/lib/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function row(
  partial: Partial<SabangnetOrderRow> & {
    rowNumber: number
    customerOrderNo: string
    orderedAt: string
  },
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
    mallName: '테스트몰',
    ownProductCode: '',
    ...partial,
  }
}

function style(id: string, no: string, name: string): StyleRef {
  return { styleId: id, styleNo: no, name }
}

function request(options: {
  id: string
  styleRefs: StyleRef[]
  limitByStyle: Record<string, number>
  isRandom?: boolean
  usedByStyle?: Record<string, number>
  limitMode?: 'per_style' | 'shared_total'
  totalLimit?: number
  totalUsed?: number
}): InvoiceGiftRequest {
  const limitMode = options.limitMode ?? 'per_style'
  const totalUsed =
    options.totalUsed ??
    Object.values(options.usedByStyle ?? {}).reduce(
      (sum, count) => sum + count,
      0,
    )
  return {
    id: options.id,
    brandId: 'brand',
    title: '선착순 행사',
    taskNo: '',
    mallName: '테스트몰',
    normalizedMallName: '테스트몰',
    startsAt: '2026-08-01 00:00',
    endsAt: '2026-08-31 23:59',
    countBasis: 'per_order',
    mergeBasis: 'per_order',
    usesFirstCome: true,
    firstComeLimitMode: limitMode,
    firstComeTotalLimit:
      limitMode === 'shared_total' ? (options.totalLimit ?? 1) : null,
    firstComeUsedCount: totalUsed,
    hasAllocationHistory: totalUsed > 0,
    isActive: true,
    note: '',
    items: [
      {
        id: 'item-1',
        requestId: options.id,
        productName: '대상상품',
        normalizedProductName: '대상상품',
        prefix: '',
        outgoingProducts: options.styleRefs,
        isRandom: Boolean(options.isRandom),
      },
    ],
    quotas:
      limitMode === 'per_style'
        ? options.styleRefs.map((ref) => {
            const limit = options.limitByStyle[ref.styleId] ?? 0
            const used = options.usedByStyle?.[ref.styleId] ?? 0
            return {
              id: `quota-${ref.styleId}`,
              requestId: options.id,
              styleId: ref.styleId,
              styleNo: ref.styleNo,
              styleName: ref.name,
              quantityLimit: limit,
              usedCount: used,
              remainingCount: Math.max(0, limit - used),
            }
          })
        : [],
    createdAt: '',
    updatedAt: '',
  }
}

function prefixPlan(rows: SabangnetOrderRow[]): InvoicePrefixPlan {
  const matchByRowNumber = new Map(
    rows.map((item) => [
      item.rowNumber,
      {
        requestId: 'req-1',
        itemId: 'item-1',
        prefix: '',
      },
    ]),
  )
  return {
    prefixByRowNumber: new Map(),
    matchByRowNumber,
    groups: [],
    conflicts: [],
    unusedItems: [],
    prefixedRowCount: rows.length,
    passedRowCount: 0,
    undatedRowCount: 0,
    outOfPeriodRowCount: 0,
    mallMismatchRowCount: 0,
  }
}

function existingAllocation(
  partial: Omit<
    InvoiceGiftAllocation,
    'id' | 'cancelledAt' | 'createdAt' | 'sourceFileName'
  > &
    Partial<Pick<InvoiceGiftAllocation, 'id' | 'cancelledAt'>>,
): InvoiceGiftAllocation {
  return {
    id: partial.id ?? `alloc-${partial.allocationKey}`,
    sourceFileName: '',
    cancelledAt: null,
    createdAt: '',
    ...partial,
  }
}

function run() {
  const styleA = style('style-a', 'M-A', '사은품A')
  const styleB = style('style-b', 'M-B', '사은품B')

  // 1) M번호별 100개 소진
  const hundredRows = Array.from({ length: 120 }, (_, index) =>
    row({
      rowNumber: index + 1,
      customerOrderNo: `O${index + 1}`,
      orderedAt: `2026-08-10 ${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}`,
    }),
  )
  const exhaustPlan = planGiftAssignments(
    hundredRows,
    prefixPlan(hundredRows),
    [
      request({
        id: 'req-1',
        styleRefs: [styleA],
        limitByStyle: { 'style-a': 100 },
      }),
    ],
    { seed: 1 },
  )
  assert(exhaustPlan.giftCount === 100, '100개 한도만 배정해야 한다')
  assert(exhaustPlan.exhaustedSkipCount === 20, '초과 20건은 소진 제외')
  assert(
    exhaustPlan.quotaPreviews[0]?.plannedCount === 100,
    '이번 예정 100',
  )
  assert(exhaustPlan.quotaPreviews[0]?.remainingCount === 0, '잔여 0')

  // 2) 고정 세트 원자 배정 (A 2 / B 1 → 세트 1개만)
  const setRows = [
    row({
      rowNumber: 1,
      customerOrderNo: 'S1',
      orderedAt: '2026-08-10 10:00',
    }),
    row({
      rowNumber: 2,
      customerOrderNo: 'S2',
      orderedAt: '2026-08-10 10:01',
    }),
  ]
  const setPlan = planGiftAssignments(
    setRows,
    prefixPlan(setRows),
    [
      request({
        id: 'req-1',
        styleRefs: [styleA, styleB],
        limitByStyle: { 'style-a': 2, 'style-b': 1 },
      }),
    ],
    { seed: 1 },
  )
  assert(setPlan.giftCount === 2, '세트 1개면 사은품 행 2개')
  assert(
    setPlan.confirmCandidates.map((item) => item.styleId).sort().join(',') ===
      'style-a,style-b',
    '고정 세트는 A+B 함께',
  )
  assert(setPlan.exhaustedSkipCount === 1, '두 번째 주문은 세트 불가')

  // 3) 랜덤 quota — 잔여 있는 쪽만
  const randomRows = Array.from({ length: 5 }, (_, index) =>
    row({
      rowNumber: index + 1,
      customerOrderNo: `R${index + 1}`,
      orderedAt: `2026-08-10 11:0${index}`,
    }),
  )
  const randomPlan = planGiftAssignments(
    randomRows,
    prefixPlan(randomRows),
    [
      request({
        id: 'req-1',
        styleRefs: [styleA, styleB],
        limitByStyle: { 'style-a': 2, 'style-b': 2 },
        isRandom: true,
      }),
    ],
    { seed: 42 },
  )
  assert(randomPlan.giftCount === 4, '랜덤도 합 quota 4개만')
  assert(randomPlan.exhaustedSkipCount === 1, '다섯 번째는 소진')

  // 3-1) 여러 M번호가 공유하는 실제 사은품 전체 합계 100개
  const sharedRandomPlan = planGiftAssignments(
    hundredRows,
    prefixPlan(hundredRows),
    [
      request({
        id: 'req-1',
        styleRefs: [styleA, styleB],
        limitByStyle: {},
        isRandom: true,
        limitMode: 'shared_total',
        totalLimit: 100,
      }),
    ],
    { seed: 42 },
  )
  assert(
    sharedRandomPlan.giftCount === 100,
    'M번호 종류와 관계없이 전체 합계 100개만 배정',
  )
  assert(
    sharedRandomPlan.totals.reduce((sum, item) => sum + item.count, 0) ===
      100,
    'M번호별 집계 합계도 100',
  )
  assert(
    sharedRandomPlan.sharedQuotaPreviews[0]?.remainingCount === 0,
    '전체 합계 잔여 0',
  )

  // 3-2) 전체 합계가 3개 남아도 A+B 고정 세트는 한 세트(2개)만 원자 배정
  const sharedSetPlan = planGiftAssignments(
    setRows,
    prefixPlan(setRows),
    [
      request({
        id: 'req-1',
        styleRefs: [styleA, styleB],
        limitByStyle: {},
        limitMode: 'shared_total',
        totalLimit: 3,
      }),
    ],
    { seed: 1 },
  )
  assert(sharedSetPlan.giftCount === 2, '공유 한도에서도 고정 세트 일부 지급 금지')
  assert(
    new Set(
      sharedSetPlan.confirmCandidates.map((item) => item.atomicGroupKey),
    ).size === 1,
    '고정 세트 후보는 같은 원자 그룹',
  )
  assert(
    sharedSetPlan.sharedQuotaPreviews[0]?.remainingCount === 1,
    '세트 배정 후 전체 합계 1개 잔여',
  )

  // 4) 동일 파일 재실행 — 기존 배정 재사용, 신규 없음
  const reusedRows = [
    row({
      rowNumber: 1,
      customerOrderNo: 'REUSE1',
      orderedAt: '2026-08-10 12:00',
    }),
  ]
  const fp = buildOrderFingerprint(reusedRows[0]!)
  const key = buildAllocationKey(fp, 'item-1', 'style-a', 1)
  const reusePlan = planGiftAssignments(
    reusedRows,
    prefixPlan(reusedRows),
    [
      request({
        id: 'req-1',
        styleRefs: [styleA],
        limitByStyle: { 'style-a': 10 },
        usedByStyle: { 'style-a': 1 },
      }),
    ],
    {
      seed: 1,
      existingAllocations: [
        existingAllocation({
          requestId: 'req-1',
          itemId: 'item-1',
          styleId: styleA.styleId,
          styleNo: styleA.styleNo,
          styleName: styleA.name,
          mallName: '테스트몰',
          customerOrderNo: 'REUSE1',
          orderedAt: '2026-08-10 12:00',
          orderFingerprint: fp,
          allocationKey: key,
          giftSlotIndex: 1,
        }),
      ],
    },
  )
  assert(reusePlan.giftCount === 1, '기존 배정 재사용')
  assert(reusePlan.newConfirmCandidates.length === 0, '신규 확정 없음')
  assert(reusePlan.confirmCandidates[0]?.isExisting === true, '기존 표시')

  // 5) 여러 날짜 누적 — 이미 쓴 수량만큼 remaining 반영
  const day2Rows = [
    row({
      rowNumber: 1,
      customerOrderNo: 'D2-1',
      orderedAt: '2026-08-11 09:00',
    }),
  ]
  const day2Plan = planGiftAssignments(
    day2Rows,
    prefixPlan(day2Rows),
    [
      request({
        id: 'req-1',
        styleRefs: [styleA],
        limitByStyle: { 'style-a': 100 },
        usedByStyle: { 'style-a': 99 },
      }),
    ],
    { seed: 1 },
  )
  assert(day2Plan.giftCount === 1, '잔여 1개만 배정')
  assert(day2Plan.quotaPreviews[0]?.usedCount === 99, '기존 확정 99')
  assert(day2Plan.quotaPreviews[0]?.plannedCount === 1, '이번 예정 1')
  assert(day2Plan.quotaPreviews[0]?.remainingCount === 0, '잔여 0')

  // 6) 동일 시각 tie-break — 주문번호 순
  const tieRows = [
    row({
      rowNumber: 2,
      customerOrderNo: 'B',
      orderedAt: '2026-08-10 13:00',
    }),
    row({
      rowNumber: 1,
      customerOrderNo: 'A',
      orderedAt: '2026-08-10 13:00',
    }),
  ]
  const tiePlan = planGiftAssignments(
    tieRows,
    prefixPlan(tieRows),
    [
      request({
        id: 'req-1',
        styleRefs: [styleA],
        limitByStyle: { 'style-a': 1 },
      }),
    ],
    { seed: 1 },
  )
  assert(
    tiePlan.confirmCandidates[0]?.customerOrderNo === 'A',
    '같은 시각이면 주문번호 A 우선',
  )

  // 7) 취소한 주문은 재배정하지 않되, 해제된 한도는 다른 주문이 사용
  const cancelledRows = [
    row({
      rowNumber: 1,
      customerOrderNo: 'CANCELLED-1',
      orderedAt: '2026-08-11 08:00',
    }),
  ]
  const cancelledFingerprint = buildOrderFingerprint(cancelledRows[0]!)
  const cancelledPlan = planGiftAssignments(
    cancelledRows,
    prefixPlan(cancelledRows),
    [
      request({
        id: 'req-1',
        styleRefs: [styleA],
        limitByStyle: { 'style-a': 100 },
        usedByStyle: { 'style-a': 98 },
      }),
    ],
    {
      seed: 1,
      existingAllocations: [
        existingAllocation({
          requestId: 'req-1',
          itemId: 'item-1',
          styleId: styleA.styleId,
          styleNo: styleA.styleNo,
          styleName: styleA.name,
          mallName: '테스트몰',
          customerOrderNo: 'CANCELLED-1',
          orderedAt: '2026-08-11 08:00',
          orderFingerprint: cancelledFingerprint,
          allocationKey: buildAllocationKey(
            cancelledFingerprint,
            'item-1',
            styleA.styleId,
            1,
          ),
          giftSlotIndex: 1,
          cancelledAt: '2026-08-11T09:00:00Z',
        }),
      ],
    },
  )
  assert(cancelledPlan.giftCount === 0, '취소한 같은 주문은 자동 재배정 금지')
  assert(cancelledPlan.cancelledSkipCount === 1, '취소 이력 제외 집계')

  const afterCancel = planGiftAssignments(
    day2Rows,
    prefixPlan(day2Rows),
    [
      request({
        id: 'req-1',
        styleRefs: [styleA],
        limitByStyle: { 'style-a': 100 },
        usedByStyle: { 'style-a': 98 },
      }),
    ],
    { seed: 1 },
  )
  assert(afterCancel.giftCount === 1, '해제된 한도는 다른 주문에 배정 가능')
  assert(afterCancel.quotaPreviews[0]?.remainingCount === 1, '잔여 복구')

  // 8) 사은품 행 번호 재시작 — 합포장마다 1부터
  assert(
    formatGiftProductName(1, '사은품A') === '사은품(1) : 사은품A',
    '사은품 번호 형식',
  )
  const multiShipRows = [
    row({
      rowNumber: 1,
      customerOrderNo: 'M1',
      orderedAt: '2026-08-10 14:00',
      recipientName: '갑',
      recipientPhone: '01011111111',
    }),
    row({
      rowNumber: 2,
      customerOrderNo: 'M2',
      orderedAt: '2026-08-10 14:01',
      recipientName: '을',
      recipientPhone: '01022222222',
    }),
  ]
  const multiShipPlan = planGiftAssignments(
    multiShipRows,
    prefixPlan(multiShipRows),
    [
      request({
        id: 'req-1',
        styleRefs: [styleA],
        limitByStyle: { 'style-a': 10 },
      }),
    ],
    { seed: 1 },
  )
  assert(
    multiShipPlan.addedRows.every((item) =>
      item.productName.startsWith('사은품(1)'),
    ),
    '합포장마다 사은품(1)부터',
  )

  console.log('gift-assign first-come verify: OK')
}

run()
