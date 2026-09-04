import { normalizeStyleNo } from '@/lib/import/transform'
import {
  buildOutgoingComponentRowsFromStages,
  type InvoiceItemNameTransformation,
  type InvoiceItemNameTransformRow,
} from '@/lib/invoice/item-name-transform'
import {
  type InvoiceMallResolution,
  usageTargetIdForMallName,
} from '@/lib/invoice/mall-resolution'
import { orderMomentOf } from '@/lib/invoice/prefix-transform'
import {
  classifyInvoiceProductListRow,
  type InvoiceProductListCategory,
} from '@/lib/invoice/product-list-summary'
import type {
  InvoiceProductNameTransformation,
  InvoiceProductNameTransformRow,
} from '@/lib/invoice/product-name-transform'
import type { SabangnetOrderRow } from '@/lib/invoice/sabangnet'
import type { StyleRef } from '@/lib/types'

const REFLECT_CATEGORIES = new Set<InvoiceProductListCategory>([
  'product',
  'component',
])

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const UNRESOLVED_PRODUCT_STATUSES = new Set([
  'unresolved',
  'conflict',
  'missing_style',
  'exclusion_guarded',
])

const UNRESOLVED_ITEM_STATUSES = new Set(['unresolved', 'conflict'])

export type OutboundReflectProductEntry = {
  styleNo: string
  styleName: string
  quantity: number
  firstOrderedOn: string
  lastOrderedOn: string
}

export type OutboundReflectSummary = {
  entries: OutboundReflectProductEntry[]
  styleCount: number
  totalQuantity: number
  firstOrderedOn: string | null
  lastOrderedOn: string | null
}

export type OutboundReflectLedgerEntry = {
  shippedOn: string
  usageTargetId: string
  styleId: string
  styleNo: string
  styleName: string
  quantity: number
}

export type OutboundReflectBlockReason =
  | { code: 'unresolved_product'; count: number }
  | { code: 'unresolved_item'; count: number }
  | { code: 'missing_ordered_on'; count: number }
  | { code: 'unresolved_mall'; count: number }
  | { code: 'missing_style'; count: number }
  | { code: 'empty' }

export type OutboundReflectLedger =
  | {
      ok: true
      entries: OutboundReflectLedgerEntry[]
      styleCount: number
      totalQuantity: number
      firstOrderedOn: string | null
      lastOrderedOn: string | null
    }
  | {
      ok: false
      reasons: OutboundReflectBlockReason[]
    }

function orderedOnOf(row: SabangnetOrderRow): string | null {
  const moment = orderMomentOf(row)
  if (!moment) return null
  const date = moment.slice(0, 10)
  return ISO_DATE_RE.test(date) ? date : null
}

function isSkippedProductRow(row: InvoiceProductNameTransformRow) {
  return (
    row.status === 'excluded' ||
    row.status === 'gift_pending' ||
    row.status === 'gift_mapped'
  )
}

function addStyleRef(
  map: Map<string, StyleRef>,
  style: StyleRef | null | undefined,
) {
  if (!style?.styleId) return
  const styleNo = normalizeStyleNo(style.styleNo)
  if (!styleNo) return
  if (!map.has(styleNo)) map.set(styleNo, style)
}

function collectStyleRefs(
  productTransformation: InvoiceProductNameTransformation,
  itemTransformation: InvoiceItemNameTransformation,
): Map<string, StyleRef> {
  const map = new Map<string, StyleRef>()
  for (const row of productTransformation.rows) {
    addStyleRef(map, row.style)
    for (const replacement of row.giftReplacements ?? []) {
      addStyleRef(map, replacement.style)
    }
  }
  for (const row of itemTransformation.rows) {
    addStyleRef(map, row.productStyle)
    for (const extra of row.extras) addStyleRef(map, extra.style)
    for (const extra of row.productExtras) addStyleRef(map, extra.style)
    for (const extra of row.itemExtras) addStyleRef(map, extra.style)
  }
  return map
}

function pickStyleName(
  existing: string,
  incoming: string,
  styleNo: string,
): string {
  const incomingName = incoming.trim()
  const incomingIsFallback =
    !incomingName || normalizeStyleNo(incomingName) === styleNo
  const existingIsFallback =
    !existing || normalizeStyleNo(existing) === styleNo
  if (existingIsFallback && !incomingIsFallback) return incomingName
  return existing
}

