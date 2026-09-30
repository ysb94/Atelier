import {
  startTransition,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Loader2,
  Search,
  X,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { useBrand } from '@/components/layout/brand-context'
import { SingleBrandOrList } from '@/components/layout/SingleBrandOrList'
import { CompanyOutboundList } from '@/features/workspace/company-operation-lists'
import {
  useWorkspaceTabActivity,
  WorkspaceTabOverlay,
} from '@/components/layout/workspace-tabs'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input, Select } from '@/components/ui/input'
import {
  getCodeUsageTargetFolders,
  getCodeUsageTargets,
  getOutboundShipments,
} from '@/lib/api'
import { outboundPartnerDisplayName } from '@/lib/codes/outbound-partner'
import {
  bucketTotalsByPeriod,
  companySeriesId,
  groupPartnersForOutboundChart,
  limitCompaniesWithOther,
  niceTicks,
  OTHER_COMPANY_KEY,
  resolveChartSeries,
  siteSeriesId,
  type PartnerChartCompany,
  type PeriodQuantity,
} from '@/lib/outbound/partner-outbound-chart'
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
  type ProductOutboundShipment,
  type ProductOutboundSummary,
} from '@/lib/outbound/product-outbound'
import type { CodeUsageTarget, CodeUsageTargetFolder } from '@/lib/types'
import { useRenderWatch } from '@/lib/diagnostics'
import { cn, formatNumber, emptyList } from '@/lib/utils'

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

const SERIES_COLORS = [
  '#0072B2',
  '#E69F00',
  '#009E73',
  '#CC79A7',
  '#56B4E9',
  '#D55E00',
] as const
const TOTAL_SERIES_ID = '__total__'
const TOTAL_COLOR = '#171717'
const MAX_PICKED = 6
const AUTO_PICK_COUNT = 3
const SITE_PREVIEW = 5
const TREND_HEIGHT = 200
const TREND_PAD = { top: 12, right: 28, bottom: 28, left: 44 }

type PickedSeries = { id: string; color: string }

