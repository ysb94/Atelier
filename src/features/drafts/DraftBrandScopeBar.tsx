import { useMemo, type ReactNode } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { BrandAvatar } from '@/components/brand/BrandAvatar'
import { useCompanyBrandScope } from '@/components/layout/company-brand-scope'
import { getCompanyProductDrafts, getSeasonsByBrand } from '@/lib/api'
import { DEFAULT_COMPANY_ID } from '@/lib/company/capabilities'
import {
  UNASSIGNED_DRAFT_BRAND,
  type DraftBrandScope,
} from '@/lib/drafts/company-draft'
import { useAuth } from '@/lib/supabase/auth'
import { type Brand, type ProductDraft, type Season } from '@/lib/types'
import { combineListQueries, flattenListQueries } from '@/lib/query/list-queries'
import { cn, emptyList, formatNumber } from '@/lib/utils'
import {
  resolveReleaseSchedule,
  type ResolvedReleaseSchedule,
} from './release-schedule-preview'

export type DraftBrandScopeCounts = {
  total: number
  pending: number
  scheduled: number
}

function hasReleaseGroup(schedule: ResolvedReleaseSchedule | undefined) {
  return Boolean(schedule?.group)
}

export function countScheduleRows(
  rows: readonly ProductDraft[],
  scheduleByDraft: ReadonlyMap<string, ResolvedReleaseSchedule>,
): DraftBrandScopeCounts {
  let pending = 0
  let scheduled = 0
  for (const draft of rows) {
    if (hasReleaseGroup(scheduleByDraft.get(draft.id))) scheduled += 1
    else pending += 1
  }
  return { total: rows.length, pending, scheduled }
}

export function useDraftBrandScopeBar() {
  const { brands } = useCompanyBrandScope()
  const { profile } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const companyId = profile?.companyId ?? DEFAULT_COMPANY_ID
  const brandScope = (searchParams.get('scope') ?? 'all') as DraftBrandScope
  const draftsQuery = useQuery({
    queryKey: ['product-drafts', 'company', companyId],
    queryFn: () => getCompanyProductDrafts(companyId),
  })
  const seasonQueries = useQueries({
    queries: brands.map((item) => ({
      queryKey: ['seasons', item.id] as const,
      queryFn: () => getSeasonsByBrand(item.id),
    })),
    combine: combineListQueries<Season>,
  })
  const drafts = draftsQuery.data ?? emptyList<ProductDraft>()
  const seasons = useMemo(() => flattenListQueries(seasonQueries), [seasonQueries])
  const seasonMap = useMemo(
    () => new Map(seasons.map((season) => [season.id, season])),
    [seasons],
  )
  const scheduleByDraft = useMemo(
    () => new Map(drafts.map((draft) => [draft.id, resolveReleaseSchedule(draft, seasonMap, [], {})])),
    [drafts, seasonMap],
  )
  const allScopeCounts = useMemo(
    () => countScheduleRows(drafts, scheduleByDraft),
    [drafts, scheduleByDraft],
  )
  const brandCards = useMemo(
    () => brands.map((brand) => ({
      brand,
      ...countScheduleRows(drafts.filter((draft) => draft.brandId === brand.id), scheduleByDraft),
    })),
    [brands, drafts, scheduleByDraft],
  )
  const unassignedScopeCounts = useMemo(
    () => countScheduleRows(drafts.filter((draft) => !draft.brandId), scheduleByDraft),
    [drafts, scheduleByDraft],
  )

  function onSelect(value: DraftBrandScope) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (!value || value === 'all') next.delete('scope')
      else next.set('scope', value)
      return next
    }, { replace: true })
  }

  return {
    brandScope,
    onSelect,
    allScopeCounts,
    brandCards,
    unassignedScopeCounts,
    isError: draftsQuery.isError,
  }
}

export function DraftBrandScopeBar({
  brandScope,
  allScopeCounts,
  brandCards,
  unassignedScopeCounts,
  onSelect,
  countLabels,
  showUnassigned,
  trailing,
}: {
  brandScope: DraftBrandScope
  allScopeCounts: DraftBrandScopeCounts
  brandCards: readonly { brand: Brand; total: number; pending: number; scheduled: number }[]
  unassignedScopeCounts: DraftBrandScopeCounts
  onSelect: (value: DraftBrandScope) => void
  countLabels?: readonly [string, string]
  showUnassigned?: boolean
  trailing?: ReactNode
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <BrandStatCard
        label="전체"
        badge={{ name: 'ALL', color: '#343a40', logoUrl: null }}
        total={allScopeCounts.total}
        pending={allScopeCounts.pending}
        scheduled={allScopeCounts.scheduled}
        countLabels={countLabels}
        selected={brandScope === 'all'}
        onSelect={() => onSelect('all')}
      />
      {brandCards.map((card) => (
        <BrandStatCard
          key={card.brand.id}
          label={card.brand.name}
          badge={card.brand}
          total={card.total}
          pending={card.pending}
          scheduled={card.scheduled}
          countLabels={countLabels}
          selected={brandScope === card.brand.slug}
          onSelect={() => onSelect(brandScope === card.brand.slug ? 'all' : card.brand.slug)}
        />
      ))}
      {showUnassigned || unassignedScopeCounts.total > 0 ? (
        <BrandStatCard
          label="브랜드 미정"
          badge={{ name: '미정', color: '#8a8e94', logoUrl: null }}
          total={unassignedScopeCounts.total}
          pending={unassignedScopeCounts.pending}
          scheduled={unassignedScopeCounts.scheduled}
          countLabels={countLabels}
          selected={brandScope === UNASSIGNED_DRAFT_BRAND}
          onSelect={() => onSelect(brandScope === UNASSIGNED_DRAFT_BRAND ? 'all' : UNASSIGNED_DRAFT_BRAND)}
        />
      ) : null}
      {trailing ? <div className="ml-auto">{trailing}</div> : null}
    </div>
  )
}

function BrandStatCard({
  label,
  badge,
  total,
  pending,
  scheduled,
  selected,
  onSelect,
  countLabels = ['미정', '확정'],
}: {
  label: string
  badge: Pick<Brand, 'name' | 'color' | 'logoUrl'>
  total: number
  pending: number
  scheduled: number
  selected: boolean
  onSelect: () => void
  countLabels?: readonly [string, string]
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      title={selected && label !== '전체' ? '다시 누르면 전체 브랜드' : label}
      onClick={onSelect}
      className={cn(
        'inline-flex min-w-[168px] items-center gap-2 rounded-full border bg-white px-1.5 py-1 text-left',
        selected
          ? 'border-foreground shadow-sm'
          : 'border-[#ead7c8] hover:border-[#d7c2ae]',
      )}
    >
      <BrandAvatar
        brand={badge}
        className="size-9 rounded-full text-[10px]"
        textClassName="text-[10px]"
      />
      <span className="min-w-0">
        <span className="block truncate text-[11px] font-semibold tracking-wide">
          {label}
        </span>
        <span className="mt-0.5 flex items-baseline gap-1.5 text-[10px] text-muted-foreground">
          <span className="text-sm font-semibold tabular-nums text-foreground">
            {formatNumber(total)}
          </span>
          <span className="tabular-nums">{countLabels[0]} {formatNumber(pending)}</span>
          <span className="tabular-nums">{countLabels[1]} {formatNumber(scheduled)}</span>
        </span>
      </span>
    </button>
  )
}
