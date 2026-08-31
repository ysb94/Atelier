import {
  orderKeyOf,
  shipmentKeyOf,
} from '@/lib/invoice/gift-assign'
import type { InvoiceItemNameTransformRow } from '@/lib/invoice/item-name-transform'
import type { InvoiceProductNameTransformRow } from '@/lib/invoice/product-name-transform'
import type { SabangnetOrderRow } from '@/lib/invoice/sabangnet'
import type {
  InvoiceDiscontinuedStyle,
  InvoicePreorderHold,
} from '@/lib/types'

export type InvoiceStockHoldReason =
  | 'discontinued'
  | 'out_of_stock'
  | 'reservation'

export type StockHoldTriggerStyle = {
  reason: Exclude<InvoiceStockHoldReason, 'out_of_stock'>
  styleId: string
  styleNo: string
  styleName: string
  detail: string
}

/** 묶음 안 개별 주문 행. */
export type StockHoldBundleLine = {
  rowNumber: number
  productName: string
  itemName: string
  quantity: string
  /** 단종·예발이 이 행에 직접 걸렸는지 */
  matched: boolean
  /** 이 행에 걸린 트리거. 합포장 형제면 빈 배열 */
  triggers: StockHoldTriggerStyle[]
  /** 기본 제외. 행마다 풀어 부분 출고할 수 있다 */
  excluded: boolean
}

/** 재고·예약 단계 후보. 같은 수령인·주문일시 합포장 단위. */
export type StockHoldCandidateBundle = {
  key: string
  reasons: Array<Exclude<InvoiceStockHoldReason, 'out_of_stock'>>
  triggers: StockHoldTriggerStyle[]
  recipientName: string
  recipientPhone: string
  recipientAddress: string
  mallName: string
  orderedAt: string
  /** 단종·예발 상품이 직접 걸린 행 수 */
  matchedRowCount: number
  /** 합포장 전체 행 수 (형제 포함) */
  affectedRowCount: number
  rowNumbers: number[]
  /** 화면용. 합포장 안 주문 행을 하나씩 펼친 목록 */
  lines: StockHoldBundleLine[]
  /**
   * 합포장 전체가 제외인지. 행별 제외가 섞이면 false.
   * 기본 후보는 전 행 제외라 true.
   */
  excluded: boolean
}

export function stockHoldBundleKeyOf(row: SabangnetOrderRow): string {
  return `${shipmentKeyOf(row)}\u0000${orderKeyOf(row)}`
}

function reasonRank(reason: Exclude<InvoiceStockHoldReason, 'out_of_stock'>) {
  return reason === 'discontinued' ? 0 : 1
}

function collectMatchedStyleIds(
  productRow: InvoiceProductNameTransformRow | undefined,
  itemRow: InvoiceItemNameTransformRow | undefined,
  holdStyleIds: Set<string>,
): string[] {
  const found = new Set<string>()
  const productStyleId = productRow?.style?.styleId
  if (productStyleId && holdStyleIds.has(productStyleId)) {
    found.add(productStyleId)
  }
  if (itemRow) {
    const productStyleIdFromItem = itemRow.productStyle?.styleId
    if (productStyleIdFromItem && holdStyleIds.has(productStyleIdFromItem)) {
      found.add(productStyleIdFromItem)
    }
    for (const group of [
      itemRow.extras,
      itemRow.productExtras,
      itemRow.itemExtras,
    ]) {
      for (const component of group) {
        const id = component.style.styleId
        if (holdStyleIds.has(id)) found.add(id)
      }
    }
  }
  return [...found]
}

/**
 * 기준정보의 단종·활성 예발 상품이 걸린 주문 행을 찾고,
 * 받는분성명·전화·주소·쇼핑몰명·주문일시가 같은 행을 묶음으로 펼친다.
 */
