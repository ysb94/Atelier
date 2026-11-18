import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea } from '@/components/ui/input'
import type { AttendanceIncidentAdjustment, AttendanceIncidentKind } from '@/lib/supabase/attendance-incident-adjustments'

type EditMode = 'duration' | 'exclude' | 'restore'

export function AttendanceIncidentEditDialog({ target, adjustment, onSave, onClose }: {
  target: { name: string; date: string; kind: AttendanceIncidentKind; originalMinutes?: number }
  adjustment?: AttendanceIncidentAdjustment
  onSave: (minutes: number | null, reason: string) => Promise<void>
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const kind = target.kind === 'late' ? '지각' : '결근'
  const original = target.originalMinutes ?? 0
  const durationEdit = target.kind === 'late'
  const [mode, setMode] = useState<EditMode>(adjustment?.minutes === 0 ? 'exclude' : durationEdit ? 'duration' : 'exclude')
  const [duration, setDuration] = useState(String(adjustment?.minutes || original))
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submitting = useRef(false)
  useEffect(() => { dialog.current?.showModal() }, [])
  const parsed = Number(duration)
  const minutes = mode === 'restore' ? null : mode === 'exclude' ? 0 : parsed
  const valid = reason.trim().length > 0 && (mode !== 'duration' || (/^\d+$/.test(duration) && parsed <= 1439))

  async function submit() {
    if (!valid || submitting.current) return
    submitting.current = true
    setBusy(true)
    setError('')
    try {
      await onSave(minutes, reason.trim())
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '저장하지 못했습니다.')
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  return <dialog ref={dialog} aria-label={`${kind} 수정`} className="m-auto w-[min(92vw,420px)] rounded-xl border border-border bg-card p-5 text-foreground shadow-lg backdrop:bg-black/40" onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
    <form className="space-y-4" onSubmit={event => { event.preventDefault(); void submit() }}>
      <header>
        <h2 className="text-base font-semibold">{kind} 수정</h2>
        <p className="text-sm text-muted-foreground">{target.name} · {target.date}{durationEdit && ` · 자동 계산 ${original}분`}</p>
      </header>
      <label className="block space-y-1 text-sm"><span>처리</span><Select value={mode} disabled={busy} onChange={event => setMode(event.target.value as EditMode)}>
        {durationEdit && <option value="duration">지각 시간 수정</option>}
        <option value="exclude">{kind} 제외</option>
        {adjustment?.minutes != null && <option value="restore">자동 집계로 되돌리기</option>}
      </Select></label>
      {mode === 'duration' && <label className="block space-y-1 text-sm"><span>지각 시간 (분)</span><Input type="number" min={0} max={1439} step={1} required value={duration} disabled={busy} onChange={event => setDuration(event.target.value)} /></label>}
      {adjustment?.minutes != null && adjustment.reason && <p className="text-xs text-muted-foreground">이전 수정 사유 · {adjustment.reason}</p>}
      <label className="block space-y-1 text-sm"><span>수정 사유</span><Textarea rows={2} required maxLength={300} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} /></label>
      <p className="text-xs text-muted-foreground">집계에 반영되며 원래 출퇴근 시각과 사유서는 보존됩니다.</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>닫기</Button><Button type="submit" disabled={!valid || busy}>{busy ? '저장 중…' : '저장'}</Button></div>
    </form>
  </dialog>
}
