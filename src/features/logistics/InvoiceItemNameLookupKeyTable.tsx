import { Badge } from '@/components/ui/badge'
import {
  formatItemNameFromComponents,
  type UnresolvedItemNameCombo,
} from '@/lib/invoice/item-name-transform'
import { normalizeInvoiceText } from '@/lib/invoice/prefix-transform'
import {
  productCompositionFromStyle,
  richerProductComposition,
  type ProductCompositionItem,
} from '@/lib/invoice/product-composition'
import {
  INVOICE_ITEM_NAME_RULE_ACTION_LABEL,
  type InvoiceItemNameRule,
  type StyleRef,
} from '@/lib/types'
import { formatNumber } from '@/lib/utils'
import { ProductCompositionLines } from './ProductCompositionLines'

export type InvoiceItemNameLookupKeyRow = {
  key: string
  productLookupKey: string
  normalizedProductLookupKey: string
  itemName: string
  style: StyleRef | null
  productComponents: ProductCompositionItem[]
  rowCount: number
  selectable: boolean
  disabledReason: string
  existingRule: InvoiceItemNameRule | null
}

function ruleStatusLabel(rule: InvoiceItemNameRule | null, disabledReason: string) {
  if (rule?.action === 'delete') {
    return INVOICE_ITEM_NAME_RULE_ACTION_LABEL.delete
  }
  if (rule?.action === 'components') {
    return (
      formatItemNameFromComponents(rule.components) ||
      INVOICE_ITEM_NAME_RULE_ACTION_LABEL.components
    )
  }
  if (disabledReason) return disabledReason
  return '없음'
}

export function lookupKeyRowKey(
  productLookupKey: string,
  styleId: string | null,
) {
  return `${normalizeInvoiceText(productLookupKey)}\u0000${styleId ?? '__none__'}`
}

function findLookupKeyRule(
  rules: InvoiceItemNameRule[],
  itemName: string,
  styleId: string | null,
  productLookupKey: string,
) {
  const item = normalizeInvoiceText(itemName)
  const lookup = normalizeInvoiceText(productLookupKey)
  if (!item || !styleId || !lookup) return null
  return (
    rules.find(
      (rule) =>
        rule.isActive &&
        rule.scope === 'lookup_key' &&
        rule.normalizedItemName === item &&
        rule.mainStyle?.styleId === styleId &&
        rule.normalizedProductLookupKey === lookup,
    ) ?? null
  )
}

export function buildInvoiceItemNameLookupKeyRows(
  combos: UnresolvedItemNameCombo[],
  itemName: string,
  rules: InvoiceItemNameRule[],
): InvoiceItemNameLookupKeyRow[] {
  const byKey = new Map<
    string,
    {
      productLookupKey: string
      style: StyleRef | null
      productComponents: ProductCompositionItem[]
      rowCount: number
    }
  >()
  for (const combo of combos) {
    const style = combo.productStyle
    const productComponents =
      combo.productComponents && combo.productComponents.length > 0
        ? combo.productComponents
        : productCompositionFromStyle(style)
    const key = lookupKeyRowKey(combo.productLookupKey, style?.styleId ?? null)
    const current = byKey.get(key)
    if (current) {
      current.rowCount += combo.rowCount
      if (!current.productLookupKey && combo.productLookupKey.trim()) {
        current.productLookupKey = combo.productLookupKey
      }
      current.productComponents = richerProductComposition(
        current.productComponents,
        productComponents,
      )
      continue
    }
    byKey.set(key, {
      productLookupKey: combo.productLookupKey,
      style,
      productComponents,
      rowCount: combo.rowCount,
    })
  }

  return [...byKey.entries()]
    .map(([key, item]) => {
      const lookup = item.productLookupKey.trim()
      const disabledReason = !lookup
        ? '조회 키 없음'
        : item.style
          ? ''
          : '본품 미확정'
      return {
        key,
        productLookupKey: item.productLookupKey,
        normalizedProductLookupKey: normalizeInvoiceText(item.productLookupKey),
        itemName,
        style: item.style,
        productComponents: item.productComponents,
        rowCount: item.rowCount,
        selectable: Boolean(lookup && item.style),
        disabledReason,
        existingRule: findLookupKeyRule(
          rules,
          itemName,
          item.style?.styleId ?? null,
          item.productLookupKey,
        ),
      }
    })
    .sort((left, right) => {
      if (Boolean(left.style) !== Boolean(right.style)) {
        return left.style ? -1 : 1
      }
      return (
        (left.style?.styleNo ?? '').localeCompare(
          right.style?.styleNo ?? '',
          'ko-KR',
        ) ||
        (left.style?.name ?? '').localeCompare(
          right.style?.name ?? '',
          'ko-KR',
        ) ||
        left.productLookupKey.localeCompare(right.productLookupKey, 'ko-KR')
      )
    })
}

