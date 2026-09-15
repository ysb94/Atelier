import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Package, Printer, Warehouse, X } from 'lucide-react'
import { WorkspaceTabOverlay } from '@/components/layout/workspace-tabs'
import { ProductThumb } from '@/components/products/ProductThumb'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  getActiveWarehouseInventorySet,
  getWarehouseStockPositions,
} from '@/lib/api'
import type { CargoInboundLineDraft } from '@/lib/cargo/inbound'
import {
  cargoLineHasContent,
  parseUnloadBoxCount,
  splitUnloadStackRows,
} from '@/lib/cargo/inbound'
import {
  assignUnloadStowLabels,
  compareUnloadStowLabel,
  compareUnloadStyleNo,
} from '@/lib/cargo/unload-stow'
import { resolveWarehouseTidyShippedOn } from '@/lib/cargo/warehouse-tidy'
import { useRenderWatch } from '@/lib/diagnostics'
import {
  LOGISTICS_IMAGE_KEY,
  ruleImageUrls,
} from '@/lib/products/product-image'
import type { WarehouseStockPosition } from '@/lib/types'
import { cn, emptyList, formatNumber } from '@/lib/utils'
import { resolveLatestReceivedStockByStyle } from '@/lib/warehouse/stock'

export type CargoLineListPurpose = 'unload' | 'warehouse'

type CargoUnloadListDialogProps = {
  title: string
  brandId: string
  brandName: string
  shippedAt: string
  lines: CargoInboundLineDraft[]
  purpose?: CargoLineListPurpose
  onClose: () => void
}

type PrintOrientation = 'auto' | 'portrait' | 'landscape'

const PURPOSE_COPY = {
  unload: {
    label: '하차용',
    closeLabel: '하차용 목록 닫기',
    titleId: 'cargo-unload-list-title',
    printClass: 'printing-cargo-unload-list',
    printStyleId: 'cargo-unload-list-print-style',
    printNodeClass: 'cargo-unload-list-print',
    printOrientationId: 'cargo-unload-print-orientation',
    watchName: 'CargoUnloadListDialog',
    queryKey: 'cargo-inbound-unload-stock',
  },
  warehouse: {
    label: '창고정리용',
    closeLabel: '창고정리용 목록 닫기',
    titleId: 'cargo-warehouse-tidy-title',
    printClass: 'printing-cargo-warehouse-tidy',
    printStyleId: 'cargo-warehouse-tidy-print-style',
    printNodeClass: 'cargo-warehouse-tidy-print',
    printOrientationId: 'cargo-warehouse-tidy-print-orientation',
    watchName: 'CargoWarehouseTidyDialog',
    queryKey: 'cargo-inbound-warehouse-tidy-stock',
  },
} as const

const UNLOAD_COLUMNS = [
  { key: 'no', label: 'NO', widthClass: 'w-12', align: 'center', printWidth: '4%' },
  { key: 'name', label: '품명', widthClass: 'w-56', align: 'left', printWidth: '18%' },
  { key: 'photo', label: '사진', widthClass: 'w-16', align: 'center', printWidth: '6%' },
  { key: 'styleNo', label: '모델명', widthClass: 'w-24', align: 'center', printWidth: '9%' },
  { key: 'qty', label: '총수량', widthClass: 'w-20', align: 'center', printWidth: '6%' },
  { key: 'perBox', label: '박스당', widthClass: 'w-16', align: 'center', printWidth: '5%' },
  { key: 'boxes', label: '박스수', widthClass: 'w-16', align: 'center', printWidth: '5%' },
  { key: 'stow', label: '적재방식', widthClass: 'w-20', align: 'center', printWidth: '8%' },
  { key: 'slot', label: '창고자리', widthClass: 'w-20', align: 'center', printWidth: '6%' },
  { key: 'note', label: '비고', widthClass: 'w-24', align: 'left', printWidth: '8%' },
  { key: 'shippedAt', label: '선적일', widthClass: 'w-20', align: 'center', printWidth: '6%' },
  { key: 'latestSlot', label: '최신자리', widthClass: 'w-24', align: 'center', printWidth: '10%' },
  { key: 'latestBoxes', label: '최신박스수', widthClass: 'w-20', align: 'center', printWidth: '9%' },
] as const

