import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type MouseEventHandler, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { FileText, GripVertical, Heart, ImageOff, Pencil, Plus, Save, Trash2, X } from 'lucide-react'
import { BrandAvatar } from '@/components/brand/BrandAvatar'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { startWorkflow } from '@/lib/diagnostics/workflow-trace'
import { DRAFT_COLOR_PHOTO_ACCEPT, prepareDraftColorPhoto } from '@/lib/drafts/color-photo'
import { MAX_DRAFT_COLORS } from '@/lib/drafts/empty-draft'
import {
  DRAFT_INFORMATION_LABELS, colorInformationEditKey, documentEditKey, hasInformationEdits, informationEditText,
  isColorInformationConfirmed, isSpecDocumentConfirmed, resolveColorSpec, type ColorInformationField,
  type InformationDrafts, type SaveColorSpec, type UpdateInformationEdits,
} from '@/lib/drafts/color-spec'
import { formatSizeSpecLabel } from '@/lib/drafts/spec-format'
import { colorSampleLineStatus, resolveColorSampleRounds } from '@/lib/drafts/draft-flow'
import { sampleReadyForNextStage } from '@/lib/drafts/sample-receipt'
import { sheetRegisteredDay } from '@/lib/drafts/sample-work-order'
import { readFileAsDataUrl } from '@/lib/images'
import type { DraftInformationTemporaryStore } from '@/lib/supabase/draft-information-temporary'
import type { DraftColorEdit } from '@/lib/supabase/product-drafts'
import { DRAFT_STATUS_LABEL, type Brand, type DraftColorImageChoice, type DraftColorRow, type DraftSpecs, type ProductDraft, type Season } from '@/lib/types'
import { cn, formatNumber } from '@/lib/utils'
import { RELEASE_CERTAINTY_LABEL, formatReleaseGroupLabel, formatTargetDate, type ResolvedReleaseSchedule } from './release-schedule-preview'
import './draft-board.css'
import { DraftSampleProgress } from './DraftSampleProgress'
import { DraftColorSampleProgress } from './DraftColorSampleProgress'
import { DraftPriceRequestButton, type DraftPriceControls } from './DraftPriceRequestButton'
import { DraftInformationPanel } from './DraftInformationPanel'
import type { DraftInformationPanelField, DraftVisualInformationField } from './draft-information-tabs'
import { DraftMdTeamCell } from './DraftMdTeamCell'
import { DraftVisualAmdCells } from './DraftVisualAmdCells'
import type { DraftTeamWork } from './use-draft-team-work'
import type { DraftVisualBoardRow } from './use-draft-visual-board'

const SAMPLE_WORK_ORDER_ACCEPT =
  'application/pdf,image/png,image/jpeg,image/webp,.pdf,.png,.jpg,.jpeg,.webp,.xls,.xlsx'
const SAMPLE_WORK_ORDER_MAX_BYTES = 8 * 1024 * 1024

function SampleWorkOrderButton({
  readOnly = false,
  onUpload,
  onOpen,
  label = '샘플 작업지시서',
}: {
  readOnly?: boolean
  onUpload: (file: { url: string; name: string }) => Promise<void>
  onOpen?: () => void
  label?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={SAMPLE_WORK_ORDER_ACCEPT}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file || readOnly) return
          if (file.size > SAMPLE_WORK_ORDER_MAX_BYTES) {
            setError('작업 지시서는 8MB 이하만 올릴 수 있습니다.')
            return
          }
          setBusy(true)
          setError('')
          void readFileAsDataUrl(file)
            .then((url) => onUpload({ url, name: file.name }))
            .then(() => undefined)
            .catch((err: unknown) => {
              console.warn('[drafts] 샘플 작업 지시서 업로드 실패', err)
              setError(err instanceof Error ? err.message : '작업 지시서를 올리지 못했습니다.')
            })
            .finally(() => setBusy(false))
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={onOpen ? false : readOnly || busy}
        onClick={() => {
          if (onOpen) onOpen()
          else inputRef.current?.click()
        }}
      >
        {busy ? '올리는 중' : label}
      </Button>
      {error ? <span className="draft-sheet-field-error">{error}</span> : null}
    </>
  )
}

