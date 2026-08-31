/**
 * 단종·예발 → 수령인·주문일시 묶음 매칭 검증.
 * 실행: npm run verify:stock-hold-match
 */
import {
  buildStockHoldCandidateBundles,
  excludedRowNumbersFromStockHoldBundles,
  stockHoldBundleKeyOf,
} from '@/lib/invoice/stock-hold-match'
import type { InvoiceProductNameTransformRow } from '@/lib/invoice/product-name-transform'
import type { SabangnetOrderRow } from '@/lib/invoice/sabangnet'
import type {
  InvoiceDiscontinuedStyle,
  InvoicePreorderHold,
  StyleRef,
} from '@/lib/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function style(id: string, no: string, name: string): StyleRef {
  return { styleId: id, styleNo: no, name }
}

function row(
  rowNumber: number,
  patch: Partial<SabangnetOrderRow> = {},
): SabangnetOrderRow {
  return {
    rowNumber,
    productName: '상품',
    itemName: '',
    quantity: '1',
    recipientName: '김테스트',
    recipientPhone: '010-1111-2222',
    recipientOtherPhone: '',
    shippingType: '선불',
    recipientAddress: '서울 테스트로 1',
    shippingMessage: '',
    customerOrderNo: `ORD-${rowNumber}`,
    mallName: '테스트몰',
    orderedAt: '2026-08-31 10:00',
    ownProductCode: '',
    ...patch,
  }
}

function productRow(
  source: SabangnetOrderRow,
  styleRef: StyleRef | null,
): InvoiceProductNameTransformRow {
  return {
    source,
    status: styleRef ? 'mapped' : 'unresolved',
    mapId: styleRef ? 'map-1' : null,
    style: styleRef,
    transformedProductName: styleRef?.name ?? source.productName,
    appliedRule: null,
    appliedLookupKey: null,
    itemNameConsumed: false,
    effectiveItemName: source.itemName,
    candidates: [],
    candidateStyles: [],
    tags: [],
    itemTags: [],
  }
}

const discontinuedStyle = style('style-disc', 'M0001', '단종백')
const preorderStyle = style('style-pre', 'M0002', '예발코트')
const normalStyle = style('style-ok', 'M0003', '정상상품')

const discontinued: InvoiceDiscontinuedStyle[] = [
  {
    id: 'd1',
    brandId: 'brand-1',
    styleId: discontinuedStyle.styleId,
    styleNo: discontinuedStyle.styleNo,
    name: discontinuedStyle.name,
    note: '시즌 종료',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  },
]

const preorderHolds: InvoicePreorderHold[] = [
  {
    id: 'h1',
    brandId: 'brand-1',
    styleId: preorderStyle.styleId,
    styleNo: preorderStyle.styleNo,
    name: preorderStyle.name,
    startedOn: '2026-08-20',
    shipOn: '2026-09-10',
    reason: '입고 지연',
    status: 'active',
    endedOn: null,
    endedReason: '',
    clearedAt: null,
    extensions: [],
    createdAt: '2026-08-20T00:00:00Z',
    updatedAt: '2026-08-20T00:00:00Z',
  },
]

const matchRow = row(1, { productName: '단종백' })
const siblingRow = row(2, {
  productName: '다른상품',
  itemName: '블랙',
})
const otherOrder = row(3, {
  recipientName: '다른사람',
  recipientPhone: '010-9999-0000',
  productName: '단종백',
})
const preorderRow = row(4, {
  recipientName: '이예발',
  recipientPhone: '010-3333-4444',
  recipientAddress: '부산 예발로 2',
  productName: '예발코트',
  orderedAt: '2026-08-31 11:00',
})
const normalRow = row(5, {
  recipientName: '박정상',
  recipientPhone: '010-5555-6666',
  recipientAddress: '대구 정상로 3',
  productName: '정상상품',
})

assert(
  stockHoldBundleKeyOf(matchRow) === stockHoldBundleKeyOf(siblingRow),
  '같은 수령인·주문일시는 같은 묶음 키',
)
assert(
  stockHoldBundleKeyOf(matchRow) !== stockHoldBundleKeyOf(otherOrder),
  '수령인이 다르면 다른 묶음',
)

const bundles = buildStockHoldCandidateBundles({
  sourceRows: [matchRow, siblingRow, otherOrder, preorderRow, normalRow],
  productRows: [
    productRow(matchRow, discontinuedStyle),
    productRow(siblingRow, normalStyle),
    productRow(otherOrder, discontinuedStyle),
    productRow(preorderRow, preorderStyle),
    productRow(normalRow, normalStyle),
  ],
  discontinued,
  preorderHolds,
})

assert(bundles.length === 3, `단종 2묶음 + 예발 1묶음, got ${bundles.length}`)

const firstDisc = bundles.find(
  (item) =>
    item.reasons.includes('discontinued') &&
    item.recipientName === '김테스트',
)
assert(firstDisc, '김테스트 단종 묶음')
assert(firstDisc.affectedRowCount === 2, '형제 행까지 묶음')
assert(
  firstDisc.rowNumbers.join(',') === '1,2',
  '묶음 행 번호',
)
assert(firstDisc.lines.length === 2, '묶음 행을 펼쳐 담는다')
assert(firstDisc.lines[0]?.matched === true, '직접 매칭 행')
assert(firstDisc.lines[1]?.matched === false, '형제 행')
assert(
  firstDisc.lines[0]?.productName === '단종백',
  '품목명은 변환 후 값',
)
assert(firstDisc.matchedRowCount === 1, '직접 매칭은 1행')
assert(firstDisc.excluded === true, '기본 제외')
assert(
  firstDisc.triggers.some((t) => t.styleNo === 'M0001'),
  '단종 트리거',
)

const otherDisc = bundles.find(
  (item) => item.recipientName === '다른사람',
)
assert(otherDisc?.affectedRowCount === 1, '다른 수령인은 단독')

const reservation = bundles.find((item) =>
  item.reasons.includes('reservation'),
)
assert(reservation?.recipientName === '이예발', '예발 묶음')
assert(
  reservation?.triggers[0]?.detail.includes('2026-09-10'),
  '예발 예정일 표시',
)

const endedOnly = buildStockHoldCandidateBundles({
  sourceRows: [preorderRow],
  productRows: [productRow(preorderRow, preorderStyle)],
  discontinued: [],
  preorderHolds: [{ ...preorderHolds[0]!, status: 'ended' }],
})
assert(endedOnly.length === 0, '종료된 예발은 후보에서 제외')

const excluded = excludedRowNumbersFromStockHoldBundles(
  bundles.map((item) => ({
    ...item,
    lines: item.lines.map((line) => ({
      ...line,
      // 다른사람 묶음만 전부 진행(제외 해제)
      excluded: item.recipientName !== '다른사람',
    })),
  })),
)
assert(
  excluded.join(',') === '1,2,4',
  `유지한 합포장은 제외 목록에서 빠짐: ${excluded.join(',')}`,
)

const partial = excludedRowNumbersFromStockHoldBundles([
  {
    lines: [
      { rowNumber: 1, excluded: true },
      { rowNumber: 2, excluded: false },
    ],
  },
])
assert(
  partial.join(',') === '1',
  `부분 출고 시 풀어 둔 행만 제외 목록에서 빠짐: ${partial.join(',')}`,
)

console.log('stock-hold-match verify: ok')
