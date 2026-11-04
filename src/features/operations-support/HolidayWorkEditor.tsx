import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { holidayAmount, holidayCredit, holidayTime, HOLIDAY_LOCATIONS, parsedHolidayIntervals, type HolidayWork } from './holiday-work'
import type { HolidayAction } from '@/lib/supabase/holiday-work'
import { koreanHolidayNames } from './korean-holidays'
import { koreaDateKey } from '@/features/settings/my-attendance'

export type HolidaySave = (action: HolidayAction, payload: object) => Promise<void>
export function HolidayIntervalFields({ values, onChange }: { values: { start: string; end: string }[]; onChange: (values: { start: string; end: string }[]) => void }) {
  return <div className="space-y-2">{values.map((row, index) => <div key={index} className="flex flex-wrap items-center gap-2">
    <Input className="w-28" aria-label={`근무 구간 ${index + 1} 시작`} value={row.start} placeholder="09:00" onChange={e => onChange(values.map((item, i) => i === index ? { ...item, start: e.target.value } : item))} />
    <span>~</span><Input className="w-28" aria-label={`근무 구간 ${index + 1} 종료`} value={row.end} placeholder="12:00" onChange={e => onChange(values.map((item, i) => i === index ? { ...item, end: e.target.value } : item))} />
    {values.length > 1 && <Button type="button" variant="ghost" size="sm" onClick={() => onChange(values.filter((_, i) => i !== index))}>구간 삭제</Button>}
  </div>)}<Button type="button" variant="outline" size="sm" disabled={values.length >= 24} onClick={() => onChange([...values, { start: '', end: '' }])}>근무 구간 추가</Button>
    <p className="text-xs text-muted-foreground">휴게시간을 뺀 구간을 입력하세요. 예: 09:00~12:00, 13:00~18:00. 자정을 넘으면 날짜별로 나누며, 당일 종료에는 24:00을 사용할 수 있습니다.</p>
  </div>
}
export function HolidayWorkInput({ row, planned, month, save, close }: { row?: HolidayWork; planned: boolean; month: string; save: HolidaySave; close: () => void }) {
  const [date, setDate] = useState(row?.date ?? `${month}-01`), [location, setLocation] = useState<HolidayWork['location']>(row?.location ?? 'office')
  const [note, setNote] = useState(row?.reason ?? ''), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  const initial = planned ? row?.plannedIntervals : row?.state === 'returned' ? row.intervals : null
  const [values, setValues] = useState(initial?.length ? initial.map(i => ({ start: holidayTime(i.start), end: holidayTime(i.end) })) : [{ start: '', end: '' }])
  const weekday = new Date(`${date}T12:00:00+09:00`).getUTCDay()
  const kind = row?.dayKind ?? (weekday === 0 || koreanHolidayNames(date).length > 0 ? 'holiday' : 'rest')
  const intervals = parsedHolidayIntervals(values), amount = intervals ? holidayAmount(intervals, kind) : null
  async function submit() {
    if (!amount || !intervals) return
    setBusy(true); setError(null)
    try { await save(planned ? 'plan' : 'submit', { date, location, note, intervals, version: row?.version ?? 0 }); close() }
    catch (cause) { setError(cause instanceof Error ? cause.message : '저장하지 못했습니다. 입력은 유지됩니다.') }
    finally { setBusy(false) }
  }
  return <Card className="space-y-3 p-4" role="dialog" aria-label={planned ? '주말·공휴일 근무 예정 등록' : '주말·공휴일 실제 근무 제출'}>
    <h3 className="font-semibold">{planned ? '주말·공휴일 근무 예정 등록' : '실제 근무시간 제출'}</h3>
    <fieldset disabled={busy} className="space-y-3">
      <div className="flex flex-wrap gap-3"><label className="text-sm">근무 날짜<Input aria-label="휴일 근무 날짜" type="date" value={date} disabled={Boolean(row)} onChange={e => setDate(e.target.value)} /></label>
        <label className="text-sm">근무 구분<Select aria-label="휴일 근무 장소 구분" value={location} onChange={e => setLocation(e.target.value as HolidayWork['location'])}>{Object.entries(HOLIDAY_LOCATIONS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></label></div>
      <HolidayIntervalFields values={values} onChange={setValues} />
      {amount && <p className="text-sm">{planned ? '예정 근무' : '실제 근무'} {holidayCredit(amount.minutes * 2)}{!planned && ` · 가산 반영 예상 ${holidayCredit(amount.units)}`}</p>}
      {row?.reviewNote && <p className="rounded-lg bg-muted p-3 text-sm">보완 요청: {row.reviewNote}</p>}
      <label className="block text-sm">업무 내용 · 필수<Textarea aria-label="휴일 근무 업무 내용" value={note} maxLength={500} onChange={e => setNote(e.target.value)} /></label>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2"><Button type="button" disabled={!amount || !note.trim() || !date} onClick={() => void submit()}>{busy ? '저장 중…' : planned ? '예정 등록' : '부서 승인자에게 제출'}</Button><Button type="button" variant="outline" onClick={close}>닫기</Button></div>
    </fieldset>
  </Card>
}

export function HolidaySettlementEditor({ rows, policyReady, save, close }: { rows: HolidayWork[]; policyReady: boolean; save: HolidaySave; close: () => void }) {
  const [mode, setMode] = useState<'cash' | 'leave'>('cash'), [rate, setRate] = useState(''), [month, setMonth] = useState(koreaDateKey().slice(0, 7))
  const [days, setDays] = useState('0.25'), [expires, setExpires] = useState(''), [note, setNote] = useState(''), [confirmed, setConfirmed] = useState(false)
  const [id] = useState(() => crypto.randomUUID()), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  const units = rows.reduce((sum, row) => sum + row.remainingUnits, 0), used = Number(days) * 960
  const valid = confirmed && note.trim() && (mode === 'cash' ? Number(rate) > 0 && Number(rate) <= 10000000 && /^\d+(\.\d{1,2})?$/.test(rate) && /^\d{4}-\d{2}$/.test(month) : policyReady && Number(days) > 0 && Number(days) * 4 % 1 === 0 && used <= units && expires)
  async function submit() {
    setBusy(true); setError(null)
    try { await save('settle', { id, ids: rows.map(row => row.id), versions: Object.fromEntries(rows.map(row => [row.id!, row.version])), mode, rate: mode === 'cash' ? Number(rate) : null, month: mode === 'cash' ? `${month}-01` : null, days: mode === 'leave' ? Number(days) : null, expires: mode === 'leave' ? expires : null, note }); close() }
    catch (cause) { setError(cause instanceof Error ? cause.message : '정산하지 못했습니다. 입력은 유지됩니다.') }
    finally { setBusy(false) }
  }
  return <Card className="space-y-3 p-4" role="dialog" aria-label="휴일근무 보상 확정"><h3 className="font-semibold">{rows[0]?.employeeName} · 선택 {rows.length}일 보상 확정</h3>
    <p className="text-sm">선택한 미정산 보상 시간 {holidayCredit(units)} · 실제 근무시간과 구분한 값입니다.</p>
    <fieldset disabled={busy} className="space-y-3"><label className="block text-sm">보상 방식<Select aria-label="휴일 근무 보상 방식" value={mode} onChange={e => setMode(e.target.value as 'cash' | 'leave')}><option value="cash">수당 지급 예정 확정</option><option value="leave" disabled={!policyReady}>보상휴가 지급{!policyReady ? ' · 서면합의 기준 등록 필요' : ''}</option></Select></label>
      {mode === 'cash' ? <><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">확인한 통상시급 · 원<Input aria-label="휴일 근무 통상시급" type="number" min="0.01" step="0.01" value={rate} onChange={e => setRate(e.target.value)} /></label><label className="text-sm">지급 예정 월<Input aria-label="휴일 수당 지급 예정 월" type="month" value={month} onChange={e => setMonth(e.target.value)} /></label></div><p className="text-sm">지급 예정 금액 {Number(rate) > 0 ? Math.ceil(units * Number(rate) / 120).toLocaleString('ko-KR') : '—'}원 · 원 미만 올림</p><p className="text-xs text-muted-foreground">통상시급을 별도로 확인해 입력하세요. 등록만으로 실제 급여가 이체되지 않습니다. 지급 완료는 실제 지급 후 별도로 기록합니다.</p></> : <><div className="flex gap-2">{[0.25, 0.5, 1].map(value => <Button key={value} type="button" variant="outline" size="sm" onClick={() => setDays(String(value))}>{value === 0.25 ? '반반차' : value === 0.5 ? '반차' : '연차'}</Button>)}</div><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">보상휴가 지급 일수<Input aria-label="보상휴가 지급 일수" type="number" min="0.25" step="0.25" value={days} onChange={e => setDays(e.target.value)} /></label><label className="text-sm">사용기한<Input aria-label="보상휴가 사용기한" type="date" value={expires} onChange={e => setExpires(e.target.value)} /></label></div><p className="text-sm">하루 8시간 기준 · 지급 후 잔여 {holidayCredit(Math.max(0, units - used))}. 남은 시간은 미정산으로 계속 보관합니다.</p></>}
      <label className="block text-sm">확정 사유 · 필수<Textarea aria-label="휴일 보상 확정 사유" maxLength={500} value={note} onChange={e => setNote(e.target.value)} /></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />근무 확인 내역·가산 기준·중복 지급 여부를 확인했습니다.</label>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}<div className="flex gap-2"><Button type="button" disabled={!valid} onClick={() => void submit()}>{busy ? '저장 중…' : '보상 확정'}</Button><Button type="button" variant="outline" onClick={close}>닫기</Button></div>
    </fieldset>
  </Card>
}