type TrendLine = {
  id: string
  label: string
  color: string
  quantity: number
  values: number[]
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function formatShare(quantity: number, total: number) {
  if (!Number.isFinite(quantity) || !Number.isFinite(total) || total <= 0) {
    return '—'
  }
  const share = (quantity / total) * 100
  if (!Number.isFinite(share)) return '—'
  if (share >= 10) return `${Math.round(share)}%`
  return `${share.toFixed(1)}%`
}

function barWidth(quantity: number, widthTotal: number, grown: boolean) {
  if (
    !grown ||
    !Number.isFinite(quantity) ||
    !Number.isFinite(widthTotal) ||
    widthTotal <= 0
  ) {
    return 0
  }
  return (quantity / widthTotal) * 100
}

function linePath(points: { x: number; y: number }[]) {
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`)
    .join(' ')
}

function OutboundTrendChart({
  buckets,
  showTotal,
  totalLabel,
  series,
  hoverSeriesId,
  unit,
  onUnit,
}: {
  buckets: PeriodQuantity[]
  showTotal: boolean
  totalLabel: string
  series: TrendLine[]
  hoverSeriesId: string | null
  unit: 'day' | 'week'
  onUnit: (unit: 'day' | 'week') => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [plotWidth, setPlotWidth] = useState(360)
  const [hover, setHover] = useState<{
    index: number
    mouseX: number
    mouseY: number
  } | null>(null)

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    const sync = () => {
      const next = Math.max(280, Math.round(host.clientWidth))
      setPlotWidth((prev) => (prev === next ? prev : next))
    }
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  const width = plotWidth
  const height = TREND_HEIGHT
  const pad = TREND_PAD
  const plotW = width - pad.left - pad.right
  const plotH = height - pad.top - pad.bottom
  const maxQty = useMemo(() => {
    let max = 0
    if (showTotal) {
      for (const bucket of buckets) max = Math.max(max, bucket.quantity)
    }
    for (const line of series) {
      for (const value of line.values) max = Math.max(max, value)
    }
    return max
  }, [buckets, series, showTotal])
  const ticks = useMemo(() => niceTicks(maxQty, 4), [maxQty])
  const yMax = Math.max(1, ticks[ticks.length - 1] ?? 1)

  function xAt(index: number) {
    if (buckets.length <= 1) return pad.left + plotW / 2
    return pad.left + (index / (buckets.length - 1)) * plotW
  }

  function yAt(value: number) {
    return pad.top + plotH - (value / yMax) * plotH
  }

  const labelStep = Math.max(
    1,
    Math.ceil(buckets.length / Math.max(4, Math.floor(width / 56))),
  )

  function updateHover(event: MouseEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0 || buckets.length === 0) {
      setHover(null)
      return
    }
    const x = ((event.clientX - rect.left) / rect.width) * width
    let nearestIndex = 0
    let nearestDx = Infinity
    buckets.forEach((_, index) => {
      const dx = Math.abs(xAt(index) - x)
      if (dx < nearestDx) {
        nearestDx = dx
        nearestIndex = index
      }
    })
    const next = {
      index: nearestIndex,
      mouseX: event.clientX,
      mouseY: event.clientY,
    }
    setHover((prev) =>
      prev &&
      prev.index === next.index &&
      prev.mouseX === next.mouseX &&
      prev.mouseY === next.mouseY
        ? prev
        : next,
    )
  }

  const hoverRows = useMemo(() => {
    if (!hover) return []
    const rows = [
      ...(showTotal
        ? [
            {
              id: TOTAL_SERIES_ID,
              label: totalLabel,
              color: TOTAL_COLOR,
              qty: buckets[hover.index]?.quantity ?? 0,
            },
          ]
        : []),
      ...series.map((line) => ({
        id: line.id,
        label: line.label,
        color: line.color,
        qty: line.values[hover.index] ?? 0,
      })),
    ]
    rows.sort((left, right) => right.qty - left.qty)
    return rows
  }, [buckets, hover, series, showTotal, totalLabel])

  const tipLeft = hover ? Math.min(hover.mouseX, window.innerWidth - 12) : 0
  const tipAbove = hover ? hover.mouseY > 120 : true
  const tipFlip = hover ? hover.mouseX > window.innerWidth - 200 : false

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">출고 추이</h3>
        <div className="flex rounded-full border border-border p-0.5 text-xs">
          {(
            [
              { value: 'day' as const, label: '일' },
              { value: 'week' as const, label: '주' },
            ] as const
          ).map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={unit === item.value}
              onClick={() => onUnit(item.value)}
              className={cn(
                'rounded-full px-2.5 py-0.5',
                unit === item.value
                  ? 'bg-primary/10 text-foreground'
                  : 'text-muted-foreground hover:bg-muted/40',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      {buckets.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-8 text-center text-xs text-muted-foreground">
          선택한 기간에 이 상품 출고가 없습니다.
        </p>
      ) : (
        <div
          ref={hostRef}
          className="rounded-lg border border-border bg-muted/10 px-1 py-2"
        >
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="h-[200px] w-full"
            role="img"
            aria-label="출고 수량 추이"
            onMouseMove={updateHover}
            onMouseLeave={() => setHover(null)}
          >
            {ticks.map((tick) => {
              const y = yAt(tick)
              return (
                <g key={tick}>
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
                    x={pad.left - 8}
                    y={y + 4}
                    textAnchor="end"
                    fontSize={11}
                    className="fill-muted-foreground"
                  >
                    {formatNumber(tick)}
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
            {buckets.map((bucket, index) => {
              if (index % labelStep !== 0 && index !== buckets.length - 1) {
                return null
              }
              return (
                <text
                  key={bucket.key}
                  x={xAt(index)}
                  y={height - 8}
                  textAnchor="middle"
                  fontSize={11}
                  className="fill-muted-foreground"
                >
                  {formatOutboundDateHeader(bucket.key)}
                </text>
              )
            })}
            {showTotal && buckets.length > 1 ? (
              <path
                d={`${linePath(buckets.map((bucket, index) => ({ x: xAt(index), y: yAt(bucket.quantity) })))} L${xAt(buckets.length - 1)} ${yAt(0)} L${xAt(0)} ${yAt(0)} Z`}
                fill={TOTAL_COLOR}
                fillOpacity={hoverSeriesId && hoverSeriesId !== TOTAL_SERIES_ID ? 0.03 : 0.08}
              />
            ) : null}
            {series.map((line) => {
              const points = line.values.map((value, index) => ({
                x: xAt(index),
                y: yAt(value),
              }))
              const dim =
                hoverSeriesId != null && hoverSeriesId !== line.id
              if (points.length <= 1 && points[0]) {
                return (
                  <circle
                    key={`${unit}:${line.id}`}
                    cx={points[0].x}
                    cy={points[0].y}
                    r={4}
                    fill={line.color}
                    opacity={dim ? 0.2 : 1}
                  />
                )
              }
              return (
                <path
                  key={`${unit}:${line.id}`}
                  d={linePath(points)}
                  fill="none"
                  stroke={line.color}
                  strokeWidth={dim ? 1.5 : 2.25}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  pathLength={1}
                  strokeDasharray={1}
                  className="animate-line-draw"
                  opacity={dim ? 0.2 : 1}
                />
              )
            })}
            {showTotal && buckets.length > 1 ? (
              <path
                key={`${unit}:total`}
                d={linePath(
                  buckets.map((bucket, index) => ({
                    x: xAt(index),
                    y: yAt(bucket.quantity),
                  })),
                )}
                fill="none"
                stroke={TOTAL_COLOR}
                strokeWidth={hoverSeriesId === TOTAL_SERIES_ID ? 2.75 : 2}
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity={
                  hoverSeriesId != null && hoverSeriesId !== TOTAL_SERIES_ID
                    ? 0.25
                    : 1
                }
              />
            ) : null}
            {hover ? (
              <line
                x1={xAt(hover.index)}
                x2={xAt(hover.index)}
                y1={pad.top}
                y2={height - pad.bottom}
                stroke={TOTAL_COLOR}
                strokeDasharray="3 3"
                strokeWidth={1}
                opacity={0.45}
                pointerEvents="none"
              />
            ) : null}
          </svg>
          {hover && buckets[hover.index]
            ? createPortal(
                <div
                  className="pointer-events-none fixed z-[80] min-w-36 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs shadow-md"
                  style={{
                    left: tipLeft,
                    top: hover.mouseY,
                    transform: `${tipFlip ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)'} ${tipAbove ? 'translateY(calc(-100% - 8px))' : 'translateY(12px)'}`,
                  }}
                >
                  <p className="font-medium text-foreground">
                    {formatOutboundDateHeader(buckets[hover.index].key)}
                    {unit === 'week' ? ' 주' : ''}
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {hoverRows.map((row) => (
                      <li
                        key={row.id}
                        className="flex items-center justify-between gap-3"
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span
                            className="size-2 shrink-0 rounded-full"
                            style={{ backgroundColor: row.color }}
                          />
                          <span className="truncate text-muted-foreground">
                            {row.label}
                          </span>
                        </span>
                        <span className="tabular-nums text-foreground">
                          {formatNumber(row.qty)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>,
                document.body,
              )
            : null}
          {!showTotal && series.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              표시할 선을 고르세요.
            </p>
          ) : null}
        </div>
      )}
    </section>
  )
}

