import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, ChevronRight, Search, X } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { useBrand } from '@/components/layout/brand-context'
import { WorkspaceTabOverlay } from '@/components/layout/workspace-tabs'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input, Select } from '@/components/ui/input'
import { getCodeUsageTargets, getOutboundShipments } from '@/lib/api'
import { outboundPartnerOptionLabel } from '@/lib/codes/outbound-partner'
import {
  buildProductOutboundSummary,
  demoEconomicsForStyle,
  filterShipmentsByRange,
  formatOutboundDateHeader,
  formatWon,
  listOutboundDateColumns,
  listOutboundStyleRows,
  PRODUCT_OUTBOUND_UPDATED_EVENT,
  purgeDemoProductOutboundShipments,
  quantityByShippedOn,
  summarizeOutboundFinance,
  summarizeOutboundFinanceByPartner,
  type OutboundPartnerFinanceRow,
  type OutboundStyleRow,
  type ProductOutboundPartnerTotal,
  type ProductOutboundShipment,
  type ProductOutboundSummary,
} from '@/lib/outbound/product-outbound'
import type { CodeUsageTarget } from '@/lib/types'
import { cn, formatNumber } from '@/lib/utils'

type ViewMode = 'outbound' | 'profit'
type DatePreset = '7d' | '30d' | 'month' | 'last_month' | 'all'

const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: '7d', label: '최근 7일' },
  { value: '30d', label: '최근 30일' },
  { value: 'month', label: '이번 달' },
  { value: 'last_month', label: '지난 달' },
  { value: 'all', label: '전체' },
]

function toIsoDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function rangeForPreset(preset: DatePreset): { from: string; to: string } {
  const today = new Date()
  today.setHours(12, 0, 0, 0)
  const to = toIsoDate(today)
  if (preset === 'all') return { from: '', to: '' }
  if (preset === '7d') {
    const from = new Date(today)
    from.setDate(from.getDate() - 6)
    return { from: toIsoDate(from), to }
  }
  if (preset === '30d') {
    const from = new Date(today)
    from.setDate(from.getDate() - 29)
    return { from: toIsoDate(from), to }
  }
  if (preset === 'month') {
    const from = new Date(today.getFullYear(), today.getMonth(), 1)
    return { from: toIsoDate(from), to }
  }
  const firstThisMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  const lastPrev = new Date(firstThisMonth)
  lastPrev.setDate(0)
  const firstPrev = new Date(lastPrev.getFullYear(), lastPrev.getMonth(), 1)
  return { from: toIsoDate(firstPrev), to: toIsoDate(lastPrev) }
}

function emptySummary(style: OutboundStyleRow): ProductOutboundSummary {
  return buildProductOutboundSummary(
    { id: style.styleId, styleNo: style.styleNo, name: style.styleName },
    [],
  )
}

function KpiCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string
  value: string
  hint?: string
  tone?: 'default' | 'success' | 'danger' | 'muted'
}) {
  return (
    <Card className="shadow-none">
      <CardContent className="p-4">
        <p
          className={cn(
            'text-xl font-semibold tabular-nums tracking-tight sm:text-2xl',
            tone === 'success' && 'text-success',
            tone === 'danger' && 'text-danger',
            tone === 'muted' && 'text-muted-foreground',
          )}
        >
          {value}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{label}</p>
        {hint ? (
          <p className="mt-1 text-[10px] leading-4 text-muted-foreground/80">
            {hint}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

const PARTNER_LINE_COLORS = [
  '#0f766e',
  '#b45309',
  '#1d4ed8',
  '#be123c',
  '#15803d',
  '#c2410c',
  '#0e7490',
  '#a16207',
  '#1e3a8a',
  '#9f1239',
]

const TOTAL_LINE_ID = '__total__'
const TOTAL_LINE_COLOR = '#171717'

function partnerLineColor(index: number) {
  return PARTNER_LINE_COLORS[index % PARTNER_LINE_COLORS.length]!
}

function PartnerOutboundChart({
  partners,
  shipments,
  dates,
}: {
  partners: ProductOutboundPartnerTotal[]
  shipments: ProductOutboundShipment[]
  dates: string[]
}) {
  const [enabledIds, setEnabledIds] = useState(
    () =>
      new Set([TOTAL_LINE_ID, ...partners.map((partner) => partner.partnerId)]),
  )

  useEffect(() => {
    setEnabledIds(
      new Set([TOTAL_LINE_ID, ...partners.map((partner) => partner.partnerId)]),
    )
  }, [partners])

  const seriesByPartner = useMemo(() => {
    const map = new Map<string, Map<string, number>>()
    for (const partner of partners) {
      map.set(partner.partnerId, new Map())
    }
    for (const row of shipments) {
      let byDate = map.get(row.partnerId)
      if (!byDate) {
        byDate = new Map()
        map.set(row.partnerId, byDate)
      }
      byDate.set(row.shippedOn, (byDate.get(row.shippedOn) ?? 0) + row.quantity)
    }
    return map
  }, [partners, shipments])

  const chartDates = useMemo(() => {
    if (dates.length > 0) return dates
    const set = new Set<string>()
    for (const row of shipments) set.add(row.shippedOn)
    return [...set].sort()
  }, [dates, shipments])

  const totalByDate = useMemo(() => {
    const map = new Map<string, number>()
    for (const row of shipments) {
      map.set(row.shippedOn, (map.get(row.shippedOn) ?? 0) + row.quantity)
    }
    return map
  }, [shipments])

  const totalQuantity = useMemo(() => {
    let sum = 0
    for (const partner of partners) sum += partner.quantity
    return sum
  }, [partners])

  const totalEnabled = enabledIds.has(TOTAL_LINE_ID)
  const enabledPartners = partners.filter((partner) =>
    enabledIds.has(partner.partnerId),
  )

  const maxQty = useMemo(() => {
    let max = 0
    for (const date of chartDates) {
      max = Math.max(max, totalByDate.get(date) ?? 0)
    }
    return max
  }, [chartDates, totalByDate])

  const yMax = Math.max(1, Math.ceil(maxQty * 1.1))
  const width = 640
  const height = 280
  const pad = { top: 16, right: 16, bottom: 36, left: 40 }
  const plotW = width - pad.left - pad.right
  const plotH = height - pad.top - pad.bottom

  function xAt(index: number) {
    if (chartDates.length <= 1) return pad.left + plotW / 2
    return pad.left + (index / (chartDates.length - 1)) * plotW
  }

  function yAt(value: number) {
    return pad.top + plotH - (value / yMax) * plotH
  }

  const yTicks = 4
  const labelStep = Math.max(1, Math.ceil(chartDates.length / 8))

  function toggleSeries(seriesId: string) {
    setEnabledIds((prev) => {
      const next = new Set(prev)
      if (next.has(seriesId)) next.delete(seriesId)
      else next.add(seriesId)
      return next
    })
  }

  if (partners.length === 0 || chartDates.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-8 text-center text-xs text-muted-foreground">
        선택한 기간에 이 상품 출고가 없습니다.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-x-3 gap-y-1.5">
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={totalEnabled}
            onChange={() => toggleSeries(TOTAL_LINE_ID)}
            className="size-3.5 rounded border-border"
          />
          <span
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: TOTAL_LINE_COLOR }}
            aria-hidden
          />
          <span
            className={cn(
              'font-medium text-foreground',
              !totalEnabled && 'text-muted-foreground line-through',
            )}
          >
            총합
          </span>
          <span className="tabular-nums text-muted-foreground">
            ({formatNumber(totalQuantity)})
          </span>
        </label>
        {partners.map((partner, index) => {
          const color = partnerLineColor(index)
          const checked = enabledIds.has(partner.partnerId)
          return (
            <label
              key={partner.partnerId}
              className="inline-flex cursor-pointer items-center gap-1.5 text-xs"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleSeries(partner.partnerId)}
                className="size-3.5 rounded border-border"
              />
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: color }}
                aria-hidden
              />
              <span
                className={cn(
                  'text-foreground',
                  !checked && 'text-muted-foreground line-through',
                )}
              >
                {partner.partnerName}
              </span>
              <span className="tabular-nums text-muted-foreground">
                ({formatNumber(partner.quantity)})
              </span>
            </label>
          )
        })}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-muted/10 px-1 py-2">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-[240px] w-full min-w-[28rem]"
          role="img"
          aria-label="업체별 일자 출고 수량 그래프"
        >
          {Array.from({ length: yTicks + 1 }, (_, i) => {
            const value = (yMax / yTicks) * i
            const y = yAt(value)
            return (
              <g key={i}>
                <line
                  x1={pad.left}
                  x2={width - pad.right}
                  y1={y}
                  y2={y}
                  stroke="currentColor"
                  className="text-border"
                  strokeWidth={1}
                />
                <text
                  x={pad.left - 6}
                  y={y + 3}
                  textAnchor="end"
                  className="fill-muted-foreground text-[10px]"
                >
                  {Math.round(value)}
                </text>
              </g>
            )
          })}

          <line
            x1={pad.left}
            x2={pad.left}
            y1={pad.top}
            y2={height - pad.bottom}
            stroke="currentColor"
            className="text-foreground/40"
            strokeWidth={1.25}
          />
          <line
            x1={pad.left}
            x2={width - pad.right}
            y1={height - pad.bottom}
            y2={height - pad.bottom}
            stroke="currentColor"
            className="text-foreground/40"
            strokeWidth={1.25}
          />

          {chartDates.map((date, index) => {
            if (index % labelStep !== 0 && index !== chartDates.length - 1) {
              return null
            }
            return (
              <text
                key={date}
                x={xAt(index)}
                y={height - 12}
                textAnchor="middle"
                className="fill-muted-foreground text-[10px]"
              >
                {formatOutboundDateHeader(date)}
              </text>
            )
          })}

          {partners.map((partner, partnerIndex) => {
            if (!enabledIds.has(partner.partnerId)) return null
            const byDate = seriesByPartner.get(partner.partnerId)
            const color = partnerLineColor(partnerIndex)
            const points = chartDates.map((date, index) => {
              const qty = byDate?.get(date) ?? 0
              return `${xAt(index)},${yAt(qty)}`
            })
            return (
              <g key={partner.partnerId}>
                <polyline
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  points={points.join(' ')}
                />
                {chartDates.map((date, index) => {
                  const qty = byDate?.get(date) ?? 0
                  if (qty <= 0) return null
                  return (
                    <circle
                      key={`${partner.partnerId}-${date}`}
                      cx={xAt(index)}
                      cy={yAt(qty)}
                      r={3}
                      fill={color}
                    >
                      <title>
                        {partner.partnerName} · {date} ·{' '}
                        {formatNumber(qty)}
                      </title>
                    </circle>
                  )
                })}
              </g>
            )
          })}

          {totalEnabled ? (
            <g>
              <polyline
                fill="none"
                stroke={TOTAL_LINE_COLOR}
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
                points={chartDates
                  .map((date, index) => {
                    const qty = totalByDate.get(date) ?? 0
                    return `${xAt(index)},${yAt(qty)}`
                  })
                  .join(' ')}
              />
              {chartDates.map((date, index) => {
                const qty = totalByDate.get(date) ?? 0
                if (qty <= 0) return null
                return (
                  <circle
                    key={`total-${date}`}
                    cx={xAt(index)}
                    cy={yAt(qty)}
                    r={3.5}
                    fill={TOTAL_LINE_COLOR}
                  >
                    <title>
                      총합 · {date} · {formatNumber(qty)}
                    </title>
                  </circle>
                )
              })}
            </g>
          ) : null}
        </svg>
      </div>

      {!totalEnabled && enabledPartners.length === 0 ? (
        <p className="text-center text-xs text-muted-foreground">
          표시할 선을 체크하세요.
        </p>
      ) : null}
    </div>
  )
}

