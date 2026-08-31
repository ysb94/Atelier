import { useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  getActiveWarehouseInventorySet,
  getBrandFields,
  getInvoicePackingSizeMaps,
  getStylesByBrand,
  getWarehouseStockPositions,
  recordInvoiceWorkCompletion,
} from '@/lib/api'
import type { GiftAssignmentPlan } from '@/lib/invoice/gift-assign'
import {
  finalizeGiftPlanForDownload,
  type FinalizeUnifiedGiftPlanResult,
} from '@/lib/invoice/gift-confirm'
import type { GiftSourcePlan } from '@/lib/invoice/gift-source-transform'
import {
  countUniqueInvoiceOrders,
  fingerprintInvoiceWorkRows,
  summarizeInvoiceWorkSites,
  type InvoiceMallResolution,
} from '@/lib/invoice/mall-resolution'
import {
  applyInvoiceShipmentProductLabels,
  buildInvoiceOutputRows,
  downloadInvoiceOutputRows,
  type InvoiceOutputRow,
} from '@/lib/invoice/invoice-output'
import {
  buildOutgoingComponentRowsFromStages,
} from '@/lib/invoice/item-name-transform'
import type { InvoiceItemNameTransformation } from '@/lib/invoice/item-name-transform'
import {
  downloadOutgoingComponentRows,
} from '@/lib/invoice/option-transform'
import {
  normalizePackingSizeValue,
  PACKING_SIZE_SOURCE_FIELD_LABEL,
} from '@/lib/invoice/packing-size-map'
import { planInvoicePrefixes } from '@/lib/invoice/prefix-transform'
import {
  overlayGiftSourceOnProductNames,
  productNameTransformationToName,
  type InvoiceProductNameTransformation,
} from '@/lib/invoice/product-name-transform'
import type { SabangnetOrderRow } from '@/lib/invoice/sabangnet'
import {
  buildInvoiceShipmentLocationByStyleNo,
  buildInvoiceShipmentPackingCodeByStyleNo,
  DEFAULT_INVOICE_SHIPMENT_LOCATION_ZONE,
  INVOICE_SHIPMENT_LOCATION_ZONE_MODES,
} from '@/lib/invoice/shipment-product-label'
import type { WorkInstructionPlan } from '@/lib/invoice/work-instruction-transform'
import type { InvoicePrefixRequest, WarehouseZone } from '@/lib/types'
import { cn, formatNumber } from '@/lib/utils'