function applyUnloadPrintMode(
  landscape: boolean,
  printClass: string,
  printStyleId: string,
  printNodeClass: string,
) {
  document.documentElement.classList.add(printClass)
  let style = document.getElementById(printStyleId)
  if (!style) {
    style = document.createElement('style')
    style.id = printStyleId
    document.head.appendChild(style)
  }
  const pageSize = landscape ? 'A4 landscape' : 'A4 portrait'
  const pageMargin = landscape ? '7mm 8mm' : '8mm 7mm'
  const tableFont = landscape ? '11px' : '9.5px'
  const titleFont = landscape ? '16px' : '14px'
  const metaFont = landscape ? '11px' : '10px'
  const rowHeight = landscape ? '26px' : '22px'
  const cellPad = landscape ? '3px 4px' : '2px 3px'
  const imgSize = landscape ? '20px' : '16px'
  style.textContent = `
@page { size: ${pageSize}; margin: ${pageMargin}; }
@media screen {
  .${printNodeClass} { display: none !important; }
}
@media print {
  html.${printClass},
  html.${printClass} body {
    height: auto !important;
    overflow: visible !important;
    background: #fff !important;
  }
  html.${printClass} body > :not(.${printNodeClass}) {
    display: none !important;
  }
  html.${printClass} .${printNodeClass} {
    display: block !important;
    position: static !important;
    inset: auto !important;
    width: 100% !important;
    height: auto !important;
    max-height: none !important;
    overflow: visible !important;
    color: #111;
    background: #fff;
    font-family: sans-serif;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  html.${printClass} .${printNodeClass} h1 {
    font-size: ${titleFont};
    margin: 0 0 2px;
  }
  html.${printClass} .${printNodeClass} p {
    margin: 0 0 6px;
    color: #555;
    font-size: ${metaFont};
  }
  html.${printClass} .${printNodeClass} table {
    width: 100% !important;
    table-layout: fixed;
    border-collapse: collapse;
    font-size: ${tableFont};
  }
  html.${printClass} .${printNodeClass} tbody tr {
    height: ${rowHeight};
  }
  html.${printClass} .${printNodeClass} tbody tr:nth-child(even) td {
    background: #edf2f6 !important;
  }
  html.${printClass} .${printNodeClass} thead {
    display: table-header-group;
  }
  html.${printClass} .${printNodeClass} tr {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  html.${printClass} .${printNodeClass} th,
  html.${printClass} .${printNodeClass} td {
    border: 1px solid #9aa6b2;
    padding: ${cellPad};
    text-align: center;
    vertical-align: middle;
    overflow: hidden;
    height: ${rowHeight};
    line-height: 1.15;
    white-space: nowrap;
  }
  html.${printClass} .${printNodeClass} th {
    background: #243447;
    color: #fff;
    font-weight: 600;
  }
  html.${printClass} .${printNodeClass} td.name,
  html.${printClass} .${printNodeClass} td.note {
    text-align: left;
    text-overflow: ellipsis;
  }
  html.${printClass} .${printNodeClass} td.photo img,
  html.${printClass} .${printNodeClass} td.photo .photo-thumb {
    width: ${imgSize} !important;
    height: ${imgSize} !important;
    object-fit: cover;
    display: block;
    margin: 0 auto;
  }
}
`
}

function clearUnloadPrintMode(printClass: string, printStyleId: string) {
  document.documentElement.classList.remove(printClass)
  document.getElementById(printStyleId)?.remove()
}

