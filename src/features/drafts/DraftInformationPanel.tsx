import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { FileText, ImagePlus, X } from 'lucide-react'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input, Textarea } from '@/components/ui/input'
import { DRAFT_INFORMATION_LABELS, resolveColorSpec, type ColorSpecField, type DraftInformationField, type SaveColorSpec } from '@/lib/drafts/color-spec'
import { formatSizeSpec, parseSizeSpec, type SizeParts } from '@/lib/drafts/spec-format'
import type { DraftColorRow, DraftColorSpec, ProductDraft } from '@/lib/types'
import { cn } from '@/lib/utils'

const FIELDS: readonly DraftInformationField[] = ['size', 'fabric', 'specDoc']
const MEASUREMENT_FIELDS = ['size', 'weight'] as const
const SIZE_FIELDS = [...MEASUREMENT_FIELDS, 'sizeNote'] as const
const DIMENSIONS = [
  ['width', '가로', 'W'],
  ['depth', '세로', 'D'],
  ['height', '높이', 'H'],
] as const

function informationPanelPosition(anchor: HTMLButtonElement): CSSProperties | null {
  const margin = 12
  const gap = 10
  const maxWidth = 992
  const { clientWidth: width, clientHeight: height } = document.documentElement
  const trigger = anchor.getBoundingClientRect()
  const board = anchor.closest('.draft-board-scroll')?.getBoundingClientRect()
  if (!anchor.isConnected || trigger.bottom <= 0 || trigger.top >= height ||
    trigger.right <= Math.max(0, board?.left ?? 0) || trigger.left >= Math.min(width, board?.right ?? width)) return null

  const column = anchor.closest('.draft-color-lines')?.getBoundingClientRect() ?? trigger
  const leftSpace = column.left - gap - margin
  const rightSpace = width - margin - column.right - gap
  const sideWidth = Math.max(leftSpace, rightSpace)
  if (sideWidth >= 640) {
    const panelWidth = Math.min(maxWidth, sideWidth)
    const top = Math.max(margin, Math.min(column.top - 16, height - 640))
    return {
      left: leftSpace >= rightSpace ? column.left - gap - panelWidth : column.right + gap,
      top,
      width: panelWidth,
      maxHeight: height - top - margin,
    }
  }

  const line = anchor.closest('.draft-sheet-info')?.getBoundingClientRect() ?? trigger
  // 좁은 화면에서도 선택한 컬러의 버튼 줄을 피하고, 컬러가 많을 때는 입력창 내부를 스크롤한다.
  const columnFits = Math.max(column.top, height - column.bottom) >= 240
  const keepVisible = columnFits ? column : line
  const above = Math.max(0, keepVisible.top - gap - margin)
  const below = Math.max(0, height - margin - keepVisible.bottom - gap)
  const panelWidth = Math.min(maxWidth, width - 2 * margin)
  return {
    left: Math.max(margin, Math.min(trigger.right - panelWidth, width - margin - panelWidth)),
    ...(below >= above ? { top: keepVisible.bottom + gap } : { bottom: height - keepVisible.top + gap }),
    width: panelWidth,
    maxHeight: Math.max(above, below),
  }
}

function InformationPhoto({ src, name, className }: { src?: string | null; name: string; className?: string }) {
  return (
    <div className={cn('grid aspect-square place-items-center overflow-hidden rounded-xl border border-border bg-muted/35', className)}>
      {src
        ? <img src={src} alt={name} loading="lazy" className="size-full object-contain" />
        : <ImagePlus aria-label="등록된 사진 없음" role="img" className="size-7 text-muted-foreground" />}
    </div>
  )
}

