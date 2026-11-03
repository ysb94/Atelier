import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { StatusPill } from '@/components/ui/status-pill'
import { StatGrid, StatTile } from '@/components/ui/stat-tile'
import { useRenderWatch } from '@/lib/diagnostics'
import { requestStatusLabel } from '@/features/settings/personal-requests'
import { useMonthlyWorkRequests } from './use-monthly-work-requests'
import { WorkManagementFilters } from './WorkManagementFilters'
import { localDateKey, monthLabel } from './monthly-attendance'
import type { useOpsDirectory } from './ops-directory'
import type { useAttendanceStartSettings } from './use-attendance-start-settings'
import { loadCompanyLunch } from '@/lib/supabase/company-work-hours'
import { offsiteExtraHours } from './offsite-extra-hours'
import { workDurationLabel } from './overtime-hours'

export function AttendanceOffsitePanel({ directory, schedules }: { directory: ReturnType<typeof useOpsDirectory>; schedules: ReturnType<typeof useAttendanceStartSettings> }) {
  useRenderWatch('AttendanceOffsitePanel')
  const [month, setMonth] = useState(localDateKey(new Date()).slice(0, 7))
  const [search, setSearch] = useState('')
  const [department, setDepartment] = useState('all')
  const [limit, setLimit] = useState(50)
  const requests = useMonthlyWorkRequests(month)
  const lunch = useQuery({ queryKey: ['company-work-hours'], queryFn: loadCompanyLunch })
  useEffect(() => { if (lunch.error) console.warn('[attendance-work] 외근 추가 근무 기준 조회 실패', lunch.error) }, [lunch.error])
  const extraHours = useMemo(() => new Map(requests.rows.filter(item => item.kind === 'offsite').map(item => [item.id, lunch.data
    ? offsiteExtraHours(item, month, schedules.index, lunch.data, requests.rows, directory.members.find(member => member.id === item.employeeId)?.departmentId)
    : null])), [requests.rows, month, schedules.index, lunch.data, directory.members])
  const hoursLoading = schedules.loading || lunch.isPending || directory.loading
  const hoursFailed = Boolean(schedules.error || lunch.error || directory.error)
  const rows = useMemo(() => requests.rows.filter(item => item.kind === 'offsite'
    && (department === 'all' || (department === 'unassigned' ? !item.departmentId : item.departmentId === department))
    && `${item.employeeName} ${item.departmentName}`.toLocaleLowerCase('ko').includes(search.trim().toLocaleLowerCase('ko')))
    .sort((a, b) => b.from.localeCompare(a.from) || b.createdAt.localeCompare(a.createdAt)), [requests.rows, department, search])
  const loading = requests.isPending, failed = requests.isError
  const visible = rows.slice(0, limit)
  return <section className="space-y-4" aria-label="외근 관리">
    <header><h2 className="text-base font-semibold">외근 관리</h2><p className="text-sm text-muted-foreground">추가 근무(야근)는 외근 등록 시간 중 직원의 정규 퇴근 이후 시간입니다. 월별 출근 기준·점심·등록 휴가를 반영하며, 기간 외근은 선택한 월의 평일만 합산합니다. 휴일 단일 외근은 점심을 뺀 전체 시간입니다. 실제 야근 입력·보상 휴가와는 별도로 표시합니다.</p></header>
    <WorkManagementFilters label="외근 관리" month={month} setMonth={value => { setMonth(value); setLimit(50) }} search={search} setSearch={value => { setSearch(value); setLimit(50) }} department={department} setDepartment={value => { setDepartment(value); setLimit(50) }} directory={directory} />
    <StatGrid><StatTile label="외근 등록자" value={loading || failed ? '—' : `${new Set(rows.filter(item => item.status === 'approved').map(item => item.employeeId)).size}명`} hint={monthLabel(month)} /><StatTile label="등록 외근" value={loading || failed ? '—' : `${rows.filter(item => item.status === 'approved').length}건`} /><StatTile label="취소 외근" value={loading || failed ? '—' : `${rows.filter(item => item.status === 'cancelled').length}건`} /></StatGrid>
    {failed && <p role="alert" className="text-danger">외근을 불러오지 못했습니다. <Button size="sm" variant="outline" onClick={() => void requests.refetch()}>다시 불러오기</Button></p>}
    {hoursFailed && <p role="alert" className="text-warning">근무 기준 조회 실패 · 추가 근무시간을 계산하지 못했습니다. <Button size="sm" variant="outline" onClick={() => { void schedules.refresh(); void lunch.refetch(); directory.refetch() }}>다시 불러오기</Button></p>}
    <Card className="overflow-x-auto"><table className="w-full min-w-[1100px] text-left text-sm"><caption className="sr-only">{monthLabel(month)} 외근 등록 목록</caption><thead className="bg-primary text-primary-foreground"><tr>{['직원', '부서', '외근 날짜', '매일 외근 시간', '정규 근무시간', '추가 근무(야근)', '장소', '사유', '상태'].map(label => <th key={label} className="px-3 py-2">{label}</th>)}</tr></thead><tbody>
      {loading || failed || !visible.length ? <tr><td colSpan={9} className="p-8 text-center">{loading ? '불러오는 중…' : failed ? '조회 실패' : '해당하는 외근 등록이 없습니다.'}</td></tr> : visible.map(item => {
        const extra = extraHours.get(item.id)
        const basis = item.status !== 'approved' ? '—' : hoursFailed ? '조회 실패' : hoursLoading ? '불러오는 중…' : extra?.baseline ?? '기준 미설정'
        return <tr key={item.id} className="border-t border-border"><td className="px-3 py-2">{item.employeeName}</td><td className="px-3 py-2">{item.departmentName || '소속 없음'}</td><td className="px-3 py-2">{item.from}{item.to !== item.from ? ` ~ ${item.to}` : ''}</td><td className="px-3 py-2">{item.start}–{item.endNextDay ? '다음 날 ' : ''}{item.end}</td><td className="px-3 py-2">{basis}</td><td className="px-3 py-2 font-semibold">{item.status !== 'approved' || hoursFailed || hoursLoading || extra?.minutes == null ? basis : <>{workDurationLabel(extra.minutes)}{extra.days > 1 && <span className="block text-xs font-normal text-muted-foreground">선택 월 {extra.days}일 합계</span>}</>}</td><td className="px-3 py-2 whitespace-pre-wrap">{item.place}</td><td className="max-w-80 px-3 py-2 whitespace-pre-wrap">{item.note || '—'}</td><td className="px-3 py-2"><StatusPill tone={item.status === 'approved' ? 'success' : 'muted'}>{requestStatusLabel(item)}</StatusPill></td></tr>
      })}
    </tbody></table></Card>
    {rows.length > limit && <Button variant="outline" onClick={() => setLimit(value => value + 50)}>더 보기 ({visible.length}/{rows.length})</Button>}
  </section>
}
