import { createPortal } from 'react-dom'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDownUp, Filter, Plus, X } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input, Textarea } from '@/components/ui/input'
import { StatTile } from '@/components/ui/stat-tile'
import { StatusPill } from '@/components/ui/status-pill'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/lib/supabase/auth'
import { getSupabase } from '@/lib/supabase/client'
import { listCompanyNotices, saveCompanyNotice } from '@/lib/supabase/company-notices'
import { visibleCompanyNotices } from '@/lib/company/company-notices'
import { hasPermission } from '@/lib/company/permissions'
import { useRenderWatch } from '@/lib/diagnostics'
import { emptyList } from '@/lib/utils'
import { clearWorkFilters, filterDepartmentWork, type DepartmentWork, type WorkFilters } from './department-work'
import { WORK_REQUEST_CONFIG, WORK_REQUEST_DEPARTMENT_IDS, type WorkRequestOwner } from './work-request-form-config'
import { STATUS_META } from './work-request-types'

function ColumnFilter({ label, options, selected, onApply }: { label: string; options: [string, string][]; selected: string[]; onApply: (value: string[]) => void }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(selected)
  const host = useRef<HTMLDivElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  useEffect(() => {
    if (!open) return
    function close(event: globalThis.PointerEvent) { if (!host.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node)) setOpen(false) }
    function escape(event: globalThis.KeyboardEvent) { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape) }
  }, [open])
  return <div ref={host} className="relative"><button type="button" aria-expanded={open} aria-label={`${label} 필터`} className="inline-flex items-center gap-1" onClick={() => { const rect = host.current?.getBoundingClientRect(); if (rect) setPosition({ left: Math.max(8, Math.min(rect.right - 224, window.innerWidth - 232)), top: Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 360)) }); setDraft(selected); setOpen(!open) }}>{label}<Filter className="size-3" />{selected.length ? ` ${selected.length}` : ''}</button>
    {open ? createPortal(<div ref={popup} style={position} role="dialog" aria-label={`${label} 필터 선택`} className="fixed z-[60] w-56 rounded-xl border border-border bg-card p-3 text-left text-foreground shadow-sm"><div className="mb-3 flex justify-between"><span>필터 선택</span><button type="button" className="text-xs text-muted-foreground" onClick={() => setDraft([])}>초기화</button></div><div className="max-h-56 overflow-auto">{options.map(([id, name]) => <label key={id} className="flex gap-2 py-1 text-sm"><input type="checkbox" checked={draft.includes(id)} onChange={() => setDraft(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id])} />{name}</label>)}</div><Button type="button" size="sm" className="mt-3 w-full" onClick={() => { onApply(draft); setOpen(false) }}>선택한 {draft.length}개 필터 적용</Button></div>, document.body) : null}</div>
}

