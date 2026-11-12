import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

export function LeaveAdvanceDrawer({ title, department, busy, onClose, children }: {
  title: string
  department?: string
  busy: boolean
  onClose: () => void
  children: ReactNode
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => dialog?.close()
  }, [])

  function close() {
    if (busy) return
    dialogRef.current?.close()
    onClose()
  }

  return <dialog ref={dialogRef} aria-labelledby={titleId}
    className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-full max-w-lg overflow-hidden border-l border-border bg-card text-card-foreground shadow-xl backdrop:bg-black/40"
    onCancel={event => { event.preventDefault(); close() }}
    onClick={event => { if (event.target === event.currentTarget) close() }}>
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 id={titleId} className="break-words text-lg font-semibold">{title}</h2>
          {department && <p className="text-sm text-muted-foreground">{department}</p>}
        </div>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={close}>닫기</Button>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">{children}</div>
    </div>
  </dialog>
}