function UnloadPhoto({
  styleNo,
  name,
  size = 36,
}: {
  styleNo: string
  name: string
  size?: number
}) {
  const sources = styleNo ? ruleImageUrls(styleNo, LOGISTICS_IMAGE_KEY) : []
  return (
    <div className="flex items-center justify-center">
      <ProductThumb
        sources={sources}
        alt={name || styleNo || '상품 사진'}
        size={size}
        className="photo-thumb"
      />
    </div>
  )
}

export function CargoUnloadListDialog({
  title,
  brandId,
  brandName,
  shippedAt,
  lines,
  purpose = 'unload',
  onClose,
}: CargoUnloadListDialogProps) {
  const copy = PURPOSE_COPY[purpose]
  useRenderWatch(copy.watchName)
  const [openedAt] = useState(() => Date.now())
  const [printOrientation, setPrintOrientation] =
    useState<PrintOrientation>('auto')

  useEffect(() => {
    const afterPrint = () =>
      clearUnloadPrintMode(copy.printClass, copy.printStyleId)
    window.addEventListener('afterprint', afterPrint)
    return () => {
      window.removeEventListener('afterprint', afterPrint)
      clearUnloadPrintMode(copy.printClass, copy.printStyleId)
    }
  }, [copy.printClass, copy.printStyleId])

  const stockQuery = useQuery({
    queryKey: [copy.queryKey, brandId, openedAt],
    queryFn: async (): Promise<WarehouseStockPosition[]> => {
      const activeSet = await getActiveWarehouseInventorySet(brandId)
      if (!activeSet) return []
      return getWarehouseStockPositions(brandId, activeSet.id)
    },
    enabled: Boolean(brandId),
  })
  const positions = stockQuery.data ?? emptyList<WarehouseStockPosition>()
  const loading = Boolean(brandId) && stockQuery.isLoading

  const productCount = useMemo(
    () => lines.filter(cargoLineHasContent).length,
    [lines],
  )
  const rows = useMemo(() => {
    const built = lines.filter(cargoLineHasContent).flatMap((line, index) => {
      const styleNo = line.styleNo.trim()
      const stock = resolveLatestReceivedStockByStyle(positions, styleNo)
      const incomingBoxes = parseUnloadBoxCount(line.boxes)
      const latestBoxes = stock.found ? stock.totalBoxes : 0
      const latestSlot = stock.found ? stock.locationLabel ?? '' : ''
      const parts = splitUnloadStackRows(incomingBoxes, latestBoxes)
      return parts.map((part, partIndex) => {
        const first = partIndex === 0
        const boxSum = part.incomingBoxes + part.latestBoxes
        return {
          key: `${styleNo || line.name || 'line'}-${index}-${partIndex}`,
          no: line.no.trim() || String(index + 1),
          name: line.name.trim(),
          styleNo,
          qty: first ? line.qty.trim() : '',
          perBox: line.perBox.trim(),
          boxes: part.incomingBoxes > 0 ? formatNumber(part.incomingBoxes) : '',
          note: first ? line.note.trim() : '',
          stow: '',
          slot: '',
          shippedAt:
            purpose === 'warehouse'
              ? resolveWarehouseTidyShippedOn({
                  shippedAt,
                  boxSum,
                  partIndex,
                  partCount: parts.length,
                })
              : '',
          latestSlot: first ? latestSlot.trim() || 'NEW' : '+NEW',
          latestBoxes:
            first && part.latestBoxes > 0
              ? formatNumber(part.latestBoxes)
              : '',
          incomingBoxes: part.incomingBoxes,
          boxSum,
        }
      })
    })
    const stowByKey = assignUnloadStowLabels(
      built.map((row) => ({
        key: row.key,
        styleNo: row.styleNo,
        boxSum: row.boxSum,
        incomingBoxes: row.incomingBoxes,
      })),
    )
    return built
      .map((row) => ({
        ...row,
        stow: stowByKey.get(row.key) ?? '',
      }))
      .sort((left, right) => {
        if (purpose === 'warehouse') {
          const byStow = compareUnloadStowLabel(left.stow, right.stow)
          if (byStow !== 0) return byStow
        }
        return compareUnloadStyleNo(left.styleNo, right.styleNo)
      })
  }, [lines, positions, purpose, shippedAt])
  const printLandscape =
    printOrientation === 'landscape' || printOrientation === 'auto'
  const printOrientationLabel = printLandscape ? '가로' : '세로'

  function handlePrint() {
    if (loading || rows.length === 0) return
    applyUnloadPrintMode(
      printLandscape,
      copy.printClass,
      copy.printStyleId,
      copy.printNodeClass,
    )
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => window.print()),
    )
  }

  return createPortal(
    <WorkspaceTabOverlay>
      <>
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-4">
        <button
          type="button"
          aria-label={copy.closeLabel}
          className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
          onClick={onClose}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={copy.titleId}
          className="relative z-10 flex max-h-[92vh] w-full max-w-[min(96vw,90rem)] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-lg"
        >
          <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <h2
                id={copy.titleId}
                className="text-base font-semibold tracking-tight"
              >
                {copy.label}
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                박스 합 9~16은 A(1종류), 5~8은 C(2종류), 그 이하는 B(4종류)로
                적재합니다. 박스수가 비면 섞여 온 것이라 적재방식은 비웁니다.
              </p>
            </div>
            <Button type="button" size="icon" variant="ghost" onClick={onClose}>
              <X className="size-4" />
            </Button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="muted">{brandName}</Badge>
              <Badge variant="outline">{title}</Badge>
              <Badge variant={productCount > 0 ? 'success' : 'muted'}>
                {formatNumber(productCount)}종
              </Badge>
              {stockQuery.isError ? (
                <span className="text-xs text-danger">
                  최신 자리를 불러오지 못했습니다.
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-1.5">
              <label
                className="sr-only"
                htmlFor={copy.printOrientationId}
              >
                인쇄 방향
              </label>
              <select
                id={copy.printOrientationId}
                value={printOrientation}
                onChange={(event) =>
                  setPrintOrientation(event.target.value as PrintOrientation)
                }
                className="h-8 rounded-md border border-border bg-card px-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring"
                title="인쇄 방향 선택"
              >
                <option value="auto">자동 (가로)</option>
                <option value="portrait">세로</option>
                <option value="landscape">가로</option>
              </select>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={loading || rows.length === 0}
                onClick={handlePrint}
              >
                <Printer className="size-3.5" />
                인쇄
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {loading ? (
              <div className="flex min-h-[16rem] flex-col items-center justify-center gap-3 px-4 py-10">
                <Loader2 className="size-8 animate-spin text-foreground" />
                <p className="text-sm text-muted-foreground">
                  최신 자리와 박스 수를 불러오는 중...
                </p>
              </div>
            ) : rows.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                하차할 상품이 없습니다.
              </p>
            ) : (
              <table className="w-full min-w-[72rem] table-fixed border-separate border-spacing-0 text-sm">
                <colgroup>
                  {UNLOAD_COLUMNS.map((column) => (
                    <col key={column.key} className={column.widthClass} />
                  ))}
                </colgroup>
                <thead className="sticky top-0 z-20">
                  <tr>
                    {UNLOAD_COLUMNS.map((column) => (
                      <th
                        key={column.key}
                        className={cn(
                          'whitespace-nowrap border-b border-r border-border bg-foreground px-1 py-1.5 text-center text-[13px] font-semibold text-background last:border-r-0',
                          column.align === 'left' && 'text-left',
                        )}
                      >
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.key}
                      className="odd:bg-card even:bg-muted/20"
                    >
                      {UNLOAD_COLUMNS.map((column) => {
                        if (column.key === 'photo') {
                          return (
                            <td
                              key={`${row.key}-photo`}
                              className="h-11 border-b border-r border-border px-0.5 align-middle last:border-r-0"
                            >
                              <UnloadPhoto
                                styleNo={row.styleNo}
                                name={row.name}
                              />
                            </td>
                          )
                        }

                        const value = row[column.key]
                        return (
                          <td
                            key={`${row.key}-${column.key}`}
                            className={cn(
                              'h-11 overflow-hidden whitespace-nowrap border-b border-r border-border px-1 align-middle text-sm leading-tight text-foreground last:border-r-0',
                              column.align === 'left'
                                ? 'text-left'
                                : 'text-center',
                              column.key === 'no' && 'text-muted-foreground',
                              column.key === 'name' && 'font-medium',
                              [
                                'qty',
                                'perBox',
                                'boxes',
                                'latestBoxes',
                              ].includes(column.key) && 'tabular-nums',
                            )}
                            title={value || undefined}
                          >
                            {value}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="flex justify-end border-t border-border px-4 py-3">
            <Button type="button" variant="outline" onClick={onClose}>
              닫기
            </Button>
          </div>
        </div>
      </div>
      <div className={`${copy.printNodeClass} hidden`} aria-hidden>
          <h1>
            {title} {copy.label}
          </h1>
          <p>
            {brandName} · {title} · {formatNumber(productCount)}종 ·{' '}
            {printOrientationLabel}
          </p>
          <table>
            <colgroup>
              {UNLOAD_COLUMNS.map((column) => (
                <col key={`print-col-${column.key}`} style={{ width: column.printWidth }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {UNLOAD_COLUMNS.map((column) => (
                  <th key={`print-h-${column.key}`}>{column.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`print-${row.key}`}>
                  {UNLOAD_COLUMNS.map((column) => {
                    if (column.key === 'photo') {
                      return (
                        <td key={`print-${row.key}-photo`} className="photo">
                          {row.styleNo ? (
                            <UnloadPhoto
                              styleNo={row.styleNo}
                              name={row.name}
                              size={printLandscape ? 20 : 16}
                            />
                          ) : (
                            '—'
                          )}
                        </td>
                      )
                    }
                    return (
                      <td
                        key={`print-${row.key}-${column.key}`}
                        className={
                          column.align === 'left'
                            ? column.key === 'name'
                              ? 'name'
                              : 'note'
                            : undefined
                        }
                      >
                        {row[column.key]}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    </WorkspaceTabOverlay>,
    document.body,
  )
}

function CargoLineListButton({
  title,
  brandId,
  brandName,
  shippedAt,
  lines,
  purpose,
}: {
  title: string
  brandId: string
  brandName: string
  shippedAt: string
  lines: CargoInboundLineDraft[]
  purpose: CargoLineListPurpose
}) {
  const [open, setOpen] = useState(false)
  const copy = PURPOSE_COPY[purpose]
  const Icon = purpose === 'warehouse' ? Warehouse : Package
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
      >
        <Icon className="size-3.5" />
        {copy.label}
      </Button>
      {open ? (
        <CargoUnloadListDialog
          title={title}
          brandId={brandId}
          brandName={brandName}
          shippedAt={shippedAt}
          lines={lines}
          purpose={purpose}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  )
}

export function CargoUnloadListButton({
  title,
  brandId,
  brandName,
  shippedAt,
  lines,
}: {
  title: string
  brandId: string
  brandName: string
  shippedAt: string
  lines: CargoInboundLineDraft[]
}) {
  return (
    <CargoLineListButton
      title={title}
      brandId={brandId}
      brandName={brandName}
      shippedAt={shippedAt}
      lines={lines}
      purpose="unload"
    />
  )
}

export function CargoWarehouseTidyButton({
  title,
  brandId,
  brandName,
  shippedAt,
  lines,
}: {
  title: string
  brandId: string
  brandName: string
  shippedAt: string
  lines: CargoInboundLineDraft[]
}) {
  return (
    <CargoLineListButton
      title={title}
      brandId={brandId}
      brandName={brandName}
      shippedAt={shippedAt}
      lines={lines}
      purpose="warehouse"
    />
  )
}
