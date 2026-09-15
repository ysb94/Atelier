import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { Loader2, PackageSearch, Printer, X } from 'lucide-react'
import { WorkspaceTabOverlay } from '@/components/layout/workspace-tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { CargoDraftRow } from '@/features/logistics/CargoInboundAddPanel'
import {
  getActiveWarehouseInventorySet,
  getWarehouseStockPositions,
  listStyleRefsByStyleNos,
} from '@/lib/api'
import { useRenderWatch } from '@/lib/diagnostics'
import { normalizeStyleNo } from '@/lib/import/transform'
import type { StyleRef, WarehouseStockPosition } from '@/lib/types'
import { emptyList, formatNumber } from '@/lib/utils'
import { resolveLatestReceivedStockByStyle } from '@/lib/warehouse/stock'

type CargoStockCheckDialogProps = {
  title: string
  brandId: string
  lines: CargoDraftRow[]
  onClose: () => void
}

type CargoStockPrintOrientation = 'auto' | 'portrait' | 'landscape'

const PRINT_CLASS = 'printing-cargo-stock-check'
const PRINT_STYLE_ID = 'cargo-stock-check-print-style'
/** 이 수 이상이면 A4 가로로 뽑는다. */
const LANDSCAPE_PRINT_MIN_ROWS = 16
const EMPTY_STYLE_REFS = new Map<string, StyleRef>()

function formatReceivedOn(value: string | null) {
  if (!value) return '-'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  const yy = String(date.getFullYear()).slice(-2)
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yy}${mm}${dd}`
}

function applyCargoStockCheckPrintMode(landscape: boolean) {
  document.documentElement.classList.add(PRINT_CLASS)
  let style = document.getElementById(PRINT_STYLE_ID)
  if (!style) {
    style = document.createElement('style')
    style.id = PRINT_STYLE_ID
    document.head.appendChild(style)
  }
  const pageSize = landscape ? 'A4 landscape' : 'A4 portrait'
  const pageMargin = landscape ? '8mm 8mm' : '10mm 8mm'
  const tableFont = landscape ? '13px' : '12px'
  const titleFont = landscape ? '18px' : '16px'
  const metaFont = landscape ? '12px' : '11px'
  const rowHeight = landscape ? '32px' : '30px'
  const cellPad = landscape ? '5px 8px' : '4px 6px'
  style.textContent = `
