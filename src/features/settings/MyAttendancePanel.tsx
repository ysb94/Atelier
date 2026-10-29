import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bell, CalendarDays, ChevronLeft, ChevronRight, Clock3, Search, Send, Settings2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea } from '@/components/ui/input'
import { WorkspaceTabOverlay } from '@/components/layout/workspace-tab-overlay'
import { HireDateScrollField } from '@/features/org/HireDateScrollField'
import { LeaveTimeShortcuts, QuarterLeaveTime, RequestTimeField, TimeRangeSummary } from './RequestTimeFields'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { useRenderWatch } from '@/lib/diagnostics'
import { emptyList } from '@/lib/utils'
import { useAuth } from '@/lib/supabase/auth'
import { listMyAttendanceClocks } from '@/lib/supabase/attendance-clocks'
import { useMyClockIn } from '@/features/home/use-my-clock-in'
import { useAttendanceEntry } from '@/features/home/attendance-entry-context'
import { useLeaveRequests } from '@/features/operations-support/use-leave-requests'
import { useDepartmentApprovers } from '@/features/operations-support/use-department-approvers'
import { useOpsDirectory } from '@/features/operations-support/ops-directory'
import { koreanHolidayLabel, koreanHolidayNames } from '@/features/operations-support/korean-holidays'
import { monthLabel, shiftMonth } from '@/features/operations-support/monthly-attendance'
import { DEFAULT_REMINDER_BASIS, REQUEST_KINDS, approvalTypeOf, canCancelOwnRequest, dateLabel, isAllDayRequest, isFullLeave, isLeaveRequest, isDirectRegistration, requiresDepartmentApproval, isSelfApprovedRequest, requestStatusLabel, isLocationRequest, isOfficialLeave, isPartialLeave, reminderPreview, requestLabel, validateRequest, type PersonalRequest, type RequestForm, type RequestKind } from './personal-requests'
import { uploadLeaveFile } from '@/lib/supabase/leave-requests'
import { attendanceMonthDates, buildMyAttendance, clockOutLabel, dayClock, koreaDateKey, validAttendanceMonth, type AttendanceClock } from './my-attendance'
import { readScheduleTodos, scheduleTodoError, scheduleTodoTime, type ScheduleTodo, type ScheduleTodoForm } from './personal-schedule-todos'
import { useScheduleTodos } from './use-schedule-todos'
import { listCompanyNotices } from '@/lib/supabase/company-notices'
import { visibleCompanyNotices, type CompanyNotice } from '@/lib/company/company-notices'
import './personal-requests.css'

const STATUS_LABELS = { pending: '승인 대기', approved: '승인', rejected: '반려', cancelled: '취소' }
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']
const WORKWEEK = ['월', '화', '수', '목', '금']
type Layer = 'clock' | 'leave' | 'work' | 'fix' | 'holiday' | 'closed'
const REMINDER_OPTIONS = [
  { key: 'arrival', label: '출근 전 알림', detail: '종일 휴가는 제외하고, 오전 휴가는 복귀 시각 기준으로 안내' },
  { key: 'departure', label: '퇴근 전 알림', detail: '오후 휴가와 승인된 야근 종료 시각을 반영' },
  { key: 'missing', label: '출퇴근 기록 누락', detail: '다음 날에도 남은 기록은 정정 신청으로 안내' },
  { key: 'decision', label: '신청 결과 알림', detail: '승인·반려 및 변경 결과 확인' },
] as const

