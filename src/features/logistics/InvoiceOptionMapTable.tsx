import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil, Search, X } from 'lucide-react'
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
import { formatOptionItemName } from '@/lib/invoice/option-transform'
import {
  deleteInvoiceOptionMap,
  setInvoiceOptionMapActive,
} from '@/lib/api'
import type { InvoiceOptionMap } from '@/lib/types'
import { cn, formatNumber } from '@/lib/utils'
import { InvoiceOptionMapForm } from './InvoiceOptionMapForm'

function mainLabel(map: InvoiceOptionMap): string {
  const main = map.components.find((item) => item.role === 'main')
  if (!main) return '본품 없음'
  return `${main.style.styleNo} · ${main.style.name}`
}

export function InvoiceOptionMapTable({
  brandId,
  maps,
  loading,
  error,
}: {
  brandId: string
  maps: InvoiceOptionMap[]
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
        map.itemName,
        map.mallName,
        map.ownProductCode,
        mainLabel(map),
        formatOptionItemName(map.components.filter((item) => item.role !== 'main')),
      ]
        .join(' ')
        .toLocaleLowerCase('ko-KR')
        .includes(q),
    )
  }, [maps, search])

  const activeCount = maps.filter((map) => map.isActive).length
  const pausedCount = maps.length - activeCount
  const missingMain = maps.filter(
    (map) => !map.components.some((item) => item.role === 'main'),
  )

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      setInvoiceOptionMapActive(id, isActive),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['invoice-option-maps', brandId],
      })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteInvoiceOptionMap(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['invoice-option-maps', brandId],
      })
      setEditingId(null)
    },
  })

  const editing = maps.find((map) => map.id === editingId) ?? null

  return (
    <Card className="shadow-none">
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>변환 기준</CardTitle>
          <CardDescription className="mt-1">
            원본 품목명·내품명 조합을 본품과 구성품 M번호로 연결합니다. 한 번
            저장하면 오늘 파일과 이후 작업에 다시 쓰입니다.
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="success">사용중 {formatNumber(activeCount)}</Badge>
          <Badge variant="muted">중지 {formatNumber(pausedCount)}</Badge>
          {missingMain.length > 0 ? (
            <Badge variant="danger">
              본품 없음 {formatNumber(missingMain.length)}
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="품목명·내품명·M번호 검색"
            className="pl-8"
          />
        </div>
        {error ? <p className="text-xs text-danger">{error}</p> : null}
        {loading ? (
          <p className="text-sm text-muted-foreground">불러오는 중...</p>
        ) : filtered.length === 0 ? (
          <p className="rounded-lg border border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
            아직 변환 기준이 없습니다. 기존 원장을 가져오거나 아래에서 직접
            등록하세요.
          </p>
        ) : (
          <div className="max-h-[36rem] overflow-auto rounded-lg border border-border">
            <table className="w-full min-w-[960px] text-left text-xs">
              <thead className="sticky top-0 bg-muted/80">
                <tr>
                  <th className="px-3 py-2 font-medium">원본 품목명</th>
                  <th className="px-3 py-2 font-medium">내품명</th>
                  <th className="px-3 py-2 font-medium">쇼핑몰</th>
                  <th className="px-3 py-2 font-medium">본품</th>
                  <th className="px-3 py-2 font-medium">구성</th>
                  <th className="px-3 py-2 font-medium">상태</th>
                  <th className="px-3 py-2 font-medium">작업</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((map) => {
                  const extras = map.components.filter(
                    (item) => item.role !== 'main',
                  )
                  return (
                    <tr
                      key={map.id}
                      className={cn(
                        'border-t border-border',
                        editingId === map.id && 'bg-primary/5',
                      )}
                    >
                      <td className="max-w-56 truncate px-3 py-2">
                        {map.productName}
                      </td>
                      <td className="max-w-40 truncate px-3 py-2">
                        {map.itemName || '-'}
                      </td>
                      <td className="px-3 py-2">{map.mallName || '전체'}</td>
                      <td className="max-w-48 truncate px-3 py-2">
                        {mainLabel(map)}
                      </td>
                      <td className="max-w-64 truncate px-3 py-2 text-muted-foreground">
                        {formatOptionItemName(extras)}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={map.isActive ? 'success' : 'muted'}>
                          {map.isActive ? '사용중' : '중지'}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setEditingId(
                                editingId === map.id ? null : map.id,
                              )
                            }
                          >
                            {editingId === map.id ? (
                              <X className="size-3.5" />
                            ) : (
                              <Pencil className="size-3.5" />
                            )}
                            {editingId === map.id ? '닫기' : '수정'}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={toggleMutation.isPending}
                            onClick={() =>
                              toggleMutation.mutate({
                                id: map.id,
                                isActive: !map.isActive,
                              })
                            }
                          >
                            {map.isActive ? '중지' : '사용'}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={deleteMutation.isPending}
                            onClick={() => {
                              if (
                                window.confirm(
                                  '이 변환 기준을 삭제할까요? 같은 조합은 다시 검토 대상이 됩니다.',
                                )
                              ) {
                                deleteMutation.mutate(map.id)
                              }
                            }}
                          >
                            삭제
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {editing ? (
          <div className="rounded-lg border border-border p-4">
            <p className="mb-3 text-sm font-medium">변환 기준 수정</p>
            <InvoiceOptionMapForm
              brandId={brandId}
              map={editing}
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