function SheetConfirmButton({
  label,
  confirmed,
  canToggle,
  blockedTitle,
  className,
  doneStyle = true,
  children,
  onToggle,
}: {
  label: string
  confirmed: boolean
  canToggle: boolean
  blockedTitle: string
  className?: string
  doneStyle?: boolean
  children?: ReactNode
  onToggle: (next: boolean) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const tone = confirmed && doneStyle ? 'is-done' : 'is-neutral'
  return (
    <>
      <button
        type="button"
        className={`draft-sheet-action ${tone}${className ? ` ${className}` : ''}`}
        disabled={!canToggle || busy}
        aria-pressed={confirmed}
        aria-label={label}
        title={canToggle ? (confirmed ? `${label} 해제` : label) : blockedTitle}
        onClick={() => {
          setBusy(true)
          setError('')
          void onToggle(!confirmed)
            .catch((err: unknown) => {
              console.warn('[drafts] 확정 상태 저장 실패', { label, err })
              setError(err instanceof Error ? err.message : '확정 상태를 저장하지 못했습니다.')
            })
            .finally(() => setBusy(false))
        }}
      >
        {busy ? '저장 중' : children ?? label}
      </button>
      {error ? <span className="draft-sheet-field-error">{error}</span> : null}
    </>
  )
}

const COLOR_IMAGE_CHOICES: readonly DraftColorImageChoice[] = ['Image', 'None']

type ColorPhotoChange = NonNullable<DraftColorEdit['photoChange']>
type ColorFormRow = DraftColorEdit & { key: number }

function colorImageConfigured(choice?: DraftColorImageChoice, photoUrl?: string | null) {
  return choice === 'None' || (choice === 'Image' && Boolean(photoUrl))
}

function ColorImageChoiceDot({ choice, photoUrl }: { choice?: DraftColorImageChoice; photoUrl?: string | null }) {
  const configured = colorImageConfigured(choice, photoUrl)
  const label = configured ? `이미지 설정 ${choice}` : choice === 'Image' ? '이미지 미첨부' : '이미지 미선택'
  return (
    <span
      role="img"
      aria-label={label}
      className={`size-1.5 shrink-0 rounded-full border ${configured ? 'border-primary bg-primary' : 'border-muted-foreground'}`}
    />
  )
}

const COLOR_ROW_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'

function layoutCenterY(node: HTMLElement) {
  const parent = node.offsetParent instanceof HTMLElement ? node.offsetParent : null
  const origin = parent ? parent.getBoundingClientRect().top : 0
  return origin + node.offsetTop + node.offsetHeight / 2
}

function slideColorRow(node: HTMLElement, fromY: number) {
  if (Math.abs(fromY) < 1) return
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  node.getAnimations().forEach((animation) => animation.cancel())
  node.animate(
    [{ transform: `translateY(${fromY}px)` }, { transform: 'translateY(0)' }],
    { duration: 220, easing: COLOR_ROW_EASE },
  )
}

function ColorDocumentButton({
  readOnly = false,
  colors,
  imageChoices,
  photoUrls,
  savedImages,
  revision,
  onSaveColors,
}: {
  readOnly?: boolean
  colors: DraftColorRow[]
  imageChoices: DraftSpecs['colorImageChoices']
  photoUrls: DraftSpecs['colorPhotoUrls']
  savedImages?: readonly string[]
  revision: string
  onSaveColors: (colors: DraftColorEdit[], revision: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<ColorFormRow[]>([{ key: 1, id: null, name: '' }])
  const [busy, setBusy] = useState(false)
  const [preparingPhotoKey, setPreparingPhotoKey] = useState<number | null>(null)
  const [error, setError] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const photoTargetKey = useRef<number | null>(null)
  const nextKey = useRef(1)
  const openedRevision = useRef(revision)
  const layoutTops = useRef(new Map<number, number>())
  const shiftRef = useRef(0)
  const dragRef = useRef<{ key: number; pointerId: number; startY: number; y: number } | null>(null)
  const [draggingKey, setDraggingKey] = useState<number | null>(null)
  const [shiftY, setShiftY] = useState(0)
  const locked = readOnly || busy || preparingPhotoKey !== null

  useEffect(() => {
    if (!open || busy || preparingPhotoKey !== null) return
    function closeOnOutside(event: PointerEvent) {
      if (rootRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutside, true)
    return () => document.removeEventListener('pointerdown', closeOnOutside, true)
  }, [open, busy, preparingPhotoKey])

  function freshRows(source: DraftColorRow[]) {
    if (!source.length) {
      nextKey.current += 1
      return [{ key: nextKey.current, id: null, name: '' }]
    }
    return source.map((color) => {
      nextKey.current += 1
      return { key: nextKey.current, id: color.id, name: color.name }
    })
  }

  function addRow() {
    if (locked || rows.length >= MAX_DRAFT_COLORS) return
    setError('')
    nextKey.current += 1
    setRows((current) => [...current, { key: nextKey.current, id: null, name: '' }])
  }

  function removeRow(key: number) {
    setError('')
    setRows((current) => {
      const next = current.filter((row) => row.key !== key)
      if (next.length) return next
      nextKey.current += 1
      return [{ key: nextKey.current, id: null, name: '' }]
    })
  }

  function changePhoto(key: number, photoChange: ColorPhotoChange) {
    setError('')
    setRows((current) => current.map((row) => row.key === key ? { ...row, photoChange } : row))
  }

  async function attachPhoto(key: number, file: File) {
    setPreparingPhotoKey(key)
    setError('')
    const trace = startWorkflow('app', 'draft_color_prepare_photo')
    try {
      const url = await trace.run('prepare_image', () => prepareDraftColorPhoto(file))
      changePhoto(key, { choice: 'Image', url })
      trace.done()
    } catch (err) {
      setError(err instanceof Error ? err.message : '사진을 불러오지 못했습니다.')
    } finally {
      setPreparingPhotoKey(null)
    }
  }

  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) {
      layoutTops.current.clear()
      return
    }
    const drag = dragRef.current
    for (const node of list.querySelectorAll<HTMLElement>('[data-color-key]')) {
      const key = Number(node.dataset.colorKey)
      const top = node.offsetTop
      const prev = layoutTops.current.get(key)
      if (prev != null && prev !== top) {
        const dy = prev - top
        if (drag?.key === key) {
          drag.startY += top - prev
          const nextShift = drag.y - drag.startY
          shiftRef.current = nextShift
          setShiftY(nextShift)
        } else {
          slideColorRow(node, dy)
        }
      }
      layoutTops.current.set(key, top)
    }
  })

  function beginDrag(event: ReactPointerEvent<HTMLButtonElement>, key: number) {
    if (locked || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const drag = { key, pointerId: event.pointerId, startY: event.clientY, y: event.clientY }
    dragRef.current = drag
    shiftRef.current = 0
    setDraggingKey(key)
    setShiftY(0)
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch (err) {
      console.warn('[drafts] 컬러 순서 포인터 캡처 실패', err)
    }

    function move(pointerEvent: PointerEvent) {
      if (pointerEvent.pointerId !== drag.pointerId || dragRef.current !== drag) return
      pointerEvent.preventDefault()
      drag.y = pointerEvent.clientY
      const nextShift = pointerEvent.clientY - drag.startY
      shiftRef.current = nextShift
      setShiftY(nextShift)
      const list = listRef.current
      if (!list) return
      const nodes = [...list.querySelectorAll<HTMLElement>('[data-color-key]')]
      const active = nodes.find((node) => Number(node.dataset.colorKey) === drag.key)
      if (!active) return
      const mid = layoutCenterY(active) + nextShift
      let to = 0
      for (const node of nodes) {
        if (node === active) continue
        if (mid > layoutCenterY(node)) to += 1
      }
      setRows((current) => {
        const from = current.findIndex((row) => row.key === drag.key)
        if (from < 0 || from === to) return current
        const next = [...current]
        const [item] = next.splice(from, 1)
        next.splice(to, 0, item)
        return next
      })
    }

    function end(pointerEvent: PointerEvent) {
      if (pointerEvent.pointerId !== drag.pointerId) return
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      const fromY = shiftRef.current
      dragRef.current = null
      shiftRef.current = 0
      setDraggingKey(null)
      setShiftY(0)
      const node = listRef.current?.querySelector<HTMLElement>(`[data-color-key="${drag.key}"]`)
      if (node) slideColorRow(node, fromY)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  return (
    <div className="draft-color-add" ref={rootRef}>
      <button
        type="button"
        className="draft-sheet-action is-neutral"
        aria-expanded={open}
        aria-label="컬러 문서"
        title="컬러 추가"
        disabled={locked}
        onClick={() => {
          setError('')
          if (!open) {
            openedRevision.current = revision
            layoutTops.current.clear()
            setRows(freshRows(colors))
          }
          setOpen((current) => !current)
        }}
      >
        <FileText size={18} />
      </button>
      {open ? (
        <form
          className="draft-color-add-form"
          onSubmit={(event) => {
            event.preventDefault()
            if (locked) return
            if (rows.some((row) => (row.id || row.photoChange) && !row.name.trim())) {
              setError('컬러 이름을 입력하세요.')
              return
            }
            const next = rows
              .filter((row) => row.name.trim())
              .map(({ id, name, photoChange }) => ({ id, name: name.trim(), photoChange }))
            if (!next.length && colors.length === 0) {
              setError('컬러 이름을 입력하세요.')
              return
            }
            if (next.length > MAX_DRAFT_COLORS) {
              setError(`최대 ${MAX_DRAFT_COLORS}컬러까지 추가할 수 있습니다.`)
              return
            }
            setBusy(true)
            setError('')
            void onSaveColors(next, openedRevision.current)
              .then(() => setOpen(false))
              .catch((err: unknown) => {
                setError(err instanceof Error ? err.message : '컬러를 저장하지 못했습니다.')
              })
              .finally(() => setBusy(false))
          }}
        >
          <input
            ref={photoInputRef}
            type="file"
            accept={DRAFT_COLOR_PHOTO_ACCEPT}
            hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              const key = photoTargetKey.current
              event.currentTarget.value = ''
              photoTargetKey.current = null
              if (file && key !== null && !locked) void attachPhoto(key, file)
            }}
          />
          <div className="draft-color-add-rows" ref={listRef}>
            {rows.map((row, index) => {
              const lifted = draggingKey === row.key
              const imageChoice = row.photoChange?.choice ?? (row.id ? imageChoices?.[row.id] : undefined)
              const photoUrl = row.photoChange ? row.photoChange.url : row.id ? photoUrls?.[row.id] : undefined
              const provisionalPhoto = Boolean(photoUrl && (row.photoChange || !row.id || !savedImages?.includes(row.id)))
              return (
              <div
                key={row.key}
                data-color-key={row.key}
                className={`draft-color-add-row${lifted ? ' is-lifted' : ''}`}
                style={lifted ? { transform: `translateY(${shiftY}px)` } : undefined}
              >
                <ColorImageChoiceDot choice={imageChoice} photoUrl={photoUrl} />
                <button
                  type="button"
                  className="draft-color-add-grip"
                  aria-label={`컬러 ${index + 1} 순서 변경`}
                  title="끌어서 순서 변경"
                  disabled={locked}
                  onPointerDown={(event) => beginDrag(event, row.key)}
                >
                  <GripVertical className="size-3.5" />
                </button>
                <Input
                  className="h-8 min-w-0 flex-1 text-sm"
                  aria-label={rows.length > 1 ? `컬러 이름 ${index + 1}` : '컬러 이름'}
                  value={row.name}
                  disabled={locked}
                  onChange={(event) => {
                    const name = event.target.value
                    setRows((current) => current.map((item) => item.key === row.key ? { ...item, name } : item))
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0 text-muted-foreground"
                  aria-label={row.id ? `컬러 ${index + 1} 삭제` : rows.length > 1 ? `컬러 이름 ${index + 1} 삭제` : '컬러 이름 지우기'}
                  disabled={locked}
                  onClick={() => removeRow(row.key)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
                <div role="group" aria-label={`컬러 ${index + 1} 이미지 선택`} className="flex shrink-0 gap-1">
                  {COLOR_IMAGE_CHOICES.map((choice) => (
                    <Button
                      key={choice}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1 px-2 text-muted-foreground aria-pressed:border-primary/40 aria-pressed:bg-primary/10 aria-pressed:text-primary"
                      title={choice === 'Image' ? (photoUrl ? '사진 교체' : '사진 첨부') : '사진 없이 저장'}
                      aria-pressed={imageChoice === choice}
                      aria-description={choice === 'Image' && provisionalPhoto ? '임시 이미지' : undefined}
                      aria-busy={choice === 'Image' && preparingPhotoKey === row.key}
                      disabled={locked}
                      onClick={() => {
                        if (choice === 'None') {
                          changePhoto(row.key, { choice, url: null })
                          return
                        }
                        photoTargetKey.current = row.key
                        photoInputRef.current?.click()
                      }}
                    >
                      {choice === 'Image' && photoUrl ? <span className={cn('relative overflow-hidden rounded-sm', provisionalPhoto && 'draft-visual-image-temporary')}>
                        <img src={photoUrl} alt="" className="size-5 object-contain" />
                      </span> : null}
                      {choice}
                    </Button>
                  ))}
                </div>
              </div>
              )
            })}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="flex h-8 min-w-0 flex-1 items-center justify-center gap-1 rounded-md border border-dashed border-border text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
              disabled={locked || rows.length >= MAX_DRAFT_COLORS}
              onClick={addRow}
            >
              <Plus className="size-3.5" />
              컬러 추가
            </button>
            <Button type="submit" size="sm" className="h-8 shrink-0 px-2.5" disabled={locked}>
              <Save className="size-3.5" />
              {busy ? '저장 중' : '저장'}
            </Button>
          </div>
          {preparingPhotoKey !== null ? <span role="status" className="text-xs text-muted-foreground">사진 준비 중…</span> : null}
          {error ? <p role="alert">{error}</p> : rows.length >= MAX_DRAFT_COLORS ? <p>최대 {MAX_DRAFT_COLORS}컬러까지 추가할 수 있습니다.</p> : null}
        </form>
      ) : null}
    </div>
  )
}

function ColorLine({ index, children }: { index: number; children: ReactNode }) {
  return <div className={`draft-color-line${index % 2 === 1 ? ' is-alt' : ''}`}>{children}</div>
}

function SheetInlineField({
  readOnly = false,
  label,
  value,
  className,
  showError = false,
  multiline = false,
  onCommit,
}: {
  readOnly?: boolean
  label: string
  value: string
  className: string
  showError?: boolean
  multiline?: boolean
  onCommit: (next: string) => Promise<void>
}) {
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null)
  const [text, setText] = useState(value)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const revertRef = useRef(false)
  const busyRef = useRef(false)

  useEffect(() => {
    if (!readOnly && inputRef.current && document.activeElement === inputRef.current) return
    setText(value)
    setError('')
  }, [value, readOnly])

  useEffect(() => {
    const field = inputRef.current
    if (!(field instanceof HTMLTextAreaElement)) return
    field.style.height = 'auto'
    field.style.height = `${field.scrollHeight}px`
  }, [text])

  function commit(raw: string) {
    if (readOnly) return
    const next = raw.trim()
    if (next === value.trim()) {
      setText(value)
      setError('')
      return
    }
    busyRef.current = true
    setBusy(true)
    setError('')
    void onCommit(next)
      .then(() => setError(''))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '저장하지 못했습니다.')
        setText(raw)
      })
      .finally(() => {
        busyRef.current = false
        setBusy(false)
      })
  }

  const fieldProps = {
    'aria-label': label,
    'aria-invalid': error ? true as const : undefined,
    title: error || undefined,
    className,
    value: readOnly ? value : text,
    disabled: busy,
    readOnly,
    autoComplete: 'off' as const,
    spellCheck: false as const,
    onChange: (event: { target: { value: string } }) => {
      if (readOnly) return
      setText(event.target.value)
      if (error) setError('')
    },
    onBlur: (event: { currentTarget: { value: string } }) => {
      if (revertRef.current) {
        revertRef.current = false
        return
      }
      if (busyRef.current) return
      commit(event.currentTarget.value)
    },
    onKeyDown: (event: { key: string; preventDefault: () => void; currentTarget: { blur: () => void } }) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        event.currentTarget.blur()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        revertRef.current = true
        setText(value)
        setError('')
        event.currentTarget.blur()
      }
    },
  }

  return (
    <>
      {multiline ? (
        <textarea
          ref={(node) => {
            inputRef.current = node
          }}
          rows={1}
          {...fieldProps}
        />
      ) : (
        <input
          ref={(node) => {
            inputRef.current = node
          }}
          {...fieldProps}
        />
      )}
      {showError && error ? (
        <span className="draft-sheet-field-error">{error}</span>
      ) : null}
    </>
  )
}

