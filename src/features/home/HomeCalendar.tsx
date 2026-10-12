import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { useRenderWatch } from '@/lib/diagnostics'
import { koreanHolidayLabel, koreanHolidayNames } from '@/features/operations-support/korean-holidays'
import { HomeDayDialog } from './HomeDayDialog'
import { HomeTodoList } from './HomeTodoList'
import { addDays, formatMonthTitle, parseDateKey, toDateKey } from './home-events'

type Category = 'meeting' | 'work' | 'leave' | 'company'
export type TeamPresence = { id: string; date: string; name: string; status: string; kind: 'leave' | 'outside' | 'remote' }
export type ExampleEvent = { id: string; date: string; time: string; title: string; category: Category; note: string }
const categories: { id: Category; label: string }[] = [{ id: 'meeting', label: '회의' }, { id: 'work', label: '업무·마감' }, { id: 'leave', label: '휴가·근무' }, { id: 'company', label: '회사 일정' }]
const weekdays = ['월', '화', '수', '목', '금', '토', '일']

export function HomeCalendar({ sidebar, clockIns, needsClockIn, clocking, clockError, onClockIn }: { sidebar: ReactNode; clockIns: Record<string, string>; needsClockIn: boolean; clocking: boolean; clockError: string; onClockIn: () => void }) {
  useRenderWatch('HomeCalendar')
  const [today] = useState(() => toDateKey(new Date()))
  const [selected, setSelected] = useState(today)
  const [cursor, setCursor] = useState(() => parseDateKey(today))
  const [view, setView] = useState<'month' | 'week'>('month')
  const [weekends, setWeekends] = useState(false)
  const [examples, setExamples] = useState(true)
  const [showTeam, setShowTeam] = useState(true)
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null)
  const [hidden, setHidden] = useState<Category[]>([])
  const [dayOpen, setDayOpen] = useState(false)
  const month = toDateKey(cursor).slice(0, 7)
  const events = useMemo<ExampleEvent[]>(() => examples ? [
    { id: 'meeting', date: month === today.slice(0, 7) ? today : `${month}-08`, time: '10:00', title: '팀 주간 미팅', category: 'meeting', note: '팀별 진행 상황과 이번 주 일정을 확인하는 예시입니다.' },
    { id: 'work', date: month === today.slice(0, 7) ? today : `${month}-08`, time: '15:00', title: '시안 검토 마감', category: 'work', note: '개인에게 배정된 업무 마감이 표시되는 예시입니다.' },
    { id: 'leave', date: `${month}-15`, time: '13:00', title: '내 오후 반차', category: 'leave', note: '개인 휴가와 근무 일정이 표시되는 예시입니다. 실제 신청 내역이 아닙니다.' },
    { id: 'company', date: `${month}-20`, time: '14:00', title: '회사 공유 일정', category: 'company', note: '회사 공통 일정이 표시되는 예시입니다.' },
    { id: 'review', date: `${month}-23`, time: '11:00', title: '샘플 확인', category: 'work', note: '제품 샘플을 확인하는 업무 일정 예시입니다.' },
  ] : [], [examples, month, today])
  const teamPresence = useMemo<TeamPresence[]>(() => examples ? [
    { id: 'member-a', date: month === today.slice(0, 7) ? today : `${month}-08`, name: '김서윤', status: '연차', kind: 'leave' },
    { id: 'member-b', date: month === today.slice(0, 7) ? today : `${month}-08`, name: '이지훈', status: '외근', kind: 'outside' },
    { id: 'member-c', date: month === today.slice(0, 7) ? today : `${month}-08`, name: '박하린', status: '오후 반차', kind: 'leave' },
    { id: 'member-d', date: month === today.slice(0, 7) ? today : `${month}-08`, name: '정민재', status: '재택', kind: 'remote' },
    { id: 'member-e', date: month === today.slice(0, 7) ? today : `${month}-08`, name: '최유진', status: '오전 반차', kind: 'leave' },
    { id: 'member-f', date: `${month}-15`, name: '김서윤', status: '오전 반반차', kind: 'leave' },
    { id: 'member-g', date: `${month}-20`, name: '이지훈', status: '외근', kind: 'outside' },
  ] : [], [examples, month, today])
  const selectedTeam = showTeam ? teamPresence.filter(member => member.date === selected) : []
  const visibleEvents = events.filter(event => !hidden.includes(event.category))
  const cells = useMemo(() => {
    const first = view === 'month' ? new Date(cursor.getFullYear(), cursor.getMonth(), 1) : parseDateKey(selected)
    const start = addDays(first, -((first.getDay() + 6) % 7))
    const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0)
    const count = view === 'week' ? 7 : Math.ceil((((first.getDay() + 6) % 7) + last.getDate()) / 7) * 7
    return Array.from({ length: count }, (_, index) => addDays(start, index)).filter(date => weekends || (date.getDay() !== 0 && date.getDay() !== 6))
  }, [cursor, selected, view, weekends])
  const selectedEvents = visibleEvents.filter(event => event.date === selected)
  function selectDate(date: Date) { setSelected(toDateKey(date)); setCursor(date); setExpandedTeam(null) }
  function openDate(date: Date) { selectDate(date); setDayOpen(true) }
  function move(direction: number) {
    selectDate(view === 'week' ? addDays(parseDateKey(selected), direction * 7) : new Date(cursor.getFullYear(), cursor.getMonth() + direction, 1))
  }
  function toggleCategory(category: Category) { setHidden(current => current.includes(category) ? current.filter(value => value !== category) : [...current, category]) }

  return <div className="home-calendar-layout">
    <section className="home-calendar" aria-label="홈 일정 캘린더">
      <div className="home-calendar-top"><div className="home-section-heading"><CalendarDays size={18} /><h2>일정 캘린더</h2><span className="home-muted-tag">UI 시안</span></div><label className="home-check"><input type="checkbox" checked={examples} onChange={event => { setExamples(event.target.checked) }} />예시 샘플 보기</label></div>
      <div className="home-calendar-toolbar"><div className="home-month-nav"><h3>{formatMonthTitle(cursor)}</h3><button type="button" aria-label="이전 기간" onClick={() => move(-1)}><ChevronLeft size={17} /></button><button type="button" aria-label="다음 기간" onClick={() => move(1)}><ChevronRight size={17} /></button><button type="button" className="home-today" onClick={() => selectDate(new Date())}>오늘</button></div><div className="home-view-switch" aria-label="캘린더 보기"><button type="button" aria-pressed={view === 'month'} onClick={() => setView('month')}>월</button><button type="button" aria-pressed={view === 'week'} onClick={() => setView('week')}>주</button></div></div>
      <div className="home-calendar-filters"><div>{categories.map(category => <button type="button" key={category.id} aria-pressed={!hidden.includes(category.id)} onClick={() => toggleCategory(category.id)} className={`home-filter ${hidden.includes(category.id) ? 'is-hidden' : ''}`}><i className={`home-dot ${category.id}`} />{category.label}</button>)}</div><label className="home-check"><input type="checkbox" checked={weekends} onChange={event => setWeekends(event.target.checked)} />주말 포함</label></div>
      <div className="home-team-toolbar"><label className="home-check"><input type="checkbox" checked={showTeam} onChange={event => setShowTeam(event.target.checked)} />부서원 근무 표시</label><span>우리 부서 · 가상 직원 예시</span></div>
      <div className="home-calendar-stage">
      <div className={`home-calendar-grid ${weekends ? 'with-weekends' : ''} ${view === 'week' ? 'week-view' : ''}`}>
        {weekdays.slice(0, weekends ? 7 : 5).map(day => <div className="home-weekday" key={day}>{day}</div>)}
        {cells.map(date => {
          const key = toDateKey(date)
          const dayEvents = visibleEvents.filter(event => event.date === key)
          const dayTeam = showTeam ? teamPresence.filter(member => member.date === key) : []
          const dayHoliday = koreanHolidayLabel(koreanHolidayNames(key))
          return <div key={key} className={`home-day ${key === selected ? 'is-selected' : ''} ${date.getMonth() !== cursor.getMonth() ? 'other-month' : ''} ${dayHoliday ? 'holiday' : ''}`}><button type="button" className="home-day-select" aria-label={`${key} 날짜 선택`} aria-pressed={key === selected} onClick={() => openDate(date)}><span className={key === today ? 'today-number' : ''}>{date.getDate()}</span>{key === today && <small>오늘</small>}</button>{dayHoliday && <span className="home-holiday">{dayHoliday}</span>}{clockIns[key] && <span className="home-clock-mark">출근 {clockIns[key]}</span>}<div className="home-day-events">{dayEvents.map(event => <button type="button" key={event.id} onClick={() => openDate(date)} className={`home-calendar-event ${event.category}`}><span>{event.time}</span><strong>{event.title}</strong></button>)}</div>{dayTeam.length > 0 && <div className="home-team-presence">{dayTeam.slice(0, expandedTeam === key ? dayTeam.length : 3).map(member => <button key={member.id} type="button" className={`home-presence ${member.kind}`} onClick={() => openDate(date)}><i /><span>{member.name} · {member.status}</span></button>)}{dayTeam.length > 3 && <button type="button" className="home-presence-more" aria-expanded={expandedTeam === key} onClick={() => { const next = expandedTeam === key ? null : key; selectDate(date); setExpandedTeam(next) }}>{expandedTeam === key ? '접기' : `외 ${dayTeam.length - 3}명 · 전체 보기`}</button>}</div>}</div>
        })}
      </div>
      </div>
      <p className="home-calendar-footnote">{examples ? '예시 일정입니다. 실제 직원 일정이나 신청 내역이 아닙니다.' : '실제 일정 연결 전입니다. ‘예시 샘플 보기’로 화면 구성을 확인할 수 있습니다.'}</p>
    </section>
    <aside className="home-calendar-sidebar">
      <HomeTodoList examples={examples} />
      {sidebar}
    </aside>
    {needsClockIn && <HomeClockInButton busy={clocking} error={clockError} onClockIn={onClockIn} />}
    {dayOpen && <HomeDayDialog date={selected} events={selectedEvents} members={selectedTeam} examples={examples} showTeam={showTeam} onClose={() => setDayOpen(false)} onMove={direction => selectDate(addDays(parseDateKey(selected), direction))} />}
  </div>
}

function HomeClockInButton({ busy, error, onClockIn }: { busy: boolean; error: string; onClockIn: () => void }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const time = now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
  return <div className="home-clock-in-overlay">
    <button type="button" className="home-clock-in" disabled={busy} onClick={onClockIn}>
      <small>지금 시각</small>
      <strong>{time}</strong>
      <span>{busy ? '기록 중…' : '출근하기'}</span>
    </button>
    {error && <p role="alert">{error}</p>}
  </div>
}
