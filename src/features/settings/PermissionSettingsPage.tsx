import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { useAuth } from '@/lib/supabase/auth'
import { PERMISSION_CATALOG, hasPermission, permissionLabel, scopeLabel, type PermissionCode, type PermissionGrant, type PermissionScope } from '@/lib/company/permissions'
import { getPermissionDirectory, setPermissionGrant } from '@/lib/supabase/permission-grants'
import { DepartmentApproversPanel } from '@/features/operations-support/DepartmentApproversPanel'
import { useRenderWatch } from '@/lib/diagnostics'
import { emptyList } from '@/lib/utils'
import { PermissionAssignmentCatalog } from './PermissionAssignmentCatalog'

type PendingGrant = { profileId: string; permission: PermissionCode; scopeKind: PermissionScope; scopeId: string; enabled: boolean }
export function PermissionSettingsPage() {
  useRenderWatch('PermissionSettingsPage')
  const { profile } = useAuth()
  const fullAccess = hasPermission(profile, 'permissions.manage') || (profile?.permissionMode === 'legacy' && profile.isAdmin)
  const manage = fullAccess || hasPermission(profile, 'partner.manage')
  const approvers = hasPermission(profile, 'approvers.manage')
  if (!manage && !approvers) return <><PageHeader title="권한·담당자 설정"/><p role="status">권한 지정 관리 또는 승인자 지정 권한이 필요합니다.</p></>
  return <PermissionSettingsContent key={fullAccess ? 'all' : 'delegated'} manage={manage} fullAccess={fullAccess} approvers={approvers}/>
}

