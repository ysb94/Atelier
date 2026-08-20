import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil, Search } from 'lucide-react'
import { StylePicker } from '@/components/style-picker'
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
  deleteInvoiceProductNameMaps,
  getInvoiceProductNameMaps,
  setInvoiceProductNameMapActive,
  setInvoiceProductNameMapsActive,
  setInvoiceProductNameMapsStyle,
  type InvoiceProductNameMapBulkResult,
} from '@/lib/api'
import type {
  InvoiceOptionMap,
  InvoiceProductNameMap,
  StyleRef,
} from '@/lib/types'
import { cn, formatNumber } from '@/lib/utils'
import {
  productCompositionSearchText,
  productCompositionVariantsForMap,
} from '@/lib/invoice/product-composition'
import { InvoiceProductNameMapForm } from './InvoiceProductNameMapForm'
import { ProductCompositionLines } from './ProductCompositionLines'

export function InvoiceProductNameMapTable({
  brandId,
  maps,
  optionMaps = [],
  loading,
  error,
}: {
  brandId: string
  maps: InvoiceProductNameMap[]
  optionMaps?: InvoiceOptionMap[]
  loading: boolean
  error: string | null
}) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [bulkStyleOpen, setBulkStyleOpen] = useState(false)
  const [bulkStyle, setBulkStyle] = useState<StyleRef | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const mapsQueryKey = ['invoice-product-name-maps', brandId] as const

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
        ...productCompositionVariantsForMap(optionMaps, map).flatMap((variant) => [
          variant.itemName,
          productCompositionSearchText(variant.items),
        ]),
      ]
        .join(' ')
        .toLocaleLowerCase('ko-KR')
        .includes(q),
    )
  }, [maps, optionMaps, search])

  const mapIds = useMemo(() => new Set(maps.map((map) => map.id)), [maps])
  const filteredIds = useMemo(
    () => filtered.map((map) => map.id),
    [filtered],
  )

  useEffect(() => {
    setSelectedIds((current) => {
      let changed = false
      const next = new Set<string>()
      for (const id of current) {
        if (mapIds.has(id)) next.add(id)
        else changed = true
      }
      return changed ? next : current
    })
  }, [mapIds])

  const selectedCount = selectedIds.size
  const selectedVisibleCount = filteredIds.filter((id) =>
    selectedIds.has(id),
  ).length
  const allVisibleSelected =
    filteredIds.length > 0 && selectedVisibleCount === filteredIds.length
  const someVisibleSelected =
    selectedVisibleCount > 0 && !allVisibleSelected
  const selectedMaps = useMemo(
    () => maps.filter((map) => selectedIds.has(map.id)),
    [maps, selectedIds],
  )
  const activeCount = maps.filter((map) => map.isActive).length

  function setMapsCache(
    updater: (current: InvoiceProductNameMap[]) => InvoiceProductNameMap[],
  ) {
    queryClient.setQueryData<InvoiceProductNameMap[]>(mapsQueryKey, (current) =>
      current ? updater(current) : current,
    )
  }

  async function refreshMaps() {
    const next = await getInvoiceProductNameMaps(brandId)
    queryClient.setQueryData(mapsQueryKey, next)
  }

  function describeBulkResult(
    result: InvoiceProductNameMapBulkResult,
    verb: string,
  ) {
    if (result.appliedIds.length === result.requested) {
      return `${formatNumber(result.appliedIds.length)}건을 ${verb}했습니다.`
    }
    return `${formatNumber(result.appliedIds.length)}건 ${verb}, ${formatNumber(result.requested - result.appliedIds.length)}건 실패`
  }

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      setInvoiceProductNameMapActive(id, isActive),
    onSuccess: (_result, { id, isActive }) => {
      setMapsCache((current) =>
        current.map((map) => (map.id === id ? { ...map, isActive } : map)),
      )
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteInvoiceProductNameMap(id),
    onMutate: async (id) => {
      setActionError(null)
      setActionMessage(null)
      await queryClient.cancelQueries({ queryKey: mapsQueryKey })
      const previous =
        queryClient.getQueryData<InvoiceProductNameMap[]>(mapsQueryKey)
      setMapsCache((current) => current.filter((map) => map.id !== id))
      if (editingId === id) setEditingId(null)
      setSelectedIds((current) => {
        if (!current.has(id)) return current
        const next = new Set(current)
        next.delete(id)
        return next
      })
      return { previous }
    },
    onError: (reason, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(mapsQueryKey, context.previous)
      }
      setActionError(
        reason instanceof Error
          ? reason.message
          : '품목명 변환 기준을 삭제하지 못했습니다.',
      )
    },
  })

  const bulkStyleMutation = useMutation({
    mutationFn: (input: { ids: string[]; style: StyleRef }) =>
      setInvoiceProductNameMapsStyle(brandId, input.ids, input.style.styleId),
    onSuccess: async (result, { ids, style }) => {
      const applied = new Set(result.appliedIds)
      setMapsCache((current) =>
        current.map((map) =>
          applied.has(map.id) ? { ...map, style } : map,
        ),
      )
      if (result.appliedIds.length !== result.requested) {
        await refreshMaps()
        setActionError(describeBulkResult(result, '본품 변경'))
        setActionMessage(null)
      } else {
        setActionError(null)
        setActionMessage(describeBulkResult(result, '본품 변경'))
      }
      setBulkStyleOpen(false)
      setBulkStyle(null)
      setSelectedIds((current) => {
        const next = new Set(current)
        for (const id of ids) next.delete(id)
        return next
      })
    },
    onError: (reason) => {
      void refreshMaps()
      setActionError(
        reason instanceof Error
          ? reason.message
          : '선택한 기준의 본품을 바꾸지 못했습니다.',
      )
    },
  })

  const bulkPauseMutation = useMutation({
    mutationFn: (ids: string[]) =>
      setInvoiceProductNameMapsActive(brandId, ids, false),
    onSuccess: async (result) => {
      const applied = new Set(result.appliedIds)
      setMapsCache((current) =>
        current.map((map) =>
          applied.has(map.id) ? { ...map, isActive: false } : map,
        ),
      )
      if (result.appliedIds.length !== result.requested) {
        await refreshMaps()
        setActionError(describeBulkResult(result, '중지'))
        setActionMessage(null)
      } else {
        setActionError(null)
        setActionMessage(describeBulkResult(result, '중지'))
      }
    },
    onError: (reason) => {
      void refreshMaps()
      setActionError(
        reason instanceof Error
          ? reason.message
          : '선택한 기준을 중지하지 못했습니다.',
      )
    },
  })

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => deleteInvoiceProductNameMaps(brandId, ids),
    onMutate: async (ids) => {
      setActionError(null)
      setActionMessage(null)
      await queryClient.cancelQueries({ queryKey: mapsQueryKey })
      const previous =
        queryClient.getQueryData<InvoiceProductNameMap[]>(mapsQueryKey)
      const removed = new Set(ids)
      setMapsCache((current) => current.filter((map) => !removed.has(map.id)))
      if (editingId && removed.has(editingId)) setEditingId(null)
      return { previous }
    },
    onSuccess: async (result, ids) => {
      const applied = new Set(result.appliedIds)
      setSelectedIds((current) => {
        const next = new Set(current)
        for (const id of ids) next.delete(id)
        return next
      })
      if (result.appliedIds.length !== result.requested) {
        await refreshMaps()
        setActionError(describeBulkResult(result, '삭제'))
        setActionMessage(null)
        return
      }
      setMapsCache((current) =>
        current.filter((map) => !applied.has(map.id)),
      )
      setActionMessage(describeBulkResult(result, '삭제'))
    },
    onError: (reason, _ids, context) => {
      if (context?.previous) {
        queryClient.setQueryData(mapsQueryKey, context.previous)
      }
      void refreshMaps()
      setActionError(
        reason instanceof Error
          ? reason.message
          : '선택한 기준을 삭제하지 못했습니다.',
      )
    },
  })

  const pending =
    toggleMutation.isPending ||
    deleteMutation.isPending ||
    bulkStyleMutation.isPending ||
    bulkPauseMutation.isPending ||
    bulkDeleteMutation.isPending

  function toggleSelected(id: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function toggleSelectVisible(checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current)
      for (const id of filteredIds) {
        if (checked) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }

  function runBulkStyle() {
    if (!bulkStyle || selectedMaps.length === 0) return
    setActionError(null)
    setActionMessage(null)
    bulkStyleMutation.mutate({
      ids: selectedMaps.map((map) => map.id),
      style: bulkStyle,
    })
  }

  function runBulkPause() {
    if (selectedMaps.length === 0) return
    setActionError(null)
    setActionMessage(null)
    bulkPauseMutation.mutate(selectedMaps.map((map) => map.id))
  }

  function runBulkDelete() {
    if (selectedMaps.length === 0) return
    if (
      !window.confirm(
        `선택한 품목명 변환 기준 ${formatNumber(selectedMaps.length)}건을 삭제할까요? 같은 조회 키는 다시 검토 대상이 됩니다.`,
      )
    ) {
      return
    }
    setActionError(null)
    setActionMessage(null)
    bulkDeleteMutation.mutate(selectedMaps.map((map) => map.id))
  }

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
        {selectedCount > 0 ? (
          <div className="space-y-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm tabular-nums">
                {formatNumber(selectedCount)}개 선택
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  setBulkStyleOpen((open) => !open)
                  setActionError(null)
                  setActionMessage(null)
                }}
              >
                본품 수정
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={runBulkPause}
              >
                {bulkPauseMutation.isPending ? '중지 중' : '선택 중지'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="text-danger"
                disabled={pending}
                onClick={runBulkDelete}
              >
                {bulkDeleteMutation.isPending ? '삭제 중' : '선택 삭제'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  setSelectedIds(new Set())
                  setBulkStyleOpen(false)
                  setBulkStyle(null)
                }}
              >
                선택 해제
              </Button>
            </div>
            {bulkStyleOpen ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                  <p className="mb-1.5 text-xs font-medium">
                    선택한 기준의 본품 M번호
                  </p>
                  <StylePicker
                    brandId={brandId}
                    value={bulkStyle}
                    onChange={setBulkStyle}
                    placeholder="같은 본품 1개로 바꿉니다"
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  disabled={!bulkStyle || pending}
                  onClick={runBulkStyle}
                >
                  {bulkStyleMutation.isPending ? '변경 중' : '변경 적용'}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        {actionError ? (
          <p className="text-sm text-danger">{actionError}</p>
        ) : null}
        {actionMessage ? (
          <p className="text-sm text-success">{actionMessage}</p>
        ) : null}
        {loading ? (
          <p className="text-sm text-muted-foreground">불러오는 중...</p>
        ) : (
          <div className="max-h-[28rem] overflow-auto rounded-lg border border-border">
            <table className="w-full min-w-[880px] text-left text-xs">
              <thead className="sticky top-0 bg-muted/80">
                <tr>
                  <th className="w-10 px-3 py-2 font-medium">
                    <input
                      type="checkbox"
                      className="size-3.5 accent-primary"
                      aria-label="검색된 기준 전체 선택"
                      checked={allVisibleSelected}
                      ref={(element) => {
                        if (element) element.indeterminate = someVisibleSelected
                      }}
                      disabled={filteredIds.length === 0 || pending}
                      onChange={(event) =>
                        toggleSelectVisible(event.target.checked)
                      }
                    />
                  </th>
                  <th className="px-3 py-2 font-medium">원본 품목명·조회 키</th>
                  <th className="px-3 py-2 font-medium">매칭 방식</th>
                  <th className="px-3 py-2 font-medium">품목명 변환 정보</th>
                  <th className="px-3 py-2 font-medium">상태</th>
                  <th className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((map) => {
                  const checked = selectedIds.has(map.id)
                  return (
                    <tr key={map.id} className="border-t border-border">
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          className="size-3.5 accent-primary"
                          aria-label={`${map.productName} 선택`}
                          checked={checked}
                          disabled={pending}
                          onChange={(event) =>
                            toggleSelected(map.id, event.target.checked)
                          }
                        />
                      </td>
                      <td className="max-w-56 truncate px-3 py-2">
                        {map.productName}
                      </td>
                      <td className="max-w-40 truncate px-3 py-2 text-muted-foreground">
                        {map.lookupKey
                          ? '조회 키'
                          : `조합 · 내품명 ${map.itemNameContext || '없음'}`}
                      </td>
                      <td className="max-w-64 px-3 py-2">
                        <ProductNameMapComposition
                          map={map}
                          optionMaps={optionMaps}
                        />
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
                            disabled={pending}
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
                            disabled={pending}
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
                            disabled={pending}
                            onClick={() => {
                              if (
                                !window.confirm(
                                  '이 품목명 변환 기준을 삭제할까요? 같은 조회 키는 다시 검토 대상이 됩니다.',
                                )
                              ) {
                                return
                              }
                              deleteMutation.mutate(map.id)
                            }}
                          >
                            {deleteMutation.isPending &&
                            deleteMutation.variables === map.id
                              ? '삭제 중'
                              : '삭제'}
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

function ProductNameMapComposition({
  map,
  optionMaps,
}: {
  map: InvoiceProductNameMap
  optionMaps: InvoiceOptionMap[]
}) {
  const variants = productCompositionVariantsForMap(optionMaps, map)
  const showLabels = variants.length > 1
  return (
    <div className="space-y-1.5">
      {variants.map((variant) => (
        <div key={variant.key} className="space-y-0.5">
          {showLabels ? (
            <p className="text-[11px] text-muted-foreground">
              {variant.itemName || '(내품명 없음)'}
              {variant.mallName ? ` · ${variant.mallName}` : ''}
            </p>
          ) : null}
          <ProductCompositionLines items={variant.items} />
        </div>
      ))}
    </div>
  )
}
