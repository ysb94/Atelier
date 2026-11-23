import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, FileText, ImagePlus, X } from 'lucide-react'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input, Select, Textarea } from '@/components/ui/input'
import { copyText } from '@/lib/clipboard'
import { resolveDraftVisualPhoto } from '@/lib/drafts/color-photo'
import {
  DRAFT_INFORMATION_LABELS, colorInformationEditKey, documentEditKey, informationEditText, isColorInformationConfirmed,
  isSpecDocumentConfirmed, resolveColorSpec, type ColorInformationField, type ColorSpecField, type ColorSpecValues,
  type InformationDrafts, type InformationEdits, type ResolvedDraftColorSpec, type SaveColorSpec, type UpdateInformationEdits,
} from '@/lib/drafts/color-spec'
import { formatSizeSpec, parseSizeSpec, type SizeParts } from '@/lib/drafts/spec-format'
import type { DraftColorRow, ProductDraft } from '@/lib/types'
import { draftInformationTemporaryStore, type DraftInformationTemporary, type DraftInformationTemporaryStore } from '@/lib/supabase/draft-information-temporary'
import {
  draftVisualSaveError, listDraftVisualContent, saveDraftVisualContent,
  type DraftVendorHtml, type DraftVisualChange, type DraftVisualContent,
} from '@/lib/supabase/draft-visual-content'
import { cn } from '@/lib/utils'
import { DRAFT_INFORMATION_PANEL_TAB_GROUPS, type DraftInformationPanelField } from './draft-information-tabs'
import { DRAFT_HTML_VENDORS, DraftVendorHtmlDialog } from './DraftVendorHtmlDialog'
import { DraftVisualImagePanel } from './DraftVisualImagePanel'

const MEASUREMENT_FIELDS = ['size', 'weight'] as const
const SIZE_FIELDS = [...MEASUREMENT_FIELDS, 'sizeNote'] as const
const FABRIC_FIELDS = ['fabric', 'coating'] as const
type SaveTemporaryInformation = (edits: InformationEdits) => Promise<void>
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

  const lines = (anchor.closest('.draft-sheet-information') ??
    anchor.closest('.draft-sheet-visual-cell .draft-color-lines'))?.getBoundingClientRect()
  const column = lines ? {
    left: Math.min(lines.left, trigger.left), right: Math.max(lines.right, trigger.right),
    top: Math.min(lines.top, trigger.top), bottom: Math.max(lines.bottom, trigger.bottom),
  } : trigger
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

  const line = anchor.closest('.draft-sheet-info, .draft-color-line')?.getBoundingClientRect() ?? trigger
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

function InformationCopyButton({ label, text, className, buttonText }: {
  label: string; text: string; className?: string; buttonText?: string
}) {
  const [result, setResult] = useState<{ text: string; copied: boolean }>()
  useEffect(() => {
    if (!result) return
    const timer = window.setTimeout(() => setResult(undefined), 1800)
    return () => window.clearTimeout(timer)
  }, [result])

  const copied = result?.text === text ? result.copied : undefined
  const message = copied === true ? '복사했습니다.' : copied === false ? '복사하지 못했습니다.' : ''
  return <>
    <Button type="button" variant={buttonText ? 'default' : 'ghost'} size={buttonText ? 'sm' : 'icon'}
      className={cn(!buttonText && 'size-5 rounded-sm bg-foreground text-[10px] font-semibold text-background hover:bg-foreground/85', className)}
      aria-label={`${label} 복사`} title={message || `${label} 복사`} disabled={!text.trim()}
      onClick={async () => setResult({ text, copied: await copyText(text) })}>
      {copied === true ? <Check size={12} aria-hidden="true" /> : copied === false ? <X size={12} aria-hidden="true" /> : buttonText ?? 'C'}
    </Button>
    <span className="sr-only" role="status">{message ? `${label} ${message}` : ''}</span>
  </>
}

