import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type {
  InvoiceProductListPrintColumn,
  InvoiceProductListPrintFitProfile,
  InvoiceProductListPrintPage,
  InvoiceProductListPrintSlot,
} from '@/lib/invoice/product-list-print'
import { UNSPECIFIED_LOCATION_ZONE } from '@/lib/invoice/product-list-warehouse'
import { cn, formatNumber } from '@/lib/utils'

function locationLabel(line: {
  isShortage: boolean
  locationLabel: string
}) {
  return line.isShortage
    ? `${line.locationLabel}(재고 부족)`
    : line.locationLabel
}

function slotKey(slot: InvoiceProductListPrintSlot, index: number) {
  if (slot.kind === 'header') {
    return `header-${slot.locationZonePrefix}-${slot.continued}-${index}`
  }
  if (slot.kind === 'item') {
    return `item-${slot.line.styleNo}-${slot.line.locationLabel}-${index}`
  }
  return `empty-${index}`
}

function columnQuantity(column: InvoiceProductListPrintColumn) {
  return column.slots.reduce(
    (sum, slot) => (slot.kind === 'item' ? sum + slot.line.quantity : sum),
    0,
  )
}

function zoneCenterLabel(
  slot: Extract<InvoiceProductListPrintSlot, { kind: 'header' }>,
) {
  return slot.locationZonePrefix === UNSPECIFIED_LOCATION_ZONE
    ? UNSPECIFIED_LOCATION_ZONE
    : slot.locationZonePrefix
}

function InvoiceProductListPrintZoneBar({
  slot,
  tableQuantity,
}: {
  slot: Extract<InvoiceProductListPrintSlot, { kind: 'header' }>
  tableQuantity: number
}) {
  return (
    <div className="invoice-product-list-print-zone-bar">
      <span className="tabular-nums">{formatNumber(slot.zoneQuantity)}</span>
      <span className="invoice-product-list-print-zone-name">
        {zoneCenterLabel(slot)}
      </span>
      <span className="tabular-nums">{formatNumber(tableQuantity)}</span>
    </div>
  )
}

function invoiceProductListPrintFitStyle(
  fit: InvoiceProductListPrintFitProfile,
): CSSProperties {
  return {
    '--ipl-rows': String(fit.rowsPerColumn),
    '--ipl-row-height': `${fit.rowHeightMm}mm`,
    '--ipl-font-scale': String(fit.fontScale),
    '--ipl-col-1': `${fit.columnWidthPercents[0]}%`,
    '--ipl-col-2': `${fit.columnWidthPercents[1]}%`,
    '--ipl-col-3': `${fit.columnWidthPercents[2]}%`,
    '--ipl-col-4': `${fit.columnWidthPercents[3]}%`,
    '--ipl-col-5': `${fit.columnWidthPercents[4]}%`,
  } as CSSProperties
}

function InvoiceProductListPrintColumnView({
  column,
  page,
}: {
  column: InvoiceProductListPrintColumn
  page: InvoiceProductListPrintPage
}) {
  const hasContent = column.segments.length > 0
  const quantity = columnQuantity(column)
  const leadingZone =
    column.slots[0]?.kind === 'header' ? column.slots[0] : null
  const bodySlots = leadingZone ? column.slots.slice(1) : column.slots
  return (
    <div className="invoice-product-list-print-column">
      <header className="invoice-product-list-print-meta">
        {hasContent ? page.printedOn : '\u00a0'}
      </header>
      <div className="invoice-product-list-print-table-wrap">
        <table className="invoice-product-list-print-table">
          <colgroup>
            <col style={{ width: 'var(--ipl-col-1, 8%)' }} />
            <col style={{ width: 'var(--ipl-col-2, 14%)' }} />
            <col style={{ width: 'var(--ipl-col-3, 18%)' }} />
            <col style={{ width: 'var(--ipl-col-4, 48%)' }} />
            <col style={{ width: 'var(--ipl-col-5, 12%)' }} />
          </colgroup>
          <thead>
            {leadingZone ? (
              <tr
                className={cn(
                  'invoice-product-list-print-zone-row',
                  leadingZone.isShortage &&
                    'invoice-product-list-print-zone-row--shortage',
                )}
              >
                <th colSpan={5}>
                  <InvoiceProductListPrintZoneBar
                    slot={leadingZone}
                    tableQuantity={quantity}
                  />
                </th>
              </tr>
            ) : null}
            <tr>
              <th>확인</th>
              <th>M번호</th>
              <th>자리번호</th>
              <th>상품명</th>
              <th>수량</th>
            </tr>
          </thead>
          <tbody>
          {bodySlots.map((slot, index) => {
            if (slot.kind === 'header') {
              return (
                <tr
                  key={slotKey(slot, index)}
                  className={cn(
                    'invoice-product-list-print-zone-row',
                    slot.isShortage &&
                      'invoice-product-list-print-zone-row--shortage',
                  )}
                >
                  <td colSpan={5}>
                    <InvoiceProductListPrintZoneBar
                      slot={slot}
                      tableQuantity={quantity}
                    />
                  </td>
                </tr>
              )
            }
            if (slot.kind === 'item') {
              return (
                <tr
                  key={slotKey(slot, index)}
                  className={cn(
                    slot.line.isShortage &&
                      'invoice-product-list-print-item--shortage',
                  )}
                >
                  <td>
                    <span className="invoice-product-list-print-check" />
                  </td>
                  <td>{slot.line.styleNo}</td>
                  <td>{locationLabel(slot.line)}</td>
                  <td>{slot.line.styleName}</td>
                  <td className="tabular-nums">
                    {formatNumber(slot.line.quantity)}
                  </td>
                </tr>
              )
            }
            return (
              <tr key={slotKey(slot, index)}>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
              </tr>
            )
          })}
        </tbody>
        </table>
      </div>
    </div>
  )
}

export function InvoiceProductListPrintPageView({
  page,
  variant,
}: {
  page: InvoiceProductListPrintPage
  variant: 'print' | 'preview'
}) {
  return (
    <section
      className={cn(
        'invoice-product-list-print-sheet',
        `invoice-product-list-print-sheet--${page.columnMode}`,
        variant === 'preview' && 'invoice-product-list-print-sheet--preview',
      )}
      style={invoiceProductListPrintFitStyle(page.fit)}
    >
      {page.columns.map((column) => (
        <InvoiceProductListPrintColumnView
          key={`${page.globalPageIndex}-${column.columnIndex}`}
          column={column}
          page={page}
        />
      ))}
    </section>
  )
}

export function InvoiceProductListPrint({
  pages,
}: {
  pages: InvoiceProductListPrintPage[]
}) {
  if (typeof document === 'undefined' || pages.length === 0) return null
  return createPortal(
    <div className="invoice-product-list-print" aria-hidden>
      {pages.map((page) => (
        <InvoiceProductListPrintPageView
          key={`${page.routeGroupLabel}-${page.globalPageIndex}`}
          page={page}
          variant="print"
        />
      ))}
    </div>,
    document.body,
  )
}
