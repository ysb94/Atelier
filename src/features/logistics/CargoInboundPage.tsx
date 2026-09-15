import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import {
  CalendarClock,
  MapPin,
  Package,
  Plus,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { useCompanyBrandScope } from '@/components/layout/company-brand-scope'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { CargoInboundAddPanel } from '@/features/logistics/CargoInboundAddPanel'
import type { CargoInboundRegisterPayload } from '@/features/logistics/CargoInboundAddPanel'
import { CargoInboundDetailPanel } from '@/features/logistics/CargoInboundDetailPanel'
import { formatCargoInboundTitle } from '@/features/logistics/cargo-inbound-title'
import {
  getCargoInbounds,
  saveCargoInbound,
  scheduleCargoInbound,
  type CargoInboundShipment,
} from '@/lib/api'
import type { CargoInboundStage } from '@/lib/cargo/inbound'
import { useRenderWatch } from '@/lib/diagnostics'
import { companyQueryKey } from '@/lib/workspace/query-keys'
import { cn, formatNumber } from '@/lib/utils'

type CargoInboundItem = CargoInboundShipment & {
  brandName: string
  productCount: number
  boxCount: number
  totalQty: number
  previewNames: string[]
}

const INBOUND_TABS: {
  value: CargoInboundStage
  label: string
  description: string
}[] = [
  {
    value: 'shipped',
    label: '선적됨',
    description: '선적은 끝났지만 입고 날짜는 아직 없는 화물',
  },
  {
    value: 'scheduled',
    label: '입고일 협의',
    description: '항구에서 연락이 와 입고 날짜를 맞춘 화물',
  },
  {
    value: 'done',
    label: '완료',
    description: '제품 정리와 창고 자리 입력이 끝난 화물',
  },
]

function parseCount(value: string) {
  const parsed = Number(value.replaceAll(',', '').trim())
  return Number.isFinite(parsed) ? parsed : 0
}

function isInboundStage(value: string | null): value is CargoInboundStage {
  return INBOUND_TABS.some((tab) => tab.value === value)
}

function formatDate(value: string | null) {
  if (!value) return '-'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).format(date)
}

function stageEmptyMessage(stage: CargoInboundStage) {
  if (stage === 'shipped') return '선적만 끝난 화물이 없습니다.'
  if (stage === 'scheduled') return '입고 날짜가 협의된 화물이 없습니다.'
  return '정리가 끝난 화물이 없습니다.'
}

