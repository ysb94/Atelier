import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { FilterBar } from '@/components/ui/filter-bar'
import { Input, Select } from '@/components/ui/input'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { canEditOrgAssignment } from '@/lib/company/capabilities'
import { useRenderWatch } from '@/lib/diagnostics'
import { useAuth } from '@/lib/supabase/auth'
import { useBasicWorkAccess } from '@/lib/supabase/basic-work-access'
import { listEmployeeRosters, saveEmployeeRosterField } from '@/lib/supabase/employee-roster'
import { memberLabel, OpsPanelFrame, OpsStat } from './OpsStat'
import { useOpsDirectory } from './ops-directory'

export function LeaveBalancePanel() {
  useRenderWatch('LeaveBalancePanel')
  const { profile } = useAuth()
  const { access, isPending: accessPending } = useBasicWorkAccess()
  const canManage = canEditOrgAssignment(profile) || access?.domains.includes('operations') === true
  const active = useWorkspaceTabActivity()
  const directory = useOpsDirectory()
  const [departmentId, setDepartmentId] = useState('all')
  const [search, setSearch] = useState('')
  // Share the roster query so changes in either management screen update both.
  const roster = useQuery({ queryKey: ['employee-roster'], queryFn: listEmployeeRosters,
    enabled: canManage, refetchInterval: canManage && active ? 30_000 : false })
  const rows = useMemo(() => {
    const balances = new Map(roster.data?.map(row => [row.profileId, row]))
    return directory.members.filter(member => (departmentId === 'all' || member.departmentId === departmentId)
      && memberLabel(member.displayName).includes(search.trim()))
      .sort((a, b) => memberLabel(a.displayName).localeCompare(memberLabel(b.displayName), 'ko'))
      .map(member => ({ member, balance: balances.get(member.id) }))
  }, [directory.members, roster.data, departmentId, search])
  const totals = useMemo(() => rows.reduce((sum, { balance }) => ({
    granted: sum.granted + (balance?.accruedAnnualLeave ?? 0),
    remaining: sum.remaining + (balance?.remainingAnnualLeave ?? 0),
    registered: sum.registered + (balance?.remainingAnnualLeave != null ? 1 : 0),
    missingGrant: sum.missingGrant || (balance !== undefined && balance.accruedAnnualLeave === undefined),
  }), { granted: 0, remaining: 0, registered: 0, missingGrant: false }), [rows])
  if (!canManage) return <OpsPanelFrame><p className="text-sm text-muted-foreground">{accessPending ? '연차 관리 권한을 확인하고 있습니다.' : '연차 현황은 직원 명부 관리 권한이 있는 담당자만 조회·수정할 수 있습니다.'}</p></OpsPanelFrame>
  const failed = Boolean(directory.error || roster.error)
  const loading = directory.loading || roster.isPending
  const ready = !failed && !loading
  return <OpsPanelFrame>
    <p className="text-sm text-muted-foreground">조직도 직원 배치와 같은 현재 연차 값입니다. 입사일 기준 연차 기간에 따라 발생일수가 자동 갱신됩니다. 남은 연차를 수정해 저장하면 조직도에도 반영됩니다.</p>
    <p className="text-xs text-muted-foreground">과거 사용일자는 가져오지 않아 사용일수는 별도로 표시하지 않습니다. 추가 연차는 아직 입력·계산에 연결되지 않았습니다.</p>
    <FilterBar>
      <Input aria-label="연차 직원 검색" placeholder="직원 이름 검색" value={search} onChange={event => setSearch(event.target.value)} className="sm:w-52"/>
      <Select aria-label="연차 부서" value={departmentId} onChange={event => setDepartmentId(event.target.value)} className="sm:w-44">
        <option value="all">전체 부서</option>
        {directory.departments.map(dept => <option key={dept.id} value={dept.id}>{dept.name}</option>)}
      </Select>
      <Button variant="outline" disabled={roster.isFetching} onClick={() => { directory.refetch(); void roster.refetch() }}>새로고침</Button>
    </FilterBar>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <OpsStat label="대상 직원" value={ready ? `${rows.length}명` : '—'} detail={ready ? `잔여 등록 ${totals.registered}명` : undefined}/>
      <OpsStat label="발생일수 합계" value={ready && !totals.missingGrant ? `${totals.granted}일` : '—'}/>
      <OpsStat label="남은 연차 합계" value={ready ? `${totals.remaining}일` : '—'} detail="등록된 값만 합산"/>
    </div>
    <Card className="overflow-hidden"><div className="overflow-x-auto">
      <table className="w-full min-w-[800px] text-left text-sm">
        <thead className="bg-primary text-primary-foreground"><tr>
          {['이름', '부서', '입사일', '발생일수', '추가 연차', '남은 연차'].map((label, index) => <th key={label} className={`whitespace-nowrap px-4 py-2.5 font-medium ${index === 0 ? 'sticky left-0 z-10 bg-primary' : ''}`}>{label}</th>)}
        </tr></thead>
        <tbody>
          {failed ? <tr><td colSpan={6} className="px-4 py-8 text-center text-danger" role="alert">연차 현황을 불러오지 못했습니다. 새로고침으로 다시 조회해 주세요.</td></tr>
            : loading ? <tr><td colSpan={6} className="px-4 py-8 text-center">불러오는 중…</td></tr>
            : rows.length === 0 ? <tr><td colSpan={6} className="px-4 py-8 text-center">표시할 직원이 없습니다.</td></tr>
            : rows.map(({ member, balance }) => <tr key={`${profile?.id}:${member.id}`} className="border-b border-border/70 last:border-0">
              <td className="sticky left-0 bg-card px-4 py-3 font-medium">{memberLabel(member.displayName)}</td>
              <td className="px-4 py-3">{directory.departmentName(member.departmentId)}</td>
              <td className="whitespace-nowrap px-4 py-3 tabular-nums">{member.hireDate || <MissingValue/>}</td>
              <td className="px-4 py-3 tabular-nums" aria-label={`${memberLabel(member.displayName)} 발생일수`}>{balance && balance.accruedAnnualLeave === undefined ? '조회 실패' : balance?.accruedAnnualLeave == null ? <MissingValue/> : `${balance.accruedAnnualLeave}일`}</td>
              <td className="px-4 py-3" aria-label={`${memberLabel(member.displayName)} 추가 연차`}>
                <AdditionalLeaveInputs name={memberLabel(member.displayName)}/>
              </td>
              <td className="px-4 py-2"><RemainingLeaveEditor profileId={member.id} name={memberLabel(member.displayName)} value={balance?.remainingAnnualLeave ?? null}/></td>
            </tr>)}
        </tbody>
      </table>
    </div></Card>
  </OpsPanelFrame>
}

