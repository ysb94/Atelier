import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FilterTabs } from '@/components/ui/filter-tabs'
import { Input, Select } from '@/components/ui/input'
import { useRenderWatch } from '@/lib/diagnostics'
import { listCompanyAttendanceClocks, type CompanyAttendanceClock } from '@/lib/supabase/attendance-clocks'
import { countLateStatementsAwaitingHr, listLateArrivalStatements, type LateArrivalStatement } from '@/lib/supabase/late-arrival-statements'
import { LateArrivalStatementDocument } from '@/features/home/LateArrivalClockIn'
import { listLeaveRequests, type LeaveRequest } from '@/lib/supabase/leave-requests'
import { emptyList } from '@/lib/utils'
import type { RequestKind } from '@/features/settings/personal-requests'
import { ATTENDANCE_GRACE_MINUTES, resolveAttendanceStart } from './attendance-start-settings'
import { memberLabel, OpsStat } from './OpsStat'
import { type useOpsDirectory } from './ops-directory'
import { type useAttendanceStartSettings } from './use-attendance-start-settings'
import { isWorkday, localDateKey, monthDates, monthLabel, shiftMonth, timeSeconds } from './monthly-attendance'

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']
const PAGE_SIZE = 25
const COVER_KINDS = new Set<RequestKind>(['annual', 'half', 'quarter', 'official', 'offsite', 'remote'])

function lateLabel(minutes: number) {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return [hours ? `${hours}시간` : '', rest || !hours ? `${rest}분` : ''].filter(Boolean).join(' ')
}
function seoulNowMinutes() {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date())
  const part = (type: string) => Number(parts.find(item => item.type === type)?.value ?? 0)
  return part('hour') * 60 + part('minute')
}
function dateLabel(date: string) {
  return `${date.slice(5).replace('-', '.')} (${WEEKDAYS[new Date(`${date}T12:00:00`).getDay()]})`
}