export function CompanyCargoInboundPage() {
  useRenderWatch('CompanyCargoInboundPage')
  const queryClient = useQueryClient()
  const { brands, brandById } = useCompanyBrandScope()
  const [searchParams, setSearchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const brandIds = useMemo(() => brands.map((brand) => brand.id), [brands])
  const cargoQueryKey = companyQueryKey('cargo-inbounds', brandIds)
  const cargoQuery = useQuery({
    queryKey: cargoQueryKey,
    queryFn: () => getCargoInbounds(brandIds),
    enabled: brandIds.length > 0,
  })
  const registerMutation = useMutation({ mutationFn: saveCargoInbound })
  const scheduleMutation = useMutation({
    mutationFn: (input: {
      brandId: string
      shipmentId: string
      inboundDate: string
      note: string
    }) =>
      scheduleCargoInbound(
        input.brandId,
        input.shipmentId,
        input.inboundDate,
        input.note,
      ),
  })
  const items = useMemo<CargoInboundItem[]>(
    () =>
      (cargoQuery.data ?? []).map((item) => ({
        ...item,
        brandName: brandById.get(item.brandId)?.name ?? '알 수 없는 브랜드',
        productCount: item.lines.length,
        boxCount: item.lines.reduce(
          (sum, row) => sum + parseCount(row.boxes),
          0,
        ),
        totalQty: item.lines.reduce(
          (sum, row) => sum + parseCount(row.qty),
          0,
        ),
        previewNames: item.lines
          .map((row) => row.name.trim() || row.styleNo.trim())
          .filter(Boolean)
          .slice(0, 3),
      })),
    [brandById, cargoQuery.data],
  )
  const requested = searchParams.get('tab')
  const activeTab: CargoInboundStage = isInboundStage(requested)
    ? requested
    : 'shipped'
  const activeMeta = INBOUND_TABS.find((tab) => tab.value === activeTab)!
  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId],
  )

  const tabCounts = useMemo(() => {
    const counts: Record<CargoInboundStage, number> = {
      shipped: 0,
      scheduled: 0,
      done: 0,
    }
    for (const item of items) counts[item.stage] += 1
    return counts
  }, [items])

  const rows = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return items.filter((item) => item.stage === activeTab).filter((item) => {
      if (!keyword) return true
      return [
        item.brandName,
        item.shipmentNo,
        formatCargoInboundTitle(item.shippedAt, item.boxCount),
        item.vesselName,
        item.originPort,
        item.portContactNote ?? '',
        item.warehouseSummary ?? '',
        ...item.previewNames,
      ]
        .join(' ')
        .toLowerCase()
        .includes(keyword)
    })
  }, [activeTab, items, search])

  function selectTab(tab: CargoInboundStage) {
    setAdding(false)
    setSelectedId(null)
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (tab === 'shipped') next.delete('tab')
      else next.set('tab', tab)
      return next
    })
  }

  async function handleRegister(payload: CargoInboundRegisterPayload) {
    await registerMutation.mutateAsync(payload)
    await queryClient.invalidateQueries({ queryKey: ['cargo-inbounds'] })
    setAdding(false)
    setSelectedId(null)
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.delete('tab')
      return next
    })
  }

  async function handleSaveInboundDate(inboundDate: string, note: string) {
    if (!selectedItem) return
    await scheduleMutation.mutateAsync({
      brandId: selectedItem.brandId,
      shipmentId: selectedItem.id,
      inboundDate,
      note,
    })
    await queryClient.invalidateQueries({ queryKey: ['cargo-inbounds'] })
    setSelectedId(null)
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.set('tab', 'scheduled')
      return next
    })
  }

  return (
    <div>
      <PageHeader
        title="화물 입고"
        description="선적된 화물부터 입고일 협의, 창고 자리 정리까지 단계별로 봅니다."
      />

      {adding ? (
        <CargoInboundAddPanel
          brands={brands}
          onCancel={() => setAdding(false)}
          onRegister={handleRegister}
        />
      ) : selectedItem ? (
        <CargoInboundDetailPanel
          item={selectedItem}
          onBack={() => setSelectedId(null)}
          onSaveInboundDate={handleSaveInboundDate}
        />
      ) : (
        <>
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              className="sm:max-w-xs"
              placeholder="선적일, 브랜드, 선박, 항구 검색..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div className="text-sm text-muted-foreground sm:ml-auto">
              {activeMeta.label} {formatNumber(rows.length)}건
            </div>
          </div>

          <div
            role="tablist"
            aria-label="화물 입고 단계"
            className="mb-2 flex items-stretch gap-0.5 border-b border-border"
          >
            {INBOUND_TABS.map((tab) => {
              const selected = tab.value === activeTab
              return (
                <button
                  key={tab.value}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => selectTab(tab.value)}
                  className={cn(
                    '-mb-px border-b-2 px-3 py-1.5 text-sm transition-colors',
                    selected
                      ? 'border-foreground font-medium text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  {tab.label} {formatNumber(tabCounts[tab.value])}
                </button>
              )
            })}
          </div>
          <p className="mb-4 text-xs text-muted-foreground">
            {activeMeta.description}
          </p>

          {cargoQuery.isError ? (
            <Card className="px-4 py-10 text-center text-sm text-danger">
              {cargoQuery.error instanceof Error
                ? cargoQuery.error.message
                : '화물 입고 목록을 불러오지 못했습니다.'}
            </Card>
          ) : cargoQuery.isLoading ? (
            <Card className="px-4 py-10 text-center text-sm text-muted-foreground">
              화물 입고 목록을 불러오는 중...
            </Card>
          ) : rows.length === 0 ? (
            <Card className="px-4 py-10 text-center text-sm text-muted-foreground">
              {search.trim()
                ? '조건에 맞는 화물이 없습니다.'
                : stageEmptyMessage(activeTab)}
            </Card>
          ) : (
            <div className="space-y-2">
              {rows.map((item) => (
                <CargoInboundRow
                  key={item.id}
                  item={item}
                  onOpen={() => setSelectedId(item.id)}
                />
              ))}
            </div>
          )}

          {activeTab === 'shipped' ? (
            <div className="mt-3">
              <Button
                type="button"
                variant="outline"
                className="w-full border-dashed"
                disabled={brands.length === 0}
                onClick={() => setAdding(true)}
              >
                <Plus className="size-3.5" />
                화물 추가
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

function CargoInboundRow({
  item,
  onOpen,
}: {
  item: CargoInboundItem
  onOpen: () => void
}) {
  return (
    <Card className="shadow-none">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full flex-col gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30 lg:flex-row lg:items-start lg:justify-between"
      >
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold tracking-tight">
              {formatCargoInboundTitle(item.shippedAt, item.boxCount)}
            </p>
            <Badge variant="muted">{item.brandName}</Badge>
            {item.stage === 'shipped' ? (
              <Badge variant="warning">입고일 미정</Badge>
            ) : null}
            {item.stage === 'scheduled' ? (
              <Badge variant="outline">입고일 확정</Badge>
            ) : null}
            {item.stage === 'done' ? (
              <Badge variant="success">정리 완료</Badge>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Package className="size-3.5" />
              상품 {formatNumber(item.productCount)} · 박스{' '}
              {formatNumber(item.boxCount)}
            </span>
            <span>선적일 {formatDate(item.shippedAt)}</span>
          </div>

          {item.stage === 'scheduled' ? (
            <div className="space-y-1 text-sm">
              <p className="inline-flex items-center gap-1.5 font-medium">
                <CalendarClock className="size-3.5 text-primary" />
                입고 예정 {formatDate(item.scheduledInboundAt)}
              </p>
              {item.portContactNote ? (
                <p className="text-muted-foreground">{item.portContactNote}</p>
              ) : null}
            </div>
          ) : null}

          {item.stage === 'done' ? (
            <div className="space-y-1 text-sm">
              <p className="inline-flex items-center gap-1.5 font-medium">
                <MapPin className="size-3.5 text-primary" />
                {item.warehouseSummary ?? '창고 자리 입력 완료'}
              </p>
              <p className="text-muted-foreground">
                입고 {formatDate(item.scheduledInboundAt)} · 정리 완료{' '}
                {formatDate(item.completedAt)}
              </p>
            </div>
          ) : null}
        </div>

        <div className="shrink-0 text-xs text-muted-foreground lg:text-right">
          {item.stage === 'shipped'
            ? '작업 열기'
            : item.stage === 'scheduled'
              ? '다음: 제품 정리·자리 입력'
              : '완료'}
        </div>
      </button>
    </Card>
  )
}
