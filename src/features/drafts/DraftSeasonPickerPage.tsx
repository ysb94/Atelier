import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  Archive,
  ArchiveRestore,
  Check,
  FolderOpen,
  HelpCircle,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { useBrand } from '@/components/layout/brand-context'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input, Select } from '@/components/ui/input'
import {
  SeasonStoreError,
  createSeason,
  deleteSeason,
  getProductDrafts,
  getSeasonsByBrand,
  updateSeason,
} from '@/lib/api'
import {
  SEASON_STATUS_LABEL,
  formatSeasonLabel,
  type Season,
  type SeasonInput,
  type SeasonStatus,
} from '@/lib/types'
import { cn, formatNumber } from '@/lib/utils'

const EMPTY_FORM: SeasonInput = {
  name: '',
  releaseTiming: '',
}

function statusVariant(
  status: SeasonStatus,
): 'default' | 'success' | 'warning' | 'muted' | 'outline' {
  return status === 'archived' ? 'muted' : 'outline'
}

const STATUS_ORDER: SeasonStatus[] = ['active', 'archived']

/** 마감은 자료 보관용이라 기본으로 접어 둔다. */
const DEFAULT_HIDDEN_STATUSES = new Set<SeasonStatus>(['archived'])

export function DraftSeasonPickerPage() {
  const { brand } = useBrand()
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<SeasonInput>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<SeasonInput | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hiddenStatuses, setHiddenStatuses] = useState<Set<SeasonStatus>>(
    () => new Set(DEFAULT_HIDDEN_STATUSES),
  )

  const seasonsQuery = useQuery({
    queryKey: ['seasons', brand.id],
    queryFn: () => getSeasonsByBrand(brand.id),
  })
  const draftsQuery = useQuery({
    queryKey: ['product-drafts', brand.id],
    queryFn: () => getProductDrafts(brand.id),
  })

  const seasons = seasonsQuery.data ?? []
  const drafts = draftsQuery.data ?? []

  const statusCounts = useMemo(() => {
    const map = new Map<SeasonStatus, number>()
    for (const season of seasons) {
      map.set(season.status, (map.get(season.status) ?? 0) + 1)
    }
    return map
  }, [seasons])

  function toggleStatus(status: SeasonStatus) {
    setHiddenStatuses((prev) => {
      const next = new Set(prev)
      if (next.has(status)) next.delete(status)
      else next.add(status)
      return next
    })
  }

  const counts = useMemo(() => {
    const bySeason = new Map<string, { total: number; held: number }>()
    let unassigned = 0
    let unassignedHeld = 0

    for (const item of drafts) {
      if (!item.seasonId) {
        unassigned += 1
        if (item.held) unassignedHeld += 1
        continue
      }
      const current = bySeason.get(item.seasonId) ?? { total: 0, held: 0 }
      current.total += 1
      if (item.held) current.held += 1
      bySeason.set(item.seasonId, current)
    }

    return {
      total: drafts.length,
      held: drafts.filter((d) => d.held).length,
      unassigned,
      unassignedHeld,
      bySeason,
    }
  }, [drafts])

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['seasons', brand.id] })
  }

  function showError(err: unknown) {
    setError(
      err instanceof SeasonStoreError
        ? err.message
        : err instanceof Error
          ? err.message
          : '출시 기획을 저장하지 못했습니다.',
    )
  }

  const createMutation = useMutation({
    mutationFn: () => createSeason(brand.id, form),
    onSuccess: async () => {
      setForm(EMPTY_FORM)
      setCreating(false)
      setError(null)
      await invalidate()
    },
    onError: showError,
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: SeasonInput }) =>
      updateSeason(id, input),
    onSuccess: async () => {
      setEditingId(null)
      setDraft(null)
      setError(null)
      await invalidate()
    },
    onError: showError,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteSeason(id),
    onSuccess: async () => {
      setError(null)
      await invalidate()
    },
    onError: showError,
  })

  function startCreate() {
    setCreating(true)
    setEditingId(null)
    setDraft(null)
    setForm(EMPTY_FORM)
    setError(null)
  }

  function cancelCreate() {
    setCreating(false)
    setForm(EMPTY_FORM)
    setError(null)
  }

  function startEdit(season: Season) {
    setCreating(false)
    setEditingId(season.id)
    setDraft({
      name: season.name,
      releaseTiming: season.releaseTiming,
      status: season.status,
    })
    setError(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setDraft(null)
  }

  function toggleArchived(season: Season) {
    updateMutation.mutate({
      id: season.id,
      input: {
        name: season.name,
        releaseTiming: season.releaseTiming,
        status: season.status === 'archived' ? 'active' : 'archived',
      },
    })
  }

  function handleDelete(season: Season, draftCount: number) {
    if (draftCount > 0) return
    const ok = window.confirm(
      `"${formatSeasonLabel(season)}"을(를) 삭제할까요?\n상품이나 기획안이 연결된 출시 기획은 삭제할 수 없습니다.`,
    )
    if (!ok) return
    deleteMutation.mutate(season.id)
  }

  const loading = seasonsQuery.isLoading || draftsQuery.isLoading
  const hasSeasons = seasons.length > 0

  useEffect(() => {
    if (!loading && !hasSeasons) {
      setCreating(true)
    }
  }, [loading, hasSeasons])

  return (
    <div>
      <PageHeader
        title="기획안"
        description={
          hasSeasons
            ? '출시 기획을 선택하세요. 아직 묶지 않은 기획은 미정에서 엽니다.'
            : '출시 기획을 먼저 만든 뒤, 기획안을 출시 묶음별로 정리할 수 있습니다.'
        }
        actions={
          hasSeasons ? (
            <Button type="button" onClick={startCreate} disabled={creating}>
              <Plus className="size-4" />
              새 출시 기획
            </Button>
          ) : null
        }
      />

      {!loading && !hasSeasons ? (
        <Card className="mb-6 border-accent">
          <CardContent className="space-y-4 p-6">
            <div>
              <h2 className="text-sm font-semibold">기획안을 시작하려면</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                출시 기획은 SS, 홀리데이처럼 상품을 묶는 단위입니다. 출시
                기획을 만든 뒤 기획안을 작성하거나, 출시 시기가 정해지지 않은
                아이디어는 &quot;출시 기획 미정&quot;에 둘 수 있습니다.
              </p>
            </div>
            {!creating ? (
              <Button type="button" onClick={startCreate}>
                <Plus className="size-4" />
                첫 출시 기획 만들기
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {error ? (
        <p className="mb-4 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {creating ? (
        <Card className="mb-6 border-accent">
          <CardContent className="space-y-3 p-4">
            <h2 className="text-sm font-semibold">새 출시 기획</h2>
            <form
              className="grid gap-3 sm:grid-cols-[1fr_1.2fr_auto]"
              onSubmit={(event) => {
                event.preventDefault()
                if (!form.name.trim()) return
                createMutation.mutate()
              }}
            >
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  출시 예정
                </span>
                <Input
                  placeholder="26.03 말, 일정 미정"
                  value={form.releaseTiming}
                  autoFocus
                  onChange={(e) => {
                    setForm((prev) => ({
                      ...prev,
                      releaseTiming: e.target.value,
                    }))
                    setError(null)
                  }}
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  기획 이름
                </span>
                <Input
                  placeholder="SS, 1학기 신학기, 홀리데이"
                  value={form.name}
                  onChange={(e) => {
                    setForm((prev) => ({ ...prev, name: e.target.value }))
                    setError(null)
                  }}
                />
              </label>
              <div className="flex items-end gap-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={cancelCreate}
                  disabled={createMutation.isPending}
                >
                  취소
                </Button>
                <Button
                  type="submit"
                  disabled={!form.name.trim() || createMutation.isPending}
                >
                  {createMutation.isPending ? '만드는 중...' : '만들기'}
                </Button>
              </div>
            </form>
            {form.name.trim() || form.releaseTiming.trim() ? (
              <p className="text-xs text-muted-foreground">
                표시 예:{' '}
                <span className="font-medium text-foreground">
                  {formatSeasonLabel({
                    name: form.name || '기획 이름',
                    releaseTiming: form.releaseTiming,
                  })}
                </span>
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {!loading && seasons.length > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-muted-foreground">상태</span>
          {STATUS_ORDER.map((status) => {
            const on = !hiddenStatuses.has(status)
            const count = statusCounts.get(status) ?? 0
            if (count === 0 && status !== 'active') return null
            return (
              <button
                key={status}
                type="button"
                onClick={() => toggleStatus(status)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors',
                  on
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-muted',
                )}
              >
                <span
                  className={cn(
                    'size-1.5 rounded-full bg-current',
                    !on && 'opacity-40',
                  )}
                />
                {SEASON_STATUS_LABEL[status]}
                <span className="tabular-nums opacity-70">{count}</span>
              </button>
            )
          })}
        </div>
      ) : null}

      {loading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          불러오는 중...
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {hasSeasons ? (
            <>
          <Link
            to={`/b/${brand.slug}/drafts/all`}
            className="group rounded-xl border border-border bg-card p-4 shadow-sm transition-colors hover:border-foreground/20 hover:bg-muted/30"
          >
            <div className="mb-3 flex items-center gap-2">
              <FolderOpen className="size-4 text-muted-foreground" />
              <span className="text-sm font-semibold">전체 기획안</span>
            </div>
            <p className="text-2xl font-semibold tabular-nums">
              {formatNumber(counts.total)}
              <span className="ml-1 text-sm font-normal text-muted-foreground">
                건
              </span>
            </p>
            {counts.held > 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">
                보류 {formatNumber(counts.held)}건
              </p>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">
                출시 기획 구분 없이 한 번에 봅니다.
              </p>
            )}
          </Link>

          <Link
            to={`/b/${brand.slug}/drafts/season/unassigned`}
            className="group rounded-xl border border-dashed border-border bg-card p-4 shadow-sm transition-colors hover:border-foreground/20 hover:bg-muted/30"
          >
            <div className="mb-3 flex items-center gap-2">
              <HelpCircle className="size-4 text-muted-foreground" />
              <span className="text-sm font-semibold">출시 기획 미정</span>
            </div>
            <p className="text-2xl font-semibold tabular-nums">
              {formatNumber(counts.unassigned)}
              <span className="ml-1 text-sm font-normal text-muted-foreground">
                건
              </span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              출시 시기를 정하지 않고 먼저 잡아둔 기획
              {counts.unassignedHeld > 0
                ? ` · 보류 ${formatNumber(counts.unassignedHeld)}건`
                : ''}
            </p>
          </Link>

          {seasons
            .filter(
              (season) =>
                !hiddenStatuses.has(season.status) ||
                season.id === editingId,
            )
            .map((season) => {
            const stat = counts.bySeason.get(season.id) ?? {
              total: 0,
              held: 0,
            }
            const editing = editingId === season.id && draft
            const canDelete = stat.total === 0
            const label = formatSeasonLabel(season)

            if (editing) {
              return (
                <div
                  key={season.id}
                  className="rounded-xl border border-accent bg-accent/30 p-4 shadow-sm"
                >
                  <div className="space-y-2">
                    <label className="block space-y-1">
                      <span className="text-xs text-muted-foreground">
                        출시 예정
                      </span>
                      <Input
                        className="h-8"
                        placeholder="26.03 말"
                        value={draft.releaseTiming}
                        disabled={updateMutation.isPending}
                        onChange={(e) =>
                          setDraft((prev) =>
                            prev
                              ? { ...prev, releaseTiming: e.target.value }
                              : prev,
                          )
                        }
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-xs text-muted-foreground">
                        기획 이름
                      </span>
                      <Input
                        className="h-8"
                        placeholder="SS, 1학기 신학기"
                        value={draft.name}
                        disabled={updateMutation.isPending}
                        onChange={(e) =>
                          setDraft((prev) =>
                            prev ? { ...prev, name: e.target.value } : prev,
                          )
                        }
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-xs text-muted-foreground">
                        상태
                      </span>
                      <Select
                        className="h-8"
                        value={draft.status ?? season.status}
                        disabled={updateMutation.isPending}
                        onChange={(e) =>
                          setDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  status: e.target.value as SeasonStatus,
                                }
                              : prev,
                          )
                        }
                      >
                        {(
                          Object.keys(SEASON_STATUS_LABEL) as SeasonStatus[]
                        ).map((status) => (
                          <option key={status} value={status}>
                            {SEASON_STATUS_LABEL[status]}
                          </option>
                        ))}
                      </Select>
                    </label>
                    <div className="flex justify-end gap-1 pt-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        disabled={
                          !draft.name.trim() || updateMutation.isPending
                        }
                        onClick={() =>
                          updateMutation.mutate({
                            id: season.id,
                            input: draft,
                          })
                        }
                      >
                        <Check className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={cancelEdit}
                      >
                        <X className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              )
            }

            return (
              <div
                key={season.id}
                className="relative rounded-xl border border-border bg-card p-4 shadow-sm transition-colors hover:border-foreground/20 hover:bg-muted/30"
              >
                <Link
                  to={`/b/${brand.slug}/drafts/season/${encodeURIComponent(season.code)}`}
                  className="block pr-24"
                >
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      {season.releaseTiming || '출시 일정 미정'}
                    </span>
                    {season.status === 'archived' ? (
                      <Badge variant={statusVariant(season.status)}>
                        {SEASON_STATUS_LABEL[season.status]}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="truncate text-sm font-semibold">{season.name}</p>
                  <p className="mt-3 text-2xl font-semibold tabular-nums">
                    {formatNumber(stat.total)}
                    <span className="ml-1 text-sm font-normal text-muted-foreground">
                      건
                    </span>
                  </p>
                  {stat.held > 0 ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      보류 {formatNumber(stat.held)}건
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">
                      이 출시 기획 열기
                    </p>
                  )}
                </Link>
                <div className="absolute right-3 top-3 flex gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={
                      season.status === 'archived'
                        ? `${label} 다시 진행 중으로`
                        : `${label} 마감`
                    }
                    title={
                      season.status === 'archived'
                        ? '다시 진행 중으로'
                        : '마감하고 보관하기'
                    }
                    disabled={updateMutation.isPending}
                    onClick={() => toggleArchived(season)}
                  >
                    {season.status === 'archived' ? (
                      <ArchiveRestore className="size-3.5" />
                    ) : (
                      <Archive className="size-3.5" />
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`${label} 수정`}
                    onClick={() => startEdit(season)}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={cn(
                      'text-danger hover:bg-danger/10 hover:text-danger',
                      !canDelete && 'opacity-40',
                    )}
                    aria-label={`${label} 삭제`}
                    title={
                      canDelete
                        ? '삭제'
                        : '기획안이 있어 삭제할 수 없습니다'
                    }
                    disabled={!canDelete || deleteMutation.isPending}
                    onClick={() => handleDelete(season, stat.total)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            )
          })}
            </>
          ) : null}
        </div>
      )}
    </div>
  )
}
