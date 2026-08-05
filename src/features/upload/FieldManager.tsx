import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Download, Pencil, Plus, Trash2, X } from 'lucide-react'
import {
  BrandFieldStoreError,
  createBrandField,
  deleteBrandField,
  updateBrandField,
} from '@/lib/api'
import type { BrandField, FieldOwner, FieldType } from '@/lib/types'
import { OWNER_LABEL, OWNER_ORDER } from '@/lib/import/fields'
import { downloadUploadTemplate } from '@/lib/import/template'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Select } from '@/components/ui/input'

const TYPE_OPTIONS: { value: FieldType; label: string }[] = [
  { value: 'text', label: '텍스트' },
  { value: 'number', label: '숫자' },
  { value: 'list', label: '목록' },
  { value: 'gender', label: '성별' },
  { value: 'season', label: '시즌' },
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

function isLocked(field: BrandField) {
  return field.systemKey === 'styleNo'
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

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['brandFields', brandId] })

  const createMutation = useMutation({
    mutationFn: () =>
      createBrandField(brandId, { label, type, owner, required }),
    onSuccess: async () => {
      setLabel('')
      setRequired(false)
      setError(null)
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
    mutationFn: (id: string) => deleteBrandField(id),
    onSuccess: async () => {
      if (editingId) {
        setEditingId(null)
        setDraft(null)
      }
      setError(null)
      await invalidate()
    },
    onError: (err) => {
      setError(
        err instanceof BrandFieldStoreError
          ? err.message
          : '항목을 삭제하지 못했습니다.',
      )
    },
  })

  function startEdit(field: BrandField) {
    if (isLocked(field)) return
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
      type: field.systemKey ? field.type : draft.type,
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
              이 목록이 양식 헤더와 상품 표 컬럼의 기준입니다. 항목을
              추가·수정·삭제할 수 있고, 품번은 고정입니다. 기본 항목은 유형과
              삭제만 제한됩니다.
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
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
                <tr>
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
                  const locked = isLocked(field)
                  const system = Boolean(field.systemKey)

                  if (editing) {
                    return (
                      <tr
                        key={field.id}
                        className="border-b border-border bg-accent/30 last:border-0"
                      >
                        <td className="px-3 py-2">
                          <Input
                            value={draft.label}
                            onChange={(e) =>
                              setDraft({ ...draft, label: e.target.value })
                            }
                            className="h-8"
                            autoFocus
                          />
                        </td>
                        <td className="px-3 py-2">
                          {system ? (
                            <span className="text-muted-foreground">
                              {typeLabel(field.type)}
                            </span>
                          ) : (
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
                              {TYPE_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </Select>
                          )}
                        </td>
                        <td className="px-3 py-2">
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
                        </td>
                        <td className="px-3 py-2">
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
                          {!locked ? (
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
                          ) : null}
                          {!system ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="text-danger hover:bg-danger/10"
                              aria-label={`${field.label} 삭제`}
                              disabled={pending || Boolean(editingId)}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `"${field.label}" 항목을 삭제할까요?`,
                                  )
                                ) {
                                  deleteMutation.mutate(field.id)
                                }
                              }}
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