export function InvoiceOutputStepPanel({
  brandId,
  brandName,
  sourceFileName,
  rows,
  giftRequests,
  giftResolutions,
  giftSeed,
  excludedGiftStyleIds,
  productTransformation,
  itemTransformation,
  workPlan,
  giftPlan,
  giftSourcePlan,
  baseProductTransformation,
  mallResolution,
  finalizeUnified,
  previewRows: previewRowsProp,
}: {
  brandId: string
  brandName: string
  sourceFileName?: string
  rows: SabangnetOrderRow[]
  giftRequests: InvoicePrefixRequest[]
  giftResolutions: Record<string, string>
  giftSeed: number
  excludedGiftStyleIds: string[]
  productTransformation: InvoiceProductNameTransformation
  itemTransformation: InvoiceItemNameTransformation
  workPlan: WorkInstructionPlan
  giftPlan: GiftAssignmentPlan
  giftSourcePlan?: GiftSourcePlan
  baseProductTransformation?: InvoiceProductNameTransformation
  mallResolution: InvoiceMallResolution
  finalizeUnified?: () => Promise<FinalizeUnifiedGiftPlanResult>
  previewRows?: InvoiceOutputRow[]
}) {
  const queryClient = useQueryClient()
  const [locationZone, setLocationZone] = useState<WarehouseZone>(
    DEFAULT_INVOICE_SHIPMENT_LOCATION_ZONE,
  )
  const [downloading, setDownloading] = useState(false)
  const [downloadingComponents, setDownloadingComponents] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [messageIsError, setMessageIsError] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [historySaving, setHistorySaving] = useState(false)
  const lastHistoryRef = useRef<{
    fileFingerprint: string
    sourceFileName: string
    sourceRowCount: number
    sourceOrderCount: number
    exportedRowCount: number
    reviewRowCount: number
    sites: ReturnType<typeof summarizeInvoiceWorkSites>
  } | null>(null)

  const fieldsQuery = useQuery({
    queryKey: ['brand-fields', brandId],
    queryFn: () => getBrandFields(brandId),
  })
  const packingField = useMemo(() => {
    const target = normalizePackingSizeValue(PACKING_SIZE_SOURCE_FIELD_LABEL)
    return (
      fieldsQuery.data?.find(
        (item) => normalizePackingSizeValue(item.label) === target,
      ) ?? null
    )
  }, [fieldsQuery.data])
  const packingMapsQuery = useQuery({
    queryKey: ['invoice-packing-size-maps', brandId, packingField?.id ?? ''],
    queryFn: () => getInvoicePackingSizeMaps(brandId, packingField!.id),
    enabled: Boolean(packingField?.id),
  })
  const stylesQuery = useQuery({
    queryKey: ['styles', brandId],
    queryFn: () => getStylesByBrand(brandId),
  })
  const warehouseSetQuery = useQuery({
    queryKey: ['warehouse-inventory-set', brandId],
    queryFn: () => getActiveWarehouseInventorySet(brandId),
  })
  const warehousePositionsQuery = useQuery({
    queryKey: [
      'warehouse-stock-positions',
      brandId,
      warehouseSetQuery.data?.id,
    ],
    queryFn: () =>
      getWarehouseStockPositions(brandId, warehouseSetQuery.data!.id),
    enabled: Boolean(warehouseSetQuery.data?.id),
  })

  const shipmentLookups = useMemo(
    () => ({
      locationByStyleNo: buildInvoiceShipmentLocationByStyleNo(
        warehousePositionsQuery.data ?? [],
        locationZone,
      ),
      packingCodeByStyleNo: buildInvoiceShipmentPackingCodeByStyleNo({
        styles: stylesQuery.data ?? [],
        field: packingField,
        maps: packingMapsQuery.data ?? [],
      }),
    }),
    [
      locationZone,
      packingField,
      packingMapsQuery.data,
      stylesQuery.data,
      warehousePositionsQuery.data,
    ],
  )

  const shipmentLabelsPending =
    stylesQuery.isPending ||
    fieldsQuery.isPending ||
    (Boolean(packingField?.id) && packingMapsQuery.isPending) ||
    warehouseSetQuery.isPending ||
    (Boolean(warehouseSetQuery.data?.id) &&
      warehousePositionsQuery.isPending)

  const nameTransformation = useMemo(
    () => productNameTransformationToName(productTransformation),
    [productTransformation],
  )

  const basePreviewRows = useMemo(
    () =>
      previewRowsProp ??
      buildInvoiceOutputRows({
        transformedRows: nameTransformation.rows,
        workMatches: workPlan.matchByRowNumber,
        giftRowsBySource: giftPlan.giftsBySourceRowNumber,
        giftAssignments: giftPlan.shipments.flatMap(
          (item) => item.assignments,
        ),
        productTransformation,
        itemTransformation,
      }),
    [
      giftPlan,
      itemTransformation,
      nameTransformation.rows,
      previewRowsProp,
      productTransformation,
      workPlan.matchByRowNumber,
    ],
  )

  const previewRows = useMemo(
    () => applyInvoiceShipmentProductLabels(basePreviewRows, shipmentLookups),
    [basePreviewRows, shipmentLookups],
  )

  const orderCount = previewRows.filter((row) => row.kind === 'order').length
  const sourceOrderCount = new Set(
    previewRows
      .filter((row) => row.kind === 'order')
      .map((row) => row.sourceRowNumber),
  ).size
  const giftCount = previewRows.filter((row) => row.kind === 'gift').length
  const reviewCount =
    productTransformation.unresolvedRowCount +
    productTransformation.conflictRowCount +
    productTransformation.missingStyleRowCount +
    productTransformation.exclusionGuardedRowCount +
    itemTransformation.unresolvedRowCount +
    itemTransformation.conflictRowCount

  async function handleDownload() {
    if (downloading || previewRows.length === 0 || shipmentLabelsPending) return
    setDownloading(true)
    setMessage(null)
    try {
      const prefixPlan = planInvoicePrefixes(
        rows,
        giftRequests,
        giftResolutions,
      )
      const finalized = finalizeUnified
        ? await finalizeUnified()
        : {
            ...(await finalizeGiftPlanForDownload({
              brandId,
              rows,
              prefixPlan,
              requests: giftRequests,
              giftPlan,
              seed: giftSeed,
              excludedGiftStyleIds,
              sourceFileName,
            })),
            giftSourcePlan: giftSourcePlan ?? null,
          }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['invoice-gift-allocations', brandId],
        }),
        queryClient.invalidateQueries({
          queryKey: ['invoice-prefix-requests', brandId],
        }),
        queryClient.invalidateQueries({
          queryKey: ['invoice-gift-source-allocations', brandId],
        }),
      ])

      const finalizedSourcePlan = finalized.giftSourcePlan
      const finalizedProduct =
        baseProductTransformation && finalizedSourcePlan
          ? overlayGiftSourceOnProductNames(
              baseProductTransformation,
              finalizedSourcePlan,
            )
          : productTransformation
      const finalizedName = productNameTransformationToName(finalizedProduct)

      const outputRows = applyInvoiceShipmentProductLabels(
        buildInvoiceOutputRows({
          transformedRows: finalizedName.rows,
          workMatches: workPlan.matchByRowNumber,
          giftRowsBySource: finalized.plan.giftsBySourceRowNumber,
          giftAssignments: finalized.plan.shipments.flatMap(
            (item) => item.assignments,
          ),
          productTransformation: finalizedProduct,
          itemTransformation,
        }),
        shipmentLookups,
      )

      await downloadInvoiceOutputRows({
        brandName,
        sourceFileName,
        rows: outputRows,
      })
      setMessageIsError(false)
      setMessage(
        finalized.skippedCount > 0
          ? `${formatNumber(outputRows.length)}행을 내려받았습니다. 한도 경합으로 ${formatNumber(finalized.skippedCount)}건은 제외됐습니다.`
          : `${formatNumber(outputRows.length)}행을 내려받았습니다.`,
      )

      const historyInput = {
        fileFingerprint: await fingerprintInvoiceWorkRows(rows),
        sourceFileName: sourceFileName ?? '',
        sourceRowCount: rows.length,
        sourceOrderCount: countUniqueInvoiceOrders(rows),
        exportedRowCount: outputRows.length,
        reviewRowCount: reviewCount,
        sites: summarizeInvoiceWorkSites({
          sourceRows: rows,
          outputRows,
          resolution: mallResolution,
        }),
      }
      lastHistoryRef.current = historyInput
      await saveWorkHistory(historyInput)
    } catch (error) {
      setMessageIsError(true)
      setMessage(
        error instanceof Error
          ? error.message
          : '엑셀을 내려받지 못했습니다.',
      )
    } finally {
      setDownloading(false)
    }
  }

  async function saveWorkHistory(
    input: NonNullable<typeof lastHistoryRef.current>,
  ) {
    setHistorySaving(true)
    setHistoryError(null)
    try {
      await recordInvoiceWorkCompletion({
        brandId,
        ...input,
      })
      await queryClient.invalidateQueries({
        queryKey: ['invoiceWorkRuns', brandId],
      })
    } catch (error) {
      setHistoryError(
        error instanceof Error
          ? error.message
          : '작업 이력을 저장하지 못했습니다.',
      )
    } finally {
      setHistorySaving(false)
    }
  }

  async function handleComponentDownload() {
    if (downloadingComponents) return
    setDownloadingComponents(true)
    setMessage(null)
    try {
      const componentRows = buildOutgoingComponentRowsFromStages({
        productRows: productTransformation.rows,
        itemRows: itemTransformation.rows,
        giftRowsBySource: giftPlan.giftsBySourceRowNumber,
        giftAssignments: giftPlan.shipments.flatMap((item) => item.assignments),
        packingMaterials: workPlan.materialTotals,
      })
      await downloadOutgoingComponentRows({
        brandName,
        sourceFileName,
        rows: componentRows,
      })
      setMessageIsError(false)
      setMessage(
        `출고구성 ${formatNumber(componentRows.length)}행을 내려받았습니다.`,
      )
    } catch (error) {
      setMessageIsError(true)
      setMessage(
        error instanceof Error
          ? error.message
          : '출고구성 엑셀을 내려받지 못했습니다.',
      )
    } finally {
      setDownloadingComponents(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">전체 {formatNumber(previewRows.length)}행</Badge>
          <Badge variant="success">송장 {formatNumber(orderCount)}행</Badge>
          {sourceOrderCount !== orderCount ? (
            <Badge variant="outline">
              원본 {formatNumber(sourceOrderCount)}건
            </Badge>
          ) : null}
          <Badge variant="muted">사은품 {formatNumber(giftCount)}행</Badge>
          {productTransformation.excludedRowCount > 0 ? (
            <Badge variant="muted">
              상품 연결 예외 {formatNumber(productTransformation.excludedRowCount)}건
            </Badge>
          ) : null}
          {reviewCount > 0 ? (
            <Badge variant="danger">
              미확정 {formatNumber(reviewCount)}행
            </Badge>
          ) : null}
          {giftPlan.newConfirmCandidates.length > 0 ? (
            <Badge variant="warning">
              확정 예정 {formatNumber(giftPlan.newConfirmCandidates.length)}건
            </Badge>
          ) : null}
          <div className="flex flex-wrap items-center gap-1">
            {INVOICE_SHIPMENT_LOCATION_ZONE_MODES.map((item) => (
              <button
                key={item.value}
                type="button"
                aria-pressed={locationZone === item.value}
                onClick={() => setLocationZone(item.value)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-xs',
                  locationZone === item.value
                    ? 'border-primary/40 bg-primary/10 text-foreground'
                    : 'border-border text-muted-foreground hover:bg-muted/50',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={
              downloadingComponents ||
              previewRows.length === 0 ||
              shipmentLabelsPending
            }
            onClick={() => void handleComponentDownload()}
          >
            <Download className="size-3.5" />
            {downloadingComponents ? '준비 중...' : '출고구성 내려받기'}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={
              downloading || previewRows.length === 0 || shipmentLabelsPending
            }
            onClick={() => void handleDownload()}
          >
            <Download className="size-3.5" />
            {downloading ? '준비 중...' : 'CJ 13열 다운로드'}
          </Button>
        </div>
      </div>

      {message ? (
        <p
          className={cn(
            'text-xs',
            messageIsError ? 'text-danger' : 'text-success',
          )}
        >
          {message}
        </p>
      ) : null}

      {historyError ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2">
          <p className="text-xs text-warning">
            파일 다운로드 완료 / 이력 저장 실패 · {historyError}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={historySaving || !lastHistoryRef.current}
            onClick={() => {
              const pending = lastHistoryRef.current
              if (pending) void saveWorkHistory(pending)
            }}
          >
            {historySaving ? '다시 저장 중...' : '이력 다시 저장'}
          </Button>
        </div>
      ) : null}

      {giftPlan.unavoidableDuplicateCount > 0 ? (
        <p className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning">
          같은 받는분에 같은 M번호가 {formatNumber(giftPlan.unavoidableDuplicateCount)}건
          반복됩니다. 고정 사은품이거나 후보가 부족해서이며, 다운로드는 막지
          않습니다.
        </p>
      ) : null}

      {giftPlan.sharedQuotaPreviews.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-180 text-left text-xs">
            <thead className="bg-muted/60">
              <tr>
                <th className="px-3 py-2.5 font-medium">요청 건</th>
                <th className="px-3 py-2.5 font-medium">한도 방식</th>
                <th className="px-3 py-2.5 font-medium">기존 확정</th>
                <th className="px-3 py-2.5 font-medium">이번 예정</th>
                <th className="px-3 py-2.5 font-medium">잔여</th>
                <th className="px-3 py-2.5 font-medium">한도</th>
              </tr>
            </thead>
            <tbody>
              {giftPlan.sharedQuotaPreviews.map((quota) => (
                <tr key={quota.requestId} className="border-t border-border">
                  <td className="px-3 py-2">{quota.requestTitle}</td>
                  <td className="px-3 py-2">전체 사은품 합계</td>
                  <td className="px-3 py-2 tabular-nums">
                    {formatNumber(quota.usedCount)}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {formatNumber(quota.plannedCount)}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {formatNumber(quota.remainingCount)}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {formatNumber(quota.quantityLimit)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {giftPlan.quotaPreviews.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-180 text-left text-xs">
            <thead className="bg-muted/60">
              <tr>
                <th className="px-3 py-2.5 font-medium">M번호</th>
                <th className="px-3 py-2.5 font-medium">기존 확정</th>
                <th className="px-3 py-2.5 font-medium">이번 예정</th>
                <th className="px-3 py-2.5 font-medium">잔여</th>
                <th className="px-3 py-2.5 font-medium">한도</th>
              </tr>
            </thead>
            <tbody>
              {giftPlan.quotaPreviews.map((quota) => (
                <tr
                  key={`${quota.requestId}-${quota.styleId}`}
                  className="border-t border-border"
                >
                  <td className="px-3 py-2 font-mono">
                    {quota.styleNo}
                    <span className="ml-2 text-muted-foreground">
                      {quota.styleName}
                    </span>
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {formatNumber(quota.usedCount)}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {formatNumber(quota.plannedCount)}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {formatNumber(quota.remainingCount)}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {formatNumber(quota.quantityLimit)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {shipmentLabelsPending ? (
        <div className="rounded-lg border border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
          창고 자리·포장 코드를 붙여 최종 품목명을 준비하고 있습니다.
        </div>
      ) : (
        <>
          <div className="max-h-[36rem] overflow-auto rounded-lg border border-border">
            <table className="w-full min-w-[980px] text-left text-xs">
              <thead className="sticky top-0 bg-muted/80">
                <tr>
                  <th className="px-3 py-2.5 font-medium">구분</th>
                  <th className="px-3 py-2.5 font-medium">품목명</th>
                  <th className="px-3 py-2.5 font-medium">내품명</th>
                  <th className="px-3 py-2.5 font-medium">수량</th>
                  <th className="px-3 py-2.5 font-medium">받는분</th>
                  <th className="px-3 py-2.5 font-medium">쇼핑몰명</th>
                  <th className="px-3 py-2.5 font-medium">주문일시</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.slice(0, 300).map((row) => (
                  <tr
                    key={`${row.kind}-${row.rowNumber}-${row.sourceRowNumber}`}
                    className={cn(
                      'border-t border-border',
                      row.kind === 'gift' && 'bg-primary/5',
                    )}
                  >
                    <td className="px-3 py-2">
                      <Badge
                        variant={row.kind === 'gift' ? 'warning' : 'outline'}
                      >
                        {row.kind === 'gift' ? '사은품' : '주문'}
                      </Badge>
                    </td>
                    <td className="max-w-64 truncate px-3 py-2 font-medium">
                      {row.finalProductName}
                    </td>
                    <td className="max-w-72 truncate px-3 py-2 text-muted-foreground">
                      {row.kind === 'gift'
                        ? '-'
                        : row.finalItemName || '(빈 값)'}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{row.quantity}</td>
                    <td className="px-3 py-2">{row.recipientName || '-'}</td>
                    <td className="px-3 py-2">{row.mallName || '-'}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {row.orderedAt || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {previewRows.length > 300 ? (
            <p className="text-xs text-muted-foreground">
              미리보기는 앞의 300행만 표시합니다. 다운로드에는 전체가
              들어갑니다.
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}
