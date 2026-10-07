import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDownLeft, ArrowUpRight, Check, FileText, Heart, ImageOff, Pencil, X } from 'lucide-react'
import { MAX_DRAFT_COLORS } from '@/lib/drafts/empty-draft'
import { DRAFT_STATUS_LABEL, type Brand, type DraftSpec, type ProductDraft } from '@/lib/types'
import { formatNumber } from '@/lib/utils'
import { RELEASE_CERTAINTY_LABEL, formatReleaseGroupLabel, formatTargetDate, type ResolvedReleaseSchedule } from './release-schedule-preview'
import './draft-board.css'

/** Individual actions will be connected as their workflows are defined. */
function DraftAction({ children, label, tone = 'neutral', title }: {
  children: ReactNode; label: string; tone?: 'neutral' | 'pending' | 'done'; title?: string
}) {
  return <button type="button" className={`draft-sheet-action is-${tone}`} disabled aria-label={label} title={`${title ? `${title} · ` : ''}${label} 기능 준비 중`}>{children}</button>
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
  onCommit,
}: {
  label: string
  value: string
  placeholder?: string
  className: string
  showError?: boolean
  onCommit: (next: string) => Promise<void>
}) {
  const inputRef = useRef<HTMLInputElement>(null)
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

  return (
    <>
      <input
        ref={inputRef}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        title={error || undefined}
        className={className}
        value={text}
        placeholder={placeholder}
        disabled={busy}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => {
          setText(event.target.value)
          if (error) setError('')
        }}
        onBlur={(event) => {
          if (revertRef.current) {
            revertRef.current = false
            return
          }
          if (busyRef.current) return
          commit(event.currentTarget.value)
        }}
        onKeyDown={(event) => {
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
        }}
      />
      {showError && error ? (
        <span className="draft-sheet-field-error">{error}</span>
      ) : null}
    </>
  )
}

function SpecAction({ label, spec }: { label: string; spec: DraftSpec }) {
  return <DraftAction label={label} tone={spec.confirmed ? 'done' : spec.value.trim() ? 'pending' : 'neutral'} title={[spec.value, spec.note, spec.confirmed ? '확정' : '미확정'].filter(Boolean).join(' · ')}>{spec.confirmed && <Check size={12} />}{label}</DraftAction>
}

