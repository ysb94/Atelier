import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { ChevronLeft, ChevronRight, Printer } from 'lucide-react'
import { WorkspaceTabOverlay } from '@/components/layout/workspace-tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  buildInvoiceProductListPrintPages,
  invoiceProductListPrintSheetClass,
  INVOICE_PRODUCT_LIST_COLUMN_MODE_OPTIONS,
  INVOICE_PRODUCT_LIST_COLUMN_MODE_ORDER,
  recommendInvoiceProductListColumnMode,
  type InvoiceProductListColumnMode,
  type InvoiceProductListPrintPage,
} from '@/lib/invoice/product-list-print'
import { buildDefaultInvoiceProductListPrintLayout } from '@/lib/invoice/product-list-route'
import type { InvoiceProductListWarehouseAllocation } from '@/lib/invoice/product-list-warehouse'
import { cn, formatNumber } from '@/lib/utils'
import {
  InvoiceProductListPrint,
  InvoiceProductListPrintPageView,
} from './InvoiceProductListPrint'

const PRINT_PAGE_STYLE_ID = 'bulk-outbound-product-list-print-page-style'
const WAREHOUSE_LABEL = '박스창고'

function applyPrintMode(mode: InvoiceProductListColumnMode) {
  const html = document.documentElement
  html.classList.remove(
    ...INVOICE_PRODUCT_LIST_COLUMN_MODE_ORDER.map((item) =>
      invoiceProductListPrintSheetClass(item),
    ),
  )
  html.classList.add(
    'printing-invoice-product-list',
    invoiceProductListPrintSheetClass(mode),
  )
  let style = document.getElementById(PRINT_PAGE_STYLE_ID)
  if (!style) {
    style = document.createElement('style')
    style.id = PRINT_PAGE_STYLE_ID
    document.head.appendChild(style)
  }
  style.textContent =
    mode === 'horizontal_3'
      ? '@page { size: A4 landscape; margin: 8mm 10mm; }'
      : '@page { size: A4 portrait; margin: 10mm 8mm 12mm; }'
}

function clearPrintMode() {
  document.documentElement.classList.remove(
    'printing-invoice-product-list',
    ...INVOICE_PRODUCT_LIST_COLUMN_MODE_ORDER.map((mode) =>
      invoiceProductListPrintSheetClass(mode),
    ),
  )
  document.getElementById(PRINT_PAGE_STYLE_ID)?.remove()
}

function withJobHeader(
  pages: InvoiceProductListPrintPage[],
  jobTitle: string,
  jobSubtitle: string,
) {
  return pages.map((page) => ({
    ...page,
    jobTitle,
    jobSubtitle,
    hideCheckColumn: true,
  }))
}

