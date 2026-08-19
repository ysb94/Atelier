import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Search } from 'lucide-react'
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
  deleteInvoiceProductNameExclusion,
  getInvoiceProductNameExclusions,
  setInvoiceProductNameExclusionActive,
} from '@/lib/api'
import type { InvoiceProductNameExclusion } from '@/lib/types'
import { formatNumber } from '@/lib/utils'

export function InvoiceProductNameExclusionTable({
  brandId,
}: {
  brandId: string
}) {
  const queryClient = useQueryClient()
  const queryKey = ['invoice-product-name-exclusions', brandId] as const
  const listQuery = useQuery({
    queryKey,
    queryFn: () => getInvoiceProductNameExclusions(brandId),
  })
  const [search, setSearch] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const exclusions = listQuery.data
  const exclusionList = exclusions ?? []

  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('ko-KR')
    const list = [...(exclusions ?? [])].sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) ||
        left.productName.localeCompare(right.productName, 'ko-KR'),
    )
    if (!q) return list
    return list.filter((item) =>
      [item.mallName, item.productName, item.itemName, item.note]
        .join(' ')
        .toLocaleLowerCase('ko-KR')
        .includes(q),
    )
  }, [exclusions, search])

  const activeCount = exclusionList.filter((item) => item.isActive).length

  function setCache(
    updater: (
      current: InvoiceProductNameExclusion[],
    ) => InvoiceProductNameExclusion[],
  ) {
    queryClient.setQueryData<InvoiceProductNameExclusion[]>(
      queryKey,
      (current) => (current ? updater(current) : current),
    )
  }

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      setInvoiceProductNameExclusionActive(id, isActive),
    onSuccess: (_result, { id, isActive }) => {
      setActionError(null)
      setCache((current) =>
        current.map((item) => (item.id === id ? { ...item, isActive } : item)),
      )
    },
    onError: (reason) => {
      setActionError(
        reason instanceof Error
          ? reason.message
          : '송장 제외 기준 상태를 바꾸지 못했습니다.',
      )
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteInvoiceProductNameExclusion(id),
    onMutate: async (id) => {
      setActionError(null)
      await queryClient.cancelQueries({ queryKey })
      const previous =
        queryClient.getQueryData<InvoiceProductNameExclusion[]>(queryKey)
      setCache((current) => current.filter((item) => item.id !== id))
      return { previous }
    },
    onError: (reason, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous)
      }
      setActionError(
        reason instanceof Error
          ? reason.message
          : '송장 제외 기준을 삭제하지 못했습니다.',
      )
    },
  })

  const pending = toggleMutation.isPending || deleteMutation.isPending
  const listError =
    listQuery.error instanceof Error
      ? listQuery.error.message
      : listQuery.error
        ? '송장 제외 기준을 불러오지 못했습니다.'
        : null

  return (
    <Card className="shadow-none">
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>송장 제외 기준</CardTitle>
          <CardDescription className="mt-1">
            특정 쇼핑몰의 품목명·내품명 정확 조합만 최종 송장에서 뺍니다. 본품
            M번호는 쓰지 않고, 같은 주문에 확정 본품 행이 있을 때만 제외합니다.
          </CardDescription>
        </div>
        <Badge variant="muted">활성 {formatNumber(activeCount)}</Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="쇼핑몰·품목명·내품명 검색"
            className="pl-8"
          />
        </div>
        {listError ? <p className="text-sm text-danger">{listError}</p> : null}
        {actionError ? <p className="text-sm text-danger">{actionError}</p> : null}
        {listQuery.isPending ? (
          <p className="text-sm text-muted-foreground">불러오는 중...</p>
        ) : filtered.length === 0 ? (
          <p className="rounded-lg border border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
            저장된 송장 제외 기준이 없습니다. 오늘 작업의 품목명 검토에서
            `미선택 옵션 · 송장 제외`로 추가합니다.
          </p>
        ) : (
          <div className="max-h-[28rem] overflow-auto rounded-lg border border-border">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="sticky top-0 bg-muted/80">
                <tr>
                  <th className="px-3 py-2 font-medium">쇼핑몰</th>
                  <th className="px-3 py-2 font-medium">원본 품목명</th>
                  <th className="px-3 py-2 font-medium">원본 내품명</th>
                  <th className="px-3 py-2 font-medium">상태</th>
                  <th className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id} className="border-t border-border">
                    <td className="max-w-40 truncate px-3 py-2">{item.mallName}</td>
                    <td className="max-w-48 truncate px-3 py-2">
                      {item.productName}
                    </td>
                    <td className="max-w-48 truncate px-3 py-2">{item.itemName}</td>
                    <td className="px-3 py-2">
                      <Badge variant={item.isActive ? 'success' : 'muted'}>
                        {item.isActive ? '활성' : '중지'}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          onClick={() =>
                            toggleMutation.mutate({
                              id: item.id,
                              isActive: !item.isActive,
                            })
                          }
                        >
                          {item.isActive ? '중지' : '재개'}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="text-danger"
                          disabled={pending}
                          onClick={() => {
                            if (
                              !window.confirm(
                                '이 송장 제외 기준을 삭제할까요? 같은 조합은 다시 최종 송장에 나옵니다.',
                              )
                            ) {
                              return
                            }
                            deleteMutation.mutate(item.id)
                          }}
                        >
                          {deleteMutation.isPending &&
                          deleteMutation.variables === item.id
                            ? '삭제 중'
                            : '삭제'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