function AdditionalLeaveInputs({ name }: { name: string }) {
  const [open, setOpen] = useState(false)
  return <div className="space-y-2">
    <div className="flex items-center gap-2 whitespace-nowrap">
      <span className="tabular-nums">0일</span>
      <Button type="button" variant="outline" size="sm" className="size-8 p-0" aria-label={`${name} 추가 연차 추가`} aria-expanded={open} onClick={() => setOpen(value => !value)}>+</Button>
    </div>
    {open ? <div className="space-y-2 rounded-xl border border-border bg-card p-3" role="group" aria-label={`${name} 추가 연차 입력`}>
      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1 text-xs"><span>추가 일수</span><Input aria-label={`${name} 추가 일수`} type="number" min="0.01" step="0.01" placeholder="예: 1.5" className="w-24"/></label>
        <label className="space-y-1 text-xs"><span>메모</span><Input aria-label={`${name} 추가 연차 메모`} placeholder="추가 사유" maxLength={500} className="w-48"/></label>
        <label className="space-y-1 text-xs"><span>사용 기한</span><Input aria-label={`${name} 추가 연차 사용 기한`} type="date" className="w-40"/></label>
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">입력 화면 미리보기 · 아직 저장되지 않습니다.</p>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>닫기</Button>
      </div>
    </div> : null}
  </div>
}

function MissingValue() {
  return <span className="rounded bg-warning/15 px-2 py-1 text-warning">미등록</span>
}

function RemainingLeaveEditor({ profileId, name, value }: { profileId: string; name: string; value: number | null }) {
  const client = useQueryClient()
  const [draft, setDraft] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const mutation = useMutation({
    mutationFn: (next: string) => saveEmployeeRosterField(profileId, 'remainingAnnualLeave', next),
    onSuccess: async () => {
      await Promise.all(['employee-roster', 'my-attendance-basis', 'leave-notice-management'].map(key => client.invalidateQueries({ queryKey: [key] })))
      setDraft(null)
      setSaved(true)
    },
    onError: error => console.warn('[leave-balance] 잔여 연차 저장 실패', { profileId, error }),
  })
  return <form onSubmit={event => { event.preventDefault(); if (draft !== null && !mutation.isPending) mutation.mutate(draft) }} className="space-y-1">
    <div className="flex items-center gap-2">
      <Input type="number" step="0.01" aria-label={`${name} 남은 연차 입력`} placeholder="미등록" value={draft ?? (value == null ? '' : String(value))}
        disabled={mutation.isPending} className={`h-9 w-24 text-right tabular-nums ${value === null && draft === null ? 'bg-warning/15' : ''}`}
        onChange={event => { setDraft(event.target.value); setSaved(false); mutation.reset() }}/>
      <span>일</span>
      <Button type="submit" size="sm" disabled={draft === null || mutation.isPending}>{mutation.isPending ? '저장 중…' : '저장'}</Button>
      {draft !== null ? <Button type="button" size="sm" variant="ghost" disabled={mutation.isPending} onClick={() => { setDraft(null); mutation.reset() }}>취소</Button> : null}
    </div>
    {mutation.error ? <p role="alert" className="text-xs text-danger">{mutation.error instanceof Error ? mutation.error.message : '저장하지 못했습니다. 다시 시도해 주세요.'}</p> : null}
    {saved ? <p role="status" className="text-xs text-success">저장되었습니다.</p> : null}
  </form>
}