function SizeFields({ text, weight, note, locked, onChange }: {
  text: string; weight: string; note: string; locked: boolean
  onChange: (field: typeof SIZE_FIELDS[number], value: string) => void
}) {
  const size = parseSizeSpec(text)
  const summary = DIMENSIONS.flatMap(([key, , symbol]) => size[key] ? [`[${symbol}]${size[key]}`] : []).join(' × ')
  const strapSummary = size.strap ? `스트랩 ${size.strap} mm` : ''
  function change(key: keyof SizeParts, value: string) {
    if (!/^\d*(?:\.\d*)?$/.test(value)) return
    onChange('size', formatSizeSpec({ ...size, [key]: value }))
  }
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[minmax(0,3fr)_minmax(3.25rem,1fr)] items-end gap-2 @[560px]:gap-4">
        <div className="grid grid-cols-3 gap-1.5">
          {DIMENSIONS.map(([key, label, symbol]) => (
            <label key={key} className="grid min-w-0 gap-1 text-xs text-muted-foreground">
              {label} ({symbol})
              <span className="relative">
                <Input className="h-8 min-w-0 pl-1 pr-5 text-right tabular-nums @[560px]:pl-2 @[560px]:pr-7" inputMode="decimal"
                  pattern="[0-9]+([.][0-9]+)?" value={size[key]} readOnly={locked}
                  onChange={event => change(key, event.target.value)} />
                <span className="pointer-events-none absolute inset-y-0 right-1 flex items-center text-[10px] @[560px]:right-2">mm</span>
              </span>
            </label>
          ))}
        </div>
        <label className="grid min-w-0 gap-1 text-xs text-muted-foreground">
          Weight
          <Input aria-label="Weight 값" value={weight} readOnly={locked} placeholder="250g"
            className="h-8 min-w-0 px-2 text-right tabular-nums text-foreground"
            onChange={event => onChange('weight', event.target.value)} />
        </label>
      </div>
      <div className="space-y-1.5 rounded-lg border border-border bg-card p-2.5">
        <p className="min-h-5 break-words text-sm tabular-nums">
          {summary ? `${summary} mm` : strapSummary || text || '사이즈 미입력'}
          {summary && strapSummary && <span className="text-xs text-muted-foreground"> · {strapSummary}</span>}
        </p>
        <Textarea aria-label="사이즈 메모" value={note} readOnly={locked} rows={3}
          placeholder="컬러별 사이즈 참고 사항"
          className="min-h-16 border-0 px-0 py-1 text-sm shadow-none"
          onChange={event => onChange('sizeNote', event.target.value)} />
      </div>
    </div>
  )
}

