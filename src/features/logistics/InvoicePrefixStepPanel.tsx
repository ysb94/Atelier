import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Gift,
  RefreshCw,
  Search,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import {
  buildPrefixReview,
  downloadGiftRows,
  planGiftAssignments,
  type GiftAssignmentPlan,
  type PrefixReviewRequest,
} from '@/lib/invoice/gift-assign'
import { finalizeGiftPlanForDownload } from '@/lib/invoice/gift-confirm'
import {
  invoicePrefixRequestStatus,
  normalizeInvoiceText,
  nowMoment,
  orderMomentOf,
  planInvoicePrefixes,
} from '@/lib/invoice/prefix-transform'
import type { SabangnetOrderRow } from '@/lib/invoice/sabangnet'
import {
  INVOICE_PREFIX_COUNT_BASIS_LABEL,
  INVOICE_PREFIX_REQUEST_STATUS_LABEL,
  type InvoiceGiftAllocation,
  type InvoicePrefixRequest,
} from '@/lib/types'
import { cn, formatNumber } from '@/lib/utils'

const CANDIDATE_LIMIT = 200

type GiftReviewTab = 'results' | 'warehouse' | 'quota' | 'check'

function candidateKey(mallName: string, productName: string) {
  return `${normalizeInvoiceText(mallName)}\u0000${normalizeInvoiceText(productName)}`
}

/**
 * 자체품번코드 변환 전에 실행하는 사은품 추가 단계.
 * 원본 품목명이 남아 있는 지금만 쇼핑몰명 + 품목명 완전 일치를 찾을 수 있다.
 * 사은품은 별도 행의 품목명으로만 만들고, 내품명에는 넣지 않는다.
 */
