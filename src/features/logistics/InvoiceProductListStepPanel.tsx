import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Download, Printer } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  getActiveWarehouseInventorySet,
  getWarehouseStockPositions,
} from '@/lib/api'
import type { GiftAssignmentPlan } from '@/lib/invoice/gift-assign'
import { buildOutgoingComponentRowsFromStages } from '@/lib/invoice/item-name-transform'
import type { InvoiceItemNameTransformation } from '@/lib/invoice/item-name-transform'
import {
  buildInvoiceProductListPrintPages,
  buildInvoiceProductListPrintPagesByMode,
  invoiceProductListPrintSheetClass,
  INVOICE_PRODUCT_LIST_COLUMN_MODE_ORDER,
  INVOICE_PRODUCT_LIST_PRINT_ROWS,
  recommendInvoiceProductListColumnMode,
  resolveInvoiceProductListSelectedRouteGroupId,
  scopeInvoiceProductListPrintPages,
  type InvoiceProductListColumnMode,
} from '@/lib/invoice/product-list-print'
import type { InvoiceProductNameTransformation } from '@/lib/invoice/product-name-transform'
import {
  emptyInvoiceProductListPrintLayoutByZone,
  invoiceProductListSelectableRouteGroupIds,
  reconcileInvoiceProductListPrintLayout,
} from '@/lib/invoice/product-list-route'
import {
  ALL_INVOICE_PRODUCT_LIST_CATEGORIES,
  INVOICE_PRODUCT_LIST_CATEGORIES,
  summarizeInvoiceProductList,
  type InvoiceProductListCategory,
} from '@/lib/invoice/product-list-summary'
import { downloadInvoiceProductListBackup } from '@/lib/invoice/product-list-export'
import {
  allocateInvoiceProductListWarehouse,
  INVOICE_PRODUCT_LIST_WAREHOUSE_MODES,
} from '@/lib/invoice/product-list-warehouse'
import type { WorkInstructionPlan } from '@/lib/invoice/work-instruction-transform'
import type { WarehouseZone } from '@/lib/types'
import { cn, formatNumber } from '@/lib/utils'
import { InvoiceProductListPrint } from './InvoiceProductListPrint'
import { InvoiceProductListPrintPreviewDialog } from './InvoiceProductListPrintPreviewDialog'

const PRINT_PAGE_STYLE_ID = 'invoice-product-list-print-page-style'

