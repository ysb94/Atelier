import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'

export function ManualMeetingConfirmation({ names, busy, error, onClose, onConfirm }: {
  names: string[]; busy: boolean; error?: string | null; onClose: () => void; onConfirm: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])
  return <dialog ref={ref} aria-labelledby="manual-meeting-title" onCancel={event => { event.preventDefault(); if (!busy) onClose() }}
    className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-border bg-card p-5 text-foreground shadow-sm backdrop:bg-black/40">
    <h2 id="manual-meeting-title" className="font-semibold">불참자 제외하고 이번 차수 확정</h2>
    <p className="mt-3 text-sm">다음 멤버를 이번 차수에서 제외하고 예정된 일정으로 진행하시겠습니까?</p>
    <ul className="my-3 list-disc pl-5 text-sm">{names.map((name,index) => <li key={index}>{name}</li>)}</ul>
    <p className="text-sm text-muted-foreground">불참 응답은 보존되며, 다음 차수에는 다시 참석 대상에 포함됩니다.</p>
    {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
    <div className="mt-5 flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>닫기</Button>
      <Button type="button" disabled={busy || names.length===0} onClick={onConfirm}>{busy ? '확정 중…' : '불참자 제외하고 확정'}</Button></div>
  </dialog>
}
