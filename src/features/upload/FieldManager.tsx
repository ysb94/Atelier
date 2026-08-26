import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Download, List, Pencil, Plus, Trash2, X } from 'lucide-react'
import {
  BrandFieldStoreError,
  createBrandField,
  deleteBrandField,
  getSeasonsByBrand,
  updateBrandField,
} from '@/lib/api'
import type { BrandField, FieldOwner, FieldType } from '@/lib/types'
import { OWNER_LABEL, OWNER_ORDER } from '@/lib/import/fields'
import { downloadUploadTemplate } from '@/lib/import/template'
import { canEditFieldType } from '@/lib/products/brand-field-select'
import { FieldOptionEditor } from '@/features/upload/FieldOptionEditor'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Select } from '@/components/ui/input'

const TYPE_OPTIONS: { value: FieldType; label: string }[] = [
  { value: 'text', label: '텍스트' },
  { value: 'number', label: '숫자' },
  { value: 'list', label: '목록' },
  { value: 'select', label: '단일 선택' },
  { value: 'gender', label: '성별' },
  { value: 'season', label: '시즌' },
  { value: 'image', label: '이미지' },
]

const SYSTEM_SELECT_TYPE_OPTIONS: { value: FieldType; label: string }[] = [
  { value: 'text', label: '텍스트' },
  { value: 'select', label: '단일 선택' },
]

type Draft = {
  label: string
  type: FieldType
  owner: FieldOwner
  required: boolean
}

type FieldManagerProps = {
  brandId: string
  brandName: string
  fields: BrandField[]
}

function typeLabel(type: FieldType) {
  return TYPE_OPTIONS.find((t) => t.value === type)?.label ?? type
}

function typeOptionsFor(field: BrandField) {
  if (!field.systemKey) return TYPE_OPTIONS
  if (canEditFieldType(field)) return SYSTEM_SELECT_TYPE_OPTIONS
  return null
}

/** 품번(styleNo)은 삭제 불가. 표시 이름만 수정 가능 */
function isStyleNoField(field: BrandField) {
  return field.systemKey === 'styleNo'
}

function isDeletable(field: BrandField) {
  return !isStyleNoField(field)
}

