import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { useRenderWatch } from '@/lib/diagnostics'
import { useAttendanceEntry } from '@/features/home/attendance-entry-context'
import { LEAVE_SAMPLE_LABELS, sampleTimestamp, type LeaveAlarmSample } from './leave-alarm-sample'
import { useLeaveAlarmSample } from './use-leave-alarm-sample'

export function LeaveAlarmSampleReceiver() {
  useRenderWatch('LeaveAlarmSampleReceiver')
  const sample = useLeaveAlarmSample()
  const entry = useAttendanceEntry()
  if (!sample.enabled) return null
  const active = sample.records.find(row => row.id === sample.activeId)
  const pending = sample.records.filter(row => !row.confirmedAt)
  const canPrompt = !entry || (entry.phase === 'ready' && !entry.checkoutOpen)
  return <>
    {pending.length > 0 && !active && canPrompt && <aside role="status" aria-label="연차 사용 안내 알림" className="fixed bottom-6 right-4 z-50 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-border bg-card p-4 text-foreground shadow-sm">
      <strong className="text-sm">연차 안내 {pending.length}건 미확인</strong><p className="my-2 text-sm text-muted-foreground">남은 연차와 사용기한을 확인해 주세요.</p><Button size="sm" onClick={() => sample.open(pending[0].id)}>연차 안내문 보기</Button>
    </aside>}
    {active && <SampleDocument key={active.id} record={active}/>}
  </>
}
function SampleDocument({ record }: { record: LeaveAlarmSample }) {
  const sample = useLeaveAlarmSample()
  const dialog = useRef<HTMLDialogElement>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  useEffect(() => { dialog.current?.showModal() }, [])
  const changedRecord = sample.records.find(row => row.id === record.id) ?? record
  return createPortal(<dialog ref={dialog} aria-labelledby="leave-sample-title" onCancel={event => { event.preventDefault(); sample.close() }} className="m-auto max-h-[90dvh] w-[min(42rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-border bg-card p-5 text-foreground shadow-sm backdrop:bg-foreground/30">
    <header className="flex items-start justify-between gap-3"><h2 id="leave-sample-title" className="text-lg font-semibold">{record.title ?? '연차 사용 안내'} · {LEAVE_SAMPLE_LABELS[record.phase]}</h2><Button size="sm" variant="ghost" onClick={() => sample.close()}>닫기</Button></header>
    <article aria-label="연차 사용 안내문" className="my-4 whitespace-pre-wrap rounded-lg border border-border bg-muted/20 p-4 text-sm leading-6">{record.body}</article>
    {sample.error && <p role="alert" className="my-2 text-sm text-danger">확인 기록을 처리하지 못했습니다. 새로고침한 뒤 다시 시도해 주세요.</p>}
    {changedRecord.confirmedAt ? <p role="status" className="text-sm text-success">본인 확인 완료 · {sampleTimestamp(changedRecord.confirmedAt)}</p> : <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} className="mt-1 accent-primary"/>잔여 연차와 사용기한 안내를 확인했습니다.</label>}
    <footer className="mt-5 flex flex-wrap justify-end gap-2 border-t border-border pt-4">
      {changedRecord.confirmedAt ? <Button size="sm" onClick={() => sample.close()}>닫기</Button> : <><Button size="sm" variant="outline" onClick={() => sample.close()}>나중에 확인</Button><Button size="sm" disabled={!acknowledged || Boolean(sample.error)} onClick={() => {if(sample.confirm(record.id)) sample.close()}}>확인하고 닫기</Button></>}
    </footer>
  </dialog>, document.body)
}
