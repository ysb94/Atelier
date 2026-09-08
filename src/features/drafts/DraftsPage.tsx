import { useMemo, useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Check, ImageOff, Plus } from 'lucide-react'
import { BrandAvatar } from '@/components/brand/BrandAvatar'
import { useCompanyBrandScope } from '@/components/layout/company-brand-scope'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input, Select } from '@/components/ui/input'
import { getCompanyProductDrafts, getSeasonsByBrand } from '@/lib/api'
import {
  DEFAULT_COMPANY_ID,
  canViewDraftsByOwner,
} from '@/lib/company/capabilities'
import {
  UNASSIGNED_DRAFT_BRAND,
  UNASSIGNED_DRAFT_OWNER,
  collectDraftOwnerNames,
  matchesDraftBrandScope,
  matchesDraftOwnerScope,
  type DraftBrandScope,
  type DraftOwnerScope,
} from '@/lib/drafts/company-draft'
import { useAuth } from '@/lib/supabase/auth'
import { listManageableProfiles } from '@/lib/supabase/profiles'
import {
  DRAFT_STATUS_LABEL,
  formatSeasonLabel,
  type ProductDraft,
  type ProductDraftStatus,
} from '@/lib/types'
import { draftDetailPath, draftNewPath } from '@/lib/workspace/company-paths'
import { cn, formatNumber } from '@/lib/utils'

/** 기획 시트의 진척 체크. 서로 독립적으로 켜진다. */
const PROGRESS_STEPS: {
  key: 'sampleDone' | 'orderDone' | 'orderInProgress'
  label: string
  short: string
}[] = [
  { key: 'sampleDone', label: '샘플 진행', short: '샘플' },
  { key: 'orderDone', label: '생산 발주', short: '발주' },
  { key: 'orderInProgress', label: '발주 진행중', short: '발주중' },
]

function sampleInProgressCount(draft: ProductDraft) {
  return draft.colors.filter((color) => color.sampleInProgress).length
}

function statusVariant(
  status: ProductDraftStatus,
): 'success' | 'outline' | 'muted' {
  if (status === 'confirmed') return 'success'
  if (status === 'dropped') return 'muted'
  return 'outline'
}

function totalOrderQty(draft: ProductDraft) {
  return draft.colors.reduce((sum, color) => sum + (color.orderQty ?? 0), 0)
}

function emptyMessage(
  hasAny: boolean,
  seasonFilter: string,
  brandScope: DraftBrandScope,
  ownerScope: DraftOwnerScope,
) {
  if (hasAny) return '조건에 맞는 기획안이 없습니다.'
  if (ownerScope === UNASSIGNED_DRAFT_OWNER) {
    return '담당 미정 기획안이 없습니다.'
  }
  if (ownerScope !== 'all') {
    return '이 담당자의 기획안이 없습니다.'
  }
  if (brandScope === UNASSIGNED_DRAFT_BRAND) {
    return '브랜드 미정 기획안이 없습니다. 오른쪽 위에서 추가하세요.'
  }
  if (seasonFilter === 'unassigned') {
    return '출시 기획 미정 기획안이 없습니다. 오른쪽 위에서 추가하세요.'
  }
  if (seasonFilter !== 'all') {
    return '이 출시 기획에 묶인 기획안이 없습니다. 오른쪽 위에서 추가하세요.'
  }
  return '아직 기획안이 없습니다. 오른쪽 위에서 추가하세요.'
}

