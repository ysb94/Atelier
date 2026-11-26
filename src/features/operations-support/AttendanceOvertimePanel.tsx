import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpDown, ChevronDown, ChevronUp } from 'lucide-react'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { InfoNote } from '@/components/ui/info-note'
import { departmentScopeCards, inDepartmentScope } from '@/components/ui/scope-cards'
import { memberLabel, MemberCell } from './OpsStat'
import { useRenderWatch } from '@/lib/diagnostics'
import { canAccessOperationsSupport } from '@/lib/company/capabilities'
import { readPollInterval, sharedReadPolicy } from '@/lib/query/shared-read-policy'
import { getSupabase } from '@/lib/supabase/client'
import { useAuth } from '@/lib/supabase/auth'
import { listCompanyAttendanceSpans, type CompanyAttendanceSpan } from '@/lib/supabase/attendance-clocks'
import { loadCompanyLunch } from '@/lib/supabase/company-work-hours'
import { emptyList } from '@/lib/utils'
import { useOvertimeActuals } from './use-overtime-actuals'
import { useHolidayOvertimeCredits } from './use-holiday-work'
import type { HolidayOvertimeCredit } from './holiday-work'
import { useMonthlyWorkRequests } from './use-monthly-work-requests'
import { registeredOvertime } from './overtime-actuals'
import { workDurationLabel } from './overtime-hours'
import { WorkManagementFilters } from './WorkManagementFilters'
import { canViewPeopleOrg, overtimeRosterHref } from './operations-support-sections'
import type { useOpsDirectory } from './ops-directory'
import type { useAttendanceStartSettings } from './use-attendance-start-settings'
import { monthLabel } from './monthly-attendance'
import { clockOutLabel, koreaDateKey, validAttendanceMonth } from '@/features/settings/my-attendance'
import { timeAttendanceWork } from './attendance-work-perf'
import { unrequestedOvertime, type UnrequestedOvertimeEntry } from './unrequested-overtime'

type Allowance = { profile_id: string; inclusive_overtime_hours: number | null }
async function listAllowances() {
  const rows: Allowance[] = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await getSupabase().from('employee_roster').select('profile_id,inclusive_overtime_hours').order('profile_id').range(offset, offset + 499)
    if (error) { console.warn('[attendance-work] 약정 연장근로시간 조회 실패', error); throw new Error(error.message) }
    rows.push(...data as Allowance[])
    if (data.length < 500) return rows
  }
}
type OvertimeSummary = { employeeId: string; departmentId: string | null; name: string; team: string; minutes: number; count: number; approved: number; unrequestedMinutes: number }
const overtimeColumns = [
  { key: 'name', label: '직원' },
  { key: 'team', label: '부서' },
  { key: 'count', label: '실제 기록' },
  { key: 'approved', label: '승인·확정 시간' },
  { key: 'minutes', label: '신청된 연장근무' },
  { key: 'unrequestedMinutes', label: '미신청 연장근무' },
  { key: 'requestedAllowance', label: '약정 연장근로시간(신청)' },
  { key: 'combinedMinutes', label: '약정 연장근로시간(신청+미신청)' },
  { key: 'excessMinutes', label: '약정 초과' },
] as const
type OvertimeSort = { key: (typeof overtimeColumns)[number]['key']; direction: 'asc' | 'desc' }

