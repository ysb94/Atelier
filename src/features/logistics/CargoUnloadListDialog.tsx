import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Download,
  Loader2,
  Package,
  Printer,
  RefreshCw,
  Warehouse,
  X,
} from 'lucide-react'
import { WorkspaceTabOverlay } from '@/components/layout/workspace-tabs'
import { ProductThumb } from '@/components/products/ProductThumb'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  CARGO_LINE_LIST_COLUMNS,
  CARGO_WAREHOUSE_LINE_LIST_COLUMNS,
} from '@/features/logistics/cargo-line-list-columns'
import type { CargoLineListColumnKey } from '@/features/logistics/cargo-line-list-columns'
import {
  getActiveWarehouseInventorySet,
  getCargoInboundTidyRows,
  getWarehouseStockPositions,
  type CargoInboundTidyRow,
} from '@/lib/api'
import type {
  CargoInboundLineDraft,
  CargoInboundStage,
} from '@/lib/cargo/inbound'
import {
  cargoLineHasContent,
  formatCargoWarehouseNote,
  parseUnloadBoxCount,
  queueUnloadSplitRows,
  splitUnloadStackRows,
} from '@/lib/cargo/inbound'
import {
  formatCargoLineListCells,
  parseCargoLineListInteger,
  storedRowToCargoLineListValues,
  type CargoLineListCells,
  type CargoLineListValues,
} from '@/lib/cargo/line-list'
import {
  assignUnloadStowLabels,
  compareUnloadStowLabel,
  compareUnloadStyleNo,
} from '@/lib/cargo/unload-stow'
import {
  buildCargoLineListPrintLayout,
  CARGO_LINE_LIST_PRINT_LINE_HEIGHT,
  CARGO_LINE_LIST_PRINT_META_PT,
  CARGO_LINE_LIST_PRINT_TITLE_PT,
  formatCargoLineListPrintOptionLabel,
  resolveCargoLineListPrintOrientation,
  type CargoLineListPrintLayout,
} from '@/lib/cargo/line-list-print'
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
  shipmentId?: string
  stage?: CargoInboundStage
  tidySavedAt?: string | null
  onSaveRows?: (rows: readonly CargoLineListValues[]) => Promise<void>
  onClose: () => void
}

