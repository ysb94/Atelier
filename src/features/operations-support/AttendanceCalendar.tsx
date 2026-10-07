import { koreanHolidayLabel, koreanHolidayNames } from './korean-holidays'
import { EMPTY_ATTENDANCE, isWorkday, monthDates, recordTiming, type AttendanceRecords, type AttendanceSchedule, type AttendanceStatus, type WorkdayOverrides } from './monthly-attendance'

const STATUS_LABEL: Record<AttendanceStatus, string> = {
  unset: '미기록', present: '출근', remote: '재택', annual: '연차', 'half-am': '오전 반차', 'half-pm': '오후 반차', official: '예비군·공가', absent: '결근', holiday: '휴무',
}

export function AttendanceCalendar({ month, memberId, records, schedule, overrides, today, selectedDate, onSelect }: {
  month: string; memberId: string; records: AttendanceRecords; schedule: AttendanceSchedule
  overrides: WorkdayOverrides; today: string; selectedDate?: string; onSelect?: (date: string) => void
}) {
  const dates = monthDates(month)
  const leading = (new Date(`${month}-01T12:00:00`).getDay() + 6) % 7
  return <div className="attendance-calendar-wrap">
    <div className="attendance-calendar" aria-label="직원 월별 출근 달력">
    {['월', '화', '수', '목', '금', '토', '일'].map(day => <span key={day} className={`attendance-calendar-weekday${day === '토' ? ' is-sat' : day === '일' ? ' is-sun' : ''}`}>{day}</span>)}
    {Array.from({ length: leading }, (_, i) => <span key={`blank-${i}`} className="attendance-calendar-blank" />)}
    {dates.map(date => {
      const record = records[date]?.[memberId] ?? EMPTY_ATTENDANCE
      const timing = recordTiming(record, schedule)
      const names = koreanHolidayNames(date)
      const holidayLabel = koreanHolidayLabel(names)
      const workday = isWorkday(date, overrides)
      const future = date > today
      const weekday = new Date(`${date}T12:00:00`).getDay()
      const nationalHoliday = names.length > 0 && !workday && record.status === 'unset'
      const status = record.status === 'unset' ? (!workday ? holidayLabel || '휴무' : future ? '예정' : '미기록') : STATUS_LABEL[record.status]
      const className = [
        'attendance-calendar-day',
        !workday ? 'is-off' : '',
        weekday === 6 ? 'is-sat' : '',
        weekday === 0 ? 'is-sun' : '',
        nationalHoliday ? 'is-holiday' : '',
        workday && record.status === 'unset' && !future ? 'is-missing' : '',
        workday && record.status === 'unset' && future ? 'is-planned' : '',
        record.status !== 'unset' ? `is-${record.status}` : '',
        date === today ? 'is-today' : '',
        timing.exceeded ? 'is-exceeded' : timing.after ? 'is-after' : '',
        selectedDate === date ? 'is-selected' : '',
      ].filter(Boolean).join(' ')
      const spoken = names.length && record.status === 'unset' ? names.join(', ') : `${status}${record.start ? ` ${record.start}` : ''}`
      const content = <><span className="attendance-calendar-date">{Number(date.slice(-2))}{record.reviewed && <span title="확인 완료">✓</span>}</span><strong>{record.start || status}</strong>{record.start && !['present', 'unset'].includes(record.status) && <small>{status}</small>}{record.note && <span className="attendance-calendar-note" title={record.note}>메모</span>}</>
      return onSelect ? <button key={date} type="button" className={className} aria-label={`${date} ${spoken}`} title={names.join(' · ') || undefined} aria-pressed={selectedDate === date} onClick={() => onSelect(date)}>{content}</button> : <div key={date} className={className} title={names.join(' · ') || undefined}>{content}</div>
    })}
    </div>
    <ul className="attendance-legend" aria-label="달력 색 설명">
      <li><i className="swatch-sat" aria-hidden="true" />토요일</li>
      <li><i className="swatch-sun" aria-hidden="true" />일요일</li>
      <li><i className="swatch-holiday" aria-hidden="true" />공휴일</li>
      <li><i className="swatch-missing" aria-hidden="true" />미기록</li>
    </ul>
  </div>
}
