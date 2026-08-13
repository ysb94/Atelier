import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { InvoicePrefixRequestForm } from '@/features/logistics/InvoicePrefixRequestForm'
import {
  cancelInvoiceGiftAllocations,
  deleteInvoiceGiftRequest,
  getInvoiceGiftAllocations,
  setInvoiceGiftRequestActive,
} from '@/lib/api'
import {
  invoicePrefixRequestStatus,
  nowMoment,
} from '@/lib/invoice/prefix-transform'
import {
  INVOICE_GIFT_COUNT_BASIS_LABEL,
  INVOICE_GIFT_REQUEST_STATUS_LABEL,
  type InvoiceGiftRequest,
  type InvoiceGiftRequestStatus,
} from '@/lib/types'
import { cn, formatNumber } from '@/lib/utils'

const STATUS_VARIANT: Record<
  InvoiceGiftRequestStatus,
  'success' | 'warning' | 'muted'
> = {
  running: 'success',
  scheduled: 'warning',
  ended: 'muted',
  paused: 'muted',
}

/** 같은 날이면 `26.05.04 09:00 ~ 21:00`, 다르면 날짜·시각을 모두 적는다. */
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

function countOutgoingProducts(request: InvoiceGiftRequest): number {
  const ids = new Set<string>()
  for (const item of request.items) {
    for (const ref of item.outgoingProducts) {
      ids.add(ref.styleId)
    }
  }
  return ids.size
}

