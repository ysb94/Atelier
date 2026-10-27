import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { FileText, Heart, ImageOff, Pencil, X } from 'lucide-react'
import { MAX_DRAFT_COLORS } from '@/lib/drafts/empty-draft'
import { resolveColorSpec } from '@/lib/drafts/color-spec'
import { formatSizeSpecLabel } from '@/lib/drafts/spec-format'
import { resolveColorSampleRounds } from '@/lib/drafts/draft-flow'
import {
  draftStatePercent,
  sheetDay,
} from '@/lib/drafts/sample-work-order'
import { readFileAsDataUrl } from '@/lib/images'
import { DRAFT_STATUS_LABEL, type Brand, type DraftColorRow, type ProductDraft } from '@/lib/types'
import { formatNumber } from '@/lib/utils'
import { RELEASE_CERTAINTY_LABEL, formatReleaseGroupLabel, formatTargetDate, type ResolvedReleaseSchedule } from './release-schedule-preview'
import './draft-board.css'

const SAMPLE_WORK_ORDER_ACCEPT =
  'application/pdf,image/png,image/jpeg,image/webp,.pdf,.png,.jpg,.jpeg,.webp,.xls,.xlsx'
const SAMPLE_WORK_ORDER_MAX_BYTES = 8 * 1024 * 1024

function SampleRoundDecision({
  nextLabel,
  onPass,
  onNextRound,
}: {
  nextLabel: string
  onPass: () => Promise<void>
  onNextRound: () => Promise<void>
}) {
  const [busy, setBusy] = useState<'next' | 'pass' | null>(null)
  const [error, setError] = useState('')

  async function run(kind: 'next' | 'pass', action: () => Promise<void>) {
    if (busy) return
    setBusy(kind)
    setError('')
    try {
      await action()
    } catch (err) {
      console.warn('[drafts] 샘플 차수 결정 실패', err)
      setError(err instanceof Error ? err.message : '샘플 상태를 저장하지 못했습니다.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="draft-sheet-sample-decision">
      <button
        type="button"
        className="draft-sheet-action is-neutral"
        disabled={busy !== null}
        onClick={() => void run('next', onNextRound)}
      >
        {busy === 'next' ? '저장 중' : nextLabel}
      </button>
      <button
        type="button"
        className="draft-sheet-action is-neutral"
        disabled={busy !== null}
        onClick={() => void run('pass', onPass)}
      >
        {busy === 'pass' ? '저장 중' : '합격'}
      </button>
      {error ? <span className="draft-sheet-field-error">{error}</span> : null}
    </div>
  )
}

function ColorSampleWorkOrderButton({
  colorsConfirmed,
  onUpload,
}: {
  colorsConfirmed: boolean
  onUpload: (file: { url: string; name: string }) => Promise<void>
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) dialogRef.current?.showModal()
  }, [open])

  function close() {
    dialogRef.current?.close()
    setOpen(false)
  }

  return (
    <>
      <button
        type="button"
        className="draft-sheet-action is-neutral"
        disabled={busy}
        onClick={() => {
          if (colorsConfirmed) inputRef.current?.click()
          else setOpen(true)
        }}
      >
        {busy ? '올리는 중' : '컬러 샘플 작업지시서'}
      </button>
      {error ? <span className="draft-sheet-field-error">{error}</span> : null}
      <input
        ref={inputRef}
        type="file"
        accept={SAMPLE_WORK_ORDER_ACCEPT}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
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
              console.warn('[drafts] 컬러 샘플 작업 지시서 업로드 실패', err)
              setError(err instanceof Error ? err.message : '작업 지시서를 올리지 못했습니다.')
            })
            .finally(() => setBusy(false))
        }}
      />
      {open ? createPortal(
        <dialog
          ref={dialogRef}
          className="draft-color-confirm-dialog"
          aria-labelledby="color-confirm-title"
          onCancel={(event) => {
            event.preventDefault()
            close()
          }}
          onClose={() => setOpen(false)}
          onClick={(event) => {
            if (event.target === event.currentTarget) close()
          }}
        >
          <h2 id="color-confirm-title">컬러를 확정해 주세요</h2>
          <p>컬러 샘플 작업지시서를 보내려면 COLOR 칸 상단의 하트(♥)를 눌러 컬러 구성을 먼저 확정해 주세요.</p>
          <div>
            <button type="button" onClick={close}>닫기</button>
          </div>
        </dialog>,
        document.body,
      ) : null}
    </>
  )
}