function InformationButton({ label, value, tone, expanded, panelId, disabled, icon, onClick }: {
  label: string; value: string; tone: ReturnType<typeof specTone>; expanded: boolean
  panelId: string; disabled: boolean; icon?: ReactNode; onClick: MouseEventHandler<HTMLButtonElement>
}) {
  const activeRing = tone === 'editing' ? 'ring-2 ring-border' : 'ring-2 ring-primary/40'
  const tooltip = value.trim() || label
  return (
    <button type="button" className={`draft-sheet-action draft-information-action is-${tone}${expanded ? ` ${activeRing}` : ''}`}
      aria-haspopup="dialog" aria-expanded={expanded} aria-controls={expanded ? panelId : undefined}
      aria-label={label} aria-description={tone === 'editing' ? '기입 중' : undefined}
      title={tone === 'editing' ? `${tooltip} · 기입 중` : tooltip} disabled={disabled} onClick={onClick}>
      {icon}
      {label}
    </button>
  )
}

function SampleStatus({
  status,
  canToggle,
  onToggle,
}: {
  status: 'waiting' | 'sampling' | 'done'
  canToggle: boolean
  onToggle?: () => void
}) {
  const label = status === 'done' ? '완료' : status === 'sampling' ? '샘플중' : '대기'
  const tone = status === 'done' ? 'done' : status === 'sampling' ? 'pending' : 'neutral'
  const title = status === 'waiting'
    ? '컬러샘플 시작 전'
    : canToggle
      ? status === 'done' ? '샘플중으로 되돌리기' : '완료로 바꾸기'
      : '실물 수령 확인 후 완료로 바꿀 수 있습니다'
  return (
    <button
      type="button"
      className={`draft-sheet-action is-${tone} draft-sheet-status-badge`}
      aria-label={label}
      title={title}
      disabled={!canToggle}
      onClick={() => onToggle?.()}
    >
      {label}
    </button>
  )
}

