import { useEffect, useId, useRef } from 'react'
import { CheckCircle2, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

type CargoInboundCompletionDialogProps = {
  cargoTitle: string
  description: string
  pending: boolean
  error: string | null
  onClose: () => void
  onConfirm: () => void
}

export function CargoInboundCompletionDialog({
  cargoTitle,
  description,
  pending,
  error,
  onClose,
  onConfirm,
}: CargoInboundCompletionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    dialog?.querySelector<HTMLButtonElement>('[data-cancel-completion]')?.focus()
    return () => dialog?.close()
  }, [])

  function close() {
    if (pending) return
    dialogRef.current?.close()
    onClose()
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-1.5rem)] max-w-md overflow-auto rounded-xl border border-border bg-card p-0 text-card-foreground shadow-md backdrop:bg-foreground/60"
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
    >
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 id={titleId} className="text-base font-semibold tracking-tight">화물 완료 처리</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{cargoTitle}</p>
        </div>
        <Button type="button" variant="ghost" size="icon" aria-label="완료 확인 닫기" disabled={pending} onClick={close}>
          <X className="size-4" aria-hidden="true" />
        </Button>
      </header>
      <div className="space-y-2 px-4 py-4">
        <p id={descriptionId} className="text-sm">{description}</p>
        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      </div>
      <footer className="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3">
        <Button type="button" variant="outline" size="sm" data-cancel-completion disabled={pending} onClick={close}>취소</Button>
        <Button type="button" size="sm" disabled={pending} onClick={onConfirm}>
          {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="size-3.5" aria-hidden="true" />}
          {pending ? '완료 처리 중…' : '완료 처리'}
        </Button>
      </footer>
    </dialog>
  )
}
