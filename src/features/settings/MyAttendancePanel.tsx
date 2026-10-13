import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarDays, ChevronLeft, ChevronRight, List, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/lib/supabase/auth'
import { useRenderWatch } from '@/lib/diagnostics'
import { emptyList } from '@/lib/utils'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { listMyAttendanceClocks } from '@/lib/supabase/attendance-clocks'
import { listLeaveRequests, type LeaveRequest } from '@/lib/supabase/leave-requests'
import { useMyClockIn } from '@/features/home/use-my-clock-in'
import { monthLabel, shiftMonth } from '@/features/operations-support/monthly-attendance'
import { koreanHolidayLabel, koreanHolidayNames } from '@/features/operations-support/korean-holidays'
import { requestLabel } from './personal-requests'
import { attendanceMonthDates, buildMyAttendance, clockOutLabel, koreaDateKey, validAttendanceMonth, type AttendanceClock, type AttendanceDay } from './my-attendance'
import './my-attendance.css'

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']
function dayOfWeek(date: string) { return new Date(`${date}T12:00:00+09:00`).getUTCDay() }

export function MyAttendancePanel() {
  useRenderWatch('MyAttendancePanel')
  const { session, profile } = useAuth()
  const userId = session?.user.id
  const allowed = Boolean(userId) && profile?.status === 'active'
  const active = useWorkspaceTabActivity()
  const today = koreaDateKey()
  const [month, setMonth] = useState(() => today.slice(0, 7))
  const [view, setView] = useState<'calendar' | 'list'>('calendar')
  const [selected, setSelected] = useState(today)
  const clock = useMyClockIn()
  const clocks = useQuery({
    queryKey: ['attendance-clock-ins', userId, 'month', month, allowed],
    queryFn: () => listMyAttendanceClocks(userId!, month), enabled: allowed,
    refetchInterval: allowed && active ? 30_000 : false,
  })
  const leaves = useQuery({
    queryKey: ['company-leave-requests', userId, 'attendance-month', month, allowed],
    queryFn: () => {
      const dates = attendanceMonthDates(month)
      return listLeaveRequests(userId!, false, { from: dates[0], to: dates[dates.length - 1], approvedOnly: true })
    }, enabled: allowed, refetchInterval: allowed && active ? 30_000 : false,
  })
  const error = clocks.error || leaves.error
  useEffect(() => { if (error) console.warn('[my-attendance] 월별 본인 근태 조회 실패', { month, error }) }, [month, error])
  const clockRows = allowed ? clocks.data ?? emptyList<AttendanceClock>() : emptyList<AttendanceClock>()
  const requests = allowed ? leaves.data ?? emptyList<LeaveRequest>() : emptyList<LeaveRequest>()
  const days = useMemo(() => buildMyAttendance(month, clockRows, requests, today), [month, clockRows, requests, today])
  const loading = allowed && (clocks.isPending || leaves.isPending)
  const unavailable = !allowed || loading || Boolean(error)
  const recorded = days.filter(day => day.clockIn).length
  const completed = days.filter(day => day.clockOutAt).length
  const leaveCount = new Set(days.flatMap(day => day.leaves.map(leave => leave.id))).size
  const detail = days.find(day => day.date === selected) ?? days[0]
  const refreshing = clocks.isFetching || leaves.isFetching || clock.saving

  function chooseMonth(next: string) {
    if (!validAttendanceMonth(next)) return
    setMonth(next)
    setSelected(next === today.slice(0, 7) ? today : `${next}-01`)
  }
  function refresh() { void clocks.refetch(); void leaves.refetch(); void clock.refresh() }
  function record(action: 'in' | 'out') {
    void (action === 'in' ? clock.clockIn() : clock.clockOut()).catch(error => {
      console.warn('[my-attendance] 출퇴근 버튼 저장 실패', { action, error })
    })
  }
  function leaveLabels(day: AttendanceDay) {
    return day.leaves.map(leave => <span className="my-attendance-leave" key={leave.id}>{requestLabel(leave.kind)}{day.future ? ' 예정' : ''}{leave.kind !== 'annual' && <small>{leave.start}–{leave.end}</small>}</span>)
  }

  return <section className="my-attendance" aria-label="내 월별 근태">
    <header className="my-attendance-heading"><div><p className="text-xs text-muted-foreground">내 근무 기록</p><h2>월별 근태</h2><p>출근·퇴근 시각과 승인된 휴가를 날짜별로 확인하세요.</p></div><Button variant="outline" size="sm" disabled={refreshing || !allowed} onClick={refresh}><RefreshCw size={14} />새로고침</Button></header>
    <div className="my-attendance-today"><div><strong>오늘 · {today.slice(5).replace('-', '.')}</strong><span>출근 <b>{clock.loading || clock.queryError ? '—' : clock.todayClock || (clock.exempt ? '제외' : '미기록')}</b></span><span>퇴근 <b>{clock.loading || clock.queryError ? '—' : clock.todayClockOut || (clock.exempt ? '제외' : '미기록')}</b></span></div><div>{clock.exempt ? <span className="text-sm text-muted-foreground">출퇴근 기록 제외 직책입니다. 출근·퇴근을 기록하지 않습니다.</span> : <>{clock.needsClockIn && <Button disabled={clock.saving} onClick={() => record('in')}>{clock.saving ? '저장 중…' : '출근하기'}</Button>}{clock.needsClockOut && <Button disabled={clock.saving} onClick={() => record('out')}>{clock.saving ? '저장 중…' : '퇴근하기'}</Button>}{clock.todayClockOut && <Button variant="outline" disabled={clock.saving} onClick={() => { void clock.undoClockOut().catch(error => console.warn('[my-attendance] 퇴근 취소 실패', error)) }}>{clock.saving ? '저장 중…' : '퇴근 무르기'}</Button>}</>}</div></div>
    {clock.error && <p role="alert" className="text-sm text-danger">{clock.error}</p>}
    {clock.queryError && <p role="alert" className="text-sm text-danger">오늘의 출퇴근 기록을 불러오지 못했습니다. <button type="button" className="underline" onClick={() => void clock.refresh()}>다시 불러오기</button></p>}
    <div className="my-attendance-toolbar"><div className="my-attendance-month"><Button variant="outline" size="icon" aria-label="내 근태 이전 월" onClick={() => chooseMonth(shiftMonth(month, -1))}><ChevronLeft size={16}/></Button><Input type="month" aria-label="내 근태 조회 월" value={month} onChange={event => chooseMonth(event.target.value)}/><Button variant="outline" size="icon" aria-label="내 근태 다음 월" onClick={() => chooseMonth(shiftMonth(month, 1))}><ChevronRight size={16}/></Button><Button variant="ghost" size="sm" onClick={() => chooseMonth(today.slice(0, 7))}>이번 달</Button></div><div role="group" aria-label="내 근태 보기 방식"><Button variant={view === 'calendar' ? 'default' : 'outline'} size="sm" aria-pressed={view === 'calendar'} onClick={() => setView('calendar')}><CalendarDays size={14}/>달력</Button><Button variant={view === 'list' ? 'default' : 'outline'} size="sm" aria-pressed={view === 'list'} onClick={() => setView('list')}><List size={14}/>목록</Button></div></div>
    <div className="my-attendance-stats"><div><span>출근 기록</span><strong>{unavailable ? '—' : `${recorded}일`}</strong></div><div><span>퇴근 기록</span><strong>{unavailable ? '—' : `${completed}일`}</strong></div><div><span>승인된 휴가</span><strong>{unavailable ? '—' : `${leaveCount}건`}</strong><small>이달 연차·반차·반반차 일정</small></div></div>
    {unavailable ? <div className="my-attendance-empty" role={error ? 'alert' : 'status'}>{!allowed ? '활성 직원 계정으로 로그인해 주세요.' : loading ? '내 근태를 불러오는 중…' : <><p>월별 근태를 불러오지 못했습니다.</p><Button variant="outline" size="sm" onClick={refresh}>다시 불러오기</Button></>}</div> : <>
      {recorded === 0 && leaveCount === 0 && <p className="text-sm text-muted-foreground">{monthLabel(month)}에 저장된 출퇴근·승인 휴가 기록이 없습니다.</p>}
      {view === 'calendar' ? <><div className="my-attendance-calendar" role="group" aria-label={`${monthLabel(month)} 근태 달력`}>
        {WEEKDAYS.map(weekday => <div className="my-attendance-weekday" key={weekday}>{weekday}</div>)}
        {Array.from({ length: dayOfWeek(days[0].date) }, (_, index) => <div className="my-attendance-blank" key={`blank-${index}`} aria-hidden="true"/>)}
        {days.map(day => { const holiday = koreanHolidayLabel(koreanHolidayNames(day.date)); const weekend = [0, 6].includes(dayOfWeek(day.date)); return <button type="button" className={`my-attendance-day${weekend || holiday ? ' is-holiday' : ''}${day.date === selected ? ' is-selected' : ''}`} key={day.date} aria-pressed={day.date === selected} aria-label={`${day.date} 출근 ${day.clockIn || '미기록'} 퇴근 ${clockOutLabel(day.clockOutAt) || '미기록'} ${day.leaves.map(leave => requestLabel(leave.kind)).join(' ')}`} onClick={() => setSelected(day.date)}><div className="my-attendance-day-number"><strong className={day.date === today ? 'is-today' : ''}>{Number(day.date.slice(8))}</strong>{day.date === today && <small>오늘</small>}</div>{holiday && <span className="my-attendance-holiday">{holiday}</span>}{day.clockIn && <span className="my-attendance-time">출근 <b>{day.clockIn}</b></span>}{day.clockOutAt && <span className="my-attendance-time">퇴근 <b>{clockOutLabel(day.clockOutAt)}</b></span>}{leaveLabels(day)}{!day.clockIn && !day.leaves.length && <span className="my-attendance-no-record">{day.future ? '—' : '기록 없음'}</span>}</button> })}
      </div><div className="my-attendance-detail"><h3>{detail.date} ({WEEKDAYS[dayOfWeek(detail.date)]})</h3><div><span>출근 <b>{detail.clockIn || '미기록'}</b></span><span>퇴근 <b>{clockOutLabel(detail.clockOutAt) || '미기록'}</b></span>{leaveLabels(detail)}{detail.leaves.length === 0 && <span className="text-muted-foreground">승인된 휴가 없음</span>}</div></div></> : <div className="my-attendance-table-scroll"><table><caption className="sr-only">{monthLabel(month)} 내 출퇴근과 승인된 휴가</caption><thead><tr><th scope="col">날짜</th><th scope="col">출근</th><th scope="col">퇴근</th><th scope="col">휴가</th></tr></thead><tbody>{days.map(day => <tr key={day.date}><th scope="row">{day.date.slice(5).replace('-', '.')} ({WEEKDAYS[dayOfWeek(day.date)]})<small>{koreanHolidayLabel(koreanHolidayNames(day.date))}</small></th><td>{day.clockIn || (day.future ? '—' : '미기록')}</td><td>{clockOutLabel(day.clockOutAt) || (day.future ? '—' : '미기록')}</td><td>{day.leaves.length ? leaveLabels(day) : '—'}</td></tr>)}</tbody></table></div>}
      <p className="my-attendance-footnote">휴가는 승인된 신청을 표시합니다. 미래 날짜는 예정이며, 미기록만으로 결근이나 연차 사용을 판단하지 않습니다.</p>
    </>}
  </section>
}
