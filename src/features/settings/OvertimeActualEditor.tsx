import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { registeredOvertime, type OvertimeActual, type OvertimeRequest } from '@/features/operations-support/overtime-actuals'
import { workDurationLabel } from '@/features/operations-support/overtime-hours'

function localInput(stamp?: string) { return stamp ? new Date(Date.parse(stamp) + 9 * 3_600_000).toISOString().slice(0, 16) : '' }
export function OvertimeActualEditor({ request, existing, onSave, onClose }: {
  request: OvertimeRequest; existing?: OvertimeActual
  onSave: (value: Omit<OvertimeActual, 'savedAt'>) => Promise<unknown>; onClose: () => void
}) {
  const [start, setStart] = useState(localInput(existing?.startAt))
  const [end, setEnd] = useState(localInput(existing?.endAt))
  const [rest, setRest] = useState(String(existing?.breakMinutes ?? 0))
  const [revision] = useState(existing?.revision ?? 0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const input = { requestId: request.id, startAt: start ? `${start}:00+09:00` : '', endAt: end ? `${end}:00+09:00` : '', breakMinutes: rest === '' ? NaN : Number(rest), revision }
  const minutes = registeredOvertime([request], [{ ...input, savedAt: '' }], request.from.slice(0, 7), request.from)[0]?.minutes
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (minutes == null || Date.parse(input.endAt) > Date.now()) { setError('승인된 야근 구간 안에서 실제 근무한 시작·종료와 휴게시간을 입력해 주세요. 미래 시각은 저장할 수 없습니다.'); return }
    setBusy(true); setError('')
    try { await onSave(input); onClose() }
    catch (caught) { console.warn('[overtime-actuals] 입력 실패', { requestId: request.id, caught }); setError(caught instanceof Error ? caught.message : '실제 야근을 저장하지 못했습니다.') }
    finally { setBusy(false) }
  }
  return <form onSubmit={event => void submit(event)} className="space-y-3 rounded-xl border border-border bg-card p-4" aria-label="실제 야근 입력">
    <p className="text-sm">승인 시간 {request.from} {request.start}–{request.endNextDay ? '다음 날 ' : ''}{request.end} · 한국 시간 기준</p>
    <p className="text-xs text-muted-foreground">실제 근무한 구간만 입력하세요. 휴게시간을 뺀 시간이 야근 누적에 반영됩니다. 승인 범위를 넘으면 야근을 추가 신청해 주세요. 출퇴근 원본은 변경하지 않습니다.</p>
    <fieldset disabled={busy} className="flex flex-wrap gap-3">
      <label className="text-sm">실제 야근 시작<Input required type="datetime-local" aria-label="실제 야근 시작" value={start} onChange={event => setStart(event.target.value)} /></label>
      <label className="text-sm">실제 야근 종료<Input required type="datetime-local" aria-label="실제 야근 종료" value={end} onChange={event => setEnd(event.target.value)} /></label>
      <label className="text-sm">휴게시간(분)<Input required type="number" min={0} step={1} aria-label="실제 야근 휴게시간" value={rest} onChange={event => setRest(event.target.value)} /></label>
    </fieldset>
    <p className="text-sm">누적 반영: {minutes == null ? '시간을 확인해 주세요' : workDurationLabel(minutes)}</p>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <div className="flex gap-2"><Button type="submit" size="sm" disabled={busy}>{busy ? '저장 중…' : '실제 야근 저장'}</Button><Button type="button" size="sm" variant="outline" disabled={busy} onClick={onClose}>닫기</Button></div>
  </form>
}