function PreviewSheet({ page }: { page: InvoiceProductListPrintPage }) {
  const frameRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.42)
  const [sheetSize, setSheetSize] = useState({ width: 0, height: 0 })

  useLayoutEffect(() => {
    const frame = frameRef.current
    const sheet = sheetRef.current
    if (!frame || !sheet) return
    const update = () => {
      const availableWidth = Math.max(frame.clientWidth - 8, 1)
      const availableHeight = Math.max(frame.clientHeight - 8, 1)
      const sheetWidth = sheet.offsetWidth
      const sheetHeight = sheet.offsetHeight
      if (!sheetWidth || !sheetHeight) return
      setSheetSize({ width: sheetWidth, height: sheetHeight })
      setScale(
        Math.min(availableWidth / sheetWidth, availableHeight / sheetHeight, 1),
      )
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [page.columnMode, page.globalPageIndex, page.jobTitle, page.jobSubtitle])

  return (
    <div ref={frameRef} className="invoice-product-list-print-preview-frame">
      <div
        className="invoice-product-list-print-preview-scaler"
        style={{
          width: sheetSize.width ? sheetSize.width * scale : undefined,
          height: sheetSize.height ? sheetSize.height * scale : undefined,
        }}
      >
        <div
          ref={sheetRef}
          className="invoice-product-list-print-preview-sheet"
          style={{
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
          <InvoiceProductListPrintPageView page={page} variant="preview" />
        </div>
      </div>
    </div>
  )
}

function SimplePreviewDialog({
  jobTitle,
  jobSubtitle,
  pages,
  columnMode,
  pageCounts,
  recommendedMode,
  shortageQuantity,
  shortageStyles,
  onChangeColumnMode,
  onClose,
  onPrint,
}: {
  jobTitle: string
  jobSubtitle: string
  pages: InvoiceProductListPrintPage[]
  columnMode: InvoiceProductListColumnMode
  pageCounts: Record<InvoiceProductListColumnMode, number>
  recommendedMode: InvoiceProductListColumnMode
  shortageQuantity: number
  shortageStyles: number
  onChangeColumnMode: (mode: InvoiceProductListColumnMode) => void
  onClose: () => void
  onPrint: (
    mode: InvoiceProductListColumnMode,
    pages: InvoiceProductListPrintPage[],
  ) => void
}) {
  const [pageIndex, setPageIndex] = useState(0)
  const currentPage = pages[Math.min(pageIndex, Math.max(pages.length - 1, 0))]

  useEffect(() => {
    setPageIndex(0)
  }, [columnMode])

  return (
    <WorkspaceTabOverlay>
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3">
      <button
        type="button"
        aria-label="닫기"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 flex h-[min(92vh,920px)] w-full max-w-[960px] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">상품 리스트 미리보기</h2>
            <p className="mt-0.5 truncate text-sm font-medium">{jobTitle}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {jobSubtitle}
            </p>
          </div>
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>
            닫기
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-2.5">
          <Badge variant="outline">{WAREHOUSE_LABEL}</Badge>
          <Badge variant="outline">{formatNumber(pages.length)}장</Badge>
          {shortageQuantity > 0 ? (
            <Badge variant="danger">
              미지정 {formatNumber(shortageQuantity)} ·{' '}
              {formatNumber(shortageStyles)}종
            </Badge>
          ) : null}
          <div className="flex flex-wrap gap-1">
            {INVOICE_PRODUCT_LIST_COLUMN_MODE_OPTIONS.map((option) => {
              const selected = columnMode === option.value
              const recommended = recommendedMode === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onChangeColumnMode(option.value)}
                  className={cn(
                    'rounded-md border px-2.5 py-1 text-xs',
                    selected
                      ? 'border-primary/40 bg-primary/10 text-foreground'
                      : 'border-border text-muted-foreground hover:bg-muted/50',
                  )}
                >
                  {option.label}
                  <span className="ml-1 tabular-nums text-muted-foreground">
                    {formatNumber(pageCounts[option.value])}장
                    {recommended ? ' · 추천' : ''}
                  </span>
                </button>
              )
            })}
          </div>
          <div className="ml-auto flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pageIndex <= 0}
              onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
            >
              <ChevronLeft className="size-3.5" />
            </Button>
            <span className="min-w-[4.5rem] text-center text-xs tabular-nums text-muted-foreground">
              {pages.length === 0
                ? '0 / 0'
                : `${pageIndex + 1} / ${pages.length}`}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pageIndex >= pages.length - 1}
              onClick={() =>
                setPageIndex((current) =>
                  Math.min(pages.length - 1, current + 1),
                )
              }
            >
              <ChevronRight className="size-3.5" />
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={pages.length === 0}
              onClick={() => onPrint(columnMode, pages)}
            >
              <Printer className="size-3.5" />
              출력
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden bg-muted/30 p-3">
          {currentPage ? (
            <PreviewSheet page={currentPage} />
          ) : (
            <p className="px-4 py-16 text-center text-sm text-muted-foreground">
              출력할 페이지가 없습니다.
            </p>
          )}
        </div>
      </div>
    </div>
    </WorkspaceTabOverlay>
  )
}

