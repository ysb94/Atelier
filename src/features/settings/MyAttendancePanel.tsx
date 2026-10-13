import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bell, CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, List, Plus, RefreshCw, Search, Send, Settings2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea } from '@/components/ui/input'
import { WorkspaceTabOverlay } from '@/components/layout/workspace-tab-overlay'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { useRenderWatch } from '@/lib/diagnostics'
import { emptyList } from '@/lib/utils'
import { useAuth } from '@/lib/supabase/auth'
import { listMyAttendanceClocks } from '@/lib/supabase/attendance-clocks'
import { useMyClockIn } from '@/features/home/use-my-clock-in'
import { useLeaveRequests } from '@/features/operations-support/use-leave-requests'
import { useDepartmentApprovers } from '@/features/operations-support/use-department-approvers'
import { useOpsDirectory } from '@/features/operations-support/ops-directory'
import { koreanHolidayLabel, koreanHolidayNames } from '@/features/operations-support/korean-holidays'
import { monthLabel, shiftMonth } from '@/features/operations-support/monthly-attendance'
import { DEFAULT_REMINDER_BASIS, REQUEST_KINDS, approvalTypeOf, dateLabel, isFullLeave, isLeaveRequest, isLocationRequest, isPartialLeave, reminderPreview, requestLabel, validateRequest, type PersonalRequest, type RequestForm, type RequestKind } from './personal-requests'
import { attendanceMonthDates, buildMyAttendance, clockOutLabel, dayClock, koreaDateKey, validAttendanceMonth, type AttendanceClock } from './my-attendance'
import './personal-requests.css'

const STATUS_LABELS = { pending: '승인 대기', approved: '승인', rejected: '반려', cancelled: '취소' }
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']
const LAYERS = [['clock', '출퇴근'], ['leave', '휴가'], ['work', '근무'], ['fix', '정정'], ['holiday', '공휴일'], ['closed', '반려·취소']] as const
type Layer = typeof LAYERS[number][0]
const REMINDER_OPTIONS = [
  { key: 'arrival', label: '출근 전 알림', detail: '종일 휴가는 제외하고, 오전 휴가는 복귀 시각 기준으로 안내' },
  { key: 'departure', label: '퇴근 전 알림', detail: '오후 휴가와 승인된 야근 종료 시각을 반영' },
  { key: 'missing', label: '출퇴근 기록 누락', detail: '다음 날에도 남은 기록은 정정 신청으로 안내' },
  { key: 'decision', label: '신청 결과 알림', detail: '승인·반려 및 변경 결과 확인' },
] as const

function dayOfWeek(date: string) { return new Date(`${date}T12:00:00+09:00`).getUTCDay() }
function calendarCells(month: string) {
  const dates = attendanceMonthDates(month)
  const cells: (string | null)[] = [...Array.from({ length: dayOfWeek(dates[0]) }, () => null), ...dates]
  while (cells.length % 7) cells.push(null)
  return cells
}
function requestLayer(kind: RequestKind) {
  return isLeaveRequest(kind) ? 'leave' : kind === 'correction' ? 'fix' : 'work'
}
function requestTime(item: PersonalRequest) { return isFullLeave(item.kind) ? '종일' : `${item.start}–${item.end}` }
function clockText(start: string, end: string) {
  return start && end ? `${start}–${end}` : start ? `출근 ${start}` : end ? `퇴근 ${end}` : ''
}
function newForm(kind: RequestKind, day: string): RequestForm {
  return { kind, from: day, to: day, start: kind === 'overtime' ? '18:00' : '09:00', end: kind === 'half' ? '14:00' : kind === 'quarter' ? '11:00' : kind === 'overtime' ? '21:00' : '18:00', place: '', note: '' }
}

