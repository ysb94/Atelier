import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { FileText, GripVertical, Heart, ImageOff, Pencil, Plus, Save, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MAX_DRAFT_COLORS } from '@/lib/drafts/empty-draft'
import { resolveColorSpec } from '@/lib/drafts/color-spec'
import { formatSizeSpecLabel } from '@/lib/drafts/spec-format'
import { resolveColorSampleRounds } from '@/lib/drafts/draft-flow'
import { sampleReadyForNextStage } from '@/lib/drafts/sample-receipt'
import { sheetRegisteredDay } from '@/lib/drafts/sample-work-order'
import { readFileAsDataUrl } from '@/lib/images'
import { DRAFT_STATUS_LABEL, type Brand, type DraftColorRow, type ProductDraft } from '@/lib/types'
import { formatNumber } from '@/lib/utils'
import { RELEASE_CERTAINTY_LABEL, formatReleaseGroupLabel, formatTargetDate, type ResolvedReleaseSchedule } from './release-schedule-preview'
import './draft-board.css'
import { DraftSampleProgress } from './DraftSampleProgress'
import { DraftColorSampleProgress } from './DraftColorSampleProgress'

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

/** Individual actions will be connected as their workflows are defined. */
function DraftAction({ children, label, tone = 'neutral', title }: {
  children: ReactNode; label: string; tone?: 'neutral' | 'pending' | 'done'; title?: string
}) {
  return <button type="button" className={`draft-sheet-action is-${tone}`} disabled aria-label={label} title={`${title ? `${title} · ` : ''}${label} 기능 준비 중`}>{children}</button>
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

type ColorFormRow = { key: number; id: string | null; name: string }

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
  onSaveColors,
}: {
  readOnly?: boolean
  colors: DraftColorRow[]
  onSaveColors: (colors: Array<{ id: string | null; name: string }>) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<ColorFormRow[]>([{ key: 1, id: null, name: '' }])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const nextKey = useRef(1)
  const layoutTops = useRef(new Map<number, number>())
  const shiftRef = useRef(0)
  const dragRef = useRef<{ key: number; pointerId: number; startY: number; y: number } | null>(null)
  const [draggingKey, setDraggingKey] = useState<number | null>(null)
  const [shiftY, setShiftY] = useState(0)

  useEffect(() => {
    if (!open) return
    function closeOnOutside(event: PointerEvent) {
      if (rootRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutside, true)
    return () => document.removeEventListener('pointerdown', closeOnOutside, true)
  }, [open])

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
    if (readOnly || busy || rows.length >= MAX_DRAFT_COLORS) return
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
    if (readOnly || busy || event.button !== 0) return
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
        disabled={readOnly}
        onClick={() => {
          setError('')
          if (!open) {
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
            if (readOnly || busy) return
            if (rows.some((row) => row.id && !row.name.trim())) {
              setError('컬러 이름을 입력하세요.')
              return
            }
            const next = rows
              .filter((row) => row.name.trim())
              .map((row) => ({ id: row.id, name: row.name.trim() }))
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
            void onSaveColors(next)
              .then(() => setOpen(false))
              .catch((err: unknown) => {
                console.warn('[drafts] 컬러 추가 실패', err)
                setError(err instanceof Error ? err.message : '컬러를 저장하지 못했습니다.')
              })
              .finally(() => setBusy(false))
          }}
        >
          <div className="draft-color-add-rows" ref={listRef}>
            {rows.map((row, index) => {
              const lifted = draggingKey === row.key
              return (
              <div
                key={row.key}
                data-color-key={row.key}
                className={`draft-color-add-row${lifted ? ' is-lifted' : ''}`}
                style={lifted ? { transform: `translateY(${shiftY}px)` } : undefined}
              >
                <button
                  type="button"
                  className="draft-color-add-grip"
                  aria-label={`컬러 ${index + 1} 순서 변경`}
                  title="끌어서 순서 변경"
                  disabled={readOnly || busy}
                  onPointerDown={(event) => beginDrag(event, row.key)}
                >
                  <GripVertical className="size-3.5" />
                </button>
                <Input
                  className="h-8 min-w-0 text-sm"
                  aria-label={rows.length > 1 ? `컬러 이름 ${index + 1}` : '컬러 이름'}
                  placeholder="컬러 이름"
                  value={row.name}
                  disabled={readOnly || busy}
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
                  disabled={readOnly || busy}
                  onClick={() => removeRow(row.key)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
              )
            })}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="flex h-8 min-w-0 flex-1 items-center justify-center gap-1 rounded-md border border-dashed border-border text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
              disabled={readOnly || busy || rows.length >= MAX_DRAFT_COLORS}
              onClick={addRow}
            >
              <Plus className="size-3.5" />
              컬러 추가
            </button>
            <Button type="submit" size="sm" className="h-8 shrink-0 px-2.5" disabled={readOnly || busy}>
              <Save className="size-3.5" />
              {busy ? '저장 중' : '저장'}
            </Button>
          </div>
          {error ? <p>{error}</p> : rows.length >= MAX_DRAFT_COLORS ? <p>최대 {MAX_DRAFT_COLORS}컬러까지 추가할 수 있습니다.</p> : null}
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
  placeholder,
  className,
  showError = false,
  multiline = false,
  onCommit,
}: {
  readOnly?: boolean
  label: string
  value: string
  placeholder?: string
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
    value: text,
    placeholder,
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

function EntryButton({
  readOnly = false,
  label,
  value,
  placeholder,
  tone = 'neutral',
  icon,
  canApplyAll = false,
  disabled = false,
  onSave,
}: {
  readOnly?: boolean
  label: string
  value: string
  placeholder: string
  tone?: 'neutral' | 'pending' | 'done'
  icon?: ReactNode
  canApplyAll?: boolean
  disabled?: boolean
  onSave: (value: string, applyAll: boolean) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(value)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const shown = value.trim()

  useEffect(() => {
    if (!open || readOnly) setText(value)
  }, [open, value, readOnly])

  function save(applyAll: boolean) {
    if (readOnly) return
    setBusy(true)
    setError('')
    void onSave(text.trim(), applyAll)
      .then(() => setOpen(false))
      .catch((err: unknown) => {
        console.warn('[drafts] 시트 값 저장 실패', err)
        setError(err instanceof Error ? err.message : '저장하지 못했습니다.')
      })
      .finally(() => setBusy(false))
  }

  return (
    <div className="draft-sheet-entry">
      <button
        type="button"
        className={`draft-sheet-action is-${tone}`}
        aria-expanded={open}
        aria-label={label}
        title={shown || label}
        disabled={disabled}
        onClick={() => {
          setError('')
          setText(value)
          setOpen((current) => !current)
        }}
      >
        {icon}
        <span className="draft-sheet-entry-label">{label}</span>
      </button>
      {open ? (
        <form
          className="draft-sheet-entry-form"
          onSubmit={(event) => {
            event.preventDefault()
            save(false)
          }}
        >
          <input
            aria-label={`${label} 값`}
            placeholder={placeholder}
            value={text}
            readOnly={readOnly}
            disabled={busy}
            onChange={(event) => { if (!readOnly) setText(event.target.value) }}
          />
          <div className="draft-sheet-entry-actions">
            <button type="submit" disabled={readOnly || busy}>
              {busy ? '저장 중…' : '저장'}
            </button>
            {canApplyAll ? (
              <button type="button" className="is-ghost" disabled={readOnly || busy} onClick={() => save(true)}>
                전체 컬러에 적용
              </button>
            ) : null}
          </div>
          {error ? <p>{error}</p> : null}
        </form>
      ) : null}
    </div>
  )
}

function SampleStatus({
  inProgress,
  sent,
}: {
  inProgress: boolean
  sent: boolean
}) {
  const label = sent ? '발송 완료' : inProgress ? '샘플중' : '대기'
  const tone = sent ? 'done' : inProgress ? 'pending' : 'neutral'
  const title = sent ? '컬러 샘플 발송 완료' : inProgress ? '컬러 샘플 작업지시서를 보냄' : '작업지시서 전'
  return (
    <button
      type="button"
      className={`draft-sheet-action is-${tone} draft-sheet-status-badge`}
      aria-label={label}
      title={title}
      disabled
    >
      {label}
    </button>
  )
}

function specTone(value: string, confirmed: boolean): 'neutral' | 'pending' | 'done' {
  if (!value.trim()) return 'neutral'
  return confirmed ? 'done' : 'pending'
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

export function DraftSheetRow({ draft, readOnly = false, schedule, brand, onOpen, onNextSample, onSchedule, onSaveColors, onRenameColor, onSaveSheetValue, onUploadSampleWorkOrder, onReceiveSample, onRequestNextSampleRound, onReceiveColorSample, onToggleConfirm }: {
  readOnly?: boolean
  draft: ProductDraft; schedule: ResolvedReleaseSchedule | undefined; brand: Brand | undefined
  onOpen: () => void
  onNextSample?: () => void
  onSchedule: () => void
  onSaveColors: (colors: Array<{ id: string | null; name: string }>) => Promise<void>
  onRenameProduct: (field: 'nameKo' | 'nameEn', name: string) => Promise<void>
  onRenameColor: (colorId: string, name: string) => Promise<void>
  onSaveSheetValue: (colorId: string, field: 'size' | 'fabric' | 'weight' | 'specDoc', value: string, applyAll: boolean) => Promise<void>
  onUploadSampleWorkOrder: (file: { url: string; name: string }) => Promise<void>
  onReceiveSample: (id: string) => Promise<void>
  onRequestNextSampleRound: (file: { url: string; name: string }, country?: string) => Promise<void>
  onUploadColorWorkOrder: (file: { url: string; name: string }) => Promise<void>
  onReceiveColorSample: (id: string) => Promise<void>
  onToggleConfirm: (flag: DraftConfirmFlag, next: boolean) => Promise<void>
}) {
  const orders = [...(draft.sampleWorkOrders ?? [])]
    .filter((order) => order.url?.trim())
    .sort((a, b) => a.round - b.round)
  const latestOrder = orders[orders.length - 1]
  const colorRounds = resolveColorSampleRounds(draft)
  const sampleReady = sampleReadyForNextStage(latestOrder) || colorRounds.length > 0
  const latestColorRound = colorRounds[colorRounds.length - 1]
  const colorSampleSent = Boolean(latestColorRound?.returnedAt)
  const name = draft.nameEn.trim() || draft.nameKo.trim() || '이름 미정'
  const named = Boolean(draft.nameEn.trim() || draft.nameKo.trim())
  const hasColor = draft.colors.length > 0
  const nameConfirmed = Boolean(draft.specs.nameConfirmed)
  const colorsConfirmed = Boolean(draft.specs.colorsConfirmed)
  const registeredDay = sheetRegisteredDay(draft.createdAt)
  const specsConfirmed = draft.specs.size.confirmed && draft.specs.fabric.confirmed && draft.specs.weight.confirmed
  const colorRows: Array<DraftColorRow | null> = draft.colors.length ? draft.colors : [null]
  const canApplyAll = draft.colors.length > 1

  function saveColorSpec(colorId: string, field: 'size' | 'fabric' | 'weight' | 'specDoc') {
    return (value: string, applyAll: boolean) => onSaveSheetValue(colorId, field, value, applyAll)
  }

  return <tr className="draft-sheet-row">
    <td><div className="draft-sheet-image-cell">
      <strong className="draft-sheet-brand">{brand?.name ?? '브랜드 미정'}</strong>
      <DraftPhoto src={draft.imageUrl} name={name === '이름 미정' ? draft.draftNo : name} onOpen={onOpen} />
      <div className="draft-sheet-names">
        <div className="draft-sheet-owner">Designer <strong>{draft.owner.trim() || '미정'}</strong></div>
        <strong className="draft-sheet-number">No. {draft.draftNo}</strong>
        <button type="button" className={`draft-sheet-product-name${draft.nameKo.trim() ? '' : ' is-placeholder'}`} aria-label={`${draft.draftNo} 한글명`} onClick={onOpen}>{draft.nameKo.trim() || '투웨이 셔링 호보백_글로우'}</button>
        <button type="button" className={`draft-sheet-product-name is-en${draft.nameEn.trim() ? '' : ' is-placeholder'}`} aria-label={`${draft.draftNo} 영문명`} onClick={onOpen}>{draft.nameEn.trim() || '2way shirring hobo bag_Glow'}</button>
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
    <td className="draft-sheet-price-cell">
      <button type="button" className="draft-sheet-price-request" disabled={readOnly} title="기능 준비 중">
        단가 요청
      </button>
    </td>
    <td>
      <div className="draft-color-pad draft-sheet-color-tools">
        <ColorDocumentButton readOnly={readOnly} colors={draft.colors} onSaveColors={onSaveColors} />
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
        {draft.colors.length ? draft.colors.map((color, index) => (
          <ColorLine key={color.id} index={index}>
            <SheetInlineField
              readOnly
              label={`${draft.draftNo} 컬러 ${index + 1} 이름`}
              className="draft-sheet-color-name"
              value={color.name}
              placeholder="컬러 이름"
              onCommit={(next) => onRenameColor(color.id, next)}
            />
            {color.orderQty != null && color.orderQty > 0 ? <small>{formatNumber(color.orderQty)}</small> : null}
          </ColorLine>
        )) : <ColorLine index={0}><span className="draft-sheet-muted">컬러 미정</span></ColorLine>}
      </div>
    </td>
    <td>
      <div className="draft-color-pad" />
      <div className="draft-color-lines">
        {colorRows.map((color, index) => {
          const spec = color ? resolveColorSpec(draft.specs, color.id) : null
          const specDocLabel = specsConfirmed && spec?.specDoc.trim() ? '스펙 확정' : '스펙 문서'
          return (
            <ColorLine key={color?.id ?? 'none'} index={index}>
              <div className="draft-sheet-info">
                <SampleStatus
                  inProgress={Boolean(color?.sampleWorkOrderUrl?.trim())}
                  sent={colorSampleSent}
                />
                <div className="draft-sheet-specs">
                  <EntryButton
                    readOnly={readOnly}
                    label="size"
                    value={formatSizeSpecLabel(spec?.size ?? '')}
                    placeholder="300×120×210"
                    tone={specTone(spec?.size ?? '', draft.specs.size.confirmed)}
                    canApplyAll={canApplyAll}
                    disabled={!color}
                    onSave={color ? saveColorSpec(color.id, 'size') : async () => undefined}
                  />
                  <EntryButton
                    readOnly={readOnly}
                    label="Fabric"
                    value={spec?.fabric ?? ''}
                    placeholder="원단"
                    tone={specTone(spec?.fabric ?? '', draft.specs.fabric.confirmed)}
                    canApplyAll={canApplyAll}
                    disabled={!color}
                    onSave={color ? saveColorSpec(color.id, 'fabric') : async () => undefined}
                  />
                  <EntryButton
                    readOnly={readOnly}
                    label="Weight"
                    value={spec?.weight ?? ''}
                    placeholder="무게"
                    tone={specTone(spec?.weight ?? '', draft.specs.weight.confirmed)}
                    canApplyAll={canApplyAll}
                    disabled={!color}
                    onSave={color ? saveColorSpec(color.id, 'weight') : async () => undefined}
                  />
                </div>
                <div className="draft-sheet-actions">
                  <EntryButton
                    readOnly={readOnly}
                    label={specDocLabel}
                    value={spec?.specDoc ?? ''}
                    placeholder="스펙 내용"
                    tone={specTone(spec?.specDoc ?? '', specsConfirmed)}
                    icon={<FileText size={16} />}
                    canApplyAll={canApplyAll}
                    disabled={!color}
                    onSave={color ? saveColorSpec(color.id, 'specDoc') : async () => undefined}
                  />
                </div>
              </div>
            </ColorLine>
          )
        })}
      </div>
    </td>
    <td className="draft-sheet-md-cell">
      <button type="button" className="draft-sheet-edit" aria-label={`${draft.draftNo} 기획안 ${readOnly ? '조회' : '편집'}`} onClick={onOpen}><Pencil size={12} />기획안 {readOnly ? '조회' : '편집'}</button>
      <div className="draft-sheet-md">
      <div className="draft-sheet-md-assets">
        <div className="draft-color-pad" />
        <div className="draft-color-lines">
          {(draft.colors.length ? draft.colors : [{ id: 'none' }]).map((color, index) => (
            <ColorLine key={color.id} index={index}>
              <div className="draft-sheet-actions"><DraftAction label="MD Image">Image</DraftAction><DraftAction label="MD html">html</DraftAction></div>
            </ColorLine>
          ))}
        </div>
      </div>
      <div className="draft-sheet-release"><strong>발매 이슈</strong><p>{draft.releaseIssue.trim() || '등록된 이슈 없음'}</p>
        {schedule?.group && <div className="draft-sheet-schedule">{formatReleaseGroupLabel(schedule.group)}{schedule.certainty ? ` · ${RELEASE_CERTAINTY_LABEL[schedule.certainty]}` : ''}{schedule.targetDate ? ` · ${formatTargetDate(schedule.targetDate)}` : ''}{schedule.isPreview ? ' · 미리보기' : ''}</div>}
        <button type="button" className="draft-sheet-schedule-button" disabled={readOnly} onClick={onSchedule}>{schedule?.group ? '일정 수정' : '일정 정하기'}</button>
      </div>
    </div></td>
  </tr>
}
