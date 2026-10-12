import { useEffect, useMemo, useRef, useState, type ReactNode, type FormEvent } from 'react'
import { WorkspaceTabOverlay } from '@/components/layout/workspace-tab-overlay'
import { Bell, CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, Plus, Search, Send, Settings2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea } from '@/components/ui/input'
import { useRenderWatch } from '@/lib/diagnostics'
import { useLeaveRequests } from '@/features/operations-support/use-leave-requests'
import { useDepartmentApprovers } from '@/features/operations-support/use-department-approvers'
import { useOpsDirectory } from '@/features/operations-support/ops-directory'
import { useAuth } from '@/lib/supabase/auth'
import { koreanHolidayLabel, koreanHolidayNames } from '@/features/operations-support/korean-holidays'
import { localDateKey, monthLabel, shiftMonth } from '@/features/operations-support/monthly-attendance'
import { DEFAULT_REMINDER_BASIS, REQUEST_KINDS, dateLabel, isFullLeave, isPartialLeave, isLeaveRequest, isSavedRequest, reminderPreview, requestLabel, validateRequest, type PersonalRequest, type RequestForm, type RequestKind } from './personal-requests'
import './personal-requests.css'

const STATUS_LABELS = { pending: '승인 대기', approved: '승인', rejected: '반려', cancelled: '취소' }
const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토']
const WEEKDAYS = DAY_NAMES.slice(1, 6)
const REMINDER_OPTIONS = [
  { key: 'arrival', label: '출근 전 알림', detail: '종일 휴가는 제외하고, 오전 휴가는 복귀 시각 기준으로 안내' },
  { key: 'departure', label: '퇴근 전 알림', detail: '오후 휴가와 승인된 야근 종료 시각을 반영' },
  { key: 'missing', label: '출퇴근 기록 누락', detail: '다음 날에도 남은 기록은 정정 신청으로 안내' },
  { key: 'decision', label: '신청 결과 알림', detail: '승인·반려 및 변경 결과 확인' },
] as const
function monthCells(month: string) {
  const [year, monthNumber] = month.split('-').map(Number)
  const first = new Date(year, monthNumber - 1, 1, 12)
  // Start with the first week containing a weekday in this month.
  if (first.getDay() === 6) first.setDate(3)
  else if (first.getDay() === 0) first.setDate(2)
  const cursor = new Date(first)
  cursor.setDate(first.getDate() - (first.getDay() - 1))
  const cells: string[] = []
  for (let index = 0; index < 35; index += 1) {
    if (cursor.getDay() !== 0 && cursor.getDay() !== 6) cells.push(localDateKey(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  return cells
}
function requestLayer(kind: RequestKind) {
  return kind === 'annual' || kind === 'half' || kind === 'quarter' ? 'leave' : kind === 'correction' ? 'fix' : 'work'
}
function newForm(kind: RequestKind, day: string): RequestForm {
  return { kind, from: day, to: day, start: kind === 'overtime' ? '18:00' : '09:00', end: kind === 'half' ? '14:00' : kind === 'quarter' ? '11:00' : kind === 'overtime' ? '21:00' : '18:00', place: '', note: '' }
}
export function PersonalRequestsPanel({ today = localDateKey(new Date()), initialRequests = [] }: { today?: string; initialRequests?: PersonalRequest[] }) {
  useRenderWatch('PersonalRequestsPanel')
  const leave = useLeaveRequests()
  const approvals = useDepartmentApprovers()
  const directory = useOpsDirectory()
  const { profile } = useAuth()
  function approvalRoute(kind: RequestKind, departmentId = profile?.departmentId) {
    if (!isSavedRequest(kind)) return '승인 경로 연결 예정'
    if (approvals.loading || directory.loading) return '승인 담당자 확인 중…'
    if (approvals.error || directory.error) return '승인 담당자를 불러오지 못했습니다.'
    const setting = approvals.settings.find(item => item.departmentId === departmentId && item.type === (kind === 'overtime' ? 'overtime' : 'leave'))
    const names = [setting?.approverId, setting?.substituteId].filter(id => id && id !== leave.userId)
      .map(id => directory.members.find(member => member.id === id)?.displayName).filter(Boolean)
    return names.length ? `부서 지정 승인자 · ${names.join(' / ')}` : '승인자 미지정 · 운영지원에 담당자 설정을 요청해 주세요.'
  }
  const [draftRequests, setDraftRequests] = useState<PersonalRequest[]>(initialRequests)
  const requests = useMemo(() => [...leave.requests, ...draftRequests].sort((a,b) => b.createdAt.localeCompare(a.createdAt)), [leave.requests, draftRequests])
  const [form, setForm] = useState<RequestForm | null>(null)
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const [month, setMonth] = useState(today.slice(0,7))
  const [selectedDate, setSelectedDate] = useState(today)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [basis, setBasis] = useState(DEFAULT_REMINDER_BASIS)
  const [showBasis, setShowBasis] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [layers, setLayers] = useState({ leave: true, work: true, fix: true, holiday: true, closed: false })
  const [reminders, setReminders] = useState({ arrival: true, departure: true, missing: true, decision: true })
  const addMenuRef = useRef<HTMLDivElement>(null)
  const cells = useMemo(() => monthCells(month), [month])
  const pending = requests.filter(item => item.status === 'pending').length
  const approved = requests.filter(item => item.status === 'approved' && item.to >= today).length
  function shownRequest(item: PersonalRequest) {
    if (query.trim() && !`${requestLabel(item.kind)} ${item.place} ${item.note}`.toLowerCase().includes(query.trim().toLowerCase())) return false
    if (!layers[requestLayer(item.kind)]) return false
    if (item.status === 'pending' || item.status === 'approved') return true
    return layers.closed
  }
  const selectedRequests = requests.filter(item => item.from <= selectedDate && item.to >= selectedDate && shownRequest(item))
  const detailed = requests.find(item => item.id === detailId)
  const decision = leave.requests.find(item => item.id === detailId)
  const preview = form ? reminderPreview(form,isLeaveRequest(form.kind) ? DEFAULT_REMINDER_BASIS : basis).filter(text => (!text.startsWith('출근 기준') || reminders.arrival) && (!text.startsWith('퇴근 기준') || reminders.departure) && (!text.startsWith('퇴근 예정') || reminders.missing)) : []
  function openForm(kind: RequestKind, day = selectedDate) { setAddOpen(false); setForm(newForm(kind,day)); setFormError(''); setNotice('') }
  function pickDate(date: string) { setSelectedDate(date); setMonth(date.slice(0, 7)) }
  useEffect(() => {
    if (!addOpen) return
    function close(event: PointerEvent) {
      if (event.target instanceof Node && addMenuRef.current?.contains(event.target)) return
      setAddOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [addOpen])
  function patch(patch: Partial<RequestForm>) { setForm(current => current ? { ...current, ...patch } : null); setFormError('') }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!form || leave.busy) return
    const error = validateRequest(form,requests,isLeaveRequest(form.kind) ? DEFAULT_REMINDER_BASIS : basis)
    if (error) { setFormError(error); return }
    let request: PersonalRequest
    if (isSavedRequest(form.kind)) {
      try { request = await leave.create.mutateAsync(form) }
      catch (error) { console.warn('[leave-requests] 마이페이지 신청 실패', error); setFormError(error instanceof Error ? error.message : '신청을 저장하지 못했습니다.'); return }
    } else {
      request = { ...form, id: crypto.randomUUID(), createdAt: new Date().toISOString(), status: 'pending', note: form.note.trim(), place: form.place.trim() }
      setDraftRequests(current => [request,...current])
    }
    setMonth(form.from.slice(0,7)); setSelectedDate(form.from)
    setForm(null); setDetailId(request.id)
    setNotice(isSavedRequest(form.kind) ? '신청을 저장했습니다. 부서별 지정 담당자가 승인하며, 담당자 미지정 시 설정 후 처리할 수 있습니다.' : '근무·정정 신청을 시안에 추가했습니다. 아직 승인 담당자에게 전달되지 않습니다.')
  }
  async function cancel(item: PersonalRequest) {
    if (item.status !== 'pending' || leave.busy) return
    if (leave.requests.some(row => row.id === item.id)) {
      try { await leave.transition.mutateAsync({ id: item.id, status: 'cancelled' }); setNotice('휴가 신청을 취소했습니다.') }
      catch (error) { console.warn('[leave-requests] 마이페이지 취소 실패', error); setNotice(error instanceof Error ? error.message : '신청 취소에 실패했습니다.') }
    } else {
      setDraftRequests(current => current.map(row => row.id === item.id ? { ...row, status: 'cancelled' } : row))
      setNotice('대기 신청을 시안에서 취소했습니다.')
    }
  }
  function changeMonth(delta: number) { const next = shiftMonth(month,delta); setMonth(next); setSelectedDate(monthCells(next).find(date => date.slice(0, 7) === next)!) }

  return <div className="personal-requests">
    <div className="personal-request-draft-row">
      <div className="personal-request-draft"><strong>연차·야근 · 부서별 지정 승인자</strong><span>연차·반차·반반차·야근은 부서별 담당자가 승인합니다. 운영지원은 승인자를 지정합니다. 외근·재택·정정과 알림은 시안이며 잔여일 자동 차감은 미적용입니다.</span></div>
      <Button type="button" variant="outline" size="sm" className="personal-request-settings-button" aria-haspopup="dialog" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(true)}><Settings2 size={14}/>알림 설정</Button>
    </div>
    {leave.error && <p role="alert" className="personal-request-error">휴가 신청을 불러오지 못했습니다. <Button variant="outline" size="sm" onClick={() => void leave.refresh()}>다시 불러오기</Button></p>}
    <div className="personal-request-overview">
      <article><CalendarDays size={17}/><span>내 휴가 잔여</span><strong>—<small>일</small></strong><p>운영지원 연차 정보 연결 예정</p></article>
      <article><Clock3 size={17}/><span>내 승인 대기</span><strong>{pending}<small>건</small></strong><p>휴가·근무·기록 정정</p></article>
      <article><Check size={17}/><span>예정된 승인 일정</span><strong>{approved}<small>건</small></strong><p>오늘 이후의 승인된 신청</p></article>
    </div>
    {notice && <p className="personal-request-notice" role="status">{notice}</p>}
    <section className="personal-request-board" aria-label="개인 근태 신청">
      <header className="personal-request-toolbar">
        <div className="personal-request-toolbar-month">
          <Button variant="ghost" size="icon" aria-label="이전 달" onClick={() => changeMonth(-1)}><ChevronLeft size={16}/></Button>
          <strong>{monthLabel(month)}</strong>
          <Button variant="ghost" size="icon" aria-label="다음 달" onClick={() => changeMonth(1)}><ChevronRight size={16}/></Button>
        </div>
        <label className="personal-request-search"><Search size={14}/><input aria-label="일정 검색" value={query} placeholder="일정 검색" onChange={event => setQuery(event.target.value)}/></label>
        <div className="personal-request-toolbar-actions">
          <Button type="button" variant="outline" size="sm" disabled={leave.busy} onClick={() => void leave.refresh()}>새로고침</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => pickDate(today)}>오늘</Button>
          <div className="personal-request-add" ref={addMenuRef}>
            <Button type="button" size="sm" aria-expanded={addOpen} aria-haspopup="menu" onClick={() => setAddOpen(open => !open)}><Plus size={14}/>신청</Button>
            {addOpen && <div className="personal-request-add-menu" role="menu" aria-label="신청 종류">{(['휴가', '근무', '정정'] as const).map(group => <section key={group}><h3>{group}</h3>{REQUEST_KINDS.filter(item => item.group === group).map(item => <button key={item.id} type="button" role="menuitem" onClick={() => openForm(item.id)}>{item.label}</button>)}</section>)}</div>}
          </div>
        </div>
      </header>
      <div className="personal-request-shell">
        <aside className="personal-request-side">
          <div className="personal-request-mini" aria-label="월 이동">
            <div className="personal-request-mini-head"><strong>{monthLabel(month)}</strong><span><button type="button" aria-label="작은 달력 이전 달" onClick={() => changeMonth(-1)}><ChevronLeft size={14}/></button><button type="button" aria-label="작은 달력 다음 달" onClick={() => changeMonth(1)}><ChevronRight size={14}/></button></span></div>
            <div className="personal-request-mini-grid">{WEEKDAYS.map(day => <span key={day}>{day}</span>)}{cells.map(date => <button key={date} type="button" aria-pressed={selectedDate === date} className={`${date.slice(0, 7) === month ? '' : 'is-outside '}${date === today ? 'is-today ' : ''}${selectedDate === date ? 'is-selected' : ''}`} onClick={() => pickDate(date)}>{Number(date.slice(8))}</button>)}</div>
          </div>
          <div className="personal-request-layers" aria-label="달력에 표시할 일정">
            <h3>내 일정</h3>
            {([['leave', '휴가'], ['work', '근무'], ['fix', '정정'], ['holiday', '공휴일'], ['closed', '반려·취소']] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={layers[key]} onChange={event => setLayers(current => ({ ...current, [key]: event.target.checked }))}/><i className={`is-${key}`}/>{label}</label>)}
          </div>
          <div className="personal-request-day">
            <h3>{dateLabel(selectedDate)} ({DAY_NAMES[new Date(`${selectedDate}T12:00:00`).getDay()]})</h3>
            {layers.holiday && koreanHolidayNames(selectedDate).length > 0 && <p className="personal-request-holiday-note">{koreanHolidayLabel(koreanHolidayNames(selectedDate))}</p>}
            {selectedRequests.length ? selectedRequests.map(item => <div key={item.id} className={detailId === item.id ? 'is-selected' : ''}><button type="button" onClick={() => setDetailId(item.id)}><strong>{requestLabel(item.kind)}</strong><span>{isFullLeave(item.kind) ? '종일' : `${item.start}–${item.end}`}</span><small>{STATUS_LABELS[item.status]}</small></button>{item.status === 'pending' && <Button variant="ghost" size="sm" disabled={leave.busy} onClick={() => void cancel(item)}>신청 취소</Button>}</div>) : <p>{leave.loading ? '휴가 신청을 불러오는 중입니다.' : '이 날짜의 신청이 없습니다.'}</p>}
            <Button size="sm" variant="outline" onClick={() => openForm('annual', selectedDate)}>이 날짜에 신청</Button>
          </div>
          {detailed && <section className="personal-request-details" aria-label="내 신청 상세"><header><h2>{requestLabel(detailed.kind)} 신청 상세</h2><button type="button" aria-label="신청 상세 닫기" onClick={() => setDetailId(null)}><X size={17}/></button></header><dl><div><dt>일정</dt><dd>{detailed.from} {detailed.to !== detailed.from ? `– ${detailed.to}` : ''}<br/>{isFullLeave(detailed.kind) ? '종일' : `${detailed.start}–${detailed.end}`}</dd></div><div><dt>진행 상태</dt><dd><span className={`personal-request-status is-${detailed.status}`}>{STATUS_LABELS[detailed.status]}</span></dd></div>{decision?.decidedAt && <div><dt>처리자·일시</dt><dd>{decision.decidedByName} · {new Date(decision.decidedAt).toLocaleString('ko-KR')}</dd></div>}<div><dt>승인 담당</dt><dd>{approvalRoute(detailed.kind, decision?.departmentId ?? profile?.departmentId)}</dd></div>{detailed.place && <div><dt>장소</dt><dd>{detailed.place}</dd></div>}<div><dt>신청 메모</dt><dd>{detailed.note || '작성한 메모가 없습니다.'}</dd></div>{detailed.decisionNote && <div><dt>처리 의견</dt><dd>{detailed.decisionNote}</dd></div>}</dl><p className="personal-request-helper">{detailed.status === 'pending' ? '승인 전에는 예정 근무와 알림이 변경되지 않습니다.' : detailed.status === 'approved' ? '승인된 일정에 맞춰 알림을 조정하는 구상입니다. 실제 발송은 연결 예정입니다.' : '취소·반려된 신청은 근무 일정에 적용하지 않습니다.'}</p></section>}
        </aside>
        <div className="personal-request-month" role="grid" aria-label={`${monthLabel(month)} 근태 달력`}>
          {WEEKDAYS.map(day => <div key={day} role="columnheader" className={`personal-request-weekday is-${day}`}>{day}</div>)}
          {cells.map(date => {
            const holiday = layers.holiday ? koreanHolidayLabel(koreanHolidayNames(date)) : ''
            const items = requests.filter(item => item.from <= date && item.to >= date && shownRequest(item))
            const visibleItems = items.slice(0, holiday ? 2 : 3)
            const hidden = items.length - visibleItems.length
            const outside = date.slice(0, 7) !== month
            return <div key={date} role="gridcell" className={`agenda-day${outside ? ' is-outside' : ''}${date === today ? ' is-today' : ''}${selectedDate === date ? ' is-selected' : ''}`} onClick={() => pickDate(date)}>
              <button type="button" className="agenda-num" aria-pressed={selectedDate === date} aria-label={`${date} ${holiday || '일정'} ${items.length}건`} onClick={() => pickDate(date)}>{Number(date.slice(8))}</button>
              {holiday && <span className="agenda-bar is-holiday">{holiday}</span>}
              {visibleItems.map(item => <button key={item.id} type="button" className={`agenda-bar is-${requestLayer(item.kind)} is-${item.status}`} onClick={() => { pickDate(date); setDetailId(item.id) }}>{requestLabel(item.kind)}{item.status === 'approved' ? '' : ` · ${STATUS_LABELS[item.status]}`}</button>)}
              {hidden > 0 && <button type="button" className="agenda-more" onClick={() => pickDate(date)}>+{hidden}개</button>}
            </div>
          })}
        </div>
      </div>
    </section>
    {settingsOpen && <WorkspaceTabOverlay><RequestDialog className="is-settings" labelledBy="personal-reminder-title" onClose={() => setSettingsOpen(false)}><section className="personal-request-reminders personal-request-settings-card" aria-label="내 근태 알림 설정"><header><div><Bell size={16}/><h2 id="personal-reminder-title">내 근태 알림</h2></div><button type="button" aria-label="알림 설정 닫기" onClick={() => setSettingsOpen(false)}><X size={17}/></button></header><p>승인된 휴가·외근·재택·야근 일정을 반영해 알려드립니다. 발송 연결 예정입니다.</p><div className="personal-request-reminder-list">{REMINDER_OPTIONS.map(item => <label key={item.key}><span><strong>{item.label}</strong><small>{item.detail}</small></span><input type="checkbox" checked={reminders[item.key]} onChange={event => setReminders(current => ({ ...current, [item.key]: event.target.checked }))}/></label>)}</div><div className="personal-request-reminder-time"><label htmlFor="personal-reminder-before">미리 알릴 시간</label><Select id="personal-reminder-before" value={basis.before} onChange={event => setBasis(current => ({ ...current, before: Number(event.target.value) }))}>{[5, 10, 15, 30].map(value => <option key={value} value={value}>{value}분 전</option>)}</Select></div></section></RequestDialog></WorkspaceTabOverlay>}
    {form && <WorkspaceTabOverlay><RequestDialog onClose={() => { if (!leave.busy) setForm(null) }}><section className="personal-request-compose"><header><div><span>개인 근태 신청</span><h2 id="personal-request-title">{requestLabel(form.kind)} 신청</h2></div><button type="button" aria-label="신청 작성 닫기" disabled={leave.busy} onClick={()=>setForm(null)}><X size={19}/></button></header><form onSubmit={event => void submit(event)}><fieldset disabled={leave.busy} className="min-w-0 border-0 p-0">
      <div className="personal-request-compose-body"><label>신청 종류<Select autoFocus aria-label="개인 신청 종류" value={form.kind} onChange={event=>{setForm(newForm(event.target.value as RequestKind,form.from));setFormError('')}}>{REQUEST_KINDS.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</Select></label><div className="personal-request-fields"><label>{isFullLeave(form.kind)||form.kind==='remote'||form.kind==='offsite'?'시작일':'신청일'}<Input aria-label="개인 신청 시작일" type="date" value={form.from} onChange={event=>patch({from:event.target.value,to:(isPartialLeave(form.kind)||['overtime','correction'].includes(form.kind))?event.target.value:form.to<event.target.value?event.target.value:form.to})}/></label>{(isFullLeave(form.kind)||form.kind==='remote'||form.kind==='offsite')&&<label>종료일<Input aria-label="개인 신청 종료일" type="date" value={form.to} onChange={event=>patch({to:event.target.value})}/></label>}</div>
      {isPartialLeave(form.kind)&&<div className="personal-request-duration"><strong>{form.kind==='half'?'반차 · 0.5일':'반반차 · 0.25일'}</strong><span>신청 기준: 1일 8시간, 휴게시간 12–13시 제외. 반차 4시간·반반차 2시간이며 잔여일 자동 차감은 미적용입니다.</span>{form.kind==='half'&&<div><Button size="sm" variant="outline" type="button" onClick={()=>patch({start:'09:00',end:'14:00'})}>오전 예시 09–14시</Button><Button size="sm" variant="outline" type="button" onClick={()=>patch({start:'14:00',end:'18:00'})}>오후 예시 14–18시</Button></div>}</div>}
      {!isFullLeave(form.kind)&&<div className="personal-request-fields"><label>{form.kind==='correction'?'실제 출근 시각':'시작 시각'}<Input aria-label="개인 신청 시작 시각" type="time" value={form.start} onChange={event=>patch({start:event.target.value})}/></label><label>{form.kind==='correction'?'실제 퇴근 시각':'종료 시각'}<Input aria-label="개인 신청 종료 시각" type="time" value={form.end} onChange={event=>patch({end:event.target.value})}/></label></div>}
      {(form.kind==='remote'||form.kind==='offsite')&&<label>{form.kind==='offsite'?'외근 장소':'근무 장소 · 선택'}<Input aria-label="개인 신청 근무 장소" value={form.place} placeholder={form.kind==='offsite'?'방문할 거래처 또는 장소':'재택 등'} onChange={event=>patch({place:event.target.value})}/></label>}
      <label>{form.kind==='correction'||form.kind==='overtime'?'신청 사유 · 필수':'업무 인수인계·메모 · 선택'}<Textarea maxLength={2000} aria-label="개인 신청 메모" value={form.note} rows={3} placeholder={form.kind==='correction'?'기록 누락·보정 사유를 적어 주세요.':form.kind==='overtime'?'예정된 야근 업무를 적어 주세요.':'업무 인수인계 등 필요한 내용만 적어 주세요.'} onChange={event=>patch({note:event.target.value})}/></label>
      <div className="personal-request-approval-route"><span>승인 경로</span><strong>{approvalRoute(form.kind)}</strong><p>신청자의 화면에서는 본인 신청을 승인할 수 없습니다.</p></div>
      <div className="personal-request-alert-preview"><header><strong><Bell size={14}/>승인 후 알림 미리보기</strong><button type="button" aria-expanded={showBasis} onClick={()=>setShowBasis(value=>!value)}>예시 기준 {showBasis?'접기':'보기'}</button></header>{preview.map(text=><p key={text}>{text}</p>)}{(!reminders.arrival || !reminders.departure) && <p>{!reminders.arrival ? '출근' : ''}{!reminders.arrival && !reminders.departure ? '·' : ''}{!reminders.departure ? '퇴근' : ''} 전 알림은 내 설정에서 꺼져 있습니다.</p>}<small>회사 근무 기준은 미연결입니다. 알림 시간은 예시이며 실제 발송되지 않습니다.</small>{showBasis&&<div className="personal-request-basis">{([{key:'start',label:'예시 출근'}, {key:'end',label:'예시 퇴근'}, {key:'breakStart',label:'휴게 시작'}, {key:'breakEnd',label:'휴게 종료'}] as const).map(item=><label key={item.key}>{item.label}<Input type="time" aria-label={item.label} value={basis[item.key]} onChange={event=>setBasis(current=>({...current,[item.key]:event.target.value}))}/></label>)}</div>}</div>
      {isFullLeave(form.kind)&&<p className="personal-request-helper">승인 결과는 내 신청에서 확인할 수 있습니다. 잔여일 차감은 아직 적용되지 않습니다.</p>}
      {formError&&<p role="alert" className="personal-request-error">{formError}</p>}</div><footer><Button type="button" variant="outline" onClick={()=>setForm(null)}>닫기</Button><Button type="submit" disabled={leave.busy || (isSavedRequest(form.kind) && (leave.loading || Boolean(leave.error)))}><Send size={14}/>{leave.busy ? '저장 중…' : isSavedRequest(form.kind) ? '신청하기' : '신청 추가 · 시안'}</Button></footer>
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