export function CompanyDraftsPage() {
  const { brands, brandById } = useCompanyBrandScope()
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | ProductDraftStatus>(
    'all',
  )
  const seasonFilter = searchParams.get('season') ?? 'all'
  const brandScope = (searchParams.get('scope') ?? 'all') as DraftBrandScope
  const canViewByOwner = canViewDraftsByOwner(profile)
  const ownerScope = (
    canViewByOwner ? (searchParams.get('owner') ?? 'all') : 'all'
  ) as DraftOwnerScope
  const companyId = profile?.companyId ?? DEFAULT_COMPANY_ID
  const brandIdBySlug = useMemo(
    () => new Map(brands.map((item) => [item.slug, item.id])),
    [brands],
  )

  const draftsQuery = useQuery({
    queryKey: ['product-drafts', 'company', companyId],
    queryFn: () => getCompanyProductDrafts(companyId),
  })
  const membersQuery = useQuery({
    queryKey: ['profiles', 'manageable'],
    queryFn: listManageableProfiles,
    enabled: canViewByOwner,
  })
  const seasonQueries = useQueries({
    queries: brands.map((item) => ({
      queryKey: ['seasons', item.id] as const,
      queryFn: () => getSeasonsByBrand(item.id),
    })),
  })

  const drafts = draftsQuery.data ?? []
  const seasonData = seasonQueries.map((query) => query.data)
  const seasons = useMemo(
    () => seasonData.flatMap((rows) => rows ?? []),
    [seasonData],
  )
  const seasonMap = useMemo(
    () => new Map(seasons.map((season) => [season.id, season])),
    [seasons],
  )

  const scopedDrafts = useMemo(() => {
    return drafts.filter((draft) => {
      if (!matchesDraftBrandScope(draft.brandId, brandScope, brandIdBySlug)) {
        return false
      }
      if (seasonFilter === 'all') return true
      if (seasonFilter === 'unassigned') return !draft.seasonId
      const season = draft.seasonId ? seasonMap.get(draft.seasonId) : undefined
      return season?.code.toUpperCase() === seasonFilter.toUpperCase()
    })
  }, [brandIdBySlug, brandScope, drafts, seasonFilter, seasonMap])

  const ownerNames = useMemo(
    () =>
      collectDraftOwnerNames(
        scopedDrafts,
        (membersQuery.data ?? [])
          .filter((member) => member.status === 'active')
          .map((member) => member.displayName ?? ''),
      ),
    [membersQuery.data, scopedDrafts],
  )
  const ownerCounts = useMemo(() => {
    const counts = new Map<string, number>()
    let unassigned = 0
    for (const draft of scopedDrafts) {
      const name = draft.owner.trim()
      if (!name) {
        unassigned += 1
        continue
      }
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    return { counts, unassigned }
  }, [scopedDrafts])

  const ownerDrafts = useMemo(
    () =>
      scopedDrafts.filter((draft) =>
        matchesDraftOwnerScope(draft.owner, ownerScope),
      ),
    [ownerScope, scopedDrafts],
  )

  const visible = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return ownerDrafts.filter((draft) => {
      if (statusFilter !== 'all' && draft.status !== statusFilter) return false
      if (!keyword) return true
      return [
        draft.draftNo,
        draft.nameKo,
        draft.nameEn,
        draft.owner,
        draft.releaseIssue,
        ...draft.colors.map((color) => color.name),
      ]
        .filter(Boolean)
        .some((text) => text.toLowerCase().includes(keyword))
    })
  }, [ownerDrafts, search, statusFilter])

  const loading =
    draftsQuery.isLoading || seasonQueries.some((query) => query.isLoading)
  const scopedBrand =
    brandScope !== 'all' && brandScope !== UNASSIGNED_DRAFT_BRAND
      ? brands.find((item) => item.slug === brandScope)
      : undefined

  const newHref = draftNewPath(scopedBrand?.slug, {
    season:
      seasonFilter === 'unassigned'
        ? 'none'
        : seasonFilter === 'all'
          ? null
          : seasons.find(
              (season) =>
                season.brandId === scopedBrand?.id &&
                season.code.toUpperCase() === seasonFilter.toUpperCase(),
            )?.id ?? null,
  })

  function setSeasonFilter(value: string) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (!value || value === 'all') next.delete('season')
        else next.set('season', value)
        return next
      },
      { replace: true },
    )
  }

  function setBrandScope(value: DraftBrandScope) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (!value || value === 'all') next.delete('scope')
        else next.set('scope', value)
        return next
      },
      { replace: true },
    )
  }

  function setOwnerScope(value: DraftOwnerScope) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (!value || value === 'all') next.delete('owner')
        else next.set('owner', value)
        return next
      },
      { replace: true },
    )
  }

  return (
    <div>
      <PageHeader
        title="기획안"
        description="회사 기획안입니다. 브랜드는 처음부터 비워 두거나 기획 중에 정할 수 있습니다. 출시 확정 전에는 브랜드가 필요합니다."
        actions={
          <Link to={newHref}>
            <Button type="button">
              <Plus className="size-4" />
              기획안 추가
            </Button>
          </Link>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <ScopeChip
          selected={brandScope === 'all'}
          onSelect={() => setBrandScope('all')}
        >
          전체
        </ScopeChip>
        <ScopeChip
          selected={brandScope === UNASSIGNED_DRAFT_BRAND}
          onSelect={() => setBrandScope(UNASSIGNED_DRAFT_BRAND)}
        >
          브랜드 미정
        </ScopeChip>
        {brands.map((item) => (
          <ScopeChip
            key={item.id}
            selected={brandScope === item.slug}
            onSelect={() => setBrandScope(item.slug)}
          >
            <BrandAvatar brand={item} className="size-5" />
            <span className="truncate">{item.name}</span>
          </ScopeChip>
        ))}
      </div>

      {canViewByOwner ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">직원</span>
          <ScopeChip
            selected={ownerScope === 'all'}
            onSelect={() => setOwnerScope('all')}
          >
            전체 {formatNumber(scopedDrafts.length)}
          </ScopeChip>
          <ScopeChip
            selected={ownerScope === UNASSIGNED_DRAFT_OWNER}
            onSelect={() => setOwnerScope(UNASSIGNED_DRAFT_OWNER)}
          >
            담당 미정 {formatNumber(ownerCounts.unassigned)}
          </ScopeChip>
          {ownerNames.map((name) => (
            <ScopeChip
              key={name}
              selected={ownerScope === name}
              onSelect={() => setOwnerScope(name)}
            >
              <span className="truncate">{name}</span>
              <span className="tabular-nums text-muted-foreground">
                {formatNumber(ownerCounts.counts.get(name) ?? 0)}
              </span>
            </ScopeChip>
          ))}
        </div>
      ) : null}

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Input
          className="sm:max-w-xs"
          placeholder="PL번호, 이름, 담당자, 컬러 검색..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Select
          value={seasonFilter}
          onChange={(event) => setSeasonFilter(event.target.value)}
        >
          <option value="all">전체 출시 기획</option>
          <option value="unassigned">출시 기획 미정</option>
          {seasons
            .filter((season) => !scopedBrand || season.brandId === scopedBrand.id)
            .map((season) => (
              <option key={season.id} value={season.code}>
                {!scopedBrand
                  ? `${brandById.get(season.brandId)?.name ?? ''} · ${formatSeasonLabel(season)}`
                  : formatSeasonLabel(season)}
              </option>
            ))}
        </Select>
        <Select
          value={statusFilter}
          onChange={(event) =>
            setStatusFilter(event.target.value as 'all' | ProductDraftStatus)
          }
        >
          <option value="all">전체 상태</option>
          {(Object.keys(DRAFT_STATUS_LABEL) as ProductDraftStatus[]).map(
            (status) => (
              <option key={status} value={status}>
                {DRAFT_STATUS_LABEL[status]}
              </option>
            ),
          )}
        </Select>
        <div className="text-sm text-muted-foreground sm:ml-auto">
          {formatNumber(visible.length)}건
        </div>
      </div>

      {draftsQuery.isError ? (
        <p className="mb-3 text-sm text-danger">기획안을 불러오지 못했습니다.</p>
      ) : null}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] text-left text-sm">
            <thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">브랜드</th>
                <th className="px-4 py-3 font-medium">PL번호</th>
                <th className="px-4 py-3 font-medium">상품</th>
                <th className="px-4 py-3 font-medium">담당</th>
                <th className="px-4 py-3 font-medium">컬러 / 발주</th>
                <th className="px-2 py-3 text-center font-medium">샘플 진행중</th>
                {PROGRESS_STEPS.map((step) => (
                  <th
                    key={step.key}
                    className="px-2 py-3 text-center font-medium"
                  >
                    {step.short}
                  </th>
                ))}
                <th className="px-4 py-3 font-medium">상태</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={7 + PROGRESS_STEPS.length}
                    className="px-4 py-10 text-center text-muted-foreground"
                  >
                    불러오는 중...
                  </td>
                </tr>
              ) : visible.length === 0 ? (
                <tr>
                  <td
                    colSpan={7 + PROGRESS_STEPS.length}
                    className="px-4 py-10 text-center text-muted-foreground"
                  >
                    {emptyMessage(
                      ownerDrafts.length > 0,
                      seasonFilter,
                      brandScope,
                      ownerScope,
                    )}
                  </td>
                </tr>
              ) : (
                visible.map((draft) => {
                  const season = draft.seasonId
                    ? seasonMap.get(draft.seasonId)
                    : undefined
                  const brand = draft.brandId
                    ? brandById.get(draft.brandId)
                    : undefined
                  const total = totalOrderQty(draft)
                  return (
                    <tr
                      key={draft.id}
                      className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/30"
                      onClick={() => navigate(draftDetailPath(draft.id))}
                    >
                      <td className="px-4 py-2">
                        {brand ? (
                          <span className="flex items-center gap-2">
                            <BrandAvatar brand={brand} className="size-6" />
                            <span>{brand.name}</span>
                          </span>
                        ) : (
                          <Badge variant="outline">브랜드 미정</Badge>
                        )}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs tabular-nums text-muted-foreground">
                        {draft.draftNo}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-3">
                          <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-muted">
                            {draft.imageUrl ? (
                              <img
                                src={draft.imageUrl}
                                alt=""
                                className="size-full object-cover"
                              />
                            ) : (
                              <ImageOff className="size-4 text-muted-foreground" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate font-medium">
                              {draft.nameKo || draft.nameEn || '이름 미정'}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">
                              {season
                                ? `${formatSeasonLabel(season)} · `
                                : '출시 기획 미정 · '}
                              {draft.nameEn || '—'}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {draft.owner || '—'}
                      </td>
                      <td className="px-4 py-2">
                        {draft.colors.length === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span>
                            {draft.colors.length}컬러
                            {total > 0 ? ` · 총 ${formatNumber(total)}EA` : ''}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-center text-xs tabular-nums text-muted-foreground">
                        {draft.colors.length === 0
                          ? '—'
                          : `${formatNumber(sampleInProgressCount(draft))}/${formatNumber(draft.colors.length)}`}
                      </td>
                      {PROGRESS_STEPS.map((step) => (
                        <td key={step.key} className="px-2 py-2 text-center">
                          {draft[step.key] ? (
                            <Check
                              className="inline-block size-4 text-success"
                              aria-label={`${step.label} 완료`}
                            />
                          ) : (
                            <span
                              className="inline-block size-4 rounded-sm border border-border"
                              aria-label={`${step.label} 미완료`}
                            />
                          )}
                        </td>
                      ))}
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant={statusVariant(draft.status)}>
                            {DRAFT_STATUS_LABEL[draft.status]}
                          </Badge>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

function ScopeChip({
  selected,
  onSelect,
  children,
}: {
  selected: boolean
  onSelect: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-colors',
        selected
          ? 'border-foreground bg-background font-medium text-foreground'
          : 'border-border bg-background/60 text-muted-foreground hover:bg-muted/70 hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

export function DraftsPage() {
  return <CompanyDraftsPage />
}

export function AllDraftsPage() {
  return <CompanyDraftsPage />
}

export function SeasonDraftsPage() {
  return <CompanyDraftsPage />
}