export function FieldManager({ brandId, brandName, fields }: FieldManagerProps) {
  const queryClient = useQueryClient()
  const [label, setLabel] = useState('')
  const [type, setType] = useState<FieldType>('text')
  const [owner, setOwner] = useState<FieldOwner>('planning')
  const [required, setRequired] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ownerFilter, setOwnerFilter] = useState<FieldOwner | 'all'>('all')
  const [downloading, setDownloading] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [optionsFieldId, setOptionsFieldId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const seasonsQuery = useQuery({
    queryKey: ['seasons', brandId],
    queryFn: () => getSeasonsByBrand(brandId),
  })

  const deletableIds = useMemo(
    () => fields.filter(isDeletable).map((field) => field.id),
    [fields],
  )

  useEffect(() => {
    setSelectedIds((prev) => {
      const allowed = new Set(deletableIds)
      let changed = false
      const next = new Set<string>()
      for (const id of prev) {
        if (allowed.has(id)) next.add(id)
        else changed = true
      }
      return changed || next.size !== prev.size ? next : prev
    })
  }, [deletableIds])

  const optionsField = useMemo(
    () => fields.find((field) => field.id === optionsFieldId) ?? null,
    [fields, optionsFieldId],
  )

  const selectedCount = selectedIds.size
  const allDeletableSelected =
    deletableIds.length > 0 && deletableIds.every((id) => selectedIds.has(id))

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['brandFields', brandId] }),
      queryClient.invalidateQueries({ queryKey: ['brand-fields', brandId] }),
    ])
  }

  const createMutation = useMutation({
    mutationFn: () =>
      createBrandField(brandId, { label, type, owner, required }),
    onSuccess: async (created) => {
      setLabel('')
      setRequired(false)
      setError(null)
      if (created.type === 'select') setOptionsFieldId(created.id)
      await invalidate()
    },
    onError: (err) => {
      setError(
        err instanceof BrandFieldStoreError
          ? err.message
          : '항목을 추가하지 못했습니다.',
      )
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Draft }) =>
      updateBrandField(id, patch),
    onSuccess: async () => {
      setEditingId(null)
      setDraft(null)
      setError(null)
      await invalidate()
    },
    onError: (err) => {
      setError(
        err instanceof BrandFieldStoreError
          ? err.message
          : '항목을 수정하지 못했습니다.',
      )
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const failures: string[] = []
      for (const id of ids) {
        try {
          await deleteBrandField(id)
        } catch (err) {
          failures.push(
            err instanceof Error ? err.message : '삭제에 실패했습니다.',
          )
        }
      }
      if (failures.length > 0) {
        throw new Error(
          failures.length === ids.length
            ? failures[0]
            : `${ids.length - failures.length}개 삭제, ${failures.length}개 실패`,
        )
      }
    },
    onSuccess: async () => {
      if (editingId) {
        setEditingId(null)
        setDraft(null)
      }
      setSelectedIds(new Set())
      setError(null)
      await invalidate()
    },
    onError: (err) => {
      setError(
        err instanceof Error ? err.message : '항목을 삭제하지 못했습니다.',
      )
      void invalidate()
    },
  })

  function toggleSelected(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function toggleSelectAll(checked: boolean) {
    setSelectedIds(checked ? new Set(deletableIds) : new Set())
  }

  function confirmDelete(ids: string[], labels: string[]) {
    if (ids.length === 0) return
    const message =
      ids.length === 1
        ? `"${labels[0]}" 항목을 삭제할까요?`
        : `선택한 ${ids.length}개 항목을 삭제할까요?\n${labels.slice(0, 5).join(', ')}${
            labels.length > 5 ? ' …' : ''
          }`
    if (!window.confirm(message)) return
    deleteMutation.mutate(ids)
  }

  function startEdit(field: BrandField) {
    setError(null)
    setEditingId(field.id)
    setDraft({
      label: field.label,
      type: field.type,
      owner: field.owner,
      required: field.required,
    })
  }

  function cancelEdit() {
    setEditingId(null)
    setDraft(null)
  }

  function saveEdit(field: BrandField) {
    if (!draft) return
    const patch: Draft = {
      label: draft.label.trim(),
      type: canEditFieldType(field) ? draft.type : field.type,
      owner: draft.owner,
      required: draft.required,
    }
    if (!patch.label) {
      setError('항목 이름을 입력하세요.')
      return
    }
    updateMutation.mutate({ id: field.id, patch })
  }

  async function handleDownload() {
    setDownloading(true)
    setError(null)
    try {
      await downloadUploadTemplate({
        brandName,
        fields,
        ownerFilter,
        seasons: seasonsQuery.data ?? [],
      })
    } catch (err) {
      setError(
        err instanceof Error ? err.message : '양식을 다운로드하지 못했습니다.',
      )
    } finally {
      setDownloading(false)
    }
  }

  const pending =
    createMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>업로드 항목 (헤더)</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              이 목록이 양식 헤더와 상품 표 컬럼의 기준입니다. 체크해 여러 항목을
              한 번에 삭제할 수 있습니다. 식별 항목(기본 품번)은 표시 이름만
              바꿀 수 있고 삭제할 수 없습니다.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={ownerFilter}
              onChange={(e) =>
                setOwnerFilter(e.target.value as FieldOwner | 'all')
              }
            >
              <option value="all">전체 부서 양식</option>
              {OWNER_ORDER.filter((o) => o !== 'common').map((o) => (
                <option key={o} value={o}>
                  {OWNER_LABEL[o]} 양식
                </option>
              ))}
            </Select>
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleDownload()}
              disabled={downloading || fields.length === 0}
            >
              <Download className="size-4" />
              {downloading ? '준비 중...' : '양식 다운로드'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {selectedCount > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
              <span className="text-sm tabular-nums">
                {selectedCount}개 선택
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-danger hover:bg-danger/10"
                disabled={pending}
                onClick={() => {
                  const targets = fields.filter((field) =>
                    selectedIds.has(field.id),
                  )
                  confirmDelete(
                    targets.map((field) => field.id),
                    targets.map((field) => field.label),
                  )
                }}
              >
                <Trash2 className="size-3.5" />
                선택 삭제
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => setSelectedIds(new Set())}
              >
                선택 해제
              </Button>
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="w-10 px-3 py-2 font-medium">
                    <input
                      type="checkbox"
                      className="size-4"
                      aria-label="삭제 가능한 항목 전체 선택"
                      checked={allDeletableSelected}
                      disabled={deletableIds.length === 0 || pending}
                      onChange={(e) => toggleSelectAll(e.target.checked)}
                    />
                  </th>
                  <th className="px-3 py-2 font-medium">항목명</th>
                  <th className="px-3 py-2 font-medium">유형</th>
                  <th className="px-3 py-2 font-medium">부서</th>
                  <th className="px-3 py-2 font-medium">필수</th>
                  <th className="px-3 py-2 font-medium">구분</th>
                  <th className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {fields.map((field) => {
                  const editing = editingId === field.id && draft
                  const styleNo = isStyleNoField(field)
                  const deletable = isDeletable(field)
                  const system = Boolean(field.systemKey)
                  const checked = selectedIds.has(field.id)

                  if (editing) {
                    return (
                      <tr
                        key={field.id}
                        className="border-b border-border bg-accent/30 last:border-0"
                      >
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            className="size-4"
                            checked={checked}
                            disabled={!deletable || pending}
                            aria-label={`${field.label} 선택`}
                            onChange={(e) =>
                              toggleSelected(field.id, e.target.checked)
                            }
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            value={draft.label}
                            onChange={(e) =>
                              setDraft({ ...draft, label: e.target.value })
                            }
                            className="h-8"
                            autoFocus
                            placeholder={styleNo ? '예: M번호' : undefined}
                          />
                        </td>
                        <td className="px-3 py-2">
                          {typeOptionsFor(field) ? (
                            <Select
                              value={draft.type}
                              onChange={(e) =>
                                setDraft({
                                  ...draft,
                                  type: e.target.value as FieldType,
                                })
                              }
                              className="h-8 w-full"
                            >
                              {typeOptionsFor(field)!.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </Select>
                          ) : (
                            <span className="text-muted-foreground">
                              {typeLabel(field.type)}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {styleNo ? (
                            <span className="text-muted-foreground">
                              {OWNER_LABEL[field.owner]}
                            </span>
                          ) : (
                            <Select
                              value={draft.owner}
                              onChange={(e) =>
                                setDraft({
                                  ...draft,
                                  owner: e.target.value as FieldOwner,
                                })
                              }
                              className="h-8 w-full"
                            >
                              {OWNER_ORDER.map((o) => (
                                <option key={o} value={o}>
                                  {OWNER_LABEL[o]}
                                </option>
                              ))}
                            </Select>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {styleNo ? (
                            field.required ? (
                              <Badge variant="success">필수</Badge>
                            ) : (
                              <Badge variant="outline">선택</Badge>
                            )
                          ) : (
                            <label className="flex items-center gap-2 text-xs">
                              <input
                                type="checkbox"
                                className="size-4"
                                checked={draft.required}
                                onChange={(e) =>
                                  setDraft({
                                    ...draft,
                                    required: e.target.checked,
                                  })
                                }
                              />
                              필수
                            </label>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {system ? (
                            <Badge variant="muted">기본</Badge>
                          ) : (
                            <Badge variant="outline">추가</Badge>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              disabled={pending || !draft.label.trim()}
                              aria-label="저장"
                              onClick={() => saveEdit(field)}
                            >
                              <Check className="size-3.5" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              disabled={pending}
                              aria-label="취소"
                              onClick={cancelEdit}
                            >
                              <X className="size-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  }

                  return (
                    <tr
                      key={field.id}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          className="size-4"
                          checked={checked}
                          disabled={!deletable || pending}
                          title={
                            styleNo
                              ? '식별 항목은 삭제할 수 없습니다.'
                              : undefined
                          }
                          aria-label={`${field.label} 선택`}
                          onChange={(e) =>
                            toggleSelected(field.id, e.target.checked)
                          }
                        />
                      </td>
                      <td className="px-3 py-2 font-medium">{field.label}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {typeLabel(field.type)}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {OWNER_LABEL[field.owner]}
                      </td>
                      <td className="px-3 py-2">
                        {field.required ? (
                          <Badge variant="success">필수</Badge>
                        ) : (
                          <Badge variant="outline">선택</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {system ? (
                          <Badge variant="muted">기본</Badge>
                        ) : (
                          <Badge variant="outline">추가</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          {field.type === 'select' ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={`${field.label} 선택지 관리`}
                              disabled={pending}
                              onClick={() =>
                                setOptionsFieldId((current) =>
                                  current === field.id ? null : field.id,
                                )
                              }
                            >
                              <List className="size-3.5" />
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`${field.label} 수정`}
                            disabled={pending || Boolean(editingId)}
                            onClick={() => startEdit(field)}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          {deletable ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="text-danger hover:bg-danger/10"
                              aria-label={`${field.label} 삭제`}
                              disabled={pending || Boolean(editingId)}
                              onClick={() =>
                                confirmDelete([field.id], [field.label])
                              }
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {optionsField ? (
            <FieldOptionEditor
              key={`${optionsField.id}:${optionsField.options.length}:${optionsField.options.map((option) => option.id).join(',')}`}
              field={optionsField}
              onSaved={invalidate}
            />
          ) : null}

          <div className="rounded-lg border border-dashed border-border p-4">
            <div className="mb-3 text-sm font-medium">항목 추가</div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Input
                placeholder="항목명 (헤더)"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
              <Select
                value={type}
                onChange={(e) => setType(e.target.value as FieldType)}
              >
                {TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
              <Select
                value={owner}
                onChange={(e) => setOwner(e.target.value as FieldOwner)}
              >
                {OWNER_ORDER.map((o) => (
                  <option key={o} value={o}>
                    {OWNER_LABEL[o]}
                  </option>
                ))}
              </Select>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={required}
                  onChange={(e) => setRequired(e.target.checked)}
                />
                신규 시 필수
              </label>
              <Button
                type="button"
                onClick={() => createMutation.mutate()}
                disabled={!label.trim() || pending}
              >
                <Plus className="size-4" />
                추가
              </Button>
            </div>
          </div>

          {error ? (
            <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
