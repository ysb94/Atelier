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
}: {
  slot: Extract<InvoiceProductListPrintSlot, { kind: 'header' }>
}) {
  return (
    <div className="invoice-product-list-print-zone-bar">
      <span aria-hidden className="invoice-product-list-print-zone-spacer" />
      <span className="invoice-product-list-print-zone-name">
        {zoneCenterLabel(slot)}
      </span>
      <span className="tabular-nums">{formatNumber(slot.zoneQuantity)}</span>
    </div>
  )
}

function invoiceProductListPrintFitStyle(
  fit: InvoiceProductListPrintFitProfile,
  hideCheckColumn = false,
): CSSProperties {
  const fontScale = hideCheckColumn
    ? Math.min(fit.fontScale * 1.15, 1.25)
    : fit.fontScale
  if (hideCheckColumn) {
    return {
      '--ipl-rows': String(fit.rowsPerColumn),
      '--ipl-row-height': `${fit.rowHeightMm}mm`,
      '--ipl-font-scale': String(fontScale),
      '--ipl-col-1': '16%',
      '--ipl-col-2': '20%',
      '--ipl-col-3': '52%',
      '--ipl-col-4': '12%',
      '--ipl-col-5': '0%',
    } as CSSProperties
  }
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
  const hideCheck = Boolean(page.hideCheckColumn)
  const colSpan = hideCheck ? 4 : 5
  const leadingZone =
    column.slots[0]?.kind === 'header' ? column.slots[0] : null
  const bodySlots = leadingZone ? column.slots.slice(1) : column.slots
  return (
    <div className="invoice-product-list-print-column">
      <header className="invoice-product-list-print-meta">
        {hasContent ? (
          <>
            <span>{page.printedOn}</span>
            <span className="tabular-nums">{formatNumber(quantity)}</span>
          </>
        ) : (
          '\u00a0'
        )}
      </header>
      <div className="invoice-product-list-print-table-wrap">
        <table className="invoice-product-list-print-table">
          <colgroup>
            {hideCheck ? (
              <>
                <col style={{ width: 'var(--ipl-col-1, 16%)' }} />
                <col style={{ width: 'var(--ipl-col-2, 20%)' }} />
                <col style={{ width: 'var(--ipl-col-3, 52%)' }} />
                <col style={{ width: 'var(--ipl-col-4, 12%)' }} />
              </>
            ) : (
              <>
                <col style={{ width: 'var(--ipl-col-1, 8%)' }} />
                <col style={{ width: 'var(--ipl-col-2, 14%)' }} />
                <col style={{ width: 'var(--ipl-col-3, 18%)' }} />
                <col style={{ width: 'var(--ipl-col-4, 48%)' }} />
                <col style={{ width: 'var(--ipl-col-5, 12%)' }} />
              </>
            )}
          </colgroup>
          <thead>
            {!hideCheck && leadingZone ? (
              <tr
                className={cn(
                  'invoice-product-list-print-zone-row',
                  leadingZone.isShortage &&
                    'invoice-product-list-print-zone-row--shortage',
                )}
              >
                <th colSpan={colSpan}>
                  <InvoiceProductListPrintZoneBar slot={leadingZone} />
                </th>
              </tr>
            ) : null}
            <tr>
              {hideCheck ? null : <th>확인</th>}
              <th>M번호</th>
              <th>자리번호</th>
              <th>상품명</th>
              <th>수량</th>
            </tr>
          </thead>
          <tbody>
          {bodySlots.map((slot, index) => {
            if (slot.kind === 'header') {
              if (hideCheck) {
                // 대량출고: 구역 행은 그리지 않고, 다음 상품 행에 굵은 윗선만 붙인다.
                return null
              }
              return (
                <tr
                  key={slotKey(slot, index)}
                  className={cn(
                    'invoice-product-list-print-zone-row',
                    slot.isShortage &&
                      'invoice-product-list-print-zone-row--shortage',
                  )}
                >
                  <td colSpan={colSpan}>
                    <InvoiceProductListPrintZoneBar slot={slot} />
                  </td>
                </tr>
              )
            }
            if (slot.kind === 'item') {
              const locationLines =
                slot.line.locationLabels?.filter(Boolean) ??
                slot.line.locationLabel.split('\n').filter(Boolean)
              const locationText =
                locationLines.length > 0
                  ? locationLines
                      .map((label) =>
                        slot.line.isShortage &&
                        label === UNSPECIFIED_LOCATION_ZONE
                          ? `${label}(재고 부족)`
                          : label,
                      )
                      .join('\n')
                  : locationLabel(slot.line)
              const rowSpan = Math.max(1, locationLines.length || 1)
              const prev = index > 0 ? bodySlots[index - 1] : null
              const zoneStart =
                hideCheck &&
                ((prev?.kind === 'header') ||
                  (prev?.kind === 'item' &&
                    prev.line.locationZonePrefix !==
                      slot.line.locationZonePrefix))
              return (
                <tr
                  key={slotKey(slot, index)}
                  className={cn(
                    slot.line.isShortage &&
                      'invoice-product-list-print-item--shortage',
                    zoneStart && 'invoice-product-list-print-zone-start',
                  )}
                  style={
                    rowSpan > 1
                      ? {
                          height: `calc(${rowSpan} * 100% / (var(--ipl-rows, 26) + 1))`,
                        }
                      : undefined
                  }
                >
                  {hideCheck ? null : (
                    <td>
                      <span className="invoice-product-list-print-check" />
                    </td>
                  )}
                  <td>{slot.line.styleNo}</td>
                  <td className="invoice-product-list-print-location">
                    {locationText}
                  </td>
                  <td>{slot.line.styleName}</td>
                  <td className="tabular-nums">
                    {formatNumber(slot.line.quantity)}
                  </td>
                </tr>
              )
            }
            return (
              <tr key={slotKey(slot, index)}>
                {hideCheck ? null : <td>&nbsp;</td>}
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
  const hasJobHeader = Boolean(page.jobTitle || page.jobSubtitle)
  const hideCheck = Boolean(page.hideCheckColumn)
  const columns = page.columns.map((column) => (
    <InvoiceProductListPrintColumnView
      key={`${page.globalPageIndex}-${column.columnIndex}`}
      column={column}
      page={page}
    />
  ))
  return (
    <section
      className={cn(
        'invoice-product-list-print-sheet',
        `invoice-product-list-print-sheet--${page.columnMode}`,
        variant === 'preview' && 'invoice-product-list-print-sheet--preview',
        hasJobHeader && 'invoice-product-list-print-sheet--with-job',
        hideCheck && 'invoice-product-list-print-sheet--no-check',
      )}
      style={invoiceProductListPrintFitStyle(page.fit, hideCheck)}
    >
      {hasJobHeader ? (
        <header className="invoice-product-list-print-job">
          {page.jobTitle ? (
            <p className="invoice-product-list-print-job-title">
              {page.jobTitle}
            </p>
          ) : null}
          {page.jobSubtitle ? (
            <p className="invoice-product-list-print-job-subtitle">
              {page.jobSubtitle}
            </p>
          ) : null}
        </header>
      ) : null}
      {hasJobHeader ? (
        <div className="invoice-product-list-print-body">{columns}</div>
      ) : (
        columns
      )}
      {hideCheck ? (
        <footer className="invoice-product-list-print-page-no tabular-nums">
          {page.globalPageCount}-{page.globalPageIndex}
        </footer>
      ) : null}
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
    <div
      className="invoice-product-list-print"
      aria-hidden
      data-print-mode={pages[0]?.columnMode}
    >
      {pages.map((page) => (
        <InvoiceProductListPrintPageView
          key={`${page.columnMode}-${page.routeGroupLabel}-${page.globalPageIndex}`}
          page={page}
          variant="print"
        />
      ))}
    </div>,
    document.body,
  )
}
