import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Plus,
  Printer,
  RotateCcw,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { InvoiceProductListPrintPageView } from './InvoiceProductListPrint'
import { InvoiceProductListRoutePresetPanel } from './InvoiceProductListRoutePresetPanel'
import type {
  InvoiceProductListColumnMode,
  InvoiceProductListPrintPage,
  InvoiceProductListPrintPageCounts,
} from '@/lib/invoice/product-list-print'
import { INVOICE_PRODUCT_LIST_COLUMN_MODE_OPTIONS } from '@/lib/invoice/product-list-print'
import {
  addInvoiceProductListRouteGroup,
  applyInvoiceProductListRouteSplitMode,
  buildDefaultInvoiceProductListPrintLayout,
  formatInvoiceProductListRouteLabel,
  INVOICE_PRODUCT_LIST_ROUTE_SPLIT_MODES,
  INVOICE_PRODUCT_LIST_UNSPECIFIED_ROUTE_ID,
  invoiceProductListRouteSplitMode,
  moveInvoiceProductListRouteGroup,
  moveInvoiceProductListZonePrefix,
  moveInvoiceProductListZoneToNeighbor,
  type InvoiceProductListPrintLayout,
} from '@/lib/invoice/product-list-route'
import {
  UNSPECIFIED_LOCATION_ZONE,
  type InvoiceProductListWarehouseGroup,
} from '@/lib/invoice/product-list-warehouse'
import { WorkspaceTabOverlay } from '@/components/layout/workspace-tabs'
import { cn, formatNumber } from '@/lib/utils'

function InvoiceProductListPrintPreviewSheet({
  page,
}: {
  page: InvoiceProductListPrintPage
}) {
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
  }, [page.columnMode, page.globalPageIndex])

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

