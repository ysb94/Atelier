import { useEffect, useId, useRef } from 'react'
import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function ChinaAssignmentWarning({ heading = '업무 배정 전 확인', messages, onClose }: {
  heading?: string
  messages: string[]
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const title = useId()
  const description = useId()

  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])

  return (
    <dialog ref={dialog} role="alertdialog" aria-labelledby={title} aria-describedby={description}
      onCancel={onClose}
      className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-sm rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xl backdrop:bg-black/40">
      <h2 id={title} className="flex items-center gap-2 font-semibold">
        <TriangleAlert className="size-5 text-danger" aria-hidden="true" />
        {heading}
      </h2>
      <ul id={description} className="mt-3 list-disc space-y-1 pl-5 text-sm">
        {messages.map(message => <li key={message}>{message}</li>)}
      </ul>
      <div className="mt-5 flex justify-end">
        <Button type="button" onClick={onClose}>확인</Button>
      </div>
    </dialog>
  )
}
