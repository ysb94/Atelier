import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FilterTabs } from '@/components/ui/filter-tabs'
import { FilterBar } from '@/components/ui/filter-bar'
import { InfoNote } from '@/components/ui/info-note'
import { StatusPill } from '@/components/ui/status-pill'
import { Input } from '@/components/ui/input'
import { useRenderWatch } from '@/lib/diagnostics'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { listCompanyAttendanceClocks, listCompanyDeferredClockOuts, type CompanyAttendanceClock, type CompanyDeferredClockOut } from '@/lib/supabase/attendance-clocks'
import { countLateStatementsAwaitingHr, listLateArrivalStatements, type LateArrivalStatement } from '@/lib/supabase/late-arrival-statements'
import { LateArrivalStatementDocument } from '@/features/home/LateArrivalClockIn'
import { listLeaveRequests, type LeaveRequest } from '@/lib/supabase/leave-requests'
import { emptyList } from '@/lib/utils'
import type { RequestKind } from '@/features/settings/personal-requests'
import { ATTENDANCE_GRACE_MINUTES } from './attendance-start-settings'
import { attendanceTrackingStart } from './attendance-period'
import { resolveWorkdayStart } from './offsite-workday-start'
import { approvedQuarterIntervals, quarterArrivalStart } from './quarter-arrival'
import { deferredClockOutViews } from './deferred-clock-outs'
import { loadCompanyLunch } from '@/lib/supabase/company-work-hours'
import { MemberCell, memberLabel } from './OpsStat'
import { ScopeCards, departmentScopeCards, inDepartmentScope } from '@/components/ui/scope-cards'
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
/** 근무일부터 오늘까지 지난 날 수(시안의 D+N). */
function elapsedDays(date: string, today: string) {
  return Math.max(0, Math.round((Date.parse(`${today}T12:00:00`) - Date.parse(`${date}T12:00:00`)) / 86_400_000))
}

export type CheckKind = 'all' | 'late' | 'absent' | 'missed'
type CheckRow = {
  key: string; memberId: string; departmentId: string | null; date: string; dateLabel: string; name: string; team: string
  start: string; clockIn: string; result: string; kind: 'late' | 'absent' | 'missed'
  missed?: { pending: boolean; automatic: boolean; detail: string; totalCount: number }
}
const KIND_LABEL = { late: '지각', absent: '결근', missed: '퇴근 미처리' } as const
const KIND_TONE = { late: 'warning', absent: 'danger', missed: 'outline' } as const