export function BulkOutboundProductListPrint({
  brandId: _brandId,
  allocation,
  jobTitle,
  jobSubtitle,
}: {
  brandId: string
  allocation: InvoiceProductListWarehouseAllocation
  jobTitle: string
  jobSubtitle: string
}) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const [columnMode, setColumnMode] =
    useState<InvoiceProductListColumnMode>('vertical_1')
  /** 실제 브라우저 출력에 쓰는 스냅샷. 미리보기 선택과 어긋나지 않게 따로 둔다. */
  const [printSnapshot, setPrintSnapshot] = useState<{
    mode: InvoiceProductListColumnMode
    pages: InvoiceProductListPrintPage[]
  } | null>(null)

  const layout = useMemo(
    () =>
      buildDefaultInvoiceProductListPrintLayout(
        allocation.groups,
        'box_storage',
        'grouped',
      ),
    [allocation.groups],
  )

  const pagesByMode = useMemo(() => {
    const build = (mode: InvoiceProductListColumnMode) =>
      withJobHeader(
        buildInvoiceProductListPrintPages({
          groups: allocation.groups,
          warehouseLabel: WAREHOUSE_LABEL,
          layout,
          columnMode: mode,
          autoFit: true,
          zoneHeaderRows: 0,
          keepZoneTogether: false,
        }),
        jobTitle,
        jobSubtitle,
      )
    return {
      vertical_1: build('vertical_1'),
      vertical_2: build('vertical_2'),
      horizontal_3: build('horizontal_3'),
    }
  }, [allocation.groups, jobSubtitle, jobTitle, layout])

  const pageCounts = useMemo(
    () => ({
      vertical_1: pagesByMode.vertical_1.length,
      vertical_2: pagesByMode.vertical_2.length,
      horizontal_3: pagesByMode.horizontal_3.length,
    }),
    [pagesByMode],
  )

  const recommendedMode = useMemo(
    () => recommendInvoiceProductListColumnMode(pageCounts),
    [pageCounts],
  )

  const previewPages = pagesByMode[columnMode]
  const activePrintPages = printSnapshot?.pages ?? previewPages
  const activePrintMode = printSnapshot?.mode ?? columnMode

  useEffect(() => {
    const beforePrint = () => {
      if (activePrintPages.length === 0) return
      applyPrintMode(activePrintMode)
    }
    const afterPrint = () => {
      clearPrintMode()
      setPrintSnapshot(null)
    }
    window.addEventListener('beforeprint', beforePrint)
    window.addEventListener('afterprint', afterPrint)
    return () => {
      window.removeEventListener('beforeprint', beforePrint)
      window.removeEventListener('afterprint', afterPrint)
      clearPrintMode()
    }
  }, [activePrintMode, activePrintPages.length])

  function handlePrint(
    mode: InvoiceProductListColumnMode,
    pages: InvoiceProductListPrintPage[],
  ) {
    if (pages.length === 0) return
    flushSync(() => {
      setPrintSnapshot({ mode, pages })
    })
    applyPrintMode(mode)
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => window.print())
    })
  }

  const canPrint = allocation.lines.length > 0 && previewPages.length > 0

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={!canPrint}
        onClick={() => {
          setColumnMode(recommendedMode)
          setPreviewOpen(true)
        }}
      >
        <Printer className="size-3.5" />
        미리보기 및 출력
      </Button>

      <InvoiceProductListPrint
        key={`${activePrintMode}-${activePrintPages.length}-${activePrintPages[0]?.columnMode ?? 'empty'}`}
        pages={activePrintPages}
      />

      {previewOpen ? (
        <SimplePreviewDialog
          jobTitle={jobTitle}
          jobSubtitle={jobSubtitle}
          pages={previewPages}
          columnMode={columnMode}
          pageCounts={pageCounts}
          recommendedMode={recommendedMode}
          shortageQuantity={allocation.totalShortage}
          shortageStyles={allocation.stylesWithShortage}
          onChangeColumnMode={setColumnMode}
          onClose={() => setPreviewOpen(false)}
          onPrint={handlePrint}
        />
      ) : null}
    </>
  )
}
