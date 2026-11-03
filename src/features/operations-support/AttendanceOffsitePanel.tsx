import { useMemo, useState } from 'react'
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

export function AttendanceOffsitePanel({ directory }: { directory: ReturnType<typeof useOpsDirectory> }) {
  useRenderWatch('AttendanceOffsitePanel')
  const [month, setMonth] = useState(localDateKey(new Date()).slice(0, 7))
  const [search, setSearch] = useState('')
  const [department, setDepartment] = useState('all')
  const [limit, setLimit] = useState(50)
  const requests = useMonthlyWorkRequests(month)
  const rows = useMemo(() => requests.rows.filter(item => item.kind === 'offsite'
    && (department === 'all' || (department === 'unassigned' ? !item.departmentId : item.departmentId === department))
    && `${item.employeeName} ${item.departmentName}`.toLocaleLowerCase('ko').includes(search.trim().toLocaleLowerCase('ko')))
    .sort((a, b) => b.from.localeCompare(a.from) || b.createdAt.localeCompare(a.createdAt)), [requests.rows, department, search])
  const loading = requests.isPending, failed = requests.isError
  const visible = rows.slice(0, limit)
  return <section className="space-y-4" aria-label="외근 관리">
    <header><h2 className="text-base font-semibold">외근 관리</h2><p className="text-sm text-muted-foreground">외근 등록자의 날짜·시간·장소·사유를 확인합니다. 외근은 승인 없이 등록되며, 이 목록에서 야근 시간이나 보상 휴가를 자동 생성하지 않습니다.</p></header>
    <WorkManagementFilters label="외근 관리" month={month} setMonth={value => { setMonth(value); setLimit(50) }} search={search} setSearch={value => { setSearch(value); setLimit(50) }} department={department} setDepartment={value => { setDepartment(value); setLimit(50) }} directory={directory} />
    <StatGrid><StatTile label="외근 등록자" value={loading || failed ? '—' : `${new Set(rows.filter(item => item.status === 'approved').map(item => item.employeeId)).size}명`} hint={monthLabel(month)} /><StatTile label="등록 외근" value={loading || failed ? '—' : `${rows.filter(item => item.status === 'approved').length}건`} /><StatTile label="취소 외근" value={loading || failed ? '—' : `${rows.filter(item => item.status === 'cancelled').length}건`} /></StatGrid>
    {failed && <p role="alert" className="text-danger">외근을 불러오지 못했습니다. <Button size="sm" variant="outline" onClick={() => void requests.refetch()}>다시 불러오기</Button></p>}
    <Card className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><caption className="sr-only">{monthLabel(month)} 외근 등록 목록</caption><thead className="bg-primary text-primary-foreground"><tr>{['직원', '부서', '외근 날짜', '매일 외근 시간', '장소', '사유', '상태'].map(label => <th key={label} className="px-3 py-2">{label}</th>)}</tr></thead><tbody>
      {loading || failed || !visible.length ? <tr><td colSpan={7} className="p-8 text-center">{loading ? '불러오는 중…' : failed ? '조회 실패' : '해당하는 외근 등록이 없습니다.'}</td></tr> : visible.map(item => <tr key={item.id} className="border-t border-border"><td className="px-3 py-2">{item.employeeName}</td><td className="px-3 py-2">{item.departmentName || '소속 없음'}</td><td className="px-3 py-2">{item.from}{item.to !== item.from ? ` ~ ${item.to}` : ''}</td><td className="px-3 py-2">{item.start}–{item.end}</td><td className="px-3 py-2 whitespace-pre-wrap">{item.place}</td><td className="max-w-80 px-3 py-2 whitespace-pre-wrap">{item.note || '—'}</td><td className="px-3 py-2"><StatusPill tone={item.status === 'approved' ? 'success' : 'muted'}>{requestStatusLabel(item)}</StatusPill></td></tr>)}
    </tbody></table></Card>
    {rows.length > limit && <Button variant="outline" onClick={() => setLimit(value => value + 50)}>더 보기 ({visible.length}/{rows.length})</Button>}
  </section>
}
