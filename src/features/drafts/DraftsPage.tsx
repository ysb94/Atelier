import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Check, ChevronLeft, ImageOff, Plus } from 'lucide-react'
import { useBrand } from '@/components/layout/brand-context'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input, Select } from '@/components/ui/input'
import { getProductDrafts, getSeasonsByBrand } from '@/lib/api'
import {
  DRAFT_STATUS_LABEL,
  formatSeasonLabel,
  type ProductDraft,
  type ProductDraftStatus,
} from '@/lib/types'
import { cn, formatNumber } from '@/lib/utils'

/** 기획 시트의 진척 체크. 서로 독립적으로 켜진다. */
const PROGRESS_STEPS: {
  key: 'sampleDone' | 'orderDone' | 'photoSampleDone'
  label: string
  short: string
}[] = [
  { key: 'sampleDone', label: '샘플 진행', short: '샘플' },
  { key: 'orderDone', label: '생산 발주', short: '발주' },
  { key: 'photoSampleDone', label: '촬영 샘플 입고', short: '촬영' },
]

export type DraftsScope =
  | { kind: 'all' }
  | { kind: 'unassigned' }
  | { kind: 'season'; code: string }

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

function scopeTitle(scope: DraftsScope, seasonLabel?: string) {
  if (scope.kind === 'all') return '전체 기획안'
  if (scope.kind === 'unassigned') return '출시 기획 미정'
  return seasonLabel ? `기획안 · ${seasonLabel}` : '기획안'
}

function scopeDescription(scope: DraftsScope) {
  if (scope.kind === 'all') {
    return '출시 기획 구분 없이 모든 기획안입니다. 출시가 확정되면 상품으로 넘깁니다.'
  }
  if (scope.kind === 'unassigned') {
    return '출시 시기를 정하지 않고 먼저 잡아둔 기획입니다. 나중에 출시 기획을 붙일 수 있습니다.'
  }
  return '이 출시 기획에 묶인 기획안입니다. 출시가 확정되면 상품으로 넘깁니다.'
}

function emptyMessage(scope: DraftsScope, hasAnyInScope: boolean) {
  if (hasAnyInScope) return '조건에 맞는 기획안이 없습니다.'
  if (scope.kind === 'unassigned') {
    return '출시 기획 미정 기획안이 없습니다. 오른쪽 위에서 추가하세요.'
  }
  if (scope.kind === 'season') {
    return '이 출시 기획에 묶인 기획안이 없습니다. 오른쪽 위에서 추가하세요.'
  }
  return '아직 기획안이 없습니다. 오른쪽 위에서 추가하세요.'
}

function newDraftHref(
  brandSlug: string,
  scope: DraftsScope,
  seasonId: string | null,
) {
  const base = `/b/${brandSlug}/drafts/new`
  if (scope.kind === 'unassigned') return `${base}?season=none`
  if (scope.kind === 'season' && seasonId) {
    return `${base}?season=${encodeURIComponent(seasonId)}`
  }
  return base
}

