import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  createInvoicePickingRoutePreset,
  deleteInvoicePickingRoutePreset,
  getInvoicePickingRoutePresets,
  InvoicePickingRoutePresetStoreError,
  updateInvoicePickingRoutePreset,
} from '@/lib/api'
import {
  applyInvoiceProductListRoutePreset,
  serializeInvoiceProductListRouteGroups,
  type InvoiceProductListPrintLayout,
} from '@/lib/invoice/product-list-route'
import type { InvoiceProductListWarehouseGroup } from '@/lib/invoice/product-list-warehouse'
import type { InvoicePickingRoutePreset, WarehouseZone } from '@/lib/types'
import { cn } from '@/lib/utils'

function queryKey(brandId: string, zone: WarehouseZone) {
  return ['invoice-picking-route-presets', brandId, zone] as const
}

export function InvoiceProductListRoutePresetPanel({
  brandId,
  zone,
  groups,
  layout,
  onApplyLayout,
}: {
  brandId: string
  zone: WarehouseZone
  groups: InvoiceProductListWarehouseGroup[]
  layout: InvoiceProductListPrintLayout
  onApplyLayout: (layout: InvoiceProductListPrintLayout) => void
}) {
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [editName, setEditName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const presetsQuery = useQuery({
    queryKey: queryKey(brandId, zone),
    queryFn: () => getInvoicePickingRoutePresets(brandId, zone),
    enabled: Boolean(brandId),
  })
  const presets = useMemo(
    () => presetsQuery.data ?? [],
    [presetsQuery.data],
  )
  const selected = presets.find((item) => item.id === selectedId) ?? null

  useEffect(() => {
    setSelectedId(null)
    setEditName('')
    setError(null)
  }, [zone])

  useEffect(() => {
    setEditName(selected?.name ?? '')
  }, [selected?.id, selected?.name])

  function showError(err: unknown) {
    setError(
      err instanceof InvoicePickingRoutePresetStoreError
        ? err.message
        : err instanceof Error
          ? err.message
          : '동선 사전을 저장하지 못했습니다.',
    )
  }

  async function invalidate(next?: InvoicePickingRoutePreset) {
    await queryClient.invalidateQueries({ queryKey: queryKey(brandId, zone) })
    if (next) setSelectedId(next.id)
  }

  const createMutation = useMutation({
    mutationFn: () =>
      createInvoicePickingRoutePreset(brandId, zone, {
        name: newName,
        routeGroups: serializeInvoiceProductListRouteGroups(layout),
      }),
    onSuccess: async (preset) => {
      setNewName('')
      setError(null)
      await invalidate(preset)
    },
    onError: showError,
  })

  const renameMutation = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error('동선을 고르세요.')
      return updateInvoicePickingRoutePreset(selected.id, { name: editName })
    },
    onSuccess: async (preset) => {
      setError(null)
      await invalidate(preset)
    },
    onError: showError,
  })

  const overwriteMutation = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error('동선을 고르세요.')
      return updateInvoicePickingRoutePreset(selected.id, {
        routeGroups: serializeInvoiceProductListRouteGroups(layout),
      })
    },
    onSuccess: async (preset) => {
      setError(null)
      await invalidate(preset)
    },
    onError: showError,
  })

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error('동선을 고르세요.')
      return deleteInvoicePickingRoutePreset(selected.id)
    },
    onSuccess: async () => {
      setSelectedId(null)
      setEditName('')
      setError(null)
      await invalidate()
    },
    onError: showError,
  })

  const busy =
    createMutation.isPending ||
    renameMutation.isPending ||
    overwriteMutation.isPending ||
    deleteMutation.isPending

  function applySelected() {
    if (!selected) return
    onApplyLayout(
      applyInvoiceProductListRoutePreset(groups, zone, selected.routeGroups),
    )
  }

  function handleDelete() {
    if (!selected) return
    const ok = window.confirm(`"${selected.name}" 동선을 삭제할까요?`)
    if (!ok) return
    deleteMutation.mutate()
  }

  return (
    <div className="space-y-2 rounded-lg border border-border p-2">
      <div>
        <p className="text-xs font-medium">동선 사전</p>
        <p className="text-[11px] text-muted-foreground">
          이 창고에 저장한 이름 있는 동선입니다. 고른 뒤 바로 분해하거나
          지금 카드를 저장합니다.
        </p>
      </div>

      <div className="space-y-1">
        {presetsQuery.isPending ? (
          <p className="px-1 py-2 text-[11px] text-muted-foreground">
            동선을 불러오는 중…
          </p>
        ) : presetsQuery.isError ? (
          <p className="px-1 py-2 text-[11px] text-warning">
            {presetsQuery.error instanceof Error
              ? presetsQuery.error.message
              : '동선 사전을 불러오지 못했습니다.'}
          </p>
        ) : presets.length === 0 ? (
          <p className="px-1 py-2 text-[11px] text-muted-foreground">
            저장한 동선이 없습니다.
          </p>
        ) : (
          presets.map((preset) => {
            const selectedRow = preset.id === selectedId
            return (
              <button
                key={preset.id}
                type="button"
                aria-pressed={selectedRow}
                onClick={() => {
                  setSelectedId(preset.id)
                  setError(null)
                }}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left text-xs',
                  selectedRow
                    ? 'border-primary/40 bg-primary/10 text-foreground'
                    : 'border-border text-muted-foreground hover:bg-muted/50',
                )}
              >
                <span className="min-w-0 truncate font-medium">
                  {preset.name}
                </span>
                <span className="shrink-0 tabular-nums">
                  {preset.routeGroups.length}카드
                </span>
              </button>
            )
          })
        )}
      </div>

      <Button
        type="button"
        size="sm"
        disabled={!selected}
        onClick={applySelected}
      >
        이 동선으로 분해
      </Button>

      <form
        className="space-y-1.5"
        onSubmit={(event) => {
          event.preventDefault()
          if (!newName.trim()) return
          createMutation.mutate()
        }}
      >
        <p className="text-[11px] font-medium">새 동선</p>
        <div className="flex gap-1.5">
          <Input
            value={newName}
            onChange={(event) => {
              setNewName(event.target.value)
              setError(null)
            }}
            placeholder="예: 출고 기본"
            className="h-8 text-xs"
          />
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={busy || !newName.trim()}
          >
            저장
          </Button>
        </div>
      </form>

      {selected ? (
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium">선택한 동선</p>
          <div className="flex gap-1.5">
            <Input
              value={editName}
              onChange={(event) => {
                setEditName(event.target.value)
                setError(null)
              }}
              className="h-8 text-xs"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy || !editName.trim() || editName.trim() === selected.name}
              onClick={() => renameMutation.mutate()}
            >
              이름 수정
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => overwriteMutation.mutate()}
            >
              현재 카드로 저장
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={handleDelete}
            >
              삭제
            </Button>
          </div>
        </div>
      ) : null}

      {error ? <p className="text-[11px] text-warning">{error}</p> : null}
    </div>
  )
}
