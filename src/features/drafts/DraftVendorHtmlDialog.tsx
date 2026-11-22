import { useEffect, useId, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, Textarea } from '@/components/ui/input'
import { draftVisualSaveError, type DraftVendorHtml, type VendorHtml } from '@/lib/supabase/draft-visual-content'
import { DRAFT_OPEN_DETAIL_OPTIONS } from '@/lib/types'

export const DRAFT_HTML_VENDORS = DRAFT_OPEN_DETAIL_OPTIONS.filter(vendor => vendor !== '전체')
const EMPTY_HTML: VendorHtml = { top: '', bottom: '' }

export function DraftVendorHtmlDialog({ preferredVendor, value, onSave, onClose }: {
  preferredVendor: string
  value: DraftVendorHtml
  onSave: (value: DraftVendorHtml) => Promise<void>
  onClose: () => void
}) {
  const titleId = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const [vendor, setVendor] = useState(() => DRAFT_HTML_VENDORS.find(option => option === preferredVendor) ?? DRAFT_HTML_VENDORS[0])
  const [edits, setEdits] = useState(value)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const html = edits[vendor] ?? EMPTY_HTML

  useEffect(() => { dialog.current?.showModal() }, [])

  return (
    <dialog ref={dialog} aria-labelledby={titleId} onClose={onClose}
      onCancel={event => { if (saving) event.preventDefault() }}
      onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation() }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto rounded-xl border border-border bg-card text-foreground shadow-xl backdrop:bg-black/35">
      <form className="space-y-4 p-4 sm:p-5" onSubmit={async event => {
        event.preventDefault()
        if (saving) return
        setSaving(true)
        setSaveError('')
        try {
          await onSave(edits)
          dialog.current?.close()
        } catch (error) {
          setSaveError(draftVisualSaveError(error))
        } finally {
          setSaving(false)
        }
      }}>
        <div className="flex items-center justify-between gap-3">
          <h2 id={titleId} className="text-base font-semibold">업체별 Top Buttom 등록</h2>
          <Button type="button" variant="ghost" size="icon" aria-label="업체별 HTML 닫기" disabled={saving}
            onClick={() => dialog.current?.close()}>
            <X size={16} aria-hidden="true" />
          </Button>
        </div>
        <label className="grid w-full gap-1.5 text-sm font-medium sm:max-w-52">
          업체
          <Select value={vendor} disabled={saving} onChange={event => {
            const next = DRAFT_HTML_VENDORS.find(option => option === event.target.value)
            if (next) setVendor(next)
          }}>
            {DRAFT_HTML_VENDORS.map(option => <option key={option} value={option}>{option}</option>)}
          </Select>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          {(['top', 'bottom'] as const).map(part => (
            <label key={part} className="grid min-w-0 gap-1.5 text-sm font-medium">
              {part === 'top' ? 'Top HTML' : 'Buttom HTML'}
              <Textarea value={html[part]} rows={7} spellCheck={false} readOnly={saving}
                placeholder="HTML 입력" className="min-h-28 resize-y bg-muted/35 font-mono text-xs shadow-none"
                onChange={event => {
                  const text = event.target.value
                  setEdits(current => ({
                    ...current,
                    [vendor]: { ...(current[vendor] ?? EMPTY_HTML), [part]: text },
                  }))
                }} />
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => dialog.current?.close()}>취소</Button>
          <Button type="submit" size="sm" disabled={saving || edits === value}>{saving ? '저장 중…' : '저장'}</Button>
        </div>
        {saveError && <p role="alert" className="text-right text-xs text-danger">{saveError}</p>}
      </form>
    </dialog>
  )
}