function specTone(value: string, confirmed: boolean, hasEdits: boolean): 'neutral' | 'editing' | 'done' {
  if (hasEdits) return 'editing'
  if (!value.trim()) return 'neutral'
  return confirmed ? 'done' : 'editing'
}

export function DraftPhoto({ src, name, onOpen }: { src: string | null; name: string; onOpen?: () => void }) {
  const [open, setOpen] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { if (open) dialog.current?.showModal() }, [open])
  return <>
    <button type="button" className={`draft-sheet-photo${onOpen ? ' is-editor' : ''}`} disabled={!onOpen && !src} aria-label={onOpen ? `${name} 기획안 편집` : `${name} 사진 크게 보기`} onClick={() => { if (onOpen) onOpen(); else if (src) setOpen(true) }}>
      {src ? <img src={src} alt={name} loading="lazy" /> : <span><ImageOff size={25} /><small>등록된 사진 없음</small></span>}
    </button>
    {open && src && createPortal(<dialog ref={dialog} className="draft-photo-dialog" aria-label={`${name} 사진 크게 보기`} onCancel={() => setOpen(false)} onClose={() => setOpen(false)} onClick={event => { if (event.target === event.currentTarget) setOpen(false) }}>
      <header><strong>{name}</strong><button type="button" aria-label="사진 크게 보기 닫기" onClick={() => setOpen(false)}><X size={20} /></button></header>
      <img src={src} alt={name} />
    </dialog>, document.body)}
  </>
}

