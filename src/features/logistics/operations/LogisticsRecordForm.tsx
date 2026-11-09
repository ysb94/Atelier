import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import type { LogisticsEmployee, LogisticsRecord, LogisticsRecordInput, LogisticsLeaveKind } from '@/lib/supabase/logistics-operations'
import { LOGISTICS_LEAVE_LABELS, logisticsInstant, logisticsLocalTime } from './logistics-records'

export function LogisticsRecordForm({ employees, record, date, busy, error, onSave, onClose }: { employees: LogisticsEmployee[]; record: LogisticsRecord | null; date: string; busy: boolean; error: string; onSave: (input: LogisticsRecordInput) => void; onClose: () => void }) {
  const [id] = useState(() => record?.id ?? crypto.randomUUID())
  const [employee, setEmployee] = useState(record?.employee_id ?? '')
  const [kind, setKind] = useState<'work' | 'leave'>(record?.kind ?? 'work')
  const [start, setStart] = useState(logisticsLocalTime(record?.started_at ?? null))
  const [end, setEnd] = useState(logisticsLocalTime(record?.ended_at ?? null))
  const [pauses, setPauses] = useState(record?.break_minutes ?? 0)
  const [from, setFrom] = useState(record?.from_date ?? date)
  const [to, setTo] = useState(record?.to_date ?? date)
  const [leaveKind, setLeaveKind] = useState<LogisticsLeaveKind>(record?.leave_kind ?? 'annual')
  const [days, setDays] = useState(Number(record?.leave_days ?? 1))
  const [note, setNote] = useState(record?.note ?? '')
  const [validation, setValidation] = useState('')
  function submit() {
    const began = logisticsInstant(start), ended = logisticsInstant(end)
    if (!employee) { setValidation('직원을 선택해 주세요.'); return }
    if (kind === 'work' && (!began || !ended || ended <= began || !Number.isInteger(pauses) || pauses < 0 || pauses > (Date.parse(ended) - Date.parse(began)) / 60_000)) { setValidation('근무 시작·종료와 휴게시간을 확인해 주세요.'); return }
    if (kind === 'leave' && (!from || !to || to < from || !Number.isFinite(days) || days <= 0 || days * 4 % 1 !== 0)) { setValidation('휴가 기간과 일수(0.25일 단위)를 확인해 주세요.'); return }
    setValidation('')
    onSave({ id, employeeId: employee, kind, from: kind === 'work' ? start.slice(0, 10) : from, to: kind === 'work' ? end.slice(0, 10) : to, startedAt: kind === 'work' ? began : null, endedAt: kind === 'work' ? ended : null, breakMinutes: kind === 'work' ? pauses : 0, leaveKind: kind === 'leave' ? leaveKind : null, leaveDays: kind === 'leave' ? days : null, note, version: record?.version ?? 0 })
  }
  return <Card className="space-y-4 p-5" role="region" aria-label="물류 근무·휴가 입력">
    <h2 className="font-semibold">{record ? '기록 수정' : '근무·휴가 등록'}</h2>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="space-y-1 text-sm">직원<Select aria-label="물류 기록 직원" value={employee} disabled={busy || Boolean(record)} onChange={event => setEmployee(event.target.value)}><option value="">직원 선택</option>{employees.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>
      <label className="space-y-1 text-sm">기록 종류<Select aria-label="물류 기록 종류" value={kind} disabled={busy} onChange={event => setKind(event.target.value as 'work' | 'leave')}><option value="work">근무</option><option value="leave">휴가</option></Select></label>
      {kind === 'work' ? <>
        <label className="space-y-1 text-sm">근무 시작 · 한국 시간<Input type="datetime-local" aria-label="물류 근무 시작" value={start} disabled={busy} onChange={event => setStart(event.target.value)} /></label>
        <label className="space-y-1 text-sm">근무 종료 · 한국 시간<Input type="datetime-local" aria-label="물류 근무 종료" value={end} disabled={busy} onChange={event => setEnd(event.target.value)} /></label>
        <label className="space-y-1 text-sm">실제 휴게시간(분)<Input type="number" min={0} step={1} aria-label="물류 휴게시간" value={pauses} disabled={busy} onChange={event => setPauses(Number(event.target.value))} /></label>
      </> : <>
        <label className="space-y-1 text-sm">휴가 시작일<Input type="date" aria-label="물류 휴가 시작일" value={from} disabled={busy} onChange={event => setFrom(event.target.value)} /></label>
        <label className="space-y-1 text-sm">휴가 종료일<Input type="date" aria-label="물류 휴가 종료일" value={to} min={from} disabled={busy} onChange={event => setTo(event.target.value)} /></label>
        <label className="space-y-1 text-sm">휴가 종류<Select aria-label="물류 휴가 종류" value={leaveKind} disabled={busy} onChange={event => setLeaveKind(event.target.value as LogisticsLeaveKind)}>{Object.entries(LOGISTICS_LEAVE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></label>
        <label className="space-y-1 text-sm">사용 일수<Input type="number" aria-label="물류 휴가 일수" min={0.25} step={0.25} value={days} disabled={busy} onChange={event => setDays(Number(event.target.value))} /></label>
      </>}
    </div>
    <label className="block space-y-1 text-sm">메모 · 선택<Textarea aria-label="물류 기록 메모" maxLength={1000} value={note} disabled={busy} onChange={event => setNote(event.target.value)} /></label>
    {(validation || error) && <p role="alert" className="text-sm text-danger">{validation || error}</p>}
    <div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={onClose}>닫기</Button><Button disabled={busy} onClick={submit}>{busy ? '저장 중…' : '기록 저장'}</Button></div>
  </Card>
}
