import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { useRenderWatch } from '@/lib/diagnostics'
import { listCompanyAttendanceSpans, type CompanyAttendanceSpan } from '@/lib/supabase/attendance-clocks'
import { listLeaveRequests, type LeaveRequest } from '@/lib/supabase/leave-requests'
import { loadCompanyLunch } from '@/lib/supabase/company-work-hours'
import { emptyList } from '@/lib/utils'
import { monthlyOvertimeHours, workDurationLabel } from './overtime-hours'
import { memberLabel, OpsStat } from './OpsStat'
import { type useOpsDirectory } from './ops-directory'
import { localDateKey, monthDates, monthLabel, shiftMonth } from './monthly-attendance'

const PAGE_SIZE = 25

export function AttendanceOvertimePanel({ directory }: { directory: ReturnType<typeof useOpsDirectory> }) {
  useRenderWatch('AttendanceOvertimePanel')
  const today = localDateKey(new Date())
  const [month, setMonth] = useState(today.slice(0, 7))
  const [departmentId, setDepartmentId] = useState('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const monthOk = /^\d{4}-(0[1-9]|1[0-2])$/.test(month)
  const dates = useMemo(() => monthOk ? monthDates(month) : emptyList<string>(), [month, monthOk])
  const spans = useQuery({
    queryKey: ['company-attendance-spans', month],
    queryFn: () => listCompanyAttendanceSpans(month),
    enabled: monthOk,
  })
  const leaves = useQuery({
    queryKey: ['company-leave-cover', month],
    queryFn: () => listLeaveRequests(undefined, false, { from: dates[0], to: dates[dates.length - 1] }),
    enabled: monthOk && dates.length > 0,
  })
  const lunch = useQuery({ queryKey: ['company-work-hours'], queryFn: loadCompanyLunch })
  useEffect(() => {
    if (spans.error) console.warn('[attendance-work] 야근 근무시간 조회 실패', spans.error)
    if (leaves.error) console.warn('[attendance-work] 야근 신청 조회 실패', leaves.error)
    if (lunch.error) console.warn('[attendance-work] 점심시간 조회 실패', lunch.error)
  }, [spans.error, leaves.error, lunch.error])
  const spanRows = spans.data ?? emptyList<CompanyAttendanceSpan>()
  const leaveRows = leaves.data ?? emptyList<LeaveRequest>()
  const lunchHours = lunch.data ?? { start: '12:00', end: '13:00', saved: false }
  const needle = search.trim().toLocaleLowerCase('ko')
  const summaries = useMemo(
    () => monthOk ? monthlyOvertimeHours(spanRows, leaveRows, lunchHours.start, lunchHours.end, month, today) : [],
    [monthOk, spanRows, leaveRows, lunchHours.start, lunchHours.end, month, today],
  )
  const rows = useMemo(() => summaries.flatMap(summary => {
    const member = directory.members.find(item => item.id === summary.employeeId)
    if (!member) return []
    const team = directory.departmentName(member.departmentId)
    const name = memberLabel(member.displayName)
    if (departmentId === 'unassigned' ? Boolean(member.departmentId) : departmentId !== 'all' && member.departmentId !== departmentId) return []
    if (needle && !`${name} ${team}`.toLocaleLowerCase('ko').includes(needle)) return []
    return [{ ...summary, name, team }]
  }).sort((left, right) => right.extraMinutes - left.extraMinutes || right.approvedMinutes - left.approvedMinutes || left.name.localeCompare(right.name, 'ko')), [summaries, directory, departmentId, needle])
  const extraPeople = rows.filter(row => row.extraMinutes > 0).length
  const extraMinutes = rows.reduce((sum, row) => sum + row.extraMinutes, 0)
  const openDays = rows.reduce((sum, row) => sum + row.openDays, 0)
  const approvedMinutes = rows.reduce((sum, row) => sum + row.approvedMinutes, 0)
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const currentPage = Math.min(page, pages)
  const pageRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const unavailable = directory.loading || spans.isPending || leaves.isPending || lunch.isPending
  const failed = Boolean(spans.error || leaves.error)
  function chooseMonth(next: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(next)) return
    setMonth(next)
    setPage(1)
  }

  return <div className="space-y-4">
    <header>
      <h2 className="text-base font-semibold">야근 관리</h2>
      <p className="mt-1 text-sm text-muted-foreground">출퇴근에서 점심시간을 뺀 뒤, 평일 8시간·반차 4시간·반반차 6시간을 넘는 시간을 이번 달 추가 근무로 모읍니다. 휴일 출근은 근무시간 전체를 추가 근무로 봅니다. 직원별 포괄임금 기준은 아직 없어서, 그 기준을 넘는 수당 대상은 나중에 이 시간에 비교합니다.</p>
    </header>
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="icon" aria-label="이전 월" onClick={() => chooseMonth(shiftMonth(month, -1))}><ChevronLeft size={15} /></Button>
      <Input aria-label="야근 관리 월" type="month" className="h-9 w-40" value={month} onChange={event => chooseMonth(event.target.value)} />
      <Button variant="outline" size="icon" aria-label="다음 월" onClick={() => chooseMonth(shiftMonth(month, 1))}><ChevronRight size={15} /></Button>
      <Button variant="ghost" size="sm" onClick={() => chooseMonth(today.slice(0, 7))}>이번 달</Button>
      <Select aria-label="야근 관리 부서" value={departmentId} onChange={event => { setDepartmentId(event.target.value); setPage(1) }} className="h-9 w-40">
        <option value="all">전체 부서</option>
        {directory.departments.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        <option value="unassigned">소속 없음</option>
      </Select>
      <div className="relative min-w-[210px] flex-1">
        <Search size={15} className="absolute left-3 top-2.5 text-muted-foreground" />
        <Input aria-label="야근 관리 검색" placeholder="직원·부서 검색" className="h-9 pl-9" value={search} onChange={event => { setSearch(event.target.value); setPage(1) }} />
      </div>
    </div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <OpsStat label="추가 근무 직원" value={unavailable ? '—' : `${extraPeople}명`} detail={monthLabel(month)} />
      <OpsStat label="추가 근무 합계" value={unavailable ? '—' : workDurationLabel(extraMinutes)} detail="8시간을 넘는 기록" />
      <OpsStat label="승인된 야근" value={unavailable ? '—' : workDurationLabel(approvedMinutes)} detail="신청 시각의 합" />
      <OpsStat label="퇴근 없는 날" value={unavailable ? '—' : `${openDays}일`} detail="추가 근무에 넣지 않음" />
    </div>
    {failed && <p role="alert" className="text-sm text-danger">출퇴근 또는 야근 신청을 불러오지 못했습니다. <Button variant="outline" size="sm" onClick={() => { void spans.refetch(); void leaves.refetch() }}>다시 불러오기</Button></p>}
    {!lunch.data?.saved && !lunch.isPending && !lunch.error && <p className="text-sm text-muted-foreground">저장된 점심시간이 없어 12:00–13:00을 빼고 계산합니다.</p>}
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <caption className="sr-only">{monthLabel(month)} 야근 관리</caption>
          <thead className="bg-primary text-primary-foreground">
            <tr>{['직원', '부서', '출퇴근 완료', '퇴근 없음', '실제 근무', '추가 근무', '승인 야근'].map(label => <th key={label} className="px-3 py-2 font-medium">{label}</th>)}</tr>
          </thead>
          <tbody>
            {unavailable ? <tr><td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">출퇴근과 야근 신청을 확인하고 있습니다.</td></tr>
              : pageRows.length ? pageRows.map(row => <tr key={row.employeeId} className="border-t border-border">
                <td className="px-3 py-2 font-medium">{row.name}</td>
                <td className="px-3 py-2">{row.team}</td>
                <td className="px-3 py-2">{row.completeDays}일</td>
                <td className="px-3 py-2">{row.openDays ? `${row.openDays}일` : '—'}</td>
                <td className="px-3 py-2">{workDurationLabel(row.workedMinutes)}</td>
                <td className={`px-3 py-2 font-medium${row.extraMinutes ? ' text-danger' : ''}`}>{workDurationLabel(row.extraMinutes)}</td>
                <td className="px-3 py-2">{workDurationLabel(row.approvedMinutes)}</td>
              </tr>) : <tr><td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">{failed ? '기록을 불러오지 못했습니다.' : '이 조건의 근무 기록이 없습니다.'}</td></tr>}
          </tbody>
        </table>
      </div>
      {!unavailable && rows.length > PAGE_SIZE && <nav className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-muted-foreground" aria-label="야근 관리 페이지">
        <span>{(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, rows.length)} / {rows.length}명</span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>이전</Button>
          <span>{currentPage} / {pages}</span>
          <Button variant="outline" size="sm" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>다음</Button>
        </div>
      </nav>}
    </div>
  </div>
}
