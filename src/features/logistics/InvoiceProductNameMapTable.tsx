import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil, Search } from 'lucide-react'
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
  deleteInvoiceProductNameMap,
  setInvoiceProductNameMapActive,
} from '@/lib/api'
import type { InvoiceProductNameMap } from '@/lib/types'
import { cn, formatNumber } from '@/lib/utils'
import { InvoiceProductNameMapForm } from './InvoiceProductNameMapForm'

export function InvoiceProductNameMapTable({
  brandId,
  maps,
  loading,
  error,
}: {
  brandId: string
  maps: InvoiceProductNameMap[]
  loading: boolean
  error: string | null
}) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('ko-KR')
    const list = [...maps].sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) ||
        left.productName.localeCompare(right.productName, 'ko-KR'),
    )
    if (!q) return list
    return list.filter((map) =>
      [
        map.productName,
        map.lookupKey,
        map.itemNameContext,
        map.mallName,
        map.ownProductCode,
        map.style.styleNo,
        map.style.name,
      ]
        .join(' ')
        .toLocaleLowerCase('ko-KR')
        .includes(q),
    )
  }, [maps, search])

  const activeCount = maps.filter((map) => map.isActive).length

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      setInvoiceProductNameMapActive(id, isActive),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['invoice-product-name-maps', brandId],
      })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteInvoiceProductNameMap(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['invoice-product-name-maps', brandId],
      })
    },
  })

  return (
    <Card className="shadow-none">
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>품목명 변환 기준</CardTitle>
          <CardDescription className="mt-1">
            원본 품목명·내품명 문맥 또는 기존 원장 조회 키를 본품 1개에만
            연결합니다. 내품명 문자열은 바꾸지 않습니다.
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
            placeholder="품목명·문맥·본품 검색"
            className="pl-8"
          />
        </div>
        {error ? (
          <p className="text-sm text-danger">{error}</p>
        ) : loading ? (
          <p className="text-sm text-muted-foreground">불러오는 중...</p>
        ) : (
          <div className="max-h-[28rem] overflow-auto rounded-lg border border-border">
            <table className="w-full min-w-[880px] text-left text-xs">
              <thead className="sticky top-0 bg-muted/80">
                <tr>
                  <th className="px-3 py-2 font-medium">원본 품목명·조회 키</th>
                  <th className="px-3 py-2 font-medium">매칭 방식</th>
                  <th className="px-3 py-2 font-medium">본품</th>
                  <th className="px-3 py-2 font-medium">상태</th>
                  <th className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((map) => (
                  <tr key={map.id} className="border-t border-border">
                    <td className="max-w-56 truncate px-3 py-2">
                      {map.productName}
                    </td>
                    <td className="max-w-40 truncate px-3 py-2 text-muted-foreground">
                      {map.lookupKey
                        ? '조회 키'
                        : `조합 · 내품명 ${map.itemNameContext || '없음'}`}
                    </td>
                    <td className="max-w-48 truncate px-3 py-2">
                      {map.style.styleNo} · {map.style.name}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={map.isActive ? 'success' : 'muted'}>
                        {map.isActive ? '활성' : '중지'}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setEditingId((current) =>
                              current === map.id ? null : map.id,
                            )
                          }
                        >
                          <Pencil className="size-3.5" />
                          {editingId === map.id ? '접기' : '수정'}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            toggleMutation.mutate({
                              id: map.id,
                              isActive: !map.isActive,
                            })
                          }
                        >
                          {map.isActive ? '중지' : '재개'}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="text-danger"
                          onClick={() => deleteMutation.mutate(map.id)}
                        >
                          삭제
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {editingId ? (
          <div className={cn('rounded-lg border border-border p-3')}>
            <InvoiceProductNameMapForm
              brandId={brandId}
              map={maps.find((item) => item.id === editingId) ?? null}
              lockSource
              submitLabel="수정 저장"
              onSaved={() => setEditingId(null)}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