function ColorInformationForm({ color, photo, field, spec, confirmed, readOnly, highlighted, canApplyBelow, onSave }: {
  color: DraftColorRow; photo?: string | null; field: DraftInformationField; spec: DraftColorSpec; confirmed: boolean
  readOnly: boolean; highlighted: boolean; canApplyBelow: boolean; onSave: SaveColorSpec
}) {
  const [edits, setEdits] = useState<Partial<Record<ColorSpecField, { source: string; text: string }>>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const locked = readOnly || busy
  const colorName = color.name.trim() || '컬러 미정'
  const fieldLabel = DRAFT_INFORMATION_LABELS[field]
  function valueFor(key: ColorSpecField) {
    const edit = edits[key]
    return !readOnly && edit?.source === spec[key] ? edit.text : spec[key]
  }
  function editField(key: ColorSpecField, text: string) {
    setEdits(current => ({ ...current, [key]: { source: spec[key], text } }))
  }
  const changes: Partial<DraftColorSpec> = {}
  const filledValues: Partial<DraftColorSpec> = {}
  for (const key of field === 'size' ? SIZE_FIELDS : [field]) {
    const value = valueFor(key).trim()
    if (value !== spec[key].trim()) changes[key] = value
    if (key !== 'sizeNote' && value) filledValues[key] = value
  }
  const hasChanges = Object.keys(changes).length > 0
  const copyChanges = { ...changes }
  delete copyChanges.sizeNote
  const hasCopyChanges = Object.keys(copyChanges).length > 0
  const valuesToCopy = hasCopyChanges ? copyChanges : filledValues
  const hasCopyValues = Object.keys(valuesToCopy).length > 0
  const copyTitle = hasCopyChanges ? '수정한 항목을 아래 컬러에 적용합니다.' : '입력된 값을 아래 컬러에 적용합니다.'

  async function save(applyAll: boolean) {
    if (locked) return
    if (applyAll ? !canApplyBelow || !hasCopyValues : !hasChanges) return
    setBusy(true)
    setError('')
    try {
      await onSave(color.id, applyAll ? valuesToCopy : changes, applyAll)
      setEdits(current => applyAll && current.sizeNote ? { sizeNote: current.sizeNote } : {})
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form aria-label={`${colorName} ${fieldLabel}`} onSubmit={event => {
      event.preventDefault()
      void save(false)
    }}
      className={cn('grid min-w-0 gap-4 border-t border-border px-4 py-4 @[720px]:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_9.5rem] @[720px]:items-center', highlighted && 'bg-primary/5')}>
      <div className="grid min-w-0 grid-cols-[4rem_minmax(0,1fr)] items-center gap-3 @[720px]:grid-cols-[minmax(4rem,6.5rem)_minmax(0,1fr)]">
        <InformationPhoto src={photo} name={colorName} />
        <label className="grid min-w-0 gap-1 text-xs text-muted-foreground">
          컬러명
          <Input value={colorName} readOnly className="h-8 min-w-0 text-foreground" />
        </label>
      </div>
      {field === 'size' ? (
        <SizeFields text={valueFor('size')} weight={valueFor('weight')} note={valueFor('sizeNote')}
          locked={locked} onChange={editField} />
      ) : (
        <label className="grid min-w-0 gap-1 text-xs text-muted-foreground">
          {fieldLabel}
          <Textarea aria-label={`${fieldLabel} 값`} value={valueFor(field)} readOnly={locked}
            rows={3} className="min-h-20 text-foreground"
            onChange={event => editField(field, event.target.value)} />
        </label>
      )}
      <div className="flex flex-wrap items-center gap-2 @[720px]:flex-col @[720px]:items-end">
        {canApplyBelow && (
          <Button size="sm" type="button" variant="outline" disabled={locked || !hasCopyValues}
            onClick={event => {
              if (event.currentTarget.form?.reportValidity()) void save(true)
            }}
            title={field === 'size' ? `${copyTitle} 메모는 컬러별로 저장합니다.` : copyTitle}>
            다른 컬러에 적용
          </Button>
        )}
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {confirmed ? '확인 완료' : '미확인'}
          <span aria-hidden="true" className={cn('size-3 rounded-sm border border-border', confirmed && 'border-primary bg-primary')} />
        </span>
        <Button size="sm" type="submit" disabled={locked || !hasChanges}>{busy ? '저장 중…' : '저장'}</Button>
      </div>
      {error && <p className="text-xs text-danger @[720px]:col-span-3" role="alert">{error}</p>}
    </form>
  )
}

export function DraftInformationPanel({ id, anchor, draft, field, colorId, readOnly, onFieldChange, onClose, onSave }: {
  id: string; anchor: HTMLButtonElement; draft: ProductDraft; field: DraftInformationField; colorId: string; readOnly: boolean
  onFieldChange: (field: DraftInformationField) => void; onClose: () => void; onSave: SaveColorSpec
}) {
  const active = useWorkspaceTabActivity()
  const overlay = useRef<HTMLDivElement>(null)
  const lastFocusedAnchor = useRef<HTMLButtonElement>(null)
  const [position, setPosition] = useState<CSSProperties | null>(null)
  useLayoutEffect(() => {
    if (!active) return
    let frame = 0
    function place() {
      const next = informationPanelPosition(anchor)
      if (next) setPosition(next)
      else onClose()
    }
    function reposition(event: Event) {
      if (event.target instanceof Node && overlay.current?.contains(event.target)) return
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(place)
    }
    function dismissOutside(event: PointerEvent) {
      if (event.target instanceof Node &&
        !overlay.current?.contains(event.target) && !anchor.closest('td')?.contains(event.target)) onClose()
    }
    place()
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    document.addEventListener('pointerdown', dismissOutside)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
      document.removeEventListener('pointerdown', dismissOutside)
    }
  }, [active, anchor, onClose])
  useLayoutEffect(() => {
    if (!active || !position || lastFocusedAnchor.current === anchor) return
    lastFocusedAnchor.current = anchor
    overlay.current?.focus({ preventScroll: true })
  }, [active, anchor, position])

  function closeAndFocus() {
    onClose()
    anchor.focus({ preventScroll: true })
  }

  const colors = draft.colors
  const specConfirmed = field === 'specDoc'
    ? draft.specs.size.confirmed && draft.specs.fabric.confirmed && draft.specs.weight.confirmed
    : draft.specs[field].confirmed

  if (!active) return null

  const content = (
    <Card className="@container overflow-hidden">
      <div className="flex items-start gap-4 px-4 py-4">
        <InformationPhoto src={draft.imageUrl} name={draft.nameKo || draft.nameEn || draft.draftNo}
          className="w-20 shrink-0 @[560px]:w-36" />
        <div className="grid min-w-0 max-w-sm flex-1 gap-2">
          <div className="text-xs leading-5">
            <p>Designer <strong>{draft.owner.trim() || '미정'}</strong></p>
            <p className="font-semibold">No. {draft.draftNo}</p>
          </div>
          <label className="grid gap-1 text-xs text-muted-foreground">한글명
            <Input value={draft.nameKo} readOnly placeholder="한글명 미정" className="h-8 text-foreground" />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">영문명
            <Input value={draft.nameEn} readOnly placeholder="영문명 미정" className="h-8 text-foreground" />
          </label>
        </div>
        <Button type="button" size="icon" variant="ghost" className="ml-auto shrink-0" aria-label="INFORMATION 닫기" onClick={closeAndFocus}>
          <X size={16} aria-hidden="true" />
        </Button>
      </div>
      <div className="mx-4 mb-4 overflow-hidden rounded-xl border border-border">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
          <span className="text-sm font-semibold">컬러 <span className="ml-1.5 font-normal text-muted-foreground">{colors.length}개</span></span>
          <div role="group" aria-label="INFORMATION 입력 항목" className="flex flex-wrap gap-2">
            {FIELDS.map(option => (
              <Button key={option} type="button" size="sm" variant={field === option ? 'default' : 'outline'}
                aria-pressed={field === option} onClick={() => onFieldChange(option)}>
                {option === 'specDoc' && <FileText size={14} aria-hidden="true" />}
                {DRAFT_INFORMATION_LABELS[option]}
              </Button>
            ))}
          </div>
        </div>
        {colors.length ? colors.map((color, index) => {
          const spec = resolveColorSpec(draft.specs, color.id)
          const confirmed = field === 'size'
            ? MEASUREMENT_FIELDS.some(key => spec[key].trim()) &&
              MEASUREMENT_FIELDS.every(key => !spec[key].trim() || draft.specs[key].confirmed)
            : specConfirmed && Boolean(spec[field].trim())
          return <ColorInformationForm key={`${color.id}:${field}:${readOnly}`} color={color} field={field}
            photo={draft.specs.colorPhotoUrls?.[color.id]} spec={spec} confirmed={confirmed}
            highlighted={color.id === colorId} readOnly={readOnly} canApplyBelow={index === 0 && colors.length > 1} onSave={onSave} />
        }) : <p className="border-t border-border px-4 py-3 text-sm text-muted-foreground">등록된 컬러가 없습니다.</p>}
      </div>
    </Card>
  )

  return createPortal(
    <div ref={overlay} id={id} role="dialog" aria-label={`${draft.draftNo} INFORMATION`} tabIndex={-1}
      className="fixed z-[70] overflow-y-auto overscroll-contain rounded-xl shadow-xl outline-none"
      style={position ?? { visibility: 'hidden' }}
      onKeyDown={event => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        closeAndFocus()
      }}>
      {content}
    </div>, document.body,
  )
}
