import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { useAuth } from '@/lib/supabase/auth'
import { changeHolidayWork } from '@/lib/supabase/holiday-work'
import { offsiteSettlementPreview } from '@/lib/supabase/offsite-settlements'
import type { LeaveRequest } from '@/lib/supabase/leave-requests'
import { koreaDateKey } from '@/features/settings/my-attendance'
import { holidayCredit, holidayPhase, type HolidayWork } from './holiday-work'
import { isWorkday } from './monthly-attendance'
import { offsitePhase } from './offsite-period'
import { durationInputMinutes, formatDurationClock, workDurationLabel } from './overtime-hours'

const MODES = [
  { value: 'leave', label: '휴가로 지급' },
  { value: 'time', label: '시간으로 정산' },
  { value: 'later', label: '나중에 처리' },
] as const

function validDays(days: number) {
  return days > 0 && days <= 365 && Number.isInteger(days * 4)
}

export function HolidayOffsiteSettlementDialog({ request, rows, active, loading, error, refresh, policyReady, close }: {
  request: LeaveRequest; rows: HolidayWork[]; active: boolean; loading: boolean
  error: Error | null; refresh: () => Promise<unknown>; policyReady: boolean; close: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const { profile } = useAuth()
  const cache = useQueryClient()
  const ended = offsitePhase(request, Date.now()) === 'ended'
  const preview = useQuery({
    queryKey: ['offsite-settlement-preview', profile?.id, request.id],
    queryFn: () => offsiteSettlementPreview(request.id),
    enabled: active && ended,
    retry: false,
  })
  const [mode, setMode] = useState<(typeof MODES)[number]['value'] | null>(null)
  const [minutes, setMinutes] = useState<Record<string, string>>({})
  const [rate, setRate] = useState('')
  const [paymentMonth, setPaymentMonth] = useState(() => koreaDateKey().slice(0, 7))
  const [weekdayDays, setWeekdayDays] = useState('0.25')
  const [holidayDays, setHolidayDays] = useState('0.25')
  const [expires, setExpires] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [weekdaySavedMode, setWeekdaySavedMode] = useState<'leave' | 'time' | null>(null)
  const submitting = useRef(false)
  const [settlementId] = useState(() => crypto.randomUUID())

  useEffect(() => {
    const element = dialog.current
    if (active && element && !element.open) element.showModal()
    return () => { if (element?.open) element.close() }
  }, [active])

  const weekdayDates = preview.data?.dates.filter(row => isWorkday(row.date, {})) ?? []
  const weekdayDone = Boolean(weekdaySavedMode || preview.data?.settlement)
  const weekdays = weekdayDone ? [] : weekdayDates.filter(row => (row.minutes ?? 0) > 0)
  const weekdayMissing = !weekdayDone && weekdayDates.some(row => row.minutes == null)
  const weekdayInput = weekdays.map(row => {
    const value = minutes[row.date] ?? formatDurationClock(row.minutes!)
    return { ...row, value, actual: value.trim() ? durationInputMinutes(value) : 0 }
  })
  const weekdayValid = weekdayInput.every(row => row.actual != null && row.actual <= row.minutes!)
  const weekdayTotal = weekdayInput.reduce((sum, row) => sum + (row.actual ?? 0), 0)
  const holidaySaved = rows.some(row => row.settlements.some(item => item.id === settlementId))
  const holidays = holidaySaved ? [] : rows.filter(row => row.canSettle && row.id && row.remainingUnits > 0 && !row.legacySettled)
  const holidayUnits = holidays.reduce((sum, row) => sum + row.remainingUnits, 0)
  const latestMonth = holidays.reduce((month, row) => row.date.slice(0, 7) > month ? row.date.slice(0, 7) : month, '')
  const today = koreaDateKey()
  const loadError = error || preview.error
  const ready = active && ended && !loading && !loadError && Boolean(preview.data)
  const hasSettlement = weekdays.length > 0 || holidays.length > 0
  const needsLeaveDates = mode === 'leave' && (weekdayTotal > 0 || holidays.length > 0)
  const detailsValid = mode === 'leave'
    ? policyReady && (!needsLeaveDates || expires >= today)
      && (weekdayTotal === 0 || validDays(Number(weekdayDays)))
      && (holidays.length === 0 || (validDays(Number(holidayDays)) && Number(holidayDays) * 960 <= holidayUnits))
    : holidays.length === 0 || (/^\d+(\.\d{1,2})?$/.test(rate) && Number(rate) > 0 && Number(rate) <= 10000000
      && /^\d{4}-(0[1-9]|1[0-2])$/.test(paymentMonth) && paymentMonth >= latestMonth)
  const canSave = mode === 'later' || (mode !== null && ready && hasSettlement && !weekdayMissing
    && weekdayValid && holidays.length <= 100 && detailsValid && Boolean(note.trim()))

  async function submit() {
    if (!mode || !canSave || submitting.current) return
    if (mode === 'later') { close(); return }
    submitting.current = true
    setBusy(true)
    setMessage('')
    let savedWeekdays = weekdayDone
    let complete = false
    try {
      if (weekdays.length > 0) {
        const weekdayMode = weekdayTotal === 0 ? 'none' : mode === 'leave' ? 'leave' : 'overtime'
        await changeHolidayWork('offsite-settle', {
          requestId: request.id, mode: weekdayMode,
          minutes: weekdayTotal ? Object.fromEntries(weekdayInput.map(row => [row.date, row.actual])) : {},
          days: weekdayMode === 'leave' ? Number(weekdayDays) : null,
          expires: weekdayMode === 'leave' ? expires : null, note: note.trim(),
        })
        savedWeekdays = true
        setWeekdaySavedMode(mode)
      }
      if (holidays.length > 0) {
        await changeHolidayWork('settle', {
          id: settlementId, ids: holidays.map(row => row.id), versions: Object.fromEntries(holidays.map(row => [row.id, row.version])),
          mode: mode === 'leave' ? 'leave' : 'cash',
          rate: mode === 'time' ? Number(rate) : null, month: mode === 'time' ? `${paymentMonth}-01` : null,
          days: mode === 'leave' ? Number(holidayDays) : null, expires: mode === 'leave' ? expires : null, note: note.trim(),
        })
      }
      complete = true
    } catch (cause) {
      console.warn('[offsite-settlement] 외근 건 후처리 저장 실패', cause)
      const detail = cause instanceof Error ? cause.message : '잠시 후 다시 시도해 주세요.'
      setMessage(`${savedWeekdays && holidays.length ? '평일 기록은 저장됐습니다. 남은 휴일 정산을 다시 시도해 주세요. ' : ''}${detail}`)
    } finally {
      await Promise.allSettled(['offsite-settlement-preview', 'offsite-settlements', 'holiday-work', 'overtime-actuals', 'my-home-work-notices',
        'employee-extra-leave', 'employee-roster', 'employee-leave-advances', 'my-extra-leave', 'my-attendance-basis', 'leave-notice-management']
        .map(key => cache.invalidateQueries({ queryKey: [key] })))
      submitting.current = false
      setBusy(false)
      if (complete) close()
    }
  }

  return <dialog ref={dialog} aria-label="외근 건 전체 후처리" onCancel={event => {
    event.preventDefault()
    if (!submitting.current) close()
  }} className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl overflow-auto rounded-xl border border-border bg-card p-5 text-card-foreground shadow-lg backdrop:bg-black/40">
    <div className="space-y-4">
      <header><h3 className="text-base font-semibold">{request.employeeName} · 외근 후처리</h3><p className="text-sm text-muted-foreground">{request.from}{request.from !== request.to && ` ~ ${request.to}`}</p></header>
      {!ended && <p className="text-sm">승인되고 종료된 외근부터 정산할 수 있습니다.</p>}
      {ended && (loading || preview.isPending) && <p role="status" className="text-sm">외근 근무 기록을 불러오는 중입니다.</p>}
      {loadError && <div role="alert" className="text-sm text-danger">근무 기록을 불러오지 못했습니다. <Button variant="outline" size="sm" onClick={() => void Promise.all([refresh(), preview.refetch()])}>다시 조회</Button></div>}
      {rows.length > 0 && <ul aria-label="주말·공휴일 보상 시간" className="space-y-2 rounded-lg border border-border p-3 text-sm">
        {rows.map(row => <li key={row.date} className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span>{row.date}</span>
          {row.actualMinutes != null && row.creditUnits != null
            ? <span>실제 {holidayCredit(row.actualMinutes * 2)}{row.creditUnits === row.actualMinutes * 3 ? ' × 1.5' : ''} → <strong>보상 {holidayCredit(row.creditUnits)}</strong></span>
            : <span>{holidayPhase(row)}</span>}
          {row.actualMinutes != null && <small className="w-full text-right text-muted-foreground">{holidayPhase(row)}{row.remainingUnits > 0 && row.remainingUnits !== row.creditUnits && ` · 남은 보상 ${holidayCredit(row.remainingUnits)}`}</small>}
        </li>)}
      </ul>}
      {ready && !hasSettlement && <p className="text-sm text-muted-foreground">{holidaySaved ? '이 팝업에서 휴일 정산을 저장했습니다.' : '현재 확정할 수 있는 추가 근무나 휴일 보상이 없습니다.'}</p>}
      {weekdayDone && <p className="text-sm text-muted-foreground">평일 추가 근무 처리 완료</p>}
      {weekdayMissing && <p role="alert" className="text-sm text-danger">평일 근무 기준을 먼저 확인해 주세요.</p>}
      {holidays.length > 100 && <p role="alert" className="text-sm text-danger">휴일 기록이 100건을 넘습니다. 아래 근무 목록에서 날짜를 나눠 정산해 주세요.</p>}
      <fieldset disabled={busy} className="space-y-4">
        <legend className="mb-2 text-sm font-medium">처리 방식</legend>
        <div className="grid grid-cols-3 gap-2">{MODES.map(item => <Button key={item.value} type="button" size="sm"
          variant={mode === item.value ? 'default' : 'outline'} aria-pressed={mode === item.value}
          disabled={item.value !== 'later' && (!ready || !hasSettlement || weekdayMissing || (item.value === 'leave' && !policyReady) || (weekdaySavedMode !== null && item.value !== weekdaySavedMode))}
          onClick={() => { setMode(item.value); setMessage('') }}>{item.label}</Button>)}</div>
        {ready && hasSettlement && !policyReady && <p className="text-xs text-muted-foreground">휴가로 지급하려면 서면합의 기준을 등록해야 합니다.</p>}
        {mode === 'later' && <p className="text-sm text-muted-foreground">대기 목록에 남겨 두고 팝업을 닫습니다.</p>}
        {(mode === 'time' || mode === 'leave') && <>
          {weekdays.length > 0 && <div className="space-y-2">
            <h4 className="text-sm font-medium">평일 추가근무 · {mode === 'time' ? '야근 누적' : '휴가 지급'}</h4>
            {weekdayInput.map(row => <label key={row.date} className="flex items-center justify-between gap-2 text-sm">
              <span>{row.date} · 예상 {workDurationLabel(row.minutes!)}</span>
              <Input className="w-24" aria-label={`${row.date} 실제 추가 근무 시:분`} inputMode="numeric" placeholder="0:00"
                value={row.value} onChange={event => setMinutes(current => ({ ...current, [row.date]: event.target.value }))} />
            </label>)}
            {!weekdayValid && <p className="text-xs text-danger">예상 시간을 넘지 않도록 실제 추가근무를 시:분으로 입력해 주세요.</p>}
          </div>}
          {mode === 'time' && holidays.length > 0 && <div className="space-y-2">
            <h4 className="text-sm font-medium">주말·공휴일 수당 · 미정산 {holidayCredit(holidayUnits)}</h4>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm">통상시급 · 원<Input type="number" min="0.01" max="10000000" step="0.01" value={rate} onChange={event => setRate(event.target.value)} /></label>
              <label className="text-sm">지급 예정 월<Input type="month" min={latestMonth} value={paymentMonth} onChange={event => setPaymentMonth(event.target.value)} /></label>
            </div>
            {Number(rate) > 0 && <p className="text-sm">지급 예정 금액 <strong>{Math.ceil(holidayUnits * Number(rate) / 120).toLocaleString('ko-KR')}원</strong></p>}
          </div>}
          {needsLeaveDates && <div className="grid gap-3 sm:grid-cols-2">
            {weekdayTotal > 0 && <label className="text-sm">평일 휴가 일수<Input type="number" min="0.25" max="365" step="0.25" value={weekdayDays} onChange={event => setWeekdayDays(event.target.value)} /></label>}
            {holidays.length > 0 && <label className="text-sm">휴일 보상휴가 일수<Input type="number" min="0.25" max={Math.min(365, Math.floor(holidayUnits / 240) / 4)} step="0.25" value={holidayDays} onChange={event => setHolidayDays(event.target.value)} /></label>}
            <label className="text-sm">사용기한<Input type="date" min={today} value={expires} onChange={event => setExpires(event.target.value)} /></label>
          </div>}
          <label className="block text-sm">처리 사유 · 필수<Textarea maxLength={500} value={note} onChange={event => setNote(event.target.value)} /></label>
        </>}
        {message && <p role="alert" className="text-sm text-danger">{message}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={close}>닫기</Button><Button type="button" disabled={!canSave} onClick={() => void submit()}>{busy ? '저장 중…' : '저장'}</Button></div>
      </fieldset>
    </div>
  </dialog>
}
