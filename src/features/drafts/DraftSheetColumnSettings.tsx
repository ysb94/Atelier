import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Settings2 } from 'lucide-react'
import { WorkspaceTabOverlay } from '@/components/layout/workspace-tab-overlay'
import { Button } from '@/components/ui/button'
import {
  DEFAULT_DRAFT_SHEET_LAYOUT, DRAFT_SHEET_COLUMNS, saveDraftSheetLayout, type DraftSheetLayout,
} from './draft-sheet-layout'

function ColumnSettingsDialog({ layout, accountId, onClose }: {
  layout: DraftSheetLayout
  accountId: string
  onClose: () => void
}) {
  const titleId = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const [draft, setDraft] = useState(layout)
  const [error, setError] = useState(false)
  const visibleCount = draft.filter(column => column.visible).length

  useEffect(() => { dialog.current?.showModal() }, [])

  return createPortal(<dialog ref={dialog} aria-labelledby={titleId} onClose={onClose}
    onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation() }}
    className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-sm rounded-xl border border-border bg-card p-4 text-foreground shadow-xl backdrop:bg-black/35">
    <form className="space-y-3" onSubmit={event => {
      event.preventDefault()
      if (saveDraftSheetLayout(accountId, draft)) dialog.current?.close()
      else setError(true)
    }}>
      <h2 id={titleId} className="text-base font-semibold">열 표시 설정</h2>
      <p className="text-xs text-muted-foreground">체크를 끄면 해당 열을 숨깁니다.</p>
      <ol className="divide-y divide-border rounded-md border border-border">
        {draft.map(({ id, visible }) => {
          const { label } = DRAFT_SHEET_COLUMNS[id]
          return <li key={id}>
            <label className="flex min-w-0 items-center gap-2 px-3 py-2 text-sm">
              <input type="checkbox" className="accent-primary" checked={visible}
                disabled={visible && visibleCount === 1}
                onChange={event => {
                  const checked = event.currentTarget.checked
                  setDraft(current => current.map(column => column.id === id ? { id, visible: checked } : column))
                }} />
              {label}
            </label>
          </li>
        })}
      </ol>
      {error && <p role="alert" className="text-xs text-danger">브라우저에 열 설정을 저장하지 못했습니다.</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" className="mr-auto"
          onClick={() => setDraft(DEFAULT_DRAFT_SHEET_LAYOUT)}>기본값 복원</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => dialog.current?.close()}>취소</Button>
        <Button type="submit" size="sm">적용</Button>
      </div>
    </form>
  </dialog>, document.body)
}

export function DraftSheetColumnSettings({ layout, accountId }: { layout: DraftSheetLayout; accountId?: string }) {
  const [open, setOpen] = useState(false)
  return <>
    <Button type="button" size="sm" variant="outline" aria-haspopup="dialog" disabled={!accountId}
      onClick={() => setOpen(true)}>
      <Settings2 className="size-3.5" aria-hidden="true" />열 표시 설정
    </Button>
    {open && accountId && <WorkspaceTabOverlay>
      <ColumnSettingsDialog accountId={accountId} layout={layout} onClose={() => setOpen(false)} />
    </WorkspaceTabOverlay>}
  </>
}
