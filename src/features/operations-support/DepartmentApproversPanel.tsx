import { useMemo, useState } from 'react'
import { RefreshCw, UserCheck, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { useRenderWatch } from '@/lib/diagnostics'
import { useOpsDirectory } from './ops-directory'
import { useDepartmentApprovers } from './use-department-approvers'
import { OpsPanelFrame, OpsStat, memberLabel } from './OpsStat'
import type { ApprovalType } from '@/lib/supabase/department-approvers'
import { ApproverSelfRequestsPanel } from './ApproverSelfRequestsPanel'

const TYPES = [{ id: 'leave', label: '휴가·외근·재택·정정' }, { id: 'overtime', label: '야근' }] as const
type Draft = { approverId: string; substituteId: string }

export function DepartmentApproversPanel({ initialPart = 'departments' }: { initialPart?: 'departments' | 'self' } = {}) {
  useRenderWatch('DepartmentApproversPanel')
  const [part, setPart] = useState<'departments' | 'self'>(initialPart)
  return <div className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-2" role="tablist" aria-label="승인자 설정 영역">
      {([
        { id: 'departments', title: '부서별 승인자', detail: '일반 직원의 근태·야근 신청 담당' },
        { id: 'self', title: '승인자 본인 신청 담당', detail: '승인자·운영지원 책임자의 신청 담당' },
      ] as const).map(item => <button key={item.id} type="button" role="tab" id={`approver-${item.id}-tab`} aria-controls={`approver-${item.id}-panel`} aria-selected={part === item.id} onClick={() => setPart(item.id)} className={`rounded-xl border px-5 py-4 text-left transition-colors ${part === item.id ? 'border-primary/40 bg-primary/5' : 'border-border bg-card hover:bg-muted/40'}`}><span className="block text-sm font-semibold">{item.title}</span><span className="mt-1 block text-xs text-muted-foreground">{item.detail}</span></button>)}
    </div>
    <div id="approver-departments-panel" role="tabpanel" aria-labelledby="approver-departments-tab" hidden={part !== 'departments'}><DepartmentApproversSettings /></div>
    <div id="approver-self-panel" role="tabpanel" aria-labelledby="approver-self-tab" hidden={part !== 'self'}><ApproverSelfRequestsPanel /></div>
  </div>
}

function DepartmentApproversSettings() {
  useRenderWatch('DepartmentApproversSettings')
  const directory = useOpsDirectory()
  const approvals = useDepartmentApprovers()
  const [search, setSearch] = useState('')
  const [onlyMissing, setOnlyMissing] = useState(false)
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>({ approverId: '', substituteId: '' })
  const [reviewed, setReviewed] = useState(true)
  const [message, setMessage] = useState('')
  const memberIndex = useMemo(() => new Map(directory.members.map(member => [member.id, member])), [directory.members])
  const settingIndex = useMemo(() => new Map(approvals.settings.map(setting => [`${setting.departmentId}:${setting.type}`, setting])), [approvals.settings])
  const missing = (departmentId: string, type: ApprovalType) => {
    const id = settingIndex.get(`${departmentId}:${type}`)?.approverId
    return !id || !memberIndex.has(id)
  }
  const unified = (departmentId: string) => {
    const leave = settingIndex.get(`${departmentId}:leave`), overtime = settingIndex.get(`${departmentId}:overtime`)
    return (leave?.approverId ?? null) === (overtime?.approverId ?? null) && (leave?.substituteId ?? null) === (overtime?.substituteId ?? null)
  }
  const needsSetting = (id: string) => !unified(id) || TYPES.some(type => missing(id, type.id))
  const departments = directory.departments.filter(dept => (!onlyMissing || needsSetting(dept.id))
    && (!search.trim() || `${dept.name} ${TYPES.map(type => {
      const setting = settingIndex.get(`${dept.id}:${type.id}`)
      return `${setting?.approverId ? memberIndex.get(setting.approverId)?.displayName ?? '' : ''} ${setting?.substituteId ? memberIndex.get(setting.substituteId)?.displayName ?? '' : ''}`
    }).join(' ')}`.toLowerCase().includes(search.trim().toLowerCase())))
  const pages = Math.max(1, Math.ceil(departments.length / 15))
  const currentPage = Math.min(page, pages)
  const target = directory.departments.find(dept => dept.id === editing)
  const busy = approvals.save.isPending
  const unavailable = directory.loading || approvals.loading || Boolean(directory.error || approvals.error)
  const name = (id: string | null | undefined) => id ? memberIndex.has(id) ? memberLabel(memberIndex.get(id)?.displayName ?? null) : '재직 상태 확인 필요' : '미지정'
  function edit(id: string) {
    const same = unified(id), saved = settingIndex.get(`${id}:leave`)
    setEditing(id); setReviewed(same)
    setDraft(same ? { approverId: saved?.approverId ?? '', substituteId: saved?.substituteId ?? '' } : { approverId: '', substituteId: '' })
    setMessage(same ? '' : '기존 근태·야근 지정이 다릅니다. 현재 내역은 유지되며, 통합할 승인자와 대체 승인자를 직접 선택한 뒤 저장하세요.')
  }
  async function save() {
    if (!target || busy || unavailable || !approvals.canEdit || !reviewed) return
    if (draft.substituteId && (!draft.approverId || draft.substituteId === draft.approverId)) {
      setMessage('승인자를 먼저 지정하고, 대체 승인자는 다른 직원으로 선택해 주세요.'); return
    }
    try {
      await approvals.save.mutateAsync([target.id, TYPES.map(type => ({ type: type.id,
        approverId: draft.approverId || null, substituteId: draft.substituteId || null }))])
      setMessage(`${target.name}의 근태·야근 승인자를 저장했습니다.`); setEditing(null)
    } catch (error) { console.warn('[department-approvers] 설정 저장 실패', error); setMessage(error instanceof Error ? error.message : '저장하지 못했습니다.') }
  }
  return <OpsPanelFrame>
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 text-base font-semibold"><UserCheck size={18}/>부서별 승인자 설정</h2><p className="mt-1 text-sm text-muted-foreground">부서마다 통합 승인자 한 명을 지정합니다. 연차·반차·반반차·공가·외근·재택·출퇴근 정정·야근 신청을 My home의 ‘승인할 신청’에서 승인·반려합니다.</p></div><Button size="sm" variant="outline" disabled={busy} onClick={() => { directory.refetch(); void approvals.refresh() }}><RefreshCw size={14}/>새로고침</Button></header>
    <div className="grid grid-cols-2 gap-3"><OpsStat label="전체 부서" value={`${directory.departments.length}개`}/><OpsStat label="통합 승인자 설정 필요" value={`${directory.departments.filter(dept => needsSetting(dept.id)).length}개`}/></div>
    <div className="flex flex-wrap items-center gap-3"><Input aria-label="승인자 설정 검색" placeholder="부서·승인자 검색" value={search} className="h-9 w-full sm:w-72" onChange={event => { setSearch(event.target.value); setPage(1) }}/><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyMissing} onChange={event => { setOnlyMissing(event.target.checked); setPage(1) }}/>미지정·통합 확인 필요만</label></div>
    {message && <p role="status" className="rounded-xl border border-border bg-muted/40 p-4 text-sm">{message}</p>}
    {target && <section aria-label="부서 승인자 편집" className="rounded-2xl border border-primary/30 bg-card p-5"><header className="mb-4 flex items-center justify-between"><h3 className="font-semibold">{target.name} 승인자 지정</h3><Button variant="ghost" size="icon" aria-label="승인자 편집 닫기" disabled={busy} onClick={() => setEditing(null)}><X size={16}/></Button></header><fieldset disabled={busy || unavailable || !approvals.canEdit} className="grid gap-5 sm:grid-cols-2">{(['approverId', 'substituteId'] as const).map(key => <label key={key} className="block text-xs text-muted-foreground">{key === 'approverId' ? '통합 승인자' : '대체 승인자 · 선택'}<Select aria-label={key === 'approverId' ? '통합 승인자' : '통합 대체 승인자'} className="mt-2 w-full" value={draft[key]} onChange={event => { setReviewed(true); setDraft(current => ({ ...current, [key]: event.target.value })) }}><option value="">미지정</option>{draft[key] && !memberIndex.has(draft[key]) && <option value={draft[key]}>재직 상태 확인 필요 · 다시 선택</option>}{directory.members.map(member => <option key={member.id} value={member.id}>{memberLabel(member.displayName)} · {directory.departmentName(member.departmentId)}{member.position ? ` · ${member.position}` : ''}</option>)}</Select></label>)}</fieldset><p className="mt-4 text-xs leading-6 text-muted-foreground">같은 회사의 재직 직원 중 선택합니다. 승인자와 대체 승인자 모두 처리할 수 있으며, 본인 신청은 다른 지정 담당자가 처리합니다. 변경된 담당자는 기존 대기 신청에도 적용됩니다.</p><div className="mt-4 flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={() => setEditing(null)}>닫기</Button><Button disabled={busy || unavailable || !approvals.canEdit || !reviewed} onClick={() => void save()}>{busy ? '저장 중…' : '승인자 저장'}</Button></div></section>}
    <article className="overflow-hidden rounded-xl border border-border bg-card shadow-sm"><div className="overflow-x-auto"><table aria-label="부서별 승인자 목록" className="w-full min-w-[700px] text-left text-sm"><thead className="border-b border-border bg-primary text-xs text-primary-foreground"><tr>{['부서', '직원', '통합 승인자', '설정'].map(label => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody>{unavailable ? <tr><td colSpan={4} className="p-10 text-center text-muted-foreground">{directory.error || approvals.error ? '설정을 불러오지 못했습니다. 새로고침해 주세요.' : '불러오는 중…'}</td></tr> : !departments.length ? <tr><td colSpan={4} className="p-10 text-center text-muted-foreground">해당 조건의 부서가 없습니다.</td></tr> : departments.slice((currentPage - 1) * 15, currentPage * 15).map(dept => <tr key={dept.id} className="border-b border-border/70 last:border-0"><td className="px-4 py-4 font-medium">{dept.name}</td><td className="px-4 py-4 text-muted-foreground">{directory.members.filter(member => member.departmentId === dept.id).length}명</td>{unified(dept.id) ? <td className="px-4 py-4"><span className={needsSetting(dept.id) ? 'text-warning' : ''}>{name(settingIndex.get(`${dept.id}:leave`)?.approverId)}</span>{settingIndex.get(`${dept.id}:leave`)?.substituteId && <span className="mt-1 block text-xs text-muted-foreground">대체 · {name(settingIndex.get(`${dept.id}:leave`)?.substituteId)}</span>}</td> : <td className="px-4 py-4"><span className="text-warning">통합 확인 필요 · 기존 지정 유지</span>{TYPES.map(type => {const setting=settingIndex.get(`${dept.id}:${type.id}`);return <span key={type.id} className="mt-1 block text-xs text-muted-foreground">{type.label} · {name(setting?.approverId)}{setting?.substituteId ? ` / 대체 · ${name(setting.substituteId)}` : ''}</span>})}</td>}<td className="px-4 py-4"><Button size="sm" variant="outline" disabled={busy || !approvals.canEdit} aria-label={`${dept.name} 승인자 지정`} onClick={() => edit(dept.id)}>지정·수정</Button></td></tr>)}</tbody></table></div><footer className="flex items-center justify-between border-t border-border p-3 text-xs text-muted-foreground"><span>{departments.length}개 부서 · {currentPage}/{pages}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>이전</Button><Button size="sm" variant="outline" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>다음</Button></div></footer></article>
    <p className="text-xs text-muted-foreground">승인자 미지정·퇴사·소속 미정인 경우 신청 화면에서 안내합니다. 운영지원 소속이나 관리자 직책만으로 승인 권한이 부여되지는 않습니다.</p>
  </OpsPanelFrame>
}
