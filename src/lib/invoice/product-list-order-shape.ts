import {
  orderKeyOf,
  shipmentKeyOf,
} from '@/lib/invoice/gift-assign'
import { parseOrderQuantity } from '@/lib/invoice/option-transform'
import type { InvoiceOutgoingComponentRow } from '@/lib/invoice/option-transform'
import type { SabangnetOrderRow } from '@/lib/invoice/sabangnet'

/** 상품 리스트 상위 필터. 합포장·단일·수량≠1 구매자. */
export type InvoiceProductListOrderShape =
  | 'combined'
  | 'single'
  | 'multi_qty'

export const INVOICE_PRODUCT_LIST_ORDER_SHAPES: {
  value: InvoiceProductListOrderShape
  label: string
}[] = [
  { value: 'combined', label: '합포장' },
  { value: 'single', label: '단일 행' },
  { value: 'multi_qty', label: '수량 1 아님' },
]

export const ALL_INVOICE_PRODUCT_LIST_ORDER_SHAPES: InvoiceProductListOrderShape[] =
  INVOICE_PRODUCT_LIST_ORDER_SHAPES.map((item) => item.value)

export type InvoiceProductListOrderShapeTotal = {
  shape: InvoiceProductListOrderShape
  /** 구매자(합포장/단일) 건수 */
  orderCount: number
  /** 원본 주문 행 수 */
  rowCount: number
}

export type InvoiceProductListOrderShapeIndex = {
  /** 행 번호 → 속한 형태들 */
  shapesByRow: Map<number, Set<InvoiceProductListOrderShape>>
  rowNumbersByShape: Record<InvoiceProductListOrderShape, Set<number>>
  totals: Record<
    InvoiceProductListOrderShape,
    InvoiceProductListOrderShapeTotal
  >
}

function bundleKeyOf(row: SabangnetOrderRow): string {
  return `${shipmentKeyOf(row)}\u0000${orderKeyOf(row)}`
}

function emptyTotals(): Record<
  InvoiceProductListOrderShape,
  InvoiceProductListOrderShapeTotal
> {
  return {
    combined: { shape: 'combined', orderCount: 0, rowCount: 0 },
    single: { shape: 'single', orderCount: 0, rowCount: 0 },
    multi_qty: { shape: 'multi_qty', orderCount: 0, rowCount: 0 },
  }
}

/**
 * 받는분·주문일시 기준으로 합포장/단일/수량≠1 구매자를 나눈다.
 * 수량≠1이면 그 합포장(또는 단일) 전체를 같은 그룹으로 묶는다.
 */
export function buildInvoiceProductListOrderShapeIndex(
  sources: SabangnetOrderRow[],
): InvoiceProductListOrderShapeIndex {
  const shapesByRow = new Map<number, Set<InvoiceProductListOrderShape>>()
  const rowNumbersByShape: Record<
    InvoiceProductListOrderShape,
    Set<number>
  > = {
    combined: new Set(),
    single: new Set(),
    multi_qty: new Set(),
  }
  const totals = emptyTotals()
  if (sources.length === 0) {
    return { shapesByRow, rowNumbersByShape, totals }
  }

  const rowsByBundle = new Map<string, SabangnetOrderRow[]>()
  for (const row of sources) {
    const key = bundleKeyOf(row)
    const list = rowsByBundle.get(key)
    if (list) list.push(row)
    else rowsByBundle.set(key, [row])
  }

  for (const bundleRows of rowsByBundle.values()) {
    const isCombined = bundleRows.length > 1
    const hasMultiQty = bundleRows.some(
      (row) => parseOrderQuantity(row.quantity) !== 1,
    )
    const shapes = new Set<InvoiceProductListOrderShape>()
    if (isCombined) shapes.add('combined')
    else shapes.add('single')
    if (hasMultiQty) shapes.add('multi_qty')

    for (const shape of shapes) {
      totals[shape].orderCount += 1
      totals[shape].rowCount += bundleRows.length
    }
    for (const row of bundleRows) {
      shapesByRow.set(row.rowNumber, new Set(shapes))
      for (const shape of shapes) {
        rowNumbersByShape[shape].add(row.rowNumber)
      }
    }
  }

  return { shapesByRow, rowNumbersByShape, totals }
}

/** 선택된 형태에 속하는 원본 행만 남긴다. 포장재(행 0)는 항상 유지. */
export function filterInvoiceOutgoingRowsByOrderShapes(
  rows: InvoiceOutgoingComponentRow[],
  index: InvoiceProductListOrderShapeIndex,
  selected: Iterable<InvoiceProductListOrderShape>,
): InvoiceOutgoingComponentRow[] {
  const selectedSet = new Set(selected)
  if (selectedSet.size === 0) {
    return rows.filter(
      (row) => row.listOrigin === 'packing' || row.role === 'packing',
    )
  }
  if (
    ALL_INVOICE_PRODUCT_LIST_ORDER_SHAPES.every((shape) =>
      selectedSet.has(shape),
    )
  ) {
    return rows
  }

  const allowed = new Set<number>()
  for (const shape of selectedSet) {
    for (const rowNumber of index.rowNumbersByShape[shape]) {
      allowed.add(rowNumber)
    }
  }

  return rows.filter((row) => {
    if (row.listOrigin === 'packing' || row.role === 'packing') return true
    return allowed.has(row.sourceRowNumber)
  })
}
