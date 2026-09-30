import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import {
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  MessageSquareText,
  Plus,
  Ship,
  Trash2,
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
import {
  formatCargoInboundTitle,
  formatInboundBoxJob,
  thisWeekWorkdays,
} from '@/features/logistics/cargo-inbound-title'
import {
  deleteCargoInbound,
  getCargoInbounds,
  saveCargoInbound,
  saveCargoInboundRequestNotes,
  saveCargoInboundTidyRows,
  saveCargoInboundTidySlots,
  scheduleCargoInbound,
  type CargoInboundShipment,
  type CargoInboundTidySlotInput,
} from '@/lib/api'
import type { CargoLineListValues } from '@/lib/cargo/line-list'
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
  const hasTime = value.includes('T')
  const date = new Date(hasTime ? value : `${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  const day = new Intl.DateTimeFormat('ko-KR', {
    month: 'numeric',
    day: 'numeric',
  }).format(date)
  if (!hasTime) return day
  const time = new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date)
  return `${day} ${time}`
}

function formatGroupDate(value: string) {
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  }).format(date)
}

function formatMonthLabel(value: string) {
  const date = new Date(`${value.slice(0, 7)}-01T00:00:00`)
  if (Number.isNaN(date.getTime())) return value.slice(0, 7) || '입고일 미정'
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long',
  }).format(date)
}

function groupByMonth(groups: Array<{ date: string; items: CargoInboundItem[] }>) {
  const months: Array<{
    key: string
    label: string
    count: number
    groups: Array<{ date: string; items: CargoInboundItem[] }>
  }> = []
  for (const group of groups) {
    const key = group.date.slice(0, 7)
    const last = months.at(-1)
    if (last && last.key === key) {
      last.groups.push(group)
      last.count += group.items.length
    } else {
      months.push({
        key,
        label: group.date ? formatMonthLabel(group.date) : '입고일 미정',
        count: group.items.length,
        groups: [group],
      })
    }
  }
  return months
}

function groupByInboundDate(items: CargoInboundItem[], newestFirst = false) {
  const direction = newestFirst ? -1 : 1
  const sorted = [...items].sort((a, b) => {
    const dateA = a.scheduledInboundAt ?? ''
    const dateB = b.scheduledInboundAt ?? ''
    if (dateA !== dateB) return dateA.localeCompare(dateB) * direction
    return (a.shippedAt ?? '').localeCompare(b.shippedAt ?? '') * direction
  })
  const groups: Array<{ date: string; items: CargoInboundItem[] }> = []
  for (const item of sorted) {
    const date = item.scheduledInboundAt ?? ''
    const last = groups.at(-1)
    if (last && last.date === date) last.items.push(item)
    else groups.push({ date, items: [item] })
  }
  return groups
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
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [collapsedMonths, setCollapsedMonths] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
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
  const requestNotesMutation = useMutation({
    mutationFn: (input: {
      brandId: string
      notes: Array<{ lineId: string; requestNote: string }>
    }) => saveCargoInboundRequestNotes(input.brandId, input.notes),
  })
  const saveTidyRowsMutation = useMutation({
    mutationFn: (input: {
      brandId: string
      shipmentId: string
      rows: readonly CargoLineListValues[]
    }) =>
      saveCargoInboundTidyRows(input.brandId, input.shipmentId, input.rows),
  })
  const saveTidySlotsMutation = useMutation({
    mutationFn: (input: {
      brandId: string
      shipmentId: string
      slots: readonly CargoInboundTidySlotInput[]
      complete: boolean
    }) =>
      saveCargoInboundTidySlots(
        input.brandId,
        input.shipmentId,
        input.slots,
        input.complete,
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
  const inboundGroups = useMemo(
    () =>
      activeTab === 'shipped' ? null : groupByInboundDate(rows, activeTab === 'done'),
    [activeTab, rows],
  )
  const monthGroups = useMemo(
    () => (inboundGroups ? groupByMonth(inboundGroups) : null),
    [inboundGroups],
  )
  function toggleMonth(key: string) {
    setCollapsedMonths((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  const weekDays = useMemo(() => thisWeekWorkdays(), [])
  const weekInbound = useMemo(() => {
    const map = new Map(weekDays.map((day) => [day.key, [] as CargoInboundItem[]]))
    for (const item of items) {
      if (item.stage === 'shipped' || !item.scheduledInboundAt) continue
      map.get(item.scheduledInboundAt)?.push(item)
    }
    for (const jobs of map.values()) {
      jobs.sort((left, right) => {
        if (left.stage === right.stage) return 0
        return left.stage === 'done' ? 1 : -1
      })
    }
    return map
  }, [items, weekDays])

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

  async function handleSaveRequestNotes(
    notes: Array<{ lineId: string; requestNote: string }>,
  ) {
    if (!selectedItem) return
    await requestNotesMutation.mutateAsync({
      brandId: selectedItem.brandId,
      notes,
    })
    await queryClient.invalidateQueries({ queryKey: ['cargo-inbounds'] })
  }

  async function handleDelete(item: CargoInboundItem) {
    const title = formatCargoInboundTitle(item.shippedAt, item.boxCount)
    const extra =
      item.stage === 'shipped'
        ? ''
        : '\n입고일과 정리 기록도 함께 지워집니다.'
    if (
      !window.confirm(
        `"${title}" (${item.brandName})을 삭제할까요?\n상품 ${formatNumber(item.productCount)}개, 박스 ${formatNumber(item.boxCount)}개가 함께 지워지며 되돌릴 수 없습니다.${extra}`,
      )
    ) {
      return
    }

    setDeleteError(null)
    setDeletingId(item.id)
    try {
      await deleteCargoInbound(item.brandId, item.id)
      if (selectedId === item.id) setSelectedId(null)
      await queryClient.invalidateQueries({ queryKey: ['cargo-inbounds'] })
    } catch (error) {
      console.warn('[cargo-inbound] 선적 삭제 실패', {
        shipmentId: item.id,
        brandId: item.brandId,
        error,
      })
      setDeleteError(
        error instanceof Error
          ? error.message
          : '화물 선적을 삭제하지 못했습니다.',
      )
    } finally {
      setDeletingId(null)
    }
  }

  async function handleSaveTidyRows(rows: readonly CargoLineListValues[]) {
    if (!selectedItem) return
    await saveTidyRowsMutation.mutateAsync({
      brandId: selectedItem.brandId,
      shipmentId: selectedItem.id,
      rows,
    })
    await queryClient.invalidateQueries({ queryKey: ['cargo-inbounds'] })
    await queryClient.invalidateQueries({ queryKey: ['cargo-inbound-tidy'] })
  }

  async function handleSaveTidySlots(
    slots: readonly CargoInboundTidySlotInput[],
    complete: boolean,
  ) {
    if (!selectedItem) return
    await saveTidySlotsMutation.mutateAsync({
      brandId: selectedItem.brandId,
      shipmentId: selectedItem.id,
      slots,
      complete,
    })
    await queryClient.invalidateQueries({ queryKey: ['cargo-inbounds'] })
    await queryClient.invalidateQueries({ queryKey: ['cargo-inbound-tidy'] })
    if (!complete) return
    setSelectedId(null)
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.set('tab', 'done')
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
          deleting={deletingId === selectedItem.id}
          onBack={() => setSelectedId(null)}
          onDelete={() => handleDelete(selectedItem)}
          onSaveInboundDate={handleSaveInboundDate}
          onSaveRequestNotes={handleSaveRequestNotes}
          onSaveTidyRows={handleSaveTidyRows}
          onSaveTidySlots={handleSaveTidySlots}
        />
      ) : (
        <>
          <div
            className="mb-4 grid grid-cols-5 gap-2"
            aria-label="이번 주 입고 예정"
          >
            {weekDays.map((day) => {
              const jobs = weekInbound.get(day.key) ?? []
              const totalBoxes = jobs.reduce((sum, item) => sum + item.boxCount, 0)
              const summary = jobs.length
                ? jobs
                    .map((item) =>
                      item.stage === 'done'
                        ? `완료 ${formatNumber(item.boxCount)}박스`
                        : formatInboundBoxJob(item.boxCount),
                    )
                    .join(', ')
                : '없음'
              return (
                <div
                  key={day.key}
                  aria-label={`${day.weekday} ${day.day}일 ${summary}${totalBoxes ? `, 총 ${formatNumber(totalBoxes)}박스` : ''}`}
                  className={cn(
                    'rounded-xl border border-border bg-card px-3 py-2.5',
                    day.isToday && 'border-success',
                  )}
                >
                  <div className="flex items-baseline justify-between gap-1">
                    <span className="text-sm font-semibold tabular-nums">
                      <span className="mr-1 text-xs font-normal text-muted-foreground">
                        {day.weekday}
                      </span>
                      {day.day}
                    </span>
                    {totalBoxes > 0 ? (
                      <span className="text-xs font-medium tabular-nums text-muted-foreground">
                        총 {formatNumber(totalBoxes)}박스
                      </span>
                    ) : null}
                  </div>
                  {jobs.length ? (
                    <ul className="mt-1.5 space-y-1.5">
                      {jobs.map((item) => {
                        const done = item.stage === 'done'
                        return (
                          <li
                            key={item.id}
                            className={cn(
                              'flex min-w-0 items-baseline justify-between gap-2 rounded-lg border px-2 py-1.5',
                              done
                                ? 'border-success/40 bg-success/10'
                                : 'border-border bg-background shadow-sm',
                            )}
                          >
                            <p className="truncate text-lg font-semibold leading-6 tabular-nums tracking-tight">
                              {formatNumber(item.boxCount)}
                              <span className="ml-0.5 text-xs font-medium text-muted-foreground">
                                박스
                              </span>
                            </p>
                            <p
                              className={cn(
                                'shrink-0 text-[11px] leading-4',
                                done
                                  ? 'font-medium text-success'
                                  : 'text-muted-foreground',
                              )}
                            >
                              {done ? '완료' : '입고 확정'}
                            </p>
                          </li>
                        )
                      })}
                    </ul>
                  ) : (
                    <p className="mt-1.5 text-xs text-muted-foreground">없음</p>
                  )}
                </div>
              )
            })}
          </div>

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
          <p className="mb-3 text-xs text-muted-foreground">
            {activeMeta.description}
          </p>
          {deleteError ? (
            <p className="mb-3 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
              {deleteError}
            </p>
          ) : null}

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
          ) : monthGroups ? (
            <div className="space-y-6">
              {monthGroups.map((month) => {
                const monthKey = `${activeTab}:${month.key || 'undated'}`
                const collapsed =
                  !search.trim() && collapsedMonths.has(monthKey)
                return (
                  <section key={monthKey}>
                    <h3>
                      <button
                        type="button"
                        aria-expanded={!collapsed}
                        onClick={() => toggleMonth(monthKey)}
                        className="flex w-full items-center gap-2 text-left"
                      >
                        <ChevronDown
                          className={cn(
                            'size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-out motion-reduce:transition-none',
                            collapsed && '-rotate-90',
                          )}
                        />
                        <span className="text-sm font-semibold">
                          {month.label}
                        </span>
                        <span className="h-px min-w-8 flex-1 bg-border" aria-hidden />
                        <span className="shrink-0 text-xs font-normal text-muted-foreground">
                          {formatNumber(month.count)}건
                        </span>
                      </button>
                    </h3>
                    <div
                      className={cn(
                        'grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none',
                        collapsed
                          ? 'grid-rows-[0fr] opacity-0'
                          : 'grid-rows-[1fr] opacity-100',
                      )}
                    >
                      <div
                        className="overflow-hidden"
                        inert={collapsed ? true : undefined}
                        aria-hidden={collapsed}
                      >
                        <div className="space-y-6 pt-4">
                        {month.groups.map((group) => (
                          <section
                            key={group.date || 'undated'}
                            className="space-y-2"
                          >
                            <h4 className="flex items-center gap-3 text-sm font-semibold">
                              <span className="inline-flex items-center gap-1.5">
                                <CalendarClock className="size-4 text-primary" />
                                {activeTab === 'done' ? '입고' : '입고 예정'}{' '}
                                {group.date ? formatGroupDate(group.date) : '미정'}
                              </span>
                              <span
                                className="h-px min-w-8 flex-1 bg-border"
                                aria-hidden
                              />
                              <span className="shrink-0 text-xs font-normal text-muted-foreground">
                                {formatNumber(group.items.length)}건
                              </span>
                            </h4>
                            {group.items.map((item) => (
                              <CargoInboundRow
                                key={item.id}
                                item={item}
                                deleting={deletingId === item.id}
                                onOpen={() => setSelectedId(item.id)}
                                onDelete={() => handleDelete(item)}
                              />
                            ))}
                          </section>
                        ))}
                        </div>
                      </div>
                    </div>
                  </section>
                )
              })}
            </div>
          ) : (
            <div className="space-y-2">
              {rows.map((item) => (
                <CargoInboundRow
                  key={item.id}
                  item={item}
                  deleting={deletingId === item.id}
                  onOpen={() => setSelectedId(item.id)}
                  onDelete={() => handleDelete(item)}
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

const STAGE_ACCENT: Record<CargoInboundStage, string> = {
  shipped: 'bg-warning',
  scheduled: 'bg-primary',
  done: 'bg-success',
}

function parseWarehouseProgress(summary: string) {
  const match = summary.match(/(\d+)\s*\/\s*(\d+)/)
  if (!match) return null
  const filled = Number(match[1])
  const total = Number(match[2])
  if (!Number.isFinite(filled) || !Number.isFinite(total) || total <= 0) return null
  return { filled, total }
}

function previewLabel(item: CargoInboundItem) {
  const names: string[] = []
  for (const name of item.previewNames) {
    if (!names.includes(name)) names.push(name)
  }
  if (names.length === 0) return null
  const more = item.productCount > item.previewNames.length
  return more ? `${names.join(', ')} 등` : names.join(', ')
}

function RowFigure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] leading-4 text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold leading-6 tracking-tight tabular-nums">
        {value}
      </p>
    </div>
  )
}

function WarehouseProgress({
  filled,
  total,
}: {
  filled: number
  total: number
}) {
  const complete = filled >= total
  const ratio = Math.min(100, Math.max(0, (filled / total) * 100))
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 text-[11px] text-muted-foreground">창고 자리</span>
      <span
        className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={filled}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={`창고 자리 ${formatNumber(filled)}/${formatNumber(total)}`}
      >
        <span
          className={cn(
            'block h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none',
            complete ? 'bg-success' : 'bg-warning',
          )}
          style={{ width: `${ratio}%` }}
        />
      </span>
      <span
        className={cn(
          'shrink-0 text-xs font-medium tabular-nums',
          complete ? 'text-success' : 'text-warning',
        )}
      >
        {formatNumber(filled)}/{formatNumber(total)}
      </span>
    </div>
  )
}

function CargoInboundStageStatus({ item }: { item: CargoInboundItem }) {
  if (item.stage === 'done') {
    const progress = parseWarehouseProgress(item.warehouseSummary)
    return (
      <div className="min-w-0 space-y-1.5">
        <p className="flex min-w-0 items-center gap-1.5 text-sm text-success">
          <CheckCircle2 className="size-4 shrink-0" />
          <span className="truncate">
            정리 완료 · {formatDate(item.completedAt)}
          </span>
        </p>
        {progress ? (
          <WarehouseProgress filled={progress.filled} total={progress.total} />
        ) : (
          <p className="truncate text-xs text-muted-foreground">
            {item.warehouseSummary.trim() || '입력 완료'}
          </p>
        )}
      </div>
    )
  }
  if (item.stage === 'scheduled') {
    return (
      <div className="min-w-0 space-y-1">
        <p className="truncate text-sm font-medium">
          다음: 제품 정리 · 창고 자리 입력
        </p>
        {item.portContactNote ? (
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <MessageSquareText className="size-3.5 shrink-0" />
            <span className="truncate">{item.portContactNote}</span>
          </p>
        ) : null}
      </div>
    )
  }
  return (
    <div className="min-w-0 space-y-1">
      <p className="flex items-center gap-1.5 text-sm text-warning">
        <Ship className="size-4 shrink-0" />
        입고일 미정
      </p>
      <p className="text-xs text-muted-foreground">
        항구 연락 오면 열어서 입고일 입력
      </p>
    </div>
  )
}

function CargoInboundRow({
  item,
  deleting,
  onOpen,
  onDelete,
}: {
  item: CargoInboundItem
  deleting: boolean
  onOpen: () => void
  onDelete: () => void
}) {
  const preview = previewLabel(item)
  return (
    <Card className="group relative overflow-hidden shadow-none transition-[border-color,box-shadow] duration-200 hover:border-foreground/20 hover:shadow-md motion-reduce:transition-none">
      <span
        aria-hidden
        className={cn('absolute inset-y-0 left-0 w-1', STAGE_ACCENT[item.stage])}
      />
      <div className="flex items-center gap-1 py-3 pr-2 pl-4">
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="grid min-w-0 flex-1 gap-x-6 gap-y-2 md:grid-cols-[minmax(0,1fr)_8rem_15rem] md:items-center">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-tight">
                {formatCargoInboundTitle(item.shippedAt, item.boxCount)}
              </p>
              <p className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                <Badge variant="muted" className="shrink-0">
                  {item.brandName}
                </Badge>
                {preview ? <span className="truncate">{preview}</span> : null}
              </p>
            </div>
            <div className="flex gap-4">
              <RowFigure label="상품" value={formatNumber(item.productCount)} />
              <RowFigure label="박스" value={formatNumber(item.boxCount)} />
            </div>
            <CargoInboundStageStatus item={item} />
          </div>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
        </button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={deleting ? '삭제 중' : '삭제'}
          title="삭제"
          className="shrink-0 text-muted-foreground hover:bg-danger/10 hover:text-danger"
          disabled={deleting}
          onClick={onDelete}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </Card>
  )
}
