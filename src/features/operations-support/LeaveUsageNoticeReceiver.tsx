import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { useRenderWatch } from '@/lib/diagnostics'
import { useAttendanceEntry } from '@/features/home/attendance-entry-context'
import { LEAVE_NOTICE_LABELS, type LeaveUsageNotice } from '@/lib/supabase/leave-usage-notices'
import { leaveNoticeTime } from './leave-usage-notices'
import type { LeaveUsageNoticeController } from './use-leave-usage-notices'

export function LeaveUsageNoticeReceiver({ notices }: { notices: LeaveUsageNoticeController }) {
  useRenderWatch('LeaveUsageNoticeReceiver')
  const entry = useAttendanceEntry()
  if (!notices.enabled) return null
  const pending = notices.records.filter(row => !row.confirmed_at)
  const canPrompt = !entry || (entry.phase === 'ready' && !entry.checkoutOpen)
  return <>
    {pending.length > 0 && !notices.active && canPrompt && notices.canConfirm && <aside role="status" aria-label="연차 사용 안내 알림" className="fixed bottom-6 right-4 z-50 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-border bg-card p-4 text-foreground shadow-sm">
      <strong className="text-sm">연차 안내 {pending.length}건 미확인</strong><p className="my-2 text-sm text-muted-foreground">남은 연차와 사용기한을 확인해 주세요.</p>
      {notices.error && <p role="alert" className="my-2 text-sm text-danger">{notices.error}</p>}
      <Button size="sm" disabled={notices.busy} onClick={() => void notices.open(pending[0].id)}>연차 안내문 보기</Button>
    </aside>}
    {notices.active && <LeaveNoticeDocument key={notices.active.id} record={notices.active} notices={notices}/>}
  </>
}
function LeaveNoticeDocument({ record, notices }: { record: LeaveUsageNotice; notices: LeaveUsageNoticeController }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [checked, setChecked] = useState(false)
  useEffect(() => { dialog.current?.showModal() }, [])
  return createPortal(<dialog ref={dialog} aria-labelledby="leave-notice-title" onCancel={event => { event.preventDefault(); if (!notices.busy) notices.close() }} className="m-auto max-h-[90dvh] w-[min(42rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-border bg-card p-5 text-foreground shadow-sm backdrop:bg-foreground/30">
    <header className="flex items-start justify-between gap-3"><h2 id="leave-notice-title" className="text-lg font-semibold">{record.title} · {LEAVE_NOTICE_LABELS[record.phase]}</h2><Button size="sm" variant="ghost" disabled={notices.busy} onClick={notices.close}>닫기</Button></header>
    <article aria-label="연차 사용 안내문" className="my-4 whitespace-pre-wrap rounded-lg border border-border bg-muted/20 p-4 text-sm leading-6">{record.body}</article>
    {notices.error && <p role="alert" className="my-2 text-sm text-danger">{notices.error}</p>}
    {!notices.canConfirm ? <p className="text-sm text-warning">직원 계정 전환·미리보기에서는 본인 확인을 남길 수 없습니다.</p> : record.confirmed_at ? <p role="status" className="text-sm text-success">본인 확인 완료 · {leaveNoticeTime(record.confirmed_at)}</p> : <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={checked} disabled={notices.busy} onChange={event => setChecked(event.target.checked)} className="mt-1 accent-primary"/>잔여 연차와 사용기한 안내를 확인했습니다.</label>}
    <footer className="mt-5 flex flex-wrap justify-end gap-2 border-t border-border pt-4">
      <Button size="sm" variant="outline" disabled={notices.busy} onClick={notices.close}>{record.confirmed_at ? '닫기' : '나중에 확인'}</Button>
      {!record.confirmed_at && notices.canConfirm && <Button size="sm" disabled={!checked || notices.busy} onClick={async () => { if (await notices.confirm(record.id)) notices.close() }}>{notices.busy ? '저장 중…' : '확인하고 닫기'}</Button>}
    </footer>
  </dialog>, document.body)
}
