import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { useRenderWatch } from '@/lib/diagnostics'
import { clockOutLabel, koreaDateKey } from '@/features/settings/my-attendance'
import { useAttendanceEntry } from './attendance-entry-context'
import { fitPreviousClockOut, validatePreviousClockOut, workInstant } from './attendance-guidance'
import { AttendancePresenceMonitor } from './AttendancePresenceMonitor'
import './attendance-entry.css'

function datesBetween(from: string, to: string) {
  const [year, month, day] = from.split('-').map(Number)
  const [endYear, endMonth, endDay] = to.split('-').map(Number)
  const cursor = new Date(year, month - 1, day)
  const end = new Date(endYear, endMonth - 1, endDay)
  const dates: string[] = []
  while (cursor <= end && dates.length < 8) {
    dates.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`)
    cursor.setDate(cursor.getDate() + 1)
  }
  return dates
}

type ClockBounds = { date: string; clockIn: string; clockOutAt: string | null }
type WheelOption = { value: string; label: string; date?: string; hour?: string }

function minutesOn(previous: ClockBounds, current: ClockBounds, date: string, hour: string) {
  return Array.from({ length: 60 }, (_, minute) => String(minute).padStart(2, '0'))
    .filter(minute => !validatePreviousClockOut(previous, current, workInstant(date, `${hour}:${minute}`)))
}

function hourSlots(previous: ClockBounds, current: ClockBounds): WheelOption[] {
  const slots: WheelOption[] = []
  for (const date of datesBetween(previous.date, current.date)) {
    for (let value = 0; value < 24; value += 1) {
      const hour = String(value).padStart(2, '0')
      if (!minutesOn(previous, current, date, hour).length) continue
      slots.push({
        value: `${date}T${hour}`,
        label: date === previous.date ? hour : `+${hour}`,
        date,
        hour,
      })
    }
  }
  return slots
}

function TimeWheel({ label, options, value, onChange }: {
  label: string
  options: WheelOption[]
  value: string
  onChange: (value: string) => void
}) {
  const wheel = useRef<HTMLDivElement>(null)
  const carry = useRef(0)
  const lockedUntil = useRef(0)
  const index = Math.max(0, options.findIndex(option => option.value === value))
  const visible = [options[index - 1], options[index], options[index + 1]]
  function step(direction: number) {
    const next = options[index + direction]
    if (next) onChange(next.value)
  }
  useEffect(() => {
    const node = wheel.current
    if (!node) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const now = Date.now()
      if (now < lockedUntil.current) return
      carry.current += event.deltaY
      if (Math.abs(carry.current) < 30) return
      const direction = carry.current > 0 ? 1 : -1
      carry.current = 0
      lockedUntil.current = now + 110
      const next = options[index + direction]
      if (next) onChange(next.value)
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [index, options, onChange])
  return <div
    ref={wheel}
    className="attendance-entry-wheel"
    role="listbox"
    aria-label={label}
    tabIndex={0}
    onKeyDown={event => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
      event.preventDefault()
      step(event.key === 'ArrowDown' ? 1 : -1)
    }}
  >
    {visible.map((option, offset) => option ? <button
      key={option.value}
      type="button"
      role="option"
      aria-selected={offset === 1}
      aria-label={option.date ? `${option.date} ${option.hour}시` : `${label} ${option.label}`}
      className={offset === 1 ? 'is-selected' : ''}
      onClick={() => { if (offset !== 1) onChange(option.value) }}
    >{option.label}</button> : <span key={offset} className="attendance-entry-wheel-spacer" aria-hidden />)}
  </div>
}

function AttendanceDialog({ label, children, onCancel }: { label: string; children: ReactNode; onCancel?: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { const dialog = ref.current; if (dialog && !dialog.open) dialog.showModal(); return () => { if (dialog?.open) dialog.close() } }, [])
  return <dialog ref={ref} aria-label={label} aria-modal="true" className="attendance-entry-dialog m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-transparent p-4 text-foreground backdrop:bg-background/75 backdrop:backdrop-blur-[2px]"
    onCancel={event => { event.preventDefault(); onCancel?.() }}>{children}</dialog>
}

function ClockInCircle() {
  const entry = useAttendanceEntry()!
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(timer) }, [])
  return <Button type="button" aria-label="출근하기" className="attendance-entry-circle" disabled={entry.clock.saving}
    onClick={() => { void entry.clock.clockIn().catch(error => console.warn('[attendance-entry] 오늘 출근 저장 실패', error)) }}>
    <small>지금 시각</small><strong>{clockOutLabel(now.toISOString())}</strong><span>{entry.clock.saving ? '기록 중…' : '출근하기'}</span>
  </Button>
}

function PreviousClockOutForm() {
  const entry = useAttendanceEntry()!
  const previous = entry.target!, current = entry.clock.todayRecord!
  const [date, setDate] = useState(previous.date), [time, setTime] = useState(''), [dirty, setDirty] = useState(false), [error, setError] = useState('')
  useEffect(() => {
    if (dirty) return
    const fitted = fitPreviousClockOut(entry.suggestion, previous, current)
    if (fitted) { setDate(fitted.date); setTime(fitted.time) }
  }, [dirty, entry.suggestion, previous, current])
  const [hour = '', minute = ''] = time.split(':')
  const slots = hourSlots(previous, current)
  const selectedSlot = slots.find(slot => slot.date === date && slot.hour === hour) ?? slots[0]
  const minutes = selectedSlot ? minutesOn(previous, current, selectedSlot.date ?? date, selectedSlot.hour ?? '') : []
  const selectedMinute = minutes.includes(minute) ? minute : minutes[0] ?? ''
  const instant = workInstant(selectedSlot?.date ?? date, selectedSlot?.hour && selectedMinute ? `${selectedSlot.hour}:${selectedMinute}` : '')
  const validation = validatePreviousClockOut(previous, current, instant)
  function choose(nextDate: string, nextHour: string, nextMinute: string) {
    setDirty(true)
    setDate(nextDate)
    setTime(nextHour && nextMinute ? `${nextHour}:${nextMinute}` : '')
    setError('')
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setError('')
    if (validation || instant == null) { setError(validation); return }
    if (koreaDateKey() !== current.date) { setError('날짜가 바뀌었습니다. 다시 조회해 주세요.'); entry.refresh(); return }
    try { await entry.confirmPrevious({ workDate: previous.date, value: new Date(instant).toISOString() }) }
    catch (caught) { console.warn('[attendance-entry] 직전 퇴근 확인 실패', caught); setError(caught instanceof Error ? caught.message : '퇴근을 확인하지 못했습니다.'); entry.refresh() }
  }
  return <form className="mx-auto grid w-full max-w-md gap-4" onSubmit={event => void submit(event)}>
    <div className="text-center"><h1 className="text-lg font-semibold">직전 근무일 퇴근 확인</h1><p className="mt-1 text-sm text-muted-foreground">근무일 {previous.date} · 출근 {previous.clockIn}</p>{previous.autoClosedAt && <p className="mt-2 text-sm text-warning">근무 확인에 연속 5회 응답이 없어 자동 퇴근·확인 필요로 처리됐습니다. 실제 퇴근 시각을 확인해 등록해 주세요. 자동 종료 시각은 실제 퇴근 시각이 아닙니다.</p>}</div>
    <div className="attendance-entry-circle attendance-entry-circle-out" onClick={event => {
      const target = event.target as HTMLElement
      if (entry.confirming || target.closest('.attendance-entry-wheel, .attendance-entry-date, .attendance-entry-confirm')) return
      event.currentTarget.closest('form')?.requestSubmit()
    }}>
      <small>{selectedSlot?.date ?? date} 퇴근{selectedSlot && selectedSlot.date !== previous.date ? ' · 출근일 다음날' : ''}</small>
      {time && selectedSlot?.hour && selectedMinute ? <div className="attendance-entry-wheels" role="group" aria-label="퇴근 시각">
        <TimeWheel label="시" options={slots} value={selectedSlot.value} onChange={next => {
          const slot = slots.find(item => item.value === next)
          if (!slot?.hour || !slot.date) return
          const nextMinutes = minutesOn(previous, current, slot.date, slot.hour)
          choose(slot.date, slot.hour, nextMinutes.includes(selectedMinute) ? selectedMinute : nextMinutes[0] ?? '')
        }} />
        <span aria-hidden>:</span>
        <TimeWheel label="분" options={minutes.map(item => ({ value: item, label: item }))} value={selectedMinute} onChange={next => choose(selectedSlot.date ?? date, selectedSlot.hour ?? '', next)} />
      </div> : <strong>{entry.basisLoading ? '확인 중' : '시간 없음'}</strong>}
      <button type="submit" className="attendance-entry-confirm" disabled={entry.confirming}>{entry.confirming ? '저장 중…' : '확인하고 입장'}</button>
    </div>
    {entry.basisError && <p className="text-center text-xs text-danger">예정시간을 불러오지 못했습니다. <button type="button" className="underline" onClick={() => void entry.retryBasis()}>다시 조회</button></p>}
    {(error || (time && validation)) && <p role="alert" className="text-center text-sm text-danger">{error || validation}</p>}
  </form>
}

function CheckoutConfirmation() {
  const entry = useAttendanceEntry()!
  const [error, setError] = useState('')
  async function save() {
    if (entry.today !== koreaDateKey()) { setError('날짜가 바뀌었습니다. 다시 조회해 주세요.'); entry.refresh(); return }
    try { await entry.clock.clockOut(); entry.closeCheckout() } catch (caught) { console.warn('[attendance-entry] 오늘 퇴근 저장 실패', caught); setError(caught instanceof Error ? caught.message : '퇴근을 기록하지 못했습니다.') }
  }
  return <AttendanceDialog label="오늘 퇴근 확인" onCancel={entry.clock.saving ? undefined : entry.closeCheckout}>
    <section className="mx-auto w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-sm">
      <h2 className="text-lg font-semibold">현재 시각으로 퇴근을 기록할까요?</h2>
      <p className="my-4 text-center text-4xl font-semibold">{clockOutLabel(entry.now.toISOString())}</p>
      <p className="text-sm text-muted-foreground">예정시간과 관계없이 저장 버튼을 누른 서버 시각으로 기록합니다.</p>
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      <div className="mt-5 flex justify-end gap-2"><Button type="button" variant="outline" disabled={entry.clock.saving} onClick={entry.closeCheckout}>취소</Button><Button type="button" disabled={entry.clock.saving} onClick={() => void save()}>{entry.clock.saving ? '저장 중…' : '퇴근 기록'}</Button></div>
    </section>
  </AttendanceDialog>
}

export function AttendanceEntryGate({ children }: { children: ReactNode }) {
  useRenderWatch('AttendanceEntryGate')
  const entry = useAttendanceEntry()
  const background = useRef<HTMLDivElement>(null)
  const blocked = Boolean(entry && (entry.phase !== 'ready' || entry.checkoutOpen))
  useEffect(() => { if (background.current) background.current.inert = blocked }, [blocked])
  return <><div ref={background} aria-hidden={blocked || undefined} className="h-full min-h-0">{children}</div>
    {entry && entry.phase !== 'ready' && <AttendanceDialog label={entry.phase === 'previous' ? '직전 근무일 퇴근 확인' : entry.phase === 'clock-in' ? '출근하기' : '출퇴근 기록 확인'}>
      <div className="my-auto w-full py-3">
        {entry.phase === 'clock-in' ? <ClockInCircle /> : entry.phase === 'previous' ? <PreviousClockOutForm key={`${entry.identity}:${entry.target?.date}`} /> : <div className="mx-auto max-w-sm rounded-xl border border-border bg-card p-6 text-center shadow-sm"><p role={entry.phase === 'error' ? 'alert' : 'status'}>{entry.phase === 'error' ? '출퇴근 기록을 확인하지 못했습니다. 다시 조회해 주세요.' : '출퇴근 기록을 확인하고 있습니다.'}</p><Button type="button" className="mt-4" variant="outline" onClick={entry.refresh}>다시 조회</Button></div>}
        {entry.clock.error && <p role="alert" className="mx-auto mt-3 max-w-md rounded-md bg-card p-3 text-sm text-danger">{entry.clock.error}</p>}
        <div className="mt-4 flex justify-center gap-3">{entry.developerSkip && <Button type="button" variant="outline" disabled={entry.clock.saving || entry.confirming} onClick={entry.skip}>개발자입니다</Button>}<Button type="button" variant="ghost" disabled={entry.clock.saving || entry.confirming} onClick={() => { void entry.signOut().catch(error => console.warn('[attendance-entry] 로그아웃 실패', error)) }}>로그아웃</Button></div>
      </div>
    </AttendanceDialog>}
    {entry?.phase === 'ready' && <><AttendancePresenceMonitor />{entry.checkoutOpen && <CheckoutConfirmation key={entry.identity} />}</>}
  </>
}

export function AttendanceStatusActions() {
  const entry = useAttendanceEntry()
  if (!entry || entry.phase !== 'ready' || entry.clock.exempt) return null
  return <div role="group" aria-label="출퇴근 상태" className="mr-2 flex items-center gap-2 text-xs">
    <span className="hidden text-muted-foreground sm:inline">{entry.clock.todayClock ? `${entry.clock.todayClock} 출근` : '출근 미기록'}</span>
    {entry.clock.todayClockOut ? <span>퇴근 {entry.clock.todayClockOut}</span> : entry.clock.needsClockOut ? <Button type="button" size="sm" disabled={entry.clock.saving} onClick={entry.requestCheckout}>퇴근하기</Button> : null}
  </div>
}
