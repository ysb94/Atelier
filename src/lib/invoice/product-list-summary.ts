import { normalizeStyleNo } from '@/lib/import/transform'
import type { InvoiceOutgoingComponentRow } from '@/lib/invoice/option-transform'

export type InvoiceProductListCategory =
  | 'product'
  | 'component'
  | 'gift'
  | 'packing'

export const INVOICE_PRODUCT_LIST_CATEGORIES: {
  value: InvoiceProductListCategory
  label: string
}[] = [
  { value: 'product', label: '품목' },
  { value: 'component', label: '내품·세트' },
  { value: 'gift', label: '사은품' },
  { value: 'packing', label: '포장재' },
]

export const ALL_INVOICE_PRODUCT_LIST_CATEGORIES: InvoiceProductListCategory[] =
  INVOICE_PRODUCT_LIST_CATEGORIES.map((item) => item.value)

export type InvoiceProductListEntry = {
  styleNo: string
  styleName: string
  quantity: number
}

export type InvoiceProductListUnresolved = {
  rowCount: number
  quantity: number
}

export type InvoiceProductListCategoryTotal = {
  category: InvoiceProductListCategory
  styleCount: number
  quantity: number
}

export type InvoiceProductListSummary = {
  entries: InvoiceProductListEntry[]
  selectedStyleCount: number
  selectedQuantity: number
  unresolved: InvoiceProductListUnresolved
  categoryTotals: Record<
    InvoiceProductListCategory,
    InvoiceProductListCategoryTotal
  >
}

export function classifyInvoiceProductListRow(
  row: InvoiceOutgoingComponentRow,
): InvoiceProductListCategory | 'unresolved' {
  if (row.role === 'unknown' || !normalizeStyleNo(row.styleNo)) {
    return 'unresolved'
  }
  if (row.role === 'main') return 'product'
  if (
    row.role === 'included' ||
    row.role === 'required' ||
    row.role === 'paid_add'
  ) {
    return 'component'
  }
  if (row.role === 'gift') return 'gift'
  if (row.role === 'packing') return 'packing'
  return 'unresolved'
}

function emptyCategoryTotals(): Record<
  InvoiceProductListCategory,
  InvoiceProductListCategoryTotal
> {
  return {
    product: { category: 'product', styleCount: 0, quantity: 0 },
    component: { category: 'component', styleCount: 0, quantity: 0 },
    gift: { category: 'gift', styleCount: 0, quantity: 0 },
    packing: { category: 'packing', styleCount: 0, quantity: 0 },
  }
}

export function summarizeInvoiceProductList(
  rows: InvoiceOutgoingComponentRow[],
  selected: Iterable<InvoiceProductListCategory>,
): InvoiceProductListSummary {
  const selectedSet = new Set(selected)
  const selectedByStyle = new Map<string, InvoiceProductListEntry>()
  const categoryStyles = {
    product: new Set<string>(),
    component: new Set<string>(),
    gift: new Set<string>(),
    packing: new Set<string>(),
  }
  const categoryTotals = emptyCategoryTotals()
  const unresolved: InvoiceProductListUnresolved = {
    rowCount: 0,
    quantity: 0,
  }

  for (const row of rows) {
    const quantity = Number.isFinite(row.quantity) ? row.quantity : 0
    const category = classifyInvoiceProductListRow(row)
    if (category === 'unresolved') {
      unresolved.rowCount += 1
      unresolved.quantity += quantity
      continue
    }

    const styleNo = normalizeStyleNo(row.styleNo)
    categoryStyles[category].add(styleNo)
    categoryTotals[category].quantity += quantity

    if (!selectedSet.has(category)) continue

    const existing = selectedByStyle.get(styleNo)
    const incomingName = row.styleName.trim()
    const incomingIsFallback =
      !incomingName || normalizeStyleNo(incomingName) === styleNo
    if (existing) {
      existing.quantity += quantity
      const existingIsFallback =
        !existing.styleName || normalizeStyleNo(existing.styleName) === styleNo
      if (existingIsFallback && !incomingIsFallback) {
        existing.styleName = incomingName
      }
      continue
    }
    selectedByStyle.set(styleNo, {
      styleNo,
      styleName: incomingIsFallback ? styleNo : incomingName,
      quantity,
    })
  }

  for (const category of ALL_INVOICE_PRODUCT_LIST_CATEGORIES) {
    categoryTotals[category].styleCount = categoryStyles[category].size
  }

  const entries = [...selectedByStyle.values()].sort(
    (left, right) =>
      left.styleNo.localeCompare(right.styleNo, 'ko-KR') ||
      left.styleName.localeCompare(right.styleName, 'ko-KR'),
  )
  return {
    entries,
    selectedStyleCount: entries.length,
    selectedQuantity: entries.reduce((sum, item) => sum + item.quantity, 0),
    unresolved,
    categoryTotals,
  }
}