function SizeFields({ text, weight, note, locked, onChange }: {
  text: string; weight: string; note: string; locked: boolean
  onChange: (field: typeof SIZE_FIELDS[number], value: string) => void
}) {
  const size = parseSizeSpec(text)
  const summary = DIMENSIONS.flatMap(([key, , symbol]) => size[key] ? [`[${symbol}]${size[key]}`] : []).join(' × ')
  const strapSummary = size.strap ? `스트랩 ${size.strap} mm` : ''
  const dimensions = summary ? `${summary} mm` : strapSummary || text
  const sizeText = [dimensions, summary && strapSummary, note].filter(Boolean).join('\n')
  function change(key: keyof SizeParts, value: string) {
    if (!/^\d*(?:\.\d*)?$/.test(value)) return
    onChange('size', formatSizeSpec({ ...size, [key]: value }))
  }
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[minmax(0,3fr)_minmax(3.75rem,1fr)] items-end gap-2 @[560px]:gap-4">
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
        <div className="relative min-w-0">
          <label className="grid min-w-0 gap-1 text-xs text-muted-foreground">
            <span className="flex min-h-5 items-center">Weight</span>
            <Input aria-label="Weight 값" value={weight} readOnly={locked}
              className="h-8 min-w-0 px-2 text-right tabular-nums text-foreground"
              onChange={event => onChange('weight', event.target.value)} />
          </label>
          <InformationCopyButton label="중량" text={weight} className="absolute right-0 top-0" />
        </div>
      </div>
      <div className="relative space-y-1.5 rounded-lg border border-border bg-card p-2.5">
        <p className="min-h-5 break-words text-sm tabular-nums">
          {dimensions || '사이즈 미입력'}
          {summary && strapSummary && <span className="text-xs text-muted-foreground"> · {strapSummary}</span>}
        </p>
        <Textarea aria-label="사이즈 메모" value={note} readOnly={locked} rows={3}
          className="min-h-16 border-0 px-0 py-1 pr-9 text-sm shadow-none"
          onChange={event => onChange('sizeNote', event.target.value)} />
        <InformationCopyButton label="사이즈와 메모" text={sizeText} className="absolute bottom-2 right-5" />
      </div>
    </div>
  )
}