export function InvoiceProductListPrintPreviewDialog({
  brandId,
  warehouseLabel,
  groups,
  layout,
  pages,
  columnMode,
  pageCounts,
  recommendedMode,
  selectedRouteGroupId,
  shortageQuantity,
  shortageStyles,
  onChangeLayout,
  onChangeColumnMode,
  onSelectRouteGroup,
  onClose,
  onPrint,
}: {
  brandId: string
  warehouseLabel: string
  groups: InvoiceProductListWarehouseGroup[]
  layout: InvoiceProductListPrintLayout
  pages: InvoiceProductListPrintPage[]
  columnMode: InvoiceProductListColumnMode
  pageCounts: InvoiceProductListPrintPageCounts
  recommendedMode: InvoiceProductListColumnMode
  selectedRouteGroupId: string | null
  shortageQuantity: number
  shortageStyles: number
  onChangeLayout: (layout: InvoiceProductListPrintLayout) => void
  onChangeColumnMode: (mode: InvoiceProductListColumnMode) => void
  onSelectRouteGroup: (routeGroupId: string) => void
  onClose: () => void
  onPrint: () => void
}) {
  const [pageIndex, setPageIndex] = useState(0)
  const [dragPrefix, setDragPrefix] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const currentPage = pages[Math.min(pageIndex, Math.max(pages.length - 1, 0))]
  const unspecified = groups.find(
    (group) => group.locationZonePrefix === UNSPECIFIED_LOCATION_ZONE,
  )
  const currentZones = useMemo(() => {
    if (!currentPage) return ''
    return [
      ...new Set(
        currentPage.segments.map((segment) =>
          segment.continued
            ? `${segment.locationZonePrefix} 계속`
            : segment.locationZonePrefix,
        ),
      ),
    ].join(' · ')
  }, [currentPage])

  useEffect(() => {
    setPageIndex(0)
  }, [columnMode, selectedRouteGroupId])

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
        className="relative z-10 flex h-[min(92vh,920px)] w-full max-w-[1280px] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div>
            <h2 className="text-base font-semibold">피킹표 미리보기 및 출력</h2>
            <p className="text-[11px] text-muted-foreground">
              {warehouseLabel} 동선과 출력 형식을 고른 뒤 실제 A4 장수를
              확인하고 출력합니다.
            </p>
          </div>
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>
            닫기
          </Button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="min-h-0 space-y-3 overflow-auto border-b border-border p-4 lg:border-b-0 lg:border-r">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline">{warehouseLabel}</Badge>
              <Badge variant="outline">{formatNumber(pages.length)}장</Badge>
              <Badge variant="outline">
                {formatNumber(layout.routeGroups.length)}카드
              </Badge>
              {shortageQuantity > 0 ? (
                <Badge variant="danger">
                  부족 {formatNumber(shortageQuantity)}개 ·{' '}
                  {formatNumber(shortageStyles)}종
                </Badge>
              ) : null}
            </div>
            <p className="text-[11px] text-muted-foreground">
              카드를 누르면 그 카드만 미리보고 출력합니다. 이 카드의 구역만
              이어서 출력하고, 다음 카드는 새 용지에서 시작합니다. 한
              카드·구역별 분해는 즉시 나눔이고, 이름 있는 동선은 그 위
              저장본입니다. 미지정은 항상 마지막입니다.
            </p>
            <InvoiceProductListRoutePresetPanel
              brandId={brandId}
              zone={layout.zone}
              groups={groups}
              layout={layout}
              onApplyLayout={(next) => {
                onChangeLayout(next)
                setPageIndex(0)
              }}
            />
            <div className="flex flex-wrap gap-1.5">
              {INVOICE_PRODUCT_LIST_ROUTE_SPLIT_MODES.map((option) => {
                const selected =
                  invoiceProductListRouteSplitMode(layout) === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      if (selected) return
                      onChangeLayout(
                        applyInvoiceProductListRouteSplitMode(
                          groups,
                          layout,
                          option.value,
                        ),
                      )
                      setPageIndex(0)
                    }}
                    className={cn(
                      'rounded-md border px-2.5 py-1 text-xs',
                      selected
                        ? 'border-primary/40 bg-primary/10 text-foreground'
                        : 'border-border text-muted-foreground hover:bg-muted/50',
                    )}
                  >
                    {option.label}
                  </button>
                )
              })}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  onChangeLayout(addInvoiceProductListRouteGroup(layout))
                }
              >
                <Plus className="size-3.5" />
                카드 추가
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  onChangeLayout(
                    buildDefaultInvoiceProductListPrintLayout(
                      groups,
                      layout.zone,
                      invoiceProductListRouteSplitMode(layout),
                    ),
                  )
                }
              >
                <RotateCcw className="size-3.5" />
                기본 순서
              </Button>
            </div>

            <div className="space-y-2">
              {layout.routeGroups.map((group, index) => (
                <section
                  key={group.id}
                  className={cn(
                    'cursor-pointer rounded-lg border border-border p-2',
                    selectedRouteGroupId === group.id
                      ? 'border-primary bg-primary/5'
                      : dragPrefix && dropTargetId === group.id
                        ? 'border-primary/60 bg-primary/5'
                        : dragPrefix
                          ? 'border-dashed'
                          : null,
                  )}
                  onClick={() => onSelectRouteGroup(group.id)}
                  onDragEnter={(event) => {
                    event.preventDefault()
                    setDropTargetId(group.id)
                  }}
                  onDragOver={(event) => {
                    event.preventDefault()
                    setDropTargetId(group.id)
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    if (!dragPrefix) return
                    onChangeLayout(
                      moveInvoiceProductListZonePrefix(
                        layout,
                        dragPrefix,
                        group.id,
                      ),
                    )
                    setDragPrefix(null)
                    setDropTargetId(null)
                    setPageIndex(0)
                  }}
                >
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-xs font-medium">
                      {group.zonePrefixes.length > 4
                        ? `${group.zonePrefixes.slice(0, 3).join('·')} 외 ${group.zonePrefixes.length - 3}`
                        : formatInvoiceProductListRouteLabel(group.zonePrefixes) ||
                          '빈 카드'}
                    </p>
                    <div className="flex items-center gap-0.5">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        disabled={index === 0}
                        onClick={() => {
                          onChangeLayout(
                            moveInvoiceProductListRouteGroup(
                              layout,
                              index,
                              index - 1,
                            ),
                          )
                          setPageIndex(0)
                        }}
                        aria-label="카드 위로"
                      >
                        <ChevronUp className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        disabled={index === layout.routeGroups.length - 1}
                        onClick={() => {
                          onChangeLayout(
                            moveInvoiceProductListRouteGroup(
                              layout,
                              index,
                              index + 1,
                            ),
                          )
                          setPageIndex(0)
                        }}
                        aria-label="카드 아래로"
                      >
                        <ChevronDown className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div
                    className={cn(
                      'flex flex-wrap gap-1',
                      group.zonePrefixes.length === 0 && 'min-h-16 items-center',
                    )}
                  >
                    {group.zonePrefixes.map((prefix) => (
                      <div
                        key={prefix}
                        draggable
                        onDragStart={() => setDragPrefix(prefix)}
                        onDragEnd={() => {
                          setDragPrefix(null)
                          setDropTargetId(null)
                        }}
                        className="inline-flex items-center gap-0.5 rounded-md border border-border bg-muted/40 px-1 py-0.5 text-[11px]"
                      >
                        <button
                          type="button"
                          className="px-0.5 text-muted-foreground hover:text-foreground"
                          onClick={() => {
                            onChangeLayout(
                              moveInvoiceProductListZoneToNeighbor(
                                layout,
                                prefix,
                                -1,
                              ),
                            )
                            setPageIndex(0)
                          }}
                          aria-label={`${prefix} 이전 카드로`}
                        >
                          ‹
                        </button>
                        <span className="cursor-grab select-none px-0.5">
                          {prefix}
                        </span>
                        <button
                          type="button"
                          className="px-0.5 text-muted-foreground hover:text-foreground"
                          onClick={() => {
                            onChangeLayout(
                              moveInvoiceProductListZoneToNeighbor(
                                layout,
                                prefix,
                                1,
                              ),
                            )
                            setPageIndex(0)
                          }}
                          aria-label={`${prefix} 다음 카드로`}
                        >
                          ›
                        </button>
                      </div>
                    ))}
                    {group.zonePrefixes.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground">
                        구역을 끌어다 넣으세요.
                      </p>
                    ) : null}
                  </div>
                </section>
              ))}

              {unspecified ? (
                <section
                  className={cn(
                    'cursor-pointer rounded-lg border p-2',
                    selectedRouteGroupId ===
                      INVOICE_PRODUCT_LIST_UNSPECIFIED_ROUTE_ID
                      ? 'border-primary bg-primary/5'
                      : 'border-warning/40 bg-warning/5',
                  )}
                  onClick={() =>
                    onSelectRouteGroup(
                      INVOICE_PRODUCT_LIST_UNSPECIFIED_ROUTE_ID,
                    )
                  }
                >
                  <p className="text-xs font-medium text-warning">
                    {UNSPECIFIED_LOCATION_ZONE}
                    <span className="ml-1 font-normal">
                      {formatNumber(unspecified.styleCount)}종 ·{' '}
                      {formatNumber(unspecified.quantity)}개 · 항상 마지막
                    </span>
                  </p>
                </section>
              ) : null}
            </div>
          </aside>

          <div className="flex min-h-0 flex-col bg-muted/30">
            <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-card px-4 py-2">
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
                      'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs',
                      selected
                        ? 'border-primary/40 bg-primary/10 text-foreground'
                        : 'border-border text-muted-foreground hover:bg-muted/50',
                    )}
                  >
                    {option.label}
                    <span className="tabular-nums">
                      {formatNumber(pageCounts[option.value])}장
                    </span>
                    {recommended ? (
                      <span className="rounded bg-primary/15 px-1 py-0.5 text-[10px] text-foreground">
                        추천
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>
            <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2">
              <Button
                type="button"
                size="icon"
                variant="outline"
                disabled={pageIndex <= 0}
                onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
                aria-label="이전 페이지"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <p className="text-xs tabular-nums">
                {pages.length === 0
                  ? '0 / 0'
                  : `${Math.min(pageIndex + 1, pages.length)} / ${pages.length}`}
              </p>
              <Button
                type="button"
                size="icon"
                variant="outline"
                disabled={pageIndex >= pages.length - 1}
                onClick={() =>
                  setPageIndex((current) =>
                    Math.min(pages.length - 1, current + 1),
                  )
                }
                aria-label="다음 페이지"
              >
                <ChevronRight className="size-4" />
              </Button>
              <p className="min-w-0 truncate text-[11px] text-muted-foreground">
                {currentPage
                  ? `이 장 ${currentZones}`
                  : '출력할 페이지가 없습니다.'}
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden p-3">
              {currentPage ? (
                <InvoiceProductListPrintPreviewSheet page={currentPage} />
              ) : (
                <p className="rounded-lg border border-border bg-card px-3 py-8 text-center text-sm text-muted-foreground">
                  자리로 나눌 상품이 없습니다.
                </p>
              )}
            </div>
            {pages.length > 1 ? (
              <div className="flex shrink-0 gap-1 overflow-x-auto border-t border-border bg-card px-4 py-2">
                {pages.map((page, index) => (
                  <button
                    key={`${page.globalPageIndex}-${page.locationZonePrefix}`}
                    type="button"
                    onClick={() => setPageIndex(index)}
                    className={cn(
                      'h-7 min-w-7 shrink-0 rounded-md border px-1.5 text-[11px] tabular-nums',
                      index === pageIndex
                        ? 'border-primary/40 bg-primary/10 text-foreground'
                        : 'border-border text-muted-foreground hover:bg-muted/50',
                    )}
                  >
                    {page.globalPageIndex}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={pages.length === 0}
            onClick={onPrint}
          >
            <Printer className="size-3.5" />
            브라우저 인쇄 열기
          </Button>
        </div>
      </div>
    </div>
    </WorkspaceTabOverlay>
  )
}
