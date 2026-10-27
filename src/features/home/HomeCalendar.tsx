import { useMemo, useState, type ReactNode } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { useRenderWatch } from '@/lib/diagnostics'
import { koreanHolidayLabel, koreanHolidayNames } from '@/features/operations-support/korean-holidays'
import { HomeDayDialog } from './HomeDayDialog'
import { HomeTodoList } from './HomeTodoList'
import { addDays, formatMonthTitle, parseDateKey, toDateKey } from './home-events'
import { useHomeCalendarEvents, type HomeCalendarEvent } from './use-home-calendar-events'

type Category = HomeCalendarEvent['category']
const categories: { id: Category; label: string }[] = [{ id: 'meeting', label: '회의' }, { id: 'leave', label: '휴가·근무' }]
const weekdays = ['월', '화', '수', '목', '금', '토', '일']

export function HomeCalendar({ sidebar, clockIns }: { sidebar: ReactNode; clockIns: Record<string, string> }) {
  useRenderWatch('HomeCalendar')
  const [today] = useState(() => toDateKey(new Date()))
  const [selected, setSelected] = useState(today)
  const [cursor, setCursor] = useState(() => parseDateKey(today))
  const [view, setView] = useState<'month' | 'week'>('month')
  const [weekends, setWeekends] = useState(false)
  const [hidden, setHidden] = useState<Category[]>([])
  const [dayOpen, setDayOpen] = useState(false)
  const month = toDateKey(cursor).slice(0, 7)
  const calendar = useHomeCalendarEvents(month)
  const visibleEvents = calendar.events.filter(event => !hidden.includes(event.category))
  const cells = useMemo(() => {
    const first = view === 'month' ? new Date(cursor.getFullYear(), cursor.getMonth(), 1) : parseDateKey(selected)
    const start = addDays(first, -((first.getDay() + 6) % 7))
    const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0)
    const count = view === 'week' ? 7 : Math.ceil((((first.getDay() + 6) % 7) + last.getDate()) / 7) * 7
    return Array.from({ length: count }, (_, index) => addDays(start, index)).filter(date => weekends || (date.getDay() !== 0 && date.getDay() !== 6))
  }, [cursor, selected, view, weekends])
  const selectedEvents = visibleEvents.filter(event => event.date === selected)
  function selectDate(date: Date) { setSelected(toDateKey(date)); setCursor(date) }
  function openDate(date: Date) { selectDate(date); setDayOpen(true) }
  function move(direction: number) {
    selectDate(view === 'week' ? addDays(parseDateKey(selected), direction * 7) : new Date(cursor.getFullYear(), cursor.getMonth() + direction, 1))
  }
  function toggleCategory(category: Category) { setHidden(current => current.includes(category) ? current.filter(value => value !== category) : [...current, category]) }
  const footnote = calendar.error
    ? '일부 일정을 불러오지 못했습니다. 표시된 일정만 확인해 주세요.'
    : calendar.loading
      ? '일정을 불러오는 중입니다.'
      : '내 회의와 휴가·외근·야근 신청이 표시됩니다.'

  return <div className="home-calendar-layout">
    <section className="home-calendar" aria-label="홈 일정 캘린더">
      <div className="home-calendar-top"><div className="home-section-heading"><CalendarDays size={18} /><h2>일정 캘린더</h2></div></div>
      <div className="home-calendar-toolbar"><div className="home-month-nav"><h3>{formatMonthTitle(cursor)}</h3><button type="button" aria-label="이전 기간" onClick={() => move(-1)}><ChevronLeft size={17} /></button><button type="button" aria-label="다음 기간" onClick={() => move(1)}><ChevronRight size={17} /></button><button type="button" className="home-today" onClick={() => selectDate(new Date())}>오늘</button></div><div className="home-view-switch" aria-label="캘린더 보기"><button type="button" aria-pressed={view === 'month'} onClick={() => setView('month')}>월</button><button type="button" aria-pressed={view === 'week'} onClick={() => setView('week')}>주</button></div></div>
      <div className="home-calendar-filters"><div>{categories.map(category => <button type="button" key={category.id} aria-pressed={!hidden.includes(category.id)} onClick={() => toggleCategory(category.id)} className={`home-filter ${hidden.includes(category.id) ? 'is-hidden' : ''}`}><i className={`home-dot ${category.id}`} />{category.label}</button>)}</div><label className="home-check"><input type="checkbox" checked={weekends} onChange={event => setWeekends(event.target.checked)} />주말 포함</label></div>
      <div className="home-calendar-stage">
      <div className={`home-calendar-grid ${weekends ? 'with-weekends' : ''} ${view === 'week' ? 'week-view' : ''}`}>
        {weekdays.slice(0, weekends ? 7 : 5).map(day => <div className="home-weekday" key={day}>{day}</div>)}
        {cells.map(date => {
          const key = toDateKey(date)
          const dayEvents = visibleEvents.filter(event => event.date === key)
          const dayHoliday = koreanHolidayLabel(koreanHolidayNames(key))
          return <div key={key} className={`home-day ${key === selected ? 'is-selected' : ''} ${date.getMonth() !== cursor.getMonth() ? 'other-month' : ''} ${dayHoliday ? 'holiday' : ''}`}><button type="button" className="home-day-select" aria-label={`${key} 날짜 선택`} aria-pressed={key === selected} onClick={() => openDate(date)}><span className={key === today ? 'today-number' : ''}>{date.getDate()}</span>{key === today && <small>오늘</small>}</button>{dayHoliday && <span className="home-holiday">{dayHoliday}</span>}{clockIns[key] && <span className="home-clock-mark">출근 {clockIns[key]}</span>}<div className="home-day-events">{dayEvents.map(event => <button type="button" key={event.id} onClick={() => openDate(date)} className={`home-calendar-event ${event.category}`}><span>{event.time}</span><strong>{event.title}</strong></button>)}</div></div>
        })}
      </div>
      </div>
      <p className="home-calendar-footnote">{footnote}</p>
    </section>
    <aside className="home-calendar-sidebar">
      <HomeTodoList />
      {sidebar}
    </aside>
    {dayOpen && <HomeDayDialog date={selected} events={selectedEvents} onClose={() => setDayOpen(false)} onMove={direction => selectDate(addDays(parseDateKey(selected), direction))} />}
  </div>
}