function SeriesLegend({
  showTotal,
  totalLabel,
  totalQuantity,
  series,
  limitHit,
  onToggleTotal,
  onRemove,
  onResetTop,
  onClear,
  onHover,
}: {
  showTotal: boolean
  totalLabel: string
  totalQuantity: number
  series: TrendLine[]
  limitHit: boolean
  onToggleTotal: () => void
  onRemove: (id: string) => void
  onResetTop: () => void
  onClear: () => void
  onHover: (id: string | null) => void
}) {
  return (
    <div className="mb-3 space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          aria-pressed={showTotal}
          onClick={onToggleTotal}
          onMouseEnter={() => onHover(TOTAL_SERIES_ID)}
          onMouseLeave={() => onHover(null)}
          className={cn(
            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs',
            showTotal
              ? 'border-foreground/25 bg-muted/50 text-foreground'
              : 'border-border text-muted-foreground line-through',
          )}
        >
          <span className="size-2 rounded-full" style={{ backgroundColor: TOTAL_COLOR }} />
          {totalLabel}
          <span className="tabular-nums text-muted-foreground">
            {formatNumber(totalQuantity)}
          </span>
        </button>
        {series.map((item) => (
          <span
            key={item.id}
            className="inline-flex items-center gap-1 rounded-full border bg-card px-2 py-0.5 text-xs"
            style={{ borderColor: item.color }}
            onMouseEnter={() => onHover(item.id)}
            onMouseLeave={() => onHover(null)}
          >
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: item.color }}
            />
            <span className="max-w-[7.5rem] truncate">{item.label}</span>
            <span className="tabular-nums text-muted-foreground">
              {formatNumber(item.quantity)}
            </span>
            <button
              type="button"
              aria-label={`${item.label} 끄기`}
              onClick={() => onRemove(item.id)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-3 text-[11px]">
        <button
          type="button"
          onClick={onResetTop}
          className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          상위 3개로
        </button>
        <button
          type="button"
          onClick={onClear}
          className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          모두 끄기
        </button>
      </div>
      {limitHit ? (
        <p className="text-[11px] text-muted-foreground">
          한 번에 6개까지 겹쳐 볼 수 있습니다.
        </p>
      ) : null}
    </div>
  )
}

function PartnerRankBars({
  companies,
  folders,
  folderKey,
  activeIds,
  colorById,
  hoverSeriesId,
  onFolder,
  onToggle,
  onHover,
}: {
  companies: PartnerChartCompany[]
  folders: { key: string; label: string; quantity: number }[]
  folderKey: string | null
  activeIds: ReadonlySet<string>
  colorById: ReadonlyMap<string, string>
  hoverSeriesId: string | null
  onFolder: (key: string | null) => void
  onToggle: (id: string) => void
  onHover: (id: string | null) => void
}) {
  const [openKeys, setOpenKeys] = useState<ReadonlySet<string>>(() => new Set())
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const [grown, setGrown] = useState(() => prefersReducedMotion())
  const total = useMemo(
    () => companies.reduce((sum, company) => sum + company.quantity, 0),
    [companies],
  )

  useEffect(() => {
    if (prefersReducedMotion()) {
      setGrown(true)
      return
    }
    setGrown(false)
    const frame = window.requestAnimationFrame(() => setGrown(true))
    return () => window.cancelAnimationFrame(frame)
  }, [companies])

  function toggleOpen(key: string) {
    setOpenKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleExpanded(key: string) {
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function renderToggleRow({
    seriesId,
    label,
    quantity,
    widthTotal,
    shareTotal,
  }: {
    seriesId: string
    label: string
    quantity: number
    widthTotal: number
    shareTotal: number
  }) {
    const active = activeIds.has(seriesId)
    const color = colorById.get(seriesId) ?? '#a3a3a3'
    const hovered = hoverSeriesId === seriesId
    return (
      <button
        type="button"
        aria-pressed={active}
        onClick={() => onToggle(seriesId)}
        onMouseEnter={() => onHover(seriesId)}
        onMouseLeave={() => onHover(null)}
        className={cn(
          'grid min-w-0 flex-1 grid-cols-[0.7rem_minmax(0,1fr)_minmax(3.5rem,1.1fr)_2.6rem_2.4rem] items-center gap-1.5 rounded-md px-1 py-1 text-left text-xs',
          hovered ? 'bg-muted/70' : 'hover:bg-muted/40',
        )}
      >
        <span
          className="size-2.5 rounded-[2px]"
          style={{ backgroundColor: active ? color : '#d6d3cd' }}
          aria-hidden
        />
        <span className={cn('truncate', active ? 'text-foreground' : 'text-muted-foreground')}>
          {label}
        </span>
        <span className="h-2 overflow-hidden rounded-full bg-muted">
          <span
            className="partner-rank-bar block h-full rounded-full transition-[width] duration-500 ease-out"
            style={{
              width: `${barWidth(quantity, widthTotal, grown)}%`,
              backgroundColor: active ? color : '#a3a3a3',
              opacity: active ? 0.9 : 0.45,
            }}
          />
        </span>
        <span className="text-right tabular-nums text-foreground">
          {formatNumber(quantity)}
        </span>
        <span className="text-right tabular-nums text-muted-foreground">
          {formatShare(quantity, shareTotal)}
        </span>
      </button>
    )
  }

  function renderCompany(company: PartnerChartCompany, depth: number): ReactNode {
    const members = company.members ?? []
    const sites = members.length > 0 ? [] : company.units
    const expandable = members.length > 0 || sites.length > 1
    const opened = openKeys.has(company.key)
    const showAll = expandedKeys.has(company.key)
    const childCompanies = showAll ? members : members.slice(0, SITE_PREVIEW)
    const childSites = showAll ? sites : sites.slice(0, SITE_PREVIEW)
    const hiddenCount =
      members.length > 0
        ? members.length - childCompanies.length
        : sites.length - childSites.length
    return (
      <div key={company.key} className={depth > 0 ? 'pl-4' : undefined}>
        <div className="flex items-center gap-0.5">
          {expandable ? (
            <button
              type="button"
              aria-expanded={opened}
              aria-label={`${company.label} 펼치기`}
              onClick={() => toggleOpen(company.key)}
              className="rounded p-1 text-muted-foreground hover:bg-muted/50"
            >
              <ChevronRight
                className={cn(
                  'size-3 transition-transform duration-200 motion-reduce:transition-none',
                  opened && 'rotate-90',
                )}
              />
            </button>
          ) : (
            <span className="w-5 shrink-0" aria-hidden />
          )}
          {renderToggleRow({
            seriesId: companySeriesId(company.key),
            label: company.label,
            quantity: company.quantity,
            widthTotal: total,
            shareTotal: total,
          })}
        </div>
        {expandable ? (
          <div
            className={cn(
              'partner-rank-expand grid transition-[grid-template-rows] duration-200 ease-out',
              opened ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
            )}
          >
            <div className="overflow-hidden">
              <div className="space-y-0.5 py-0.5 pl-5">
                {childCompanies.map((member) => renderCompany(member, depth + 1))}
                {childSites.map((unit) => (
                  <div key={unit.partnerId} className="pl-5">
                    {renderToggleRow({
                      seriesId: siteSeriesId(unit.partnerId),
                      label: unit.siteLabel,
                      quantity: unit.quantity,
                      widthTotal: company.quantity,
                      shareTotal: total,
                    })}
                  </div>
                ))}
                {hiddenCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => toggleExpanded(company.key)}
                    className="px-1 py-1 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    나머지 {formatNumber(hiddenCount)}곳 더보기
                  </button>
                ) : null}
                {showAll && (members.length > SITE_PREVIEW || sites.length > SITE_PREVIEW) ? (
                  <button
                    type="button"
                    onClick={() => toggleExpanded(company.key)}
                    className="px-1 py-1 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    접기
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <section className="mt-5">
      <h3 className="text-sm font-semibold">업체별 출고</h3>
      <p className="mb-2 mt-0.5 text-[11px] text-muted-foreground">
        막대를 누르면 추이 그래프에 선이 추가됩니다.
      </p>
      {companies.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-8 text-center text-xs text-muted-foreground">
          선택한 기간에 이 상품 출고가 없습니다.
        </p>
      ) : (
        <>
          {folders.length > 1 ? (
            <div className="mb-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                aria-pressed={folderKey === null}
                onClick={() => onFolder(null)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-xs',
                  folderKey === null
                    ? 'border-primary/40 bg-primary/10 text-foreground'
                    : 'border-border text-muted-foreground hover:bg-muted/40',
                )}
              >
                전체
              </button>
              {folders.map((folder) => (
                <button
                  key={folder.key}
                  type="button"
                  aria-pressed={folderKey === folder.key}
                  onClick={() => onFolder(folder.key)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs',
                    folderKey === folder.key
                      ? 'border-primary/40 bg-primary/10 text-foreground'
                      : 'border-border text-muted-foreground hover:bg-muted/40',
                  )}
                >
                  {folder.label}
                  <span className="ml-1 tabular-nums">
                    ({formatNumber(folder.quantity)})
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          <div className="space-y-0.5">
            {companies.map((company) => renderCompany(company, 0))}
          </div>
        </>
      )}
    </section>
  )
}

function usePageScrollBox() {
  const [box, setBox] = useState(measurePageScrollBox)

  useLayoutEffect(() => {
    const host = document.querySelector<HTMLElement>('[data-brand-page-scroll]')
    if (!host) return
    const sync = () => setBox(measurePageScrollBox())
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(host)
    window.addEventListener('resize', sync)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', sync)
    }
  }, [])

  return box
}

function materializeAuto(ids: readonly string[]): PickedSeries[] {
  return ids.map((id, index) => ({
    id,
    color: SERIES_COLORS[index % SERIES_COLORS.length] ?? SERIES_COLORS[0],
  }))
}

function ProductDetailPanel({
  mode,
  summary,
  style,
  finance,
  dates,
  targets,
  folders,
  onClose,
}: {
  mode: 'outbound' | 'profit'
  summary: ProductOutboundSummary
  style: OutboundStyleRow
  finance: ReturnType<typeof summarizeOutboundFinance> | null
  dates: string[]
  targets: CodeUsageTarget[]
  folders: CodeUsageTargetFolder[]
  onClose: () => void
}) {
  const box = usePageScrollBox()
  const [picked, setPicked] = useState<PickedSeries[] | null>(null)
  const [showTotal, setShowTotal] = useState(true)
  const [unit, setUnit] = useState<'day' | 'week'>('day')
  const [folderKey, setFolderKey] = useState<string | null>(null)
  const [hoverSeriesId, setHoverSeriesId] = useState<string | null>(null)
  const [limitHit, setLimitHit] = useState(false)

  const grouped = useMemo(
    () => groupPartnersForOutboundChart(summary.partners, targets, folders),
    [folders, summary.partners, targets],
  )
  const folder =
    grouped.folders.find((item) => item.key === folderKey) ?? null
  const scopeCompanies = folder ? folder.companies : grouped.companies
  const ranked = useMemo(
    () => limitCompaniesWithOther(scopeCompanies),
    [scopeCompanies],
  )
  const resolveScope = useMemo(
    () => ({
      companies: scopeCompanies,
      other: ranked.find((company) => company.key === OTHER_COMPANY_KEY) ?? null,
    }),
    [ranked, scopeCompanies],
  )
  const productScope = useMemo(() => {
    const rankedAll = limitCompaniesWithOther(grouped.companies)
    return {
      companies: grouped.companies,
      other:
        rankedAll.find((company) => company.key === OTHER_COMPANY_KEY) ?? null,
    }
  }, [grouped.companies])
  const productScopeRef = useRef(productScope)
  productScopeRef.current = productScope

  const autoIds = useMemo(
    () =>
      scopeCompanies
        .filter((company) => company.key !== OTHER_COMPANY_KEY)
        .slice(0, AUTO_PICK_COUNT)
        .map((company) => companySeriesId(company.key)),
    [scopeCompanies],
  )
  const activePicked = useMemo(
    () => (picked === null ? materializeAuto(autoIds) : picked),
    [autoIds, picked],
  )
  const visibleSeries = useMemo(
    () =>
      activePicked.flatMap((item) => {
        const resolved = resolveChartSeries(item.id, resolveScope)
        if (!resolved) return []
        return [{ ...resolved, color: item.color }]
      }),
    [activePicked, resolveScope],
  )
  const scopePartnerIds = useMemo(() => {
    const ids = new Set<string>()
    for (const company of scopeCompanies) {
      for (const unit of company.units) ids.add(unit.partnerId)
    }
    return ids
  }, [scopeCompanies])
  const scopeShipments = useMemo(
    () => summary.shipments.filter((row) => scopePartnerIds.has(row.partnerId)),
    [scopePartnerIds, summary.shipments],
  )
  const totalBuckets = useMemo(
    () => bucketTotalsByPeriod(scopeShipments, dates, unit),
    [dates, scopeShipments, unit],
  )
  const chartSeries = useMemo<TrendLine[]>(
    () =>
      visibleSeries.map((series) => {
        const ids = new Set(series.partnerIds)
        const rows = scopeShipments.filter((row) => ids.has(row.partnerId))
        const byKey = new Map(
          bucketTotalsByPeriod(rows, dates, unit).map((bucket) => [
            bucket.key,
            bucket.quantity,
          ]),
        )
        return {
          id: series.id,
          label: series.label,
          color: series.color,
          quantity: series.quantity,
          values: totalBuckets.map((bucket) => byKey.get(bucket.key) ?? 0),
        }
      }),
    [dates, scopeShipments, totalBuckets, unit, visibleSeries],
  )
  const colorById = useMemo(
    () => new Map(visibleSeries.map((series) => [series.id, series.color])),
    [visibleSeries],
  )
  const activeIds = useMemo(
    () => new Set(visibleSeries.map((series) => series.id)),
    [visibleSeries],
  )
  const totalQuantity = useMemo(
    () => scopeCompanies.reduce((sum, company) => sum + company.quantity, 0),
    [scopeCompanies],
  )
  const totalLabel = folder ? `${folder.label} 합계` : '총합'
  const topCompany = grouped.companies[0] ?? null

  useEffect(() => {
    setPicked((prev) => {
      if (prev === null || prev.length === 0) return prev
      const next = prev.filter((item) =>
        resolveChartSeries(item.id, productScopeRef.current),
      )
      if (next.length === prev.length) return prev
      return next.length > 0 ? next : null
    })
    setLimitHit(false)
    setHoverSeriesId(null)
  }, [style.styleId])

  useEffect(() => {
    const count = summary.shipments.filter(
      (row) => !Number.isFinite(row.quantity),
    ).length
    if (count === 0) return
    console.warn('[운영현황] 수량이 숫자가 아닌 출고 기록', {
      styleNo: summary.styleNo,
      count,
    })
  }, [summary.shipments, summary.styleNo])

  useEffect(() => {
    if (!limitHit) return
    const timer = window.setTimeout(() => setLimitHit(false), 2500)
    return () => window.clearTimeout(timer)
  }, [limitHit])

  function toggleSeries(id: string) {
    const base = picked ?? materializeAuto(autoIds)
    if (base.some((item) => item.id === id)) {
      setPicked(base.filter((item) => item.id !== id))
      setLimitHit(false)
      return
    }
    if (base.length >= MAX_PICKED) {
      setLimitHit(true)
      return
    }
    const used = new Set(base.map((item) => item.color))
    const color =
      SERIES_COLORS.find((item) => !used.has(item)) ?? SERIES_COLORS[0]
    setPicked([...base, { id, color }])
    setLimitHit(false)
  }

  return (
    <WorkspaceTabOverlay>
      <aside
        role="dialog"
        aria-label={`${summary.styleNo} 출고 상세`}
        className={cn(
          'animate-panel-in fixed right-0 z-30 flex w-[min(440px,100vw)] flex-col border-l border-border bg-card shadow-xl',
          !box && 'inset-y-0',
        )}
        style={box ? { top: box.top, height: box.height } : undefined}
      >
        <div
          key={style.styleId}
          className="animate-fade-in flex min-h-0 flex-1 flex-col"
        >
          <div className="border-b border-border px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-xs text-muted-foreground">
                  {summary.styleNo}
                </p>
                <h2 className="truncate text-lg font-semibold leading-snug">
                  {summary.styleName || '이름 없음'}
                </h2>
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
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge variant="muted">
                출고 {formatNumber(summary.totalQuantity)}
              </Badge>
              {mode === 'outbound' ? (
                <>
                  <Badge variant="muted">
                    업체 {formatNumber(summary.partnerCount)}
                  </Badge>
                  {topCompany ? (
                    <Badge variant="outline">
                      {topCompany.label}{' '}
                      {formatShare(topCompany.quantity, summary.totalQuantity)}
                    </Badge>
                  ) : null}
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
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
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
                    {Number.isFinite(finance.marginRate)
                      ? `${finance.marginRate.toFixed(1)}%`
                      : '—'}
                  </p>
                </div>
              </div>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <SeriesLegend
              showTotal={showTotal}
              totalLabel={totalLabel}
              totalQuantity={totalQuantity}
              series={chartSeries}
              limitHit={limitHit}
              onToggleTotal={() => setShowTotal((value) => !value)}
              onRemove={toggleSeries}
              onResetTop={() => {
                setPicked(null)
                setLimitHit(false)
              }}
              onClear={() => {
                setPicked([])
                setLimitHit(false)
              }}
              onHover={setHoverSeriesId}
            />
            <OutboundTrendChart
              buckets={totalBuckets}
              showTotal={showTotal}
              totalLabel={totalLabel}
              series={chartSeries}
              hoverSeriesId={hoverSeriesId}
              unit={unit}
              onUnit={(next) => {
                setUnit(next)
              }}
            />
            <PartnerRankBars
              key={style.styleId}
              companies={ranked}
              folders={grouped.folders}
              folderKey={folder ? folder.key : null}
              activeIds={activeIds}
              colorById={colorById}
              hoverSeriesId={hoverSeriesId}
              onFolder={setFolderKey}
              onToggle={toggleSeries}
              onHover={setHoverSeriesId}
            />
          </div>
        </div>
        <div className="flex h-20 shrink-0 items-center border-t border-border px-5 text-[11px] leading-4 text-muted-foreground">
          위·아래 방향키로 이전·다음 상품 · Esc로 닫기
        </div>
      </aside>
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
              {outboundPartnerDisplayName(partner)}
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

function timeOutboundData<T>(name: string, fn: () => T): T {
  const start = performance.now()
  const result = fn()
  const elapsed = Math.round(performance.now() - start)
  if (elapsed >= 1_000) {
    console.warn(`[outbound-data] ${name} ${elapsed}ms`, {
      path: `${location.pathname}${location.search}`,
    })
  } else if (elapsed >= 200) {
    console.info(`[outbound-data] ${name} ${elapsed}ms`, {
      path: `${location.pathname}${location.search}`,
    })
  }
  return result
}

function measurePageScrollBox() {
  const host = document.querySelector<HTMLElement>('[data-brand-page-scroll]')
  if (!host) return null
  const rect = host.getBoundingClientRect()
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  }
}

function OutboundBusyOverlay({
  label,
  hint,
}: {
  label: string
  hint?: string
}) {
  const [box, setBox] = useState(measurePageScrollBox)

  useLayoutEffect(() => {
    const host = document.querySelector<HTMLElement>('[data-brand-page-scroll]')
    if (!host) return
    const sync = () => {
      setBox(measurePageScrollBox())
    }
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(host)
    window.addEventListener('resize', sync)
    window.addEventListener('scroll', sync, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', sync)
      window.removeEventListener('scroll', sync, true)
    }
  }, [])

  if (!box) return null
  return createPortal(
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="fixed z-[80] flex flex-col items-center justify-center gap-3 bg-background/80 backdrop-blur-sm"
      style={{
        top: box.top,
        left: box.left,
        width: box.width,
        height: box.height,
      }}
    >
      <Loader2 className="size-10 animate-spin text-foreground" />
      <p className="text-2xl font-semibold tracking-wide">불러오는 중</p>
      <p className="text-sm text-muted-foreground">{label}</p>
      {hint ? (
        <p className="max-w-md px-6 text-center text-xs text-muted-foreground/80">
          {hint}
        </p>
      ) : null}
    </div>,
    document.body,
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
  className,
}: {
  title: string
  total: number
  filters: ReactNode
  loading: boolean
  error: boolean
  empty: boolean
  emptyMessage: string
  rows: ReactNode
  className?: string
}) {
  return (
    <Card className={className}>
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
  useRenderWatch('OutboundDataPage')
  const tabActive = useWorkspaceTabActivity()
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
  const shipments =
    shipmentsQuery.data ?? emptyList<ProductOutboundShipment>()
  const loadingShipments =
    shipmentsQuery.isPending ||
    (!shipmentsQuery.data && shipmentsQuery.isFetching)
  const refreshingShipments =
    shipmentsQuery.isFetching && Boolean(shipmentsQuery.data)
  const [readyBrandId, setReadyBrandId] = useState<string | null>(null)

  useEffect(() => {
    if (loadingShipments) {
      if (readyBrandId !== null) setReadyBrandId(null)
      return
    }
    if (readyBrandId === brand.id) return
    const frame = window.requestAnimationFrame(() => {
      startTransition(() => {
        setReadyBrandId(brand.id)
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [brand.id, loadingShipments, readyBrandId, shipmentsQuery.dataUpdatedAt])

  useEffect(() => {
    if (!shipmentsQuery.error) return
    console.warn('[운영현황] 출고 원장을 불러오지 못함', {
      brandId: brand.id,
      error: shipmentsQuery.error,
    })
  }, [brand.id, shipmentsQuery.error])

  const readyToRender = readyBrandId === brand.id && !loadingShipments
  const visibleShipments = readyToRender
    ? shipments
    : emptyList<ProductOutboundShipment>()
  const showLoadingOverlay =
    !shipmentsQuery.isError && (loadingShipments || !readyToRender)

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
  const foldersQuery = useQuery({
    queryKey: ['codeUsageTargetFolders', brand.id],
    queryFn: () => getCodeUsageTargetFolders(brand.id),
  })
  const partnerTargets = partnersQuery.data ?? emptyList()
  const partnerFolders = foldersQuery.data ?? emptyList()

  const filteredShipments = useMemo(
    () =>
      timeOutboundData('기간 필터', () =>
        filterShipmentsByRange(
          visibleShipments,
          dateFrom,
          dateTo,
          partnerFilter || null,
        ),
      ),
    [dateFrom, dateTo, partnerFilter, visibleShipments],
  )

  const finance = useMemo(
    () =>
      timeOutboundData('손익 합계', () =>
        summarizeOutboundFinance(filteredShipments),
      ),
    [filteredShipments],
  )

  const partnerFinance = useMemo(
    () =>
      timeOutboundData('업체별 손익', () =>
        summarizeOutboundFinanceByPartner(filteredShipments),
      ),
    [filteredShipments],
  )

  const outboundStyleRows = useMemo(
    () =>
      timeOutboundData('상품 목록', () =>
        listOutboundStyleRows(filteredShipments),
      ),
    [filteredShipments],
  )

  const summaries = useMemo(
    () =>
      timeOutboundData('상품별 집계', () => {
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
      }),
    [filteredShipments, outboundStyleRows],
  )

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

  const detailRows = view === 'outbound' ? sortedVisibleRows : visibleRows

  useEffect(() => {
    if (!selectedStyleId || !tabActive) return
    function onKey(event: KeyboardEvent) {
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      ) {
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setSelectedStyleId(null)
        return
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      const index = detailRows.findIndex(
        (row) => row.styleId === selectedStyleId,
      )
      if (index < 0) return
      const next = detailRows[event.key === 'ArrowDown' ? index + 1 : index - 1]
      if (!next) return
      event.preventDefault()
      setSelectedStyleId(next.styleId)
      document
        .querySelector(`[data-style-id="${CSS.escape(next.styleId)}"]`)
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [detailRows, selectedStyleId, tabActive])

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
    partners: partnerTargets,
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
    loading: showLoadingOverlay,
    error: shipmentsQuery.isError,
    empty: visibleRows.length === 0,
    emptyMessage: onlyShipped
      ? '기간 안 출고 기록이 있는 상품이 없습니다.'
      : '표시할 상품이 없습니다.',
  }
  const kpiQuantity = showLoadingOverlay
    ? '—'
    : `${formatNumber(finance.quantity)}개`
  const kpiShipments = showLoadingOverlay
    ? '—'
    : `${formatNumber(finance.shipmentCount)}건`
  const kpiStyles = showLoadingOverlay
    ? '—'
    : `${formatNumber(finance.styleCount)}종`
  const kpiPartners = showLoadingOverlay
    ? '—'
    : `${formatNumber(finance.partnerCount)}곳`

  return (
    <div>
      {showLoadingOverlay ? (
        <WorkspaceTabOverlay>
          <OutboundBusyOverlay
            label={
              loadingShipments
                ? '출고 원장을 불러오는 중'
                : '출고 현황을 집계하는 중'
            }
            hint="건수가 많으면 몇 초 걸릴 수 있습니다. 멈춘 것이 아닙니다."
          />
        </WorkspaceTabOverlay>
      ) : null}
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

      {refreshingShipments ? (
        <p className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          출고 원장을 다시 불러오는 중…
        </p>
      ) : null}

      {view === 'outbound' ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="출고 수량"
              value={kpiQuantity}
            />
            <KpiCard
              label="출고 건수"
              value={kpiShipments}
            />
            <KpiCard
              label="출고 상품"
              value={kpiStyles}
            />
            <KpiCard
              label="출고 업체"
              value={kpiPartners}
            />
          </div>

          <ProductListCard
            {...listControls}
            className={cn(
              'transition-[padding] duration-200',
              selectedStyle && 'lg:pr-[440px]',
            )}
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
                        data-style-id={style.styleId}
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
            <ProductDetailPanel
              mode="outbound"
              summary={selectedSummary}
              style={selectedStyle}
              finance={null}
              dates={dateColumns}
              targets={partnerTargets}
              folders={partnerFolders}
              onClose={() => setSelectedStyleId(null)}
            />
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            <KpiCard
              label="출고 수량"
              value={kpiQuantity}
              hint={showLoadingOverlay ? undefined : kpiShipments}
            />
            <KpiCard
              label="추정 매출"
              value={showLoadingOverlay ? '—' : formatWon(finance.revenue)}
              hint="판매가 × 출고수량 (테스트)"
            />
            <KpiCard
              label="매출원가"
              value={showLoadingOverlay ? '—' : formatWon(finance.cogs)}
              hint="제품 원가 합"
              tone="muted"
            />
            <KpiCard
              label="물류·수수료"
              value={showLoadingOverlay ? '—' : formatWon(finance.fees)}
              hint="배송·플랫폼 수수료 가정"
              tone="muted"
            />
            <KpiCard
              label="반품·손실"
              value={showLoadingOverlay ? '—' : formatWon(finance.returnLoss)}
              hint={
                showLoadingOverlay
                  ? undefined
                  : `가정 반품 ${formatNumber(finance.returnQuantity)}개`
              }
              tone="danger"
            />
            <KpiCard
              label="순이익"
              value={showLoadingOverlay ? '—' : formatWon(finance.netProfit)}
              hint={
                showLoadingOverlay
                  ? undefined
                  : `마진 ${finance.marginRate.toFixed(1)}%`
              }
              tone={
                showLoadingOverlay
                  ? 'muted'
                  : finance.netProfit >= 0
                    ? 'success'
                    : 'danger'
              }
            />
          </div>

          <ProductListCard
            {...listControls}
            className={cn(
              'transition-[padding] duration-200',
              selectedStyle && 'lg:pr-[440px]',
            )}
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
                        data-style-id={style.styleId}
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
            <ProductDetailPanel
              mode="profit"
              summary={selectedSummary}
              style={selectedStyle}
              finance={selectedFinance}
              dates={dateColumns}
              targets={partnerTargets}
              folders={partnerFolders}
              onClose={() => setSelectedStyleId(null)}
            />
          ) : null}
        </div>
      )}
    </div>
  )
}

export function CompanyOutboundDataPage() {
  return (
    <SingleBrandOrList list={<CompanyOutboundList />}>
      <OutboundDataPage />
    </SingleBrandOrList>
  )
}
