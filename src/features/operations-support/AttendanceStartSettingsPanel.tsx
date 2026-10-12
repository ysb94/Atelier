import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Clock3, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { useRenderWatch } from '@/lib/diagnostics'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { forgivenClock, resolveAttendanceStart, startTone, SUGGESTED_START } from './attendance-start-settings'
import { type useOpsDirectory } from './ops-directory'
import { type useAttendanceStartSettings } from './use-attendance-start-settings'
import { memberLabel, OpsStat } from './OpsStat'
import './attendance-start-settings.css'

type Target = { employeeId: string | null; departmentId: string | null; label: string; month: string }
export function AttendanceStartSettingsPanel({ directory, schedules, initialEmployeeId, initialMonth, readOnly = false }: { directory: ReturnType<typeof useOpsDirectory>; schedules: ReturnType<typeof useAttendanceStartSettings>; initialEmployeeId?: string; initialMonth?: string; readOnly?: boolean }) {
  useRenderWatch('AttendanceStartSettingsPanel')
  const canEdit = schedules.canEdit && !readOnly
  const { members: allMembers, departmentName } = directory
  const active = useWorkspaceTabActivity()
  const editorRef = useRef<HTMLElement>(null)
  const now = new Date()
  const [year, setYear] = useState(initialMonth?.slice(0,4) ?? String(now.getFullYear()))
  const [monthNo, setMonthNo] = useState(initialMonth?.slice(5,7) ?? String(now.getMonth()+1).padStart(2,'0'))
  const month = `${year}-${monthNo}`
  const [department, setDepartment] = useState('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [target, setTarget] = useState<Target | null>(null)
  const [start, setStart] = useState(SUGGESTED_START)
  const [individual, setIndividual] = useState(true)
  const [grace, setGrace] = useState(5)
  const [until, setUntil] = useState(monthNo)
  const [message, setMessage] = useState('')
  const [showEmptyDepartments, setShowEmptyDepartments] = useState(false)
  const validYear = /^\d{4}$/.test(year) && Number(year)>=2000 && Number(year)<=2100
  const graceUntil = forgivenClock(start, grace)
  const editorSaved = Boolean(target && (target.employeeId ? resolveAttendanceStart(schedules.index, target.employeeId, target.departmentId, target.month).configured : schedules.index.get(`${target.month}:department:${target.departmentId}`)?.start))
  useEffect(() => { if(target && active) editorRef.current?.scrollIntoView({block:'nearest',behavior:'smooth'}) }, [target,active])
  // 저장 전 편집창에 남아 있는 이전 기본값 09:00만 10:00으로 바꿉니다. 9시를 다시 누르면 유지됩니다.
  useEffect(() => { if(target && !editorSaved) setStart(current => current==='09:00' ? SUGGESTED_START : current) }, [target, editorSaved])
  const months = Array.from({length:12},(_,i) => `${year}-${String(i+1).padStart(2,'0')}`)
  const members = useMemo(() => allMembers.filter(member => (department==='all' || (department==='unassigned' ? !member.departmentId : member.departmentId===department)) && (!search.trim() || `${memberLabel(member.displayName)} ${departmentName(member.departmentId)}`.toLowerCase().includes(search.trim().toLowerCase()))).sort((a,b) => departmentName(a.departmentId).localeCompare(departmentName(b.departmentId),'ko') || memberLabel(a.displayName).localeCompare(memberLabel(b.displayName),'ko')), [allMembers,departmentName,department,search])
  const pageCount = Math.max(1,Math.ceil(members.length/25))
  const currentPage = Math.min(page,pageCount)
  const pageMembers = members.slice((currentPage-1)*25,currentPage*25)
  const starts = members.map(member => resolveAttendanceStart(schedules.index,member.id,member.departmentId,month))
  const pending = starts.filter(item => !item.configured).length
  const busy = schedules.save.isPending
  const unavailable = schedules.loading || directory.loading || Boolean(schedules.error || directory.error)
  function edit(next: Target) {
    if (!canEdit) return
    setMonthNo(next.month.slice(5,7))
    const setting = next.employeeId ? resolveAttendanceStart(schedules.index,next.employeeId,next.departmentId,next.month) : schedules.index.get(`${next.month}:department:${next.departmentId}`)
    setTarget(next); setStart(setting?.start || SUGGESTED_START); setGrace(setting?.grace ?? 5)
    setIndividual(!next.employeeId || setting?.source==='individual'); setUntil(next.month.slice(5,7)); setMessage('')
  }
  const initialMember = initialEmployeeId && allMembers.find(member => member.id===initialEmployeeId)
  async function save() {
    if (!target || busy || !validYear || !canEdit) return
    if ((!target.employeeId || individual) && !/^([01]\d|2[0-3]):[0-5]\d$/.test(start)) { setMessage('출근시간을 입력해 주세요.'); return }
    try {
      const count = await schedules.save.mutateAsync({month:target.month,until:`${target.month.slice(0,4)}-${until}`,departmentId:target.departmentId,employeeId:target.employeeId,start:target.employeeId && !individual ? null : start,grace})
      setMessage(`${target.label} · ${count}개월 출근시간을 저장했습니다.`); setTarget(null)
    } catch(error) { console.warn('[attendance-start] 설정 화면 저장 실패',error); setMessage(error instanceof Error ? error.message : '저장하지 못했습니다.') }
  }
  return <div className="attendance-start-settings space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-base font-semibold">{readOnly ? '월별 출근시간' : '월별 출근시간 설정'}</h2><p className="mt-1 text-sm text-muted-foreground">{readOnly ? '직원별 저장값을 확인합니다. 출근시간은 부서 승인자가 마이페이지에서 정합니다.' : '부서 기본시간과 직원별 예외를 저장합니다. 표에서 월을 누르면 해당 직원의 시간을 수정할 수 있습니다.'}</p></div><Button variant="outline" size="sm" disabled={busy} onClick={() => void schedules.refresh()}><RefreshCw size={14}/>새로고침</Button></header>
    {readOnly && <p className="text-sm text-muted-foreground">초록 9시, 보라 10시, 점선은 미설정입니다.</p>}
    {!canEdit && !readOnly && <p className="text-xs text-muted-foreground">출근시간 조회 · 저장은 운영지원 담당자가 처리합니다.</p>}
    <div className="flex flex-wrap items-center gap-2"><Input aria-label="출근시간 연도" type="number" min="2000" max="2100" className="h-9 w-24" value={year} disabled={busy} onChange={event => {setYear(event.target.value);setTarget(null)}}/><Select aria-label="출근시간 부서" value={department} disabled={busy} onChange={event => {setDepartment(event.target.value);setPage(1)}} className="h-9 w-40"><option value="all">전체 부서</option>{directory.departments.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}<option value="unassigned">소속 없음</option></Select><Input aria-label="출근시간 직원 검색" placeholder="직원·부서 검색" value={search} onChange={event => {setSearch(event.target.value);setPage(1)}} className="h-9 w-full sm:w-56"/></div>
    <div className="attendance-start-months" role="group" aria-label="설정 기준 월">{months.map(value => <button key={value} type="button" disabled={busy || !validYear} aria-pressed={month===value} onClick={() => {setMonthNo(value.slice(5,7));setTarget(null)}}>{Number(value.slice(5,7))}월</button>)}</div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><OpsStat label={`${Number(monthNo)}월 직원`} value={`${members.length}명`}/><OpsStat label="부서 기준 적용" value={`${starts.filter(item=>item.configured && item.source==='department').length}명`}/><OpsStat label="직원 개별 설정" value={`${starts.filter(item=>item.configured && item.source==='individual').length}명`}/><OpsStat label="출근시간 미설정" value={`${pending}명`}/></div>
    {initialMember && !target && <Button variant="outline" size="sm" disabled={unavailable || busy || !canEdit} onClick={() => edit({employeeId:initialMember.id,departmentId:initialMember.departmentId,label:memberLabel(initialMember.displayName),month})}>{memberLabel(initialMember.displayName)} 출근시간 설정</Button>}
    {message && <p role="status" className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm">{message}</p>}
    {!validYear && <p role="alert" className="text-sm text-danger">2000–2100년 사이의 연도를 입력해 주세요.</p>}
    {unavailable && <p role="status" className="text-sm text-muted-foreground">{schedules.error || directory.error ? '직원 또는 출근시간을 불러오지 못했습니다. 새로고침해 주세요.' : '직원과 출근시간을 불러오는 중…'}</p>}
    {target && <section ref={editorRef} aria-label="출근시간 편집" className="attendance-start-editor"><header><div><strong>{target.label} · {Number(target.month.slice(5,7))}월 설정</strong><p>{target.employeeId ? '부서 기준을 따르거나 이 직원만 다른 시간으로 지정합니다.' : '개별 시간을 지정한 직원은 유지하고, 부서 기준을 따르는 직원에게 적용합니다.'}</p></div><Button variant="ghost" size="icon" aria-label="출근시간 편집 닫기" disabled={busy} onClick={() => setTarget(null)}><X size={16}/></Button></header><fieldset disabled={busy || unavailable || !canEdit}><div className="attendance-start-editor-fields">{target.employeeId && <label>적용 방식<Select aria-label="출근시간 적용 방식" value={individual?'individual':'department'} onChange={event => setIndividual(event.target.value==='individual')}><option value="department">부서 기준 따르기</option><option value="individual">직원 개별 설정</option></Select></label>}{(!target.employeeId || individual) && <><label>출근시간<Input type="time" aria-label="설정 출근시간" value={start} onChange={event => setStart(event.target.value)}/></label><div className="attendance-start-presets"><Button type="button" size="sm" variant={start==='09:00'?'default':'outline'} aria-pressed={start==='09:00'} onClick={() => setStart('09:00')}>9시</Button><Button type="button" size="sm" variant={start==='10:00'?'default':'outline'} aria-pressed={start==='10:00'} onClick={() => setStart('10:00')}>10시</Button></div><label>봐주는 시간 · 분<Input aria-label="출근 후 봐주는 분" type="number" min={0} max={60} value={grace} onChange={event => setGrace(Math.min(60,Math.max(0,Number(event.target.value)||0)))}/></label></>}<label>적용 마지막 월<Select aria-label="출근시간 적용 마지막 월" value={until} onChange={event => setUntil(event.target.value)}>{months.filter(value=>value>=target.month).map(value=><option key={value} value={value.slice(5,7)}>{Number(value.slice(5,7))}월{value===target.month?' · 해당 월만':''}</option>)}</Select></label></div><p className="mt-3 text-xs text-muted-foreground">{!editorSaved && '저장된 출근시간은 아직 없습니다. '}{(!target.employeeId || individual) && graceUntil ? `${graceUntil}까지는 기준 초과로 보지 않습니다. ` : ''}{target.month} ~ {target.month.slice(0,4)}-{until} 저장 · 다른 월은 그대로 유지됩니다. 선택한 기간의 기존 설정은 변경됩니다.</p><div className="mt-4 flex justify-end"><Button onClick={() => void save()}><Check size={14}/>{busy?'저장 중…':'출근시간 저장'}</Button></div></fieldset></section>}
    <section aria-label="부서 기본 출근시간"><header className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">부서 기본시간 · {Number(monthNo)}월</h3><label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={showEmptyDepartments} onChange={event=>setShowEmptyDepartments(event.target.checked)}/>직원이 없는 부서도 보기</label></header><div className="attendance-start-departments">{directory.departments.filter(item=>(department==='all' ? showEmptyDepartments || allMembers.some(member=>member.departmentId===item.id) : item.id===department)).map(item => {const saved=schedules.index.get(`${month}:department:${item.id}`);const count=allMembers.filter(member=>member.departmentId===item.id).length;const tone=startTone(saved?.start||'');return <article key={item.id}><div><strong>{item.name}</strong><small>{count}명 · {Number(monthNo)}월 기본</small></div><span className={`attendance-start-mark ${tone.tone}`}>{tone.label}</span>{canEdit && <Button variant="outline" size="sm" disabled={unavailable||busy||!validYear} onClick={()=>edit({employeeId:null,departmentId:item.id,label:item.name,month})}><Clock3 size={13}/>설정</Button>}</article>})}</div></section>
    <div className="attendance-start-matrix"><table aria-label="연간 직원 출근시간"><thead><tr><th>부서·직원</th>{months.map(value=><th key={value} className={value===month?'is-current':''}>{Number(value.slice(5,7))}월</th>)}</tr></thead><tbody>{pageMembers.map(member=><tr key={member.id}><th><strong>{memberLabel(member.displayName)}</strong><small>{departmentName(member.departmentId)}</small></th>{months.map(value=>{const resolved=resolveAttendanceStart(schedules.index,member.id,member.departmentId,value);const tone=startTone(resolved.start);return <td key={value} className={value===month?'is-current':''}><button type="button" disabled={unavailable||busy||!validYear||!canEdit} aria-label={`${memberLabel(member.displayName)} ${value} 출근시간 ${tone.label} ${resolved.source==='individual'?'개별':'부서 기준'}`} title={resolved.configured?`${resolved.source==='individual'?'직원 개별 설정':'부서 기준'} · ${resolved.grace}분까지 정상`:'미설정'} className={tone.tone} onClick={()=>edit({employeeId:member.id,departmentId:member.departmentId,label:memberLabel(member.displayName),month:value})}>{tone.label}{resolved.configured&&resolved.source==='individual'&&<i aria-label="개별 설정">•</i>}</button></td>})}</tr>)}{!pageMembers.length&&<tr><td colSpan={13} className="py-10 text-center text-muted-foreground">{unavailable?'정보를 확인하는 중입니다.':'조건에 맞는 직원이 없습니다.'}</td></tr>}</tbody></table></div>
    <footer className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span>초록 9시 · 보라 10시 · • 직원 개별 설정 · 미설정은 자동 지정하지 않습니다.</span><div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={currentPage===1} onClick={()=>setPage(currentPage-1)}>이전</Button>{currentPage}/{pageCount}<Button variant="outline" size="sm" disabled={currentPage===pageCount} onClick={()=>setPage(currentPage+1)}>다음</Button></div></footer>
  </div>
}
