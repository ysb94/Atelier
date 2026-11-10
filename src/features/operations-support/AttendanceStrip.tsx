import { EMPTY_ATTENDANCE, isWorkday, monthDates, recordTiming, type AttendanceRecords, type AttendanceSchedule, type WorkdayOverrides } from './monthly-attendance'

type StripState = 'ok' | 'after' | 'exceeded' | 'leave' | 'half' | 'absent' | 'missing' | 'planned' | 'excluded'

const STRIP_LABEL: Record<StripState, string> = {
  ok: '정시', after: '정시 이후', exceeded: '기준 초과', leave: '연차·공가', half: '반차', absent: '결근', missing: '미기록', planned: '남은 근무일', excluded: '집계 전',
}

/** 한 달 근무일을 칸 하나씩 보이는 줄(시안). 판정은 개인 달력과 같은 recordTiming을 쓴다. */
export function AttendanceStrip({ month, memberId, records, schedule, overrides, today, trackingStart }: {
  month: string; memberId: string; records: AttendanceRecords; schedule: AttendanceSchedule
  overrides: WorkdayOverrides; today: string; trackingStart: string
}) {
  const days = monthDates(month).filter(date => isWorkday(date, overrides)).map(date => {
    const record = records[date]?.[memberId] ?? EMPTY_ATTENDANCE
    const timing = recordTiming(record, schedule)
    const state: StripState = date < trackingStart ? 'excluded'
      : record.status === 'unset' ? (date > today ? 'planned' : 'missing')
      : record.status === 'annual' || record.status === 'official' ? 'leave'
      : record.status === 'absent' ? 'absent'
      : timing.exceeded ? 'exceeded'
      : timing.after ? 'after'
      : record.status === 'half-am' || record.status === 'half-pm' ? 'half'
      : 'ok'
    // 월요일마다 간격을 둬서 주 단위로 끊어 보이게 한다.
    return { date, state, weekStart: new Date(`${date}T12:00:00`).getDay() === 1 }
  })
  const counted = days.filter(day => day.state !== 'planned' && day.state !== 'excluded')
  const summary = (Object.keys(STRIP_LABEL) as StripState[])
    .map(state => [state, counted.filter(day => day.state === state).length] as const)
    .filter(([, count]) => count > 0)
    .map(([state, count]) => `${STRIP_LABEL[state]} ${count}일`)
    .join(', ')
  return (
    <span className="attendance-strip" role="img" aria-label={summary ? `${month} 출근 기록: ${summary}` : `${month} 출근 기록 없음`}>
      {days.map((day, index) => (
        <i key={day.date} className={`is-${day.state}${day.weekStart && index > 0 ? ' is-week' : ''}`} title={`${Number(day.date.slice(5, 7))}/${Number(day.date.slice(8))} ${STRIP_LABEL[day.state]}`} />
      ))}
    </span>
  )
}

/** 월별 근태 표 아래 범례. */
export function AttendanceStripLegend() {
  return (
    <ul className="attendance-strip-legend" aria-label="출근 기록 줄 색 설명">
      {(['ok', 'after', 'exceeded', 'leave', 'half', 'absent', 'missing', 'planned'] as StripState[]).map(state => (
        <li key={state}><i className={`is-${state}`} aria-hidden="true" />{STRIP_LABEL[state]}</li>
      ))}
      <li>칸 묶음 하나가 한 주입니다</li>
    </ul>
  )
}