function PermissionSettingsContent({ manage, fullAccess, approvers }: { manage: boolean; fullAccess: boolean; approvers: boolean }) {
  const { profile, refreshProfile } = useAuth()
  const client = useQueryClient()
  const [view, setView] = useState<'features' | 'people' | 'approvers'>(manage ? 'features' : 'approvers')
  const [catalogOpen,setCatalogOpen]=useState(profile?.permissionMode==='legacy')
  const [approverPart,setApproverPart]=useState<'departments'|'self'>('departments')
  const [permission, setPermission] = useState<PermissionCode>(fullAccess ? 'work.manage' : 'partner.edit')
  const [person, setPerson] = useState('')
  const [scopeKind, setScopeKind] = useState<PermissionScope>(fullAccess ? 'department' : 'partner')
  const [scopeId, setScopeId] = useState('')
  const [search, setSearch] = useState('')
  const [pending, setPending] = useState<PendingGrant | null>(null)
  const [message, setMessage] = useState('')
  const directory = useQuery({ queryKey: ['permission-directory', profile?.id], queryFn: getPermissionDirectory, enabled: manage, retry: false })
  const grants = directory.data?.grants ?? emptyList<PermissionGrant>()
  const members = directory.data?.profiles ?? []
  const scopes = directory.data?.scopes ?? []
  const visible = useMemo(() => grants.filter(grant => view === 'people' ? grant.profileId === person : grant.permission === permission), [grants, view, person, permission])
  const name = (id: string | undefined) => members.find(member => member.id === id)?.name ?? '직원 확인 필요'
  const targetName = (kind: PermissionScope, id: string) => scopes.find(scope => scope.kind === kind && scope.id === id)?.name ?? id
  const allowedScopes = (fullAccess ? PERMISSION_CATALOG.find(item => item[0] === permission)![3].split(',') : ['partner']) as PermissionScope[]
  const mutation = useMutation({ mutationFn: async (input: PendingGrant) => {
    if (!manage || !directory.data) throw new Error('권한 지정 관리 권한을 확인해 주세요.')
    await setPermissionGrant({ ...input, revision: directory.data.revision })
  }, onSuccess: async () => {
    setPending(null); setMessage('지정 내역을 저장했습니다.')
    await Promise.all([client.invalidateQueries({ queryKey: ['permission-directory'] }), client.invalidateQueries({ queryKey: ['department-approvers'] }), client.invalidateQueries({ queryKey: ['orgChartMembers'] })])
    await refreshProfile()
  }, onError: (error: Error) => { console.warn('[permissions] 지정 저장 실패', error); setMessage(error.message) } })
  function choosePermission(next: PermissionCode) {
    const kinds = (fullAccess ? PERMISSION_CATALOG.find(item => item[0] === next)![3].split(',') : ['partner']) as PermissionScope[]
    setPermission(next); setScopeKind(kinds.includes('department') ? 'department' : kinds[0]); setScopeId(''); setPending(null)
  }
  const disabled = mutation.isPending || directory.isFetching || Boolean(directory.error)
  return <div className="space-y-5">
    <PageHeader title="권한·담당자 설정" description="직책·직급과 관계없이 사람과 대상 범위를 지정합니다."/>
    {directory.data?.activation==='pending' && <p role="status" className="rounded-lg border border-border bg-muted/40 p-3 text-sm">담당자 지정·저장·해제가 연결되었습니다. 저장한 새 지정은 실제 기능별 권한 전환 전까지 적용 대기 상태이며, 현재 이용 권한과 로그인·가입 승인·근태 승인자 내역은 유지됩니다.</p>}
    <div role="tablist" aria-label="권한 설정 보기" className="flex flex-wrap gap-2 border-b border-border pb-3">
      {manage && <><Button role="tab" aria-selected={view === 'features'} variant={view === 'features' ? 'default' : 'outline'} onClick={() => { setView('features'); setPending(null) }}>기능별 담당자</Button><Button role="tab" aria-selected={view === 'people'} variant={view === 'people' ? 'default' : 'outline'} onClick={() => { setView('people'); setPending(null) }}>직원별 권한</Button></>}
      {approvers && <Button role="tab" aria-selected={view === 'approvers'} variant={view === 'approvers' ? 'default' : 'outline'} onClick={() => { setView('approvers'); setPending(null) }}>근태·야근 승인자</Button>}
      {manage && <Button variant="outline" disabled={directory.isFetching || mutation.isPending} onClick={() => { setPending(null); void directory.refetch() }}>지정 내역 새로 불러오기</Button>}
    </div>
    {manage && <details open={catalogOpen} onToggle={event=>setCatalogOpen(event.currentTarget.open)} className="rounded-xl border border-border p-4"><summary className="cursor-pointer text-sm font-semibold">전체 승인·담당 업무 목록</summary><div className="mt-4"><PermissionAssignmentCatalog pendingActivation={directory.data?.activation==='pending'} delegated={!fullAccess} canEditApprovers={approvers} grants={grants} loading={directory.isPending} error={Boolean(directory.error)} onApprovers={part=>{setApproverPart(part);setView('approvers');setPending(null);setCatalogOpen(false)}} onPermission={code=>{choosePermission(code);setView('features');setCatalogOpen(false)}}/></div></details>}
    {view === 'approvers' ? <DepartmentApproversPanel key={approverPart} initialPart={approverPart}/> : <>
      <p className="text-sm text-muted-foreground">권한이 있는 행동만 허용됩니다. 본인 신청 승인 금지와 기존 검수·업무 단계는 계속 적용됩니다.</p>
      {directory.error && <div role="alert" className="rounded-xl border border-danger p-4">{directory.error.message}<Button className="ml-3" variant="outline" onClick={() => void directory.refetch()}>다시 불러오기</Button></div>}
      <section aria-label="담당 권한 지정" className="grid gap-4 rounded-xl border border-border bg-card p-5 sm:grid-cols-2 xl:grid-cols-4 shadow-sm">
        <label className="space-y-2 text-sm">기능·행동<Select aria-label="지정할 권한" value={permission} onChange={event => choosePermission(event.target.value as PermissionCode)}>{PERMISSION_CATALOG.filter(item => fullAccess || item[0] === 'partner.edit').map(([id,label,group]) => <option key={id} value={id}>{group} · {label}</option>)}</Select></label>
        <label className="space-y-2 text-sm">직원 검색<Input value={search} onChange={event => setSearch(event.target.value)} placeholder="이름·부서 검색" aria-label="권한 지정 직원 검색"/><Select aria-label="지정할 직원" value={person} onChange={event => { setPerson(event.target.value); setPending(null) }}><option value="">직원을 선택하세요</option>{members.filter(member => member.status === 'active' && `${member.name} ${member.department}`.includes(search)).map(member => <option key={member.id} value={member.id}>{member.name} · {member.department || '소속 없음'}{member.id === profile?.id ? ' · 본인(변경 불가)' : ''}</option>)}</Select></label>
        <label className="space-y-2 text-sm">범위 종류<Select aria-label="권한 범위 종류" value={scopeKind} onChange={event => { setScopeKind(event.target.value as PermissionScope); setScopeId(''); setPending(null) }}>{allowedScopes.map(kind => <option key={kind} value={kind}>{scopeLabel(kind)}</option>)}</Select></label>
        <label className="space-y-2 text-sm">대상<Select aria-label="권한 대상" value={scopeId} onChange={event => { setScopeId(event.target.value); setPending(null) }}><option value="">대상을 선택하세요</option>{scopes.filter(scope => scope.kind === scopeKind).map(scope => <option key={scope.id} value={scope.id}>{scope.name}</option>)}</Select></label>
        <Button disabled={disabled || !person || person === profile?.id || !scopeId} onClick={() => { setMessage(''); setPending({ profileId: person, permission, scopeKind, scopeId, enabled: true }) }}>지정 내용 확인</Button>
      </section>
      {pending && <section aria-label="권한 변경 확인" className="rounded-xl border border-primary p-5"><p><strong>{name(pending.profileId)}</strong> · {permissionLabel(pending.permission)} · {targetName(pending.scopeKind,pending.scopeId)}</p><p className="my-3">이 권한을 {pending.enabled ? '지정합니다.' : '해제합니다.'} 다른 지정 내역은 유지됩니다.</p><div className="flex gap-2"><Button disabled={mutation.isPending} onClick={() => mutation.mutate(pending)}>{mutation.isPending ? '저장 중…' : '변경 저장'}</Button><Button variant="outline" disabled={mutation.isPending} onClick={() => setPending(null)}>취소</Button></div></section>}
      {message && <p role="status" className="rounded-lg border border-border p-3">{message}</p>}
      <div className="overflow-x-auto rounded-xl border border-border"><table aria-label="지정된 권한 목록" className="w-full min-w-[650px] text-left text-sm"><thead className="bg-primary text-primary-foreground"><tr>{['직원','기능·행동','대상 범위','관리'].map(label => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{directory.isPending ? <tr><td colSpan={4} className="p-6">불러오는 중…</td></tr> : !visible.length ? <tr><td colSpan={4} className="p-6">{directory.error ? '지정 내역을 확인하지 못했습니다. 다시 불러와 주세요.' : view === 'people' && !person ? '직원을 선택하면 모든 지정 권한을 볼 수 있습니다.' : '지정된 담당자가 없습니다.'}</td></tr> : visible.map(grant => <tr key={grant.id} className="border-t border-border"><td className="p-3">{name(grant.profileId)}</td><td className="p-3">{permissionLabel(grant.permission)}</td><td className="p-3">{scopeLabel(grant.scopeKind)} · {targetName(grant.scopeKind,grant.scopeId)}</td><td className="p-3"><Button variant="outline" size="sm" disabled={disabled || grant.profileId === profile?.id} onClick={() => { setMessage(''); setPending({ ...grant, profileId: grant.profileId!, enabled: false }) }}>해제 내용 확인</Button></td></tr>)}</tbody></table></div>
      <p className="text-xs text-muted-foreground">본인의 권한 변경은 다른 권한 관리 담당자에게 요청합니다. 기존 승인자·대체 승인자는 위 ‘근태·야근 승인자’에서 같은 원본 내역으로 관리합니다.</p>
      <section aria-label="권한 변경 이력" className="rounded-xl border border-border p-4"><h2 className="mb-3 text-sm font-semibold">최근 권한 변경</h2>{directory.data?.events?.length ? <ul className="space-y-2 text-sm">{directory.data.events.map(event => <li key={event.id}><span className="text-muted-foreground">{new Date(event.createdAt).toLocaleString('ko-KR')} · {event.actor}</span><br/>{event.person} · {permissionLabel(event.permission)} · {targetName(event.scopeKind,event.scopeId)} · {event.enabled ? '지정' : '해제'}</li>)}</ul> : <p className="text-sm text-muted-foreground">기록된 변경이 없습니다.</p>}</section>
    </>}
  </div>
}
