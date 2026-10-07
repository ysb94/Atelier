import { useEffect, useMemo, useRef, useState, type ReactNode, type FormEvent } from 'react'
import { WorkspaceTabOverlay } from '@/components/layout/workspace-tabs'
import { Bell, CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, FilePlus2, MapPin, Send, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea } from '@/components/ui/input'
import { useRenderWatch } from '@/lib/diagnostics'
import { localDateKey, monthDates, monthLabel, shiftMonth } from '@/features/operations-support/monthly-attendance'
import { DEFAULT_REMINDER_BASIS, REQUEST_KINDS, dateLabel, isFullLeave, isPartialLeave, reminderPreview, requestLabel, validateRequest, type PersonalRequest, type RequestForm, type RequestKind } from './personal-requests'
import './personal-requests.css'

const STATUS_LABELS = { pending: '승인 대기', approved: '승인', rejected: '반려', cancelled: '취소' }
function newForm(kind: RequestKind, day: string): RequestForm {
  return { kind, from: day, to: day, start: kind === 'overtime' ? '18:00' : '09:00', end: kind === 'half' ? '14:00' : kind === 'quarter' ? '11:00' : kind === 'overtime' ? '21:00' : '18:00', place: '', note: '' }
}
function spanLabel(item: RequestForm | PersonalRequest) {
  return `${dateLabel(item.from)}${item.to !== item.from ? `–${dateLabel(item.to)}` : ''}${isFullLeave(item.kind) ? ' · 종일' : ` · ${item.start}–${item.end}`}`
}
export function PersonalRequestsPanel({ today = localDateKey(new Date()), initialRequests = [] }: { today?: string; initialRequests?: PersonalRequest[] }) {
  useRenderWatch('PersonalRequestsPanel')
  const [requests, setRequests] = useState<PersonalRequest[]>(initialRequests)
  const [form, setForm] = useState<RequestForm | null>(null)
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [month, setMonth] = useState(today.slice(0,7))
  const [selectedDate, setSelectedDate] = useState(today)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [basis, setBasis] = useState(DEFAULT_REMINDER_BASIS)
  const [showBasis, setShowBasis] = useState(false)
  const [reminders, setReminders] = useState({ arrival: true, departure: true, missing: true, decision: true })
  const visible = useMemo(() => requests.filter(item => filter === 'all' || item.status === filter), [requests, filter])
  const pages = Math.max(1, Math.ceil(visible.length / 8))
  const currentPage = Math.min(page,pages)
  const list = visible.slice((currentPage-1)*8,currentPage*8)
  const pending = requests.filter(item => item.status === 'pending').length
  const approved = requests.filter(item => item.status === 'approved' && item.to >= today).length
  const selectedRequests = requests.filter(item => item.from <= selectedDate && item.to >= selectedDate && item.status !== 'cancelled')
  const dates = useMemo(() => monthDates(month), [month])
  const leading = (new Date(`${month}-01T12:00:00`).getDay()+6)%7
  const detailed = requests.find(item => item.id === detailId)
  const preview = form ? reminderPreview(form,basis).filter(text => (!text.startsWith('출근 기준') || reminders.arrival) && (!text.startsWith('퇴근 기준') || reminders.departure) && (!text.startsWith('퇴근 예정') || reminders.missing)) : []
  function openForm(kind: RequestKind, day = today) { setForm(newForm(kind,day)); setFormError(''); setNotice('') }
  function patch(patch: Partial<RequestForm>) { setForm(current => current ? { ...current, ...patch } : null); setFormError('') }
  function submit(event: FormEvent) {
    event.preventDefault()
    if (!form) return
    const error = validateRequest(form,requests,basis)
    if (error) { setFormError(error); return }
    const request: PersonalRequest = { ...form, id: crypto.randomUUID(), createdAt: new Date().toISOString(), status: 'pending', note: form.note.trim(), place: form.place.trim() }
    setRequests(current => [request,...current]); setMonth(form.from.slice(0,7)); setSelectedDate(form.from)
    setForm(null); setFilter('all'); setPage(1); setDetailId(request.id)
    setNotice('시안에 신청을 추가했습니다. 실제 승인 담당자에게는 전송되지 않습니다.')
  }
  function cancel(item: PersonalRequest) {
    if (item.status !== 'pending') return
    setRequests(current => current.map(row => row.id === item.id ? { ...row, status: 'cancelled' } : row))
    setNotice('대기 신청을 시안에서 취소했습니다.')
  }
  function changeMonth(delta: number) { const next = shiftMonth(month,delta); setMonth(next); setSelectedDate(`${next}-01`) }

  return <div className="personal-requests">
    <div className="personal-request-draft"><strong>신청 화면 시안</strong><span>입력은 새로고침하면 초기화됩니다. 승인·연차 잔여·출퇴근 기록·알림 발송은 아직 연결되지 않았습니다.</span></div>
    <div className="personal-request-overview">
      <article><CalendarDays size={17}/><span>내 휴가 잔여</span><strong>—<small>일</small></strong><p>운영지원 연차 정보 연결 예정</p></article>
      <article><Clock3 size={17}/><span>내 승인 대기</span><strong>{pending}<small>건</small></strong><p>휴가·근무·기록 정정</p></article>
      <article><Check size={17}/><span>예정된 승인 일정</span><strong>{approved}<small>건</small></strong><p>오늘 이후의 승인된 신청</p></article>
    </div>
    <section className="personal-request-quick" aria-label="개인 근태 신청">
      <div><h2>무엇을 신청하시나요?</h2><p>휴가, 근무, 기록 정정을 나눠 신청하고 진행 상태를 확인하세요.</p></div>
      <div className="personal-request-parts">
        {(['휴가', '근무', '정정'] as const).map(group => (
          <section key={group} className={`personal-request-part is-${group === '휴가' ? 'leave' : group === '근무' ? 'work' : 'fix'}`} aria-label={`${group} 신청`}>
            <h3>{group}</h3>
            <div className="personal-request-kind-buttons">{REQUEST_KINDS.filter(item => item.group === group).map(item => <button key={item.id} type="button" onClick={() => openForm(item.id)}><strong>{item.label}</strong><FilePlus2 size={14}/></button>)}</div>
          </section>
        ))}
      </div>
    </section>
    {notice && <p className="personal-request-notice" role="status">{notice}</p>}
    <div className="personal-request-columns">
      <div className="personal-request-primary">
        <section className="personal-request-history">
          <header><div><h2>내 신청</h2><p>신청 내용과 승인 상태를 확인합니다.</p></div><Select aria-label="내 신청 상태" value={filter} onChange={event=>{setFilter(event.target.value);setPage(1)}}><option value="all">전체 상태</option>{Object.entries(STATUS_LABELS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</Select></header>
          {!list.length ? <div className="personal-request-empty"><FilePlus2 size={26}/><strong>{filter==='all' ? '아직 신청한 내역이 없습니다.' : '이 상태의 신청이 없습니다.'}</strong><p>위에서 신청 종류를 선택하면 작성할 수 있습니다.</p></div> : <ul>{list.map(item=><li key={item.id} className={detailId===item.id?'is-selected':''}><button type="button" className="personal-request-row" onClick={()=>{setDetailId(item.id);setMonth(item.from.slice(0,7));setSelectedDate(item.from)}}><span className={`personal-request-kind-icon is-${item.kind}`}><CalendarDays size={17}/></span><span className="personal-request-row-text"><strong>{requestLabel(item.kind)}</strong><span>{spanLabel(item)}</span>{item.place && <small><MapPin size={10}/>{item.place}</small>}</span><span className={`personal-request-status is-${item.status}`}>{STATUS_LABELS[item.status]}</span></button>{item.status==='pending' && <Button variant="ghost" size="sm" onClick={()=>cancel(item)}>신청 취소</Button>}</li>)}</ul>}
          {visible.length>8 && <nav className="personal-request-pagination" aria-label="내 신청 페이지"><span>{currentPage}/{pages} 페이지 · {visible.length}건</span><Button variant="outline" size="icon" disabled={currentPage===1} aria-label="이전 신청 페이지" onClick={()=>setPage(currentPage-1)}><ChevronLeft size={14}/></Button><Button variant="outline" size="icon" disabled={currentPage===pages} aria-label="다음 신청 페이지" onClick={()=>setPage(currentPage+1)}><ChevronRight size={14}/></Button></nav>}
        </section>
        {detailed && <section className="personal-request-details" aria-label="내 신청 상세"><header><h2>{requestLabel(detailed.kind)} 신청 상세</h2><button type="button" aria-label="신청 상세 닫기" onClick={()=>setDetailId(null)}><X size={17}/></button></header><dl><div><dt>일정</dt><dd>{detailed.from} {detailed.to!==detailed.from?`– ${detailed.to}`:''}<br/>{isFullLeave(detailed.kind)?'종일':`${detailed.start}–${detailed.end}`}</dd></div><div><dt>진행 상태</dt><dd><span className={`personal-request-status is-${detailed.status}`}>{STATUS_LABELS[detailed.status]}</span></dd></div><div><dt>승인 담당</dt><dd>승인 경로 연결 예정</dd></div>{detailed.place && <div><dt>장소</dt><dd>{detailed.place}</dd></div>}<div><dt>신청 메모</dt><dd>{detailed.note||'작성한 메모가 없습니다.'}</dd></div>{detailed.decisionNote && <div><dt>처리 의견</dt><dd>{detailed.decisionNote}</dd></div>}</dl><p className="personal-request-helper">{detailed.status==='pending'?'승인 전에는 예정 근무와 알림이 변경되지 않습니다.':detailed.status==='approved'?'승인된 일정에 맞춰 알림을 조정하는 구상입니다. 실제 발송은 연결 예정입니다.':'취소·반려된 신청은 근무 일정에 적용하지 않습니다.'}</p></section>}
        <section className="personal-request-reminders"><header><div><Bell size={16}/><h2>내 근태 알림</h2></div><span>발송 연결 예정</span></header><p>승인된 휴가·외근·재택·야근 일정을 반영해 알려드립니다.</p><div className="personal-request-reminder-list">{([{key:'arrival',label:'출근 전 알림',detail:'종일 휴가는 제외하고, 오전 휴가는 복귀 시각 기준으로 안내'}, {key:'departure',label:'퇴근 전 알림',detail:'오후 휴가와 승인된 야근 종료 시각을 반영'}, {key:'missing',label:'출퇴근 기록 누락',detail:'다음 날에도 남은 기록은 정정 신청으로 안내'}, {key:'decision',label:'신청 결과 알림',detail:'승인·반려 및 변경 결과 확인'}] as const).map(item=><label key={item.key}><span><strong>{item.label}</strong><small>{item.detail}</small></span><input type="checkbox" checked={reminders[item.key]} onChange={event=>setReminders(current=>({...current,[item.key]:event.target.checked}))}/></label>)}</div><div className="personal-request-reminder-time"><label htmlFor="personal-reminder-before">미리 알릴 시간</label><Select id="personal-reminder-before" value={basis.before} onChange={event=>setBasis(current=>({...current,before:Number(event.target.value)}))}>{[5,10,15,30].map(value=><option key={value} value={value}>{value}분 전</option>)}</Select></div></section>
      </div>
      <aside className="personal-request-calendar-panel">
        <header><div><h2>내 신청 캘린더</h2><p>대기 일정은 확정 일정과 구분됩니다.</p></div></header><div className="personal-request-month"><Button variant="ghost" size="icon" aria-label="이전 신청 월" onClick={()=>changeMonth(-1)}><ChevronLeft size={15}/></Button><strong>{monthLabel(month)}</strong><Button variant="ghost" size="icon" aria-label="다음 신청 월" onClick={()=>changeMonth(1)}><ChevronRight size={15}/></Button></div>
        <div className="personal-request-calendar" aria-label="내 근태 신청 달력">{['월','화','수','목','금','토','일'].map(day=><span key={day} className="personal-request-weekday">{day}</span>)}{Array.from({length:leading},(_,i)=><span key={`blank${i}`}/>)}{dates.map(date=>{const items=requests.filter(item=>item.from<=date&&item.to>=date&&['pending','approved'].includes(item.status));return <button key={date} type="button" aria-label={`${date} 신청 ${items.length}건`} aria-pressed={selectedDate===date} className={`${date===today?'is-today ':''}${selectedDate===date?'is-selected':''}`} onClick={()=>setSelectedDate(date)}><span>{Number(date.slice(-2))}</span><div>{items.slice(0,3).map(item=><i key={item.id} className={`is-${item.status}`} title={`${requestLabel(item.kind)} ${STATUS_LABELS[item.status]}`}/>)}</div></button>})}</div><p className="personal-request-calendar-legend"><i className="is-approved"/>승인 <i className="is-pending"/>대기</p><div className="personal-request-day"><h3>{dateLabel(selectedDate)}</h3>{selectedRequests.length?selectedRequests.map(item=><button key={item.id} type="button" onClick={()=>setDetailId(item.id)}><strong>{requestLabel(item.kind)}</strong><span>{isFullLeave(item.kind)?'종일':`${item.start}–${item.end}`}</span><small>{STATUS_LABELS[item.status]}</small></button>):<p>등록된 신청이 없습니다.</p>}<Button size="sm" variant="outline" onClick={()=>openForm('annual',selectedDate)}>이 날짜에 신청</Button></div>
      </aside>
    </div>
    {form && <WorkspaceTabOverlay><RequestDialog onClose={() => setForm(null)}><section className="personal-request-compose"><header><div><span>개인 근태 신청</span><h2 id="personal-request-title">{requestLabel(form.kind)} 신청</h2></div><button type="button" aria-label="신청 작성 닫기" onClick={()=>setForm(null)}><X size={19}/></button></header><form onSubmit={submit}>
      <div className="personal-request-compose-body"><label>신청 종류<Select autoFocus aria-label="개인 신청 종류" value={form.kind} onChange={event=>{setForm(newForm(event.target.value as RequestKind,form.from));setFormError('')}}>{REQUEST_KINDS.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</Select></label><div className="personal-request-fields"><label>{isFullLeave(form.kind)||form.kind==='remote'||form.kind==='offsite'?'시작일':'신청일'}<Input aria-label="개인 신청 시작일" type="date" value={form.from} onChange={event=>patch({from:event.target.value,to:(isPartialLeave(form.kind)||['overtime','correction'].includes(form.kind))?event.target.value:form.to<event.target.value?event.target.value:form.to})}/></label>{(isFullLeave(form.kind)||form.kind==='remote'||form.kind==='offsite')&&<label>종료일<Input aria-label="개인 신청 종료일" type="date" value={form.to} onChange={event=>patch({to:event.target.value})}/></label>}</div>
      {isPartialLeave(form.kind)&&<div className="personal-request-duration"><strong>{form.kind==='half'?'반차 · 0.5일':'반반차 · 0.25일'}</strong><span>시안은 1일 8시간 기준입니다. 실제 사용 단위·휴게시간·차감은 회사 기준 연결 후 적용합니다.</span>{form.kind==='half'&&<div><Button size="sm" variant="outline" type="button" onClick={()=>patch({start:'09:00',end:'14:00'})}>오전 예시 09–14시</Button><Button size="sm" variant="outline" type="button" onClick={()=>patch({start:'14:00',end:'18:00'})}>오후 예시 14–18시</Button></div>}</div>}
      {!isFullLeave(form.kind)&&<div className="personal-request-fields"><label>{form.kind==='correction'?'실제 출근 시각':'시작 시각'}<Input aria-label="개인 신청 시작 시각" type="time" value={form.start} onChange={event=>patch({start:event.target.value})}/></label><label>{form.kind==='correction'?'실제 퇴근 시각':'종료 시각'}<Input aria-label="개인 신청 종료 시각" type="time" value={form.end} onChange={event=>patch({end:event.target.value})}/></label></div>}
      {(form.kind==='remote'||form.kind==='offsite')&&<label>{form.kind==='offsite'?'외근 장소':'근무 장소 · 선택'}<Input aria-label="개인 신청 근무 장소" value={form.place} placeholder={form.kind==='offsite'?'방문할 거래처 또는 장소':'재택 등'} onChange={event=>patch({place:event.target.value})}/></label>}
      <label>{form.kind==='correction'||form.kind==='overtime'?'신청 사유 · 필수':'업무 인수인계·메모 · 선택'}<Textarea aria-label="개인 신청 메모" value={form.note} rows={3} placeholder={form.kind==='correction'?'기록 누락·보정 사유를 적어 주세요.':form.kind==='overtime'?'예정된 야근 업무를 적어 주세요.':'업무 인수인계 등 필요한 내용만 적어 주세요.'} onChange={event=>patch({note:event.target.value})}/></label>
      <div className="personal-request-approval-route"><span>승인 경로</span><strong>승인 담당 연결 예정</strong><p>신청자의 화면에서는 본인 신청을 승인할 수 없습니다.</p></div>
      <div className="personal-request-alert-preview"><header><strong><Bell size={14}/>승인 후 알림 미리보기</strong><button type="button" aria-expanded={showBasis} onClick={()=>setShowBasis(value=>!value)}>예시 기준 {showBasis?'접기':'보기'}</button></header>{preview.map(text=><p key={text}>{text}</p>)}{(!reminders.arrival || !reminders.departure) && <p>{!reminders.arrival ? '출근' : ''}{!reminders.arrival && !reminders.departure ? '·' : ''}{!reminders.departure ? '퇴근' : ''} 전 알림은 내 설정에서 꺼져 있습니다.</p>}<small>회사 근무 기준은 미연결입니다. 알림 시간은 예시이며 실제 발송되지 않습니다.</small>{showBasis&&<div className="personal-request-basis">{([{key:'start',label:'예시 출근'}, {key:'end',label:'예시 퇴근'}, {key:'breakStart',label:'휴게 시작'}, {key:'breakEnd',label:'휴게 종료'}] as const).map(item=><label key={item.key}>{item.label}<Input type="time" aria-label={item.label} value={basis[item.key]} onChange={event=>setBasis(current=>({...current,[item.key]:event.target.value}))}/></label>)}</div>}</div>
      {isFullLeave(form.kind)&&<p className="personal-request-helper">입사 1년 미만은 월차, 1년 이상은 연차로 구분할 예정입니다. 지금은 잔여 일수를 차감하지 않습니다.</p>}
      {formError&&<p role="alert" className="personal-request-error">{formError}</p>}</div><footer><Button type="button" variant="outline" onClick={()=>setForm(null)}>닫기</Button><Button type="submit"><Send size={14}/>신청 추가 · 시안</Button></footer>
    </form></section></RequestDialog></WorkspaceTabOverlay>}
  </div>
}

function RequestDialog({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => { if (dialog?.open) dialog.close() }
  }, [])
  return <dialog ref={ref} aria-labelledby="personal-request-title" className="personal-request-overlay" onCancel={event => { event.preventDefault(); onClose() }}>{children}</dialog>
}
