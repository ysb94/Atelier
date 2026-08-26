import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import {
  BrandFieldStoreError,
  saveBrandFieldOptions,
} from '@/lib/api'
import type { BrandField, BrandFieldOptionInput } from '@/lib/types'

type FieldOptionEditorProps = {
  field: BrandField
  onSaved: () => Promise<void> | void
}

type DraftOption = BrandFieldOptionInput & { key: string }

function toDraft(field: BrandField): DraftOption[] {
  return [...field.options]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, 'ko'))
    .map((option, index) => ({
      key: option.id,
      id: option.id,
      label: option.label,
      aliases: option.aliases,
      sortOrder: index,
      isActive: option.isActive,
    }))
}

export function FieldOptionEditor({ field, onSaved }: FieldOptionEditorProps) {
  const [drafts, setDrafts] = useState<DraftOption[]>(() => toDraft(field))
  const [newLabel, setNewLabel] = useState('')
  const [pasteText, setPasteText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const activeCount = useMemo(
    () => drafts.filter((option) => option.isActive).length,
    [drafts],
  )

  const saveMutation = useMutation({
    mutationFn: () =>
      saveBrandFieldOptions(
        field.brandId,
        field.id,
        drafts.map((option, index) => ({
          id: option.id,
          label: option.label,
          aliases: option.aliases,
          sortOrder: index,
          isActive: option.isActive,
        })),
      ),
    onSuccess: async () => {
      setError(null)
      await onSaved()
    },
    onError: (err) => {
      setError(
        err instanceof BrandFieldStoreError
          ? err.message
          : err instanceof Error
            ? err.message
            : '선택지를 저장하지 못했습니다.',
      )
    },
  })

  function addLabels(labels: string[]) {
    const existing = new Set(
      drafts.map((option) => option.label.trim().toLocaleLowerCase('ko')),
    )
    const next = [...drafts]
    for (const raw of labels) {
      const label = raw.trim()
      if (!label) continue
      const key = label.toLocaleLowerCase('ko')
      if (existing.has(key)) continue
      existing.add(key)
      next.push({
        key: `new-${next.length}-${label}`,
        label,
        aliases: [],
        sortOrder: next.length,
        isActive: true,
      })
    }
    setDrafts(next)
    setError(null)
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= drafts.length) return
    const next = [...drafts]
    const [item] = next.splice(index, 1)
    next.splice(target, 0, item)
    setDrafts(next)
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium">{field.label} 선택지</div>
          <p className="text-xs text-muted-foreground">
            활성 {activeCount}개. 이름을 바꾸면 이전 이름은 별칭으로 남고,
            목록에서 빼는 대신 사용 중지합니다.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          disabled={saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
        >
          선택지 저장
        </Button>
      </div>

      <div className="space-y-2">
        {drafts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            아직 선택지가 없습니다. 아래에서 추가하세요.
          </p>
        ) : (
          drafts.map((option, index) => (
            <div
              key={option.key}
              className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-background px-2 py-2"
            >
              <Input
                className="h-8 min-w-[12rem] flex-1"
                value={option.label}
                disabled={!option.isActive || saveMutation.isPending}
                onChange={(event) => {
                  const next = [...drafts]
                  next[index] = { ...option, label: event.target.value }
                  setDrafts(next)
                }}
              />
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="위로"
                  disabled={index === 0 || saveMutation.isPending}
                  onClick={() => move(index, -1)}
                >
                  <ChevronUp className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="아래로"
                  disabled={index === drafts.length - 1 || saveMutation.isPending}
                  onClick={() => move(index, 1)}
                >
                  <ChevronDown className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={saveMutation.isPending}
                  onClick={() => {
                    const next = [...drafts]
                    next[index] = { ...option, isActive: !option.isActive }
                    setDrafts(next)
                  }}
                >
                  {option.isActive ? '사용 중지' : '다시 사용'}
                </Button>
              </div>
              {!option.isActive ? (
                <span className="text-xs text-muted-foreground">사용 중지</span>
              ) : null}
            </div>
          ))
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="flex items-center gap-2">
          <Input
            className="h-8"
            placeholder="선택지 이름"
            value={newLabel}
            disabled={saveMutation.isPending}
            onChange={(event) => setNewLabel(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              addLabels([newLabel])
              setNewLabel('')
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!newLabel.trim() || saveMutation.isPending}
            onClick={() => {
              addLabels([newLabel])
              setNewLabel('')
            }}
          >
            <Plus className="size-3.5" />
            추가
          </Button>
        </div>
        <div className="space-y-2">
          <Textarea
            rows={3}
            placeholder="여러 줄을 붙여넣으면 한 줄이 선택지 하나가 됩니다"
            value={pasteText}
            disabled={saveMutation.isPending}
            onChange={(event) => setPasteText(event.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!pasteText.trim() || saveMutation.isPending}
            onClick={() => {
              addLabels(pasteText.split(/\r?\n/))
              setPasteText('')
            }}
          >
            붙여넣기 추가
          </Button>
        </div>
      </div>

      {error ? (
        <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}