function applyInvoiceProductListPrintMode(mode: InvoiceProductListColumnMode) {
  const html = document.documentElement
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

function clearInvoiceProductListPrintMode() {
  document.documentElement.classList.remove(
    'printing-invoice-product-list',
    ...INVOICE_PRODUCT_LIST_COLUMN_MODE_ORDER.map((mode) =>
      invoiceProductListPrintSheetClass(mode),
    ),
  )
  document.getElementById(PRINT_PAGE_STYLE_ID)?.remove()
}

export function InvoiceProductListStepPanel({
  brandId,
  productTransformation,
  itemTransformation,
  workPlan,
  giftPlan,
}: {
  brandId: string
  productTransformation: InvoiceProductNameTransformation
  itemTransformation: InvoiceItemNameTransformation
  workPlan: WorkInstructionPlan
  giftPlan: GiftAssignmentPlan
}) {
  const [selected, setSelected] = useState<Set<InvoiceProductListCategory>>(
    () => new Set(ALL_INVOICE_PRODUCT_LIST_CATEGORIES),
  )
  const [zone, setZone] = useState<WarehouseZone>('picking')
  const [locationTab, setLocationTab] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [layoutsByZone, setLayoutsByZone] = useState(
    emptyInvoiceProductListPrintLayoutByZone,
  )
  const [columnModesByZone, setColumnModesByZone] = useState<
    Record<'picking' | 'box_storage', InvoiceProductListColumnMode>
  >({
    picking: 'vertical_1',
    box_storage: 'vertical_1',
  })
  const [selectedRouteGroupId, setSelectedRouteGroupId] = useState<
    string | null
  >(null)
  const [backupPending, setBackupPending] = useState(false)
  const [backupError, setBackupError] = useState<string | null>(null)

  const outgoingRows = useMemo(
    () =>
      buildOutgoingComponentRowsFromStages({
        productRows: productTransformation.rows,
        itemRows: itemTransformation.rows,
        giftRowsBySource: giftPlan.giftsBySourceRowNumber,
        giftAssignments: giftPlan.shipments.flatMap((item) => item.assignments),
        packingMaterials: workPlan.materialTotals,
      }),
    [giftPlan, itemTransformation.rows, productTransformation.rows, workPlan],
  )

  const summary = useMemo(
    () => summarizeInvoiceProductList(outgoingRows, selected),
    [outgoingRows, selected],
  )

  const setQuery = useQuery({
    queryKey: ['warehouse-inventory-set', brandId],
    queryFn: () => getActiveWarehouseInventorySet(brandId),
  })
  const activeSet = setQuery.data ?? null
  const positionsQuery = useQuery({
    queryKey: ['warehouse-stock-positions', brandId, activeSet?.id],
    queryFn: () => getWarehouseStockPositions(brandId, activeSet!.id),
    enabled: Boolean(activeSet?.id),
  })

  const allocation = useMemo(
    () =>
      allocateInvoiceProductListWarehouse({
        entries: summary.entries,
        positions: positionsQuery.data ?? [],
        zone,
      }),
    [positionsQuery.data, summary.entries, zone],
  )

  useEffect(() => {
    const prefixes = allocation.groups.map((group) => group.locationZonePrefix)
    setLocationTab((current) =>
      current && prefixes.includes(current) ? current : (prefixes[0] ?? null),
    )
    setLayoutsByZone((current) => ({
      ...current,
      [zone]: reconcileInvoiceProductListPrintLayout(
        allocation.groups,
        current[zone],
      ),
    }))
  }, [allocation.groups, zone])

  useEffect(() => {
    setSelectedRouteGroupId(null)
  }, [zone])

  const activeGroup =
    allocation.groups.find(
      (group) => group.locationZonePrefix === locationTab,
    ) ?? allocation.groups[0]
  const warehouseLabel =
    INVOICE_PRODUCT_LIST_WAREHOUSE_MODES.find((item) => item.value === zone)
      ?.label ?? '출고창고용'
  const printLayout = layoutsByZone[zone]
  const columnMode = columnModesByZone[zone]
  const pagesByMode = useMemo(
    () =>
      buildInvoiceProductListPrintPagesByMode({
        groups: allocation.groups,
        warehouseLabel,
        layout: printLayout,
        autoFit: true,
      }),
    [allocation.groups, printLayout, warehouseLabel],
  )
  const availableRouteGroupIds = useMemo(
    () =>
      invoiceProductListSelectableRouteGroupIds(
        printLayout,
        allocation.groups,
      ),
    [allocation.groups, printLayout],
  )
  const activeRouteGroupId = useMemo(
    () =>
      resolveInvoiceProductListSelectedRouteGroupId({
        preferredId: selectedRouteGroupId,
        availableIds: availableRouteGroupIds,
        pages: pagesByMode[columnMode],
      }),
    [
      availableRouteGroupIds,
      columnMode,
      pagesByMode,
      selectedRouteGroupId,
    ],
  )
  const printPageCounts = useMemo(
    () => ({
      vertical_1: scopeInvoiceProductListPrintPages(
        pagesByMode.vertical_1,
        activeRouteGroupId,
      ).length,
      vertical_2: scopeInvoiceProductListPrintPages(
        pagesByMode.vertical_2,
        activeRouteGroupId,
      ).length,
      horizontal_3: scopeInvoiceProductListPrintPages(
        pagesByMode.horizontal_3,
        activeRouteGroupId,
      ).length,
    }),
    [activeRouteGroupId, pagesByMode],
  )
  const recommendedMode = useMemo(
    () => recommendInvoiceProductListColumnMode(printPageCounts),
    [printPageCounts],
  )
  const printPages = useMemo(
    () =>
      scopeInvoiceProductListPrintPages(
        pagesByMode[columnMode],
        activeRouteGroupId,
      ),
    [activeRouteGroupId, columnMode, pagesByMode],
  )
  const screenPages = useMemo(
    () =>
      activeGroup
        ? buildInvoiceProductListPrintPages({
            groups: [activeGroup],
            warehouseLabel,
          })
        : [],
    [activeGroup, warehouseLabel],
  )

  const warehouseError =
    setQuery.error instanceof Error
      ? setQuery.error.message
      : positionsQuery.error instanceof Error
        ? positionsQuery.error.message
        : setQuery.error || positionsQuery.error
          ? '연습 창고 데이터를 불러오지 못했습니다.'
          : null
  const warehousePending =
    setQuery.isPending || (Boolean(activeSet?.id) && positionsQuery.isPending)
  const zoneHasStock = (positionsQuery.data ?? []).some(
    (position) => position.zone === zone,
  )

  function toggleCategory(category: InvoiceProductListCategory) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
  }

  async function handleDownloadBackup() {
    if (summary.entries.length === 0 || backupPending) return
    setBackupPending(true)
    setBackupError(null)
    try {
      await downloadInvoiceProductListBackup(summary.entries)
    } catch (error) {
      setBackupError(
        error instanceof Error
          ? error.message
          : '선택 상품 리스트를 내려받지 못했습니다.',
      )
    } finally {
      setBackupPending(false)
    }
  }

  useEffect(() => {
    const beforePrint = () => {
      if (printPages.length === 0) return
      applyInvoiceProductListPrintMode(columnMode)
    }
    const afterPrint = () => {
      clearInvoiceProductListPrintMode()
    }
    window.addEventListener('beforeprint', beforePrint)
    window.addEventListener('afterprint', afterPrint)
    return () => {
      window.removeEventListener('beforeprint', beforePrint)
      window.removeEventListener('afterprint', afterPrint)
      afterPrint()
    }
  }, [columnMode, printPages.length])

  function handlePrint() {
    if (printPages.length === 0) return
    applyInvoiceProductListPrintMode(columnMode)
    window.requestAnimationFrame(() => window.print())
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {INVOICE_PRODUCT_LIST_CATEGORIES.map((item) => {
          const total = summary.categoryTotals[item.value]
          const checked = selected.has(item.value)
          return (
            <label
              key={item.value}
              className={cn(
                'inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs',
                checked
                  ? 'border-primary/40 bg-primary/10 text-foreground'
                  : 'border-border text-muted-foreground',
              )}
            >
              <input
                type="checkbox"
                className="size-3.5 accent-primary"
                checked={checked}
                onChange={() => toggleCategory(item.value)}
              />
              {item.label}
              <span className="tabular-nums text-muted-foreground">
                {formatNumber(total.styleCount)}종 ·{' '}
                {formatNumber(total.quantity)}개
              </span>
            </label>
          )
        })}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="ml-auto"
          disabled={summary.entries.length === 0 || backupPending}
          onClick={() => void handleDownloadBackup()}
        >
          <Download className="size-3.5" />
          {backupPending ? '내려받는 중…' : '선택 목록 백업'}
        </Button>
      </div>
      {backupError ? (
        <p className="text-xs text-danger">{backupError}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {INVOICE_PRODUCT_LIST_WAREHOUSE_MODES.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={zone === item.value}
            onClick={() => setZone(item.value)}
            className={cn(
              'rounded-full border px-2.5 py-1 text-xs',
              zone === item.value
                ? 'border-primary/40 bg-primary/10 text-foreground'
                : 'border-border text-muted-foreground hover:bg-muted/50',
            )}
          >
            {item.label}
          </button>
        ))}
        <Badge variant="warning">연습 데이터</Badge>
        <Badge variant="outline">
          {formatNumber(summary.selectedStyleCount)}종
        </Badge>
        <Badge variant="success">
          총 {formatNumber(summary.selectedQuantity)}개
        </Badge>
        {allocation.totalShortage > 0 ? (
          <Badge variant="danger">
            부족 {formatNumber(allocation.totalShortage)}개 ·{' '}
            {formatNumber(allocation.stylesWithShortage)}종
          </Badge>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="ml-auto"
          disabled={warehousePending || summary.entries.length === 0}
          onClick={() => setPreviewOpen(true)}
        >
          <Printer className="size-3.5" />
          미리보기 및 출력
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground">
        선택한 종류만 현재 창고 자리의 사용 순서대로 나눕니다. 화면 확인만 하며
        재고를 차감하거나 예약하지 않습니다.
      </p>

      {summary.unresolved.rowCount > 0 ? (
        <p className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning">
          <span className="inline-flex items-center gap-1.5">
            <AlertTriangle className="size-3.5 shrink-0" />
            M번호가 확정되지 않은 {formatNumber(summary.unresolved.rowCount)}행
            (수량 {formatNumber(summary.unresolved.quantity)})은 목록에서
            뺐습니다.
          </span>
        </p>
      ) : null}

      {warehouseError ? (
        <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {warehouseError}
        </p>
      ) : null}

      {!warehousePending && !activeSet ? (
        <p className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning">
          활성 연습 창고 세트가 없습니다. 자리번호 없이 상품 수량만 확인할 수
          있습니다. 창고 관리에서 엑셀을 올리세요.
        </p>
      ) : null}

      {!warehousePending && activeSet && !zoneHasStock ? (
        <p className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning">
          {warehouseLabel} 자리가 없습니다. 해당 존 재고가 없어 필요 수량은
          미지정으로 남깁니다.
        </p>
      ) : null}

      {allocation.totalShortage > 0 ? (
        <p className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning">
          {warehouseLabel} 재고가 부족한 {formatNumber(allocation.stylesWithShortage)}종
          (수량 {formatNumber(allocation.totalShortage)})은 미지정으로 남겼습니다.
        </p>
      ) : null}

      {warehousePending ? (
        <p className="rounded-lg border border-border bg-muted/20 px-3 py-8 text-center text-sm text-muted-foreground">
          연습 창고 자리를 불러오는 중…
        </p>
      ) : summary.entries.length === 0 ? (
        <p className="rounded-lg border border-border bg-muted/20 px-3 py-8 text-center text-sm text-muted-foreground">
          {selected.size === 0
            ? '포함할 목록을 선택하세요.'
            : '선택한 목록에 확정된 상품이 없습니다.'}
        </p>
      ) : allocation.groups.length === 0 ? (
        <p className="rounded-lg border border-border bg-muted/20 px-3 py-8 text-center text-sm text-muted-foreground">
          자리로 나눌 상품이 없습니다.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            {allocation.groups.map((group) => (
              <button
                key={group.locationZonePrefix}
                type="button"
                onClick={() => setLocationTab(group.locationZonePrefix)}
                className={cn(
                  'rounded-md border px-2.5 py-1 text-xs',
                  activeGroup?.locationZonePrefix === group.locationZonePrefix
                    ? 'border-primary/40 bg-primary/10 text-foreground'
                    : 'border-border text-muted-foreground hover:bg-muted/50',
                )}
              >
                <span className="font-semibold">
                  {group.locationZonePrefix}
                </span>
                <span className="ml-1 text-[10px] tabular-nums text-muted-foreground">
                  {formatNumber(group.quantity)}개
                </span>
              </button>
            ))}
          </div>

          <div className="max-h-[70vh] overflow-auto rounded-lg border border-border">
            {screenPages.map((page) => (
              <div
                key={`${page.locationZonePrefix}-${page.pageInSection}`}
                className="border-b border-border last:border-b-0"
              >
                {screenPages.length > 1 ? (
                  <p className="bg-muted/50 px-3 py-1.5 text-[11px] text-muted-foreground">
                    {page.locationZonePrefix}구역 {page.pageInSection}/
                    {page.pageCountInSection} · A4 {INVOICE_PRODUCT_LIST_PRINT_ROWS}행
                  </p>
                ) : null}
                <table className="w-full min-w-[640px] border-collapse text-xs">
                  <thead className="sticky top-0 z-10 bg-muted/90">
                    <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                      <th className="border-b border-border px-3 py-2">M번호</th>
                      <th className="border-b border-border px-3 py-2">
                        자리번호
                      </th>
                      <th className="border-b border-border px-3 py-2">
                        공식 상품명
                      </th>
                      <th className="border-b border-border px-3 py-2 text-right">
                        수량
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {page.slots
                      .filter((slot) => slot.kind === 'item')
                      .map((slot) => (
                        <tr
                          key={`${slot.line.styleNo}-${slot.line.locationLabel}-${slot.line.isShortage}`}
                          className={cn(
                            'border-b border-border/70',
                            slot.line.isShortage && 'text-warning',
                          )}
                        >
                          <td className="px-3 py-1.5 font-medium tabular-nums">
                            {slot.line.styleNo}
                          </td>
                          <td className="px-3 py-1.5">
                            {slot.line.isShortage
                              ? `${slot.line.locationLabel}(재고 부족)`
                              : slot.line.locationLabel}
                          </td>
                          <td className="px-3 py-1.5">{slot.line.styleName}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">
                            {formatNumber(slot.line.quantity)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </>
      )}

      <InvoiceProductListPrint pages={printPages} />
      {previewOpen ? (
        <InvoiceProductListPrintPreviewDialog
          brandId={brandId}
          warehouseLabel={warehouseLabel}
          groups={allocation.groups}
          layout={printLayout}
          pages={printPages}
          columnMode={columnMode}
          pageCounts={printPageCounts}
          recommendedMode={recommendedMode}
          selectedRouteGroupId={activeRouteGroupId}
          shortageQuantity={allocation.totalShortage}
          shortageStyles={allocation.stylesWithShortage}
          onChangeLayout={(next) =>
            setLayoutsByZone((current) => ({ ...current, [zone]: next }))
          }
          onChangeColumnMode={(next) =>
            setColumnModesByZone((current) => ({ ...current, [zone]: next }))
          }
          onSelectRouteGroup={(next) => setSelectedRouteGroupId(next)}
          onClose={() => setPreviewOpen(false)}
          onPrint={handlePrint}
        />
      ) : null}
    </div>
  )
}