export function AttendanceOvertimePanel({ directory, schedules }: { directory: ReturnType<typeof useOpsDirectory>; schedules: ReturnType<typeof useAttendanceStartSettings> }) {
  useRenderWatch('AttendanceOvertimePanel')
  const active = useWorkspaceTabActivity()
  const { profile, session } = useAuth()
  const canOpenRoster = canViewPeopleOrg(profile)
  const today = koreaDateKey(new Date())
  const [month, setMonth] = useState(today.slice(0, 7))
  const [department, setDepartment] = useState('all')
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(50)
  const [selected, setSelected] = useState<string | null>(null)
  const [sort, setSort] = useState<OvertimeSort>({ key: 'minutes', direction: 'desc' })
  const actuals = useOvertimeActuals()
  const holidayOvertime = useHolidayOvertimeCredits(month, 'operations')
  const requests = useMonthlyWorkRequests(month)
  const enabled = Boolean(session?.user.id && profile?.id === session.user.id && profile.status === 'active' && canAccessOperationsSupport(profile) && validAttendanceMonth(month))
  const spans = useQuery({ ...sharedReadPolicy, queryKey: ['company-attendance-spans', session?.user.id, profile?.companyId, month],
    queryFn: () => listCompanyAttendanceSpans(month), enabled: enabled && active, refetchInterval: readPollInterval(30_000, enabled && active) })
  const lunch = useQuery({ queryKey: ['company-work-hours', profile?.companyId], queryFn: loadCompanyLunch, enabled: enabled && active })
  const unrequestedError = enabled && Boolean(spans.error || lunch.error || directory.error || schedules.error)
  const unrequestedBusy = enabled && !unrequestedError && (spans.isPending || lunch.isPending || directory.loading || schedules.loading)
  const clockRows = spans.data ?? emptyList<CompanyAttendanceSpan>()
  const unrequested = useMemo(() => enabled && !unrequestedBusy && !unrequestedError && requests.isSuccess && lunch.data
    ? timeAttendanceWork('미신청 연장근무', () => unrequestedOvertime(clockRows, directory.members, requests.rows, schedules.index, lunch.data, month, Date.now()))
    : null, [enabled, unrequestedBusy, unrequestedError, requests.isSuccess, lunch.data, clockRows, directory.members, requests.rows, schedules.index, month])
  const allowances = useQuery({ queryKey: ['employee-roster-overtime', profile?.id], queryFn: listAllowances, enabled: profile?.status === 'active', refetchInterval: active ? 30_000 : false })
  useEffect(() => { if (allowances.error) console.warn('[attendance-work] 포괄임금 기준 조회 실패', allowances.error) }, [allowances.error])
  const allowanceRows = allowances.isError ? undefined : allowances.data
  const allowanceByEmployee = useMemo(() => new Map(allowanceRows?.map(row => [row.profile_id, row.inclusive_overtime_hours])), [allowanceRows])
  const allowanceStatus = allowances.isPending ? '조회 중…' : allowances.isError ? '조회 실패' : '미등록'
  const entries = useMemo(() => registeredOvertime(requests.rows, actuals.rows, month, today), [requests.rows, actuals.rows, month, today])
  const holidayEntries = useMemo(() => holidayOvertime.rows.filter(row => row.date <= today), [holidayOvertime.rows, today])
  // 부서 카드 건수를 위해 부서 조건 없이 먼저 모으고, 아래에서 부서 범위로 거른다.
  const searchedRows = useMemo(() => {
    const grouped = new Map<string, OvertimeSummary>()
    const originals = new Map(requests.rows.map(row => [row.id, row]))
    const term = search.trim().toLocaleLowerCase('ko')
    function add(original: Pick<HolidayOvertimeCredit, 'employeeId' | 'employeeName' | 'departmentId' | 'departmentName'>, minutes: number, approved: number) {
      if (!`${original.employeeName} ${original.departmentName}`.toLocaleLowerCase('ko').includes(term)) return
      const row = grouped.get(original.employeeId) ?? { employeeId: original.employeeId, departmentId: original.departmentId, name: original.employeeName, team: original.departmentName || '소속 없음', minutes: 0, count: 0, approved: 0, unrequestedMinutes: 0 }
      row.minutes += minutes
      row.approved += approved
      row.count += 1
      grouped.set(row.employeeId, row)
    }
    for (const item of entries) {
      const original = originals.get(item.request.id)
      if (original) add({ ...original, departmentId: original.departmentId ?? null }, item.minutes, item.approvedMinutes)
    }
    for (const item of holidayEntries) add(item, item.minutes, item.minutes)
    if (unrequested) for (const member of directory.members) {
      const records = unrequested.get(member.id)
      if (!records?.length) continue
      const name = memberLabel(member.displayName), team = directory.departmentName(member.departmentId)
      const row = grouped.get(member.id)
      if (!row && !`${name} ${team}`.toLocaleLowerCase('ko').includes(term)) continue
      const unrequestedMinutes = records.reduce((sum, record) => sum + record.minutes, 0)
      grouped.set(member.id, row ? { ...row, unrequestedMinutes } : {
        employeeId: member.id, departmentId: member.departmentId, name, team, minutes: 0, count: 0, approved: 0, unrequestedMinutes,
      })
    }
    return [...grouped.values()]
  }, [entries, holidayEntries, requests.rows, search, unrequested, directory.members, directory.departmentName])
  const hasUnrequested = unrequested !== null
  const rows = useMemo(() => {
    const key = sort.key === 'requestedAllowance' ? 'minutes' : sort.key
    const direction = sort.direction === 'asc' ? 1 : -1
    return searchedRows.filter(row => inDepartmentScope(department, row.departmentId)).map(row => {
      const hours = allowanceByEmployee.get(row.employeeId)
      const threshold = hours == null ? null : Math.round(hours * 60)
      return {
        ...row,
        threshold,
        combinedMinutes: hasUnrequested ? row.minutes + row.unrequestedMinutes : null,
        excessMinutes: threshold == null ? null : Math.max(0, row.minutes - threshold),
      }
    }).sort((left, right) => {
      const a = left[key], b = right[key]
      if ((a === null) !== (b === null)) return a === null ? 1 : -1
      const comparison = typeof a === 'string' && typeof b === 'string' ? a.localeCompare(b, 'ko') : Number(a) - Number(b)
      return direction * comparison || right.minutes - left.minutes || right.unrequestedMinutes - left.unrequestedMinutes || left.name.localeCompare(right.name, 'ko')
    })
  }, [searchedRows, department, sort, allowanceByEmployee, hasUnrequested])
  const awaiting = requests.rows.filter(row => row.kind === 'overtime' && row.status === 'approved' && row.from <= today && !actuals.rows.some(actual => actual.requestId === row.id)).length
  const loading = actuals.isPending || requests.isPending || holidayOvertime.isPending
  const failed = actuals.isError || requests.isError || holidayOvertime.isError
  const ready = actuals.ready && !failed && !loading
  const selectedRows = entries.filter(row => row.request.employeeId === selected)
  const selectedHolidayRows = holidayEntries.filter(row => row.employeeId === selected)
  const selectedUnrequestedRows = selected ? unrequested?.get(selected) : undefined
  const deptCards = useMemo(() => departmentScopeCards({
    items: searchedRows, departments: directory.departments, departmentOf: row => row.departmentId, unavailable: !ready,
    detail: { label: '건', count: scoped => scoped.reduce((sum, row) => sum + row.count, 0) },
  }), [searchedRows, directory.departments, ready])
  return <section className="space-y-4" aria-label="야근 관리">
    <h2 className="sr-only">야근</h2>
    <InfoNote label="연장근무 집계 기준"><p>승인된 야근은 신청 시작부터 실제 퇴근 시각까지 누적됩니다. 외근과 주말·공휴일 근무에서 확정한 시간도 근무일 기준으로 합산합니다.</p>
      <p>미신청 연장근무는 평일에 예정 퇴근을 넘긴 기록입니다. 야근 신청 이력이나 승인 외근이 있는 날은 제외합니다. 두 약정 비교 열은 왼쪽 근무시간을 기준으로 정렬합니다. 약정 초과는 신청된 연장근무를 기준으로 계산합니다.</p></InfoNote>
    <WorkManagementFilters label="야근 관리" month={month} setMonth={value => { setMonth(value); setLimit(50); setSelected(null) }} department={department} setDepartment={value => { setDepartment(value); setLimit(50); setSelected(null) }} search={search} setSearch={value => { setSearch(value); setLimit(50); setSelected(null) }} directory={directory} cards={deptCards} />
    <p role="status" className="text-sm text-muted-foreground">{ready ? <>{monthLabel(month)} 실제 야근 기록 <strong className="text-foreground">{rows.filter(row => row.count > 0).length}명</strong> · 누적 반영 <strong className="text-foreground">{workDurationLabel(rows.reduce((sum, row) => sum + row.minutes, 0))}</strong>{unrequested && <> · 미신청 연장근무 <strong className="text-foreground">{workDurationLabel(rows.reduce((sum, row) => sum + row.unrequestedMinutes, 0))}</strong></>} · 퇴근 기록 대기 <strong className={awaiting ? 'text-primary' : 'text-foreground'}>{awaiting}건</strong> <span className="text-xs">(대기는 해당 월 전체 승인 건 · 누적 제외)</span></> : '야근 기록을 확인하고 있습니다.'}</p>
    {failed && <p role="alert" className="text-danger">야근 기록 조회 실패 <Button size="sm" variant="outline" onClick={() => { void actuals.refetch(); void requests.refetch(); void holidayOvertime.refetch() }}>다시 불러오기</Button></p>}
    {!actuals.isPending && !actuals.isError && !actuals.ready && <p role="status" className="text-warning">실제 야근 조회 연결 대기입니다. 기존 출퇴근·신청은 보존되며 추정 시간을 대신 표시하지 않습니다.</p>}
    {actuals.ready && actuals.checkoutReady === false && <p role="status" className="text-warning">퇴근 자동 연결 서버 적용 대기입니다. 기존 야근 내역을 표시합니다.</p>}
    {allowances.isError && <p role="alert" className="text-warning">약정 연장근로시간 조회 실패 · 실제 야근은 표시하고 초과 시간은 계산하지 않습니다. <Button size="sm" variant="outline" onClick={() => void allowances.refetch()}>다시 불러오기</Button></p>}
    {unrequestedError && <p role="alert" className="text-warning">미신청 연장근무 조회 실패 <Button size="sm" variant="outline" onClick={() => { void spans.refetch(); void lunch.refetch(); directory.refetch(); void schedules.refresh() }}>다시 불러오기</Button></p>}
    <Card className="overflow-x-auto"><table className="w-full min-w-[1200px] text-left text-sm"><caption className="sr-only">{monthLabel(month)} 연장근무 현황</caption>
      <thead className="bg-primary text-primary-foreground"><tr>{overtimeColumns.map(({ key, label }) => {
        const isSorted = sort.key === key
        const next = isSorted && sort.direction === 'asc' ? 'desc' : 'asc'
        const Icon = isSorted ? (sort.direction === 'asc' ? ChevronUp : ChevronDown) : ArrowUpDown
        return <th key={key} scope="col" aria-sort={isSorted ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined} className="p-0">
          <button type="button" title={`${label} ${next === 'asc' ? '오름차순' : '내림차순'}`} className="flex w-full items-center gap-1.5 whitespace-nowrap px-3 py-2 text-left hover:bg-primary-foreground/10 focus-visible:outline-2 focus-visible:-outline-offset-2" onClick={() => setSort({ key, direction: next })}>
            {label}<Icon className="size-3.5 shrink-0" aria-hidden />
          </button>
        </th>
      })}<th scope="col" className="px-3 py-2">상세</th></tr></thead><tbody>
      {!ready || !rows.length ? <tr><td colSpan={overtimeColumns.length + 1} className="p-8 text-center">{loading || (ready && unrequestedBusy) ? '불러오는 중…' : failed ? '조회 실패' : !actuals.ready ? '실제 시간 연결 대기' : unrequestedError ? '표시할 승인 야근이 없습니다.' : '표시할 야근·연장근무 기록이 없습니다.'}</td></tr> : rows.slice(0, limit).map(row => {
        const open = selected === row.employeeId
        const allowanceLink = row.threshold == null && allowanceStatus === '미등록' && canOpenRoster
          ? <Link to={overtimeRosterHref(row.employeeId)} className="font-medium text-primary underline underline-offset-2" title={`${row.name} 약정 연장근로시간 입력으로 이동`}>미등록·확인 필요</Link>
          : allowanceStatus
        return <Fragment key={row.employeeId}><tr className={`border-t border-border ${open ? 'bg-muted/40' : ''}`}><td className="px-3 py-2"><MemberCell name={row.name} /></td><td className="px-3 py-2">{row.team}</td><td className="px-3 py-2">{row.count}건</td><td className="px-3 py-2">{workDurationLabel(row.approved)}</td><td className="px-3 py-2 font-semibold">{workDurationLabel(row.minutes)}</td><td className="px-3 py-2 font-semibold">{unrequestedBusy ? '조회 중…' : unrequested ? workDurationLabel(row.unrequestedMinutes) : '—'}</td>
          <td className="px-3 py-2"><AllowanceComparison minutes={row.minutes} threshold={row.threshold} allowancePlaceholder={allowanceLink} /></td>
          <td className="px-3 py-2"><AllowanceComparison minutes={row.combinedMinutes} threshold={row.threshold} allowancePlaceholder={allowanceStatus} workPlaceholder={unrequestedBusy ? '조회 중…' : '—'} /></td>
          <td className="px-3 py-2">{row.excessMinutes == null ? '—' : workDurationLabel(row.excessMinutes)}</td><td className="px-3 py-2"><Button size="sm" variant="outline" aria-expanded={open} onClick={() => setSelected(open ? null : row.employeeId)}>{open ? '입력 내역 닫기' : '입력 내역'}</Button></td></tr>
        {open && <tr className="bg-muted/40"><td colSpan={overtimeColumns.length + 1} className="space-y-3 px-6 pb-4 pt-1">
          {(selectedRows.length > 0 || selectedHolidayRows.length > 0) && <OvertimeEntries rows={selectedRows} holidays={selectedHolidayRows} month={month} />}
          {selectedUnrequestedRows && <UnrequestedOvertimeEntries rows={selectedUnrequestedRows} />}
        </td></tr>}</Fragment>
      })}
    </tbody></table></Card>
    {rows.length > limit && <Button variant="outline" onClick={() => setLimit(value => value + 50)}>더 보기 ({limit}/{rows.length})</Button>}
  </section>
}

