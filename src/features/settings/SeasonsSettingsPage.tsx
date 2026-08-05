import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2, X, Check } from 'lucide-react'
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
import { cn } from '@/lib/utils'

const STATUS_OPTIONS = Object.keys(SEASON_STATUS_LABEL) as SeasonStatus[]

const EMPTY_FORM: SeasonInput = {
  name: '',
  releaseTiming: '',
}

function statusVariant(
  status: SeasonStatus,
): 'default' | 'success' | 'warning' | 'muted' | 'outline' {
  return status === 'archived' ? 'muted' : 'outline'
}

export function SeasonsSettingsPage() {
  const { brand } = useBrand()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<SeasonInput>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<SeasonInput | null>(null)
  const [error, setError] = useState<string | null>(null)

  const seasonsQuery = useQuery({
    queryKey: ['seasons', brand.id],
    queryFn: () => getSeasonsByBrand(brand.id),
  })

  const seasons = useMemo(() => seasonsQuery.data ?? [], [seasonsQuery.data])

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

  function startEdit(season: Season) {
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

  function handleDelete(season: Season) {
    const ok = window.confirm(
      `"${formatSeasonLabel(season)}"을(를) 삭제할까요?\n상품이 연결된 출시 기획은 삭제할 수 없습니다.`,
    )
    if (!ok) return
    deleteMutation.mutate(season.id)
  }

  return (
    <div>
      <PageHeader
        title="출시 기획"
        description={`${brand.name}의 출시 묶음을 등록합니다. 코드는 자동으로 만들어집니다.`}
      />

      <Card className="mb-6">
        <CardContent className="space-y-3 p-4">
          <h2 className="text-sm font-semibold">출시 기획 추가</h2>
          <form
            className="grid gap-2 sm:grid-cols-[1fr_1.2fr_auto]"
            onSubmit={(event) => {
              event.preventDefault()
              if (!form.name.trim()) return
              createMutation.mutate()
            }}
          >
            <Input
              placeholder="출시 예정 (예: 26.03 말)"
              value={form.releaseTiming}
              onChange={(e) => {
                setForm((prev) => ({
                  ...prev,
                  releaseTiming: e.target.value,
                }))
                setError(null)
              }}
            />
            <Input
              placeholder="기획 이름 (예: SS, 1학기 신학기)"
              value={form.name}
              onChange={(e) => {
                setForm((prev) => ({ ...prev, name: e.target.value }))
                setError(null)
              }}
            />
            <Button
              type="submit"
              disabled={!form.name.trim() || createMutation.isPending}
            >
              <Plus className="size-4" />
              추가
            </Button>
          </form>
        </CardContent>
      </Card>

      {error ? (
        <p className="mb-4 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">출시 예정</th>
                <th className="px-4 py-3 font-medium">기획 이름</th>
                <th className="px-4 py-3 font-medium">상태</th>
                <th className="px-4 py-3 font-medium text-right">작업</th>
              </tr>
            </thead>
            <tbody>
              {seasonsQuery.isLoading ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-10 text-center text-muted-foreground"
                  >
                    불러오는 중...
                  </td>
                </tr>
              ) : seasons.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-10 text-center text-muted-foreground"
                  >
                    등록된 출시 기획이 없습니다.
                  </td>
                </tr>
              ) : (
                seasons.map((season) => {
                  const editing = editingId === season.id && draft
                  return (
                    <tr
                      key={season.id}
                      className={cn(
                        'border-b border-border last:border-0',
                        editing ? 'bg-accent/40' : '',
                      )}
                    >
                      {editing ? (
                        <>
                          <td className="px-4 py-2">
                            <Input
                              className="h-8"
                              placeholder="26.03 말"
                              value={draft.releaseTiming}
                              disabled={updateMutation.isPending}
                              onChange={(e) =>
                                setDraft((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        releaseTiming: e.target.value,
                                      }
                                    : prev,
                                )
                              }
                            />
                          </td>
                          <td className="px-4 py-2">
                            <Input
                              className="h-8"
                              placeholder="기획 이름"
                              value={draft.name}
                              disabled={updateMutation.isPending}
                              onChange={(e) =>
                                setDraft((prev) =>
                                  prev
                                    ? { ...prev, name: e.target.value }
                                    : prev,
                                )
                              }
                            />
                          </td>
                          <td className="px-4 py-2">
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
                              {STATUS_OPTIONS.map((status) => (
                                <option key={status} value={status}>
                                  {SEASON_STATUS_LABEL[status]}
                                </option>
                              ))}
                            </Select>
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex justify-end gap-1">
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                disabled={
                                  !draft.name.trim() ||
                                  updateMutation.isPending
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
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-4 py-3 text-muted-foreground">
                            {season.releaseTiming || '—'}
                          </td>
                          <td className="px-4 py-3 font-medium">
                            {season.name}
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant={statusVariant(season.status)}>
                              {SEASON_STATUS_LABEL[season.status]}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex justify-end gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label="수정"
                                onClick={() => startEdit(season)}
                              >
                                <Pencil className="size-3.5" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="text-danger hover:bg-danger/10 hover:text-danger"
                                aria-label="삭제"
                                disabled={deleteMutation.isPending}
                                onClick={() => handleDelete(season)}
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </div>
                          </td>
                        </>
                      )}
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
