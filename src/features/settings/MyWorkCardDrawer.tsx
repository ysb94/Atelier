import { useEffect, useId, useRef, useState } from 'react'
import { Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'

type CardDetails = { title: string; description: string }

export function MyWorkCardDrawer({ card, statusLabel, onClose, onSave, onDelete }: {
  card: CardDetails
  statusLabel?: string
  onClose: () => void
  onSave: (details: CardDetails) => void
  onDelete: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const headingId = useId()
  const [title, setTitle] = useState(card.title)
  const [description, setDescription] = useState(card.description)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const nextTitle = title.trim()
  const changed = nextTitle !== card.title || description !== card.description

  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])

  function close() {
    dialog.current?.close()
    onClose()
  }

  return <dialog ref={dialog} aria-labelledby={headingId}
    className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-full max-w-2xl border-l border-border bg-card text-card-foreground shadow-2xl backdrop:bg-black/20"
    onCancel={event => { event.preventDefault(); close() }}
    onClick={event => { if (event.target === event.currentTarget) close() }}>
    <form className="flex h-full min-w-0 flex-col" onSubmit={event => {
      event.preventDefault()
      if (!nextTitle || !changed || confirmingDelete) return
      onSave({ title: nextTitle, description })
      close()
    }}>
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-4 py-5 sm:px-8">
        <div className="min-w-0">
          <h2 id={headingId} className="text-xl font-semibold tracking-tight">업무 카드 상세</h2>
          <p className="mt-1 text-sm text-muted-foreground">{statusLabel}</p>
        </div>
        <Button type="button" variant="ghost" size="icon" aria-label="업무 카드 상세 닫기" onClick={close}>
          <X size={20} aria-hidden="true" />
        </Button>
      </header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-6 sm:px-8">
        <label className="grid gap-2 text-sm font-medium">제목
          <Input autoFocus value={title} required maxLength={120} onChange={event => setTitle(event.currentTarget.value)} />
        </label>
        <label className="grid gap-2 text-sm font-medium">내용
          <Textarea rows={9} value={description} placeholder="업무 내용을 입력하세요."
            className="resize-y py-2.5 font-normal" onChange={event => setDescription(event.currentTarget.value)} />
        </label>
      </div>
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-4 sm:px-8">
        {confirmingDelete ? <>
          <p className="text-sm font-medium text-danger" role="status">이 카드를 삭제할까요?</p>
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="outline" autoFocus onClick={() => setConfirmingDelete(false)}>삭제 취소</Button>
            <Button type="button" variant="danger" onClick={() => { close(); onDelete() }}>삭제 확인</Button>
          </div>
        </> : <>
          <Button type="button" variant="ghost" className="text-danger" onClick={() => setConfirmingDelete(true)}>
            <Trash2 size={16} aria-hidden="true" />삭제
          </Button>
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="outline" onClick={close}>취소</Button>
            <Button type="submit" disabled={!nextTitle || !changed}>저장</Button>
          </div>
        </>}
      </footer>
    </form>
  </dialog>
}