function sheetDay(value: string | null) {
  if (!value) return ''
  const date = new Date(value.includes('T') ? value : `${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return ''
  return `${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
}

function statePercent(draft: ProductDraft) {
  const flags = [Boolean(draft.nameKo.trim() || draft.nameEn.trim()), draft.colors.length > 0, draft.sampleDone, draft.orderInProgress, draft.orderDone, draft.photoSampleDone, draft.costConfirmed, draft.retailPrice != null]
  return Math.round(flags.filter(Boolean).length / flags.length * 100)
}

function DraftPhoto({ src, name }: { src: string | null; name: string }) {
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

export function DraftSheetRow({ draft, schedule, brand, onOpen, onSchedule, onAddColor, onRenameProduct, onRenameColor }: {
  draft: ProductDraft; schedule: ResolvedReleaseSchedule | undefined; brand: Brand | undefined
  onOpen: () => void; onSchedule: () => void
  onAddColor: (name: string) => Promise<void>
  onRenameProduct: (name: string) => Promise<void>
  onRenameColor: (colorId: string, name: string) => Promise<void>
}) {
  const orders = [...(draft.sampleWorkOrders ?? [])].sort((a, b) => a.round - b.round)
  const nextRound = Math.max(0, ...orders.map(order => order.round)) + 1
  const name = draft.nameEn.trim() || draft.nameKo.trim() || '이름 미정'
  const named = Boolean(draft.nameEn.trim() || draft.nameKo.trim())
  const progress = statePercent(draft)
  const specsConfirmed = draft.specs.size.confirmed && draft.specs.fabric.confirmed && draft.specs.weight.confirmed

  return <tr className="draft-sheet-row">
    <td>
      <strong className="draft-sheet-brand">{brand?.name ?? '브랜드 미정'}</strong>
      <div className="draft-sheet-owner">Designer <strong>{draft.owner.trim() || '미정'}</strong></div>
      <strong className="draft-sheet-number">No. {draft.draftNo}</strong>
      <div className="draft-sheet-state"><span>State <strong>{progress}%</strong></span><span className="draft-sheet-progress" role="meter" aria-label="기획 진행률" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${progress}%` }} /></span></div>
      <p className="draft-sheet-note">Reco. <span>{draft.note.trim() || '—'}</span></p>
      {(draft.status !== 'open' || draft.held) && <div className="draft-sheet-status">{draft.status !== 'open' ? DRAFT_STATUS_LABEL[draft.status] : ''}{draft.held ? ' · 보류' : ''}</div>}
      <div className="draft-sheet-samples" aria-label="샘플 진행 이력">
        {orders.length ? orders.map(order => <div className="draft-sheet-sample" key={order.id}>
          <span><b>Sample</b><small>{order.round}차</small></span>
          <div><span className="draft-sheet-sent" title="샘플 발송일"><ArrowUpRight size={19} />{sheetDay(order.shippedAt) || (order.shipped ? '발송 완료' : '발송 전')}</span><span className="draft-sheet-passed" title="샘플 합격일"><ArrowDownLeft size={19} />{sheetDay(order.passedAt) || (order.passed ? '합격' : '확인 대기')}</span></div>
        </div>) : <div className="draft-sheet-sample"><b>Sample</b><small>진행 이력 없음</small></div>}
      </div>
      <div className="draft-sheet-actions"><DraftAction label={`${nextRound}차 샘플 진행`}>{nextRound}차 Go!</DraftAction><DraftAction label="샘플 합격" tone={draft.sampleDone ? 'done' : 'neutral'}>합격!!!</DraftAction></div>
    </td>
    <td><div className="draft-sheet-image-cell">
      <DraftAction label="사진요청" tone={draft.photoSampleDone ? 'done' : 'neutral'}>{draft.photoSampleDone ? '촬영완료' : '사진요청'}</DraftAction>
      <DraftPhoto src={draft.imageUrl} name={name === '이름 미정' ? draft.draftNo : name} />
      <SheetInlineField
        label={`${draft.draftNo} 상품 이름`}
        className="draft-sheet-product-name"
        value={draft.nameEn.trim() || draft.nameKo.trim()}
        placeholder="이름 미정"
        showError
        onCommit={onRenameProduct}
      />
      <DraftAction label="이름확정" tone={named ? 'done' : 'neutral'}>{named ? '이름확정' : '이름 미정'}</DraftAction>
    </div></td>
    <td><dl className="draft-sheet-prices"><dt>판매가</dt><dd>{draft.retailPrice == null ? '—' : formatNumber(draft.retailPrice)}</dd><dt>목표 원가</dt><dd>{draft.targetCost == null ? '—' : `${formatNumber(draft.targetCost)} ${draft.costCurrency}`}</dd></dl></td>
    <td>
      <div className="draft-color-pad draft-sheet-color-tools"><ColorDocumentButton colorCount={draft.colors.length} onAddColor={onAddColor} /><DraftAction label="추천"><Heart size={17} /></DraftAction></div>
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
        {(draft.colors.length ? draft.colors : [{ id: 'none' }]).map((color, index) => (
          <ColorLine key={color.id} index={index}>
            <div className="draft-sheet-info">
              <DraftAction label="샘플확정" tone={draft.sampleDone ? 'done' : 'neutral'}>{draft.sampleDone ? '샘플확정' : '샘플중'}</DraftAction>
              <div className="draft-sheet-specs"><SpecAction label="size" spec={draft.specs.size} /><SpecAction label="Fabric" spec={draft.specs.fabric} /><SpecAction label="Weight" spec={draft.specs.weight} /></div>
              <div className="draft-sheet-actions"><DraftAction label="스펙 문서" tone={specsConfirmed ? 'done' : 'neutral'}><FileText size={16} />{specsConfirmed ? '스펙 확정' : '스펙 문서'}</DraftAction></div>
            </div>
          </ColorLine>
        ))}
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