function dayOfWeek(date: string) { return new Date(`${date}T12:00:00+09:00`).getUTCDay() }
function calendarCells(month: string) {
  const dates = attendanceMonthDates(month).filter(date => {
    const weekday = dayOfWeek(date)
    return weekday !== 0 && weekday !== 6
  })
  const lead = dates.length ? dayOfWeek(dates[0]) - 1 : 0
  const cells: (string | null)[] = [...Array.from({ length: lead }, () => null), ...dates]
  while (cells.length % 5) cells.push(null)
  return cells
}
function requestLayer(kind: RequestKind) {
  return isLeaveRequest(kind) ? 'leave' : kind === 'correction' ? 'fix' : 'work'
}
function requestTime(item: PersonalRequest) { return isAllDayRequest(item.kind) ? '종일' : `${item.start}–${item.end}` }
function requestSpan(item: PersonalRequest) { return item.from === item.to ? dateLabel(item.from) : `${dateLabel(item.from)}–${dateLabel(item.to)}` }
function cancelEffect(item: PersonalRequest) {
  if (isLeaveRequest(item.kind)) return '취소하면 달력과 회의 가능 시간에서 빠지고, 차감된 연차는 원래 사용 기간에 맞춰 다시 계산됩니다. 이미 만료된 기본·추가·생일 연차는 현재 남은 연차로 돌아오지 않습니다.'
  if (item.kind === 'offsite') return '취소하면 외근이 달력과 회의 가능 시간에서 빠집니다.'
  return '승인 전 신청을 취소하면 달력의 대기 표시도 함께 빠집니다.'
}
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
  const attendanceEntry = useAttendanceEntry()
  const leave = useLeaveRequests()
  const approvals = useDepartmentApprovers()
  const directory = useOpsDirectory()
  const companyNotices = useQuery({
    queryKey: ['company-notices', 'my-attendance'],
    queryFn: () => listCompanyNotices('my-attendance'),
    enabled: allowed,
  })
  useEffect(() => {
    if (companyNotices.error) console.warn('[company-notices] My Schedule 공지 조회 실패', companyNotices.error)
  }, [companyNotices.error])
  const postedNotices = visibleCompanyNotices(
    allowed ? companyNotices.data ?? emptyList<CompanyNotice>() : emptyList<CompanyNotice>(),
    today,
    profile?.departmentId ?? null,
  )
  const [month, setMonth] = useState(() => today.slice(0, 7))
  const [selected, setSelected] = useState(today)
  const [query, setQuery] = useState('')
  const layers: Record<Layer, boolean> = { clock: true, leave: true, work: true, fix: true, holiday: true, closed: false }
  const [form, setForm] = useState<RequestForm | null>(null)
  const [officialFile, setOfficialFile] = useState<File | null>(null)
  const officialFileInput = useRef<HTMLInputElement>(null)
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const [cancelTarget, setCancelTarget] = useState<PersonalRequest | null>(null)
  const [basis, setBasis] = useState(DEFAULT_REMINDER_BASIS)
  const [showBasis, setShowBasis] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [todoForm, setTodoForm] = useState<ScheduleTodoForm | null>(null)
  const [todoError, setTodoError] = useState('')
  const todoStore = useScheduleTodos(userId, profile?.companyId ?? undefined, allowed, active, month)
  const legacyTodos = useMemo(() => userId ? readScheduleTodos(userId) : emptyList<ScheduleTodo>(), [userId])
  const todos = todoStore.data ?? legacyTodos
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
    const names = [setting?.approverId, setting?.substituteId].filter(Boolean)
      .map(id => id === leave.userId ? '나 · 본인 승인 가능' : directory.members.find(member => member.id === id)?.displayName).filter(Boolean)
    return names.length ? `부서 지정 승인자 · ${names.join(' / ')}` : '승인자 미지정 · 운영지원에 담당자 설정을 요청해 주세요.'
  }
  function formFor(kind: RequestKind, date: string): RequestForm {
    if (kind !== 'correction') return newForm(kind, date)
    const from = date > today ? today : date
    const record = dayIndex.get(from)
    return { ...newForm(kind, from), start: record?.clockIn || '09:00', end: clockOutLabel(record?.clockOutAt ?? null) || '18:00' }
  }
  function openForm(kind: RequestKind, date = selected) { setAddOpen(false); setForm(formFor(kind, date)); setOfficialFile(null); setFormError(''); setNotice('') }
  function openTodo(date = selected, item?: ScheduleTodo) {
    setAddOpen(false); setTodoForm({ date, title:item?.title ?? '', start:item?.start ?? '', end:item?.end ?? '', important:item?.important ?? false, done:item?.done ?? false, id:item?.id }); setTodoError(''); setNotice('')
  }
  async function submitTodo(event: FormEvent) {
    event.preventDefault()
    if (!todoForm || todoStore.busy) return
    const problem = scheduleTodoError(todoForm)
    if (problem) { setTodoError(problem); return }
    try {
      await todoStore.change({ ...todoForm, id:todoForm.id ?? crypto.randomUUID(), title:todoForm.title.trim() },false,Boolean(todoForm.id))
      setMonth(todoForm.date.slice(0,7)); setSelected(todoForm.date); setTodoForm(null)
      setNotice(todoForm.important && !todoForm.done ? '중요 To-do를 저장했습니다. 지정한 시간은 회의 조율 시 개인 일정으로 표시됩니다.' : 'To-do를 저장했습니다. 근태·연차 기록은 변경되지 않습니다.')
    } catch (error) { console.warn('[schedule-todos] 저장 실패',error); setTodoError(error instanceof Error ? error.message : 'To-do를 저장하지 못했습니다.') }
  }
  async function removeTodo() {
    if (!todoForm?.id || todoStore.busy) return
    try { await todoStore.change({ ...todoForm,id:todoForm.id },true); setTodoForm(null); setNotice('To-do를 삭제했습니다. 회의 조율의 개인 일정 표시에서도 제외됩니다.') }
    catch(error) { console.warn('[schedule-todos] 삭제 실패',error); setTodoError(error instanceof Error ? error.message : 'To-do를 삭제하지 못했습니다.') }
  }
  function patch(patch: Partial<RequestForm>) { setForm(current => current ? { ...current, ...patch } : null); setFormError('') }
  function chooseMonth(next: string) {
    if (!validAttendanceMonth(next)) return
    setMonth(next)
    setSelected(next === today.slice(0, 7) ? today : `${next}-01`)
  }
  function pickDate(date: string) { setSelected(date); setMonth(date.slice(0, 7)) }
  function openAddMenu(date: string) { if (!allowed) return; pickDate(date); setAddOpen(true) }
  function record(action: 'in' | 'out' | 'undo') {
    if (action === 'out' && attendanceEntry) { attendanceEntry.requestCheckout(); return }
    void (action === 'in' ? clock.clockIn() : action === 'out' ? clock.clockOut() : clock.undoClockOut()).catch(error => {
      console.warn('[my-attendance] 출퇴근 버튼 저장 실패', { action, error })
    })
  }
  useEffect(() => {
    setTodoForm(null); setTodoError('')
  }, [userId])
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
      || (isOfficialLeave(form.kind) && !officialFile ? '공가 서류를 첨부해 주세요.' : '')
    if (error) { setFormError(error); return }
    let createdId: string | null = null
    try {
      const request = await leave.create.mutateAsync(form)
      createdId = request.id
      if (isOfficialLeave(form.kind) && officialFile) await uploadLeaveFile(request.id, officialFile)
      setMonth(form.from.slice(0, 7)); setSelected(form.from)
      setForm(null); setOfficialFile(null)
      setNotice(isDirectRegistration(form.kind) && request.status === 'approved' ? form.kind === 'offsite' ? '외근을 등록했습니다. 승인 없이 달력에 반영됩니다.' : '휴가를 등록했습니다. 승인 없이 달력에 반영됩니다.' : isOfficialLeave(form.kind) ? '공가 신청을 저장했습니다. 운영지원이 서류를 확인한 뒤 처리합니다.' : form.kind === 'correction' ? '출퇴근 정정 신청을 저장했습니다. 승인되면 원래 기록은 그대로 두고 달력에 정정 시각을 표시합니다.' : '신청을 저장했습니다. 부서 지정 승인자가 승인하면 달력에 반영됩니다.')
    } catch (error) {
      if (createdId && isOfficialLeave(form.kind)) {
        try { await leave.transition.mutateAsync({ id: createdId, status: 'cancelled' }) }
        catch (cleanupError) { console.warn('[leave-requests] 서류 없는 공가 신청 취소 실패', cleanupError) }
      }
      console.warn('[leave-requests] 마이페이지 신청 실패', error)
      setFormError(error instanceof Error ? error.message : '신청을 저장하지 못했습니다.')
    }
  }
  async function confirmCancel() {
    if (!cancelTarget || leave.busy) return
    const item = cancelTarget
    try {
      await leave.transition.mutateAsync({ id: item.id, status: 'cancelled' })
      setCancelTarget(null)
      setNotice(isLeaveRequest(item.kind) ? '휴가를 취소하고 연차를 사용 기간에 맞춰 다시 계산했습니다. 이미 만료된 기본·추가·생일 연차는 현재 남은 연차로 돌아오지 않습니다.' : item.kind === 'offsite' ? '외근 등록을 취소했습니다.' : '신청을 취소했습니다.')
    } catch (error) {
      console.warn('[my-attendance] 등록 취소 실패', error)
      setNotice(error instanceof Error ? error.message : '취소하지 못했습니다.')
    }
  }
  function requestBar(item: PersonalRequest, date: string) {
    return <button key={item.id} type="button" className={`agenda-bar is-${requestLayer(item.kind)} is-${item.status}`} title={`${requestLabel(item.kind)} · ${requestTime(item)}`} onClick={event => { event.stopPropagation(); pickDate(date); if (canCancelOwnRequest(item)) setCancelTarget(item) }}>{requestLabel(item.kind)}{item.status === 'approved' ? '' : ` · ${STATUS_LABELS[item.status]}`}</button>
  }

  const span = form ? isAllDayRequest(form.kind) || isLocationRequest(form.kind) : false
  return <div className="personal-requests">
    <div className="personal-request-draft-row">
      <div className="personal-request-draft"><strong>근태 신청</strong><span>연차·반차·반반차는 신청하면 바로 등록됩니다. 공가는 사유와 서류를 첨부하면 운영지원이 확인한 뒤 처리합니다. 외근도 승인 없이 바로 등록됩니다. 야근·출퇴근 정정만 부서 지정 담당자가 승인합니다.</span></div>
      <Button type="button" variant="outline" size="sm" className="personal-request-settings-button" aria-haspopup="dialog" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(true)}><Settings2 size={14}/>알림 설정</Button>
    </div>
    {postedNotices.map((item) => (
      <details key={item.id} className="mb-4 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm">
        <summary className="cursor-pointer font-medium">{item.title}</summary>
        <p className="mt-2 whitespace-pre-line text-muted-foreground">{item.body}</p>
        <p className="mt-2 text-muted-foreground">연차 부여 일수·입사일·연도 계산 기준은 보류 중입니다.</p>
      </details>
    ))}
    {!allowed && <p role="status" className="personal-request-error">활성 직원 계정으로 로그인해 주세요.</p>}
    <div className="personal-request-overview">
      <article className="personal-attendance-today">
        <Clock3 size={17}/><span>오늘 · {today.slice(5).replace('-', '.')} ({WEEKDAYS[dayOfWeek(today)]})</span>
        <div className="personal-attendance-today-times"><span>출근<b>{clock.loading || clock.queryError ? '—' : clock.todayClock || (clock.exempt ? '제외' : '미기록')}</b></span><span>퇴근<b>{clock.loading || clock.queryError ? '—' : clock.todayClockOut || (clock.exempt ? '제외' : '미기록')}</b></span></div>
        {clock.exempt ? <p className="personal-request-helper">출퇴근 제외자로 지정되어 지각·결근 관리에 포함되지 않습니다.</p> : (clock.needsClockIn || clock.needsClockOut || clock.todayClockOut) && <div className="personal-attendance-today-actions">
          {clock.needsClockIn && <Button size="sm" disabled={clock.saving} onClick={() => record('in')}>{clock.saving ? '저장 중…' : '출근하기'}</Button>}
          {clock.needsClockOut && <Button size="sm" disabled={clock.saving} onClick={() => record('out')}>{clock.saving ? '저장 중…' : '퇴근하기'}</Button>}
          {clock.todayRecord?.clockOutAt && <Button size="sm" variant="outline" disabled={clock.saving} onClick={() => record('undo')}>{clock.saving ? '저장 중…' : '퇴근 무르기'}</Button>}
        </div>}
      </article>
      <article><CalendarDays size={17}/><span>{monthLabel(month)} 출근 기록</span><strong>{clocksReady ? recorded : '—'}<small>일</small></strong><p>퇴근 기록 {clocksReady ? `${completed}일` : '—'}</p></article>
    </div>
    {clock.error && <p role="alert" className="personal-request-error">{clock.error}</p>}
    {clock.queryError && <p role="alert" className="personal-request-error">오늘의 출퇴근 기록을 불러오지 못했습니다. <Button variant="outline" size="sm" onClick={() => void clock.refresh()}>다시 불러오기</Button></p>}
    {clocks.error && <p role="alert" className="personal-request-error">{monthLabel(month)} 출퇴근 기록을 불러오지 못했습니다. <Button variant="outline" size="sm" onClick={() => void clocks.refetch()}>다시 불러오기</Button></p>}
    {leave.error && <p role="alert" className="personal-request-error">신청 목록을 불러오지 못했습니다. <Button variant="outline" size="sm" onClick={() => void leave.refresh()}>다시 불러오기</Button></p>}
    {notice && <p className="personal-request-notice" role="status">{notice}</p>}
    {todoStore.readOnly && <p className="personal-request-helper">화면 미리보기에서는 실제 To-do를 저장하거나 회의 일정을 변경하지 않습니다.</p>}
    {todoStore.error && <p role="alert" className="personal-request-error">To-do를 공용 저장소에서 불러오지 못했습니다. 마지막으로 확인한 내용을 표시하며 기존 브라우저 기록도 삭제하지 않았습니다. {todoStore.error.message} <Button variant="outline" size="sm" onClick={()=>void todoStore.refetch()}>다시 불러오기</Button></p>}
    <section className="personal-request-board" aria-label="My Schedule">
      <header className="personal-request-toolbar">
        <div className="personal-request-toolbar-month">
          <Button variant="ghost" size="icon" aria-label="이전 달" onClick={() => chooseMonth(shiftMonth(month, -1))}><ChevronLeft size={16}/></Button>
          <strong>{monthLabel(month)}</strong>
          <Button variant="ghost" size="icon" aria-label="다음 달" onClick={() => chooseMonth(shiftMonth(month, 1))}><ChevronRight size={16}/></Button>
        </div>
        <label className="personal-request-search"><Search size={14}/><input aria-label="신청 검색" value={query} placeholder="신청 검색" onChange={event => setQuery(event.target.value)}/></label>
        <div className="personal-request-toolbar-actions">
          <Button type="button" variant="outline" size="sm" onClick={() => pickDate(today)}>오늘</Button>
          <div className="personal-request-add" ref={addMenuRef}>
            <Button type="button" size="sm" disabled={!allowed} aria-expanded={addOpen} aria-haspopup="menu" onClick={() => setAddOpen(open => !open)}>+추가</Button>
            {addOpen && <div className="personal-request-add-menu" role="menu" aria-label="신청 종류">{(['휴가', '근무'] as const).map(group => {
              const items = REQUEST_KINDS.filter(item => item.group === group && item.id !== 'overtime')
              if (!items.length) return null
              return <section key={group}><h3>{group}</h3>{items.map(item => <button key={item.id} type="button" role="menuitem" onClick={() => openForm(item.id)}>{item.label}</button>)}</section>
            })}<section><h3>할 일</h3><button type="button" role="menuitem" onClick={() => openTodo()}>Todo</button></section></div>}
          </div>
        </div>
      </header>
      <div className="personal-request-shell">
        <div className="personal-request-month" role="group" aria-label={`${monthLabel(month)} 근태 달력`}>
          {WORKWEEK.map(day => <div key={day} aria-hidden="true" className="personal-request-weekday">{day}</div>)}
          {cells.map((date, index) => {
            if (!date) return <div key={`blank-${index}`} className="agenda-day is-blank" aria-hidden="true"/>
            const day = dayIndex.get(date)!
            const holiday = koreanHolidayLabel(koreanHolidayNames(date))
            const time = dayClock(day)
            const timeText = layers.clock && clocksReady ? clockText(time.start, time.end) : ''
            const items = day.requests.filter(item => shownRequest(item) && !(layers.clock && item.id === day.correction?.id))
            const text = query.trim().toLowerCase()
            const dayTodos = todos.filter(todo => todo.date === date && (!text || todo.title.toLowerCase().includes(text)))
            const slots = Math.max(1, 3 - (layers.holiday && holiday ? 1 : 0) - (timeText ? 1 : 0))
            const visibleItems = items.slice(0, dayTodos.length ? Math.max(0, slots - 1) : slots)
            const visibleTodos = dayTodos.slice(0, Math.max(0, slots - visibleItems.length))
            const hidden = items.length - visibleItems.length + dayTodos.length - visibleTodos.length
            return <div key={date} className={`agenda-day${holiday ? ' is-off' : ''}${date === today ? ' is-today' : ''}${selected === date ? ' is-selected' : ''}`} onClick={() => pickDate(date)} onDoubleClick={() => openAddMenu(date)}>
              <button type="button" className="agenda-num" aria-pressed={selected === date} aria-label={`${dateLabel(date)} (${WEEKDAYS[dayOfWeek(date)]}) ${holiday ? `${holiday} ` : ''}출근 ${time.start || '없음'} 퇴근 ${time.end || '없음'}${time.corrected ? ' 정정' : ''} 신청 ${items.length}건 Todo ${dayTodos.length}건`} onClick={() => pickDate(date)}>{Number(date.slice(8))}</button>
              {layers.holiday && holiday && <span className="agenda-bar is-holiday">{holiday}</span>}
              {timeText && <span className={`agenda-clock${time.corrected ? ' is-corrected' : ''}`}>{timeText}{time.corrected && <b className="agenda-fix-tag">정정</b>}{!time.corrected && day.clockOutReportedAt && <b className="agenda-fix-tag">본인 확인 입력</b>}</span>}
              {visibleItems.map(item => requestBar(item, date))}
              {visibleTodos.map(todo => <button key={todo.id} type="button" className={`agenda-bar is-todo${todo.important ? ' is-important' : ''}${todo.done ? ' is-done' : ''}`} title={`${todo.important ? '중요 · ' : ''}${scheduleTodoTime(todo)} · ${todo.title}`} onClick={event => { event.stopPropagation(); pickDate(date); openTodo(date,todo) }}>{todo.important ? '★ ' : ''}{todo.start ? todo.start+' ' : ''}{todo.title}</button>)}
              {hidden > 0 && <button type="button" className="agenda-more" onClick={() => pickDate(date)}>+{hidden}개</button>}
            </div>
          })}
        </div>
      </div>
      <p className="personal-request-footnote">출퇴근은 기록된 시각을, 승인된 출퇴근 정정은 정정 시각을 표시합니다. 원래 출퇴근 기록은 바뀌지 않으며, 미기록만으로 결근이나 연차 사용을 판단하지 않습니다.</p>
    </section>
    {leave.requests.some(item => item.from <= selected && selected <= item.to) && <section aria-label="선택 날짜의 근태 일정" className="mt-3 space-y-2 rounded-xl border border-border bg-card p-4"><h3 className="text-sm font-semibold">{dateLabel(selected)} 근태 일정</h3>{leave.requests.filter(item => item.from <= selected && selected <= item.to).map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3 text-sm"><div><p>{requestLabel(item.kind)} · {requestTime(item)} · {requestStatusLabel(item)}{isSelfApprovedRequest(item) ? ' · 본인 승인' : ''}</p>{item.decidedByName && <p className="mt-1 text-xs text-muted-foreground">{item.decidedByName}{item.decidedAt ? ` · ${new Date(item.decidedAt).toLocaleString('ko-KR')}` : ''}</p>}{item.decisionNote && <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{item.decisionNote}</p>}</div>{canCancelOwnRequest(item) && <Button variant="outline" size="sm" onClick={() => setCancelTarget(item)}>취소</Button>}</div>)}</section>}
    {todos.some(todo=>todo.date===selected) && <section aria-label="선택 날짜의 To-do" className="mt-3 space-y-2 rounded-xl border border-border bg-card p-4"><h3 className="text-sm font-semibold">{dateLabel(selected)} To-do</h3>{todos.filter(todo=>todo.date===selected).map(todo=><button key={todo.id} type="button" className="flex w-full items-center gap-2 rounded-md border border-border p-2 text-left text-sm" onClick={()=>openTodo(selected,todo)}><span>{todo.done ? '완료' : todo.important ? '★ 중요' : 'To-do'}</span><span className="tabular-nums text-muted-foreground">{scheduleTodoTime(todo)}</span><span className={todo.done ? 'line-through text-muted-foreground' : ''}>{todo.title}</span></button>)}</section>}
    {cancelTarget && <WorkspaceTabOverlay><RequestDialog labelledBy="personal-cancel-title" onClose={() => { if (!leave.busy) setCancelTarget(null) }}><section className="personal-request-compose"><header><div><span>본인 취소</span><h2 id="personal-cancel-title">{requestLabel(cancelTarget.kind)} 취소</h2></div><button type="button" aria-label="취소 창 닫기" disabled={leave.busy} onClick={() => setCancelTarget(null)}><X size={19}/></button></header><div className="personal-request-compose-body"><p>{requestLabel(cancelTarget.kind)} · {requestSpan(cancelTarget)} · {requestTime(cancelTarget)} · {requestStatusLabel(cancelTarget)}</p><p className="personal-request-helper">{cancelEffect(cancelTarget)}</p></div><footer><Button type="button" variant="outline" disabled={leave.busy} onClick={() => setCancelTarget(null)}>닫기</Button><Button type="button" disabled={leave.busy} onClick={() => void confirmCancel()}>{leave.busy ? '취소 중…' : '취소'}</Button></footer></section></RequestDialog></WorkspaceTabOverlay>}
    {settingsOpen && <WorkspaceTabOverlay><RequestDialog className="is-settings" labelledBy="personal-reminder-title" onClose={() => setSettingsOpen(false)}><section className="personal-request-reminders personal-request-settings-card" aria-label="My Schedule 알림 설정"><header><div><Bell size={16}/><h2 id="personal-reminder-title">My Schedule 알림</h2></div><button type="button" aria-label="알림 설정 닫기" onClick={() => setSettingsOpen(false)}><X size={17}/></button></header><p>등록된 휴가·외근과 승인된 야근 일정을 반영해 알려드립니다. 발송 연결 예정입니다.</p><div className="personal-request-reminder-list">{REMINDER_OPTIONS.map(item => <label key={item.key}><span><strong>{item.label}</strong><small>{item.detail}</small></span><input type="checkbox" checked={reminders[item.key]} onChange={event => setReminders(current => ({ ...current, [item.key]: event.target.checked }))}/></label>)}</div><div className="personal-request-reminder-time"><label htmlFor="personal-reminder-before">미리 알릴 시간</label><Select id="personal-reminder-before" value={basis.before} onChange={event => setBasis(current => ({ ...current, before: Number(event.target.value) }))}>{[5, 10, 15, 30].map(value => <option key={value} value={value}>{value}분 전</option>)}</Select></div></section></RequestDialog></WorkspaceTabOverlay>}
    {todoForm && <WorkspaceTabOverlay><RequestDialog labelledBy="personal-todo-title" onClose={() => { if(!todoStore.busy) setTodoForm(null) }}><section className="personal-request-compose"><header><div><span>개인 일정</span><h2 id="personal-todo-title">Todo</h2></div><button type="button" aria-label="Todo 작성 닫기" disabled={todoStore.busy} onClick={() => setTodoForm(null)}><X size={19}/></button></header><form onSubmit={event=>void submitTodo(event)}><fieldset disabled={todoStore.busy} className="min-w-0 border-0 p-0"><div className="personal-request-compose-body">
      <label>날짜<HireDateScrollField label="Todo 날짜" className="mt-[7px] w-full" value={todoForm.date} min="1950-01-01" max={`${Number(today.slice(0, 4)) + 5}-12-31`} clearable={false} onChange={value => { if (!value) return; setTodoForm(current => current ? { ...current, date: value } : null); setTodoError('') }}/></label>
      <label>할 일<Input autoFocus aria-label="Todo 내용" maxLength={160} value={todoForm.title} placeholder="할 일을 적어 주세요." onChange={event => { setTodoForm(current => current ? { ...current, title: event.target.value } : null); setTodoError('') }}/></label>
      <div className="personal-request-fields"><RequestTimeField label="Todo 시작 시각" value={todoForm.start} onChange={start=>setTodoForm(current=>current?{...current,start}:null)}/><RequestTimeField label="Todo 종료 시각" value={todoForm.end} onChange={end=>setTodoForm(current=>current?{...current,end}:null)}/></div>
      <Button type="button" size="sm" variant="outline" onClick={()=>setTodoForm(current=>current?{...current,start:'',end:'',important:false}:null)}>시간 지정 해제</Button>
      <label className="flex items-center gap-2"><input type="checkbox" aria-label="중요 작업으로 일정 점유" checked={todoForm.important} onChange={event=>setTodoForm(current=>current?{...current,important:event.target.checked}:null)}/>중요 작업 · 회의 조율에 개인 일정으로 표시</label>
      <label className="flex items-center gap-2"><input type="checkbox" aria-label="Todo 완료" checked={todoForm.done} onChange={event=>setTodoForm(current=>current?{...current,done:event.target.checked}:null)}/>완료</label>
      <p className="personal-request-helper">중요 작업은 시작·종료 시간이 필요합니다. 다른 직원에게는 제목 없이 개인 일정과 시간만 보입니다. 완료·삭제·중요 해제 시 일정 점유가 해제됩니다. 연차 차감이나 근태 승인은 발생하지 않습니다.</p>
      {todoError && <p role="alert" className="personal-request-error">{todoError}</p>}
    </div><footer>{todoForm.id && <Button type="button" variant="outline" onClick={()=>void removeTodo()}>삭제</Button>}<Button type="button" variant="outline" onClick={() => setTodoForm(null)}>닫기</Button><Button type="submit" disabled={!todoStore.isSuccess}>{todoStore.busy ? '저장 중…' : todoForm.id ? '저장' : '추가'}</Button></footer></fieldset></form></section></RequestDialog></WorkspaceTabOverlay>}
    {form && <WorkspaceTabOverlay><RequestDialog onClose={() => { if (!leave.busy) setForm(null) }}><section className="personal-request-compose"><header><div><span>개인 근태 신청</span><h2 id="personal-request-title">{requestLabel(form.kind)} 신청</h2></div><button type="button" aria-label="신청 작성 닫기" disabled={leave.busy} onClick={() => setForm(null)}><X size={19}/></button></header><form onSubmit={event => void submit(event)}><fieldset disabled={leave.busy} className="min-w-0 border-0 p-0">
      <div className="personal-request-compose-body">
        <label>신청 종류<Select autoFocus aria-label="개인 신청 종류" value={form.kind} onChange={event => { setForm(formFor(event.target.value as RequestKind, form.from)); setOfficialFile(null); setFormError('') }}>{REQUEST_KINDS.filter(item => item.id !== 'overtime').map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</Select></label>
        {isLeaveRequest(form.kind) && <p className="personal-request-helper">등록 즉시 남은 연차에서 연차는 근무일당 1일, 반차는 0.5일, 반반차는 0.25일 차감됩니다. 주말·공휴일은 제외하며, 자동 차감된 등록을 취소하면 복원됩니다. 잔여일이 미등록이거나 부족하면 운영지원에 문의해 주세요.</p>}
        <div className="personal-request-fields">
          <label>{span ? '시작일' : '신청일'}<HireDateScrollField label={span ? '개인 신청 시작일' : '개인 신청일'} className="mt-[7px] w-full" value={form.from} min="1950-01-01" max={form.kind === 'correction' ? today : `${Number(today.slice(0, 4)) + 5}-12-31`} clearable={false} onChange={value => { if (!value) return; patch({ from: value, to: !span ? value : form.to < value ? value : form.to }) }}/></label>
          {span && <label>종료일<HireDateScrollField label="개인 신청 종료일" className="mt-[7px] w-full" value={form.to} min={form.from || '1950-01-01'} max={`${Number(today.slice(0, 4)) + 5}-12-31`} clearable={false} onChange={value => { if (!value) return; patch({ to: value }) }}/></label>}
        </div>
        {form.kind === 'half' && <><p className="personal-request-hours" role="status">반차는 4시간입니다.</p><LeaveTimeShortcuts kind="half" compact start={form.start} end={form.end} onChange={patch} /></>}
        {form.kind === 'quarter' && <><p className="personal-request-hours" role="status">반반차는 2시간입니다.</p><QuarterLeaveTime start={form.start} end={form.end} onChange={patch} /></>}
        {!isAllDayRequest(form.kind) && form.kind !== 'half' && form.kind !== 'quarter' && <>
          <div className="personal-request-fields request-time-fields">
            <RequestTimeField label={form.kind === 'correction' ? '실제 출근 시각' : isLocationRequest(form.kind) ? '매일 시작 시각' : '시작 시각'} value={form.start} onChange={value => patch({ start: value })} />
            <RequestTimeField label={form.kind === 'correction' ? '실제 퇴근 시각' : isLocationRequest(form.kind) ? '매일 종료 시각' : '종료 시각'} value={form.end} onChange={value => patch({ end: value })} />
          </div>
          {form.kind !== 'offsite' && <TimeRangeSummary start={form.start} end={form.end} leave={isPartialLeave(form.kind)} daily={isLocationRequest(form.kind)} />}
        </>}
        {form.kind === 'correction' && <p className="personal-request-helper">{formRecord ? `현재 기록 · 출근 ${formRecord.clockIn || '없음'} · 퇴근 ${clockOutLabel(formRecord.clockOutAt) || '없음'}. ` : ''}승인되면 원래 기록은 그대로 두고 달력에 정정 시각을 ‘정정’으로 표시합니다.</p>}
        {isLocationRequest(form.kind) && <label>{form.kind === 'offsite' ? '외근 장소 · 필수' : '근무 장소 · 선택'}<Input aria-label="개인 신청 근무 장소" maxLength={200} value={form.place} placeholder={form.kind === 'offsite' ? '방문할 거래처 또는 장소' : '재택 등'} onChange={event => patch({ place: event.target.value })}/></label>}
        {isOfficialLeave(form.kind) && <div className={`personal-request-file${officialFile ? ' is-selected' : ''}`}><label htmlFor="official-leave-file">증빙 서류 · 필수</label><div><input id="official-leave-file" ref={officialFileInput} className="personal-request-file-input" aria-label="공가 증빙 서류" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.doc,.docx,.hwp,.hwpx" onChange={event => { setOfficialFile(event.target.files?.[0] ?? null); setFormError('') }}/><p>{officialFile ? officialFile.name : '예비군 통지서, 청첩장처럼 공가 사유를 확인할 서류를 올려 주세요.'}</p>{officialFile && <Button type="button" variant="outline" size="sm" onClick={() => { setOfficialFile(null); if (officialFileInput.current) officialFileInput.current.value = '' }}>지우기</Button>}<Button type="button" variant="outline" size="sm" onClick={() => officialFileInput.current?.click()}>{officialFile ? '다시 선택' : '서류 선택'}</Button></div></div>}
        <label>{form.kind === 'correction' || form.kind === 'overtime' || isOfficialLeave(form.kind) ? '신청 사유 · 필수' : '업무 인수인계·메모 · 선택'}<Textarea maxLength={2000} aria-label="개인 신청 메모" value={form.note} rows={3} placeholder={form.kind === 'correction' ? '기록 누락·보정 사유를 적어 주세요.' : form.kind === 'overtime' ? '예정된 야근 업무를 적어 주세요.' : isOfficialLeave(form.kind) ? '예비군, 결혼처럼 공가로 빠지는 사유를 적어 주세요.' : '업무 인수인계 등 필요한 내용만 적어 주세요.'} onChange={event => patch({ note: event.target.value })}/></label>
        {requiresDepartmentApproval(form.kind) && <div className="personal-request-approval-route"><span>승인 경로</span><strong>{approvalRoute(form.kind)}</strong><p>지정 승인자·대체 승인자는 ‘승인할 신청’에서 본인 신청도 승인할 수 있습니다.</p></div>}
        {!isOfficialLeave(form.kind) && !isFullLeave(form.kind) && form.kind !== 'half' && form.kind !== 'quarter' && form.kind !== 'offsite' && <div className="personal-request-alert-preview"><header><strong><Bell size={14}/>승인 후 알림 미리보기</strong><button type="button" aria-expanded={showBasis} onClick={() => setShowBasis(value => !value)}>예시 기준 {showBasis ? '접기' : '보기'}</button></header>{preview.map(text => <p key={text}>{text}</p>)}{(!reminders.arrival || !reminders.departure) && <p>{!reminders.arrival ? '출근' : ''}{!reminders.arrival && !reminders.departure ? '·' : ''}{!reminders.departure ? '퇴근' : ''} 전 알림은 내 설정에서 꺼져 있습니다.</p>}<small>회사 근무 기준은 미연결입니다. 알림 시간은 예시이며 실제 발송되지 않습니다.</small>{showBasis && <div className="personal-request-basis">{([{ key: 'start', label: '예시 출근' }, { key: 'end', label: '예시 퇴근' }, { key: 'breakStart', label: '휴게 시작' }, { key: 'breakEnd', label: '휴게 종료' }] as const).map(item => <label key={item.key}>{item.label}<Input type="time" aria-label={item.label} value={basis[item.key]} onChange={event => setBasis(current => ({ ...current, [item.key]: event.target.value }))}/></label>)}</div>}</div>}
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
