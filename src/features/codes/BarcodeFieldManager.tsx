import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowUp,
  Check,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import {
  BarcodeFieldStoreError,
  createBarcodeField,
  deleteBarcodeField,
  moveBarcodeField,
  updateBarcodeField,
} from '@/lib/api'
import { isLockedBarcodeField } from '@/lib/codes/barcode-fields'
import type { BarcodeField, BarcodeFieldType } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Select } from '@/components/ui/input'

type Draft = {
  label: string
  type: BarcodeFieldType
}

type BarcodeFieldManagerProps = {
  brandId: string
  fields: BarcodeField[]
  onClose: () => void
}

const TYPE_LABEL: Record<BarcodeFieldType, string> = {
  text: '텍스트',
  number: '숫자',
}

function systemLabel(field: BarcodeField) {
  if (!field.systemKey) return '추가'
  if (field.systemKey === 'code') return '식별'
  if (field.systemKey === 'name') return '필수'
  return '기본'
}

/** 자사 바코드 XLSX의 헤더와 사용자 추가 항목을 관리한다. */
export function BarcodeFieldManager({
  brandId,
  fields,
  onClose,
}: BarcodeFieldManagerProps) {
  const queryClient = useQueryClient()
  const [newLabel, setNewLabel] = useState('')
  const [newType, setNewType] = useState<BarcodeFieldType>('text')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['barcodeFields', brandId] })

  const createMutation = useMutation({
    mutationFn: () =>
      createBarcodeField(brandId, { label: newLabel, type: newType }),
    onSuccess: async () => {
      setNewLabel('')
      setNewType('text')
      setError(null)
      await invalidate()
    },
    onError: (err) =>
      setError(
        err instanceof BarcodeFieldStoreError
          ? err.message
          : '바코드 항목을 추가하지 못했습니다.',
      ),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Draft }) =>
      updateBarcodeField(id, input),
    onSuccess: async () => {
      setEditingId(null)
      setDraft(null)
      setError(null)
      await invalidate()
    },
    onError: (err) =>
      setError(
        err instanceof BarcodeFieldStoreError
          ? err.message
          : '바코드 항목을 수정하지 못했습니다.',
      ),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteBarcodeField(id),
    onSuccess: async () => {
      setError(null)
      await invalidate()
    },
    onError: (err) =>
      setError(
        err instanceof BarcodeFieldStoreError
          ? err.message
          : '바코드 항목을 삭제하지 못했습니다.',
      ),
  })

  const moveMutation = useMutation({
    mutationFn: ({
      id,
      direction,
    }: {
      id: string
      direction: 'up' | 'down'
    }) => moveBarcodeField(id, direction),
    onSuccess: async () => {
      setError(null)
      await invalidate()
    },
    onError: (err) =>
      setError(
        err instanceof BarcodeFieldStoreError
          ? err.message
          : '항목 순서를 바꾸지 못했습니다.',
      ),
  })

  const pending =
    createMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending ||
    moveMutation.isPending

  function startEdit(field: BarcodeField) {
    setError(null)
    setEditingId(field.id)
    setDraft({ label: field.label, type: field.type })
  }

  function saveEdit(field: BarcodeField) {
    if (!draft) return
    const label = draft.label.trim()
    if (!label) {
      setError('항목 이름을 입력하세요.')
      return
    }
    updateMutation.mutate({
      id: field.id,
      input: { label, type: field.systemKey ? field.type : draft.type },
    })
  }

  function confirmDelete(field: BarcodeField) {
    if (
      !window.confirm(
        `"${field.label}" 헤더를 삭제할까요?\n기존 입력값은 지우지 않고 숨겨집니다.`,
      )
    ) {
      return
    }
    deleteMutation.mutate(field.id)
  }

  return (
    <Card className="mb-4">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>바코드 항목 관리</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            이 순서와 이름이 일괄 등록·정보 수정 엑셀의 1행 헤더가 됩니다.
            88코드와 바코드 상품명은 식별·등록에 필요해 이름만 바꿀 수 있습니다.
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="w-20 px-3 py-2 font-medium">순서</th>
                <th className="px-3 py-2 font-medium">헤더명</th>
                <th className="px-3 py-2 font-medium">유형</th>
                <th className="px-3 py-2 font-medium">구분</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {fields.map((field, index) => {
                const editing = field.id === editingId && draft
                const locked = isLockedBarcodeField(field)
                return (
                  <tr
                    key={field.id}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-0.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={`${field.label} 위로`}
                          disabled={pending || index === 0}
                          onClick={() =>
                            moveMutation.mutate({
                              id: field.id,
                              direction: 'up',
                            })
                          }
                        >
                          <ArrowUp className="size-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={`${field.label} 아래로`}
                          disabled={pending || index === fields.length - 1}
                          onClick={() =>
                            moveMutation.mutate({
                              id: field.id,
                              direction: 'down',
                            })
                          }
                        >
                          <ArrowDown className="size-3.5" />
                        </Button>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {editing ? (
                        <Input
                          className="h-8"
                          autoFocus
                          value={draft.label}
                          onChange={(event) =>
                            setDraft({ ...draft, label: event.target.value })
                          }
                        />
                      ) : (
                        <span className="font-medium">{field.label}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {editing && !field.systemKey ? (
                        <Select
                          className="h-8"
                          value={draft.type}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              type: event.target.value as BarcodeFieldType,
                            })
                          }
                        >
                          <option value="text">텍스트</option>
                          <option value="number">숫자</option>
                        </Select>
                      ) : (
                        <span className="text-muted-foreground">
                          {TYPE_LABEL[field.type]}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={field.systemKey ? 'muted' : 'outline'}>
                        {systemLabel(field)}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        {editing ? (
                          <>
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
                              onClick={() => {
                                setEditingId(null)
                                setDraft(null)
                              }}
                            >
                              <X className="size-3.5" />
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              disabled={pending || Boolean(editingId)}
                              aria-label={`${field.label} 수정`}
                              onClick={() => startEdit(field)}
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                            {!locked ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="text-danger hover:bg-danger/10"
                                disabled={pending || Boolean(editingId)}
                                aria-label={`${field.label} 삭제`}
                                onClick={() => confirmDelete(field)}
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            ) : null}
                          </>
                        )}
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
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px_auto]">
            <Input
              placeholder="예: 박스 재질"
              value={newLabel}
              onChange={(event) => setNewLabel(event.target.value)}
            />
            <Select
              value={newType}
              onChange={(event) =>
                setNewType(event.target.value as BarcodeFieldType)
              }
            >
              <option value="text">텍스트</option>
              <option value="number">숫자</option>
            </Select>
            <Button
              type="button"
              disabled={pending || !newLabel.trim()}
              onClick={() => createMutation.mutate()}
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
  )
}
