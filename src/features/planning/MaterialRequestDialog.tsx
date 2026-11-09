import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Bold, ImagePlus, Underline, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { FilterTabs } from '@/components/ui/filter-tabs'
import { RequestBodyEditor, RequestBodyPreview } from '@/features/work-requests/WorkRequestPage'
import type { ContentBlock } from '@/features/work-requests/work-request-types'

const textColors = [
  { value: 'black', label: '검정' },
  { value: 'crimson', label: '빨강' },
  { value: 'royalblue', label: '파랑' },
  { value: 'seagreen', label: '초록' },
]

export type MaterialRequest = {
  id: string
  revision?: number
  searchText?: string | null
  ownerId: string
  ownerName?: string
  status: '요청예정' | '요청중' | '완료'
  draftStage?: 'not-started' | 'writing' | 'ready'
  rounds: {
    number: number
    title: string
    brandId: string
    requestedAt: number
    assigneeId?: string
    assigneeName?: string
    assigneeRead?: boolean
    content?: { title: string; brandId: string; blocks: ContentBlock[] }
    shippedAt?: number
    received?: boolean
    satisfaction?: number
    reviewedAt?: number
  }[]
  brandId: string
  title: string
  blocks: ContentBlock[]
}

export function MaterialRequestDialog({ initial, brands, onClose, onSave, roundNumber, saving, saveError }: {
  initial: MaterialRequest
  brands: readonly { id: string; name: string }[]
  onClose: () => void
  onSave: (request: MaterialRequest, draftStage?: 'writing' | 'ready') => void
  roundNumber?: number
  saving: boolean
  saveError: string
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const selection = useRef<Range | null>(null)
  const appendFiles = useRef<(files: File[]) => void>(() => undefined)
  const [form, setForm] = useState(initial)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState(initial.status !== '요청예정' && initial.rounds.length ? String(initial.rounds.length - 1) : 'current')
  const history = activeTab === 'current' ? undefined : initial.rounds[Number(activeTab)]
  const readOnly = initial.status !== '요청예정'

  useEffect(() => {
    dialog.current?.showModal()
  }, [])

  function rememberSelection() {
    const current = window.getSelection()
    if (!current?.rangeCount) return
    const range = current.getRangeAt(0)
    if (body.current?.contains(range.commonAncestorContainer)) {
      selection.current = range.cloneRange()
    }
  }

  function format(command: string, value?: string) {
    const range = selection.current
    const node = range?.commonAncestorContainer
    const element = node instanceof Element ? node : node?.parentElement
    const editable = element?.closest<HTMLElement>('[contenteditable="true"]')
    if (!range || !editable || !body.current?.contains(editable)) return
    editable.focus()
    const current = window.getSelection()
    current?.removeAllRanges()
    current?.addRange(range)
    document.execCommand(command, false, value)
    rememberSelection()
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (history || readOnly || saving) return
    const title = form.title.trim()
    if (!title) return
    if (!form.blocks.some(block => block.type !== 'text' || block.text.trim())) {
      setError('요청 내용을 입력하거나 파일을 첨부해 주세요.')
      return
    }
    onSave({ ...form, title }, form.status === '요청예정' ? 'ready' : undefined)
  }

  return (
    <dialog ref={dialog} aria-labelledby="material-request-title" onCancel={event => { if (saving) event.preventDefault(); else onClose() }}
      className="fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-none w-full max-w-3xl overflow-hidden border-l border-border bg-card p-0 text-card-foreground shadow-lg backdrop:bg-foreground/30">
      <form onSubmit={submit} className="flex h-full flex-col">
        <header className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3">
          <h2 id="material-request-title" className="text-base font-semibold">{roundNumber ? `${roundNumber}차 요청 작성` : '자재 요청 작성'}</h2>
          <Button type="button" size="icon" variant="ghost" aria-label="자재 요청 닫기" disabled={saving} onClick={onClose}><X size={18} /></Button>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {initial.rounds.length > 0 && <FilterTabs
            tabs={[
              ...initial.rounds.map((round, index) => ({
                value: String(index),
                label: `${index + 1}차 작성`,
                subtitle: round.satisfaction === undefined ? undefined : `만족도 ${round.satisfaction}/10`,
              })),
              ...(!readOnly ? [{ value: 'current', label: roundNumber ? `${roundNumber}차 작성` : '현재 요청' }] : []),
            ]}
            value={activeTab} onChange={setActiveTab} ariaLabel="자재요청 작성 이력" variant="underline" />}
          {history && (
            <section className="space-y-3 rounded-lg border border-border p-4" aria-label="전송한 요청 내용">
              {history.content ? <>
                <p className="text-xs text-muted-foreground">{brands.find(brand => brand.id === history.content?.brandId)?.name ?? '브랜드 미정'}</p>
                <h3 className="break-words text-base font-semibold">{history.content.title}</h3>
                <RequestBodyPreview blocks={history.content.blocks} richPreview />
              </> : <p className="text-sm text-muted-foreground">이 차수의 작성 내용이 기록되어 있지 않습니다.</p>}
            </section>
          )}
          {saveError && <p role="alert" className="text-sm text-danger">{saveError}</p>}
          {!readOnly && <fieldset disabled={saving} hidden={Boolean(history)} className="min-w-0 space-y-4">
          <div className="flex flex-wrap gap-2">
            <Select aria-label="브랜드 선택" className="w-auto" value={form.brandId} onChange={event => setForm({ ...form, brandId: event.target.value })}>
              <option value="">브랜드 선택</option>
              {brands.map(brand => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
            </Select>
          </div>
          <Input aria-label="요청 제목" required maxLength={150} placeholder="요청 제목을 입력하세요" value={form.title}
            onChange={event => setForm({ ...form, title: event.target.value })} className="rounded-none border-x-0 border-t-0 px-0 font-semibold" />
          <div ref={body} onBlurCapture={rememberSelection} onMouseUp={rememberSelection} onKeyUp={rememberSelection}>
          <RequestBodyEditor richPreview blocks={form.blocks} error={error} appendFilesRef={appendFiles}
            placeholder="요청 내용을 입력하거나 파일을 끌어다 놓으세요."
            onChange={blocks => {
              setForm(current => ({ ...current, blocks }))
              setError('')
            }} />
          </div>
          </fieldset>}
        </div>
        {!history && !readOnly && <fieldset disabled={saving} className="flex shrink-0 flex-wrap items-center gap-1 border-t border-border bg-muted px-3 py-3 sm:px-5">
          <Select aria-label="글자 크기" className="w-auto" value="" onChange={event => format('fontSize', event.target.value)}>
            <option value="" disabled>글자 크기</option>
            <option value="2">작게</option><option value="3">보통</option><option value="5">크게</option><option value="6">아주 크게</option>
          </Select>
          <Button type="button" size="icon" variant="ghost" title="굵게" aria-label="굵게"
            onMouseDown={event => event.preventDefault()} onClick={() => format('bold')}><Bold size={16} /></Button>
          <Button type="button" size="icon" variant="ghost" title="밑줄" aria-label="밑줄"
            onMouseDown={event => event.preventDefault()} onClick={() => format('underline')}><Underline size={16} /></Button>
          <div role="group" aria-label="글자 색상" className="flex items-center border-l border-border pl-1">
            {textColors.map(({ value, label }) => (
              <Button key={value} type="button" size="icon" variant="ghost" title={label} aria-label={`글자 색상 ${label}`}
                onMouseDown={event => event.preventDefault()} onClick={() => format('foreColor', value)}>
                <span aria-hidden="true" className="size-4 rounded-full border border-border" style={{ backgroundColor: value }} />
              </Button>
            ))}
          </div>
          <input ref={picker} type="file" hidden multiple accept="image/*" onChange={event => {
            appendFiles.current(Array.from(event.target.files ?? []))
            event.target.value = ''
          }} />
          <Button type="button" size="icon" variant="ghost" aria-label="이미지 첨부" title="이미지 첨부" onClick={() => picker.current?.click()}><ImagePlus size={18} /></Button>
          {form.status === '요청예정' && (
            <Button type="button" variant="outline" className="ml-auto" disabled={!form.title.trim()}
              onClick={() => onSave({ ...form, title: form.title.trim() }, 'writing')}>임시 저장</Button>
          )}
          <Button type="submit" className={form.status === '요청예정' ? undefined : 'ml-auto'} disabled={!form.title.trim()}>
            {saving ? '저장 중…' : '작성 완료'}
          </Button>
        </fieldset>}
      </form>
    </dialog>
  )
}