export function InvoiceItemNameLookupKeyTable({
  rows,
  selectedKeys,
  onChangeSelectedKeys,
}: {
  rows: InvoiceItemNameLookupKeyRow[]
  selectedKeys: string[]
  onChangeSelectedKeys: (keys: string[]) => void
}) {
  const selectable = rows.filter((row) => row.selectable)
  const selected = new Set(selectedKeys)
  const selectedCount = selectable.filter((row) => selected.has(row.key)).length
  const allSelected =
    selectable.length > 0 && selectedCount === selectable.length

  function toggle(row: InvoiceItemNameLookupKeyRow, checked: boolean) {
    if (!row.selectable) return
    const next = new Set(selected)
    if (checked) next.add(row.key)
    else next.delete(row.key)
    onChangeSelectedKeys([...next])
  }

  function toggleAll(checked: boolean) {
    onChangeSelectedKeys(checked ? selectable.map((row) => row.key) : [])
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium">조회 키</p>
        <p className="text-xs text-muted-foreground">
          선택 {formatNumber(selectedCount)} / 가능{' '}
          {formatNumber(selectable.length)}건
        </p>
      </div>
      <div className="max-h-64 overflow-auto rounded-md border border-border">
        <table className="w-full min-w-[56rem] text-left text-xs">
          <thead className="sticky top-0 bg-muted/80">
            <tr>
              <th className="w-10 px-2 py-1.5">
                <input
                  type="checkbox"
                  aria-label="선택 가능한 조회 키 전체"
                  checked={allSelected}
                  disabled={selectable.length === 0}
                  onChange={(event) => toggleAll(event.target.checked)}
                />
              </th>
              <th className="px-2 py-1.5 font-medium">품목명 변환 정보</th>
              <th className="px-2 py-1.5 font-medium">조회 키</th>
              <th className="px-2 py-1.5 font-medium">옵션명</th>
              <th className="px-2 py-1.5 font-medium">대상 행</th>
              <th className="px-2 py-1.5 font-medium">규칙</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const checked = selected.has(row.key)
              return (
                <tr
                  key={row.key}
                  className={`border-t border-border ${
                    row.selectable ? '' : 'bg-muted/20 text-muted-foreground'
                  }`}
                >
                  <td className="px-2 py-1.5">
                    <input
                      type="checkbox"
                      aria-label={`${row.productLookupKey || '조회 키 없음'} 선택`}
                      checked={checked}
                      disabled={!row.selectable}
                      onChange={(event) => toggle(row, event.target.checked)}
                    />
                  </td>
                  <td className="max-w-72 px-2 py-1.5">
                    <ProductCompositionLines items={row.productComponents} />
                  </td>
                  <td className="max-w-72 break-words px-2 py-1.5">
                    {row.productLookupKey || '(조회 키 없음)'}
                  </td>
                  <td className="max-w-56 break-words px-2 py-1.5">
                    {row.itemName || '(옵션명 없음)'}
                  </td>
                  <td className="px-2 py-1.5 tabular-nums">
                    {formatNumber(row.rowCount)}
                  </td>
                  <td className="max-w-56 break-words px-2 py-1.5">
                    {row.existingRule ? (
                      <Badge variant="success">
                        {ruleStatusLabel(row.existingRule, '')}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">
                        {ruleStatusLabel(null, row.disabledReason)}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
