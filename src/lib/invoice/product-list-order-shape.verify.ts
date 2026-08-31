/**
 * 상품 리스트 합포장·단일·수량≠1 필터 검증.
 * 실행: node --experimental-strip-types 대신 vite verify 스크립트 사용.
 */
import {
  buildInvoiceProductListOrderShapeIndex,
  filterInvoiceOutgoingRowsByOrderShapes,
} from '@/lib/invoice/product-list-order-shape'
import type { InvoiceOutgoingComponentRow } from '@/lib/invoice/option-transform'
import type { SabangnetOrderRow } from '@/lib/invoice/sabangnet'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
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

function outgoing(
  sourceRowNumber: number,
  styleNo: string,
  quantity: number,
): InvoiceOutgoingComponentRow {
  return {
    sourceRowNumber,
    customerOrderNo: '',
    mallName: '',
    productName: '',
    itemName: '',
    role: 'main',
    styleNo,
    styleName: styleNo,
    quantity,
    source: 'map',
    listOrigin: 'product_main',
  }
}

const combinedA = row(1)
const combinedB = row(2, { productName: '형제' })
const single = row(3, {
  recipientName: '단일',
  recipientPhone: '010-3333-4444',
  recipientAddress: '부산',
})
const multiQty = row(4, {
  recipientName: '복수',
  recipientPhone: '010-5555-6666',
  recipientAddress: '대구',
  quantity: '3',
})
const multiBundleHold = row(5, {
  recipientName: '혼합',
  recipientPhone: '010-7777-8888',
  recipientAddress: '인천',
  quantity: '2',
})
const multiBundleSibling = row(6, {
  recipientName: '혼합',
  recipientPhone: '010-7777-8888',
  recipientAddress: '인천',
  quantity: '1',
  productName: '형제2',
})

const index = buildInvoiceProductListOrderShapeIndex([
  combinedA,
  combinedB,
  single,
  multiQty,
  multiBundleHold,
  multiBundleSibling,
])

assert(index.totals.combined.orderCount === 2, '합포장 2건')
assert(index.totals.combined.rowCount === 4, '합포장 4행')
assert(index.totals.single.orderCount === 2, '단일 2건')
assert(index.totals.multi_qty.orderCount === 2, '수량≠1 구매자 2건')
assert(index.rowNumbersByShape.multi_qty.has(6), '수량≠1 합포장은 형제 포함')
assert(index.shapesByRow.get(1)?.has('combined'), '합포장 표시')
assert(index.shapesByRow.get(3)?.has('single'), '단일 표시')

const rows = [
  outgoing(1, 'M1', 1),
  outgoing(2, 'M2', 1),
  outgoing(3, 'M3', 1),
  outgoing(4, 'M4', 3),
  outgoing(5, 'M5', 2),
  outgoing(6, 'M6', 1),
  {
    ...outgoing(0, 'P1', 10),
    role: 'packing' as const,
    listOrigin: 'packing' as const,
    source: 'packing' as const,
  },
]

const combinedOnly = filterInvoiceOutgoingRowsByOrderShapes(rows, index, [
  'combined',
])
assert(
  combinedOnly.map((item) => item.sourceRowNumber).join(',') === '1,2,5,6,0',
  '합포장+포장재',
)

const multiOnly = filterInvoiceOutgoingRowsByOrderShapes(rows, index, [
  'multi_qty',
])
assert(
  multiOnly.map((item) => item.sourceRowNumber).join(',') === '4,5,6,0',
  '수량≠1+형제+포장재',
)

console.log('product-list-order-shape verify: ok')
