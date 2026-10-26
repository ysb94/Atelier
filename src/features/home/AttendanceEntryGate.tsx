import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useRenderWatch } from '@/lib/diagnostics'
import { clockOutLabel, koreaDateKey } from '@/features/settings/my-attendance'
import { RequestTimeField } from '@/features/settings/RequestTimeFields'
import { useAttendanceEntry } from './attendance-entry-context'
import { validatePreviousClockOut, workInstant } from './attendance-guidance'
import './attendance-entry.css'

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
    if (!dirty && entry.suggestion != null) { setDate(koreaDateKey(new Date(entry.suggestion))); setTime(clockOutLabel(new Date(entry.suggestion).toISOString())) }
  }, [dirty, entry.suggestion])
  const instant = workInstant(date, time)
  const validation = validatePreviousClockOut(previous, current, instant)
  async function submit(event: FormEvent) {
    event.preventDefault(); setError('')
    if (validation || instant == null) { setError(validation); return }
    if (koreaDateKey() !== current.date) { setError('날짜가 바뀌었습니다. 다시 조회해 주세요.'); entry.refresh(); return }
    try { await entry.confirmPrevious({ workDate: previous.date, value: new Date(instant).toISOString() }) }
    catch (caught) { console.warn('[attendance-entry] 직전 퇴근 확인 실패', caught); setError(caught instanceof Error ? caught.message : '퇴근을 확인하지 못했습니다.'); entry.refresh() }
  }
  return <form className="mx-auto grid w-full max-w-md gap-4" onSubmit={event => void submit(event)}>
    <div className="text-center"><h1 className="text-lg font-semibold">직전 근무일 퇴근 확인</h1><p className="mt-1 text-sm text-muted-foreground">근무일 {previous.date} · 출근 {previous.clockIn}</p></div>
    <Button type="submit" aria-label="확인하고 입장" className="attendance-entry-circle" disabled={entry.confirming || Boolean(validation)}>
      <small>{date} 퇴근</small><strong>{time || '시간 선택'}</strong><span>{entry.confirming ? '저장 중…' : '확인하고 입장'}</span>
    </Button>
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <p className="mb-3 text-center text-sm font-medium">실제 퇴근시간이 맞나요?</p>
      <p className="mb-3 text-xs text-muted-foreground">{entry.suggestion == null ? entry.basisLoading ? '예정시간을 확인 중입니다. 실제 시간을 직접 입력해도 됩니다.' : '예정시간을 계산할 수 없습니다. 실제 퇴근시간을 입력해 주세요.' : `예정 ${koreaDateKey(new Date(entry.suggestion))} ${clockOutLabel(new Date(entry.suggestion).toISOString())} · 참고값이며 실제와 다르면 수정해 주세요.`}</p>
      <fieldset disabled={entry.confirming} className="grid min-w-0 gap-3 border-0 p-0">
        <label className="text-xs text-muted-foreground">퇴근 날짜<Input aria-label="직전 근무일 퇴근 날짜" type="date" min={previous.date} max={current.date} value={date} onChange={event => { setDirty(true); setDate(event.target.value); setError('') }} /></label>
        <RequestTimeField label="직전 근무일 퇴근 시각" value={time} onChange={value => { setDirty(true); setTime(value); setError('') }} />
      </fieldset>
      <p className="mt-3 text-xs text-muted-foreground">입력 가능: {previous.date} {previous.clockIn} ~ {current.date} {current.clockIn}. 오늘 출근은 이미 {current.clockIn}에 기록됐습니다.</p>
      <p className="mt-2 text-xs text-muted-foreground">확인한 시간은 ‘본인 확인 입력’으로 구분해 남깁니다.</p>
      {entry.basisError && <p className="mt-2 text-xs text-danger">예정시간 조회에 실패했습니다. 직접 입력하거나 <button type="button" className="underline" onClick={() => void entry.retryBasis()}>다시 조회</button>해 주세요.</p>}
      {(error || (time && validation)) && <p role="alert" className="mt-2 text-sm text-danger">{error || validation}</p>}
    </div>
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

function DepartureReminder() {
  const entry = useAttendanceEntry()!
  const [shown, setShown] = useState<string | null>(null)
  const seen = useRef(new Set<string>())
  const key = entry.schedule.end == null ? '' : `atelier:clock-out-reminder:${entry.userId}:${entry.today}:${entry.schedule.end}`
  const due = entry.phase === 'ready' && entry.clock.needsClockOut && !entry.scheduleUnavailable && !entry.schedule.fullLeave && entry.schedule.end != null && entry.now.getTime() >= entry.schedule.end + 10 * 60_000
  useEffect(() => {
    if (!due || !key) { setShown(null); return }
    if (seen.current.has(key)) return
    seen.current.add(key)
    try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1') }
    catch (error) { console.warn('[attendance-entry] 퇴근 안내 확인 상태 저장 실패', error) }
    setShown(key)
  }, [due, key])
  useEffect(() => { const receive = (event: StorageEvent) => { if (event.key === key && event.newValue) setShown(null) }; window.addEventListener('storage', receive); return () => window.removeEventListener('storage', receive) }, [key])
  if (!due || shown !== key) return null
  return <aside role="status" aria-label="퇴근 기록 안내" className="fixed right-4 top-14 z-40 w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-border bg-card p-4 shadow-sm">
    <p className="mb-3 text-sm">퇴근 예정시간이 지났습니다. 아직 근무 중인가요?</p><div className="flex gap-2"><Button size="sm" onClick={() => { setShown(null); entry.requestCheckout() }}>퇴근하기</Button><Button size="sm" variant="outline" onClick={() => setShown(null)}>아직 근무 중</Button></div>
  </aside>
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
    {entry?.phase === 'ready' && <><DepartureReminder />{entry.checkoutOpen && <CheckoutConfirmation key={entry.identity} />}</>}
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