function UnrequestedOvertimeEntries({ rows }: { rows: UnrequestedOvertimeEntry[] }) {
  return <table className="ops-subtable w-full text-left text-sm">
    <caption className="px-2 py-1 text-left font-semibold">미신청 연장근무 내역</caption>
    <thead className="text-xs text-muted-foreground"><tr>{['날짜', '예정 퇴근', '실제 퇴근', '연장 시간'].map(label => <th key={label} className="px-2 py-1.5 font-medium">{label}</th>)}</tr></thead>
    <tbody>{rows.map(row => <tr key={row.date} className="border-t border-border"><td className="px-2 py-1.5">{row.date}</td><td className="px-2 py-1.5">{clockOutLabel(row.expectedEnd, row.date)}</td><td className="px-2 py-1.5">{clockOutLabel(row.checkoutAt, row.date)}</td><td className="px-2 py-1.5 font-medium">{workDurationLabel(row.minutes)}</td></tr>)}</tbody>
  </table>
}

/** 펼친 행 안의 실제 야근 입력 내역(시안: 행 아래로 펼침). */
function OvertimeEntries({ rows, holidays, month }: { rows: ReturnType<typeof registeredOvertime>; holidays: HolidayOvertimeCredit[]; month: string }) {
  return <table className="ops-subtable w-full text-left text-sm">
    <thead className="text-xs text-muted-foreground"><tr>{['날짜', '승인 시간', '실제 시간', '휴게', '누적 반영'].map(label => <th key={label} className="px-2 py-1.5 font-medium">{label}</th>)}</tr></thead>
    <tbody>{rows.map(({ request, actual, minutes }) => <tr key={request.id} className="border-t border-border"><td className="px-2 py-1.5">{request.from}</td><td className="px-2 py-1.5">{request.kind==='offsite'?'외근 후처리 · ':''}{request.start}–{request.endNextDay ? '다음 날 ' : ''}{request.end}</td><td className="px-2 py-1.5">{actual.offsiteMinutes ? Object.entries(actual.offsiteMinutes).filter(([date])=>date.startsWith(month)).map(([date,value])=>`${date}: ${value}분`).join(' / ') : `${clockOutLabel(actual.startAt,request.from)}–${clockOutLabel(actual.endAt,request.from)}`}</td><td className="px-2 py-1.5">{actual.breakMinutes}분</td><td className="px-2 py-1.5 font-medium">{workDurationLabel(minutes)}</td></tr>)}
      {holidays.map(item => <tr key={item.id} className="border-t border-border"><td className="px-2 py-1.5">{item.date}</td><td className="px-2 py-1.5">주말·공휴일 근무</td><td className="px-2 py-1.5">{workDurationLabel(item.minutes)}</td><td className="px-2 py-1.5">—</td><td className="px-2 py-1.5 font-medium">{workDurationLabel(item.minutes)}</td></tr>)}
    </tbody>
  </table>
}

function AllowanceComparison({ minutes, threshold, allowancePlaceholder, workPlaceholder = '—' }: {
  minutes: number | null; threshold: number | null; allowancePlaceholder: ReactNode; workPlaceholder?: string
}) {
  return <>
    <div className="whitespace-nowrap tabular-nums"><strong>{minutes == null ? workPlaceholder : workDurationLabel(minutes)}</strong>
      <span className="text-muted-foreground"> / </span>{threshold == null ? allowancePlaceholder : workDurationLabel(threshold)}
    </div>
    {minutes != null && threshold != null && <AllowanceBar minutes={minutes} threshold={threshold} />}
  </>
}

/** 약정 연장근로시간 대비 누적 막대. 넘으면 레드로 보인다. */
function AllowanceBar({ minutes, threshold }: { minutes: number; threshold: number }) {
  if (threshold <= 0) return null
  const ratio = minutes / threshold
  return <span className="mt-1.5 block h-1 w-28 overflow-hidden rounded-full bg-muted" role="img" aria-label={`약정 대비 ${Math.round(ratio * 100)}%`}>
    <span className={`block h-full rounded-full ${ratio > 1 ? 'bg-primary' : 'bg-foreground/70'}`} style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }} />
  </span>
}