export function DraftsPage({ scope }: { scope: DraftsScope }) {
  const { brand } = useBrand()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | ProductDraftStatus>(
    'all',
  )

  const draftsQuery = useQuery({
    queryKey: ['product-drafts', brand.id],
    queryFn: () => getProductDrafts(brand.id),
  })
  const seasonsQuery = useQuery({
    queryKey: ['seasons', brand.id],
    queryFn: () => getSeasonsByBrand(brand.id),
  })

  const drafts = draftsQuery.data ?? []
  const seasons = seasonsQuery.data ?? []
  const seasonMap = useMemo(
    () => new Map(seasons.map((season) => [season.id, season])),
    [seasons],
  )

  const scopedSeason =
    scope.kind === 'season'
      ? seasons.find(
          (season) =>
            season.code.toUpperCase() === scope.code.toUpperCase(),
        )
      : undefined

  const seasonMissing =
    scope.kind === 'season' && !seasonsQuery.isLoading && !scopedSeason

  const scopedDrafts = useMemo(() => {
    if (scope.kind === 'all') return drafts
    if (scope.kind === 'unassigned') {
      return drafts.filter((draft) => !draft.seasonId)
    }
    if (!scopedSeason) return []
    return drafts.filter((draft) => draft.seasonId === scopedSeason.id)
  }, [drafts, scope, scopedSeason])

  const visible = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return scopedDrafts.filter((draft) => {
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
  }, [scopedDrafts, search, statusFilter])

  const heldCount = scopedDrafts.filter((draft) => draft.held).length
  const title = scopeTitle(
    scope,
    scopedSeason
      ? formatSeasonLabel(scopedSeason)
      : scope.kind === 'season'
        ? scope.code
        : undefined,
  )

  if (seasonMissing) {
    return (
      <div className="space-y-4 py-16 text-center">
        <p className="text-sm text-muted-foreground">
          &quot;{scope.code}&quot; 출시 기획을 찾을 수 없습니다.
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={() => navigate(`/b/${brand.slug}/drafts`)}
        >
          출시 기획 선택으로
        </Button>
      </div>
    )
  }

  return (
    <div>
      <button
        type="button"
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        onClick={() => navigate(`/b/${brand.slug}/drafts`)}
      >
        <ChevronLeft className="size-4" />
        출시 기획 선택
      </button>

      <PageHeader
        title={title}
        description={scopeDescription(scope)}
        actions={
          <div className="flex items-center gap-2">
            {scope.kind === 'season' && scopedSeason ? (
              <Badge variant="outline">
                {formatSeasonLabel(scopedSeason)}
              </Badge>
            ) : null}
            {scope.kind === 'unassigned' ? (
              <Badge variant="muted">출시 기획 미정</Badge>
            ) : null}
            <Link
              to={newDraftHref(brand.slug, scope, scopedSeason?.id ?? null)}
            >
              <Button type="button">
                <Plus className="size-4" />
                기획안 추가
              </Button>
            </Link>
          </div>
        }
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          className="sm:max-w-xs"
          placeholder="PL번호, 이름, 담당자, 컬러 검색..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(e.target.value as 'all' | ProductDraftStatus)
          }
        >
          <option value="all">전체 상태</option>
          {(
            Object.keys(DRAFT_STATUS_LABEL) as ProductDraftStatus[]
          ).map((status) => (
            <option key={status} value={status}>
              {DRAFT_STATUS_LABEL[status]}
            </option>
          ))}
        </Select>
        <div className="text-sm text-muted-foreground sm:ml-auto">
          {formatNumber(visible.length)}건
          {heldCount > 0 ? ` · 보류 ${formatNumber(heldCount)}건` : ''}
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">PL번호</th>
                <th className="px-4 py-3 font-medium">상품</th>
                <th className="px-4 py-3 font-medium">담당</th>
                <th className="px-4 py-3 font-medium">컬러 / 발주</th>
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
              {draftsQuery.isLoading || seasonsQuery.isLoading ? (
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
                    {emptyMessage(scope, scopedDrafts.length > 0)}
                  </td>
                </tr>
              ) : (
                visible.map((draft) => {
                  const season = draft.seasonId
                    ? seasonMap.get(draft.seasonId)
                    : undefined
                  const total = totalOrderQty(draft)
                  return (
                    <tr
                      key={draft.id}
                      className={cn(
                        'cursor-pointer border-b border-border last:border-0 hover:bg-muted/30',
                        draft.held && 'bg-warning/5',
                      )}
                      onClick={() =>
                        navigate(`/b/${brand.slug}/drafts/${draft.id}`)
                      }
                    >
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
                              {scope.kind === 'all' && season
                                ? `${formatSeasonLabel(season)} · `
                                : scope.kind === 'all' && !season
                                  ? '출시 기획 미정 · '
                                  : ''}
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
                          {draft.held ? (
                            <Badge variant="warning">보류</Badge>
                          ) : null}
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

export function AllDraftsPage() {
  return <DraftsPage scope={{ kind: 'all' }} />
}

export function SeasonDraftsPage() {
  const { seasonCode } = useParams()
  if (!seasonCode) {
    return <DraftsPage scope={{ kind: 'all' }} />
  }
  if (seasonCode === 'unassigned') {
    return <DraftsPage scope={{ kind: 'unassigned' }} />
  }
  return (
    <DraftsPage
      scope={{ kind: 'season', code: decodeURIComponent(seasonCode) }}
    />
  )
}