export function InvoicePrefixRequestPanel({
  brandId,
  requests,
  loading,
  error,
}: {
  brandId: string
  requests: InvoiceGiftRequest[]
  loading: boolean
  error: string | null
}) {
  const queryClient = useQueryClient()
  const now = nowMoment()
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ko-KR')
    if (!query) return requests
    return requests.filter((request) =>
      [
        request.title,
        request.mallName,
        request.note,
        ...request.items.flatMap((item) => [
          item.productName,
          ...item.outgoingProducts.flatMap((ref) => [ref.styleNo, ref.name]),
        ]),
      ]
        .join(' ')
        .toLocaleLowerCase('ko-KR')
        .includes(query),
    )
  }, [requests, search])

  const runningCount = requests.filter(
    (request) => invoicePrefixRequestStatus(request, now) === 'running',
  ).length

  function invalidate() {
    return queryClient.invalidateQueries({
      queryKey: ['invoice-prefix-requests', brandId],
    })
  }

  const activeMutation = useMutation({
    mutationFn: (input: { id: string; isActive: boolean }) =>
      setInvoiceGiftRequestActive(input.id, input.isActive),
    onSuccess: async () => {
      await invalidate()
      setRowError(null)
    },
    onError: (reason) => {
      setRowError(
        reason instanceof Error ? reason.message : '상태를 바꾸지 못했습니다.',
      )
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteInvoiceGiftRequest(id),
    onSuccess: async () => {
      await invalidate()
      setPendingDeleteId(null)
      setRowError(null)
    },
    onError: (reason) => {
      setRowError(
        reason instanceof Error ? reason.message : '삭제하지 못했습니다.',
      )
    },
  })

  const editingRequest = editingId
    ? requests.find((request) => request.id === editingId)
    : undefined

  return (
    <Card className="shadow-none">
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>사은품 증정 요청 건</CardTitle>
          <CardDescription className="mt-1">
            사은품 증정 요청서 단위로 관리합니다. 쇼핑몰명과 원본 품목명이
            완전히 같고 주문일시가 행사 기간 안인 주문에 사은품 행을 추가합니다.
          </CardDescription>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="muted">{formatNumber(requests.length)}건</Badge>
          {runningCount > 0 ? (
            <Badge variant="success">진행중 {runningCount}</Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="relative min-w-64 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="제목·쇼핑몰·품목명·나가는 제품 검색"
              className="pl-8"
            />
          </div>
          {search ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSearch('')}
            >
              <X className="size-3.5" />
              검색 지우기
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant={creating ? 'outline' : 'default'}
            onClick={() => {
              setEditingId(null)
              setCreating((current) => !current)
            }}
          >
            {creating ? (
              <>
                <X className="size-3.5" />
                등록 닫기
              </>
            ) : (
              <>
                <Plus className="size-4" />
                요청 건 등록
              </>
            )}
          </Button>
        </div>

        {creating ? (
          <div className="rounded-lg border border-border bg-muted/10 p-4">
            <p className="mb-3 text-sm font-medium">새 사은품 증정 요청</p>
            <InvoicePrefixRequestForm
              brandId={brandId}
              existingRequests={requests}
              onDone={() => setCreating(false)}
            />
          </div>
        ) : null}

        {editingRequest ? (
          <div className="rounded-lg border border-primary/40 bg-muted/10 p-4">
            <p className="mb-3 text-sm font-medium">
              요청 건 수정 · {editingRequest.title}
            </p>
            <InvoicePrefixRequestForm
              key={editingRequest.id}
              brandId={brandId}
              editing={editingRequest}
              existingRequests={requests}
              onDone={() => setEditingId(null)}
            />
          </div>
        ) : null}

        {loading ? (
          <p className="rounded-lg border border-border px-4 py-12 text-center text-xs text-muted-foreground">
            Supabase에서 사은품 증정 요청 건을 불러오고 있습니다.
          </p>
        ) : error ? (
          <p className="rounded-lg border border-border px-4 py-12 text-center text-xs text-danger">
            {error}
          </p>
        ) : filtered.length === 0 ? (
          <p className="rounded-lg border border-border px-4 py-12 text-center text-xs text-muted-foreground">
            {requests.length === 0
              ? '등록된 요청 건이 없습니다. 요청 건 등록으로 요청서를 옮겨 담으세요.'
              : '검색 결과가 없습니다.'}
          </p>
        ) : (
          <div className="space-y-2">
            {filtered.map((request) => {
              const status = invoicePrefixRequestStatus(request, now)
              const expanded = expandedId === request.id
              const outgoingCount = countOutgoingProducts(request)

              return (
                <div
                  key={request.id}
                  className={cn(
                    'rounded-lg border border-border',
                    status === 'running' && 'border-success/40',
                    (status === 'ended' || status === 'paused') &&
                      'bg-muted/20',
                  )}
                >
                  <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      onClick={() =>
                        setExpandedId(expanded ? null : request.id)
                      }
                      aria-expanded={expanded}
                    >
                      {expanded ? (
                        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {request.title}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {request.mallName}
                          {` · ${formatPeriod(request.startsAt, request.endsAt)}`}
                          {` · ${INVOICE_GIFT_COUNT_BASIS_LABEL[request.countBasis]}`}
                          {request.mergeBasis === 'per_shipment'
                            ? ' · 합포장당 1개'
                            : ''}
                          {request.usesFirstCome
                            ? request.firstComeLimitMode === 'shared_total'
                              ? ` · 선착순 전체 ${formatNumber(request.firstComeTotalLimit ?? 0)}개`
                              : ' · 선착순 M번호별'
                            : ''}
                          {` · 대상 품목 ${formatNumber(request.items.length)}건`}
                          {outgoingCount > 0
                            ? ` · 나가는 제품 ${formatNumber(outgoingCount)}종`
                            : ''}
                        </span>
                      </span>
                    </button>
                    <Badge variant={STATUS_VARIANT[status]}>
                      {INVOICE_GIFT_REQUEST_STATUS_LABEL[status]}
                    </Badge>
                    <div className="flex gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={activeMutation.isPending}
                        onClick={() =>
                          activeMutation.mutate({
                            id: request.id,
                            isActive: !request.isActive,
                          })
                        }
                      >
                        {request.isActive ? '중지' : '다시 사용'}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setCreating(false)
                          setEditingId(request.id)
                        }}
                      >
                        <Pencil className="size-3.5" />
                        수정
                      </Button>
                      {pendingDeleteId === request.id ? (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="text-danger"
                            disabled={deleteMutation.isPending}
                            onClick={() => deleteMutation.mutate(request.id)}
                          >
                            정말 삭제
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setPendingDeleteId(null)}
                          >
                            취소
                          </Button>
                        </>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setPendingDeleteId(request.id)}
                        >
                          <Trash2 className="size-3.5" />
                          삭제
                        </Button>
                      )}
                    </div>
                  </div>

                  {expanded ? (
                    <ExpandedRequestDetails
                      brandId={brandId}
                      request={request}
                      onError={setRowError}
                    />
                  ) : null}
                </div>
              )
            })}
          </div>
        )}

        {rowError ? <p className="text-xs text-danger">{rowError}</p> : null}
      </CardContent>
    </Card>
  )
}

