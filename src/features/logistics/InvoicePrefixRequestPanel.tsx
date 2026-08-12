import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
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
  deleteInvoicePrefixRequest,
  setInvoicePrefixRequestActive,
} from '@/lib/api'
import {
  invoicePrefixRequestStatus,
  nowMoment,
} from '@/lib/invoice/prefix-transform'
import {
  INVOICE_PREFIX_COUNT_BASIS_LABEL,
  INVOICE_PREFIX_REQUEST_STATUS_LABEL,
  type InvoicePrefixRequest,
  type InvoicePrefixRequestStatus,
} from '@/lib/types'
import { cn, formatNumber } from '@/lib/utils'

const STATUS_VARIANT: Record<
  InvoicePrefixRequestStatus,
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

export function InvoicePrefixRequestPanel({
  brandId,
  requests,
  loading,
  error,
}: {
  brandId: string
  requests: InvoicePrefixRequest[]
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
          item.prefix,
          ...item.outgoingProductNames,
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
      setInvoicePrefixRequestActive(input.id, input.isActive),
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
    mutationFn: (id: string) => deleteInvoicePrefixRequest(id),
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
          <CardTitle>접두어 요청 건</CardTitle>
          <CardDescription className="mt-1">
            사은품 증정 요청서 단위로 관리합니다. 쇼핑몰명과 품목명이 완전히
            같고 주문일시가 행사 기간 안인 주문에만 접두어를 붙이며, 실제 결합은
            모든 변환이 끝난 최종 품목명에 적용합니다.
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
              placeholder="제목·쇼핑몰·상품명·접두어 검색"
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
            <p className="mb-3 text-sm font-medium">새 요청 건</p>
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
            Supabase에서 접두어 요청 건을 불러오고 있습니다.
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
              const prefixKinds = new Set(
                request.items.map((item) => item.prefix),
              )

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
                          {` · ${INVOICE_PREFIX_COUNT_BASIS_LABEL[request.countBasis]}`}
                          {request.mergeBasis === 'per_shipment'
                            ? ' · 합포장 상자당 1개'
                            : ''}
                          {` · 상품 ${formatNumber(request.items.length)}건`}
                          {` · 접두어 ${formatNumber(prefixKinds.size)}종`}
                        </span>
                      </span>
                    </button>
                    <Badge variant={STATUS_VARIANT[status]}>
                      {INVOICE_PREFIX_REQUEST_STATUS_LABEL[status]}
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
                    <div className="border-t border-border px-3 py-3">
                      {request.note ? (
                        <p className="mb-2 text-xs text-muted-foreground">
                          {request.note}
                        </p>
                      ) : null}
                      <div className="overflow-x-auto rounded-md border border-border">
                        <table className="w-full min-w-200 text-left text-xs">
                          <thead className="bg-muted/60">
                            <tr>
                              <th className="px-3 py-2 font-medium">상품명</th>
                              <th className="px-3 py-2 font-medium">접두어</th>
                              <th className="px-3 py-2 font-medium">
                                나가는 제품
                              </th>
                              <th className="px-3 py-2 font-medium">랜덤</th>
                            </tr>
                          </thead>
                          <tbody>
                            {request.items.map((item) => (
                              <tr
                                key={item.id}
                                className="border-t border-border align-top"
                              >
                                <td className="max-w-80 whitespace-normal break-words px-3 py-2">
                                  {item.productName}
                                </td>
                                <td className="px-3 py-2 font-medium">
                                  {item.prefix}
                                </td>
                                <td className="max-w-96 whitespace-normal break-words px-3 py-2 text-muted-foreground">
                                  {item.outgoingProductNames.length > 0
                                    ? item.outgoingProductNames.join(' · ')
                                    : '-'}
                                </td>
                                <td className="px-3 py-2">
                                  {item.isRandom ? (
                                    <Badge variant="warning">랜덤</Badge>
                                  ) : (
                                    <span className="text-muted-foreground">
                                      -
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
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
