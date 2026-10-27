import { useEffect, useRef } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useRenderWatch } from '@/lib/diagnostics'
import { koreanHolidayLabel, koreanHolidayNames } from '@/features/operations-support/korean-holidays'
import { parseDateKey } from './home-events'
import type { HomeCalendarEvent } from './use-home-calendar-events'

type Props = {
  date: string
  events: HomeCalendarEvent[]
  onClose: () => void
  onMove: (direction: number) => void
}

export function HomeDayDialog({ date, events, onClose, onMove }: Props) {
  useRenderWatch('HomeDayDialog')
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => { dialog?.close() }
  }, [])
  const selected = parseDateKey(date)
  const holiday = koreanHolidayLabel(koreanHolidayNames(date))
  return <dialog ref={ref} className="home-day-dialog" aria-labelledby="home-day-dialog-title" onCancel={event => { event.preventDefault(); onClose() }} onClick={event => { if (event.currentTarget === event.target) onClose() }}>
    <div className="home-day-dialog-header"><div><p className="home-eyebrow">DAY OVERVIEW</p><h2 id="home-day-dialog-title">{selected.getFullYear()}년 {selected.getMonth() + 1}월 {selected.getDate()}일 <span>{['일', '월', '화', '수', '목', '금', '토'][selected.getDay()]}요일</span></h2>{holiday && <p className="home-holiday">{holiday}</p>}</div><button type="button" className="home-dialog-close" aria-label="날짜 상세 닫기" onClick={onClose}><X size={20} /></button></div>
    <div className="home-day-dialog-nav"><span>일정 <strong>{events.length}건</strong></span><div><button type="button" onClick={() => onMove(-1)}><ChevronLeft size={15} />이전 날짜</button><button type="button" onClick={() => onMove(1)}>다음 날짜<ChevronRight size={15} /></button></div></div>
    <div className="home-day-dialog-body">
      <section className="home-dialog-events"><h3><CalendarDays size={17} />이날의 일정</h3>{events.length ? events.map(event => <article key={event.id} className={`home-dialog-event ${event.category}`}><span className="home-dialog-time">{event.time}</span><div><h4>{event.title}</h4>{event.note && <p>{event.note}</p>}</div></article>) : <p className="home-dialog-empty">이날 일정이 없습니다.</p>}</section>
    </div>
  </dialog>
}