function ExpandedRequestDetails({
  brandId,
  request,
  onError,
}: {
  brandId: string
  request: InvoiceGiftRequest
  onError: (message: string | null) => void
}) {
  const queryClient = useQueryClient()
  const allocationsQuery = useQuery({
    queryKey: ['invoice-gift-allocations', brandId, request.id],
    queryFn: () =>
      getInvoiceGiftAllocations(brandId, { requestId: request.id }),
    enabled: request.usesFirstCome,
  })

  const cancelMutation = useMutation({
    mutationFn: (orderFingerprint: string) =>
      cancelInvoiceGiftAllocations(brandId, request.id, orderFingerprint),
    onSuccess: async () => {
      onError(null)
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['invoice-gift-allocations', brandId, request.id],
        }),
        queryClient.invalidateQueries({
          queryKey: ['invoice-prefix-requests', brandId],
        }),
      ])
    },
    onError: (reason) => {
      onError(
        reason instanceof Error
          ? reason.message
          : '배정을 취소하지 못했습니다.',
      )
    },
  })

  const activeAllocations = useMemo(
    () => (allocationsQuery.data ?? []).filter((row) => !row.cancelledAt),
    [allocationsQuery.data],
  )

  const orderGroups = useMemo(() => {
    const map = new Map<
      string,
      {
        orderFingerprint: string
        mallName: string
        customerOrderNo: string
        orderedAt: string
        gifts: string[]
      }
    >()
    for (const row of activeAllocations) {
      const current = map.get(row.orderFingerprint)
      const giftLabel = `${row.styleNo} · ${row.styleName}`
      if (current) {
        current.gifts.push(giftLabel)
        continue
      }
      map.set(row.orderFingerprint, {
        orderFingerprint: row.orderFingerprint,
        mallName: row.mallName,
        customerOrderNo: row.customerOrderNo,
        orderedAt: row.orderedAt,
        gifts: [giftLabel],
      })
    }
    return [...map.values()].sort((a, b) =>
      a.orderedAt.localeCompare(b.orderedAt),
    )
  }, [activeAllocations])

  return (
    <div className="space-y-3 border-t border-border px-3 py-3">
      {request.note ? (
        <p className="text-xs text-muted-foreground">{request.note}</p>
      ) : null}

      {request.usesFirstCome &&
      request.firstComeLimitMode === 'shared_total' &&
      request.firstComeTotalLimit !== null ? (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-120 text-left text-xs">
            <thead className="bg-muted/60">
              <tr>
                <th className="px-3 py-2 font-medium">한도 방식</th>
                <th className="px-3 py-2 font-medium">확정</th>
                <th className="px-3 py-2 font-medium">한도</th>
                <th className="px-3 py-2 font-medium">잔여</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-border">
                <td className="px-3 py-2">여러 사은품 전체 합계</td>
                <td className="px-3 py-2">
                  {formatNumber(request.firstComeUsedCount)}
                </td>
                <td className="px-3 py-2">
                  {formatNumber(request.firstComeTotalLimit)}
                </td>
                <td className="px-3 py-2">
                  {formatNumber(
                    Math.max(
                      0,
                      request.firstComeTotalLimit -
                        request.firstComeUsedCount,
                    ),
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : request.usesFirstCome && request.quotas.length > 0 ? (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-160 text-left text-xs">
            <thead className="bg-muted/60">
              <tr>
                <th className="px-3 py-2 font-medium">M번호</th>
                <th className="px-3 py-2 font-medium">제품명</th>
                <th className="px-3 py-2 font-medium">확정</th>
                <th className="px-3 py-2 font-medium">한도</th>
                <th className="px-3 py-2 font-medium">잔여</th>
              </tr>
            </thead>
            <tbody>
              {request.quotas.map((quota) => (
                <tr key={quota.id} className="border-t border-border">
                  <td className="px-3 py-2 font-mono">{quota.styleNo}</td>
                  <td className="px-3 py-2">{quota.styleName}</td>
                  <td className="px-3 py-2">{formatNumber(quota.usedCount)}</td>
                  <td className="px-3 py-2">
                    {formatNumber(quota.quantityLimit)}
                  </td>
                  <td className="px-3 py-2">
                    {formatNumber(
                      Math.max(0, quota.quantityLimit - quota.usedCount),
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-200 text-left text-xs">
          <thead className="bg-muted/60">
            <tr>
              <th className="px-3 py-2 font-medium">원본 품목명</th>
              <th className="px-3 py-2 font-medium">나가는 제품</th>
              <th className="px-3 py-2 font-medium">랜덤</th>
            </tr>
          </thead>
          <tbody>
            {request.items.map((item) => (
              <tr key={item.id} className="border-t border-border align-top">
                <td className="max-w-80 whitespace-normal break-words px-3 py-2">
                  {item.productName}
                </td>
                <td className="max-w-96 whitespace-normal break-words px-3 py-2 text-muted-foreground">
                  {item.outgoingProducts.length > 0
                    ? item.outgoingProducts
                        .map((ref) => `${ref.styleNo} · ${ref.name}`)
                        .join(' · ')
                    : '-'}
                </td>
                <td className="px-3 py-2">
                  {item.isRandom ? (
                    <Badge variant="warning">랜덤</Badge>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {request.usesFirstCome ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            주문별 배정 이력
          </p>
          {allocationsQuery.isLoading ? (
            <p className="text-xs text-muted-foreground">배정 이력을 불러오는 중…</p>
          ) : allocationsQuery.isError ? (
            <p className="text-xs text-danger">
              {allocationsQuery.error instanceof Error
                ? allocationsQuery.error.message
                : '배정 이력을 불러오지 못했습니다.'}
            </p>
          ) : orderGroups.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              확정된 배정이 없습니다.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-200 text-left text-xs">
                <thead className="bg-muted/60">
                  <tr>
                    <th className="px-3 py-2 font-medium">주문번호</th>
                    <th className="px-3 py-2 font-medium">주문일시</th>
                    <th className="px-3 py-2 font-medium">사은품</th>
                    <th className="px-3 py-2 font-medium">취소</th>
                  </tr>
                </thead>
                <tbody>
                  {orderGroups.map((group) => (
                    <tr
                      key={group.orderFingerprint}
                      className="border-t border-border align-top"
                    >
                      <td className="px-3 py-2">
                        {group.customerOrderNo || '(번호 없음)'}
                      </td>
                      <td className="px-3 py-2 font-mono">
                        {group.orderedAt.slice(0, 16).replace('T', ' ')}
                      </td>
                      <td className="max-w-96 whitespace-normal break-words px-3 py-2 text-muted-foreground">
                        {group.gifts.join(' · ')}
                      </td>
                      <td className="px-3 py-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={cancelMutation.isPending}
                          onClick={() =>
                            cancelMutation.mutate(group.orderFingerprint)
                          }
                        >
                          배정 해제
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