function ProductDetailDialog({
  mode,
  summary,
  style,
  finance,
  dates,
  onClose,
}: {
  mode: 'outbound' | 'profit'
  summary: ProductOutboundSummary
  style: OutboundStyleRow
  finance: ReturnType<typeof summarizeOutboundFinance> | null
  dates: string[]
  onClose: () => void
}) {
  return (
    <WorkspaceTabOverlay>
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      <button
        type="button"
        aria-label="닫기"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 flex max-h-[min(92vh,880px)] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <p className="font-mono text-xs text-muted-foreground">
              {summary.styleNo}
            </p>
            <h2 className="truncate text-lg font-semibold leading-snug">
              {summary.styleName || '이름 없음'}
            </h2>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge variant="muted">
                출고 {formatNumber(summary.totalQuantity)}
              </Badge>
              {mode === 'outbound' ? (
                <>
                  <Badge variant="muted">
                    업체 {formatNumber(summary.partnerCount)}
                  </Badge>
                  <Badge variant="outline">
                    기록 {formatNumber(summary.shipmentCount)}
                  </Badge>
                </>
              ) : finance ? (
                <>
                  <Badge variant="muted">
                    매출 {formatWon(finance.revenue)}
                  </Badge>
                  <Badge variant="outline">
                    순이익 {formatWon(finance.netProfit)}
                  </Badge>
                </>
              ) : null}
            </div>
            {mode === 'profit' && finance ? (
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <div className="rounded-md border border-border bg-muted/20 px-2.5 py-2">
                  <p className="text-muted-foreground">단가</p>
                  <p className="mt-0.5 font-medium tabular-nums">
                    {formatWon(demoEconomicsForStyle(style.styleNo).unitPrice)}
                  </p>
                </div>
                <div className="rounded-md border border-border bg-muted/20 px-2.5 py-2">
                  <p className="text-muted-foreground">원가</p>
                  <p className="mt-0.5 font-medium tabular-nums">
                    {formatWon(finance.cogs)}
                  </p>
                </div>
                <div className="rounded-md border border-border bg-muted/20 px-2.5 py-2">
                  <p className="text-muted-foreground">수수료</p>
                  <p className="mt-0.5 font-medium tabular-nums">
                    {formatWon(finance.fees)}
                  </p>
                </div>
                <div className="rounded-md border border-border bg-muted/20 px-2.5 py-2">
                  <p className="text-muted-foreground">마진</p>
                  <p className="mt-0.5 font-medium tabular-nums">
                    {finance.marginRate.toFixed(1)}%
                  </p>
                </div>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="닫기"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <h3 className="mb-3 text-sm font-semibold">업체별 출고 추이</h3>
          <PartnerOutboundChart
            partners={summary.partners}
            shipments={summary.shipments}
            dates={dates}
          />
        </div>
      </div>
    </div>
    </WorkspaceTabOverlay>
  )
}

function FilterBar({
  datePreset,
  dateFrom,
  dateTo,
  partnerFilter,
  partners,
  extraPartners,
  search,
  onlyShipped,
  onPreset,
  onFrom,
  onTo,
  onPartner,
  onSearch,
  onOnlyShipped,
}: {
  datePreset: DatePreset
  dateFrom: string
  dateTo: string
  partnerFilter: string
  partners: CodeUsageTarget[]
  extraPartners: OutboundPartnerFinanceRow[]
  search: string
  onlyShipped: boolean
  onPreset: (preset: DatePreset) => void
  onFrom: (value: string) => void
  onTo: (value: string) => void
  onPartner: (value: string) => void
  onSearch: (value: string) => void
  onOnlyShipped: () => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {DATE_PRESETS.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={datePreset === item.value}
            onClick={() => onPreset(item.value)}
            className={cn(
              'rounded-full border px-2.5 py-1 text-xs',
              datePreset === item.value
                ? 'border-primary/40 bg-primary/10 text-foreground'
                : 'border-border text-muted-foreground hover:bg-muted/40',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="date"
          value={dateFrom}
          onChange={(event) => onFrom(event.target.value)}
          aria-label="시작일"
          className="h-8 w-[9.75rem] text-xs"
        />
        <span className="text-xs text-muted-foreground">~</span>
        <Input
          type="date"
          value={dateTo}
          onChange={(event) => onTo(event.target.value)}
          aria-label="종료일"
          className="h-8 w-[9.75rem] text-xs"
        />
        <Select
          value={partnerFilter}
          onChange={(event) => onPartner(event.target.value)}
          aria-label="출고업체"
          className="h-8 min-w-[10rem] flex-1 text-xs sm:max-w-[16rem]"
        >
          <option value="">전체 업체</option>
          {partners.map((partner) => (
            <option key={partner.id} value={partner.id}>
              {outboundPartnerOptionLabel(partner)}
            </option>
          ))}
          {extraPartners
            .filter(
              (row) =>
                !partners.some((partner) => partner.id === row.partnerId),
            )
            .map((row) => (
              <option key={row.partnerId} value={row.partnerId}>
                {row.partnerName}
              </option>
            ))}
        </Select>
        <div className="relative min-w-[10rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="M번호·상품명"
            className="h-8 pl-8 text-xs"
          />
        </div>
        <button
          type="button"
          aria-pressed={onlyShipped}
          onClick={onOnlyShipped}
          className={cn(
            'rounded-full border px-2.5 py-1.5 text-xs',
            onlyShipped
              ? 'border-primary/40 bg-primary/10 text-foreground'
              : 'border-border text-muted-foreground hover:bg-muted/40',
          )}
        >
          출고 있음만
        </button>
      </div>
    </div>
  )
}

type OutboundSortKey = 'name' | 'total' | `date:${string}`

function OutboundSortHeader({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
  align = 'left',
  title,
  className,
}: {
  label: string
  sortKey: OutboundSortKey
  activeKey: OutboundSortKey
  direction: 'asc' | 'desc'
  onSort: (key: OutboundSortKey) => void
  align?: 'left' | 'right'
  title?: string
  className?: string
}) {
  const active = activeKey === sortKey
  return (
    <th
      title={title}
      className={cn(
        'whitespace-nowrap border-b border-border bg-muted/40 px-2 py-1.5 font-medium',
        align === 'right' && 'text-right',
        className,
      )}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          'inline-flex items-center gap-0.5 rounded px-0.5 hover:text-foreground',
          align === 'right' && 'ml-auto',
          active ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        <span>{label}</span>
        {active ? (
          direction === 'asc' ? (
            <ArrowUp className="size-3 shrink-0" aria-hidden />
          ) : (
            <ArrowDown className="size-3 shrink-0" aria-hidden />
          )
        ) : null}
      </button>
    </th>
  )
}

function ProductListCard({
  title,
  total,
  filters,
  loading,
  error,
  empty,
  emptyMessage,
  rows,
}: {
  title: string
  total: number
  filters: ReactNode
  loading: boolean
  error: boolean
  empty: boolean
  emptyMessage: string
  rows: ReactNode
}) {
  return (
    <Card>
      <CardHeader className="space-y-3 border-b border-border pb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{title}</CardTitle>
          <Badge variant="muted">{formatNumber(total)}종</Badge>
        </div>
        {filters}
      </CardHeader>
      <CardContent className="pt-4">
        {loading ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            상품을 불러오는 중…
          </p>
        ) : error ? (
          <p className="py-12 text-center text-sm text-danger">
            상품을 불러오지 못했습니다.
          </p>
        ) : empty ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            {emptyMessage}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            {rows}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function OutboundDataPage() {
  const { brand } = useBrand()
  const queryClient = useQueryClient()
  const [view, setView] = useState<ViewMode>('outbound')
  const [search, setSearch] = useState('')
  const [onlyShipped, setOnlyShipped] = useState(true)
  const [selectedStyleId, setSelectedStyleId] = useState<string | null>(null)
  const [partnerFilter, setPartnerFilter] = useState<string>('')
  const [datePreset, setDatePreset] = useState<DatePreset>('30d')
  const initialRange = rangeForPreset('30d')
  const [dateFrom, setDateFrom] = useState(initialRange.from)
  const [dateTo, setDateTo] = useState(initialRange.to)
  const [outboundSortKey, setOutboundSortKey] =
    useState<OutboundSortKey>('name')
  const [outboundSortDir, setOutboundSortDir] = useState<'asc' | 'desc'>('asc')

  const shipmentsQuery = useQuery({
    queryKey: ['outboundShipments', brand.id],
    queryFn: () => getOutboundShipments(brand.id),
  })
  const shipments = shipmentsQuery.data ?? []

  useEffect(() => {
    purgeDemoProductOutboundShipments(brand.id)
    setSelectedStyleId(null)
    setSearch('')
    setPartnerFilter('')
    const range = rangeForPreset('30d')
    setDatePreset('30d')
    setDateFrom(range.from)
    setDateTo(range.to)
    setOutboundSortKey('name')
    setOutboundSortDir('asc')
  }, [brand.id])

  useEffect(() => {
    function refresh(event?: Event) {
      if (event instanceof CustomEvent) {
        const detail = event.detail as { brandId?: string } | undefined
        if (detail?.brandId && detail.brandId !== brand.id) return
      }
      void queryClient.invalidateQueries({
        queryKey: ['outboundShipments', brand.id],
      })
    }
    window.addEventListener(PRODUCT_OUTBOUND_UPDATED_EVENT, refresh)
    return () => {
      window.removeEventListener(PRODUCT_OUTBOUND_UPDATED_EVENT, refresh)
    }
  }, [brand.id, queryClient])

  const partnersQuery = useQuery({
    queryKey: ['codeUsageTargets', brand.id],
    queryFn: () => getCodeUsageTargets(brand.id),
  })

  const filteredShipments = useMemo(
    () =>
      filterShipmentsByRange(
        shipments,
        dateFrom,
        dateTo,
        partnerFilter || null,
      ),
    [dateFrom, dateTo, partnerFilter, shipments],
  )

  const finance = useMemo(
    () => summarizeOutboundFinance(filteredShipments),
    [filteredShipments],
  )

  const partnerFinance = useMemo(
    () => summarizeOutboundFinanceByPartner(filteredShipments),
    [filteredShipments],
  )

  const outboundStyleRows = useMemo(
    () => listOutboundStyleRows(filteredShipments),
    [filteredShipments],
  )

  const summaries = useMemo(() => {
    const map = new Map<string, ProductOutboundSummary>()
    for (const style of outboundStyleRows) {
      map.set(
        style.styleId,
        buildProductOutboundSummary(
          {
            id: style.styleId,
            styleNo: style.styleNo,
            name: style.styleName,
          },
          filteredShipments,
        ),
      )
    }
    return map
  }, [filteredShipments, outboundStyleRows])

  const dateColumns = useMemo(
    () => listOutboundDateColumns(dateFrom, dateTo, filteredShipments),
    [dateFrom, dateTo, filteredShipments],
  )

  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase()
    let rows = outboundStyleRows
    if (query) {
      rows = rows.filter(
        (style) =>
          style.styleNo.toLowerCase().includes(query) ||
          style.styleName.toLowerCase().includes(query),
      )
    }
    if (!onlyShipped) return rows
    return rows.filter(
      (style) => (summaries.get(style.styleId)?.totalQuantity ?? 0) > 0,
    )
  }, [onlyShipped, outboundStyleRows, search, summaries])

  function toggleOutboundSort(key: OutboundSortKey) {
    if (outboundSortKey === key) {
      setOutboundSortDir((current) => (current === 'asc' ? 'desc' : 'asc'))
      return
    }
    setOutboundSortKey(key)
    setOutboundSortDir(key === 'name' ? 'asc' : 'desc')
  }

  const sortedVisibleRows = useMemo(() => {
    const rows = [...visibleRows]
    rows.sort((left, right) => {
      let cmp = 0
      if (outboundSortKey === 'name') {
        cmp = (left.styleName || left.styleNo).localeCompare(
          right.styleName || right.styleNo,
          'ko-KR',
        )
      } else if (outboundSortKey === 'total') {
        cmp =
          (summaries.get(left.styleId)?.totalQuantity ?? 0) -
          (summaries.get(right.styleId)?.totalQuantity ?? 0)
      } else if (outboundSortKey.startsWith('date:')) {
        const date = outboundSortKey.slice(5)
        const leftQty =
          quantityByShippedOn(
            summaries.get(left.styleId)?.shipments ?? [],
          ).get(date) ?? 0
        const rightQty =
          quantityByShippedOn(
            summaries.get(right.styleId)?.shipments ?? [],
          ).get(date) ?? 0
        cmp = leftQty - rightQty
      }
      if (cmp === 0) {
        cmp = left.styleNo.localeCompare(right.styleNo, 'ko-KR')
      }
      return outboundSortDir === 'asc' ? cmp : -cmp
    })
    return rows
  }, [outboundSortDir, outboundSortKey, summaries, visibleRows])

  const selectedStyle =
    sortedVisibleRows.find((style) => style.styleId === selectedStyleId) ??
    visibleRows.find((style) => style.styleId === selectedStyleId) ??
    null

  const selectedSummary = selectedStyle
    ? (summaries.get(selectedStyle.styleId) ?? emptySummary(selectedStyle))
    : null

  const selectedFinance = useMemo(() => {
    if (!selectedStyle) return null
    const rowsForStyle = filteredShipments.filter(
      (row) =>
        row.styleId === selectedStyle.styleId ||
        row.styleNo === selectedStyle.styleNo,
    )
    return summarizeOutboundFinance(rowsForStyle)
  }, [filteredShipments, selectedStyle])

  function applyPreset(preset: DatePreset) {
    setDatePreset(preset)
    const range = rangeForPreset(preset)
    setDateFrom(range.from)
    setDateTo(range.to)
  }

  function setCustomFrom(value: string) {
    setDatePreset('all')
    setDateFrom(value)
  }

  function setCustomTo(value: string) {
    setDatePreset('all')
    setDateTo(value)
  }

  const filterBarProps = {
    datePreset,
    dateFrom,
    dateTo,
    partnerFilter,
    partners: partnersQuery.data ?? [],
    extraPartners: partnerFinance,
    search,
    onlyShipped,
    onPreset: applyPreset,
    onFrom: setCustomFrom,
    onTo: setCustomTo,
    onPartner: (value: string) => {
      setPartnerFilter(value)
    },
    onSearch: (value: string) => {
      setSearch(value)
      setSelectedStyleId(null)
    },
    onOnlyShipped: () => setOnlyShipped((value) => !value),
  }

  const listControls = {
    total: visibleRows.length,
    loading: false,
    error: false,
    empty: visibleRows.length === 0,
    emptyMessage: onlyShipped
      ? '기간 안 출고 기록이 있는 상품이 없습니다.'
      : '표시할 상품이 없습니다.',
  }

  return (
    <div>
      <PageHeader
        title="운영 현황"
        description="출고 수량은 DB 원장입니다. 손익 금액은 테스트용이며 저장하지 않습니다."
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {(
          [
            { value: 'outbound' as const, label: '출고 데이터' },
            { value: 'profit' as const, label: '손익데이터' },
          ] as const
        ).map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={view === item.value}
            onClick={() => setView(item.value)}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs',
              view === item.value
                ? 'border-primary/40 bg-primary/10 text-foreground'
                : 'border-border text-muted-foreground hover:bg-muted/40',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {view === 'outbound' ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="출고 수량"
              value={`${formatNumber(finance.quantity)}개`}
            />
            <KpiCard
              label="출고 건수"
              value={`${formatNumber(finance.shipmentCount)}건`}
            />
            <KpiCard
              label="출고 상품"
              value={`${formatNumber(finance.styleCount)}종`}
            />
            <KpiCard
              label="출고 업체"
              value={`${formatNumber(finance.partnerCount)}곳`}
            />
          </div>

          <ProductListCard
            {...listControls}
            title="상품 출고"
            filters={<FilterBar {...filterBarProps} />}
            rows={
              <table className="w-full min-w-max border-separate border-spacing-0 text-left text-xs">
                <thead className="text-[11px] text-muted-foreground">
                  <tr>
                    <th className="sticky left-0 z-20 w-[4.5rem] min-w-[4.5rem] max-w-[4.5rem] whitespace-nowrap border-b border-border bg-muted/40 px-2 py-1.5 font-medium">
                      M번호
                    </th>
                    <OutboundSortHeader
                      label="상품명"
                      sortKey="name"
                      activeKey={outboundSortKey}
                      direction={outboundSortDir}
                      onSort={toggleOutboundSort}
                      className="sticky left-[4.5rem] z-20"
                    />
                    <OutboundSortHeader
                      label="총 출고"
                      sortKey="total"
                      activeKey={outboundSortKey}
                      direction={outboundSortDir}
                      onSort={toggleOutboundSort}
                      align="right"
                    />
                    {dateColumns.map((date) => (
                      <OutboundSortHeader
                        key={date}
                        label={formatOutboundDateHeader(date)}
                        title={date}
                        sortKey={`date:${date}`}
                        activeKey={outboundSortKey}
                        direction={outboundSortDir}
                        onSort={toggleOutboundSort}
                        align="right"
                        className="px-1.5 tabular-nums"
                      />
                    ))}
                    <th className="w-6 border-b border-border bg-muted/40 px-1 py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {sortedVisibleRows.map((style) => {
                    const summary =
                      summaries.get(style.styleId) ?? emptySummary(style)
                    const byDate = quantityByShippedOn(summary.shipments)
                    const active = selectedStyleId === style.styleId
                    return (
                      <tr
                        key={style.styleId}
                        className={cn(
                          'group cursor-pointer',
                          active && 'bg-primary/10',
                        )}
                        onClick={() => setSelectedStyleId(style.styleId)}
                      >
                        <td
                          className={cn(
                            'sticky left-0 z-10 w-[4.5rem] min-w-[4.5rem] max-w-[4.5rem] whitespace-nowrap border-b border-border px-2 py-1 font-mono',
                            active
                              ? 'bg-primary/10'
                              : 'bg-card group-hover:bg-muted/30',
                          )}
                        >
                          {style.styleNo}
                        </td>
                        <td
                          className={cn(
                            'sticky left-[4.5rem] z-10 whitespace-nowrap border-b border-border px-2 py-1',
                            active
                              ? 'bg-primary/10'
                              : 'bg-card group-hover:bg-muted/30',
                          )}
                        >
                          {style.styleName || (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap border-b border-border px-2 py-1 text-right font-medium tabular-nums group-hover:bg-muted/30">
                          {summary.totalQuantity > 0
                            ? formatNumber(summary.totalQuantity)
                            : '—'}
                        </td>
                        {dateColumns.map((date) => {
                          const qty = byDate.get(date) ?? 0
                          return (
                            <td
                              key={date}
                              className={cn(
                                'border-b border-border px-1.5 py-1 text-right tabular-nums group-hover:bg-muted/30',
                                qty > 0
                                  ? 'text-foreground'
                                  : 'text-muted-foreground/50',
                              )}
                            >
                              {qty > 0 ? formatNumber(qty) : '·'}
                            </td>
                          )
                        })}
                        <td className="border-b border-border px-1 py-1 text-muted-foreground group-hover:bg-muted/30">
                          <ChevronRight className="size-3.5" />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            }
          />

          {selectedSummary && selectedStyle ? (
            <ProductDetailDialog
              mode="outbound"
              summary={selectedSummary}
              style={selectedStyle}
              finance={null}
              dates={dateColumns}
              onClose={() => setSelectedStyleId(null)}
            />
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            <KpiCard
              label="출고 수량"
              value={`${formatNumber(finance.quantity)}개`}
              hint={`${formatNumber(finance.shipmentCount)}건`}
            />
            <KpiCard
              label="추정 매출"
              value={formatWon(finance.revenue)}
              hint="판매가 × 출고수량 (테스트)"
            />
            <KpiCard
              label="매출원가"
              value={formatWon(finance.cogs)}
              hint="제품 원가 합"
              tone="muted"
            />
            <KpiCard
              label="물류·수수료"
              value={formatWon(finance.fees)}
              hint="배송·플랫폼 수수료 가정"
              tone="muted"
            />
            <KpiCard
              label="반품·손실"
              value={formatWon(finance.returnLoss)}
              hint={`가정 반품 ${formatNumber(finance.returnQuantity)}개`}
              tone="danger"
            />
            <KpiCard
              label="순이익"
              value={formatWon(finance.netProfit)}
              hint={`마진 ${finance.marginRate.toFixed(1)}%`}
              tone={finance.netProfit >= 0 ? 'success' : 'danger'}
            />
          </div>

          <ProductListCard
            {...listControls}
            title="상품 손익"
            filters={<FilterBar {...filterBarProps} />}
            rows={
              <table className="w-full min-w-[42rem] text-left text-sm">
                <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2.5 font-medium">M번호</th>
                    <th className="px-3 py-2.5 font-medium">상품명</th>
                    <th className="px-3 py-2.5 text-right font-medium">출고</th>
                    <th className="px-3 py-2.5 text-right font-medium">매출</th>
                    <th className="px-3 py-2.5 text-right font-medium">
                      순이익
                    </th>
                    <th className="px-3 py-2.5 font-medium">최근</th>
                    <th className="w-8 px-2 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((style) => {
                    const summary =
                      summaries.get(style.styleId) ?? emptySummary(style)
                    const eco = demoEconomicsForStyle(style.styleNo)
                    const revenue = summary.totalQuantity * eco.unitPrice
                    const net =
                      revenue -
                      summary.totalQuantity * eco.unitCost -
                      summary.totalQuantity * eco.unitFee
                    const active = selectedStyleId === style.styleId
                    return (
                      <tr
                        key={style.styleId}
                        className={cn(
                          'cursor-pointer border-b border-border last:border-0',
                          active ? 'bg-primary/10' : 'hover:bg-muted/30',
                        )}
                        onClick={() => setSelectedStyleId(style.styleId)}
                      >
                        <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs">
                          {style.styleNo}
                        </td>
                        <td className="max-w-[12rem] truncate px-3 py-2.5">
                          {style.styleName || (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {summary.totalQuantity > 0
                            ? formatNumber(summary.totalQuantity)
                            : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right text-xs tabular-nums">
                          {summary.totalQuantity > 0
                            ? formatWon(revenue)
                            : '—'}
                        </td>
                        <td
                          className={cn(
                            'px-3 py-2.5 text-right text-xs tabular-nums',
                            summary.totalQuantity > 0 &&
                              (net >= 0 ? 'text-success' : 'text-danger'),
                          )}
                        >
                          {summary.totalQuantity > 0 ? formatWon(net) : '—'}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted-foreground">
                          {summary.lastShippedOn ?? '—'}
                        </td>
                        <td className="px-2 py-2.5 text-muted-foreground">
                          <ChevronRight className="size-4" />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            }
          />

          {selectedSummary && selectedStyle && selectedFinance ? (
            <ProductDetailDialog
              mode="profit"
              summary={selectedSummary}
              style={selectedStyle}
              finance={selectedFinance}
              dates={dateColumns}
              onClose={() => setSelectedStyleId(null)}
            />
          ) : null}
        </div>
      )}
    </div>
  )
}
