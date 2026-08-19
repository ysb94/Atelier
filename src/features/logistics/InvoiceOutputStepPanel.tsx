import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { GiftAssignmentPlan } from '@/lib/invoice/gift-assign'
import { finalizeGiftPlanForDownload } from '@/lib/invoice/gift-confirm'
import {
  buildInvoiceOutputRows,
  downloadInvoiceOutputRows,
} from '@/lib/invoice/invoice-output'
import {
  buildOutgoingComponentRowsFromStages,
} from '@/lib/invoice/item-name-transform'
import type { InvoiceItemNameTransformation } from '@/lib/invoice/item-name-transform'
import {
  downloadOutgoingComponentRows,
} from '@/lib/invoice/option-transform'
import { planInvoicePrefixes } from '@/lib/invoice/prefix-transform'
import {
  productNameTransformationToName,
  type InvoiceProductNameTransformation,
} from '@/lib/invoice/product-name-transform'
import type { SabangnetOrderRow } from '@/lib/invoice/sabangnet'
import type { WorkInstructionPlan } from '@/lib/invoice/work-instruction-transform'
import type { InvoicePrefixRequest } from '@/lib/types'
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
}) {
  const queryClient = useQueryClient()
  const [downloading, setDownloading] = useState(false)
  const [downloadingComponents, setDownloadingComponents] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [messageIsError, setMessageIsError] = useState(false)

  const nameTransformation = useMemo(
    () => productNameTransformationToName(productTransformation),
    [productTransformation],
  )

  const previewRows = useMemo(
    () =>
      buildInvoiceOutputRows({
        transformedRows: nameTransformation.rows,
        workMatches: workPlan.matchByRowNumber,
        giftRowsBySource: giftPlan.giftsBySourceRowNumber,
        productTransformation,
        itemTransformation,
      }),
    [
      nameTransformation.rows,
      workPlan.matchByRowNumber,
      giftPlan,
      productTransformation,
      itemTransformation,
    ],
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
    if (downloading || previewRows.length === 0) return
    setDownloading(true)
    setMessage(null)
    try {
      const prefixPlan = planInvoicePrefixes(
        rows,
        giftRequests,
        giftResolutions,
      )
      const finalized = await finalizeGiftPlanForDownload({
        brandId,
        rows,
        prefixPlan,
        requests: giftRequests,
        giftPlan,
        seed: giftSeed,
        excludedGiftStyleIds,
        sourceFileName,
      })
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['invoice-gift-allocations', brandId],
        }),
        queryClient.invalidateQueries({
          queryKey: ['invoice-prefix-requests', brandId],
        }),
      ])

      const outputRows = buildInvoiceOutputRows({
        transformedRows: nameTransformation.rows,
        workMatches: workPlan.matchByRowNumber,
        giftRowsBySource: finalized.plan.giftsBySourceRowNumber,
        productTransformation,
        itemTransformation,
      })

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

  async function handleComponentDownload() {
    if (downloadingComponents) return
    setDownloadingComponents(true)
    setMessage(null)
    try {
      const componentRows = buildOutgoingComponentRowsFromStages({
        productRows: productTransformation.rows,
        itemRows: itemTransformation.rows,
        giftRowsBySource: giftPlan.giftsBySourceRowNumber,
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
          <Badge variant="muted">사은품 {formatNumber(giftCount)}</Badge>
          {productTransformation.excludedRowCount > 0 ? (
            <Badge variant="muted">
              송장 제외 {formatNumber(productTransformation.excludedRowCount)}건
            </Badge>
          ) : null}
          {reviewCount > 0 ? (
            <Badge variant="danger">
              미확정 {formatNumber(reviewCount)}행
            </Badge>
          ) : null}
          {giftPlan.newConfirmCandidates.length > 0 ? (
            <Badge variant="warning">
              확정 예정 {formatNumber(giftPlan.newConfirmCandidates.length)}
            </Badge>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={downloadingComponents || previewRows.length === 0}
            onClick={() => void handleComponentDownload()}
          >
            <Download className="size-3.5" />
            {downloadingComponents ? '준비 중...' : '출고구성 내려받기'}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={downloading || previewRows.length === 0}
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
      ) : (
        <p className="text-xs text-muted-foreground">
          품목명과 내품명은 각 단계 결과를 마지막에만 합칩니다. 세트는 구성품별
          행으로 펼치고, 변환된 내품명은 모든 구성행에 동일하게 넣습니다.
        </p>
      )}

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
                  {row.kind === 'gift' ? '-' : row.finalItemName || '(빈 값)'}
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
          미리보기는 앞의 300행만 표시합니다. 다운로드에는 전체가 들어갑니다.
        </p>
      ) : null}
    </div>
  )
}
