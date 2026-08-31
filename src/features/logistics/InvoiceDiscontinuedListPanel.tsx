import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { StylePicker, formatStyleRef } from '@/components/style-picker'
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
import {
  createInvoiceDiscontinuedStyle,
  deleteInvoiceDiscontinuedStyle,
  getInvoiceDiscontinuedStyles,
} from '@/lib/api'
import type { InvoiceDiscontinuedStyle, StyleRef } from '@/lib/types'
import { cn, formatNumber } from '@/lib/utils'

export function InvoiceDiscontinuedListPanel({
  brandId,
}: {
  brandId: string
}) {
  const queryClient = useQueryClient()
  const queryKey = ['invoice-discontinued-styles', brandId] as const
  const listQuery = useQuery({
    queryKey,
    queryFn: () => getInvoiceDiscontinuedStyles(brandId),
  })

  const [draftStyle, setDraftStyle] = useState<StyleRef | null>(null)
  const [draftNote, setDraftNote] = useState('')
  const [query, setQuery] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [messageIsError, setMessageIsError] = useState(false)

  const items = listQuery.data ?? []

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ko-KR')
    const rows = needle
      ? items.filter((item) =>
          `${item.styleNo} ${item.name} ${item.note}`
            .toLocaleLowerCase('ko-KR')
            .includes(needle),
        )
      : items
    return [...rows].sort(
      (left, right) =>
        left.styleNo.localeCompare(right.styleNo, 'ko-KR') ||
        left.name.localeCompare(right.name, 'ko-KR'),
    )
  }, [items, query])

  function setCache(
    updater: (
      current: InvoiceDiscontinuedStyle[],
    ) => InvoiceDiscontinuedStyle[],
  ) {
    queryClient.setQueryData<InvoiceDiscontinuedStyle[]>(
      queryKey,
      (current) => (current ? updater(current) : current),
    )
  }

  const createMutation = useMutation({
    mutationFn: () => {
      if (!draftStyle) throw new Error('단종으로 올릴 상품을 고르세요.')
      return createInvoiceDiscontinuedStyle(brandId, {
        styleId: draftStyle.styleId,
        note: draftNote,
      })
    },
    onSuccess: (created) => {
      setCache((current) => [created, ...current])
      setDraftStyle(null)
      setDraftNote('')
      setMessageIsError(false)
      setMessage(`${created.styleNo}를 단종 리스트에 저장했습니다.`)
    },
    onError: (reason) => {
      setMessageIsError(true)
      setMessage(
        reason instanceof Error
          ? reason.message
          : '단종 리스트에 추가하지 못했습니다.',
      )
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteInvoiceDiscontinuedStyle(brandId, id),
    onSuccess: (_result, id) => {
      setCache((current) => current.filter((item) => item.id !== id))
      setMessageIsError(false)
      setMessage('단종 리스트에서 뺐습니다.')
    },
    onError: (reason) => {
      setMessageIsError(true)
      setMessage(
        reason instanceof Error
          ? reason.message
          : '단종 리스트에서 빼지 못했습니다.',
      )
    },
  })

  function addItem() {
    if (!draftStyle) {
      setMessageIsError(true)
      setMessage('단종으로 올릴 상품을 고르세요.')
      return
    }
    if (items.some((item) => item.styleId === draftStyle.styleId)) {
      setMessageIsError(true)
      setMessage(`${draftStyle.styleNo}는 이미 단종 리스트에 있습니다.`)
      return
    }
    createMutation.mutate()
  }

  const busy = createMutation.isPending || deleteMutation.isPending

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>단종 리스트</CardTitle>
          <CardDescription className="mt-1">
            상품명·M번호를 입력하면 연관 검색 결과에서 고릅니다. 직접 타이핑
            저장을 막아 오탈자를 줄입니다. 송장 재고·예약 단계의 단종 제외
            후보로 쓸 예정입니다.
          </CardDescription>
        </div>
        <Badge variant="muted">{formatNumber(items.length)}개</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 rounded-lg border border-border bg-muted/10 p-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto]">
          <div className="min-w-0 space-y-1.5">
            <p className="text-[11px] font-medium text-muted-foreground">
              상품 검색
            </p>
            <StylePicker
              brandId={brandId}
              value={draftStyle}
              onChange={setDraftStyle}
            />
          </div>
          <div className="min-w-0 space-y-1.5">
            <p className="text-[11px] font-medium text-muted-foreground">
              메모 (선택)
            </p>
            <Input
              value={draftNote}
              onChange={(event) => setDraftNote(event.target.value)}
              placeholder="예: SS25 시즌 종료"
              className="h-9 text-xs"
            />
          </div>
          <div className="flex items-end">
            <Button
              type="button"
              size="sm"
              className="h-9"
              disabled={busy || !draftStyle}
              onClick={addItem}
            >
              <Plus className="size-3.5" />
              {createMutation.isPending ? '저장 중' : '단종 추가'}
            </Button>
          </div>
        </div>

        {listQuery.isError ? (
          <p className="text-xs text-danger">
            {listQuery.error instanceof Error
              ? listQuery.error.message
              : '단종 리스트를 불러오지 못했습니다.'}
          </p>
        ) : null}

        {message ? (
          <p
            className={cn(
              'text-xs',
              messageIsError ? 'text-danger' : 'text-muted-foreground',
            )}
          >
            {message}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="M번호·상품명·메모 검색"
            aria-label="단종 리스트 검색"
            className="h-8 max-w-xs text-xs"
          />
        </div>

        <div className="max-h-[min(60vh,32rem)] overflow-auto rounded-lg border border-border">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="sticky top-0 z-10 bg-muted/90">
              <tr>
                <th className="px-3 py-2 font-medium">M번호</th>
                <th className="px-3 py-2 font-medium">상품명</th>
                <th className="px-3 py-2 font-medium">메모</th>
                <th className="px-3 py-2 font-medium">추가</th>
                <th className="px-3 py-2 font-medium">관리</th>
              </tr>
            </thead>
            <tbody>
              {listQuery.isLoading ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-10 text-center text-muted-foreground"
                  >
                    불러오는 중…
                  </td>
                </tr>
              ) : visible.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-10 text-center text-muted-foreground"
                  >
                    {items.length === 0
                      ? '단종 리스트가 비어 있습니다. 위에서 상품을 추가하세요.'
                      : '검색 결과가 없습니다.'}
                  </td>
                </tr>
              ) : (
                visible.map((item) => (
                  <tr key={item.id} className="border-t border-border">
                    <td className="px-3 py-2 font-mono">{item.styleNo}</td>
                    <td className="max-w-80 truncate px-3 py-2 font-medium">
                      {item.name}
                    </td>
                    <td className="max-w-64 truncate px-3 py-2 text-muted-foreground">
                      {item.note || '—'}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {new Date(item.createdAt).toLocaleString('ko-KR', {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="px-3 py-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className={cn('h-7 px-2 text-danger')}
                        disabled={busy}
                        onClick={() => deleteMutation.mutate(item.id)}
                        aria-label={`${formatStyleRef({
                          styleId: item.styleId,
                          styleNo: item.styleNo,
                          name: item.name,
                        })} 제거`}
                      >
                        <Trash2 className="size-3.5" />
                        제거
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