function dateRangeOf(
  entries: Array<{ firstOrderedOn?: string; lastOrderedOn?: string; shippedOn?: string }>,
): { firstOrderedOn: string | null; lastOrderedOn: string | null } {
  let firstOrderedOn: string | null = null
  let lastOrderedOn: string | null = null
  for (const entry of entries) {
    const first = entry.firstOrderedOn || entry.shippedOn || ''
    const last = entry.lastOrderedOn || entry.shippedOn || ''
    if (first && (!firstOrderedOn || first < firstOrderedOn)) {
      firstOrderedOn = first
    }
    if (last && (!lastOrderedOn || last > lastOrderedOn)) {
      lastOrderedOn = last
    }
  }
  return { firstOrderedOn, lastOrderedOn }
}

/**
 * 품목명·내품명 변환에서 나온 본품·내품을 M번호로 합치고
 * 수량 총합과 주문일시 첫·끝 날짜를 붙인다.
 */
export function summarizeOutboundReflectProducts(input: {
  productTransformation: InvoiceProductNameTransformation
  itemTransformation: InvoiceItemNameTransformation
}): OutboundReflectSummary {
  const orderedOnByRow = new Map<number, string | null>()
  for (const row of input.productTransformation.rows) {
    orderedOnByRow.set(row.source.rowNumber, orderedOnOf(row.source))
  }

  const outgoing = buildOutgoingComponentRowsFromStages({
    productRows: input.productTransformation.rows,
    itemRows: input.itemTransformation.rows,
    giftRowsBySource: new Map(),
  })

  const byStyle = new Map<
    string,
    {
      styleNo: string
      styleName: string
      quantity: number
      firstOrderedOn: string | null
      lastOrderedOn: string | null
    }
  >()

  for (const row of outgoing) {
    const category = classifyInvoiceProductListRow(row)
    if (category === 'unresolved' || !REFLECT_CATEGORIES.has(category)) continue
    const styleNo = normalizeStyleNo(row.styleNo)
    if (!styleNo) continue

    const quantity = Number.isFinite(row.quantity) ? row.quantity : 0
    if (quantity <= 0) continue

    const orderedOn = orderedOnByRow.get(row.sourceRowNumber) ?? null
    const incomingName = row.styleName.trim()
    const incomingIsFallback =
      !incomingName || normalizeStyleNo(incomingName) === styleNo
    const existing = byStyle.get(styleNo)
    if (!existing) {
      byStyle.set(styleNo, {
        styleNo,
        styleName: incomingIsFallback ? styleNo : incomingName,
        quantity,
        firstOrderedOn: orderedOn,
        lastOrderedOn: orderedOn,
      })
      continue
    }

    existing.quantity += quantity
    existing.styleName = pickStyleName(
      existing.styleName,
      incomingName,
      styleNo,
    )
    if (orderedOn) {
      if (!existing.firstOrderedOn || orderedOn < existing.firstOrderedOn) {
        existing.firstOrderedOn = orderedOn
      }
      if (!existing.lastOrderedOn || orderedOn > existing.lastOrderedOn) {
        existing.lastOrderedOn = orderedOn
      }
    }
  }

  const entries = [...byStyle.values()]
    .map((item) => ({
      styleNo: item.styleNo,
      styleName: item.styleName,
      quantity: item.quantity,
      firstOrderedOn: item.firstOrderedOn ?? '',
      lastOrderedOn: item.lastOrderedOn ?? '',
    }))
    .sort(
      (left, right) =>
        left.styleNo.localeCompare(right.styleNo, 'ko-KR') ||
        left.styleName.localeCompare(right.styleName, 'ko-KR'),
    )

  const { firstOrderedOn, lastOrderedOn } = dateRangeOf(entries)

  return {
    entries,
    styleCount: entries.length,
    totalQuantity: entries.reduce((sum, item) => sum + item.quantity, 0),
    firstOrderedOn,
    lastOrderedOn,
  }
}

function countReason(
  reasons: Map<OutboundReflectBlockReason['code'], number>,
  code: Exclude<OutboundReflectBlockReason['code'], 'empty'>,
) {
  reasons.set(code, (reasons.get(code) ?? 0) + 1)
}

function itemRowBySource(
  itemTransformation: InvoiceItemNameTransformation,
): Map<number, InvoiceItemNameTransformRow> {
  return new Map(
    itemTransformation.rows.map((row) => [row.source.rowNumber, row]),
  )
}

/**
 * 본품·내품만 주문일·출고업체·SKU로 합친다.
 * 미해결·날짜 누락·업체 미연결·styleId 누락이 있으면 부분 저장하지 않는다.
 */