@page { size: ${pageSize}; margin: ${pageMargin}; }
@media screen {
  .cargo-stock-check-print { display: none !important; }
}
@media print {
  html.printing-cargo-stock-check,
  html.printing-cargo-stock-check body {
    height: auto !important;
    overflow: visible !important;
    background: #fff !important;
  }
  html.printing-cargo-stock-check body > :not(.cargo-stock-check-print) {
    display: none !important;
  }
  html.printing-cargo-stock-check .cargo-stock-check-print {
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
  html.printing-cargo-stock-check .cargo-stock-check-print h1 {
    font-size: ${titleFont};
    margin: 0 0 4px;
  }
  html.printing-cargo-stock-check .cargo-stock-check-print p {
    margin: 0 0 10px;
    color: #555;
    font-size: ${metaFont};
  }
  html.printing-cargo-stock-check .cargo-stock-check-print table {
    width: 100% !important;
    border-collapse: collapse;
    table-layout: fixed;
    font-size: ${tableFont};
  }
  html.printing-cargo-stock-check .cargo-stock-check-print thead {
    display: table-header-group;
  }
  html.printing-cargo-stock-check .cargo-stock-check-print tbody tr {
    height: ${rowHeight};
    break-inside: avoid;
    page-break-inside: avoid;
  }
  html.printing-cargo-stock-check .cargo-stock-check-print tbody tr:nth-child(even) td {
    background: #edf2f6 !important;
  }
  html.printing-cargo-stock-check .cargo-stock-check-print th,
  html.printing-cargo-stock-check .cargo-stock-check-print td {
    border: 1px solid #9aa6b2;
    padding: ${cellPad};
    text-align: left;
    vertical-align: middle;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    height: ${rowHeight};
  }
  html.printing-cargo-stock-check .cargo-stock-check-print th {
    background: #243447;
    color: #fff;
  }
  html.printing-cargo-stock-check .cargo-stock-check-print td.num {
    text-align: right;
  }
}
`
}

function clearCargoStockCheckPrintMode() {
  document.documentElement.classList.remove(PRINT_CLASS)
  document.getElementById(PRINT_STYLE_ID)?.remove()
}

export function CargoStockCheckDialog({
  title,
  brandId,
  lines,
  onClose,
}: CargoStockCheckDialogProps) {
  useRenderWatch('CargoStockCheckDialog')
  const [openedAt] = useState(() => Date.now())
  const [printOrientation, setPrintOrientation] =
    useState<CargoStockPrintOrientation>('auto')

  useEffect(() => {
    const afterPrint = () => clearCargoStockCheckPrintMode()
    window.addEventListener('afterprint', afterPrint)
    return () => {
      window.removeEventListener('afterprint', afterPrint)
      clearCargoStockCheckPrintMode()
    }
  }, [])

  const styleNos = useMemo(
    () =>
      Array.from(
        new Set(
          lines
            .map((line) => normalizeStyleNo(line.styleNo.trim()))
            .filter(Boolean),
        ),
      ),
    [lines],
  )
  const styleRefsQuery = useQuery({
    queryKey: ['cargo-inbound-stock-check-styles', brandId, styleNos],
    queryFn: () => listStyleRefsByStyleNos(brandId, styleNos),
    enabled: Boolean(brandId) && styleNos.length > 0,
  })
  const stockQuery = useQuery({
    queryKey: ['cargo-inbound-stock-check', brandId, openedAt],
    queryFn: async (): Promise<WarehouseStockPosition[]> => {
      const activeSet = await getActiveWarehouseInventorySet(brandId)
      if (!activeSet) return []
      return getWarehouseStockPositions(brandId, activeSet.id)
    },
    enabled: Boolean(brandId),
  })
  const styleRefs = styleRefsQuery.data ?? EMPTY_STYLE_REFS
  const positions = stockQuery.data ?? emptyList<WarehouseStockPosition>()
  const waitingStyles =
    Boolean(brandId) && styleNos.length > 0 && styleRefsQuery.isLoading
  const waitingStock = Boolean(brandId) && stockQuery.isLoading
  const loading = waitingStyles || waitingStock

  const rows = useMemo(() => {
    return lines
      .map((line, index) => {
        const styleNo = line.styleNo.trim()
        const normalizedStyleNo = normalizeStyleNo(styleNo)
        const styleRef = styleRefs.get(normalizedStyleNo)
        const stock = resolveLatestReceivedStockByStyle(positions, styleNo)
        return {
          key: `${styleNo || 'empty'}-${index}`,
          no: line.no || String(index + 1),
          name: normalizedStyleNo
            ? styleRef?.name.trim() || '-'
            : line.name.trim() || '-',
          styleNo: normalizedStyleNo || styleNo || '-',
          stock,
        }
      })
      .slice()
      .sort((left, right) => {
        const leftKey = left.stock.found
          ? left.stock.locationLabel ?? ''
          : '\uffff'
        const rightKey = right.stock.found
          ? right.stock.locationLabel ?? ''
          : '\uffff'
        const byLocation = leftKey.localeCompare(rightKey, 'ko-KR')
        if (byLocation !== 0) return byLocation
        return left.styleNo.localeCompare(right.styleNo, 'ko-KR')
      })
  }, [lines, positions, styleRefs])

  const printRows = useMemo(
    () => rows.filter((row) => row.stock.found),
    [rows],
  )
  const foundCount = printRows.length
  const autoPrintLandscape = printRows.length >= LANDSCAPE_PRINT_MIN_ROWS
  const autoPrintOrientationLabel = autoPrintLandscape ? '가로' : '세로'
  const printLandscape =
    printOrientation === 'landscape' ||
    (printOrientation === 'auto' && autoPrintLandscape)
  const printOrientationLabel = printLandscape ? '가로' : '세로'

  function handlePrint() {
    if (loading || printRows.length === 0) return
    applyCargoStockCheckPrintMode(printLandscape)
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
        aria-label="재고 파악 닫기"
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cargo-stock-check-title"
        className="relative z-10 flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-lg"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h2
              id="cargo-stock-check-title"
              className="text-base font-semibold tracking-tight"
            >
              재고 파악
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              창고 관리 기준으로, M번호마다 입고일이 가장 최신인 자리의 박스
              합을 봅니다.
            </p>
          </div>
          <Button type="button" size="icon" variant="ghost" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="muted">대상 {formatNumber(rows.length)}종</Badge>
            <Badge variant={foundCount > 0 ? 'success' : 'muted'}>
              재고 확인 {formatNumber(foundCount)}
            </Badge>
            {styleRefsQuery.isError ? (
              <span className="text-xs text-danger">
                상품 DB를 불러오지 못했습니다.
              </span>
            ) : null}
            {stockQuery.isError ? (
              <span className="text-xs text-danger">
                창고를 불러오지 못했습니다.
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-1.5">
            <label className="sr-only" htmlFor="cargo-stock-print-orientation">
              인쇄 방향
            </label>
            <select
              id="cargo-stock-print-orientation"
              value={printOrientation}
              onChange={(event) =>
                setPrintOrientation(
                  event.target.value as CargoStockPrintOrientation,
                )
              }
              className="h-8 rounded-md border border-border bg-card px-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring"
              title="인쇄 방향 선택"
            >
              <option value="auto">
                자동 ({autoPrintOrientationLabel})
              </option>
              <option value="portrait">세로</option>
              <option value="landscape">가로</option>
            </select>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={loading || printRows.length === 0}
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
                상품 정보와 창고 재고를 불러오는 중...
              </p>
            </div>
          ) : rows.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              확인할 상품이 없습니다.
            </p>
          ) : (
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="sticky top-0 bg-muted/90 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">NO</th>
                  <th className="px-3 py-2 font-medium">M번호</th>
                  <th className="px-3 py-2 font-medium">품명</th>
                  <th className="px-3 py-2 font-medium">최신 입고 위치</th>
                  <th className="px-3 py-2 text-right font-medium">박스 합</th>
                  <th className="px-3 py-2 font-medium">최신 입고일</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} className="border-t border-border">
                    <td className="px-3 py-2 text-muted-foreground">{row.no}</td>
                    <td className="px-3 py-2 font-mono text-xs font-semibold">
                      {row.styleNo}
                    </td>
                    <td className="px-3 py-2">{row.name}</td>
                    <td className="px-3 py-2">
                      {row.stock.found ? (
                        row.stock.locationLabel ?? '-'
                      ) : (
                        <span className="inline-flex rounded border border-primary/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                          NEW
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-medium">
                      {row.stock.found
                        ? formatNumber(row.stock.totalBoxes)
                        : '-'}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {row.stock.found
                        ? formatReceivedOn(row.stock.receivedOn)
                        : '-'}
                    </td>
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
      <div className="cargo-stock-check-print hidden" aria-hidden>
        <h1>
          {title} 재고 파악
        </h1>
        <p>
          재고 확인 {formatNumber(printRows.length)}종 · {printOrientationLabel}
        </p>
        <table>
          <colgroup>
            <col style={{ width: '7%' }} />
            <col style={{ width: '15%' }} />
            <col style={{ width: '34%' }} />
            <col style={{ width: '19%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '13%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>NO</th>
              <th>M번호</th>
              <th>품명</th>
              <th>최신 입고 위치</th>
              <th>박스 합</th>
              <th>최신 입고일</th>
            </tr>
          </thead>
          <tbody>
            {printRows.map((row) => (
              <tr key={`print-${row.key}`}>
                <td>{row.no}</td>
                <td>{row.styleNo}</td>
                <td>{row.name}</td>
                <td>{row.stock.locationLabel ?? '-'}</td>
                <td className="num">{formatNumber(row.stock.totalBoxes)}</td>
                <td>{formatReceivedOn(row.stock.receivedOn)}</td>
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

export function CargoStockCheckButton({
  title,
  brandId,
  lines,
}: {
  title: string
  brandId: string
  lines: CargoDraftRow[]
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
      >
        <PackageSearch className="size-3.5" />
        재고 파악
      </Button>
      {open ? (
        <CargoStockCheckDialog
          title={title}
          brandId={brandId}
          lines={lines}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  )
}
