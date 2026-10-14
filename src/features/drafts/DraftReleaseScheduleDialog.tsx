import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import type { Brand, ProductDraft } from '@/lib/types'
import { cn } from '@/lib/utils'
import {
  RELEASE_CERTAINTY_LABEL,
  formatReleaseGroupLabel,
  newTempGroupId,
  type PreviewReleaseGroup,
  type ReleaseCertainty,
  type ResolvedReleaseSchedule,
} from './release-schedule-preview'

export type ReleaseScheduleApplyValue = {
  brandId: string
  group: PreviewReleaseGroup
  targetDate: string | null
  certainty: ReleaseCertainty
}

type DraftReleaseScheduleDialogProps = {
  open: boolean
  draft: ProductDraft | null
  draftLabel: string
  brands: Brand[]
  groups: PreviewReleaseGroup[]
  initial: ResolvedReleaseSchedule | null
  onClose: () => void
  onApply: (value: ReleaseScheduleApplyValue) => void | Promise<void>
  onClear: () => void | Promise<void>
}

const NEW_GROUP_VALUE = '__new__'

export function DraftReleaseScheduleDialog({
  open,
  draft,
  draftLabel,
  brands,
  groups,
  initial,
  onClose,
  onApply,
  onClear,
}: DraftReleaseScheduleDialogProps) {
  const titleId = useId()
  const lastFocusRef = useRef<HTMLElement | null>(null)
  const wasOpenRef = useRef(false)
  const savingRef = useRef(false)
  const [brandId, setBrandId] = useState('')
  const [groupId, setGroupId] = useState('')
  const [newName, setNewName] = useState('')
  const [newTiming, setNewTiming] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [certainty, setCertainty] = useState<ReleaseCertainty>('tentative')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const brandGroups = useMemo(
    () => groups.filter((group) => group.brandId === brandId),
    [brandId, groups],
  )

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false
      return
    }
    if (wasOpenRef.current) return
    wasOpenRef.current = true
    const active = document.activeElement
    if (active instanceof HTMLElement) lastFocusRef.current = active
    setBrandId(initial?.brandId ?? draft?.brandId ?? '')
    setGroupId(initial?.group?.id ?? '')
    setNewName('')
    setNewTiming('')
    setTargetDate(initial?.targetDate ?? '')
    setCertainty(initial?.certainty ?? 'tentative')
    setError(null)
  }, [draft?.brandId, initial, open])

  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      const previous = lastFocusRef.current
      lastFocusRef.current = null
      if (previous && document.contains(previous)) previous.focus()
      onCloseRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  function restoreFocus() {
    const previous = lastFocusRef.current
    lastFocusRef.current = null
    if (previous && document.contains(previous)) previous.focus()
  }

  function close() {
    restoreFocus()
    onClose()
  }

  async function apply() {
    if (savingRef.current) return
    if (!brandId) {
      setError('브랜드를 먼저 고르세요.')
      return
    }
    const next: ReleaseScheduleApplyValue | null =
      groupId === NEW_GROUP_VALUE
        ? newName.trim()
          ? {
              brandId,
              group: {
                id: newTempGroupId(),
                brandId,
                name: newName.trim(),
                releaseTiming: newTiming.trim(),
              },
              targetDate: targetDate || null,
              certainty,
            }
          : null
        : (() => {
            const group = brandGroups.find((item) => item.id === groupId)
            if (!group) return null
            return {
              brandId,
              group,
              targetDate: targetDate || null,
              certainty,
            }
          })()
    if (!next) {
      setError(
        groupId === NEW_GROUP_VALUE
          ? '새 출시 묶음 이름을 입력하세요.'
          : '출시 묶음을 고르거나 새로 만드세요.',
      )
      return
    }
    savingRef.current = true
    setSaving(true)
    setError(null)
    try {
      await onApply(next)
      restoreFocus()
    } catch (err) {
      console.warn('[drafts] 출시 일정 저장 실패', {
        message: err instanceof Error ? err.message : String(err),
      })
      setError(err instanceof Error ? err.message : '일정을 저장하지 못했습니다.')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  async function clear() {
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setError(null)
    try {
      await onClear()
      restoreFocus()
    } catch (err) {
      console.warn('[drafts] 출시 일정 해제 실패', {
        message: err instanceof Error ? err.message : String(err),
      })
      setError(err instanceof Error ? err.message : '일정을 해제하지 못했습니다.')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  if (!open || !draft) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      <button
        type="button"
        aria-label="닫기"
        className="absolute inset-0 bg-black/40"
        onClick={close}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 w-full max-w-lg overflow-hidden rounded-xl border border-border bg-card shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-base font-semibold">
              출시 일정 정하기
            </h2>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              {draftLabel}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              출시 기획과 브랜드가 기획안에 저장됩니다. 목표일과 확정 여부는 아직 저장되지 않습니다.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="닫기"
            onClick={close}
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="space-y-3 px-5 py-4">
          <label className="block space-y-1.5">
            <span className="text-xs text-muted-foreground">브랜드</span>
            <Select
              className="h-9 w-full"
              value={brandId}
              onChange={(event) => {
                setBrandId(event.target.value)
                setGroupId('')
                setError(null)
              }}
            >
              <option value="">브랜드 선택</option>
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                </option>
              ))}
            </Select>
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs text-muted-foreground">출시 묶음</span>
            <Select
              className="h-9 w-full"
              value={groupId}
              disabled={!brandId}
              onChange={(event) => {
                setGroupId(event.target.value)
                setError(null)
              }}
            >
              <option value="">출시 묶음 선택</option>
              {brandGroups.map((group) => (
                <option key={group.id} value={group.id}>
                  {formatReleaseGroupLabel(group)}
                </option>
              ))}
              <option value={NEW_GROUP_VALUE}>새 출시 묶음 만들기</option>
            </Select>
          </label>

          {groupId === NEW_GROUP_VALUE ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                placeholder="묶음 이름 (예: 26FW, 홀리데이)"
                value={newName}
                onChange={(event) => {
                  setNewName(event.target.value)
                  setError(null)
                }}
              />
              <Input
                placeholder="출시 예정 (예: 2026년 9월)"
                value={newTiming}
                onChange={(event) => setNewTiming(event.target.value)}
              />
            </div>
          ) : null}

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-xs text-muted-foreground">목표 출시일</span>
              <Input
                type="date"
                value={targetDate}
                onChange={(event) => setTargetDate(event.target.value)}
              />
            </label>
            <fieldset className="space-y-1.5">
              <legend className="text-xs text-muted-foreground">일정 상태</legend>
              <div className="flex gap-1.5">
                {(Object.keys(RELEASE_CERTAINTY_LABEL) as ReleaseCertainty[]).map(
                  (value) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={certainty === value}
                      onClick={() => setCertainty(value)}
                      className={cn(
                        'h-9 flex-1 rounded-md border px-2 text-xs transition-colors',
                        certainty === value
                          ? 'border-foreground bg-background font-medium'
                          : 'border-border text-muted-foreground hover:bg-muted/70',
                      )}
                    >
                      {RELEASE_CERTAINTY_LABEL[value]}
                    </button>
                  ),
                )}
              </div>
            </fieldset>
          </div>

          {error ? <p className="text-sm text-danger">{error}</p> : null}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">
          <Button
            type="button"
            variant="ghost"
            disabled={saving}
            onClick={() => {
              void clear()
            }}
          >
            일정 해제
          </Button>
          <Button type="button" variant="outline" disabled={saving} onClick={close}>
            취소
          </Button>
          <Button type="button" disabled={saving} onClick={() => void apply()}>
            {saving ? '저장 중' : '저장'}
          </Button>
        </div>
      </div>
    </div>
  )
}