export function buildOutboundReflectLedger(input: {
  productTransformation: InvoiceProductNameTransformation
  itemTransformation: InvoiceItemNameTransformation
  mallResolution: InvoiceMallResolution
}): OutboundReflectLedger {
  const reasons = new Map<OutboundReflectBlockReason['code'], number>()
  const itemsByRow = itemRowBySource(input.itemTransformation)
  const styleByNo = collectStyleRefs(
    input.productTransformation,
    input.itemTransformation,
  )
  const productByRow = new Map(
    input.productTransformation.rows.map((row) => [
      row.source.rowNumber,
      row,
    ]),
  )
  const sourceByRow = new Map<number, SabangnetOrderRow>()

  for (const row of input.productTransformation.rows) {
    sourceByRow.set(row.source.rowNumber, row.source)
    if (isSkippedProductRow(row)) continue
    if (UNRESOLVED_PRODUCT_STATUSES.has(row.status) || !row.style?.styleId) {
      countReason(reasons, 'unresolved_product')
    }
    const item = itemsByRow.get(row.source.rowNumber)
    if (item && UNRESOLVED_ITEM_STATUSES.has(item.status)) {
      countReason(reasons, 'unresolved_item')
    }
    if (!orderedOnOf(row.source)) {
      countReason(reasons, 'missing_ordered_on')
    }
    if (!usageTargetIdForMallName(row.source.mallName, input.mallResolution)) {
      countReason(reasons, 'unresolved_mall')
    }
  }

  const outgoing = buildOutgoingComponentRowsFromStages({
    productRows: input.productTransformation.rows,
    itemRows: input.itemTransformation.rows,
    giftRowsBySource: new Map(),
  })

  const merged = new Map<string, OutboundReflectLedgerEntry>()

  for (const row of outgoing) {
    const category = classifyInvoiceProductListRow(row)
    if (category !== 'unresolved' && !REFLECT_CATEGORIES.has(category)) continue
    const source = sourceByRow.get(row.sourceRowNumber)
    if (!source) continue
    const product = productByRow.get(row.sourceRowNumber)
    if (product && isSkippedProductRow(product)) continue

    const quantity = Number.isFinite(row.quantity) ? row.quantity : 0
    if (quantity <= 0) continue

    const styleNo = normalizeStyleNo(row.styleNo)
    const style = styleNo ? styleByNo.get(styleNo) : undefined
    if (category === 'unresolved' || !styleNo || !style?.styleId) {
      countReason(reasons, 'missing_style')
      continue
    }

    const shippedOn = orderedOnOf(source)
    const usageTargetId = usageTargetIdForMallName(
      source.mallName,
      input.mallResolution,
    )
    if (!shippedOn || !usageTargetId) continue

    const key = `${shippedOn}\u0000${usageTargetId}\u0000${style.styleId}`
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, {
        shippedOn,
        usageTargetId,
        styleId: style.styleId,
        styleNo,
        styleName: pickStyleName(style.name, row.styleName, styleNo),
        quantity,
      })
      continue
    }
    existing.quantity += quantity
    existing.styleName = pickStyleName(
      existing.styleName,
      row.styleName,
      styleNo,
    )
  }

  if (reasons.size > 0) {
    return {
      ok: false,
      reasons: [...reasons.entries()].map(([code, count]) =>
        code === 'empty' ? { code, count: 0 } : { code, count },
      ),
    }
  }

  const entries = [...merged.values()].sort(
    (left, right) =>
      left.shippedOn.localeCompare(right.shippedOn) ||
      left.usageTargetId.localeCompare(right.usageTargetId) ||
      left.styleNo.localeCompare(right.styleNo, 'ko-KR'),
  )

  if (entries.length === 0) {
    return { ok: false, reasons: [{ code: 'empty' }] }
  }

  const styleIds = new Set(entries.map((entry) => entry.styleId))
  const { firstOrderedOn, lastOrderedOn } = dateRangeOf(entries)
  return {
    ok: true,
    entries,
    styleCount: styleIds.size,
    totalQuantity: entries.reduce((sum, item) => sum + item.quantity, 0),
    firstOrderedOn,
    lastOrderedOn,
  }
}

export function formatOutboundReflectBlockReasons(
  reasons: readonly OutboundReflectBlockReason[],
): string {
  const labels: string[] = []
  for (const reason of reasons) {
    if (reason.code === 'empty') {
      labels.push('변환된 상품이 없습니다.')
      continue
    }
    const count = `${reason.count}행`
    if (reason.code === 'unresolved_product') {
      labels.push(`품목명 미해결 ${count}`)
    } else if (reason.code === 'unresolved_item') {
      labels.push(`내품명 미해결 ${count}`)
    } else if (reason.code === 'missing_ordered_on') {
      labels.push(`주문일시 없음 ${count}`)
    } else if (reason.code === 'unresolved_mall') {
      labels.push(`출고업체 미연결 ${count}`)
    } else {
      labels.push(`상품 연결 없음 ${count}`)
    }
  }
  return labels.join(' · ')
}