export function MyAttendancePanel() {
  useRenderWatch('MyAttendancePanel')
  const { session, profile } = useAuth()
  const userId = session?.user.id
  const allowed = Boolean(userId) && profile?.status === 'active'
  const active = useWorkspaceTabActivity()
  const today = koreaDateKey()
  const clock = useMyClockIn()
  const leave = useLeaveRequests()
  const approvals = useDepartmentApprovers()
  const directory = useOpsDirectory()
  const [month, setMonth] = useState(() => today.slice(0, 7))
  const [selected, setSelected] = useState(today)
  const [view, setView] = useState<'calendar' | 'list'>('calendar')
  const [query, setQuery] = useState('')
  const [layers, setLayers] = useState<Record<Layer, boolean>>({ clock: true, leave: true, work: true, fix: true, holiday: true, closed: false })
  const [detailId, setDetailId] = useState<string | null>(null)
  const [form, setForm] = useState<RequestForm | null>(null)
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const [basis, setBasis] = useState(DEFAULT_REMINDER_BASIS)
  const [showBasis, setShowBasis] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [reminders, setReminders] = useState({ arrival: true, departure: true, missing: true, decision: true })
  const addMenuRef = useRef<HTMLDivElement>(null)
  const clocks = useQuery({
    queryKey: ['attendance-clock-ins', userId, 'month', month, allowed],
    queryFn: () => listMyAttendanceClocks(userId!, month), enabled: allowed,
    refetchInterval: allowed && active ? 30_000 : false,
  })
  useEffect(() => { if (clocks.error) console.warn('[my-attendance] 월별 출퇴근 조회 실패', { month, error: clocks.error }) }, [month, clocks.error])
  const clockRows = allowed ? clocks.data ?? emptyList<AttendanceClock>() : emptyList<AttendanceClock>()
  const days = useMemo(() => buildMyAttendance(month, clockRows, leave.requests, today), [month, clockRows, leave.requests, today])
  const dayIndex = useMemo(() => new Map(days.map(day => [day.date, day])), [days])
  const cells = useMemo(() => calendarCells(month), [month])
  const clocksReady = allowed && !clocks.isPending && !clocks.error
  const recorded = days.filter(day => day.clockIn).length
  const completed = days.filter(day => day.clockOutAt).length
  const pending = leave.requests.filter(item => item.status === 'pending').length
  const upcoming = leave.requests.filter(item => item.status === 'approved' && item.kind !== 'correction' && item.to >= today).length
  const selectedDay = dayIndex.get(selected) ?? days[0]
  const selectedClock = dayClock(selectedDay)
  const detailed = leave.requests.find(item => item.id === detailId)
  const preview = form ? reminderPreview(form, isLeaveRequest(form.kind) ? DEFAULT_REMINDER_BASIS : basis).filter(text => (!text.startsWith('출근 기준') || reminders.arrival) && (!text.startsWith('퇴근 기준') || reminders.departure) && (!text.startsWith('퇴근 예정') || reminders.missing)) : []
  const formRecord = form?.kind === 'correction' ? dayIndex.get(form.from) : undefined

  function shownRequest(item: PersonalRequest) {
    const text = query.trim().toLowerCase()
    if (text && !`${requestLabel(item.kind)} ${item.place} ${item.note}`.toLowerCase().includes(text)) return false
    if (!layers[requestLayer(item.kind)]) return false
    return item.status === 'pending' || item.status === 'approved' || layers.closed
  }
  function approvalRoute(kind: RequestKind, departmentId = profile?.departmentId) {
    if (approvals.loading || directory.loading) return '승인 담당자 확인 중…'
    if (approvals.error || directory.error) return '승인 담당자를 불러오지 못했습니다.'
    const setting = approvals.settings.find(item => item.departmentId === departmentId && item.type === approvalTypeOf(kind))
    const names = [setting?.approverId, setting?.substituteId].filter(id => id && id !== leave.userId)
      .map(id => directory.members.find(member => member.id === id)?.displayName).filter(Boolean)
    return names.length ? `부서 지정 승인자 · ${names.join(' / ')}` : '승인자 미지정 · 운영지원에 담당자 설정을 요청해 주세요.'
  }
  function formFor(kind: RequestKind, date: string): RequestForm {
    if (kind !== 'correction') return newForm(kind, date)
    const from = date > today ? today : date
    const record = dayIndex.get(from)
    return { ...newForm(kind, from), start: record?.clockIn || '09:00', end: clockOutLabel(record?.clockOutAt ?? null) || '18:00' }
  }
  function openForm(kind: RequestKind, date = selected) { setAddOpen(false); setForm(formFor(kind, date)); setFormError(''); setNotice('') }
  function patch(patch: Partial<RequestForm>) { setForm(current => current ? { ...current, ...patch } : null); setFormError('') }
  function chooseMonth(next: string) {
    if (!validAttendanceMonth(next)) return
    setMonth(next)
    setSelected(next === today.slice(0, 7) ? today : `${next}-01`)
  }
  function pickDate(date: string) { setSelected(date); setMonth(date.slice(0, 7)) }
  function refresh() { void clocks.refetch(); void leave.refresh(); void clock.refresh() }
  function record(action: 'in' | 'out' | 'undo') {
    void (action === 'in' ? clock.clockIn() : action === 'out' ? clock.clockOut() : clock.undoClockOut()).catch(error => {
      console.warn('[my-attendance] 출퇴근 버튼 저장 실패', { action, error })
    })
  }
  useEffect(() => {
    if (!addOpen) return
    function close(event: PointerEvent) {
      if (event.target instanceof Node && addMenuRef.current?.contains(event.target)) return
      setAddOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [addOpen])
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!form || leave.busy) return
    const error = validateRequest(form, leave.requests, isLeaveRequest(form.kind) ? DEFAULT_REMINDER_BASIS : basis, today)
    if (error) { setFormError(error); return }
    try {
      const request = await leave.create.mutateAsync(form)
      setMonth(form.from.slice(0, 7)); setSelected(form.from)
      setForm(null); setDetailId(request.id)
      setNotice(form.kind === 'correction' ? '출퇴근 정정 신청을 저장했습니다. 승인되면 원래 기록은 그대로 두고 달력에 정정 시각을 표시합니다.' : '신청을 저장했습니다. 부서 지정 승인자가 승인하면 달력에 반영됩니다.')
    } catch (error) {
      console.warn('[leave-requests] 마이페이지 신청 실패', error)
      setFormError(error instanceof Error ? error.message : '신청을 저장하지 못했습니다.')
    }
  }
  async function cancel(item: PersonalRequest) {
    if (item.status !== 'pending' || leave.busy) return
    try { await leave.transition.mutateAsync({ id: item.id, status: 'cancelled' }); setNotice('신청을 취소했습니다.') }
    catch (error) { console.warn('[leave-requests] 마이페이지 취소 실패', error); setNotice(error instanceof Error ? error.message : '신청 취소에 실패했습니다.') }
  }
  function requestBar(item: PersonalRequest, date: string) {
    return <button key={item.id} type="button" className={`agenda-bar is-${requestLayer(item.kind)} is-${item.status}`} onClick={() => { pickDate(date); setDetailId(item.id) }}>{requestLabel(item.kind)}{item.status === 'approved' ? '' : ` · ${STATUS_LABELS[item.status]}`}</button>
  }

  const span = form ? isFullLeave(form.kind) || isLocationRequest(form.kind) : false
  return <div className="personal-requests">
    <div className="personal-request-draft-row">
      <div className="personal-request-draft"><strong>근태 신청 · 부서별 지정 승인자</strong><span>휴가·외근·재택·출퇴근 정정은 부서 근태 승인자가, 야근은 야근 승인자가 승인합니다. 알림은 시안이며 잔여일 자동 차감은 미적용입니다.</span></div>
      <Button type="button" variant="outline" size="sm" className="personal-request-settings-button" aria-haspopup="dialog" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(true)}><Settings2 size={14}/>알림 설정</Button>
    </div>
    {!allowed && <p role="status" className="personal-request-error">활성 직원 계정으로 로그인해 주세요.</p>}
    <div className="personal-request-overview">
      <article className="personal-attendance-today">
        <Clock3 size={17}/><span>오늘 · {today.slice(5).replace('-', '.')} ({WEEKDAYS[dayOfWeek(today)]})</span>
        <div className="personal-attendance-today-times"><span>출근<b>{clock.loading || clock.queryError ? '—' : clock.todayClock || '미기록'}</b></span><span>퇴근<b>{clock.loading || clock.queryError ? '—' : clock.todayClockOut || '미기록'}</b></span></div>
        {(clock.needsClockIn || clock.needsClockOut || clock.todayClockOut) && <div className="personal-attendance-today-actions">
          {clock.needsClockIn && <Button size="sm" disabled={clock.saving} onClick={() => record('in')}>{clock.saving ? '저장 중…' : '출근하기'}</Button>}
          {clock.needsClockOut && <Button size="sm" disabled={clock.saving} onClick={() => record('out')}>{clock.saving ? '저장 중…' : '퇴근하기'}</Button>}
          {clock.todayClockOut && <Button size="sm" variant="outline" disabled={clock.saving} onClick={() => record('undo')}>{clock.saving ? '저장 중…' : '퇴근 무르기'}</Button>}
        </div>}
      </article>
      <article><CalendarDays size={17}/><span>{monthLabel(month)} 출근 기록</span><strong>{clocksReady ? recorded : '—'}<small>일</small></strong><p>퇴근 기록 {clocksReady ? `${completed}일` : '—'}</p></article>
      <article><Check size={17}/><span>내 승인 대기</span><strong>{leave.loading ? '—' : pending}<small>건</small></strong><p>오늘 이후 승인된 일정 {leave.loading ? '—' : `${upcoming}건`}</p></article>
    </div>
    {clock.error && <p role="alert" className="personal-request-error">{clock.error}</p>}
    {clock.queryError && <p role="alert" className="personal-request-error">오늘의 출퇴근 기록을 불러오지 못했습니다. <Button variant="outline" size="sm" onClick={() => void clock.refresh()}>다시 불러오기</Button></p>}
    {clocks.error && <p role="alert" className="personal-request-error">{monthLabel(month)} 출퇴근 기록을 불러오지 못했습니다. <Button variant="outline" size="sm" onClick={() => void clocks.refetch()}>다시 불러오기</Button></p>}
    {leave.error && <p role="alert" className="personal-request-error">신청 목록을 불러오지 못했습니다. <Button variant="outline" size="sm" onClick={() => void leave.refresh()}>다시 불러오기</Button></p>}
    {notice && <p className="personal-request-notice" role="status">{notice}</p>}
    <section className="personal-request-board" aria-label="내 근태">
      <header className="personal-request-toolbar">
        <div className="personal-request-toolbar-month">
          <Button variant="ghost" size="icon" aria-label="이전 달" onClick={() => chooseMonth(shiftMonth(month, -1))}><ChevronLeft size={16}/></Button>
          <strong>{monthLabel(month)}</strong>
          <Button variant="ghost" size="icon" aria-label="다음 달" onClick={() => chooseMonth(shiftMonth(month, 1))}><ChevronRight size={16}/></Button>
        </div>
        <label className="personal-request-search"><Search size={14}/><input aria-label="신청 검색" value={query} placeholder="신청 검색" onChange={event => setQuery(event.target.value)}/></label>
        <div className="personal-request-toolbar-actions">
          <div className="personal-request-view" role="group" aria-label="내 근태 보기 방식">
            <Button variant={view === 'calendar' ? 'default' : 'outline'} size="sm" aria-pressed={view === 'calendar'} onClick={() => setView('calendar')}><CalendarDays size={14}/>달력</Button>
            <Button variant={view === 'list' ? 'default' : 'outline'} size="sm" aria-pressed={view === 'list'} onClick={() => setView('list')}><List size={14}/>목록</Button>
          </div>
          <Button type="button" variant="outline" size="sm" disabled={!allowed || clocks.isFetching || leave.busy} onClick={refresh}><RefreshCw size={14}/>새로고침</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => pickDate(today)}>오늘</Button>
          <div className="personal-request-add" ref={addMenuRef}>
            <Button type="button" size="sm" disabled={!allowed} aria-expanded={addOpen} aria-haspopup="menu" onClick={() => setAddOpen(open => !open)}><Plus size={14}/>신청</Button>
            {addOpen && <div className="personal-request-add-menu" role="menu" aria-label="신청 종류">{(['휴가', '근무', '정정'] as const).map(group => <section key={group}><h3>{group}</h3>{REQUEST_KINDS.filter(item => item.group === group).map(item => <button key={item.id} type="button" role="menuitem" onClick={() => openForm(item.id)}>{item.label}</button>)}</section>)}</div>}
          </div>
        </div>
      </header>
      <div className="personal-request-shell">
        <aside className="personal-request-side">
          <div className="personal-request-layers" aria-label="달력에 표시할 항목">
            <h3>표시 항목</h3>
            {LAYERS.map(([key, label]) => <label key={key}><input type="checkbox" checked={layers[key]} onChange={event => setLayers(current => ({ ...current, [key]: event.target.checked }))}/><i className={`is-${key}`}/>{label}</label>)}
          </div>
          <div className="personal-request-day">
            <h3>{dateLabel(selectedDay.date)} ({WEEKDAYS[dayOfWeek(selectedDay.date)]}){selectedDay.date === today ? ' · 오늘' : ''}</h3>
            {koreanHolidayNames(selectedDay.date).length > 0 && <p className="personal-request-holiday-note">{koreanHolidayLabel(koreanHolidayNames(selectedDay.date))}</p>}
            <dl className="personal-request-day-clock"><div><dt>출근</dt><dd>{clocksReady ? selectedClock.start || '—' : '…'}</dd></div><div><dt>퇴근</dt><dd>{clocksReady ? selectedClock.end || '—' : '…'}</dd></div></dl>
            {selectedDay.correction && <p className="personal-request-day-note"><b className="agenda-fix-tag">정정</b>승인된 정정 시각입니다. 원래 기록: {clockText(selectedDay.clockIn, clockOutLabel(selectedDay.clockOutAt)) || '없음'}</p>}
            <div className="personal-request-day-items">
              {selectedDay.requests.filter(shownRequest).map(item => <div key={item.id} className={detailId === item.id ? 'is-selected' : ''}><button type="button" onClick={() => setDetailId(item.id)}><strong>{requestLabel(item.kind)}</strong><span>{requestTime(item)}</span><small>{STATUS_LABELS[item.status]}</small></button>{item.status === 'pending' && <Button variant="ghost" size="sm" disabled={leave.busy} onClick={() => void cancel(item)}>신청 취소</Button>}</div>)}
              {!selectedDay.requests.some(shownRequest) && <p>{leave.loading ? '신청을 불러오는 중입니다.' : '이 날짜의 신청이 없습니다.'}</p>}
            </div>
            <div className="personal-request-day-actions">
              <Button size="sm" variant="outline" disabled={!allowed} onClick={() => openForm('annual', selectedDay.date)}>이 날짜에 신청</Button>
              {!selectedDay.future && <Button size="sm" variant="outline" disabled={!allowed} onClick={() => openForm('correction', selectedDay.date)}>출퇴근 정정</Button>}
            </div>
          </div>
          {detailed && <section className="personal-request-details" aria-label="내 신청 상세"><header><h2>{requestLabel(detailed.kind)} 신청 상세</h2><button type="button" aria-label="신청 상세 닫기" onClick={() => setDetailId(null)}><X size={17}/></button></header><dl>
            <div><dt>일정</dt><dd>{detailed.from}{detailed.to !== detailed.from ? ` – ${detailed.to}` : ''}<br/>{detailed.kind === 'correction' ? `실제 출근·퇴근 ${detailed.start}–${detailed.end}` : requestTime(detailed)}</dd></div>
            <div><dt>진행 상태</dt><dd><span className={`personal-request-status is-${detailed.status}`}>{STATUS_LABELS[detailed.status]}</span></dd></div>
            {detailed.decidedAt && <div><dt>처리자·일시</dt><dd>{detailed.decidedByName} · {new Date(detailed.decidedAt).toLocaleString('ko-KR')}</dd></div>}
            <div><dt>승인 담당</dt><dd>{approvalRoute(detailed.kind, detailed.departmentId ?? profile?.departmentId)}</dd></div>
            {detailed.place && <div><dt>장소</dt><dd>{detailed.place}</dd></div>}
            <div><dt>{detailed.kind === 'correction' || detailed.kind === 'overtime' ? '신청 사유' : '신청 메모'}</dt><dd>{detailed.note || '작성한 메모가 없습니다.'}</dd></div>
            {detailed.decisionNote && <div><dt>처리 의견</dt><dd>{detailed.decisionNote}</dd></div>}
          </dl><p className="personal-request-helper">{detailed.status === 'pending' ? '승인 전에는 달력의 출퇴근 시각과 알림이 바뀌지 않습니다.' : detailed.status === 'approved' && detailed.kind === 'correction' ? '승인된 정정 시각을 달력에 표시합니다. 원래 출퇴근 기록은 바뀌지 않습니다.' : detailed.status === 'approved' ? '승인된 일정에 맞춰 알림을 조정하는 구상입니다. 실제 발송은 연결 예정입니다.' : '취소·반려된 신청은 근무 일정에 적용하지 않습니다.'}</p></section>}
        </aside>
        {view === 'calendar' ? <div className="personal-request-month" role="group" aria-label={`${monthLabel(month)} 근태 달력`}>
          {WEEKDAYS.map((day, index) => <div key={day} aria-hidden="true" className={`personal-request-weekday${index === 0 || index === 6 ? ' is-off' : ''}`}>{day}</div>)}
          {cells.map((date, index) => {
            if (!date) return <div key={`blank-${index}`} className="agenda-day is-blank" aria-hidden="true"/>
            const day = dayIndex.get(date)!
            const holiday = koreanHolidayLabel(koreanHolidayNames(date))
            const time = dayClock(day)
            const timeText = layers.clock && clocksReady ? clockText(time.start, time.end) : ''
            const items = day.requests.filter(item => shownRequest(item) && !(layers.clock && item.id === day.correction?.id))
            const visibleItems = items.slice(0, Math.max(1, 3 - (layers.holiday && holiday ? 1 : 0) - (timeText ? 1 : 0)))
            const hidden = items.length - visibleItems.length
            return <div key={date} className={`agenda-day${holiday || index % 7 === 0 || index % 7 === 6 ? ' is-off' : ''}${date === today ? ' is-today' : ''}${selected === date ? ' is-selected' : ''}`} onClick={() => pickDate(date)}>
              <button type="button" className="agenda-num" aria-pressed={selected === date} aria-label={`${dateLabel(date)} (${WEEKDAYS[index % 7]}) ${holiday ? `${holiday} ` : ''}출근 ${time.start || '없음'} 퇴근 ${time.end || '없음'}${time.corrected ? ' 정정' : ''} 신청 ${items.length}건`} onClick={() => pickDate(date)}>{Number(date.slice(8))}</button>
              {layers.holiday && holiday && <span className="agenda-bar is-holiday">{holiday}</span>}
              {timeText && <span className={`agenda-clock${time.corrected ? ' is-corrected' : ''}`}>{timeText}{time.corrected && <b className="agenda-fix-tag">정정</b>}</span>}
              {visibleItems.map(item => requestBar(item, date))}
              {hidden > 0 && <button type="button" className="agenda-more" onClick={() => pickDate(date)}>+{hidden}개</button>}
            </div>
          })}
        </div> : <div className="personal-request-list"><table><caption className="sr-only">{monthLabel(month)} 내 출퇴근과 신청</caption><thead><tr><th scope="col">날짜</th><th scope="col">출근</th><th scope="col">퇴근</th><th scope="col">신청</th></tr></thead><tbody>
          {days.map(day => {
            const holiday = koreanHolidayLabel(koreanHolidayNames(day.date))
            const time = dayClock(day)
            const items = day.requests.filter(shownRequest)
            return <tr key={day.date} className={day.date === selected ? 'is-selected' : ''}>
              <th scope="row" className={holiday || [0, 6].includes(dayOfWeek(day.date)) ? 'is-off' : ''}><button type="button" onClick={() => setSelected(day.date)}>{day.date.slice(5).replace('-', '.')} ({WEEKDAYS[dayOfWeek(day.date)]}){day.date === today ? ' · 오늘' : ''}</button>{holiday && <small>{holiday}</small>}</th>
              <td>{clocksReady ? time.start || '—' : '…'}{time.corrected && <b className="agenda-fix-tag">정정</b>}</td>
              <td>{clocksReady ? time.end || '—' : '…'}</td>
              <td>{items.length ? items.map(item => requestBar(item, day.date)) : '—'}</td>
            </tr>
          })}
        </tbody></table></div>}
      </div>
      <p className="personal-request-footnote">출퇴근은 기록된 시각을, 승인된 출퇴근 정정은 정정 시각을 표시합니다. 원래 출퇴근 기록은 바뀌지 않으며, 미기록만으로 결근이나 연차 사용을 판단하지 않습니다.</p>
    </section>
    {settingsOpen && <WorkspaceTabOverlay><RequestDialog className="is-settings" labelledBy="personal-reminder-title" onClose={() => setSettingsOpen(false)}><section className="personal-request-reminders personal-request-settings-card" aria-label="내 근태 알림 설정"><header><div><Bell size={16}/><h2 id="personal-reminder-title">내 근태 알림</h2></div><button type="button" aria-label="알림 설정 닫기" onClick={() => setSettingsOpen(false)}><X size={17}/></button></header><p>승인된 휴가·외근·재택·야근 일정을 반영해 알려드립니다. 발송 연결 예정입니다.</p><div className="personal-request-reminder-list">{REMINDER_OPTIONS.map(item => <label key={item.key}><span><strong>{item.label}</strong><small>{item.detail}</small></span><input type="checkbox" checked={reminders[item.key]} onChange={event => setReminders(current => ({ ...current, [item.key]: event.target.checked }))}/></label>)}</div><div className="personal-request-reminder-time"><label htmlFor="personal-reminder-before">미리 알릴 시간</label><Select id="personal-reminder-before" value={basis.before} onChange={event => setBasis(current => ({ ...current, before: Number(event.target.value) }))}>{[5, 10, 15, 30].map(value => <option key={value} value={value}>{value}분 전</option>)}</Select></div></section></RequestDialog></WorkspaceTabOverlay>}
    {form && <WorkspaceTabOverlay><RequestDialog onClose={() => { if (!leave.busy) setForm(null) }}><section className="personal-request-compose"><header><div><span>개인 근태 신청</span><h2 id="personal-request-title">{requestLabel(form.kind)} 신청</h2></div><button type="button" aria-label="신청 작성 닫기" disabled={leave.busy} onClick={() => setForm(null)}><X size={19}/></button></header><form onSubmit={event => void submit(event)}><fieldset disabled={leave.busy} className="min-w-0 border-0 p-0">
      <div className="personal-request-compose-body">
        <label>신청 종류<Select autoFocus aria-label="개인 신청 종류" value={form.kind} onChange={event => { setForm(formFor(event.target.value as RequestKind, form.from)); setFormError('') }}>{REQUEST_KINDS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</Select></label>
        <div className="personal-request-fields">
          <label>{span ? '시작일' : '신청일'}<Input aria-label="개인 신청 시작일" type="date" max={form.kind === 'correction' ? today : undefined} value={form.from} onChange={event => patch({ from: event.target.value, to: !span ? event.target.value : form.to < event.target.value ? event.target.value : form.to })}/></label>
          {span && <label>종료일<Input aria-label="개인 신청 종료일" type="date" min={form.from} value={form.to} onChange={event => patch({ to: event.target.value })}/></label>}
        </div>
        {isPartialLeave(form.kind) && <div className="personal-request-duration"><strong>{form.kind === 'half' ? '반차 · 0.5일' : '반반차 · 0.25일'}</strong><span>신청 기준: 1일 8시간, 휴게시간 12–13시 제외. 반차 4시간·반반차 2시간이며 잔여일 자동 차감은 미적용입니다.</span>{form.kind === 'half' && <div><Button size="sm" variant="outline" type="button" onClick={() => patch({ start: '09:00', end: '14:00' })}>오전 예시 09–14시</Button><Button size="sm" variant="outline" type="button" onClick={() => patch({ start: '14:00', end: '18:00' })}>오후 예시 14–18시</Button></div>}</div>}
        {!isFullLeave(form.kind) && <div className="personal-request-fields"><label>{form.kind === 'correction' ? '실제 출근 시각' : isLocationRequest(form.kind) ? '매일 시작 시각' : '시작 시각'}<Input aria-label="개인 신청 시작 시각" type="time" value={form.start} onChange={event => patch({ start: event.target.value })}/></label><label>{form.kind === 'correction' ? '실제 퇴근 시각' : isLocationRequest(form.kind) ? '매일 종료 시각' : '종료 시각'}<Input aria-label="개인 신청 종료 시각" type="time" value={form.end} onChange={event => patch({ end: event.target.value })}/></label></div>}
        {form.kind === 'correction' && <p className="personal-request-helper">{formRecord ? `현재 기록 · 출근 ${formRecord.clockIn || '없음'} · 퇴근 ${clockOutLabel(formRecord.clockOutAt) || '없음'}. ` : ''}승인되면 원래 기록은 그대로 두고 달력에 정정 시각을 ‘정정’으로 표시합니다.</p>}
        {isLocationRequest(form.kind) && <label>{form.kind === 'offsite' ? '외근 장소 · 필수' : '근무 장소 · 선택'}<Input aria-label="개인 신청 근무 장소" maxLength={200} value={form.place} placeholder={form.kind === 'offsite' ? '방문할 거래처 또는 장소' : '재택 등'} onChange={event => patch({ place: event.target.value })}/></label>}
        <label>{form.kind === 'correction' || form.kind === 'overtime' ? '신청 사유 · 필수' : '업무 인수인계·메모 · 선택'}<Textarea maxLength={2000} aria-label="개인 신청 메모" value={form.note} rows={3} placeholder={form.kind === 'correction' ? '기록 누락·보정 사유를 적어 주세요.' : form.kind === 'overtime' ? '예정된 야근 업무를 적어 주세요.' : '업무 인수인계 등 필요한 내용만 적어 주세요.'} onChange={event => patch({ note: event.target.value })}/></label>
        <div className="personal-request-approval-route"><span>승인 경로</span><strong>{approvalRoute(form.kind)}</strong><p>신청자의 화면에서는 본인 신청을 승인할 수 없습니다.</p></div>
        <div className="personal-request-alert-preview"><header><strong><Bell size={14}/>승인 후 알림 미리보기</strong><button type="button" aria-expanded={showBasis} onClick={() => setShowBasis(value => !value)}>예시 기준 {showBasis ? '접기' : '보기'}</button></header>{preview.map(text => <p key={text}>{text}</p>)}{(!reminders.arrival || !reminders.departure) && <p>{!reminders.arrival ? '출근' : ''}{!reminders.arrival && !reminders.departure ? '·' : ''}{!reminders.departure ? '퇴근' : ''} 전 알림은 내 설정에서 꺼져 있습니다.</p>}<small>회사 근무 기준은 미연결입니다. 알림 시간은 예시이며 실제 발송되지 않습니다.</small>{showBasis && <div className="personal-request-basis">{([{ key: 'start', label: '예시 출근' }, { key: 'end', label: '예시 퇴근' }, { key: 'breakStart', label: '휴게 시작' }, { key: 'breakEnd', label: '휴게 종료' }] as const).map(item => <label key={item.key}>{item.label}<Input type="time" aria-label={item.label} value={basis[item.key]} onChange={event => setBasis(current => ({ ...current, [item.key]: event.target.value }))}/></label>)}</div>}</div>
        {isFullLeave(form.kind) && <p className="personal-request-helper">승인 결과는 내 신청에서 확인할 수 있습니다. 잔여일 차감은 아직 적용되지 않습니다.</p>}
        {formError && <p role="alert" className="personal-request-error">{formError}</p>}
      </div>
      <footer><Button type="button" variant="outline" onClick={() => setForm(null)}>닫기</Button><Button type="submit" disabled={leave.busy || leave.loading || Boolean(leave.error)}><Send size={14}/>{leave.busy ? '저장 중…' : '신청하기'}</Button></footer>
    </fieldset></form></section></RequestDialog></WorkspaceTabOverlay>}
  </div>
}

function RequestDialog({ children, onClose, className = '', labelledBy = 'personal-request-title' }: { children: ReactNode; onClose: () => void; className?: string; labelledBy?: string }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => { if (dialog?.open) dialog.close() }
  }, [])
  return <dialog ref={ref} aria-labelledby={labelledBy} className={`personal-request-overlay ${className}`} onCancel={event => { event.preventDefault(); onClose() }} onClick={event => { if (event.target === event.currentTarget) onClose() }}>{children}</dialog>
}
