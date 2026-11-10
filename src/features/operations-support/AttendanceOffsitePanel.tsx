import { Link } from 'react-router-dom'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Select } from '@/components/ui/input'
import { useAuth } from '@/lib/supabase/auth'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { listOffsiteSettlements } from '@/lib/supabase/offsite-settlements'
import { OffsiteSettlementEditor } from './OffsiteSettlementEditor'
import { offsitePhase, OFFSITE_PHASE_LABEL } from './offsite-period'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { InfoNote } from '@/components/ui/info-note'
import { StatusPill } from '@/components/ui/status-pill'
import { departmentScopeCards, inDepartmentScope } from '@/components/ui/scope-cards'
import { MemberCell } from './OpsStat'
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
import { timeAttendanceWork } from './attendance-work-perf'
import { firstOffsiteHoliday, holidayOffsiteHref } from './offsite-holiday-routing'

export function AttendanceOffsitePanel({ directory, schedules }: { directory: ReturnType<typeof useOpsDirectory>; schedules: ReturnType<typeof useAttendanceStartSettings> }) {
  useRenderWatch('AttendanceOffsitePanel')
  const { profile }=useAuth()
  const active=useWorkspaceTabActivity()
  const [now,setNow]=useState(Date.now)
  useEffect(()=>{if(!active)return;const timer=setInterval(()=>setNow(Date.now()),30_000);return()=>clearInterval(timer)},[active])
  const [phase,setPhase]=useState('all')
  const [selected,setSelected]=useState<string|null>(null)
  const settlements=useQuery({queryKey:['offsite-settlements',profile?.id],queryFn:listOffsiteSettlements,enabled:Boolean(profile?.id),refetchInterval:active?30_000:false})
  useEffect(()=>{if(settlements.error)console.warn('[offsite-settlement] 목록 조회 실패',settlements.error)},[settlements.error])
  const [month, setMonth] = useState(localDateKey(new Date()).slice(0, 7))
  const [search, setSearch] = useState('')
  const [department, setDepartment] = useState('all')
  const [limit, setLimit] = useState(50)
  const requests = useMonthlyWorkRequests(month)
  const lunch = useQuery({ queryKey: ['company-work-hours'], queryFn: loadCompanyLunch })
  useEffect(() => { if (lunch.error) console.warn('[attendance-work] 외근 추가 근무 기준 조회 실패', lunch.error) }, [lunch.error])
  const extraHours = useMemo(() => timeAttendanceWork('외근 추가 근무 예상',()=>new Map(requests.rows.filter(item => item.kind === 'offsite').map(item => [item.id, lunch.data
    ? offsiteExtraHours(item, month, schedules.index, lunch.data, requests.rows, directory.members.find(member => member.id === item.employeeId)?.departmentId, true)
    : null]))), [requests.rows, month, schedules.index, lunch.data, directory.members])
  const hoursLoading = schedules.loading || lunch.isPending || directory.loading
  const hoursFailed = Boolean(schedules.error || lunch.error || directory.error)
  const settlementIndex=useMemo(()=>new Map(settlements.data?.rows.map(row=>[row.request_id,row])??[]),[settlements.data])
  // '후처리 대기' 진행 구분과 같은 조건. 부서 카드의 보조 건수에도 쓴다.
  const isPendingSettlement = useCallback((item: (typeof requests.rows)[number]) => !firstOffsiteHoliday(item) && offsitePhase(item, now) === 'ended' && !settlementIndex.has(item.id) && (extraHours.get(item.id)?.minutes ?? 1) > 0, [now, settlementIndex, extraHours])
  // 부서 카드 건수를 위해 부서 조건 없이 먼저 모으고, 아래에서 부서 범위로 거른다.
  const searchedRows = useMemo(() => requests.rows.filter(item => item.kind === 'offsite'
    && (phase==='all'||offsitePhase(item,now)===phase||(phase==='pending'&&isPendingSettlement(item)))
    && `${item.employeeName} ${item.departmentName}`.toLocaleLowerCase('ko').includes(search.trim().toLocaleLowerCase('ko')))
    .sort((a, b) => b.from.localeCompare(a.from) || b.createdAt.localeCompare(a.createdAt)), [requests.rows, search, phase, now, isPendingSettlement])
  const rows = useMemo(() => searchedRows.filter(item => inDepartmentScope(department, item.departmentId)), [searchedRows, department])
  const deptCards = useMemo(() => departmentScopeCards({
    items: searchedRows, departments: directory.departments, departmentOf: item => item.departmentId, unavailable: requests.isPending || requests.isError,
    detail: { label: '후처리', count: scoped => scoped.filter(isPendingSettlement).length },
  }), [searchedRows, directory.departments, requests.isPending, requests.isError, isPendingSettlement])
  const loading = requests.isPending, failed = requests.isError
  const visible = rows.slice(0, limit)
  return <section className="space-y-4" aria-label="외근 관리">
    <h2 className="sr-only">외근</h2>
    <InfoNote label="외근 후처리 기준"><p>외근 예정·진행 중·종료를 구분합니다. 추가 근무는 예상 시간이며, 종료 후 실제 근무분을 확인해 야근 누적 또는 추가 휴가 지급으로 확정합니다. 휴가 지급분은 야근에 누적하지 않습니다. 주말·공휴일이 포함된 외근은 평일분까지 주말·공휴일 근무 탭에서 처리합니다.</p></InfoNote>
    <WorkManagementFilters label="외근 관리" month={month} setMonth={value => { setMonth(value); setLimit(50) }} search={search} setSearch={value => { setSearch(value); setLimit(50) }} department={department} setDepartment={value => { setDepartment(value); setLimit(50) }} directory={directory} cards={deptCards} />
    <label className="flex items-center gap-2 text-sm">진행 구분<Select aria-label="외근 진행 구분" value={phase} onChange={event=>{setPhase(event.target.value);setLimit(50)}}>{[['all','전체'],['planned','예정'],['ongoing','진행 중'],['ended','종료'],['pending','후처리 대기'],['cancelled','취소']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</Select></label>
    {!settlements.isPending&&!settlements.error&&!settlements.data?.ready&&<p role="status" className="text-warning">외근 후처리 서버 설정 적용 대기입니다. 기존 데이터는 유지됩니다.</p>}
    {settlements.error&&<p role="alert" className="text-warning">후처리 이력 조회 실패 <Button variant="outline" onClick={()=>void settlements.refetch()}>다시 불러오기</Button></p>}
    {selected&&requests.rows.some(row=>row.id===selected)&&<OffsiteSettlementEditor key={selected} request={requests.rows.find(row=>row.id===selected)!} onClose={()=>setSelected(null)}/>}
    <p role="status" className="text-sm text-muted-foreground">{loading || failed ? '외근 등록을 확인하고 있습니다.' : <>{monthLabel(month)} 외근 등록자 <strong className="text-foreground">{new Set(rows.filter(item => item.status === 'approved').map(item => item.employeeId)).size}명</strong> · 등록 외근 <strong className="text-foreground">{rows.filter(item => item.status === 'approved').length}건</strong> · 취소 {rows.filter(item => item.status === 'cancelled').length}건</>}</p>
    {failed && <p role="alert" className="text-danger">외근을 불러오지 못했습니다. <Button size="sm" variant="outline" onClick={() => void requests.refetch()}>다시 불러오기</Button></p>}
    {hoursFailed && <p role="alert" className="text-warning">근무 기준 조회 실패 · 추가 근무시간을 계산하지 못했습니다. <Button size="sm" variant="outline" onClick={() => { void schedules.refresh(); void lunch.refetch(); directory.refetch() }}>다시 불러오기</Button></p>}
    <Card className="overflow-x-auto"><table className="w-full min-w-[1100px] text-left text-sm"><caption className="sr-only">{monthLabel(month)} 외근 등록 목록</caption><thead className="bg-primary text-primary-foreground"><tr>{['직원', '부서', '외근 날짜', '외근 시간', '정규 근무시간', '평일 추가 근무(야근)', '장소', '사유', '진행', '후처리'].map(label => <th key={label} className="px-3 py-2">{label}</th>)}</tr></thead><tbody>
      {loading || failed || !visible.length ? <tr><td colSpan={10} className="p-8 text-center">{loading ? '불러오는 중…' : failed ? '조회 실패' : '해당하는 외근 등록이 없습니다.'}</td></tr> : visible.map(item => {
        const extra = extraHours.get(item.id)
        const hasHoliday = Boolean(firstOffsiteHoliday(item))
        const basis = item.status !== 'approved' ? '—' : hoursFailed ? '조회 실패' : hoursLoading ? '불러오는 중…' : extra?.baseline ?? '기준 미설정'
        return <tr key={item.id} className="border-t border-border"><td className="px-3 py-2"><MemberCell name={item.employeeName} /></td><td className="px-3 py-2">{item.departmentName || '소속 없음'}</td><td className="px-3 py-2">{item.from}{item.to !== item.from ? ` ~ ${item.to}` : ''}</td><td className="px-3 py-2">{item.start}–{item.endNextDay ? '다음 날 ' : ''}{item.end}</td><td className="px-3 py-2">{basis}</td><td className="px-3 py-2 font-semibold">{item.status !== 'approved' || hoursFailed || hoursLoading || extra?.minutes == null ? basis : <>{workDurationLabel(extra.minutes)}{extra.days > 1 && <span className="block text-xs font-normal text-muted-foreground">선택 월 {extra.days}일 합계</span>}</>}</td><td className="px-3 py-2 whitespace-pre-wrap">{item.place}</td><td className="max-w-80 px-3 py-2 whitespace-pre-wrap">{item.note || '—'}</td><td className="px-3 py-2"><StatusPill tone={offsitePhase(item,now)==='ended'?'success':'muted'}>{OFFSITE_PHASE_LABEL[offsitePhase(item,now)]}</StatusPill><span className="block text-xs text-muted-foreground">{requestStatusLabel(item)}</span></td><td className="px-3 py-2">{hasHoliday ? <><StatusPill tone="warning">주말·공휴일 포함</StatusPill><Link className="mt-2 block text-primary underline" to={holidayOffsiteHref(item)}>외근 건 전체 후처리</Link></> : offsitePhase(item,now)==='ended'&&((extra?.minutes===0&&!hoursLoading&&!hoursFailed&&!settlementIndex.has(item.id))?<span>{hasHoliday ? '평일 추가 근무 없음' : '정규 근무 · 후처리 없음'}</span>:<><span className="block text-xs">{settlementIndex.get(item.id)?.mode==='leave'?'휴가 지급 · 야근 제외':settlementIndex.get(item.id)?.mode==='overtime'?'야근 누적 완료':settlementIndex.get(item.id)?.mode==='none'?'추가 근무 없음':!settlements.data?.ready?'연결 대기':'후처리 대기'}</span><Button size="sm" variant="outline" disabled={!settlements.data?.ready||settlements.isError} onClick={()=>setSelected(item.id)}>{settlementIndex.has(item.id)?'처리 내역':'후처리'}</Button></>)}</td></tr>
      })}
    </tbody></table></Card>
    {rows.length > limit && <Button variant="outline" onClick={() => setLimit(value => value + 50)}>더 보기 ({visible.length}/{rows.length})</Button>}
  </section>
}