export function AttendanceLatePanel({ directory, schedules }: {
  directory: ReturnType<typeof useOpsDirectory>
  schedules: ReturnType<typeof useAttendanceStartSettings>
}) {
  useRenderWatch('AttendanceLatePanel')
  const today = localDateKey(new Date())
  const nowMinutes = seoulNowMinutes()
  const [month, setMonth] = useState(today.slice(0, 7))
  const [departmentId, setDepartmentId] = useState('all')
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState<'all' | 'late' | 'absent'>('all')
  const [page, setPage] = useState(1)
  const [statement, setStatement] = useState<LateArrivalStatement | null>(null)
  const monthOk = /^\d{4}-(0[1-9]|1[0-2])$/.test(month)
  const dates = useMemo(() => monthOk ? monthDates(month) : emptyList<string>(), [month, monthOk])
  const clocks = useQuery({
    queryKey: ['company-attendance-clocks', month],
    queryFn: () => listCompanyAttendanceClocks(month),
    enabled: monthOk,
  })
  const awaitingHr = useQuery({ queryKey: ['late-statements-awaiting-hr'], queryFn: countLateStatementsAwaitingHr })
  const statements = useQuery({
    queryKey: ['late-arrival-statements', month],
    queryFn: () => listLateArrivalStatements(dates[0], dates[dates.length - 1]),
    enabled: monthOk && dates.length > 0,
  })
  const leaves = useQuery({
    queryKey: ['company-leave-cover', month],
    queryFn: () => listLeaveRequests(undefined, false, { from: dates[0], to: dates[dates.length - 1] }),
    enabled: monthOk,
  })
  const clockRows = clocks.data ?? emptyList<CompanyAttendanceClock>()
  const leaveRows = leaves.data ?? emptyList<LeaveRequest>()
  const statementRows = statements.data ?? emptyList<LateArrivalStatement>()
  const statementByKey = useMemo(() => new Map(statementRows.map(item => [`${item.employeeId}:${item.date}`, item])), [statementRows])
  const needle = search.trim().toLocaleLowerCase('ko')
  const covered = useMemo(() => {
    const keys = new Set<string>()
    for (const request of leaveRows) {
      if ((request.status !== 'approved' && request.status !== 'pending') || !COVER_KINDS.has(request.kind)) continue
      for (const date of dates) if (request.from <= date && date <= request.to) keys.add(`${request.employeeId}:${date}`)
    }
    return keys
  }, [leaveRows, dates])
  const clockByKey = useMemo(() => new Map(clockRows.map(clock => [`${clock.employeeId}:${clock.date}`, clock.clockIn])), [clockRows])
  const rows = useMemo(() => {
    const next: { key: string; memberId: string; date: string; dateLabel: string; name: string; team: string; start: string; clockIn: string; result: string; kind: 'late' | 'absent' }[] = []
    const matches = (department: string | null, name: string, team: string) => {
      if (departmentId === 'unassigned' ? Boolean(department) : departmentId !== 'all' && department !== departmentId) return false
      return !needle || `${name} ${team}`.toLocaleLowerCase('ko').includes(needle)
    }
    for (const clock of clockRows) {
      const member = directory.members.find(item => item.id === clock.employeeId)
      if (!member || member.attendanceExempt || !isWorkday(clock.date, {})) continue
      const schedule = resolveAttendanceStart(schedules.index, member.id, member.departmentId, month)
      const actual = timeSeconds(clock.clockIn)
      const baseline = timeSeconds(schedule.start)
      if (actual == null || baseline == null || actual <= baseline + schedule.grace * 60) continue
      const team = directory.departmentName(member.departmentId)
      const name = memberLabel(member.displayName)
      if (!matches(member.departmentId, name, team)) continue
      next.push({ key: `late:${member.id}:${clock.date}`, memberId: member.id, date: clock.date, dateLabel: dateLabel(clock.date), name, team, start: schedule.start, clockIn: clock.clockIn, result: lateLabel(Math.floor((actual - baseline) / 60)), kind: 'late' })
    }
    for (const member of directory.members) {
      if (member.attendanceExempt) continue
      const team = directory.departmentName(member.departmentId)
      const name = memberLabel(member.displayName)
      if (!matches(member.departmentId, name, team)) continue
      const schedule = resolveAttendanceStart(schedules.index, member.id, member.departmentId, month)
      const baseline = timeSeconds(schedule.start)
      for (const date of dates) {
        if (date > today || !isWorkday(date, {}) || clockByKey.has(`${member.id}:${date}`) || covered.has(`${member.id}:${date}`)) continue
        if (date === today && (baseline == null ? nowMinutes < 18 * 60 : nowMinutes * 60 <= baseline + schedule.grace * 60)) continue
        next.push({ key: `absent:${member.id}:${date}`, memberId: member.id, date, dateLabel: dateLabel(date), name, team, start: schedule.start || '미설정', clockIn: '없음', result: '결근', kind: 'absent' })
      }
    }
    return next.sort((a, b) => b.date.localeCompare(a.date) || Number(a.kind === 'late') - Number(b.kind === 'late') || a.name.localeCompare(b.name, 'ko'))
  }, [clockRows, clockByKey, covered, dates, directory, schedules.index, month, departmentId, needle, today, nowMinutes])
  const lateRows = rows.filter(row => row.kind === 'late')
  const absentRows = rows.filter(row => row.kind === 'absent')
  const latePeople = new Set(lateRows.map(row => row.memberId)).size
  const absentPeople = new Set(absentRows.map(row => row.memberId)).size
  const visibleRows = kind === 'late' ? lateRows : kind === 'absent' ? absentRows : rows
  const pages = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE))
  const currentPage = Math.min(page, pages)
  const pageRows = visibleRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const emptyLabel = kind === 'late'
    ? '이 조건의 지각 기록이 없습니다.'
    : kind === 'absent'
      ? '이 조건의 결근 기록이 없습니다.'
      : '이 조건의 지각·결근 기록이 없습니다.'
  const unavailable = directory.loading || schedules.loading || clocks.isPending || leaves.isPending
  function chooseMonth(next: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(next)) return
    setMonth(next)
    setPage(1)
  }

  return <div className="space-y-4">
    <header>
      <h2 className="text-base font-semibold">지각 * 결근 관리</h2>
      <p className="mt-1 text-sm text-muted-foreground">출근 기준에서 {ATTENDANCE_GRACE_MINUTES}분이 지난 기록은 지각입니다. 연차·반차·반반차·공가·외근·재택이 등록되지 않은 근무일에 출근이 없으면 결근으로 표시합니다. 인사 확인 대기 {awaitingHr.isPending ? '…' : awaitingHr.isError ? '확인 실패' : `${awaitingHr.data ?? 0}건`}입니다.</p>
    </header>
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="icon" aria-label="이전 월" onClick={() => chooseMonth(shiftMonth(month, -1))}><ChevronLeft size={15} /></Button>
      <Input aria-label="지각·결근 월" type="month" className="h-9 w-40" value={month} onChange={event => chooseMonth(event.target.value)} />
      <Button variant="outline" size="icon" aria-label="다음 월" onClick={() => chooseMonth(shiftMonth(month, 1))}><ChevronRight size={15} /></Button>
      <Button variant="ghost" size="sm" onClick={() => chooseMonth(today.slice(0, 7))}>이번 달</Button>
      <Select aria-label="지각·결근 부서" value={departmentId} onChange={event => { setDepartmentId(event.target.value); setPage(1) }} className="h-9 w-40">
        <option value="all">전체 부서</option>
        {directory.departments.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        <option value="unassigned">소속 없음</option>
      </Select>
      <div className="relative min-w-[210px] flex-1">
        <Search size={15} className="absolute left-3 top-2.5 text-muted-foreground" />
        <Input aria-label="지각·결근 검색" placeholder="직원·부서 검색" className="h-9 pl-9" value={search} onChange={event => { setSearch(event.target.value); setPage(1) }} />
      </div>
    </div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <OpsStat label="지각한 직원" value={unavailable ? '—' : `${latePeople}명`} detail={monthLabel(month)} />
      <OpsStat label="지각 기록" value={unavailable ? '—' : `${lateRows.length}건`} detail={`기준 +${ATTENDANCE_GRACE_MINUTES}분 초과`} />
      <OpsStat label="결근한 직원" value={unavailable ? '—' : `${absentPeople}명`} detail="등록 없이 출근 없음" />
      <OpsStat label="결근 기록" value={unavailable ? '—' : `${absentRows.length}건`} detail="오늘까지의 근무일" />
    </div>
    <FilterTabs
      ariaLabel="지각·결근 구분"
      value={kind}
      onChange={(next) => { setKind(next); setPage(1) }}
      tabs={[
        { value: 'all', label: '전체', count: unavailable ? undefined : rows.length },
        { value: 'late', label: '지각만', count: unavailable ? undefined : lateRows.length },
        { value: 'absent', label: '결근만', count: unavailable ? undefined : absentRows.length },
      ]}
    />
    {(clocks.error || leaves.error || statements.error) && <p role="alert" className="text-sm text-danger">출근 기록, 신청 또는 지각 사유서를 불러오지 못했습니다. <Button variant="outline" size="sm" onClick={() => { void clocks.refetch(); void leaves.refetch(); void statements.refetch() }}>다시 불러오기</Button></p>}
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{monthLabel(month)} 지각·결근</caption>
        <thead className="bg-primary text-primary-foreground">
          <tr>{['날짜', '구분', '직원', '부서', '출근 기준', '출근 시각', '내용', '사유서'].map(label => <th key={label} className={`px-3 py-2 font-medium${label === '사유서' ? ' text-right' : ''}`}>{label}</th>)}</tr>
        </thead>
        <tbody>
          {unavailable ? <tr><td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">출근과 신청을 확인하고 있습니다.</td></tr>
            : pageRows.length ? pageRows.map(row => {
              const attached = statementByKey.get(`${row.memberId}:${row.date}`)
              return <tr key={row.key} className="border-t border-border">
              <td className="px-3 py-2">{row.dateLabel}</td>
              <td className="px-3 py-2">{row.kind === 'late' ? '지각' : '결근'}</td>
              <td className="px-3 py-2 font-medium">{row.name}</td>
              <td className="px-3 py-2">{row.team}</td>
              <td className="px-3 py-2">{row.start}</td>
              <td className="px-3 py-2">{row.clockIn}</td>
              <td className="px-3 py-2 font-medium text-danger">{row.result}</td>
              <td className="px-3 py-2 text-right">{row.kind !== 'late' ? <span className="text-muted-foreground">—</span> : statements.isPending ? '…' : statements.error ? '조회 실패' : attached ? <span className="inline-flex items-center justify-end gap-2">{attached.hrConfirmedAt ? <span className="text-xs text-muted-foreground">확인됨</span> : attached.managerConfirmedAt ? <span className="text-xs text-warning">인사 대기</span> : null}<Button type="button" size="sm" variant="outline" onClick={() => setStatement(attached)}>사유서</Button></span> : <span className="text-muted-foreground">없음</span>}</td>
            </tr>}) : <tr><td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">{clocks.error || leaves.error ? '기록을 불러오지 못했습니다.' : emptyLabel}</td></tr>}
        </tbody>
      </table>
      {!unavailable && visibleRows.length > PAGE_SIZE && <nav className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-muted-foreground" aria-label="지각·결근 페이지">
        <span>{(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, visibleRows.length)} / {visibleRows.length}건</span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>이전</Button>
          <span>{currentPage} / {pages}</span>
          <Button variant="outline" size="sm" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>다음</Button>
        </div>
      </nav>}
    </div>
    {statement && <div className="fixed inset-0 z-50 grid place-items-center bg-background/75 p-4" role="dialog" aria-label="지각 사유서"><LateArrivalStatementDocument statement={statement} review="hr" onClose={() => setStatement(null)} onUpdated={setStatement} /></div>}
  </div>
}