export function DepartmentWorkBoard({ owner }: { owner: WorkRequestOwner }) {
  useRenderWatch('DepartmentWorkBoard')
  const { profile, session } = useAuth()
  const activeSession = profile?.status === 'active' && session?.user.id === profile.id
  const actor = profile?.id ?? ''
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['department-work', actor, owner], enabled: activeSession, retry: false, queryFn: async () => {
    const { data, error } = await getSupabase().rpc('list_department_work', { p_owner: owner })
    if (error) { console.warn('[department-work] 목록 조회 실패', error); throw new Error(error.message) }
    return data as DepartmentWork[]
  } })
  const notices = useQuery({ queryKey: ['department-work-notices', actor, owner], queryFn: () => listCompanyNotices('department'), enabled: activeSession })
  useEffect(() => {
    const refresh = () => { void client.invalidateQueries({ queryKey: ['department-work', actor, owner] }) }
    const channel = getSupabase().channel(`department-work:${actor}:${owner}`).on('postgres_changes', { event: '*', schema: 'public', table: 'work_requests', filter: `owner=eq.${owner}` }, refresh).subscribe(status => { if (status === 'SUBSCRIBED') refresh(); if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') console.warn('[department-work] 실시간 연결 실패', { status, owner }) })
    window.addEventListener('online', refresh)
    return () => { window.removeEventListener('online', refresh); void getSupabase().removeChannel(channel) }
  }, [actor, owner, client])
  const [filters, setFilters] = useState<WorkFilters>(clearWorkFilters)
  const [search, setSearch] = useState('')
  const [noticeDraft, setNoticeDraft] = useState<{title: string; body: string} | null>(null)
  const [noticeError, setNoticeError] = useState('')
  const [noticeSaving, setNoticeSaving] = useState(false)
  async function registerNotice() {
    if (!noticeDraft || !noticeDraft.title.trim() || !noticeDraft.body.trim() || noticeSaving) return
    setNoticeSaving(true); setNoticeError('')
    try { await saveCompanyNotice({slot:'department',departmentId:WORK_REQUEST_DEPARTMENT_IDS[owner],title:noticeDraft.title,body:noticeDraft.body,published:true,startsOn:null,endsOn:null}); setNoticeDraft(null); await notices.refetch() }
    catch(error) { console.warn('[department-work] 팀 공지 저장 실패',error); setNoticeError(error instanceof Error ? error.message : '공지를 저장하지 못했습니다.') }
    finally { setNoticeSaving(false) }
  }
  const [section, setSection] = useState('team')
  const [sort, setSort] = useState<{ field: 'createdAt' | 'dueDate'; direction: number }>({ field: 'dueDate', direction: 1 })
  const rows = (activeSession ? query.data : undefined) ?? emptyList<DepartmentWork>()
  const options = useMemo(() => {
    const requester = new Map<string, string>(), assignee = new Map<string, string>([['unassigned', '미정']]), brand = new Map<string, string>([['undecided', '브랜드 미정']])
    for (const row of rows) { requester.set(row.requesterId, `${row.requesterName} · ${row.requesterDepartment || '부서 미정'}`); row.assigneeIds.forEach((id, index) => assignee.set(id, row.assigneeNames[index] || '직원')); if (row.brandId) brand.set(row.brandId, row.brandName) }
    return { requester: [...requester], assignee: [...assignee], brand: [...brand], status: Object.entries(STATUS_META).map(([id, meta]): [string, string] => [id, meta.label]) }
  }, [rows])
  const active = rows.filter(row => !['completed', 'cancelled', 'rejected'].includes(row.status))
  const inSection = (row: DepartmentWork, value: string) => value === 'mine' ? row.assigneeIds.includes(actor) : value === 'inbox' ? ['requested', 'reviewing'].includes(row.status) : value === 'progress' ? row.status === 'inProgress' : value === 'completion' ? ['completionReview', 'completionConfirm'].includes(row.status) : true
  const visible = filterDepartmentWork(rows, filters, search).filter(row => inSection(row, section)).sort((a, b) => {
    const left = a[sort.field], right = b[sort.field]
    return (!left ? 1 : !right ? -1 : left.localeCompare(right) * sort.direction) || a.id.localeCompare(b.id)
  })
  const groups = new Map<string, DepartmentWork[]>()
  for (const row of visible) { const key = row.requesterDepartment || '부서 미정'; const group = groups.get(key); if (group) group.push(row); else groups.set(key, [row]) }
  const dueSoon = active.filter(row => row.dueDate && new Date(row.dueDate + 'T23:59:59+09:00').getTime() - Date.now() < 3 * 86400000).length
  const departmentId = WORK_REQUEST_DEPARTMENT_IDS[owner]
  const canWriteNotice = hasPermission(profile, 'notice.department.write', 'department', departmentId) || hasPermission(profile, 'notice.department.write', 'company', profile?.companyId)
  const teamNotices = visibleCompanyNotices(notices.data ?? emptyList(), new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }), departmentId).filter(notice => notice.departmentId === departmentId)
  const toggleSort = (field: 'createdAt' | 'dueDate') => setSort(current => ({ field, direction: current.field === field ? -current.direction : 1 }))
  return <div className="space-y-5">
    {noticeDraft ? <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4"><form role="dialog" aria-modal="true" aria-label="팀 공지 등록" className="w-full max-w-lg space-y-4 rounded-xl border border-border bg-card p-5 shadow-sm" onSubmit={event => { event.preventDefault(); void registerNotice() }}><h2 className="font-semibold">팀 공지 등록</h2><label className="block">제목<Input required value={noticeDraft.title} onChange={event => setNoticeDraft({...noticeDraft,title:event.target.value})} /></label><label className="block">내용<Textarea required value={noticeDraft.body} onChange={event => setNoticeDraft({...noticeDraft,body:event.target.value})} /></label>{noticeError ? <p role="alert" className="text-danger">{noticeError}</p> : null}<div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={noticeSaving} onClick={() => setNoticeDraft(null)}>취소</Button><Button disabled={noticeSaving}>등록</Button></div></form></div> : null}
    <PageHeader title={`${WORK_REQUEST_CONFIG[owner].teamName} 부서 업무`} description="받은 요청과 부서 자체 업무를 함께 확인합니다." actions={<Link to={`?aux=1`}><Button variant="outline">일정표·업무 처리</Button></Link>} />
    <Card className="p-4"><div className="flex items-center justify-between"><h2 className="font-semibold">팀 공지</h2>{canWriteNotice ? <Button size="sm" variant="outline" onClick={() => { setNoticeError(''); setNoticeDraft({title:'',body:''}) }}>공지 등록</Button> : null}</div>{notices.isError ? <p role="alert">공지를 불러오지 못했습니다.<button type="button" onClick={() => void notices.refetch()}>다시 조회</button></p> : teamNotices.map(notice => <details key={notice.id} className="border-t border-border py-3"><summary>{notice.title}</summary><p className="mt-2 whitespace-pre-wrap text-sm">{notice.body}</p></details>)}{!teamNotices.length && !notices.isError ? <p className="mt-3 text-sm text-muted-foreground">등록된 팀 공지가 없습니다.</p> : null}</Card>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{[['mine', '내 업무'], ['team', '팀 업무'], ['inbox', '접수 대기'], ['progress', '진행 중'], ['completion', '완료 대기']].map(([id, label]) => <button type="button" key={id} aria-pressed={section === id} onClick={() => setSection(id)}><StatTile label={label} value={active.filter(row => inSection(row, id)).length} accent={section === id} /></button>)}</div>
    {dueSoon ? <p className="text-sm text-danger">마감 임박·초과 {dueSoon}건</p> : null}
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><h2 className="font-semibold">팀 업무 목록</h2><Link to="?mode=new&internal=1"><Button size="sm"><Plus className="size-4" />업무 등록</Button></Link></div><div className="flex items-center gap-2"><Input aria-label="업무 검색" placeholder="업무 검색" value={search} onChange={event => setSearch(event.target.value)} /><Button variant="ghost" size="sm" onClick={() => { setFilters(clearWorkFilters()); setSearch(''); setSection('team') }}><X className="size-4" />초기화</Button></div></div>
    {query.isError ? <Card className="p-5"><p role="alert">{query.error.message}</p><p className="mt-2 text-sm text-muted-foreground">부서 업무 조회 연결을 확인해 주세요.</p><Button onClick={() => void query.refetch()}>다시 조회</Button></Card> : query.isPending ? <p role="status">업무를 불러오는 중...</p> : <Card className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-primary text-primary-foreground"><tr><th className="p-3">업무명</th>{(['requester', 'assignee', 'status'] as const).map((key, index) => <th key={key} className="p-3"><ColumnFilter label={['요청자', '담당자', '상태'][index]} options={options[key]} selected={filters[key]} onApply={value => setFilters(current => ({ ...current, [key]: value }))} /></th>)}{(['createdAt', 'dueDate'] as const).map((field, index) => <th className="p-3" key={field}><button type="button" onClick={() => toggleSort(field)} className="inline-flex items-center gap-1">{['요청 날짜', '마감 날짜'][index]}<ArrowDownUp className="size-3" />{sort.field === field ? sort.direction === 1 ? '↑' : '↓' : ''}</button></th>)}<th className="p-3"><ColumnFilter label="브랜드" options={options.brand} selected={filters.brand} onApply={brand => setFilters(current => ({ ...current, brand }))} /></th></tr></thead><tbody>{[...groups].sort(([a], [b]) => a.localeCompare(b)).map(([department, items]) => <Fragment key={department}><tr><th colSpan={7} className="bg-muted/40 p-3">{department}</th></tr>{items.map(row => <tr key={row.id} className="border-t border-border"><td className="p-3"><Link className="font-medium hover:underline" to={`?requestId=${row.id}`}>{row.title}</Link>{row.kind === 'internal' ? <Badge className="ml-2" variant="muted">자체 업무</Badge> : null}</td><td className="p-3">{row.requesterName}</td><td className="p-3">{row.assigneeNames.join(', ') || '미정'}</td><td className="p-3"><StatusPill tone={STATUS_META[row.status]?.variant}>{STATUS_META[row.status]?.label ?? row.status}</StatusPill></td><td className="p-3">{row.createdAt.slice(0, 10)}</td><td className={`p-3 ${row.dueDate && row.dueDate < new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }) && !['completed', 'cancelled', 'rejected'].includes(row.status) ? 'text-danger' : ''}`}>{row.dueDate || '미정'}</td><td className="p-3">{row.brandName || '브랜드 미정'}</td></tr>)}</Fragment>)}{!visible.length ? <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">조건에 맞는 업무가 없습니다.</td></tr> : null}</tbody></table></Card>}
  </div>
}