function ColorInformationForm({ color, photo, field, spec, confirmed, readOnly, showWriteActions, highlighted, canApplyBelow, edits, saved, onEditsChange, onSave, onSaveTemporary }: {
  color: DraftColorRow; photo?: string | null; field: ColorInformationField; spec: ResolvedDraftColorSpec; confirmed: boolean
  readOnly: boolean; showWriteActions: boolean; highlighted: boolean; canApplyBelow: boolean; onSave: SaveColorSpec
  edits?: InformationEdits; onEditsChange: (update: UpdateInformationEdits) => void
  saved?: DraftInformationTemporary; onSaveTemporary?: SaveTemporaryInformation
}) {
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const locked = readOnly || busy
  const colorName = color.name.trim() || '컬러 미정'
  const fieldLabel = DRAFT_INFORMATION_LABELS[field]
  function valueFor(key: ColorSpecField) {
    return informationEditText(spec[key], readOnly ? undefined : edits?.[key])
  }
  function editField(key: ColorSpecField, text: string) {
    onEditsChange(current => ({ ...current, [key]: { source: spec[key], text } }))
  }
  const changes: ColorSpecValues = {}
  const temporaryEdits: InformationEdits = {}
  const filledValues: ColorSpecValues = {}
  let hasValue = false
  let temporaryChanged = false
  for (const key of field === 'size' ? SIZE_FIELDS : FABRIC_FIELDS) {
    const value = valueFor(key).trim()
    if (value) hasValue = true
    if (value !== spec[key].trim()) {
      changes[key] = value
      temporaryEdits[key] = { source: spec[key], text: value }
    }
    if (value !== informationEditText(spec[key], saved?.edits[key]).trim()) temporaryChanged = true
    if (key !== 'sizeNote' && value) filledValues[key] = value
  }
  const hasChanges = Object.keys(changes).length > 0
  const canConfirm = hasChanges || (hasValue && !confirmed)
  const isConfirmed = hasValue && confirmed && !hasChanges
  const showModify = isConfirmed && !editing && !temporaryChanged
  const copyChanges = { ...changes }
  delete copyChanges.sizeNote
  const hasCopyChanges = Object.keys(copyChanges).length > 0
  const valuesToCopy = hasCopyChanges ? copyChanges : filledValues
  const hasCopyValues = Object.keys(valuesToCopy).length > 0
  const copyTitle = hasCopyChanges ? '수정한 항목을 아래 컬러에 적용합니다.' : '입력된 값을 아래 컬러에 적용합니다.'

  async function saveTemporary() {
    if (locked || !onSaveTemporary || !temporaryChanged) return
    setBusy(true)
    setError('')
    try {
      await onSaveTemporary(temporaryEdits)
      onEditsChange(current => current === edits ? undefined : current)
    } catch {
      setError('임시 저장을 완료하지 못했습니다. 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  async function save(applyAll: boolean) {
    if (locked) return
    if (applyAll ? !canApplyBelow || !hasCopyValues : !canConfirm) return
    setBusy(true)
    setError('')
    try {
      await onSave(color.id, applyAll ? valuesToCopy : changes, applyAll, field, applyAll ? undefined : saved?.revision)
      const remaining = applyAll && edits?.sizeNote ? { sizeNote: edits.sizeNote } : undefined
      onEditsChange(current => current === edits ? remaining : current)
      if (!applyAll) setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : '변경을 저장하지 못했습니다.')
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
        <div className="relative min-w-0">
          <label className="grid min-w-0 gap-1 text-xs text-muted-foreground">
            컬러명
            <Input value={colorName} readOnly className="h-8 min-w-0 pr-8 text-foreground" />
          </label>
          <InformationCopyButton label="컬러명" text={color.name.trim()} className="absolute bottom-1.5 right-1.5" />
        </div>
      </div>
      {field === 'size' ? (
        <SizeFields text={valueFor('size')} weight={valueFor('weight')} note={valueFor('sizeNote')}
          locked={locked || showModify} onChange={editField} />
      ) : (
        <div className="grid min-w-0 gap-3">
          <div className="relative">
            <label className="grid min-w-0 gap-1 text-xs text-muted-foreground">
              {fieldLabel}
              <Textarea aria-label={`${fieldLabel} 값`} value={valueFor('fabric')} readOnly={locked || showModify}
                rows={3} className="min-h-20 pr-12 text-foreground"
                onChange={event => editField('fabric', event.target.value)} />
            </label>
            <InformationCopyButton label="Fabric" text={valueFor('fabric')} className="absolute bottom-2 right-5" />
          </div>
          <div className="relative">
            <label className="grid min-w-0 gap-1 text-xs text-muted-foreground">
              Water-resistant coated · 생활 발수 코팅
              <Input value={valueFor('coating')} readOnly={locked || showModify}
                className="h-8 min-w-0 pr-8 text-foreground" onChange={event => editField('coating', event.target.value)} />
            </label>
            <InformationCopyButton label="생활 발수 코팅" text={valueFor('coating')} className="absolute bottom-1.5 right-1.5" />
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 @[720px]:flex-col @[720px]:items-end">
        {showWriteActions && canApplyBelow && (
          <Button size="sm" type="button" variant="outline" disabled={locked || !hasCopyValues}
            onClick={event => {
              if (event.currentTarget.form?.reportValidity()) void save(true)
            }}
            title={field === 'size' ? `${copyTitle} 메모는 컬러별로 저장합니다.` : copyTitle}>
            다른 컬러에 적용
          </Button>
        )}
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {isConfirmed ? '확정 완료' : hasChanges && !temporaryChanged ? '임시 저장됨' : hasValue || hasChanges ? '기입 중' : '미입력'}
          <span aria-hidden="true" className={cn('size-3 rounded-sm border border-border', isConfirmed && 'border-primary bg-primary')} />
        </span>
        {showWriteActions && (showModify
          ? <Button size="sm" type="button" variant="outline" disabled={locked} onClick={() => setEditing(true)}>수정</Button>
          : <div className="flex flex-wrap justify-end gap-2">
            <Button size="sm" type="button" variant="outline" disabled={locked || !onSaveTemporary || !temporaryChanged} onClick={() => void saveTemporary()}>임시 저장</Button>
            <Button size="sm" type="submit" disabled={locked || !canConfirm}>{busy ? '저장 중…' : '확정'}</Button>
          </div>)}
      </div>
      {error && <p className="text-xs text-danger @[720px]:col-span-3" role="alert">{error}</p>}
    </form>
  )
}

function SpecDocumentForm({ draft, readOnly, showWriteActions, edits, saved, onEditChange, onSave, onSaveTemporary }: {
  draft: ProductDraft; readOnly: boolean; showWriteActions: boolean; edits: InformationEdits | undefined
  onEditChange: (update: UpdateInformationEdits) => void; onSave: (value: string, temporaryRevision?: string) => Promise<void>
  saved?: DraftInformationTemporary; onSaveTemporary?: SaveTemporaryInformation
}) {
  const value = draft.specs.coating.note
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const text = informationEditText(value, readOnly ? undefined : edits?.specDoc)
  const hasChanges = text.trim() !== value.trim()
  const temporaryChanged = text.trim() !== informationEditText(value, saved?.edits.specDoc).trim()
  const confirmed = isSpecDocumentConfirmed(draft.specs)
  const canConfirm = hasChanges || (Boolean(text.trim()) && !confirmed)
  const showModify = Boolean(text.trim()) && confirmed && !canConfirm && !editing && !temporaryChanged
  const locked = readOnly || busy
  const legacy = draft.colors.flatMap(color => {
    const note = draft.specs.colorSpecs[color.id]?.specDoc.trim()
    return note && note !== value.trim() ? [{ id: color.id, name: color.name, note }] : []
  })

  async function saveTemporary() {
    if (locked || !onSaveTemporary || !temporaryChanged) return
    setBusy(true)
    setError('')
    try {
      await onSaveTemporary(hasChanges ? { specDoc: { source: value, text: text.trim() } } : {})
      onEditChange(current => current === edits ? undefined : current)
    } catch {
      setError('임시 저장을 완료하지 못했습니다. 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form aria-label="공통 스펙 문서" className="space-y-3 border-t border-border p-4"
      onSubmit={async event => {
        event.preventDefault()
        if (locked || !canConfirm) return
        setBusy(true)
        setError('')
        try {
          await onSave(text.trim(), saved?.revision)
          onEditChange(current => current === edits ? undefined : current)
          setEditing(false)
        } catch (err) {
          setError(err instanceof Error ? err.message : '스펙 문서를 저장하지 못했습니다.')
        } finally {
          setBusy(false)
        }
      }}>
      <div className="relative">
        <Textarea aria-label="스펙 문서 값" value={text} className="pr-12"
          rows={7} readOnly={locked || showModify} onChange={event => {
            const next = event.target.value
            onEditChange(() => ({ specDoc: { source: value, text: next } }))
          }} />
        <InformationCopyButton label="스펙 문서" text={text} className="absolute bottom-2 right-5" />
      </div>
      {legacy.length > 0 && (
        <details className="rounded-lg border border-border px-3 py-2 text-sm">
          <summary className="cursor-pointer text-muted-foreground">이전 컬러별 스펙 문서</summary>
          <dl className="mt-2 space-y-2">
            {legacy.map(({ id, name, note }) => (
              <div key={id}>
                <dt className="text-xs font-medium">{name || '컬러 미정'}</dt>
                <dd className="whitespace-pre-wrap break-words">{note}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      <div className="flex items-center justify-end gap-2">
        <span className="text-xs text-muted-foreground">
          {hasChanges && !temporaryChanged ? '임시 저장됨' : canConfirm ? '기입 중' : text.trim() ? '확정 완료' : '미입력'}
        </span>
        {showWriteActions && (showModify
          ? <Button size="sm" type="button" variant="outline" disabled={locked} onClick={() => setEditing(true)}>수정</Button>
          : <>
            <Button size="sm" type="button" variant="outline" disabled={locked || !onSaveTemporary || !temporaryChanged} onClick={() => void saveTemporary()}>임시 저장</Button>
            <Button size="sm" type="submit" disabled={locked || !canConfirm}>{busy ? '저장 중…' : '확정'}</Button>
          </>)}
      </div>
      {error && <p className="text-xs text-danger" role="alert">{error}</p>}
    </form>
  )
}

function vendorTemplates(rows: readonly DraftVisualContent[]) {
  const templates: DraftVendorHtml = {}
  for (const row of rows) {
    if (row.kind === 'vendor-html') templates[row.entry_key] = row.payload
  }
  return templates
}

function VendorHtmlCode({ id, name, text, templates }: { id: string; name: string; text: string; templates: DraftVendorHtml }) {
  const [vendor, setVendor] = useState('')
  const vendors = DRAFT_HTML_VENDORS.filter(option => {
    const template = templates[option]
    return template?.top.trim() || template?.bottom.trim()
  })
  const template = vendors.some(option => option === vendor) ? templates[vendor] : undefined
  const code = template && text.trim() ? [template.top, text, template.bottom].filter(part => part.trim()).join('\n') : ''

  return <div id={id} className="col-span-full grid gap-2 rounded-md border border-border bg-muted/35 p-3">
    {vendors.length ? <>
      <label className="grid w-full gap-1 text-xs font-medium sm:max-w-52">
        업체 선택
        <Select value={template ? vendor : ''} onChange={event => setVendor(event.target.value)}>
          <option value="">업체를 선택해 주세요</option>
          {vendors.map(option => <option key={option} value={option}>{option}</option>)}
        </Select>
      </label>
      {template && <>
        <Textarea aria-label={`${name} 업체별 생성 HTML`} value={code} readOnly rows={5}
          className="font-mono text-xs" placeholder="컬러 HTML을 입력해 주세요." />
        <InformationCopyButton label={`${name} 업체별 HTML`} text={code} buttonText="복사" className="justify-self-end" />
      </>}
    </> : <p className="text-xs text-muted-foreground">상단 업체별 Top Buttom 등록에서 업체 HTML을 먼저 저장해 주세요.</p>}
  </div>
}

function VisualHtmlRow({ color, index, visualPhoto, colorPhoto, readOnly, canSaveTemporary, entry, workingCopy, vendorHtml, onSave }: {
  color: DraftColorRow; index: number; visualPhoto?: string; colorPhoto?: string; readOnly: boolean
  canSaveTemporary: boolean
  entry?: DraftVisualContent; workingCopy?: DraftInformationTemporary; vendorHtml: DraftVendorHtml
  onSave: (text: string, revision: string | null, temporary: boolean, temporaryRevision?: string) => Promise<void>
}) {
  const name = color.name.trim() || `컬러 ${index + 1}`
  const { src: photo, temporary: showingTemporaryPhoto } = resolveDraftVisualPhoto(visualPhoto, colorPhoto)
  const [edit, setEdit] = useState<{ text: string; revision: string | null }>()
  const [preview, setPreview] = useState('')
  const [codeOpen, setCodeOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const codeId = useId()
  const stored = typeof entry?.payload === 'string' ? entry.payload : ''
  const working = readOnly ? undefined : workingCopy?.edits.html
  const text = edit?.text ?? working?.text ?? stored
  const revision = edit ? edit.revision : working ? working.source || null : entry?.revision ?? null
  const versionChanged = revision !== (entry?.revision ?? null)
  const hasContent = Boolean(text.trim())
  const saved = Boolean(entry) && !working && stored === text
  const temporary = working?.text === text
  const previewDocument = preview
    ? `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">${preview}`
    : undefined

  async function save(asTemporary: boolean) {
    if (readOnly || saving) return
    setSaving(true)
    setError('')
    try {
      await onSave(text, revision, asTemporary, workingCopy?.revision)
      setEdit(undefined)
      if (!hasContent) setPreview('')
    } catch (error) {
      setError(draftVisualSaveError(error))
    } finally {
      setSaving(false)
    }
  }

  return <section aria-label={`${name} HTML`}
    className="grid min-w-0 grid-cols-[3.5rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2 border-b border-primary/45 p-3 @[560px]:grid-cols-[minmax(5rem,0.9fr)_minmax(0,2.8fr)_minmax(7.75rem,1fr)] @[560px]:gap-x-4">
    <div className="self-center text-center">
      <div className={cn('relative grid aspect-square w-full place-items-center overflow-hidden rounded-xl border border-border bg-muted/35 font-semibold',
        showingTemporaryPhoto && 'draft-visual-image-temporary')}>
        {photo
          ? <img src={photo} alt={`${name} 컬러 이미지`} loading="lazy" className="size-full object-contain"
            aria-description={showingTemporaryPhoto ? '컬러에 등록된 임시 이미지' : undefined} />
          : <span aria-hidden="true" className="text-2xl @[560px]:text-5xl">{name[0]}</span>}
      </div>
      <p className="mt-1 break-words text-xs font-medium @[560px]:text-sm">{name}</p>
    </div>
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">HTML</p>
      <div className="relative mt-0.5">
        <Textarea aria-label={`${name} HTML 입력`} value={text} readOnly={readOnly || saving} placeholder="직접 입력…"
          spellCheck={false} className="h-[9.5rem] min-h-[9.5rem] resize-none bg-muted/35 pb-8 text-xs text-foreground shadow-none"
          onChange={event => setEdit({ text: event.target.value, revision })} />
        {temporary && <span aria-hidden="true" className="draft-html-temporary-marker pointer-events-none absolute left-px top-px size-4 rounded-tl-md bg-primary [clip-path:polygon(0_0,100%_0,0_100%)]" />}
        <InformationCopyButton label={`${name} HTML`} text={text} className="absolute bottom-2 right-2" />
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-end gap-1.5">
        <span className="mr-auto text-[10px] text-muted-foreground" role="status">
          {saved ? '저장됨' : temporary ? '임시저장됨' : ''}
        </span>
        <Button type="button" size="sm" variant="outline" className="h-6 px-2"
          disabled={!hasContent} onClick={() => setPreview(text)}>미리보기</Button>
        {!readOnly && <>
          <Button type="button" size="sm" variant="secondary" className="h-6 px-2"
            disabled={!canSaveTemporary || !hasContent || saved || temporary || saving || versionChanged} onClick={() => void save(true)}>임시저장</Button>
          <Button type="button" size="sm" className="h-6 px-3"
            disabled={(!hasContent && !working && !stored) || saved || saving || versionChanged}
            onClick={() => void save(false)}>{saving ? '저장 중…' : '저장'}</Button>
        </>}
      </div>
    </div>
    <div className="col-start-2 grid min-w-0 gap-1 @[560px]:col-start-3">
      <div className="h-24 overflow-hidden rounded-md border border-border bg-card @[560px]:h-[10.65rem]">
        {previewDocument && <iframe title={`${name} HTML 미리보기`} sandbox="" srcDoc={previewDocument}
          tabIndex={-1} className="pointer-events-none size-full" />}
      </div>
      {!readOnly && <Button type="button" size="sm" variant="outline" className="h-6 justify-self-end px-2"
        aria-expanded={codeOpen} aria-controls={codeOpen ? codeId : undefined}
        onClick={() => setCodeOpen(open => !open)}>업체별 코드 자동생성</Button>}
    </div>
    {!readOnly && codeOpen && <VendorHtmlCode id={codeId} name={name} text={text} templates={vendorHtml} />}
    {!readOnly && versionChanged ? <div className="col-span-full flex flex-wrap items-center gap-2">
      <p role="alert" className="text-xs text-danger">다른 화면에서 먼저 저장했습니다. 작성 중인 HTML은 복사할 수 있습니다.</p>
      <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => {
        setEdit({ text: stored, revision: entry?.revision ?? null })
        setPreview('')
        setError('')
      }}>최신 저장본 불러오기</Button>
    </div> : error && <p role="alert" className="col-span-full text-xs text-danger">{error}</p>}
  </section>
}

export function DraftInformationPanel({
  id, anchor, draft, field, colorId, readOnly, fromVisual, edits, onEditsChange, onFieldChange, onClose, onSave, onSaveSpecDocument,
  editorId, temporaryStore = draftInformationTemporaryStore,
}: {
  id: string; anchor: HTMLButtonElement; draft: ProductDraft; field: DraftInformationPanelField; colorId: string | null
  readOnly: boolean; fromVisual: boolean
  onFieldChange: (field: DraftInformationPanelField) => void; onClose: () => void; onSave: SaveColorSpec
  onSaveSpecDocument: (value: string, temporaryRevision?: string) => Promise<void>
  edits: InformationDrafts; onEditsChange: (key: string, update: UpdateInformationEdits) => void
  editorId?: string; temporaryStore?: DraftInformationTemporaryStore
}) {
  const active = useWorkspaceTabActivity()
  const [vendorHtmlSnapshot, setVendorHtmlSnapshot] = useState<readonly DraftVisualContent[]>()
  const cache = useQueryClient()
  const queryKey = ['draft-information-temporary', editorId, draft.id] as const
  const locked = readOnly || fromVisual
  const visualTab = field === 'image' || field === 'html'
  const temporaryEnabled = Boolean(editorId && (field === 'html' ? !readOnly : !locked && !visualTab))
  const visualKey = ['draft-visual-content', editorId, draft.id] as const
  const visual = useQuery({
    queryKey: visualKey,
    queryFn: ({ signal }) => listDraftVisualContent(draft.id, signal),
    enabled: active && visualTab,
    retry: false,
  })
  const visualRows = visual.data ?? []
  const templates = vendorTemplates(visualRows)
  const visualLocked = readOnly || !visual.data
  const temporary = useQuery({
    queryKey,
    queryFn: ({ signal }) => temporaryStore.list(draft.id, editorId!, signal),
    enabled: active && temporaryEnabled,
    retry: false,
  })
  const loadingTemporary = temporaryEnabled && temporary.isPending
  const canSaveTemporary = temporaryEnabled && temporary.isSuccess
  const temporaryErrorCode = (temporary.error as { code?: string } | null)?.code
  const missingTemporary = temporaryErrorCode === 'PGRST205' || temporaryErrorCode === '42P01'
  const savedDocument = temporaryEnabled ? temporary.data?.find(row => row.field === 'specDoc') : undefined

  async function saveTemporary(field: DraftInformationTemporary['field'], colorId: string | null, edits: DraftInformationTemporary['edits']) {
    if (!editorId || (field === 'html' ? readOnly : locked)) return
    const copy = { field, color_id: colorId, edits, revision: crypto.randomUUID() }
    await temporaryStore.save(draft.id, editorId, copy)
    await cache.cancelQueries({ queryKey, exact: true })
    cache.setQueryData<DraftInformationTemporary[]>(queryKey, current =>
      [...(current ?? []).filter(row => row.field !== field || row.color_id !== colorId), copy])
  }

  async function saveVisual(changes: DraftVisualChange[], temporaryRevision?: string) {
    const saved = await saveDraftVisualContent(draft.id, changes, temporaryRevision).catch(error => {
      if ((error as { code?: string } | null)?.code === '40001') {
        void cache.invalidateQueries({ queryKey: visualKey, exact: true })
      }
      throw error
    })
    await cache.cancelQueries({ queryKey: visualKey, exact: true })
    cache.setQueryData<DraftVisualContent[]>(visualKey, current => [
      ...(current ?? []).filter(row => !saved.some(next => row.kind === next.kind && row.entry_key === next.entry_key)),
      ...saved,
    ])
    removeConfirmedTemporary(temporaryRevision)
  }

  async function saveVendorHtml(rows: readonly DraftVisualContent[], templates: DraftVendorHtml) {
    const changes: DraftVisualChange[] = []
    for (const [entry_key, payload] of Object.entries(templates)) {
      if (!payload) continue
      const current = rows.find(row => row.kind === 'vendor-html' && row.entry_key === entry_key)
      if (current?.kind === 'vendor-html' && current.payload.top === payload.top && current.payload.bottom === payload.bottom) continue
      changes.push({ kind: 'vendor-html', entry_key, payload, revision: current?.revision ?? null })
    }
    if (changes.length) await saveVisual(changes)
  }

  function removeConfirmedTemporary(revision: string | undefined) {
    if (!revision) return
    cache.setQueryData<DraftInformationTemporary[]>(queryKey, current => current?.filter(row => row.revision !== revision))
    void cache.invalidateQueries({ queryKey, exact: true })
  }

  const saveColor: SaveColorSpec = async (id, changes, applyAll, field, revision) => {
    await onSave(id, changes, applyAll, field, revision)
    removeConfirmedTemporary(revision)
  }

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
  if (!active) return null

  const content = (
    <Card className="@container overflow-hidden">
      <div className={cn('flex items-start gap-4 px-4 py-4', field === 'html' && 'relative flex-wrap pr-12 @[560px]:flex-nowrap')}>
        <InformationPhoto src={draft.imageUrl} name={draft.nameKo || draft.nameEn || draft.draftNo}
          className="w-20 shrink-0 @[560px]:w-36" />
        <div className="grid min-w-0 max-w-sm flex-1 gap-2">
          <div className="text-xs leading-5">
            <p>Designer <strong>{draft.owner.trim() || '미정'}</strong></p>
            <p className="font-semibold">No. {draft.draftNo}</p>
          </div>
          <label className="grid gap-1 text-xs text-muted-foreground">한글명
            <Input value={draft.nameKo} readOnly className="h-8 text-foreground" />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">영문명
            <Input value={draft.nameEn} readOnly className="h-8 text-foreground" />
          </label>
        </div>
        {field === 'html' && (
          <div className="flex w-full justify-end border-t border-border pt-3 @[560px]:w-auto @[560px]:basis-[28%] @[560px]:self-stretch @[560px]:items-center @[560px]:justify-center @[560px]:border-l @[560px]:border-t-0 @[560px]:pl-4 @[560px]:pt-0">
            <Button type="button" variant="secondary" disabled={visualLocked} aria-haspopup="dialog"
              className="h-auto min-h-11 flex-col gap-0 bg-muted-foreground px-4 py-2 text-center text-xs text-background hover:bg-muted-foreground/85"
              onClick={() => setVendorHtmlSnapshot(visualRows)}>
              <span>업체별</span>
              <span>Top Buttom 등록</span>
            </Button>
          </div>
        )}
        <Button type="button" size="icon" variant="ghost"
          className={cn('ml-auto shrink-0', field === 'html' && 'absolute right-3 top-3')}
          aria-label="INFORMATION 닫기" onClick={closeAndFocus}>
          <X size={16} aria-hidden="true" />
        </Button>
      </div>
      {field === 'html' && vendorHtmlSnapshot && !readOnly &&
        <DraftVendorHtmlDialog preferredVendor={draft.openTypeDetail} value={vendorTemplates(vendorHtmlSnapshot)}
          onSave={templates => saveVendorHtml(vendorHtmlSnapshot, templates)}
          onClose={() => setVendorHtmlSnapshot(undefined)} />}
      {visualTab && visual.isPending && <p role="status" className="px-4 pb-2 text-xs text-muted-foreground">비주얼 정보를 불러오는 중…</p>}
      {visualTab && visual.isError && <div className="flex items-center gap-2 px-4 pb-2 text-xs text-muted-foreground">
        <p role="status">{['PGRST205', '42P01'].includes((visual.error as { code?: string }).code ?? '')
          ? '비주얼 저장 서버 연결 대기' : '비주얼 정보를 불러오지 못했습니다.'}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void visual.refetch()}>비주얼 다시 조회</Button>
      </div>}
      {loadingTemporary && <p role="status" className="px-4 pb-2 text-xs text-muted-foreground">임시 저장 내용을 불러오는 중…</p>}
      {temporaryEnabled && temporary.isError && <div className="flex items-center gap-2 px-4 pb-2 text-xs text-muted-foreground">
        <p role="status">{missingTemporary ? '임시 저장 서버 연결 대기' : '임시 저장 내용을 불러오지 못했습니다.'}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void temporary.refetch()}>다시 조회</Button>
      </div>}
      <div className="mx-4 mb-4 overflow-hidden rounded-xl border border-border">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
          {field === 'specDoc' ? <span className="text-sm font-semibold">공통 스펙 문서</span>
            : <span className="text-sm font-semibold">컬러 <span className="ml-1.5 font-normal text-muted-foreground">
              {field === 'image' || field === 'html' ? `${colors.length}color` : `${colors.length}개`}
            </span></span>}
          <div role="group" aria-label="INFORMATION 입력 항목" className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {DRAFT_INFORMATION_PANEL_TAB_GROUPS.map((tabs, index) => (
              <div key={tabs[0].field} className={cn('flex flex-wrap gap-2', index > 0 && 'border-l border-border pl-3')}>
                {tabs.map(({ field: option, label }) => (
                  <Button key={option} type="button" size="sm" variant={field === option ? 'default' : 'outline'}
                    aria-pressed={field === option} onClick={() => onFieldChange(option)}>
                    {option === 'specDoc' && <FileText size={14} aria-hidden="true" />}
                    {label}
                  </Button>
                ))}
              </div>
            ))}
          </div>
        </div>
        {field === 'image' ? <DraftVisualImagePanel key={`${editorId ?? ''}:${readOnly}`} colors={colors}
          colorPhotos={draft.specs.colorPhotoUrls} visualPhotos={visualRows} readOnly={visualLocked}
          onSave={(entry_key, payload, revision) => saveVisual([{ kind: 'color-photo', entry_key, payload, revision }])} /> : field === 'html' ? (
          <div className="border-t border-border">
            {colors.length ? colors.map((color, index) => {
              const photo = visualRows.find(row => row.kind === 'color-photo' && row.entry_key === color.id)
              const entry = visualRows.find(row => row.kind === 'color-html' && row.entry_key === color.id)
              const working = temporaryEnabled ? temporary.data?.find(row => row.field === 'html' && row.color_id === color.id) : undefined
              return <VisualHtmlRow key={`${color.id}:${readOnly}`} color={color} index={index}
                visualPhoto={typeof photo?.payload === 'string' ? photo.payload : undefined}
                colorPhoto={draft.specs.colorPhotoUrls?.[color.id]} readOnly={visualLocked || loadingTemporary}
                canSaveTemporary={canSaveTemporary} entry={entry} workingCopy={working} vendorHtml={templates}
                onSave={(payload, revision, asTemporary, temporaryRevision) => asTemporary
                  ? saveTemporary('html', color.id, { html: { source: revision ?? '', text: payload } })
                  : saveVisual([{ kind: 'color-html', entry_key: color.id, payload, revision }], temporaryRevision)} />
            }) : <p className="px-4 py-3 text-sm text-muted-foreground">등록된 컬러가 없습니다.</p>}
          </div>
        ) : field === 'specDoc' ? (
          <SpecDocumentForm key={String(locked)} draft={draft} readOnly={locked || loadingTemporary} showWriteActions={!fromVisual} saved={savedDocument}
            onSave={async (value, revision) => {
              await onSaveSpecDocument(value, revision)
              removeConfirmedTemporary(revision)
            }}
            onSaveTemporary={canSaveTemporary ? next => saveTemporary('specDoc', null, next) : undefined}
            edits={edits[documentEditKey] ?? savedDocument?.edits}
            onEditChange={next => onEditsChange(documentEditKey, current => next(current ?? savedDocument?.edits))} />
        )
          : colors.length ? colors.map((color, index) => {
          const spec = resolveColorSpec(draft.specs, color.id)
          const editKey = colorInformationEditKey(color.id, field)
          const saved = temporaryEnabled ? temporary.data?.find(row => row.field === field && row.color_id === color.id) : undefined
          return <ColorInformationForm key={`${color.id}:${field}:${locked}`} color={color} field={field}
            photo={draft.specs.colorPhotoUrls?.[color.id]} spec={spec} confirmed={isColorInformationConfirmed(draft.specs, spec, field)}
            edits={edits[editKey] ?? saved?.edits} saved={saved}
            onEditsChange={next => onEditsChange(editKey, current => next(current ?? saved?.edits))}
            onSaveTemporary={canSaveTemporary ? next => saveTemporary(field, color.id, next) : undefined}
            highlighted={color.id === colorId} readOnly={locked || loadingTemporary} showWriteActions={!fromVisual}
            canApplyBelow={index === 0 && colors.length > 1} onSave={saveColor} />
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
