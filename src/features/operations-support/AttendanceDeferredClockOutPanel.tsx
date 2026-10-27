import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { useRenderWatch } from '@/lib/diagnostics'
import { listCompanyDeferredClockOuts, type CompanyDeferredClockOut } from '@/lib/supabase/attendance-clocks'
import { emptyList } from '@/lib/utils'
import { deferredClockOutViews } from './deferred-clock-outs'
import { memberLabel, OpsStat } from './OpsStat'
import { type useOpsDirectory } from './ops-directory'
import { localDateKey, monthLabel, shiftMonth } from './monthly-attendance'

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']
const PAGE_SIZE = 25

function dateLabel(date: string) {
  return `${date.slice(5).replace('-', '.')} (${WEEKDAYS[new Date(`${date}T12:00:00`).getDay()]})`
}

export function AttendanceDeferredClockOutPanel({ directory }: { directory: ReturnType<typeof useOpsDirectory> }) {
  useRenderWatch('AttendanceDeferredClockOutPanel')
  const today = localDateKey(new Date())
  const [month, setMonth] = useState(today.slice(0, 7))
  const [departmentId, setDepartmentId] = useState('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const clocks = useQuery({
    queryKey: ['company-deferred-clock-outs'],
    queryFn: listCompanyDeferredClockOuts,
  })
  useEffect(() => {
    if (clocks.error) console.warn('[attendance-work] 퇴근 미처리 조회 실패', clocks.error)
  }, [clocks.error])
  const records = clocks.data ?? emptyList<CompanyDeferredClockOut>()
  const monthOk = /^\d{4}-(0[1-9]|1[0-2])$/.test(month)
  const needle = search.trim().toLocaleLowerCase('ko')
  const views = useMemo(() => monthOk ? deferredClockOutViews(records, month) : [], [records, month, monthOk])
  const rows = useMemo(() => views.flatMap(view => {
    const member = directory.members.find(item => item.id === view.employeeId)
    const team = member ? directory.departmentName(member.departmentId) : '소속 없음'
    const name = memberLabel(member?.displayName ?? null)
    if (departmentId === 'unassigned' ? Boolean(member?.departmentId) : departmentId !== 'all' && member?.departmentId !== departmentId) return []
    if (needle && !`${name} ${team}`.toLocaleLowerCase('ko').includes(needle)) return []
    return [{ ...view, name, team }]
  }).sort((left, right) => right.totalCount - left.totalCount || right.date.localeCompare(left.date) || left.name.localeCompare(right.name, 'ko')), [views, directory, departmentId, needle])
  const people = new Set(rows.map(row => row.employeeId)).size
  const cumulativePeople = new Set(records.map(row => row.employeeId)).size
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const currentPage = Math.min(page, pages)
  const pageRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const unavailable = directory.loading || clocks.isPending
  function chooseMonth(next: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(next)) return
    setMonth(next)
    setPage(1)
  }

  return <div className="space-y-4">
    <header>
      <h2 className="text-base font-semibold">퇴근 미처리</h2>
      <p className="mt-1 text-sm text-muted-foreground">퇴근 시각이 지나도 퇴근을 누르지 않고, 다음 날 출근하면서 직전 퇴근을 입력한 기록입니다. 누적은 같은 사람이 이 방식으로 처리한 전체 횟수입니다.</p>
    </header>
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="icon" aria-label="이전 월" onClick={() => chooseMonth(shiftMonth(month, -1))}><ChevronLeft size={15} /></Button>
      <Input aria-label="퇴근 미처리 월" type="month" className="h-9 w-40" value={month} onChange={event => chooseMonth(event.target.value)} />
      <Button variant="outline" size="icon" aria-label="다음 월" onClick={() => chooseMonth(shiftMonth(month, 1))}><ChevronRight size={15} /></Button>
      <Button variant="ghost" size="sm" onClick={() => chooseMonth(today.slice(0, 7))}>이번 달</Button>
      <Select aria-label="퇴근 미처리 부서" value={departmentId} onChange={event => { setDepartmentId(event.target.value); setPage(1) }} className="h-9 w-40">
        <option value="all">전체 부서</option>
        {directory.departments.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        <option value="unassigned">소속 없음</option>
      </Select>
      <div className="relative min-w-[210px] flex-1">
        <Search size={15} className="absolute left-3 top-2.5 text-muted-foreground" />
        <Input aria-label="퇴근 미처리 검색" placeholder="직원·부서 검색" className="h-9 pl-9" value={search} onChange={event => { setSearch(event.target.value); setPage(1) }} />
      </div>
    </div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      <OpsStat label="이번 달 처리한 직원" value={unavailable ? '—' : `${people}명`} detail={monthLabel(month)} />
      <OpsStat label="이번 달 처리" value={unavailable ? '—' : `${rows.length}건`} detail="다음 출근 때 입력" />
      <OpsStat label="전체 누적" value={unavailable ? '—' : `${cumulativePeople}명 · ${records.length}건`} detail="월과 관계없는 전체" />
    </div>
    {clocks.error && <p role="alert" className="text-sm text-danger">퇴근 미처리 기록을 불러오지 못했습니다. <Button variant="outline" size="sm" onClick={() => void clocks.refetch()}>다시 불러오기</Button></p>}
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{monthLabel(month)} 퇴근 미처리</caption>
        <thead className="bg-primary text-primary-foreground">
          <tr>{['근무일', '직원', '부서', '출근', '입력한 퇴근', '처리한 시각', '누적'].map(label => <th key={label} className="px-3 py-2 font-medium">{label}</th>)}</tr>
        </thead>
        <tbody>
          {unavailable ? <tr><td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">퇴근 미처리 기록을 확인하고 있습니다.</td></tr>
            : pageRows.length ? pageRows.map(row => <tr key={row.key} className="border-t border-border">
              <td className="px-3 py-2">{dateLabel(row.date)}</td>
              <td className="px-3 py-2 font-medium">{row.name}</td>
              <td className="px-3 py-2">{row.team}</td>
              <td className="px-3 py-2">{row.clockIn}</td>
              <td className="px-3 py-2">{row.clockOutText}</td>
              <td className="px-3 py-2">{row.reportedText}</td>
              <td className="px-3 py-2 font-medium">{row.totalCount}회</td>
            </tr>) : <tr><td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">{clocks.error ? '기록을 불러오지 못했습니다.' : '이 조건에서 다음 출근 때 퇴근을 입력한 기록이 없습니다.'}</td></tr>}
        </tbody>
      </table>
      {!unavailable && rows.length > PAGE_SIZE && <nav className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-muted-foreground" aria-label="퇴근 미처리 페이지">
        <span>{(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, rows.length)} / {rows.length}건</span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>이전</Button>
          <span>{currentPage} / {pages}</span>
          <Button variant="outline" size="sm" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>다음</Button>
        </div>
      </nav>}
    </div>
  </div>
}