export function buildStockHoldCandidateBundles(input: {
  sourceRows: SabangnetOrderRow[]
  productRows: InvoiceProductNameTransformRow[]
  itemRows?: InvoiceItemNameTransformRow[] | null
  discontinued: InvoiceDiscontinuedStyle[]
  preorderHolds: InvoicePreorderHold[]
}): StockHoldCandidateBundle[] {
  const discontinuedByStyleId = new Map(
    input.discontinued.map((item) => [item.styleId, item]),
  )
  const preorderByStyleId = new Map(
    input.preorderHolds
      .filter((hold) => hold.status === 'active')
      .map((hold) => [hold.styleId, hold]),
  )
  const holdStyleIds = new Set([
    ...discontinuedByStyleId.keys(),
    ...preorderByStyleId.keys(),
  ])
  if (holdStyleIds.size === 0 || input.sourceRows.length === 0) return []

  const productByRow = new Map(
    input.productRows.map((row) => [row.source.rowNumber, row]),
  )
  const itemByRow = new Map(
    (input.itemRows ?? []).map((row) => [row.source.rowNumber, row]),
  )

  const rowsByBundle = new Map<string, SabangnetOrderRow[]>()
  for (const row of input.sourceRows) {
    const key = stockHoldBundleKeyOf(row)
    const list = rowsByBundle.get(key)
    if (list) list.push(row)
    else rowsByBundle.set(key, [row])
  }

  function triggerForStyleId(
    styleId: string,
  ): StockHoldTriggerStyle | null {
    const discontinued = discontinuedByStyleId.get(styleId)
    if (discontinued) {
      return {
        reason: 'discontinued',
        styleId,
        styleNo: discontinued.styleNo,
        styleName: discontinued.name,
        detail: discontinued.note.trim() || '단종 리스트에 등록된 상품입니다.',
      }
    }
    const preorder = preorderByStyleId.get(styleId)
    if (preorder) {
      return {
        reason: 'reservation',
        styleId,
        styleNo: preorder.styleNo,
        styleName: preorder.name,
        detail: `예발 ${preorder.shipOn} · ${preorder.reason}`,
      }
    }
    return null
  }

  type Acc = {
    triggers: Map<string, StockHoldTriggerStyle>
    matchedRowNumbers: Set<number>
    lineTriggers: Map<number, StockHoldTriggerStyle[]>
  }
  const matchedBundles = new Map<string, Acc>()

  for (const row of input.sourceRows) {
    const styleIds = collectMatchedStyleIds(
      productByRow.get(row.rowNumber),
      itemByRow.get(row.rowNumber),
      holdStyleIds,
    )
    if (styleIds.length === 0) continue

    const bundleKey = stockHoldBundleKeyOf(row)
    let acc = matchedBundles.get(bundleKey)
    if (!acc) {
      acc = {
        triggers: new Map(),
        matchedRowNumbers: new Set(),
        lineTriggers: new Map(),
      }
      matchedBundles.set(bundleKey, acc)
    }
    acc.matchedRowNumbers.add(row.rowNumber)

    const lineTriggers: StockHoldTriggerStyle[] = []
    for (const styleId of styleIds) {
      const trigger = triggerForStyleId(styleId)
      if (!trigger) continue
      lineTriggers.push(trigger)
      if (!acc.triggers.has(styleId)) acc.triggers.set(styleId, trigger)
    }
    lineTriggers.sort((left, right) => {
      const byReason = reasonRank(left.reason) - reasonRank(right.reason)
      if (byReason !== 0) return byReason
      return left.styleNo.localeCompare(right.styleNo, 'ko')
    })
    acc.lineTriggers.set(row.rowNumber, lineTriggers)
  }

  const bundles: StockHoldCandidateBundle[] = []
  for (const [bundleKey, acc] of matchedBundles) {
    const bundleRows = [...(rowsByBundle.get(bundleKey) ?? [])].sort(
      (left, right) => left.rowNumber - right.rowNumber,
    )
    const sample = bundleRows[0]
    if (!sample) continue
    const triggers = [...acc.triggers.values()].sort((left, right) => {
      const byReason = reasonRank(left.reason) - reasonRank(right.reason)
      if (byReason !== 0) return byReason
      return left.styleNo.localeCompare(right.styleNo, 'ko')
    })
    const reasonSet = new Set(triggers.map((item) => item.reason))
    const reasons = [...reasonSet].sort(
      (left, right) => reasonRank(left) - reasonRank(right),
    )
    const rowNumbers = bundleRows.map((row) => row.rowNumber)
    const lines: StockHoldBundleLine[] = bundleRows.map((row) => {
      const productRow = productByRow.get(row.rowNumber)
      const itemRow = itemByRow.get(row.rowNumber)
      return {
        rowNumber: row.rowNumber,
        productName:
          productRow?.transformedProductName.trim() || row.productName,
        itemName:
          itemRow?.transformedItemName ??
          productRow?.effectiveItemName ??
          row.itemName,
        quantity: row.quantity,
        matched: acc.matchedRowNumbers.has(row.rowNumber),
        triggers: acc.lineTriggers.get(row.rowNumber) ?? [],
        excluded: true,
      }
    })

    bundles.push({
      key: bundleKey,
      reasons,
      triggers,
      recipientName: sample.recipientName,
      recipientPhone: sample.recipientPhone || sample.recipientOtherPhone,
      recipientAddress: sample.recipientAddress,
      mallName: sample.mallName,
      orderedAt: sample.orderedAt,
      matchedRowCount: acc.matchedRowNumbers.size,
      affectedRowCount: rowNumbers.length,
      rowNumbers,
      lines,
      excluded: true,
    })
  }

  return bundles.sort((left, right) => {
    const leftReason = left.reasons[0] ?? 'reservation'
    const rightReason = right.reasons[0] ?? 'reservation'
    const byReason = reasonRank(leftReason) - reasonRank(rightReason)
    if (byReason !== 0) return byReason
    return left.rowNumbers[0]! - right.rowNumbers[0]!
  })
}

export function excludedRowNumbersFromStockHoldBundles(
  bundles: Array<{
    lines: Array<Pick<StockHoldBundleLine, 'rowNumber' | 'excluded'>>
  }>,
): number[] {
  const next = new Set<number>()
  for (const bundle of bundles) {
    for (const line of bundle.lines) {
      if (!line.excluded) continue
      next.add(line.rowNumber)
    }
  }
  return [...next].sort((left, right) => left - right)
}