export type DraftConfirmFlag = 'nameConfirmed' | 'colorsConfirmed'

function DraftReleaseFolderSelect({ draft, folders, readOnly, onChange }: {
  draft: ProductDraft
  folders: Pick<Season, 'id' | 'name' | 'releaseTiming'>[]
  readOnly: boolean
  onChange: (seasonId: string | null) => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const selected = folders.find((folder) => folder.id === draft.seasonId)

  async function selectFolder(seasonId: string) {
    setSaving(true)
    setError('')
    try {
      await onChange(seasonId || null)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '출시 폴더를 저장하지 못했습니다.')
    } finally {
      setSaving(false)
    }
  }

  return <>
    <Select
      aria-label={`${draft.draftNo} 출시 폴더`}
      aria-busy={saving}
      className="draft-sheet-release-folder"
      value={selected?.id ?? ''}
      disabled={readOnly || saving || folders.length === 0}
      title={folders.length ? (selected ? formatReleaseGroupLabel(selected) : '출시 폴더 선택') : '이 브랜드에 선택할 수 있는 출시 폴더가 없습니다.'}
      onChange={(event) => { void selectFolder(event.currentTarget.value) }}
    >
      <option value="">출시미정</option>
      {folders.map((folder) => <option key={folder.id} value={folder.id}>{formatReleaseGroupLabel(folder)}</option>)}
    </Select>
    {error && <p className="draft-sheet-release-error" role="alert">{error}</p>}
  </>
}