function SampleWorkOrderButton({
  onUpload,
  label = '샘플 작업지시서',
}: {
  onUpload: (file: { url: string; name: string }) => Promise<void>
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
          if (!file) return
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
      <button
        type="button"
        className="draft-sheet-action is-neutral"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? '올리는 중' : label}
      </button>
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

function ColorDocumentButton({
  colorCount,
  onAddColor,
}: {
  colorCount: number
  onAddColor: (name: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const full = colorCount >= MAX_DRAFT_COLORS

  return (
    <div className="draft-color-add">
      <button
        type="button"
        className="draft-sheet-action is-neutral"
        aria-expanded={open}
        aria-label="컬러 문서"
        title="컬러 추가"
        onClick={() => {
          setError('')
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
            const next = name.trim()
            if (!next) {
              setError('컬러 이름을 입력하세요.')
              return
            }
            if (full) {
              setError(`최대 ${MAX_DRAFT_COLORS}컬러까지 추가할 수 있습니다.`)
              return
            }
            setBusy(true)
            setError('')
            void onAddColor(next)
              .then(() => {
                setName('')
                setOpen(false)
              })
              .catch((err: unknown) => {
                console.warn('[drafts] 컬러 추가 실패', err)
                setError(err instanceof Error ? err.message : '컬러를 추가하지 못했습니다.')
              })
              .finally(() => setBusy(false))
          }}
        >
          <input
            aria-label="컬러 이름"
            placeholder="컬러 이름"
            value={name}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
          />
          <button type="submit" disabled={busy || full}>
            컬러 추가
          </button>
          {error ? <p>{error}</p> : null}
        </form>
      ) : null}
    </div>
  )
}

function ColorLine({ index, children }: { index: number; children: ReactNode }) {
  return <div className={`draft-color-line${index % 2 === 1 ? ' is-alt' : ''}`}>{children}</div>
}

function SheetInlineField({
  label,
  value,
  placeholder,
  className,
  showError = false,
  multiline = false,
  onCommit,
}: {
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
    if (inputRef.current && document.activeElement === inputRef.current) return
    setText(value)
    setError('')
  }, [value])

  useEffect(() => {
    const field = inputRef.current
    if (!(field instanceof HTMLTextAreaElement)) return
    field.style.height = 'auto'
    field.style.height = `${field.scrollHeight}px`
  }, [text])

  function commit(raw: string) {
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
    autoComplete: 'off' as const,
    spellCheck: false as const,
    onChange: (event: { target: { value: string } }) => {
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
  label,
  value,
  placeholder,
  tone = 'neutral',
  icon,
  canApplyAll = false,
  disabled = false,
  onSave,
}: {
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
    if (!open) setText(value)
  }, [open, value])

  function save(applyAll: boolean) {
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
            disabled={busy}
            onChange={(event) => setText(event.target.value)}
          />
          <div className="draft-sheet-entry-actions">
            <button type="submit" disabled={busy}>
              {busy ? '저장 중…' : '저장'}
            </button>
            {canApplyAll ? (
              <button type="button" className="is-ghost" disabled={busy} onClick={() => save(true)}>
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
  passed,
}: {
  inProgress: boolean
  passed: boolean
}) {
  const label = passed ? '합격' : inProgress ? '샘플중' : '대기'
  const tone = passed ? 'done' : inProgress ? 'pending' : 'neutral'
  const title = passed ? '컬러 샘플 합격' : inProgress ? '컬러 샘플 작업지시서를 보냄' : '작업지시서 전'
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

function SampleTripArrows({
  requestAt,
  returnAt,
}: {
  requestAt: string | null
  returnAt: string | null
}) {
  const requestDay = sheetDay(requestAt)
  const returnDay = sheetDay(returnAt)
  return (
    <>
      {requestDay ? (
        <>
          <svg className="draft-sheet-sample-request" viewBox="0 0 36 16" aria-hidden="true">
            <path d="M1 12C12 12 16 4 30 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M25 1.2L31.5 4L25 7.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="draft-sheet-sample-request-date" title="샘플 요청일">
            {requestDay}
          </span>
        </>
      ) : null}
      {returnDay ? (
        <>
          <svg className="draft-sheet-sample-return" viewBox="0 0 36 16" aria-hidden="true">
            <path d="M35 4C24 4 20 12 6 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M11 8.8L4.5 12L11 15.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="draft-sheet-sample-return-date" title="발송 완료일">
            {returnDay}
          </span>
        </>
      ) : null}
    </>
  )
}

function specTone(value: string, confirmed: boolean): 'neutral' | 'pending' | 'done' {
  if (!value.trim()) return 'neutral'
  return confirmed ? 'done' : 'pending'
}

export function DraftPhoto({ src, name }: { src: string | null; name: string }) {
  const [open, setOpen] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { if (open) dialog.current?.showModal() }, [open])
  return <>
    <button type="button" className="draft-sheet-photo" disabled={!src} aria-label={`${name} 사진 크게 보기`} onClick={() => setOpen(true)}>
      {src ? <img src={src} alt={name} loading="lazy" /> : <span><ImageOff size={25} /><small>등록된 사진 없음</small></span>}
    </button>
    {open && src && createPortal(<dialog ref={dialog} className="draft-photo-dialog" aria-label={`${name} 사진 크게 보기`} onCancel={() => setOpen(false)} onClose={() => setOpen(false)} onClick={event => { if (event.target === event.currentTarget) setOpen(false) }}>
      <header><strong>{name}</strong><button type="button" aria-label="사진 크게 보기 닫기" onClick={() => setOpen(false)}><X size={20} /></button></header>
      <img src={src} alt={name} />
    </dialog>, document.body)}
  </>
}

export type DraftConfirmFlag = 'nameConfirmed' | 'colorsConfirmed' | 'colorNamesConfirmed'

export function DraftSheetRow({ draft, readOnly = false, schedule, brand, onOpen, onSchedule, onAddColor, onRenameProduct, onRenameColor, onSaveSheetValue, onUploadSampleWorkOrder, onPassSample, onRequestNextSampleRound, onUploadColorWorkOrder, onPassColorSample, onRequestNextColorSampleRound, onToggleConfirm }: {
  readOnly?: boolean
  draft: ProductDraft; schedule: ResolvedReleaseSchedule | undefined; brand: Brand | undefined
  onOpen: () => void; onSchedule: () => void
  onAddColor: (name: string) => Promise<void>
  onRenameProduct: (field: 'nameKo' | 'nameEn', name: string) => Promise<void>
  onRenameColor: (colorId: string, name: string) => Promise<void>
  onSaveSheetValue: (colorId: string, field: 'size' | 'fabric' | 'weight' | 'specDoc', value: string, applyAll: boolean) => Promise<void>
  onUploadSampleWorkOrder: (file: { url: string; name: string }) => Promise<void>
  onPassSample: () => Promise<void>
  onRequestNextSampleRound: () => Promise<void>
  onUploadColorWorkOrder: (file: { url: string; name: string }) => Promise<void>
  onPassColorSample: () => Promise<void>
  onRequestNextColorSampleRound: () => Promise<void>
  onToggleConfirm: (flag: DraftConfirmFlag, next: boolean) => Promise<void>
}) {
  const orders = [...(draft.sampleWorkOrders ?? [])]
    .filter((order) => order.url?.trim())
    .sort((a, b) => a.round - b.round)
  const latestOrder = orders[orders.length - 1]
  const latestOrderId = latestOrder?.id
  const samplePassed = Boolean(latestOrder?.passed)
  const colorRounds = resolveColorSampleRounds(draft)
  const latestColorRound = colorRounds[colorRounds.length - 1]
  const colorSamplePassed = Boolean(latestColorRound?.passed)
  const name = draft.nameEn.trim() || draft.nameKo.trim() || '이름 미정'
  const named = Boolean(draft.nameEn.trim() || draft.nameKo.trim())
  const hasColor = draft.colors.length > 0
  const hasColorName = draft.colors.some((color) => color.name.trim())
  const nameConfirmed = Boolean(draft.specs.nameConfirmed)
  const colorsConfirmed = Boolean(draft.specs.colorsConfirmed)
  const colorNamesConfirmed = Boolean(draft.specs.colorNamesConfirmed)
  const progress = draftStatePercent(draft)
  const specsConfirmed = draft.specs.size.confirmed && draft.specs.fabric.confirmed && draft.specs.weight.confirmed
  const colorRows: Array<DraftColorRow | null> = draft.colors.length ? draft.colors : [null]
  const canApplyAll = draft.colors.length > 1

  function saveColorSpec(colorId: string, field: 'size' | 'fabric' | 'weight' | 'specDoc') {
    return (value: string, applyAll: boolean) => onSaveSheetValue(colorId, field, value, applyAll)
  }

  if (readOnly) return <tr className="draft-sheet-row"><td><strong>{draft.draftNo}</strong><p>{brand?.name ?? '브랜드 미정'}</p><p>{draft.owner || '담당자 미정'}</p><button type="button" className="text-primary underline" onClick={onOpen}>기획안 조회</button></td><td>{draft.nameKo || draft.nameEn || '이름 미정'}</td><td>{draft.colors.map(color=>color.name).join(', ') || '컬러 미정'}</td><td>{DRAFT_STATUS_LABEL[draft.status]}</td><td colSpan={2}><span className="text-xs text-muted-foreground">조회 전용 · 작성자만 수정</span></td></tr>
  return <tr className="draft-sheet-row">
    <td>
      <strong className="draft-sheet-brand">{brand?.name ?? '브랜드 미정'}</strong>
      <div className="draft-sheet-owner">Designer <strong>{draft.owner.trim() || '미정'}</strong></div>
      <strong className="draft-sheet-number">No. {draft.draftNo}</strong>
      <div className="draft-sheet-state"><span>State <strong>{progress}%</strong></span><span className="draft-sheet-progress" role="meter" aria-label="기획 진행률" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${progress}%` }} /></span></div>
      {(draft.status !== 'open' || draft.held) && <div className="draft-sheet-status">{draft.status !== 'open' ? DRAFT_STATUS_LABEL[draft.status] : ''}{draft.held ? ' · 보류' : ''}</div>}
      {orders.length > 0 ? (
        <div className="draft-sheet-samples" aria-label="샘플 진행 이력">
          {samplePassed ? (
            <>
              <p className="draft-sheet-sample-confirmed">샘플 확정</p>
              {colorRounds.length ? colorRounds.map((round) => {
                const latest = round.id === latestColorRound?.id
                return (
                  <div className="draft-sheet-sample-block" key={round.id} aria-label="컬러 샘플">
                    <span className="draft-sheet-sample-mark">
                      <b>컬러 샘플</b>
                    </span>
                    <small className="draft-sheet-sample-round">{round.round}차</small>
                    <SampleTripArrows requestAt={round.shippedAt} returnAt={round.returnedAt} />
                    {latest && round.returnedAt && !round.passed ? (
                      <SampleRoundDecision
                        nextLabel={`${round.round + 1}차 GO`}
                        onPass={onPassColorSample}
                        onNextRound={onRequestNextColorSampleRound}
                      />
                    ) : round.returnedAt ? null : (
                      <span className="draft-sheet-sample-wait">Waiting</span>
                    )}
                  </div>
                )
              }) : (
                <div className="draft-sheet-sample-block" aria-label="컬러 샘플">
                  <span className="draft-sheet-sample-mark">
                    <b>컬러 샘플</b>
                  </span>
                  <small className="draft-sheet-sample-round">1차</small>
                  <div className="draft-sheet-color-orders">
                    <ColorSampleWorkOrderButton
                      colorsConfirmed={colorsConfirmed}
                      onUpload={onUploadColorWorkOrder}
                    />
                  </div>
                </div>
              )}
            </>
          ) : orders.map(order => (
            <div className="draft-sheet-sample-block" key={order.id}>
              <span className="draft-sheet-sample-mark">
                <b>Sample</b>
              </span>
              <small className="draft-sheet-sample-round">{order.round}차</small>
              <SampleTripArrows requestAt={order.shippedAt} returnAt={order.returnedAt} />
              {order.id === latestOrderId && order.returnedAt && !order.passed && !order.failReason.trim() ? (
                <SampleRoundDecision
                  nextLabel={`${order.round + 1}차 GO`}
                  onPass={onPassSample}
                  onNextRound={onRequestNextSampleRound}
                />
              ) : order.returnedAt ? null : (
                <span className="draft-sheet-sample-wait">Waiting</span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="draft-sheet-actions"><SampleWorkOrderButton onUpload={onUploadSampleWorkOrder} /></div>
      )}
    </td>
    <td><div className="draft-sheet-image-cell">
      <DraftPhoto src={draft.imageUrl} name={name === '이름 미정' ? draft.draftNo : name} />
      <div className="draft-sheet-names">
        <SheetInlineField
          label={`${draft.draftNo} 한글명`}
          className="draft-sheet-product-name"
          value={draft.nameKo}
          placeholder="투웨이 셔링 호보백_글로우"
          multiline
          showError
          onCommit={(next) => onRenameProduct('nameKo', next)}
        />
        <SheetInlineField
          label={`${draft.draftNo} 영문명`}
          className="draft-sheet-product-name"
          value={draft.nameEn}
          placeholder="2way shirring hobo bag_Glow"
          multiline
          showError
          onCommit={(next) => onRenameProduct('nameEn', next)}
        />
      </div>
      <SheetConfirmButton
        label="이름확정"
        confirmed={nameConfirmed}
        canToggle={named}
        blockedTitle="한글명 또는 영문명을 먼저 입력해 주세요"
        onToggle={(next) => onToggleConfirm('nameConfirmed', next)}
      >
        {named ? '이름확정' : '이름 미정'}
      </SheetConfirmButton>
    </div></td>
    <td className="draft-sheet-price-cell">
      <button type="button" className="draft-sheet-price-request" title="기능 준비 중">
        단가 요청
      </button>
    </td>
    <td>
      <div className="draft-color-pad draft-sheet-color-tools">
        <ColorDocumentButton colorCount={draft.colors.length} onAddColor={onAddColor} />
        <SheetConfirmButton
          label={colorsConfirmed ? '컬러 구성 확정' : '컬러 구성 미확정'}
          confirmed={colorsConfirmed}
          canToggle={hasColor}
          blockedTitle="컬러를 먼저 추가해 주세요"
          doneStyle={false}
          className={`draft-sheet-color-heart${colorsConfirmed ? ' is-confirmed' : ''}`}
          onToggle={(next) => onToggleConfirm('colorsConfirmed', next)}
        >
          <Heart size={17} fill={colorsConfirmed ? 'currentColor' : 'none'} />
        </SheetConfirmButton>
        <SheetConfirmButton
          label="컬러명확정"
          confirmed={colorNamesConfirmed}
          canToggle={hasColorName}
          blockedTitle="컬러 이름을 먼저 입력해 주세요"
          className="draft-sheet-color-name-confirm"
          onToggle={(next) => onToggleConfirm('colorNamesConfirmed', next)}
        />
      </div>
      <div className="draft-color-lines">
        {draft.colors.length ? draft.colors.map((color, index) => (
          <ColorLine key={color.id} index={index}>
            <SheetInlineField
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
                  passed={colorSamplePassed}
                />
                <div className="draft-sheet-specs">
                  <EntryButton
                    label="size"
                    value={formatSizeSpecLabel(spec?.size ?? '')}
                    placeholder="300×120×210"
                    tone={specTone(spec?.size ?? '', draft.specs.size.confirmed)}
                    canApplyAll={canApplyAll}
                    disabled={!color}
                    onSave={color ? saveColorSpec(color.id, 'size') : async () => undefined}
                  />
                  <EntryButton
                    label="Fabric"
                    value={spec?.fabric ?? ''}
                    placeholder="원단"
                    tone={specTone(spec?.fabric ?? '', draft.specs.fabric.confirmed)}
                    canApplyAll={canApplyAll}
                    disabled={!color}
                    onSave={color ? saveColorSpec(color.id, 'fabric') : async () => undefined}
                  />
                  <EntryButton
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
      <button type="button" className="draft-sheet-edit" aria-label={`${draft.draftNo} 기획안 편집`} onClick={onOpen}><Pencil size={12} />기획안 편집</button>
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
        <button type="button" className="draft-sheet-schedule-button" onClick={onSchedule}>{schedule?.group ? '일정 수정' : '일정 정하기'}</button>
      </div>
    </div></td>
  </tr>
}