export function InvoicePrefixStepPanel({
  brandId,
  rows,
  requests,
  existingAllocations,
  loading,
  error,
  resolutions,
  onResolve,
  giftSeed,
  excludedGiftStyleIds,
  onRedrawGifts,
  onToggleExcludeGift,
  sourceFileName,
  prefixPlan: prefixPlanProp,
  giftPlan: giftPlanProp,
}: {
  brandId: string
  rows: SabangnetOrderRow[]
  requests: InvoicePrefixRequest[]
  existingAllocations: InvoiceGiftAllocation[]
  prefixPlan?: ReturnType<typeof planInvoicePrefixes> | null
  giftPlan?: GiftAssignmentPlan | null
  loading: boolean
  error: string | null
  resolutions: Record<string, string>
  onResolve: (key: string, requestId: string) => void
  giftSeed: number
  excludedGiftStyleIds: string[]
  onRedrawGifts: () => void
  onToggleExcludeGift: (styleId: string) => void
  sourceFileName?: string
}) {
  const queryClient = useQueryClient()
  const now = nowMoment()
  const [selectedMall, setSelectedMall] = useState('')
  const [search, setSearch] = useState('')
  const [copiedName, setCopiedName] = useState('')
  const [isDownloadingGifts, setIsDownloadingGifts] = useState(false)
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null)
  const [downloadIsError, setDownloadIsError] = useState(false)
  const [reviewTab, setReviewTab] = useState<GiftReviewTab>('results')

  const plan = useMemo(
    () => prefixPlanProp ?? planInvoicePrefixes(rows, requests, resolutions),
    [prefixPlanProp, rows, requests, resolutions],
  )

  const localGiftPlan = useMemo(
    () =>
      giftPlanProp ??
      planGiftAssignments(rows, plan, requests, {
        seed: giftSeed,
        excludedGiftStyleIds,
        existingAllocations,
      }),
    [
      existingAllocations,
      excludedGiftStyleIds,
      giftPlanProp,
      giftSeed,
      plan,
      requests,
      rows,
    ],
  )
  const giftPlan = localGiftPlan

  const warehouseRows = useMemo(() => {
    const byId = new Map(
      giftPlan.totals.map((item) => [item.styleId, item]),
    )
    for (const styleId of excludedGiftStyleIds) {
      if (byId.has(styleId)) continue
      const fromRequests = requests
        .flatMap((request) => request.items)
        .flatMap((item) => item.outgoingProducts)
        .find((ref) => ref.styleId === styleId)
      byId.set(styleId, {
        styleId,
        styleNo: fromRequests?.styleNo ?? '',
        giftName: fromRequests?.name ?? styleId,
        count: 0,
      })
    }
    return [...byId.values()]
      .map((item) => ({
        ...item,
        excluded: excludedGiftStyleIds.includes(item.styleId),
      }))
      .sort((left, right) =>
        left.excluded === right.excluded
          ? right.count - left.count ||
            left.styleNo.localeCompare(right.styleNo, 'ko-KR') ||
            left.giftName.localeCompare(right.giftName, 'ko-KR')
          : Number(left.excluded) - Number(right.excluded),
      )
  }, [giftPlan.totals, excludedGiftStyleIds, requests])

  const filePeriod = useMemo(() => {
    const moments = rows
      .map(orderMomentOf)
      .filter((moment): moment is string => Boolean(moment))
      .sort()
    if (moments.length === 0) return null
    return { first: moments[0]!, last: moments[moments.length - 1]! }
  }, [rows])

  const mallNames = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of rows) {
      const mallName = row.mallName.trim()
      if (!mallName) continue
      counts.set(mallName, (counts.get(mallName) ?? 0) + 1)
    }
    return [...counts.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([mallName, rowCount]) => ({ mallName, rowCount }))
  }, [rows])

  const activeMall = selectedMall || mallNames[0]?.mallName || ''

  const prefixedKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const row of rows) {
      if (plan.prefixByRowNumber.has(row.rowNumber)) {
        keys.add(candidateKey(row.mallName, row.productName))
      }
    }
    return keys
  }, [rows, plan])

  const candidates = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of rows) {
      if (normalizeInvoiceText(row.mallName) !== normalizeInvoiceText(activeMall))
        continue
      const productName = row.productName.trim()
      if (!productName) continue
      counts.set(productName, (counts.get(productName) ?? 0) + 1)
    }

    const query = search.trim().toLocaleLowerCase('ko-KR')
    return [...counts.entries()]
      .map(([productName, rowCount]) => ({
        productName,
        rowCount,
        prefixed: prefixedKeys.has(candidateKey(activeMall, productName)),
      }))
      .filter((item) =>
        query
          ? item.productName.toLocaleLowerCase('ko-KR').includes(query)
          : true,
      )
      .sort((left, right) => right.rowCount - left.rowCount)
      .slice(0, CANDIDATE_LIMIT)
  }, [rows, activeMall, search, prefixedKeys])

  const relevantRequests = useMemo(() => {
    if (!filePeriod) return requests.filter((request) => request.isActive)
    return requests.filter(
      (request) =>
        request.isActive &&
        request.endsAt >= filePeriod.first &&
        request.startsAt <= filePeriod.last,
    )
  }, [requests, filePeriod])

  const review = useMemo(
    () => buildPrefixReview(relevantRequests, plan, giftPlan),
    [relevantRequests, plan, giftPlan],
  )
  const hasQuota =
    giftPlan.sharedQuotaPreviews.length > 0 ||
    giftPlan.quotaPreviews.length > 0
  const visibleTab: GiftReviewTab =
    reviewTab === 'quota' && !hasQuota ? 'results' : reviewTab

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
        Supabase에서 사은품 증정 요청 건을 불러오고 있습니다.
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-danger/40 bg-danger/5 p-6 text-center text-sm text-danger">
        {error}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
        <SummaryStat
          label="대상 행"
          value={formatNumber(plan.prefixedRowCount)}
          tone={plan.prefixedRowCount > 0 ? 'success' : 'muted'}
        />
        <SummaryStat
          label="대상 상품"
          value={formatNumber(plan.groups.length)}
          extra={`요청 ${formatNumber(new Set(plan.groups.map((group) => group.requestId)).size)}건`}
        />
        <SummaryStat
          label="통과"
          value={formatNumber(plan.passedRowCount)}
        />
        <SummaryStat
          label="확인 필요"
          value={formatNumber(
            plan.conflicts.length +
              plan.unusedItems.length +
              plan.undatedRowCount +
              plan.outOfPeriodRowCount +
              plan.mallMismatchRowCount,
          )}
          tone={
            plan.conflicts.length +
              plan.undatedRowCount +
              plan.outOfPeriodRowCount +
              plan.mallMismatchRowCount >
            0
              ? 'danger'
              : plan.unusedItems.length > 0
                ? 'warning'
                : 'muted'
          }
        />
        <SummaryStat
          label="합포장"
          value={formatNumber(giftPlan.shipmentCount)}
        />
        <SummaryStat
          label="사은품"
          value={formatNumber(giftPlan.giftCount)}
          tone={giftPlan.giftCount > 0 ? 'success' : 'muted'}
        />
      </div>

      {giftPlan.unavoidableDuplicateCount > 0 ? (
        <p className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning">
          같은 받는분에 같은 M번호가 {formatNumber(giftPlan.unavoidableDuplicateCount)}건
          반복됩니다. 고정 사은품이거나 후보가 부족해서이며, 작업은 계속할 수
          있습니다.
        </p>
      ) : null}

      {filePeriod ? (
        <p className="text-xs text-muted-foreground">
          이 파일의 주문일시는 {filePeriod.first} ~ {filePeriod.last}입니다.
          기간이 겹치는 진행중 요청 건 {formatNumber(relevantRequests.length)}개를
          기준으로 판단했습니다.
          {plan.mallMismatchRowCount > 0
            ? ` 품목명은 요청 건과 같지만 쇼핑몰명이 달라 통과한 행이 ${formatNumber(plan.mallMismatchRowCount)}건 있습니다. 아래 못 찾은 상품의 "파일에서" 칸을 보세요.`
            : ''}
          {plan.outOfPeriodRowCount > 0
            ? ` 상품명은 맞지만 행사 기간을 벗어난 ${formatNumber(plan.outOfPeriodRowCount)}행은 통과시켰습니다.`
            : ''}
          {plan.undatedRowCount > 0
            ? ` 주문일시를 읽을 수 없어 판단하지 못한 행이 ${formatNumber(plan.undatedRowCount)}건 있습니다.`
            : ''}
        </p>
      ) : null}

      {plan.conflicts.length > 0 ? (
        <div className="rounded-lg border border-danger/40 bg-danger/5 p-4">
          <div className="mb-2 flex items-center gap-2">
            <AlertTriangle className="size-4 text-danger" />
            <p className="text-sm font-medium text-danger">
              같은 상품에 요청 건이 겹칩니다 ({plan.conflicts.length}건)
            </p>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            어느 사은품 요청 건을 적용할지 고르면 바로 반영됩니다. 고르지 않은
            상품은 사은품 없이 통과합니다.
          </p>
          <div className="space-y-2">
            {plan.conflicts.map((conflict) => (
              <div
                key={conflict.key}
                className="rounded-md border border-border bg-card p-3"
              >
                <p className="text-xs text-muted-foreground">
                  {conflict.mallName} · {formatNumber(conflict.rowCount)}행
                </p>
                <p className="mb-2 text-sm font-medium">
                  {conflict.productName}
                </p>
                <div className="flex flex-wrap gap-2">
                  {conflict.candidates.map((candidate) => (
                    <Button
                      key={`${candidate.requestId}-${candidate.itemId}`}
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        onResolve(conflict.key, candidate.requestId)
                      }
                    >
                      <Gift className="size-3.5" />
                      {candidate.requestTitle}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <GiftPanelTabs
        active={visibleTab}
        hasQuota={hasQuota}
        checkCount={plan.unusedItems.length}
        onChange={setReviewTab}
      />

      {visibleTab === 'results' ? (
      <div className="space-y-4 pt-4">
        <p className="text-xs text-muted-foreground">
          원 주문 행 바로 뒤에 사은품 행을 붙이고, 같은 합포장의 다른
          주문도 함께 보여 줍니다. 주문일시가 같으면 같은 주문건입니다.
        </p>
        {review.length === 0 ? (
          <p className="rounded-lg border border-border px-4 py-10 text-center text-xs text-muted-foreground">
            이 파일 기간과 겹치는 요청 건이 없습니다. 기준정보 → 사은품
            증정에서 요청 건을 등록하세요.
          </p>
        ) : (
          review.map((item) => (
            <RequestReviewCard key={item.request.id} item={item} />
          ))
        )}
        {requests.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            등록된 요청 건{' '}
            {requests
              .map(
                (request) =>
                  `${request.title} (${
                    invoicePrefixRequestStatus(request, now) === 'running'
                      ? '진행중'
                      : invoicePrefixRequestStatus(request, now) === 'scheduled'
                        ? '예정'
                        : invoicePrefixRequestStatus(request, now) === 'ended'
                          ? '종료'
                          : '중지'
                  })`,
              )
              .join(' · ')}
          </p>
        ) : null}
      </div>
      ) : null}

      {visibleTab === 'quota' ? (
        <div className="space-y-4 pt-4">
      {giftPlan.sharedQuotaPreviews.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">선착순 전체 합계 한도</p>
          <p className="text-xs text-muted-foreground">
            M번호 종류와 관계없이 실제 사은품 수를 합산합니다. 미리보기는 DB를
            바꾸지 않고 내려받을 때 원자적으로 확정합니다.
            {giftPlan.exhaustedSkipCount > 0
              ? ` 한도 소진으로 ${formatNumber(giftPlan.exhaustedSkipCount)}건을 건너뜁니다.`
              : ''}
            {giftPlan.cancelledSkipCount > 0
              ? ` 취소 이력이 있는 ${formatNumber(giftPlan.cancelledSkipCount)}건은 다시 배정하지 않습니다.`
              : ''}
          </p>
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
                  <tr
                    key={quota.requestId}
                    className="border-t border-border"
                  >
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
        </div>
      ) : null}

      {giftPlan.quotaPreviews.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">선착순 한도 현황</p>
          <p className="text-xs text-muted-foreground">
            미리보기는 DB를 바꾸지 않습니다. 내려받을 때 원자적으로 확정합니다.
            {giftPlan.exhaustedSkipCount > 0
              ? ` 한도 소진으로 ${formatNumber(giftPlan.exhaustedSkipCount)}건을 건너뜁니다.`
              : ''}
            {giftPlan.cancelledSkipCount > 0
              ? ` 취소 이력이 있는 ${formatNumber(giftPlan.cancelledSkipCount)}건은 다시 배정하지 않습니다.`
              : ''}
          </p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-180 text-left text-xs">
              <thead className="bg-muted/60">
                <tr>
                  <th className="px-3 py-2.5 font-medium">M번호</th>
                  <th className="px-3 py-2.5 font-medium">제품명</th>
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
                    <td className="px-3 py-2 font-mono">{quota.styleNo}</td>
                    <td className="px-3 py-2">{quota.styleName}</td>
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
        </div>
      ) : null}
        </div>
      ) : null}

      {visibleTab === 'warehouse' ? (
      <div className="pt-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">창고 지시서 · 종류별 집계</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onRedrawGifts}
              disabled={giftPlan.giftCount === 0 && warehouseRows.length === 0}
            >
              <RefreshCw className="size-3.5" />
              다시 뽑기
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={giftPlan.addedRows.length === 0 || isDownloadingGifts}
              onClick={async () => {
                setIsDownloadingGifts(true)
                setDownloadMessage(null)
                try {
                  const finalized = await finalizeGiftPlanForDownload({
                    brandId,
                    rows,
                    prefixPlan: plan,
                    requests,
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
                  const stamp = sourceFileName
                    ? sourceFileName.replace(/\.[^.]+$/, '')
                    : '사은품행'
                  await downloadGiftRows({
                    fileName: `${stamp}_사은품행.xlsx`,
                    rows: finalized.plan.addedRows,
                  })
                  setDownloadIsError(false)
                  setDownloadMessage(
                    finalized.skippedCount > 0
                      ? `${formatNumber(finalized.plan.addedRows.length)}행을 내려받았습니다. 한도 경합으로 ${formatNumber(finalized.skippedCount)}건은 제외됐습니다.`
                      : `${formatNumber(finalized.plan.addedRows.length)}행을 내려받았습니다.`,
                  )
                } catch (reason) {
                  setDownloadIsError(true)
                  setDownloadMessage(
                    reason instanceof Error
                      ? reason.message
                      : '사은품 행을 내려받지 못했습니다.',
                  )
                } finally {
                  setIsDownloadingGifts(false)
                }
              }}
            >
              <Download className="size-3.5" />
              {isDownloadingGifts ? '받는 중...' : '사은품 행 내려받기'}
            </Button>
          </div>
        </div>
        {downloadMessage ? (
          <p
            className={cn(
              'mb-2 text-xs',
              downloadIsError ? 'text-danger' : 'text-success',
            )}
          >
            {downloadMessage}
          </p>
        ) : (
          <p className="mb-2 text-xs text-muted-foreground">
            랜덤은 이 파일 안에서 종류별 같은 수량으로 맞춥니다. 품절이면 그
            종류를 빼고 다시 배정합니다. 선착순 요청은 내려받을 때 확정됩니다.
          </p>
        )}
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-140 text-left text-xs">
            <thead className="bg-muted/60">
              <tr>
                <th className="px-3 py-2.5 font-medium">M번호</th>
                <th className="px-3 py-2.5 font-medium">나가는 제품</th>
                <th className="px-3 py-2.5 font-medium">개수</th>
                <th className="w-28 px-3 py-2.5 font-medium">품절</th>
              </tr>
            </thead>
            <tbody>
              {warehouseRows.length === 0 ? (
                <tr className="border-t border-border">
                  <td
                    colSpan={4}
                    className="px-4 py-8 text-center text-muted-foreground"
                  >
                    이 파일에서 나갈 사은품이 없습니다.
                  </td>
                </tr>
              ) : (
                warehouseRows.map((row) => (
                  <tr
                    key={row.styleId}
                    className={cn(
                      'border-t border-border',
                      row.excluded && 'bg-muted/30 text-muted-foreground',
                    )}
                  >
                    <td className="px-3 py-2.5 font-medium">{row.styleNo}</td>
                    <td className="px-3 py-2.5">{row.giftName}</td>
                    <td className="px-3 py-2.5">{formatNumber(row.count)}</td>
                    <td className="px-3 py-2.5">
                      <label className="inline-flex items-center gap-1.5 text-[11px]">
                        <input
                          type="checkbox"
                          className="size-3.5 accent-primary"
                          checked={row.excluded}
                          onChange={() => onToggleExcludeGift(row.styleId)}
                        />
                        품절 제외
                      </label>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      ) : null}

      {visibleTab === 'check' ? (
      <div className="space-y-4 pt-4">
      {plan.unusedItems.length > 0 ? (
        <div className="rounded-lg border border-warning/40 bg-warning/5 p-4">
          <div className="mb-2 flex items-center gap-2">
            <AlertTriangle className="size-4 text-warning" />
            <p className="text-sm font-medium">
              요청서에는 있는데 이 파일에서 못 찾은 상품{' '}
              {formatNumber(plan.unusedItems.length)}건
            </p>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            주문이 아직 없거나, 요청서 상품명·쇼핑몰명이 사방넷과 다를 수 있습니다.
            품목명만 같고 쇼핑몰명이 다르면 사은품 대상에 넣지 않습니다.
          </p>
          <div className="overflow-x-auto rounded-md border border-border bg-card">
            <table className="w-full min-w-200 text-left text-xs">
              <thead className="bg-muted/60">
                <tr>
                  <th className="px-3 py-2 font-medium">요청 건</th>
                  <th className="px-3 py-2 font-medium">요청 쇼핑몰명</th>
                  <th className="px-3 py-2 font-medium">상품명</th>
                  <th className="px-3 py-2 font-medium">파일에서</th>
                </tr>
              </thead>
              <tbody>
                {plan.unusedItems.map((item) => (
                  <tr
                    key={`${item.requestId}-${item.productName}`}
                    className="border-t border-border align-top"
                  >
                    <td className="max-w-64 whitespace-normal break-words px-3 py-2 text-muted-foreground">
                      {item.requestTitle}
                    </td>
                    <td className="px-3 py-2">{item.mallName}</td>
                    <td className="max-w-80 whitespace-normal break-words px-3 py-2">
                      {item.productName}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {item.fileMallNames.length > 0
                        ? item.fileMallNames.some(
                            (mall) =>
                              normalizeInvoiceText(mall).replace(/\s+/g, '') ===
                              normalizeInvoiceText(item.mallName).replace(
                                /\s+/g,
                                '',
                              ),
                          )
                          ? `같은 품목명 · 같은 쇼핑몰`
                          : `같은 품목명 있음 · 파일 쇼핑몰명: ${item.fileMallNames.join(', ')}`
                        : '같은 품목명 없음'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="rounded-lg border border-border p-4">
        <p className="text-sm font-medium">파일의 품목명 확인</p>
        <p className="mt-1 text-xs text-muted-foreground">
          요청서에 옮겨 담을 이름을 그대로 복사할 수 있습니다. 사은품 대상
          품목명에는 표시가 있습니다.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="min-w-56">
            <label
              htmlFor="invoice-prefix-step-mall"
              className="mb-1.5 block text-xs font-medium"
            >
              쇼핑몰명
            </label>
            <Select
              id="invoice-prefix-step-mall"
              value={activeMall}
              onChange={(event) => setSelectedMall(event.target.value)}
            >
              {mallNames.map((mall) => (
                <option key={mall.mallName} value={mall.mallName}>
                  {mall.mallName} ({formatNumber(mall.rowCount)}행)
                </option>
              ))}
            </Select>
          </div>
          <div className="relative min-w-64 flex-1">
            <label
              htmlFor="invoice-prefix-step-search"
              className="mb-1.5 block text-xs font-medium"
            >
              품목명 검색
            </label>
            <Search className="pointer-events-none absolute left-2.5 top-8.5 size-4 text-muted-foreground" />
            <Input
              id="invoice-prefix-step-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="품목명 일부 입력"
              className="pl-8"
            />
          </div>
          {search ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setSearch('')}
            >
              <X className="size-3.5" />
              지우기
            </Button>
          ) : null}
        </div>

        <div className="mt-3 max-h-72 overflow-y-auto rounded-md border border-border">
          <table className="w-full text-left text-xs">
            <tbody>
              {candidates.length === 0 ? (
                <tr>
                  <td
                    colSpan={3}
                    className="px-4 py-8 text-center text-muted-foreground"
                  >
                    표시할 품목명이 없습니다.
                  </td>
                </tr>
              ) : (
                candidates.map((candidate) => (
                  <tr
                    key={candidate.productName}
                    className={cn(
                      'border-b border-border last:border-b-0',
                      candidate.prefixed && 'bg-success/5',
                    )}
                  >
                    <td className="whitespace-normal break-words px-3 py-2">
                      {candidate.productName}
                    </td>
                    <td className="w-24 px-3 py-2 text-muted-foreground">
                      {formatNumber(candidate.rowCount)}행
                    </td>
                    <td className="w-32 px-3 py-2">
                      {candidate.prefixed ? (
                        <Badge variant="success">사은품 대상</Badge>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            await navigator.clipboard.writeText(
                              candidate.productName,
                            )
                            setCopiedName(candidate.productName)
                          }}
                        >
                          <Copy className="size-3.5" />
                          {copiedName === candidate.productName
                            ? '복사됨'
                            : '복사'}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      </div>
      ) : null}
    </div>
  )
}

function GiftPanelTabs({
  active,
  hasQuota,
  checkCount,
  onChange,
}: {
  active: GiftReviewTab
  hasQuota: boolean
  checkCount: number
  onChange: (tab: GiftReviewTab) => void
}) {
  const tabs: { value: GiftReviewTab; label: string; count?: number }[] = [
    { value: 'results', label: '요청 결과' },
    { value: 'warehouse', label: '창고 집계' },
    ...(hasQuota ? [{ value: 'quota' as const, label: '선착순' }] : []),
    { value: 'check', label: '품목 확인', count: checkCount },
  ]

  return (
    <div className="flex items-stretch gap-0.5 overflow-x-auto overflow-y-hidden border-b border-border pb-px">
      {tabs.map((tab) => {
        const selected = tab.value === active
        return (
          <button
            key={tab.value}
            type="button"
            aria-current={selected ? 'page' : undefined}
            onClick={() => onChange(tab.value)}
            className={cn(
              '-mb-px flex shrink-0 items-center gap-1.5 rounded-t-md border border-b-0 px-3 py-1.5 text-xs transition-colors',
              selected
                ? 'border-border bg-card text-foreground'
                : 'border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground',
            )}
          >
            {tab.label}
            {tab.count ? (
              <span className="tabular-nums text-muted-foreground">
                {formatNumber(tab.count)}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

function formatPeriod(startsAt: string, endsAt: string): string {
  const shortDate = (value: string) =>
    value.slice(0, 10).replaceAll('-', '.').slice(2)
  const time = (value: string) => value.slice(11, 16)
  const startDate = startsAt.slice(0, 10)
  const endDate = endsAt.slice(0, 10)
  if (startDate === endDate) {
    return `${shortDate(startsAt)} ${time(startsAt)} ~ ${time(endsAt)}`
  }
  return `${shortDate(startsAt)} ${time(startsAt)} ~ ${shortDate(endsAt)} ${time(endsAt)}`
}

function RequestReviewCard({ item }: { item: PrefixReviewRequest }) {
  const { request, shipments, matchedRowCount, giftCount } = item
  const [expanded, setExpanded] = useState(false)
  const status = invoicePrefixRequestStatus(request, nowMoment())
  const statusVariant =
    status === 'running' ? 'success' : status === 'scheduled' ? 'warning' : 'muted'

  return (
    <div
      className={cn(
        'rounded-lg border',
        status === 'running' ? 'border-success/40' : 'border-border',
      )}
    >
      <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              {request.title}
            </span>
            <span className="block text-xs text-muted-foreground">
              {request.mallName}
              {` · ${formatPeriod(request.startsAt, request.endsAt)}`}
              {` · ${INVOICE_PREFIX_COUNT_BASIS_LABEL[request.countBasis]}`}
              {request.mergeBasis === 'per_shipment' ? ' · 합포장당 1개' : ''}
              {` · 대상 ${formatNumber(matchedRowCount)}행`}
              {` · 사은품 ${formatNumber(giftCount)}개`}
              {` · 합포장 ${formatNumber(shipments.length)}개`}
            </span>
          </span>
        </button>
        <Badge variant={statusVariant}>
          {INVOICE_PREFIX_REQUEST_STATUS_LABEL[status]}
        </Badge>
      </div>

      {expanded && shipments.length === 0 ? (
        <p className="border-t border-border px-4 py-8 text-center text-xs text-muted-foreground">
          이 파일에서 요청 상품과 완전히 같은 품목명이 없습니다. 아래 품목명
          목록에서 실제 이름을 확인해 주세요.
        </p>
      ) : null}

      {expanded && shipments.length > 0 ? (
        <div className="space-y-3 border-t border-border p-3">
          {shipments.map((shipment) => (
            <div
              key={shipment.key}
              className="overflow-x-auto rounded-md border border-border"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 bg-muted/40 px-3 py-2">
                <p className="text-xs font-medium">
                  {shipment.recipientName || '받는분 없음'}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {shipment.recipientPhone || '-'}
                </p>
                <p className="min-w-0 flex-1 text-[11px] text-muted-foreground">
                  {shipment.recipientAddress || '-'}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {shipment.mallName} · 주문 {formatNumber(shipment.orderCount)}건
                </p>
              </div>
              <table className="w-full min-w-240 text-left text-xs">
                <thead className="bg-muted/60">
                  <tr>
                    <th className="whitespace-nowrap px-3 py-2 font-medium">
                      구분
                    </th>
                    <th className="px-3 py-2 font-medium">품목명</th>
                    <th className="w-20 px-3 py-2 font-medium">M번호</th>
                    <th className="w-16 px-3 py-2 font-medium">수량</th>
                    <th className="px-3 py-2 font-medium">주문일시</th>
                    <th className="px-3 py-2 font-medium">고객주문번호</th>
                  </tr>
                </thead>
                <tbody>
                  {shipment.lines.map((line) => (
                    <tr
                      key={line.key}
                      className={cn(
                        'border-t border-border align-top',
                        line.kind === 'gift' && 'bg-success/5',
                        line.kind === 'order' &&
                          !line.matched &&
                          'text-muted-foreground',
                      )}
                    >
                      <td className="whitespace-nowrap px-3 py-2">
                        {line.kind === 'gift' ? (
                          <span className="font-medium text-success">사은품</span>
                        ) : line.matched ? (
                          <span>대상</span>
                        ) : (
                          <span>합포장</span>
                        )}
                      </td>
                      <td className="max-w-96 whitespace-normal break-words px-3 py-2">
                        {line.row.productName}
                        {line.isRandom ? (
                          <Badge variant="warning" className="ml-1.5">
                            랜덤
                          </Badge>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 font-medium text-muted-foreground">
                        {line.kind === 'gift' ? line.prefix || '-' : '-'}
                      </td>
                      <td className="px-3 py-2">{line.row.quantity}</td>
                      <td className="whitespace-nowrap px-3 py-2">
                        {line.row.orderedAt || '-'}
                      </td>
                      <td className="px-3 py-2">
                        {line.row.customerOrderNo || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function SummaryStat({
  label,
  value,
  extra,
  tone = 'muted',
}: {
  label: string
  value: string
  extra?: string
  tone?: 'success' | 'warning' | 'danger' | 'muted'
}) {
  return (
    <span
      className={cn(
        'inline-flex items-baseline gap-1 rounded-md px-1.5 py-0.5',
        tone === 'success' && 'bg-success/10 text-success',
        tone === 'warning' && 'bg-warning/10 text-warning',
        tone === 'danger' && 'bg-danger/10 text-danger',
      )}
    >
      <span className={cn('text-xs', tone === 'muted' && 'text-muted-foreground')}>
        {label}
      </span>
      <span className="font-semibold tabular-nums">{value}</span>
      {extra ? (
        <span className="text-xs text-muted-foreground">({extra})</span>
      ) : null}
    </span>
  )
}