export function DraftSheetRow({ draft, readOnly = false, schedule, brand, releaseFolders, onChangeReleaseFolder, price, teamWork, visualBoard, informationEditorId, informationTemporaryStore, onOpen, onNextSample, onSchedule, onSaveColors, onSharedPhotoChange, onRenameColor, onSaveSheetValue, onSaveSpecDocument, onUploadSampleWorkOrder, onReceiveSample, onRequestNextSampleRound, onReceiveColorSample, onSetColorSampleDone, onToggleConfirm }: {
  readOnly?: boolean
  draft: ProductDraft; schedule: ResolvedReleaseSchedule | undefined; brand: Brand | undefined
  releaseFolders: Pick<Season, 'id' | 'name' | 'releaseTiming'>[]
  onChangeReleaseFolder: (seasonId: string | null) => Promise<void>
  price?: DraftPriceControls
  teamWork: DraftTeamWork
  visualBoard: DraftVisualBoardRow
  onOpen: () => void
  onNextSample?: () => void
  onSchedule: () => void
  onSaveColors: (colors: DraftColorEdit[], revision: string) => Promise<void>
  onRenameProduct: (field: 'nameKo' | 'nameEn', name: string) => Promise<void>
  onSharedPhotoChange: (saved?: { colorId: string; photo: string }) => Promise<void>
  onRenameColor: (colorId: string, name: string) => Promise<void>
  onSaveSheetValue: SaveColorSpec
  onSaveSpecDocument: (value: string, temporaryRevision?: string) => Promise<void>
  informationEditorId?: string
  informationTemporaryStore?: DraftInformationTemporaryStore
  onUploadSampleWorkOrder: (file: { url: string; name: string }) => Promise<void>
  onReceiveSample: (id: string) => Promise<void>
  onRequestNextSampleRound: (file: { url: string; name: string }, country?: string) => Promise<void>
  onUploadColorWorkOrder: (file: { url: string; name: string }) => Promise<void>
  onReceiveColorSample: (id: string) => Promise<void>
  onSetColorSampleDone: (colorId: string, done: boolean) => Promise<void>
  onToggleConfirm: (flag: DraftConfirmFlag, next: boolean) => Promise<void>
}) {
  const orders = [...(draft.sampleWorkOrders ?? [])]
    .filter((order) => order.url?.trim())
    .sort((a, b) => a.round - b.round)
  const latestOrder = orders[orders.length - 1]
  const colorRounds = resolveColorSampleRounds(draft)
  const sampleReady = sampleReadyForNextStage(latestOrder) || colorRounds.length > 0
  const latestColorRound = colorRounds[colorRounds.length - 1]
  const colorSampleStarted = Boolean(latestColorRound?.url.trim())
  const colorSampleReceived = Boolean(latestColorRound?.receivedAt)
  const doneColorIds = new Set(latestColorRound ? draft.specs.colorSampleDone?.[latestColorRound.id] ?? [] : [])
  const [pendingDone, setPendingDone] = useState<Record<string, boolean>>({})
  const informationId = useId()
  const [information, setInformation] = useState<{
    anchor: HTMLButtonElement
    colorId: string | null
    field: DraftInformationPanelField
    visualTrigger?: DraftVisualInformationField
  } | null>(null)
  const fromVisual = Boolean(information?.visualTrigger)
  const [informationEdits, setInformationEdits] = useState<InformationDrafts>({})
  useEffect(() => {
    setInformationEdits({})
  }, [readOnly, informationEditorId])
  function updateInformationEdits(key: string, update: UpdateInformationEdits) {
    if (!readOnly && !fromVisual) setInformationEdits(current => ({ ...current, [key]: update(current[key]) }))
  }
  const closeInformation = useCallback(() => setInformation(null), [])
  const name = draft.nameEn.trim() || draft.nameKo.trim() || '이름 미정'
  const proposerName = draft.specs.proposer?.name?.trim()
  const named = Boolean(draft.nameEn.trim() || draft.nameKo.trim())
  const hasColor = draft.colors.length > 0
  const missingPriceColors = draft.colors.flatMap((color, index) =>
    colorImageConfigured(draft.specs.colorImageChoices?.[color.id], draft.specs.colorPhotoUrls?.[color.id])
      ? []
      : [color.name.trim() || `${index + 1}번 컬러`],
  )
  const nameConfirmed = Boolean(draft.specs.nameConfirmed)
  const colorsConfirmed = Boolean(draft.specs.colorsConfirmed)
  const registeredDay = sheetRegisteredDay(draft.createdAt)
  const documentConfirmed = isSpecDocumentConfirmed(draft.specs)
  const specDocument = draft.specs.coating.note
  const documentEditing = !readOnly &&
    informationEditText(specDocument, informationEdits[documentEditKey]?.specDoc).trim() !== specDocument.trim()
  const documentOpen = !fromVisual && information?.field === 'specDoc'
  const colorRows: Array<DraftColorRow | null> = draft.colors.length ? draft.colors : [null]
  const priceAmounts = price?.reply?.amounts
  function colorSampleDone(colorId: string) {
    return colorId in pendingDone ? pendingDone[colorId] : doneColorIds.has(colorId)
  }
  function toggleColorSampleDone(colorId: string, done: boolean) {
    if (readOnly || !colorSampleReceived) return
    setPendingDone(current => ({ ...current, [colorId]: done }))
    void onSetColorSampleDone(colorId, done).then(() => {
      setPendingDone(current => {
        if (current[colorId] !== done) return current
        const next = { ...current }
        delete next[colorId]
        return next
      })
    }, (error: unknown) => {
      console.warn('[drafts] 컬러샘플 완료 상태 저장 실패', { colorId, done, error })
      setPendingDone(current => {
        if (current[colorId] !== done) return current
        const next = { ...current }
        delete next[colorId]
        return next
      })
    })
  }

  return <><tr className="draft-sheet-row">
    <td><div className="draft-sheet-image-cell">
      <DraftReleaseFolderSelect draft={draft} folders={releaseFolders} readOnly={readOnly} onChange={onChangeReleaseFolder} />
      <DraftPhoto src={draft.imageUrl} name={name === '이름 미정' ? draft.draftNo : name} onOpen={onOpen} />
      <div className="draft-sheet-names">
        <div className="draft-sheet-brand-info">
          <div>
            <div className="draft-sheet-owner">Designer <strong>{draft.owner.trim() || '미정'}</strong></div>
            <strong className="draft-sheet-number">No. {draft.draftNo}</strong>
            {proposerName && <p className="draft-sheet-proposer">제안자 : {proposerName}</p>}
          </div>
          {brand && <div role="img" aria-label={`${brand.name} 브랜드`} title={brand.name}>
            <BrandAvatar brand={brand} className="size-10 rounded-full [&>img]:object-contain" />
          </div>}
        </div>
        <button type="button" className="draft-sheet-product-name" aria-label={`${draft.draftNo} 한글명`} onClick={onOpen}>{draft.nameKo.trim()}</button>
        <button type="button" className="draft-sheet-product-name is-en" aria-label={`${draft.draftNo} 영문명`} onClick={onOpen}>{draft.nameEn.trim()}</button>
      </div>
      <SheetConfirmButton
        className="draft-sheet-name-confirm"
        label="네임확정"
        confirmed={nameConfirmed}
        canToggle={!readOnly && named}
        blockedTitle="한글명 또는 영문명을 먼저 입력해 주세요"
        onToggle={(next) => onToggleConfirm('nameConfirmed', next)}
      >
        {named ? '네임확정' : '네임 미정'}
      </SheetConfirmButton>
      <div className="draft-sheet-brand-actions">
        <button type="button" className="draft-sheet-edit" aria-label={`${draft.draftNo} 기획안 ${readOnly ? '조회' : '편집'}`} onClick={onOpen}><Pencil size={12} />기획안 {readOnly ? '조회' : '편집'}</button>
        <button type="button" className="draft-sheet-schedule-button" disabled={readOnly} onClick={onSchedule}>{schedule?.group ? '일정 수정' : '일정 정하기'}</button>
      </div>
      {(draft.releaseIssue.trim() || schedule?.group) && (
        <details className="draft-sheet-release">
          <summary>발매 이슈</summary>
          <p>{draft.releaseIssue.trim() || '등록된 이슈 없음'}</p>
          {schedule?.group && <div className="draft-sheet-schedule">{formatReleaseGroupLabel(schedule.group)}{schedule.certainty ? ` · ${RELEASE_CERTAINTY_LABEL[schedule.certainty]}` : ''}{schedule.targetDate ? ` · ${formatTargetDate(schedule.targetDate)}` : ''}{schedule.isPreview ? ' · 미리보기' : ''}</div>}
        </details>
      )}
    </div></td>
    <td>
      {registeredDay ? <p className="draft-sheet-registered">등록일 : {registeredDay}</p> : null}
      {(draft.status !== 'open' || draft.held) && <div className="draft-sheet-status">{draft.status !== 'open' ? DRAFT_STATUS_LABEL[draft.status] : ''}{draft.held ? ' · 보류' : ''}</div>}
      {orders.length > 0 ? (
        <div className={`draft-sheet-samples${colorRounds.length ? ' has-color-sample' : ''}`} aria-label="샘플 진행 이력">
          <DraftSampleProgress orders={orders} joined={colorRounds.length > 0} originCountry={draft.originCountry} readOnly={readOnly} onReceive={onReceiveSample} onNext={onRequestNextSampleRound} onOpen={onNextSample ?? onOpen} />
          {sampleReady && colorRounds.length ? (
            <DraftColorSampleProgress rounds={colorRounds} originCountry={draft.originCountry} readOnly={readOnly}
              onReceive={onReceiveColorSample} onOpen={onNextSample ?? onOpen} />
          ) : null}
        </div>
      ) : (
        <div className="draft-sheet-actions draft-sheet-sample-launch"><SampleWorkOrderButton readOnly={readOnly} onUpload={onUploadSampleWorkOrder} onOpen={onOpen} /></div>
      )}
    </td>
    <td className={`draft-sheet-price-cell${priceAmounts && hasColor ? ' has-reply' : ''}`}>
      <DraftPriceRequestButton readOnly={readOnly} hasColors={hasColor} colors={draft.colors} missingColors={missingPriceColors} controls={price}
        confirmedRequestId={draft.specs.confirmedPriceRequestId} />
    </td>
    <td>
      <div className="draft-color-pad draft-sheet-color-tools">
        <ColorDocumentButton
          readOnly={readOnly}
          colors={draft.colors}
          imageChoices={draft.specs.colorImageChoices}
          photoUrls={draft.specs.colorPhotoUrls}
          savedImages={visualBoard.status?.saved_images}
          revision={draft.updatedAt}
          onSaveColors={onSaveColors}
        />
        <SheetConfirmButton
          label={colorsConfirmed ? '컬러 구성 확정' : '컬러 구성 미확정'}
          confirmed={colorsConfirmed}
          canToggle={!readOnly && hasColor}
          blockedTitle="컬러를 먼저 추가해 주세요"
          doneStyle={false}
          className={`draft-sheet-color-heart${colorsConfirmed ? ' is-confirmed' : ''}`}
          onToggle={(next) => onToggleConfirm('colorsConfirmed', next)}
        >
          <Heart size={17} fill={colorsConfirmed ? 'currentColor' : 'none'} />
        </SheetConfirmButton>
      </div>
      <div className="draft-color-lines">
        {draft.colors.length ? draft.colors.map((color, index) => {
          const photoUrl = draft.specs.colorPhotoUrls?.[color.id]
          return (
            <ColorLine key={color.id} index={index}>
              <ColorImageChoiceDot choice={draft.specs.colorImageChoices?.[color.id]} photoUrl={photoUrl} />
              <SheetInlineField
                readOnly
                label={`${draft.draftNo} 컬러 ${index + 1} 이름`}
                className="draft-sheet-color-name"
                value={color.name}
                onCommit={(next) => onRenameColor(color.id, next)}
              />
              {color.orderQty != null && color.orderQty > 0 ? <small>{formatNumber(color.orderQty)}</small> : null}
            </ColorLine>
          )
        }) : <ColorLine index={0}><span className="draft-sheet-muted">컬러 미정</span></ColorLine>}
      </div>
    </td>
    <td>
      <div className="draft-color-pad" />
      <div className="draft-sheet-information grid w-fit grid-cols-[max-content_auto]">
        <div className="draft-color-lines">
          {colorRows.map((color, index) => {
            const spec = color ? resolveColorSpec(draft.specs, color.id) : null
            function informationButton(field: ColorInformationField) {
              const value = spec?.[field] ?? ''
              const displayValue = field === 'size'
                ? [formatSizeSpecLabel(value), spec?.weight.trim()].filter(Boolean).join(' · ')
                : value || spec?.coating || ''
              const confirmed = spec ? isColorInformationConfirmed(draft.specs, spec, field) : false
              const editing = !readOnly && color && spec
                ? hasInformationEdits(spec, informationEdits[colorInformationEditKey(color.id, field)])
                : false
              const expanded = !fromVisual && information?.colorId === color?.id && information?.field === field
              return (
                <InformationButton key={field} label={DRAFT_INFORMATION_LABELS[field]}
                  value={displayValue}
                  tone={specTone(displayValue || (field === 'size' ? spec?.sizeNote ?? '' : ''), confirmed, editing)}
                  panelId={informationId} expanded={expanded} disabled={!color}
                  onClick={event => {
                    if (!color) return
                    setInformation(expanded ? null : { anchor: event.currentTarget, colorId: color.id, field })
                  }} />
              )
            }
            return (
              <ColorLine key={color?.id ?? 'none'} index={index}>
                <div className="draft-sheet-info">
                  <SampleStatus
                    status={colorSampleLineStatus(colorSampleStarted, colorSampleReceived, Boolean(color && colorSampleDone(color.id)))}
                    canToggle={!readOnly && Boolean(color) && colorSampleReceived}
                    onToggle={color ? () => toggleColorSampleDone(color.id, !colorSampleDone(color.id)) : undefined}
                  />
                  <div className="draft-sheet-specs">
                    {(['size', 'fabric'] as const).map(informationButton)}
                  </div>
                </div>
              </ColorLine>
            )
          })}
        </div>
        <div className="flex items-center justify-center bg-card pl-2">
          <InformationButton label={documentConfirmed && specDocument.trim() && !documentEditing ? '스펙 확정' : '스펙 문서'}
            value={specDocument} tone={specTone(specDocument, documentConfirmed, documentEditing)} panelId={informationId}
            expanded={documentOpen} disabled={false} icon={<FileText size={16} aria-hidden="true" />}
            onClick={event => setInformation(documentOpen ? null : { anchor: event.currentTarget, colorId: null, field: 'specDoc' })} />
        </div>
      </div>
    </td>
    <DraftVisualAmdCells key={`${informationEditorId ?? ''}:${readOnly}:visual-amd`} colors={draft.colors} colorPhotos={draft.specs.colorPhotoUrls}
      readOnly={readOnly} teamWork={teamWork} visualBoard={visualBoard}
      panelId={informationId} activeTrigger={information?.visualTrigger ? { colorId: information.colorId, field: information.visualTrigger } : null}
      onOpenVisualTab={(anchor, colorId, field) => setInformation(current =>
        current?.anchor === anchor && current.field === field ? null : { anchor, colorId, field, visualTrigger: field })} />
    <DraftMdTeamCell key={`${informationEditorId ?? ''}:${readOnly}`} draft={draft} readOnly={readOnly} actorId={informationEditorId} teamWork={teamWork} />
    <td />
    </tr>
    {information && (
      <DraftInformationPanel key={informationEditorId} id={informationId} anchor={information.anchor}
        editorId={informationEditorId} temporaryStore={informationTemporaryStore}
        edits={informationEdits} onEditsChange={updateInformationEdits}
        draft={draft} field={information.field} colorId={information.colorId} readOnly={readOnly} fromVisual={fromVisual}
        onSave={onSaveSheetValue}
        onSharedPhotoChange={onSharedPhotoChange}
        onSaveSpecDocument={onSaveSpecDocument}
        onFieldChange={field => setInformation(current => current && { ...current, field })}
        onClose={closeInformation} />
    )}
  </>
}