/** 근태 > 확인 필요: 지각·결근·퇴근 미처리를 한 표에서 본다. 처리 버튼 없이 기록과 경과일만 보여준다. */
export function AttendanceLatePanel({ directory, schedules, initialKind = 'all', onKindChange }: {
  directory: ReturnType<typeof useOpsDirectory>
  schedules: ReturnType<typeof useAttendanceStartSettings>
  initialKind?: CheckKind
  onKindChange?: (kind: CheckKind) => void
}) {
  useRenderWatch('AttendanceLatePanel')
  const active = useWorkspaceTabActivity()
  const today = localDateKey(new Date())
  const nowMinutes = seoulNowMinutes()
  const [month, setMonth] = useState(today.slice(0, 7))
  const [departmentId, setDepartmentId] = useState('all')
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState<CheckKind>(initialKind)
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
  const deferred = useQuery({
    queryKey: ['company-deferred-clock-outs'],
    queryFn: listCompanyDeferredClockOuts,
    refetchInterval: active ? 30_000 : false,
  })
  useEffect(() => {
    if (deferred.error) console.warn('[attendance-work] 퇴근 미처리 조회 실패', deferred.error)
  }, [deferred.error])
  const deferredRows = deferred.data ?? emptyList<CompanyDeferredClockOut>()
  const lunch = useQuery({ queryKey: ['company-work-hours'], queryFn: loadCompanyLunch, enabled: monthOk })
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
  // 부서 카드 건수를 위해 부서 조건 없이 먼저 모으고, 아래에서 부서 범위로 거른다.
  const searchedRows = useMemo(() => {
    const next: CheckRow[] = []
    const matches = (_department: string | null, name: string, team: string) => !needle || `${name} ${team}`.toLocaleLowerCase('ko').includes(needle)
    for (const clock of clockRows) {
      const member = directory.members.find(item => item.id === clock.employeeId)
      if (!member || member.attendanceExempt || clock.date < attendanceTrackingStart(member.hireDate, member.attendanceTrackedFrom) || !isWorkday(clock.date, {})) continue
      const schedule = resolveWorkdayStart(schedules.index, member.id, member.departmentId, clock.date, leaveRows)
      const actual = timeSeconds(clock.clockIn)
      const arrivalStart = quarterArrivalStart(schedule.start, approvedQuarterIntervals(leaveRows.filter(r => r.employeeId === member.id), clock.date), lunch.data)
      const baseline = timeSeconds(arrivalStart)
      if (actual == null || baseline == null || actual <= baseline + schedule.grace * 60) continue
      const team = directory.departmentName(member.departmentId)
      const name = memberLabel(member.displayName)
      if (!matches(member.departmentId, name, team)) continue
      next.push({ key: `late:${member.id}:${clock.date}`, memberId: member.id, departmentId: member.departmentId, date: clock.date, dateLabel: dateLabel(clock.date), name, team, start: arrivalStart, clockIn: clock.clockIn, result: lateLabel(Math.floor((actual - baseline) / 60)), kind: 'late' })
    }
    for (const member of directory.members) {
      if (member.attendanceExempt) continue
      const trackingStart = attendanceTrackingStart(member.hireDate, member.attendanceTrackedFrom)
      const team = directory.departmentName(member.departmentId)
      const name = memberLabel(member.displayName)
      if (!matches(member.departmentId, name, team)) continue
      for (const date of dates) {
        if (date < trackingStart) continue
        const schedule = resolveWorkdayStart(schedules.index, member.id, member.departmentId, date, leaveRows)
        const baseline = timeSeconds(schedule.start)
        if (date > today || !isWorkday(date, {}) || clockByKey.has(`${member.id}:${date}`) || covered.has(`${member.id}:${date}`)) continue
        if (date === today && (baseline == null ? nowMinutes < 18 * 60 : nowMinutes * 60 <= baseline + schedule.grace * 60)) continue
        next.push({ key: `absent:${member.id}:${date}`, memberId: member.id, departmentId: member.departmentId, date, dateLabel: dateLabel(date), name, team, start: schedule.start || '미설정', clockIn: '없음', result: '결근', kind: 'absent' })
      }
    }
    // 퇴근 미처리는 다음 출근 때 입력했거나 자동 종료된 기록이다(누적은 같은 사람의 전체 횟수).
    for (const view of monthOk ? deferredClockOutViews(deferredRows, month) : []) {
      const member = directory.members.find(item => item.id === view.employeeId)
      const team = member ? directory.departmentName(member.departmentId) : '소속 없음'
      const name = memberLabel(member?.displayName ?? null)
      if (!matches(member?.departmentId ?? null, name, team)) continue
      next.push({
        key: `missed:${view.key}`, memberId: view.employeeId, departmentId: member?.departmentId ?? null, date: view.date, dateLabel: dateLabel(view.date), name, team,
        start: '—', clockIn: view.clockIn, result: `퇴근 ${view.clockOutText}`, kind: 'missed',
        missed: { pending: view.pending, automatic: view.automatic, detail: `입력·자동 종료 ${view.reportedText} · 마지막 근무 확인 ${view.lastConfirmedText === '확인 없음' ? '없음' : view.lastConfirmedText}`, totalCount: view.totalCount },
      })
    }
    const order = { absent: 0, late: 1, missed: 2 }
    return next.sort((a, b) => b.date.localeCompare(a.date) || order[a.kind] - order[b.kind] || a.name.localeCompare(b.name, 'ko'))
  }, [clockRows, clockByKey, covered, dates, directory, schedules.index, leaveRows, needle, today, nowMinutes, lunch.data, deferredRows, month, monthOk])
  const rows = useMemo(() => searchedRows.filter(row => inDepartmentScope(departmentId, row.departmentId)), [searchedRows, departmentId])
  const lateRows = rows.filter(row => row.kind === 'late')
  const absentRows = rows.filter(row => row.kind === 'absent')
  const missedRows = rows.filter(row => row.kind === 'missed')
  const latePeople = new Set(lateRows.map(row => row.memberId)).size
  const absentPeople = new Set(absentRows.map(row => row.memberId)).size
  const missedPeople = new Set(missedRows.map(row => row.memberId)).size
  const visibleRows = kind === 'late' ? lateRows : kind === 'absent' ? absentRows : kind === 'missed' ? missedRows : rows
  const pages = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE))
  const currentPage = Math.min(page, pages)
  const pageRows = visibleRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const emptyLabel = kind === 'late'
    ? '이 조건의 지각 기록이 없습니다.'
    : kind === 'absent'
      ? '이 조건의 결근 기록이 없습니다.'
      : kind === 'missed'
        ? '이 조건에 해당하는 퇴근 미처리 기록이 없습니다.'
        : '이 조건의 지각·결근·퇴근 미처리 기록이 없습니다.'
  const readError = directory.error || schedules.error || clocks.error || leaves.error || lunch.error
  const unavailable = directory.loading || schedules.loading || clocks.isPending || leaves.isPending || lunch.isPending || deferred.isPending || Boolean(readError)
  function chooseKind(next: CheckKind) {
    setKind(next)
    setPage(1)
    onKindChange?.(next)
  }
  const deptCards = useMemo(() => departmentScopeCards({
    items: searchedRows, departments: directory.departments, departmentOf: row => row.departmentId, unavailable,
    count: scoped => new Set(scoped.map(row => row.memberId)).size,
    detail: { label: '건', count: scoped => scoped.length },
  }), [searchedRows, directory.departments, unavailable])
  function chooseMonth(next: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(next)) return
    setMonth(next)
    setPage(1)
  }

  return <div className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <h2 className="sr-only">확인 필요</h2>
      <InfoNote label="확인 필요 기준">
        <p>사이트 도입일·입사일·가입 승인에 따른 근태 시작일 중 가장 늦은 날부터 집계합니다. 출근 기준 시각 이후 승인되거나 출근 기준이 미설정된 직원은 다음 근무일부터 집계합니다.</p>
        <p>출근 기준에서 {ATTENDANCE_GRACE_MINUTES}분이 지난 기록은 지각입니다. 연차·반차·반반차·공가·외근·재택이 등록되지 않은 근무일에 출근이 없으면 결근으로 표시합니다.</p>
        <p>퇴근 미처리는 다음 출근 때 퇴근 시각을 입력한 기록과 연속 5회 무응답으로 자동 종료된 기록입니다. 자동 종료 시각은 실제 퇴근이나 야근 시간으로 계산하지 않습니다. 누적은 같은 사람의 전체 기록 횟수입니다.</p>
        <p>경과는 근무일부터 오늘까지 지난 날 수입니다. 처리 방법은 운영지원과 직원이 직접 의논해 정합니다.</p>
      </InfoNote>
      <span className="text-sm text-muted-foreground">사유서 인사 확인 대기 <strong className="text-primary">{awaitingHr.isPending ? '…' : awaitingHr.isError ? '확인 실패' : `${awaitingHr.data ?? 0}건`}</strong></span>
    </div>
    <ScopeCards ariaLabel="확인 필요 부서" value={departmentId} onChange={next => { setDepartmentId(next); setPage(1) }} cards={deptCards} />
    <FilterBar className="mb-0">
      <Button variant="outline" size="icon" aria-label="이전 월" onClick={() => chooseMonth(shiftMonth(month, -1))}><ChevronLeft size={15} /></Button>
      <Input aria-label="지각·결근 월" type="month" className="h-9 w-40" value={month} onChange={event => chooseMonth(event.target.value)} />
      <Button variant="outline" size="icon" aria-label="다음 월" onClick={() => chooseMonth(shiftMonth(month, 1))}><ChevronRight size={15} /></Button>
      <Button variant="ghost" size="sm" onClick={() => chooseMonth(today.slice(0, 7))}>이번 달</Button>
      <div className="relative min-w-[210px] flex-1">
        <Search size={15} className="absolute left-3 top-2.5 text-muted-foreground" />
        <Input aria-label="지각·결근 검색" placeholder="직원·부서 검색" className="h-9 pl-9" value={search} onChange={event => { setSearch(event.target.value); setPage(1) }} />
      </div>
    </FilterBar>
    <FilterTabs
      ariaLabel="확인 필요 구분"
      value={kind}
      onChange={chooseKind}
      tabs={[
        { value: 'all', label: `${monthLabel(month)} 전체`, count: unavailable ? undefined : rows.length },
        { value: 'late', label: '지각', count: unavailable ? undefined : lateRows.length, ...(unavailable ? {} : { subtitle: `${latePeople}명` }) },
        { value: 'absent', label: '결근', count: unavailable ? undefined : absentRows.length, ...(unavailable ? {} : { subtitle: `${absentPeople}명` }) },
        { value: 'missed', label: '퇴근 미처리', count: unavailable ? undefined : missedRows.length, ...(unavailable ? {} : { subtitle: `${missedPeople}명` }) },
      ]}
    />
    {(readError || statements.error) && <p role="alert" className="text-sm text-danger">직원·관리 대상·출근 기준 또는 근태 기록을 불러오지 못했습니다. <Button variant="outline" size="sm" onClick={() => { directory.refetch(); void schedules.refresh(); void clocks.refetch(); void leaves.refetch(); void lunch.refetch(); void statements.refetch() }}>다시 불러오기</Button></p>}
    {deferred.error && <p role="alert" className="text-sm text-danger">퇴근 미처리 기록을 불러오지 못했습니다. <Button variant="outline" size="sm" onClick={() => void deferred.refetch()}>다시 불러오기</Button></p>}
    {kind === 'missed' && !unavailable && <p role="status" className="text-sm text-muted-foreground">퇴근 미처리 전체 누적 {new Set(deferredRows.map(row => row.employeeId)).size}명 · {deferredRows.length}건</p>}
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{monthLabel(month)} 확인 필요</caption>
        <thead className="bg-primary text-primary-foreground">
          <tr>{['날짜', '경과', '구분', '직원', '부서', '출근 기준', '출근 시각', '내용', '사유서'].map(label => <th key={label} className={`px-3 py-2 font-medium${label === '사유서' ? ' text-right' : ''}`}>{label}</th>)}</tr>
        </thead>
        <tbody>
          {unavailable ? <tr><td colSpan={9} className="px-3 py-10 text-center text-muted-foreground">{readError ? '기록을 확인하지 못해 지각·결근을 집계하지 않습니다.' : '출근과 신청을 확인하고 있습니다.'}</td></tr>
            : pageRows.length ? pageRows.map(row => {
              const attached = statementByKey.get(`${row.memberId}:${row.date}`)
              return <tr key={row.key} className="border-t border-border">
              <td className="px-3 py-2">{row.dateLabel}</td>
              <td className="px-3 py-2"><Elapsed days={elapsedDays(row.date, today)} done={row.kind === 'late' ? Boolean(attached?.hrConfirmedAt) : row.kind === 'missed' && !row.missed?.pending} /></td>
              <td className="px-3 py-2"><StatusPill tone={KIND_TONE[row.kind]}>{KIND_LABEL[row.kind]}</StatusPill></td>
              <td className="px-3 py-2"><MemberCell name={row.name} /></td>
              <td className="px-3 py-2">{row.team}</td>
              <td className="px-3 py-2">{row.start}</td>
              <td className="px-3 py-2">{row.clockIn}</td>
              <td className="px-3 py-2">{row.missed ? <><span className="inline-flex flex-wrap items-center gap-1.5"><StatusPill tone={row.missed.pending ? 'warning' : row.missed.automatic ? 'muted' : 'success'}>{row.missed.pending ? '자동 퇴근 · 확인 필요' : row.missed.automatic ? '자동 종료 후 입력 완료' : '입력 완료'}</StatusPill><span className="font-medium">{row.result}</span><span className="text-xs text-muted-foreground">누적 {row.missed.totalCount}회</span></span><small className="mt-0.5 block text-xs text-muted-foreground">{row.missed.detail}</small></> : <span className="font-medium text-danger">{row.result}</span>}</td>
              <td className="px-3 py-2 text-right">{row.kind !== 'late' ? <span className="text-muted-foreground">—</span> : statements.isPending ? '…' : statements.error ? '조회 실패' : attached ? <span className="inline-flex items-center justify-end gap-2">{attached.hrConfirmedAt ? <StatusPill tone="success">확인됨</StatusPill> : attached.managerConfirmedAt ? <StatusPill tone="warning">인사 대기</StatusPill> : null}<Button type="button" size="sm" variant="outline" onClick={() => setStatement(attached)}>사유서</Button></span> : <span className="text-muted-foreground">없음</span>}</td>
            </tr>}) : <tr><td colSpan={9} className="px-3 py-10 text-center text-muted-foreground">{clocks.error || leaves.error ? '기록을 불러오지 못했습니다.' : emptyLabel}</td></tr>}
        </tbody>
      </table>
      {!unavailable && visibleRows.length > PAGE_SIZE && <nav className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-muted-foreground" aria-label="확인 필요 페이지">
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

/** 경과일 D+N. 확인이 끝난 기록은 흐리게, 7일 이상 남은 기록은 강조한다. */
function Elapsed({ days, done }: { days: number; done: boolean }) {
  return <span className={`whitespace-nowrap text-xs tabular-nums ${done ? 'text-muted-foreground' : days >= 7 ? 'font-semibold text-primary' : 'font-medium'}`} title={done ? '확인이 끝난 기록' : undefined}>D+{days}</span>
}
