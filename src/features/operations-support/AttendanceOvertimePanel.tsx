import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { StatGrid, StatTile } from '@/components/ui/stat-tile'
import { useRenderWatch } from '@/lib/diagnostics'
import { getSupabase } from '@/lib/supabase/client'
import { useAuth } from '@/lib/supabase/auth'
import { useOvertimeActuals } from './use-overtime-actuals'
import { useMonthlyWorkRequests } from './use-monthly-work-requests'
import { registeredOvertime } from './overtime-actuals'
import { workDurationLabel } from './overtime-hours'
import { WorkManagementFilters } from './WorkManagementFilters'
import type { useOpsDirectory } from './ops-directory'
import { localDateKey, monthLabel } from './monthly-attendance'
import { clockOutLabel } from '@/features/settings/my-attendance'

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
export function AttendanceOvertimePanel({ directory }: { directory: ReturnType<typeof useOpsDirectory> }) {
  useRenderWatch('AttendanceOvertimePanel')
  const active = useWorkspaceTabActivity()
  const { profile } = useAuth()
  const today = localDateKey(new Date())
  const [month, setMonth] = useState(today.slice(0, 7))
  const [department, setDepartment] = useState('all')
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(50)
  const [selected, setSelected] = useState<string | null>(null)
  const actuals = useOvertimeActuals()
  const requests = useMonthlyWorkRequests(month)
  const allowances = useQuery({ queryKey: ['employee-roster-overtime', profile?.id], queryFn: listAllowances, enabled: profile?.status === 'active', refetchInterval: active ? 30_000 : false })
  useEffect(() => { if (allowances.error) console.warn('[attendance-work] 포괄임금 기준 조회 실패', allowances.error) }, [allowances.error])
  const entries = useMemo(() => registeredOvertime(requests.rows, actuals.rows, month, today), [requests.rows, actuals.rows, month, today])
  const rows = useMemo(() => {
    const grouped = new Map<string, { employeeId: string; name: string; team: string; minutes: number; count: number; approved: number }>()
    const originals = new Map(requests.rows.map(row => [row.id, row]))
    for (const item of entries) {
      const request = item.request
      const original = originals.get(request.id)!
      if (department !== 'all' && (department === 'unassigned' ? Boolean(original.departmentId) : original.departmentId !== department)) continue
      if (!`${original.employeeName} ${original.departmentName}`.toLocaleLowerCase('ko').includes(search.trim().toLocaleLowerCase('ko'))) continue
      const row = grouped.get(request.employeeId) ?? { employeeId: request.employeeId, name: original.employeeName, team: original.departmentName || '소속 없음', minutes: 0, count: 0, approved: 0 }
      row.minutes += item.minutes; row.approved += item.approvedMinutes; row.count += 1
      grouped.set(row.employeeId, row)
    }
    return [...grouped.values()].sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name, 'ko'))
  }, [entries, requests.rows, department, search])
  const awaiting = requests.rows.filter(row => row.kind === 'overtime' && row.status === 'approved' && row.from <= today && !actuals.rows.some(actual => actual.requestId === row.id)).length
  const loading = actuals.isPending || requests.isPending
  const failed = actuals.isError || requests.isError
  const ready = actuals.ready && !failed && !loading
  const selectedRows = entries.filter(row => row.request.employeeId === selected)
  return <section className="space-y-4" aria-label="야근 관리">
    <header><h2 className="text-base font-semibold">야근 관리</h2><p className="mt-1 text-sm text-muted-foreground">승인된 야근은 신청 시작부터 실제 퇴근 시각까지 자동으로 누적됩니다. 예정 종료보다 더 하거나 덜 한 시간도 반영합니다. 과거 수동 입력과 외근 후처리 내역은 그대로 보존하며, 야근 신청이 없는 늦은 퇴근이나 외근 자동 퇴근만으로 야근을 만들지 않습니다.</p></header>
    <WorkManagementFilters label="야근 관리" month={month} setMonth={value => { setMonth(value); setLimit(50); setSelected(null) }} department={department} setDepartment={value => { setDepartment(value); setLimit(50); setSelected(null) }} search={search} setSearch={value => { setSearch(value); setLimit(50); setSelected(null) }} directory={directory} />
    <StatGrid><StatTile label="실제 야근 기록 직원" value={ready ? `${rows.length}명` : '—'} hint={monthLabel(month)} /><StatTile label="누적 반영 야근" value={ready ? workDurationLabel(rows.reduce((sum, row) => sum + row.minutes, 0)) : '—'} hint="현재 필터 · 과거 기록의 차감값 보존" /><StatTile label="퇴근 기록 대기" value={ready ? `${awaiting}건` : '—'} hint="해당 월 전체 승인 건 · 누적 제외" /></StatGrid>
    {failed && <p role="alert" className="text-danger">야근 기록 조회 실패 <Button size="sm" variant="outline" onClick={() => { void actuals.refetch(); void requests.refetch() }}>다시 불러오기</Button></p>}
    {!actuals.isPending && !actuals.isError && !actuals.ready && <p role="status" className="text-warning">실제 야근 조회 연결 대기입니다. 기존 출퇴근·신청은 보존되며 추정 시간을 대신 표시하지 않습니다.</p>}
    {actuals.ready && actuals.checkoutReady === false && <p role="status" className="text-warning">퇴근 자동 연결 서버 적용 대기입니다. 기존 야근 내역을 표시합니다.</p>}
    {allowances.isError && <p role="alert" className="text-warning">약정 연장근로시간 조회 실패 · 실제 야근은 표시하고 초과 시간은 계산하지 않습니다. <Button size="sm" variant="outline" onClick={() => void allowances.refetch()}>다시 불러오기</Button></p>}
    <Card className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><caption className="sr-only">{monthLabel(month)} 실제 야근 누적</caption><thead className="bg-primary text-primary-foreground"><tr>{['직원', '부서', '실제 기록', '야근 승인·외근 확정 시간', '야근 누적', '약정 연장근로시간(포괄임금)', '약정 초과', '상세'].map(label => <th key={label} className="px-3 py-2">{label}</th>)}</tr></thead><tbody>
      {!ready || !rows.length ? <tr><td colSpan={8} className="p-8 text-center">{loading ? '불러오는 중…' : failed ? '조회 실패' : !actuals.ready ? '실제 시간 연결 대기' : '퇴근 기록이 연결된 승인 야근이 없습니다.'}</td></tr> : rows.slice(0, limit).map(row => {
        const hours = allowances.isError ? null : allowances.data?.find(item => item.profile_id === row.employeeId)?.inclusive_overtime_hours
        const threshold = hours == null ? null : Math.round(hours * 60)
        return <tr key={row.employeeId} className="border-t border-border"><td className="px-3 py-2 font-medium">{row.name}</td><td className="px-3 py-2">{row.team}</td><td className="px-3 py-2">{row.count}건</td><td className="px-3 py-2">{workDurationLabel(row.approved)}</td><td className="px-3 py-2 font-semibold">{workDurationLabel(row.minutes)}</td><td className="px-3 py-2">{allowances.isPending ? '조회 중…' : threshold == null ? '미등록·확인 필요' : workDurationLabel(threshold)}</td><td className="px-3 py-2">{threshold == null ? '—' : workDurationLabel(Math.max(0, row.minutes - threshold))}</td><td className="px-3 py-2"><Button size="sm" variant="outline" onClick={() => setSelected(selected === row.employeeId ? null : row.employeeId)}>입력 내역</Button></td></tr>
      })}
    </tbody></table></Card>
    {rows.length > limit && <Button variant="outline" onClick={() => setLimit(value => value + 50)}>더 보기 ({limit}/{rows.length})</Button>}
    {selected && rows.some(row => row.employeeId === selected) && <Card className="overflow-x-auto p-4"><h3 className="mb-3 font-semibold">실제 야근 입력 내역 · {rows.find(row => row.employeeId === selected)?.name}</h3><table className="w-full text-left text-sm"><thead className="bg-primary text-primary-foreground"><tr>{['날짜', '승인 시간', '실제 시간', '휴게', '누적 반영'].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{selectedRows.map(({ request, actual, minutes }) => <tr key={request.id}><td className="p-2">{request.from}</td><td className="p-2">{request.kind==='offsite'?'외근 후처리 · ':''}{request.start}–{request.endNextDay ? '다음 날 ' : ''}{request.end}</td><td className="p-2">{actual.offsiteMinutes ? Object.entries(actual.offsiteMinutes).filter(([date])=>date.startsWith(month)).map(([date,value])=>`${date}: ${value}분`).join(' / ') : `${clockOutLabel(actual.startAt,request.from)}–${clockOutLabel(actual.endAt,request.from)}`}</td><td className="p-2">{actual.breakMinutes}분</td><td className="p-2">{workDurationLabel(minutes)}</td></tr>)}</tbody></table></Card>}
  </section>
}
