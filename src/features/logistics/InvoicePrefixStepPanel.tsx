import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  Copy,
  Download,
  RefreshCw,
  Search,
  Tag,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import {
  downloadGiftRows,
  planGiftAssignments,
} from '@/lib/invoice/gift-assign'
import {
  applyInvoicePrefix,
  invoicePrefixRequestStatus,
  normalizeInvoiceText,
  nowMoment,
  orderMomentOf,
  planInvoicePrefixes,
} from '@/lib/invoice/prefix-transform'
import type { SabangnetOrderRow } from '@/lib/invoice/sabangnet'
import type { InvoicePrefixRequest } from '@/lib/types'
import { cn, formatNumber } from '@/lib/utils'

const CANDIDATE_LIMIT = 200

function candidateKey(mallName: string, productName: string) {
  return `${normalizeInvoiceText(mallName)}\u0000${normalizeInvoiceText(productName)}`
}

/**
 * 자체품번코드 변환 전에 실행하는 접두어 단계.
 * 원본 품목명이 남아 있는 지금만 쇼핑몰명 + 품목명 완전 일치를 찾을 수 있다.
 * 붙이기로 정한 접두어는 모든 변환이 끝난 최종 품목명에 결합한다.
 */
export function InvoicePrefixStepPanel({
  rows,
  requests,
  loading,
  error,
  resolutions,
  onResolve,
  giftSeed,
  excludedGiftNames,
  onRedrawGifts,
  onToggleExcludeGift,
  sourceFileName,
}: {
  rows: SabangnetOrderRow[]
  requests: InvoicePrefixRequest[]
  loading: boolean
  error: string | null
  resolutions: Record<string, string>
  onResolve: (key: string, requestId: string) => void
  giftSeed: number
  excludedGiftNames: string[]
  onRedrawGifts: () => void
  onToggleExcludeGift: (giftName: string) => void
  sourceFileName?: string
}) {
  const now = nowMoment()
  const [selectedMall, setSelectedMall] = useState('')
  const [search, setSearch] = useState('')
  const [copiedName, setCopiedName] = useState('')
  const [isDownloadingGifts, setIsDownloadingGifts] = useState(false)

  const plan = useMemo(
    () => planInvoicePrefixes(rows, requests, resolutions),
    [rows, requests, resolutions],
  )

  const giftPlan = useMemo(
    () =>
      planGiftAssignments(rows, plan, requests, {
        seed: giftSeed,
        excludedGiftNames,
      }),
    [rows, plan, requests, giftSeed, excludedGiftNames],
  )

  const warehouseRows = useMemo(() => {
    const byName = new Map(
      giftPlan.totals.map((item) => [item.giftName, item.count]),
    )
    for (const name of excludedGiftNames) {
      if (!byName.has(name)) byName.set(name, 0)
    }
    return [...byName.entries()]
      .map(([giftName, count]) => ({
        giftName,
        count,
        excluded: excludedGiftNames.includes(giftName),
      }))
      .sort((left, right) =>
        left.excluded === right.excluded
          ? right.count - left.count ||
            left.giftName.localeCompare(right.giftName, 'ko-KR')
          : Number(left.excluded) - Number(right.excluded),
      )
  }, [giftPlan.totals, excludedGiftNames])

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
    if (!filePeriod) return requests
    return requests.filter(
      (request) =>
        request.isActive &&
        request.endsAt >= filePeriod.first &&
        request.startsAt <= filePeriod.last,
    )
  }, [requests, filePeriod])

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
        Supabase에서 접두어 요청 건을 불러오고 있습니다.
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
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <SummaryTile
          label="접두어 붙는 행"
          value={formatNumber(plan.prefixedRowCount)}
          tone={plan.prefixedRowCount > 0 ? 'success' : 'muted'}
        />
        <SummaryTile
          label="적용 상품"
          value={formatNumber(plan.groups.length)}
          hint={`요청 건 ${formatNumber(new Set(plan.groups.map((group) => group.requestId)).size)}개`}
        />
        <SummaryTile
          label="그냥 통과"
          value={formatNumber(plan.passedRowCount)}
          hint="규칙 없는 조합은 그대로 넘어갑니다"
        />
        <SummaryTile
          label="확인 필요"
          value={formatNumber(
            plan.conflicts.length +
              plan.unusedItems.length +
              plan.undatedRowCount,
          )}
          tone={
            plan.conflicts.length + plan.undatedRowCount > 0
              ? 'danger'
              : plan.unusedItems.length > 0
                ? 'warning'
                : 'muted'
          }
        />
        <SummaryTile
          label="사은품 나가는 상자"
          value={formatNumber(giftPlan.shipmentCount)}
          hint="받는분·전화·주소가 같은 묶음"
        />
        <SummaryTile
          label="사은품 총 개수"
          value={formatNumber(giftPlan.giftCount)}
          tone={giftPlan.giftCount > 0 ? 'success' : 'muted'}
        />
      </div>

      {filePeriod ? (
        <p className="text-xs text-muted-foreground">
          이 파일의 주문일시는 {filePeriod.first} ~ {filePeriod.last}입니다.
          기간이 겹치는 진행중 요청 건 {formatNumber(relevantRequests.length)}개를
          기준으로 판단했습니다.
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
            어느 접두어를 붙일지 고르면 바로 반영됩니다. 고르지 않은 상품은
            접두어 없이 통과합니다.
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
                      <Tag className="size-3.5" />
                      {candidate.prefix}
                      <span className="text-muted-foreground">
                        {candidate.requestTitle}
                      </span>
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">이 파일에 적용되는 접두어</p>
          <Badge variant="muted">{formatNumber(plan.groups.length)}개 상품</Badge>
        </div>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-200 text-left text-xs">
            <thead className="bg-muted/60">
              <tr>
                <th className="px-3 py-2.5 font-medium">요청 건</th>
                <th className="px-3 py-2.5 font-medium">쇼핑몰명</th>
                <th className="px-3 py-2.5 font-medium">품목명</th>
                <th className="px-3 py-2.5 font-medium">접두어</th>
                <th className="px-3 py-2.5 font-medium">건수</th>
                <th className="px-3 py-2.5 font-medium">최종 예시</th>
              </tr>
            </thead>
            <tbody>
              {plan.groups.length === 0 ? (
                <tr className="border-t border-border">
                  <td
                    colSpan={6}
                    className="px-4 py-10 text-center text-muted-foreground"
                  >
                    이 파일에 붙을 접두어가 없습니다. 기준정보 → 접두어에서 요청
                    건을 등록하세요.
                  </td>
                </tr>
              ) : (
                plan.groups.map((group) => (
                  <tr key={group.key} className="border-t border-border">
                    <td className="max-w-64 whitespace-normal break-words px-3 py-2.5 text-muted-foreground">
                      {group.requestTitle}
                    </td>
                    <td className="px-3 py-2.5">{group.mallName}</td>
                    <td className="max-w-72 whitespace-normal break-words px-3 py-2.5">
                      {group.productName}
                    </td>
                    <td className="px-3 py-2.5 font-medium">{group.prefix}</td>
                    <td className="px-3 py-2.5">
                      {formatNumber(group.rowCount)}
                    </td>
                    <td className="max-w-80 whitespace-normal break-words px-3 py-2.5 text-muted-foreground">
                      {applyInvoicePrefix(group.prefix, group.productName)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div>
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
                try {
                  const stamp = sourceFileName
                    ? sourceFileName.replace(/\.[^.]+$/, '')
                    : '사은품행'
                  await downloadGiftRows({
                    fileName: `${stamp}_사은품행.xlsx`,
                    rows: giftPlan.addedRows,
                  })
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
        <p className="mb-2 text-xs text-muted-foreground">
          랜덤은 이 파일 안에서 종류별 같은 수량으로 맞춥니다. 품절이면 그
          종류를 빼고 다시 배정합니다. 같은 상자 안에서는 가능한 한 겹치지
          않습니다.
        </p>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-140 text-left text-xs">
            <thead className="bg-muted/60">
              <tr>
                <th className="px-3 py-2.5 font-medium">나가는 제품</th>
                <th className="px-3 py-2.5 font-medium">개수</th>
                <th className="w-28 px-3 py-2.5 font-medium">품절</th>
              </tr>
            </thead>
            <tbody>
              {warehouseRows.length === 0 ? (
                <tr className="border-t border-border">
                  <td
                    colSpan={3}
                    className="px-4 py-8 text-center text-muted-foreground"
                  >
                    이 파일에서 나갈 사은품이 없습니다.
                  </td>
                </tr>
              ) : (
                warehouseRows.map((row) => (
                  <tr
                    key={row.giftName}
                    className={cn(
                      'border-t border-border',
                      row.excluded && 'bg-muted/30 text-muted-foreground',
                    )}
                  >
                    <td className="px-3 py-2.5">{row.giftName}</td>
                    <td className="px-3 py-2.5">{formatNumber(row.count)}</td>
                    <td className="px-3 py-2.5">
                      <label className="inline-flex items-center gap-1.5 text-[11px]">
                        <input
                          type="checkbox"
                          className="size-3.5 accent-primary"
                          checked={row.excluded}
                          onChange={() => onToggleExcludeGift(row.giftName)}
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

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">합포장 묶음별 배정</p>
          <Badge variant="muted">
            {formatNumber(giftPlan.shipments.length)}상자
          </Badge>
        </div>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-220 text-left text-xs">
            <thead className="bg-muted/60">
              <tr>
                <th className="px-3 py-2.5 font-medium">받는분</th>
                <th className="px-3 py-2.5 font-medium">대상 주문</th>
                <th className="px-3 py-2.5 font-medium">대상 상품</th>
                <th className="px-3 py-2.5 font-medium">배정된 사은품</th>
              </tr>
            </thead>
            <tbody>
              {giftPlan.shipments.length === 0 ? (
                <tr className="border-t border-border">
                  <td
                    colSpan={4}
                    className="px-4 py-8 text-center text-muted-foreground"
                  >
                    접두어가 붙은 행이 있으면 여기서 상자별로 사은품이 보입니다.
                  </td>
                </tr>
              ) : (
                giftPlan.shipments.map((shipment) => (
                  <tr
                    key={shipment.key}
                    className="border-t border-border align-top"
                  >
                    <td className="px-3 py-2.5">
                      <span className="block font-medium">
                        {shipment.recipientName || '-'}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        {shipment.recipientPhone || '-'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      {formatNumber(shipment.orderCount)}건
                    </td>
                    <td className="max-w-72 whitespace-normal break-words px-3 py-2.5 text-muted-foreground">
                      {shipment.productNames.join(' · ')}
                    </td>
                    <td className="max-w-80 whitespace-normal break-words px-3 py-2.5">
                      {shipment.assignments.map((item) => item.giftName).join(' · ')}
                      {shipment.assignments.some((item) => item.isRandom) ? (
                        <Badge variant="warning" className="ml-1.5">
                          랜덤
                        </Badge>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {giftPlan.addedRows.length > 0 ? (
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">추가될 사은품 행</p>
            <Badge variant="muted">
              {formatNumber(giftPlan.addedRows.length)}행
            </Badge>
          </div>
          <p className="mb-2 text-xs text-muted-foreground">
            원 주문을 복사해 품목명을 사은품명으로 바꾼 행입니다. 내품수량은
            1입니다. 최종 엑셀 내보내기가 생기면 그때 원본과 합칩니다.
          </p>
          <div className="max-h-72 overflow-auto rounded-lg border border-border">
            <table className="w-full min-w-200 text-left text-xs">
              <thead className="sticky top-0 bg-muted/60">
                <tr>
                  <th className="px-3 py-2 font-medium">받는분</th>
                  <th className="px-3 py-2 font-medium">고객주문번호</th>
                  <th className="px-3 py-2 font-medium">품목명</th>
                  <th className="px-3 py-2 font-medium">내품수량</th>
                </tr>
              </thead>
              <tbody>
                {giftPlan.addedRows.slice(0, 80).map((row) => (
                  <tr key={row.rowNumber} className="border-t border-border">
                    <td className="px-3 py-2">{row.recipientName}</td>
                    <td className="px-3 py-2">{row.customerOrderNo}</td>
                    <td className="max-w-80 whitespace-normal break-words px-3 py-2">
                      {row.productName}
                    </td>
                    <td className="px-3 py-2">{row.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {giftPlan.addedRows.length > 80 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              앞 {formatNumber(80)}행만 미리 봅니다. 전체는 내려받기에서
              확인하세요.
            </p>
          ) : null}
        </div>
      ) : null}

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
            주문이 아직 없거나, 요청서 상품명이 사방넷 품목명과 다를 수 있습니다.
            아래 품목명 목록에서 실제 이름을 확인해 요청 건을 고쳐 주세요.
          </p>
          <div className="overflow-x-auto rounded-md border border-border bg-card">
            <table className="w-full min-w-200 text-left text-xs">
              <thead className="bg-muted/60">
                <tr>
                  <th className="px-3 py-2 font-medium">요청 건</th>
                  <th className="px-3 py-2 font-medium">쇼핑몰명</th>
                  <th className="px-3 py-2 font-medium">상품명</th>
                  <th className="px-3 py-2 font-medium">접두어</th>
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
                    <td className="px-3 py-2 font-medium">{item.prefix}</td>
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
          요청서에 옮겨 담을 이름을 그대로 복사할 수 있습니다. 접두어가 붙는
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
                        <Badge variant="success">접두어 적용</Badge>
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
  )
}

function SummaryTile({
  label,
  value,
  hint,
  tone = 'muted',
}: {
  label: string
  value: string
  hint?: string
  tone?: 'success' | 'warning' | 'danger' | 'muted'
}) {
  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        tone === 'success' && 'border-success/40 bg-success/5',
        tone === 'warning' && 'border-warning/40 bg-warning/5',
        tone === 'danger' && 'border-danger/40 bg-danger/5',
        tone === 'muted' && 'border-border',
      )}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold">{value}</p>
      {hint ? (
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}
