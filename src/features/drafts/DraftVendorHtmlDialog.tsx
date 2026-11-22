import { useEffect, useId, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, Textarea } from '@/components/ui/input'
import { DRAFT_OPEN_DETAIL_OPTIONS } from '@/lib/types'

type VendorHtml = { top: string; bottom: string }
export type DraftVendorHtml = Partial<Record<string, VendorHtml>>

const VENDORS = DRAFT_OPEN_DETAIL_OPTIONS.filter(vendor => vendor !== '전체')
const EMPTY_HTML: VendorHtml = { top: '', bottom: '' }

export function DraftVendorHtmlDialog({ preferredVendor, value, onSave, onClose }: {
  preferredVendor: string
  value: DraftVendorHtml
  onSave: (value: DraftVendorHtml) => void
  onClose: () => void
}) {
  const titleId = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const [vendor, setVendor] = useState(() => VENDORS.find(option => option === preferredVendor) ?? VENDORS[0])
  const [edits, setEdits] = useState(value)
  const html = edits[vendor] ?? EMPTY_HTML

  useEffect(() => { dialog.current?.showModal() }, [])

  return (
    <dialog ref={dialog} aria-labelledby={titleId} onClose={onClose}
      onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation() }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto rounded-xl border border-border bg-card text-foreground shadow-xl backdrop:bg-black/35">
      <form className="space-y-4 p-4 sm:p-5" onSubmit={event => {
        event.preventDefault()
        onSave(edits)
        dialog.current?.close()
      }}>
        <div className="flex items-center justify-between gap-3">
          <h2 id={titleId} className="text-base font-semibold">업체별 Top Buttom 등록</h2>
          <Button type="button" variant="ghost" size="icon" aria-label="업체별 HTML 닫기"
            onClick={() => dialog.current?.close()}>
            <X size={16} aria-hidden="true" />
          </Button>
        </div>
        <label className="grid w-full gap-1.5 text-sm font-medium sm:max-w-52">
          업체
          <Select value={vendor} onChange={event => {
            const next = VENDORS.find(option => option === event.target.value)
            if (next) setVendor(next)
          }}>
            {VENDORS.map(option => <option key={option} value={option}>{option}</option>)}
          </Select>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          {(['top', 'bottom'] as const).map(part => (
            <label key={part} className="grid min-w-0 gap-1.5 text-sm font-medium">
              {part === 'top' ? 'Top HTML' : 'Buttom HTML'}
              <Textarea value={html[part]} rows={7} spellCheck={false}
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
          <p className="mr-auto text-xs text-muted-foreground">입력 내용은 현재 기획안 화면에서만 저장됩니다.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => dialog.current?.close()}>취소</Button>
          <Button type="submit" size="sm">저장</Button>
        </div>
      </form>
    </dialog>
  )
}