type CargoListDisplayRow = {
  key: string
  values: CargoLineListValues
  cells: CargoLineListCells
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

function formatTidySavedAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function listCell(row: CargoListDisplayRow, key: CargoLineListColumnKey) {
  if (key === 'photo') return ''
  return row.cells[key]
}

function applyUnloadPrintMode(
  layout: CargoLineListPrintLayout,
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
  const lineHeight = CARGO_LINE_LIST_PRINT_LINE_HEIGHT
  style.textContent = `
@page { size: ${layout.pageSize}; margin: ${layout.pageMargin}; }
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
  html.${printClass} .${printNodeClass} .print-page + .print-page {
    break-before: page;
    page-break-before: always;
  }
  html.${printClass} .${printNodeClass} h1 {
    font-size: ${CARGO_LINE_LIST_PRINT_TITLE_PT}pt;
    line-height: 1.15;
    margin: 0 0 0.5mm;
  }
  html.${printClass} .${printNodeClass} p {
    margin: 0 0 1mm;
    color: #555;
    font-size: ${CARGO_LINE_LIST_PRINT_META_PT}pt;
    line-height: 1.2;
  }
  html.${printClass} .${printNodeClass} table {
    width: 100% !important;
    height: ${layout.tableHeightMm}mm;
    table-layout: fixed;
    border-collapse: collapse;
    font-size: ${layout.fontPt}pt;
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
    box-sizing: border-box;
    border: 0.2mm solid #9aa6b2;
    padding: 0 0.55mm;
    text-align: center;
    vertical-align: middle;
    overflow: hidden;
    line-height: ${lineHeight};
    white-space: nowrap;
  }
  html.${printClass} .${printNodeClass} th {
    height: ${layout.headerHeightMm}mm;
    background: #243447;
    color: #fff;
    font-size: ${layout.headerFontPt}pt;
    font-weight: 600;
    white-space: normal;
    word-break: keep-all;
  }
  html.${printClass} .${printNodeClass} td.style-no {
    font-weight: 700;
  }
  html.${printClass} .${printNodeClass} td.name {
    text-align: left;
    white-space: normal;
  }
  html.${printClass} .${printNodeClass} td.name .name-clamp {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: ${layout.nameLines};
    overflow: hidden;
    word-break: break-all;
    line-height: ${lineHeight};
    text-align: left;
  }
  html.${printClass} .${printNodeClass} td.note {
    text-align: left;
    white-space: pre-line;
    word-break: break-all;
  }
  html.${printClass} .${printNodeClass} td.photo img,
  html.${printClass} .${printNodeClass} td.photo .photo-thumb {
    width: ${layout.photoMm}mm !important;
    height: ${layout.photoMm}mm !important;
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

function safeExcelFileName(value: string) {
  const safe = value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_')
  return safe || '화물입고'
}

export function CargoLinePhoto({
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
  shipmentId = '',
  stage,
  tidySavedAt = null,
  onSaveRows,
  onClose,
}: CargoUnloadListDialogProps) {
  const copy = PURPOSE_COPY[purpose]
  const listColumns =
    purpose === 'warehouse'
      ? CARGO_WAREHOUSE_LINE_LIST_COLUMNS
      : CARGO_LINE_LIST_COLUMNS
  useRenderWatch(copy.watchName)
  const [openedAt] = useState(() => Date.now())
  const [listSource, setListSource] = useState<'saved' | 'live'>(() =>
    purpose === 'warehouse' && tidySavedAt ? 'saved' : 'live',
  )
  const [listPersisted, setListPersisted] = useState(false)
  const [savingList, setSavingList] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [printOrientation, setPrintOrientation] =
    useState<PrintOrientation>('portrait')
  const [downloadingExcel, setDownloadingExcel] = useState(false)
  const [excelError, setExcelError] = useState<string | null>(null)
  const [uncheckedKeys, setUncheckedKeys] = useState<Set<string>>(
    () => new Set(),
  )

  useEffect(() => {
    const afterPrint = () =>
      clearUnloadPrintMode(copy.printClass, copy.printStyleId)
    window.addEventListener('afterprint', afterPrint)
    return () => {
      window.removeEventListener('afterprint', afterPrint)
      clearUnloadPrintMode(copy.printClass, copy.printStyleId)
    }
  }, [copy.printClass, copy.printStyleId])

  const savedQuery = useQuery({
    queryKey: ['cargo-inbound-tidy', brandId, shipmentId],
    queryFn: () => getCargoInboundTidyRows(brandId, shipmentId),
    enabled:
      purpose === 'warehouse' && Boolean(brandId && shipmentId && tidySavedAt),
  })
  const savedData = savedQuery.data ?? emptyList<CargoInboundTidyRow>()
  const stockQuery = useQuery({
    queryKey: [copy.queryKey, brandId, openedAt],
    queryFn: async (): Promise<WarehouseStockPosition[]> => {
      const activeSet = await getActiveWarehouseInventorySet(brandId)
      if (!activeSet) return []
      return getWarehouseStockPositions(brandId, activeSet.id)
    },
    enabled: listSource === 'live' && Boolean(brandId),
  })
  const positions = stockQuery.data ?? emptyList<WarehouseStockPosition>()
  const loading =
    listSource === 'saved'
      ? savedQuery.isLoading
      : Boolean(brandId) && stockQuery.isLoading
  const savedSlotCount = useMemo(
    () => savedData.filter((row) => row.warehouseSlot.trim()).length,
    [savedData],
  )

  const productCount = useMemo(
    () => lines.filter(cargoLineHasContent).length,
    [lines],
  )
  const liveRows = useMemo(() => {
    const splitGroups = lines
      .filter(cargoLineHasContent)
      .map((line, index) => {
        const styleNo = line.styleNo.trim()
        const stock = resolveLatestReceivedStockByStyle(positions, styleNo)
        const incomingBoxes = parseUnloadBoxCount(line.boxes)
        const latestBoxes = stock.found ? stock.totalBoxes : 0
        const latestSlot = stock.found ? stock.locationLabel ?? '' : ''
        const parts = splitUnloadStackRows(incomingBoxes, latestBoxes)
        const latestFull =
          incomingBoxes > 0 && parts[0]?.incomingBoxes === 0
        return parts.map((part, partIndex) => {
          if (latestFull && partIndex === 0) return null
          const first = partIndex === 0
          const firstVisible = latestFull ? partIndex === 1 : partIndex === 0
          const boxSum = part.incomingBoxes + part.latestBoxes
          return {
            key: `${styleNo || line.name || 'line'}-${index}-${partIndex}`,
            lineId: line.id,
            partIndex,
            no: line.no.trim() || String(index + 1),
            name: line.name.trim(),
            styleNo,
            quantity: parseCargoLineListInteger(line.qty),
            unitsPerBox: parseCargoLineListInteger(line.perBox),
            boxCount: part.incomingBoxes > 0 ? part.incomingBoxes : null,
            note:
              purpose === 'warehouse'
                ? formatCargoWarehouseNote(line.note, line.requestNote)
                : firstVisible
                  ? line.note.trim()
                  : '',
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
            latestBoxCount:
              first && part.latestBoxes > 0 ? part.latestBoxes : null,
            incomingBoxes: part.incomingBoxes,
            boxSum,
          }
        })
      })
    const built = queueUnloadSplitRows(splitGroups).map((row) => row.value)
    const stowByKey = assignUnloadStowLabels(
      built.map((row) => ({
        key: row.key,
        styleNo: row.styleNo,
        boxSum: row.boxSum,
        incomingBoxes: row.incomingBoxes,
      })),
    )
    return built
      .map((row) => {
        const values: CargoLineListValues = {
          lineId: row.lineId,
          partIndex: row.partIndex,
          no: row.no,
          name: row.name,
          styleNo: row.styleNo,
          quantity: row.quantity,
          unitsPerBox: row.unitsPerBox,
          boxCount: row.boxCount,
          stow: stowByKey.get(row.key) ?? '',
          note: row.note,
          shippedAt: row.shippedAt,
          latestSlot: row.latestSlot,
          latestBoxCount: row.latestBoxCount,
          warehouseSlot: '',
        }
        return {
          key: row.key,
          values,
          cells: formatCargoLineListCells(values),
        }
      })
      .sort((left, right) => {
        if (purpose === 'warehouse') {
          const byStow = compareUnloadStowLabel(left.cells.stow, right.cells.stow)
          if (byStow !== 0) return byStow
        }
        return compareUnloadStyleNo(left.cells.styleNo, right.cells.styleNo)
      })
  }, [lines, positions, purpose, shippedAt])
  const savedRows = useMemo(
    () =>
      savedData.map((row) => {
        const values = storedRowToCargoLineListValues(row)
        return {
          key: row.id,
          values,
          cells: formatCargoLineListCells(values),
        }
      }),
    [savedData],
  )
  const rows = listSource === 'saved' ? savedRows : liveRows
  const printRows = useMemo(
    () => rows.filter((row) => !uncheckedKeys.has(row.key)),
    [rows, uncheckedKeys],
  )
  const printCells = useMemo(
    () => printRows.map((row) => row.cells),
    [printRows],
  )
  const portraitPrintLayout = useMemo(
    () =>
      buildCargoLineListPrintLayout(
        printCells,
        'portrait',
        listColumns,
      ),
    [listColumns, printCells],
  )
  const landscapePrintLayout = useMemo(
    () =>
      buildCargoLineListPrintLayout(
        printCells,
        'landscape',
        listColumns,
      ),
    [listColumns, printCells],
  )
  const autoPrintOrientation = resolveCargoLineListPrintOrientation(
    portraitPrintLayout,
    landscapePrintLayout,
  )
  const printLayout =
    printOrientation === 'landscape' ||
    (printOrientation === 'auto' && autoPrintOrientation === 'landscape')
      ? landscapePrintLayout
      : portraitPrintLayout
  const printDirectionLabel =
    printLayout.orientation === 'landscape' ? '가로' : '세로'
  const autoPrintLayout =
    autoPrintOrientation === 'landscape'
      ? landscapePrintLayout
      : portraitPrintLayout
  const printPhotoPx = Math.round((printLayout.photoMm * 96) / 25.4)
  const allPrintSelected = rows.length > 0 && printRows.length === rows.length
  const somePrintSelected = printRows.length > 0 && !allPrintSelected

  function togglePrintRow(key: string) {
    setUncheckedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleAllPrintRows(checked: boolean) {
    setUncheckedKeys(checked ? new Set() : new Set(rows.map((row) => row.key)))
  }

  function showCurrentStock() {
    setListSource('live')
    setListPersisted(false)
    setUncheckedKeys(new Set())
    setListError(null)
  }

  async function ensureWarehouseListSaved() {
    if (
      purpose !== 'warehouse' ||
      stage !== 'scheduled' ||
      listSource !== 'live' ||
      listPersisted
    ) {
      return true
    }
    if (!onSaveRows) {
      setListError('목록을 저장할 수 없습니다.')
      return false
    }
    if (tidySavedAt) {
      const message =
        savedSlotCount > 0
          ? `저장된 목록을 바꿉니다. 입력한 창고자리 ${savedSlotCount}개도 지워집니다.`
          : '저장된 목록을 현재 재고 목록으로 바꿉니다.'
      if (!window.confirm(message)) return false
    }
    setSavingList(true)
    setListError(null)
    try {
      await onSaveRows(rows.map((row) => row.values))
      setListPersisted(true)
      return true
    } catch (error) {
      console.warn('[cargo-inbound] 창고정리용 목록 저장 실패', {
        shipmentId,
        error,
      })
      setListError(
        error instanceof Error
          ? error.message
          : '창고정리용 목록을 저장하지 못했습니다.',
      )
      return false
    } finally {
      setSavingList(false)
    }
  }

  async function handlePrint() {
    if (loading || savingList || printRows.length === 0) return
    const saved = await ensureWarehouseListSaved()
    if (!saved) return
    applyUnloadPrintMode(
      printLayout,
      copy.printClass,
      copy.printStyleId,
      copy.printNodeClass,
    )
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => window.print()),
    )
  }

  async function handleDownloadExcel() {
    if (loading || downloadingExcel || savingList || printRows.length === 0) return
    const saved = await ensureWarehouseListSaved()
    if (!saved) return
    setDownloadingExcel(true)
    setExcelError(null)
    try {
      const XLSX = await import('xlsx')
      const headers = listColumns.map((column) =>
        column.key === 'photo' ? '사진 URL' : column.label,
      )
      const body = printRows.map((row) =>
        listColumns.map((column) => {
          if (column.key === 'photo') {
            return (
              ruleImageUrls(row.cells.styleNo, LOGISTICS_IMAGE_KEY)[0] ?? ''
            )
          }
          return listCell(row, column.key)
        }),
      )
      const sheet = XLSX.utils.aoa_to_sheet([headers, ...body])
      sheet['!cols'] = [
        { wch: 7 },
        { wch: 30 },
        { wch: 48 },
        { wch: 14 },
        { wch: 12 },
        { wch: 10 },
        { wch: 10 },
        { wch: 12 },
        { wch: 14 },
        { wch: 32 },
        { wch: 12 },
        { wch: 18 },
        { wch: 12 },
      ]
      if (sheet['!ref']) {
        sheet['!autofilter'] = { ref: sheet['!ref'] }
      }
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(
        workbook,
        sheet,
        purpose === 'warehouse' ? '창고정리용' : '하차용',
      )
      XLSX.writeFile(
        workbook,
        `${safeExcelFileName(title)}_${copy.label}.xlsx`,
      )
    } catch (error) {
      console.warn('[cargo-inbound] 목록 엑셀 다운로드 실패', {
        purpose,
        title,
        error,
      })
      setExcelError(
        error instanceof Error
          ? error.message
          : '엑셀을 만들지 못했습니다.',
      )
    } finally {
      setDownloadingExcel(false)
    }
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
                최신자리가 이미 16박스면 바로 +NEW로 보냅니다.
                {listSource === 'saved'
                  ? ' 이 목록은 인쇄할 때 저장한 내용입니다.'
                  : ''}
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
              <Badge variant={printRows.length > 0 ? 'outline' : 'muted'}>
                인쇄 {formatNumber(printRows.length)}행
              </Badge>
              {listSource === 'saved' && tidySavedAt ? (
                <Badge variant="outline">
                  저장된 목록 · {formatTidySavedAt(tidySavedAt)}
                </Badge>
              ) : null}
              {listPersisted ? (
                <Badge variant="success">이 목록을 저장했습니다</Badge>
              ) : null}
              {purpose === 'warehouse' &&
              stage === 'scheduled' &&
              listSource === 'live' &&
              !listPersisted ? (
                <Badge variant="warning">인쇄하면 이 목록이 저장됩니다</Badge>
              ) : null}
              {listSource === 'live' && stockQuery.isError ? (
                <span className="text-xs text-danger">
                  최신 자리를 불러오지 못했습니다.
                </span>
              ) : null}
              {listSource === 'saved' && savedQuery.isError ? (
                <span className="text-xs text-danger">
                  저장된 목록을 불러오지 못했습니다.
                </span>
              ) : null}
              {listError ? (
                <span className="text-xs text-danger">{listError}</span>
              ) : null}
              {excelError ? (
                <span className="text-xs text-danger">{excelError}</span>
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
                className="h-8 min-w-44 rounded-md border border-border bg-card px-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring"
                title="인쇄 방향 선택"
              >
                <option value="portrait">
                  {formatCargoLineListPrintOptionLabel('세로', portraitPrintLayout)}
                </option>
                <option value="landscape">
                  {formatCargoLineListPrintOptionLabel('가로', landscapePrintLayout)}
                </option>
                <option value="auto">
                  {`자동 (${autoPrintOrientation === 'landscape' ? '가로' : '세로'})${
                    autoPrintLayout.pages.length > 1
                      ? ` · ${autoPrintLayout.pages.length}장`
                      : ''
                  }`}
                </option>
              </select>
              {purpose === 'warehouse' &&
              stage === 'scheduled' &&
              tidySavedAt &&
              listSource === 'saved' ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!savedQuery.isSuccess}
                  onClick={showCurrentStock}
                >
                  <RefreshCw className="size-3.5" />
                  현재 재고로 다시 만들기
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={loading || savingList || printRows.length === 0}
                onClick={() => void handlePrint()}
              >
                {savingList ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Printer className="size-3.5" />
                )}
                {savingList ? '저장 중...' : '인쇄'}
              </Button>
              {purpose === 'warehouse' ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={
                    loading ||
                    savingList ||
                    downloadingExcel ||
                    printRows.length === 0
                  }
                  onClick={() => void handleDownloadExcel()}
                >
                  {downloadingExcel ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Download className="size-3.5" />
                  )}
                  {downloadingExcel ? '엑셀 생성 중...' : '엑셀 다운로드'}
                </Button>
              ) : null}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {loading ? (
              <div className="flex min-h-[16rem] flex-col items-center justify-center gap-3 px-4 py-10">
                <Loader2 className="size-8 animate-spin text-foreground" />
                <p className="text-sm text-muted-foreground">
                  {listSource === 'saved'
                    ? '저장된 목록을 불러오는 중...'
                    : '최신 자리와 박스 수를 불러오는 중...'}
                </p>
              </div>
            ) : listSource === 'saved' && savedQuery.isError ? (
              <p className="px-4 py-10 text-center text-sm text-danger">
                저장된 목록을 불러오지 못했습니다.
              </p>
            ) : rows.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                {listSource === 'saved'
                  ? '저장된 창고정리용 목록이 없습니다.'
                  : '하차할 상품이 없습니다.'}
              </p>
            ) : (
              <table className="w-full min-w-[74rem] table-fixed border-separate border-spacing-0 text-sm">
                <colgroup>
                  <col className="w-10" />
                  {listColumns.map((column) => (
                    <col key={column.key} className={column.widthClass} />
                  ))}
                </colgroup>
                <thead className="sticky top-0 z-20">
                  <tr>
                    <th className="border-b border-r border-border bg-foreground px-1 py-1.5 text-center">
                      <input
                        type="checkbox"
                        className="size-3.5 accent-primary"
                        aria-label="인쇄할 행 전체 선택"
                        checked={allPrintSelected}
                        ref={(element) => {
                          if (element) element.indeterminate = somePrintSelected
                        }}
                        onChange={(event) =>
                          toggleAllPrintRows(event.target.checked)
                        }
                      />
                    </th>
                    {listColumns.map((column) => (
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
                  {rows.map((row) => {
                    const printSelected = !uncheckedKeys.has(row.key)
                    return (
                    <tr
                      key={row.key}
                      className="odd:bg-card even:bg-muted/20"
                    >
                      <td className="h-11 border-b border-r border-border px-1 text-center align-middle">
                        <input
                          type="checkbox"
                          className="size-3.5 accent-primary"
                          aria-label={`${row.cells.no} ${row.cells.name || row.cells.styleNo} 인쇄 선택`}
                          checked={printSelected}
                          onChange={() => togglePrintRow(row.key)}
                        />
                      </td>
                      {listColumns.map((column) => {
                        if (column.key === 'photo') {
                          return (
                            <td
                              key={`${row.key}-photo`}
                              className="h-11 border-b border-r border-border px-0.5 align-middle last:border-r-0"
                            >
                              <CargoLinePhoto
                                styleNo={row.cells.styleNo}
                                name={row.cells.name}
                              />
                            </td>
                          )
                        }

                        const value = listCell(row, column.key)
                        const isNote = column.key === 'note'
                        return (
                          <td
                            key={`${row.key}-${column.key}`}
                            className={cn(
                              'border-b border-r border-border px-1 align-middle text-sm leading-tight text-foreground last:border-r-0',
                              isNote
                                ? 'min-h-11 whitespace-pre-line'
                                : 'h-11 overflow-hidden whitespace-nowrap',
                              column.align === 'left'
                                ? 'text-left'
                                : 'text-center',
                              column.key === 'no' && 'text-muted-foreground',
                              column.key === 'name' && 'font-medium',
                              column.key === 'styleNo' && 'font-bold',
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
                    )
                  })}
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
        {printLayout.pages.map((page, pageIndex) => (
          <section className="print-page" key={`print-page-${page.start}`}>
            <h1>
              {title} {copy.label}
            </h1>
            <p>
              {brandName} · {title} · {formatNumber(printRows.length)}행 ·{' '}
              {printDirectionLabel}
              {printLayout.pages.length > 1
                ? ` · ${pageIndex + 1}/${printLayout.pages.length}장`
                : ''}
            </p>
            <table>
              <colgroup>
                {listColumns.map((column) => (
                  <col
                    key={`print-col-${page.start}-${column.key}`}
                    style={{
                      width: `${
                        printLayout.columns.find((item) => item.key === column.key)
                          ?.widthPercent ?? 0
                      }%`,
                    }}
                  />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {listColumns.map((column) => (
                    <th key={`print-h-${page.start}-${column.key}`}>
                      {column.printLabel}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {printRows.slice(page.start, page.end).map((row, rowIndex) => (
                  <tr
                    key={`print-${page.start}-${row.key}`}
                    style={{ height: `${page.rowHeightsMm[rowIndex] ?? 0}mm` }}
                  >
                    {listColumns.map((column) => {
                      if (column.key === 'photo') {
                        return (
                          <td key={`print-${row.key}-photo`} className="photo">
                            {row.cells.styleNo ? (
                              <CargoLinePhoto
                                styleNo={row.cells.styleNo}
                                name={row.cells.name}
                                size={printPhotoPx}
                              />
                            ) : (
                              '—'
                            )}
                          </td>
                        )
                      }
                      const text = listCell(row, column.key)
                      return (
                        <td
                          key={`print-${row.key}-${column.key}`}
                          className={
                            column.key === 'styleNo'
                              ? 'style-no'
                              : column.align === 'left'
                                ? column.key === 'name'
                                  ? 'name'
                                  : 'note'
                                : undefined
                          }
                        >
                          {column.key === 'name' ? (
                            <div className="name-clamp">{text}</div>
                          ) : (
                            text
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
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
  shipmentId,
  stage,
  tidySavedAt,
  onSaveRows,
}: {
  title: string
  brandId: string
  brandName: string
  shippedAt: string
  lines: CargoInboundLineDraft[]
  purpose: CargoLineListPurpose
  shipmentId?: string
  stage?: CargoInboundStage
  tidySavedAt?: string | null
  onSaveRows?: (rows: readonly CargoLineListValues[]) => Promise<void>
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
          shipmentId={shipmentId}
          stage={stage}
          tidySavedAt={tidySavedAt}
          onSaveRows={onSaveRows}
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
  shipmentId,
  stage,
  tidySavedAt,
  onSaveRows,
}: {
  title: string
  brandId: string
  brandName: string
  shippedAt: string
  lines: CargoInboundLineDraft[]
  shipmentId: string
  stage: CargoInboundStage
  tidySavedAt: string | null
  onSaveRows?: (rows: readonly CargoLineListValues[]) => Promise<void>
}) {
  return (
    <CargoLineListButton
      title={title}
      brandId={brandId}
      brandName={brandName}
      shippedAt={shippedAt}
      lines={lines}
      purpose="warehouse"
      shipmentId={shipmentId}
      stage={stage}
      tidySavedAt={tidySavedAt}
      onSaveRows={onSaveRows}
    />
  )
}
