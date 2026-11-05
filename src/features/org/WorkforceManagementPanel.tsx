import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { FilterBar } from '@/components/ui/filter-bar'
import { StatGrid, StatTile } from '@/components/ui/stat-tile'
import { Badge } from '@/components/ui/badge'
import { useRenderWatch } from '@/lib/diagnostics'
import { startWorkflow } from '@/lib/diagnostics/workflow-trace'
import { useWorkforceManagement } from '@/lib/company/workforce-management-context'
import { workforceMode } from '@/lib/company/workforce-management'
import { listDepartmentWorkforceManagement, saveDepartmentWorkforceManagement, type DepartmentWorkforcePolicy } from '@/lib/supabase/workforce-management'
import type { Department, OrgChartMember } from '@/lib/supabase/profiles'
import { koreaDateKey } from '@/features/settings/my-attendance'
import { useAuth } from '@/lib/supabase/auth'
import { sharedReadPolicy } from '@/lib/query/shared-read-policy'
import { emptyList } from '@/lib/utils'

const LABELS = { 'head-office': '본사 관리', local: '현장 자체관리', external: '외부 협력사' } as const
function PolicyRow({ department, count, policy, canEdit }: { department: Department; count: number; policy: DepartmentWorkforcePolicy; canEdit: boolean }) {
  const [mode, setMode] = useState(policy.mode)
  const [from, setFrom] = useState(policy.trackingStart ?? '2026-11-02')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const cache = useQueryClient()
  const changed = mode !== policy.mode || (mode === 'head-office' && from !== (policy.trackingStart ?? '2026-11-02'))
  async function save() {
    const trace = startWorkflow('app', 'workforce_policy_save')
    trace.step('validate_input')
    if (!canEdit || !changed || busy || (mode === 'head-office' && !from)) { trace.block('invalid_input'); return }
    trace.step('check_access')
    setBusy(true); setError(''); setNotice('')
    try {
      await trace.run('save_policy', context => saveDepartmentWorkforceManagement({ departmentId: department.id, mode, trackingStart: mode === 'head-office' ? from : null, version: policy.version }, context))
      await trace.run('refresh_queries', () => Promise.all([
        cache.invalidateQueries({ queryKey: ['workforce-management'] }),
        cache.invalidateQueries({ queryKey: ['department-workforce-management'] }),
        cache.invalidateQueries({ queryKey: ['orgChartMembers'] }),
        cache.invalidateQueries({ queryKey: ['logistics-operations'] }),
      ]), { writeOutcome: 'committed' })
      setNotice('저장했습니다.'); trace.done({ writeOutcome: 'committed' })
    } catch (failure) { trace.fail(failure); setError(failure instanceof Error ? failure.message : '저장하지 못했습니다.') }
    finally { setBusy(false) }
  }
  return <tr className="border-t border-border align-top">
    <td className="px-4 py-3 font-medium">{department.name}<small className="mt-1 block font-normal text-muted-foreground">소속 직원 {count}명 · 신규·이동 직원 자동 적용</small></td>
    <td className="px-4 py-3"><Badge variant="outline">{LABELS[policy.mode]}</Badge></td>
    <td className="px-4 py-3"><Select aria-label={`${department.name} 관리 방식`} value={mode} disabled={!canEdit || busy} onChange={event => {
      const next = event.target.value as DepartmentWorkforcePolicy['mode']
      setMode(next); setNotice('')
      if (next === 'head-office' && policy.mode !== 'head-office') setFrom(koreaDateKey())
    }}>{Object.entries(LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></td>
    <td className="px-4 py-3">{mode === 'head-office' ? <Input aria-label={`${department.name} 본사 근태 시작일`} type="date" value={from} min={policy.mode === 'head-office' ? '2026-11-02' : koreaDateKey()} disabled={!canEdit || busy} onChange={event => setFrom(event.target.value)} /> : <span className="text-muted-foreground">본사 근태 미사용</span>}</td>
    <td className="px-4 py-3 text-xs text-muted-foreground">{mode === 'external' ? '본사 직원 명부·근태·연차에서 제외' : mode === 'local' ? '직원 명부 유지 · 해당 현장에서 관리' : '본사 출퇴근·연차 관리'}</td>
    <td className="px-4 py-3"><Button size="sm" disabled={!canEdit || !changed || busy} onClick={() => void save()}>{busy ? '저장 중…' : '저장'}</Button>{error && <p role="alert" className="mt-2 max-w-64 text-xs text-danger">{error}</p>}{notice && <p role="status" className="mt-2 text-xs text-muted-foreground">{notice}</p>}</td>
  </tr>
}

export function WorkforceManagementPanel({ members, departments, canEdit }: { members: OrgChartMember[]; departments: Department[]; canEdit: boolean }) {
  useRenderWatch('WorkforceManagementPanel')
  const management = useWorkforceManagement()
  const { profile, session } = useAuth()
  const userId = session?.user.id
  const query = useQuery({ queryKey: ['department-workforce-management', userId, profile?.companyId], queryFn: listDepartmentWorkforceManagement, ...sharedReadPolicy, enabled: Boolean(userId && profile?.id === userId && profile.status === 'active') })
  const policies = query.data?.items ?? emptyList<DepartmentWorkforcePolicy>()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const rows = useMemo(() => departments.map(department => {
    const fallback = workforceMode({ departmentId: department.id })
    return { department, count: members.filter(member => member.departmentId === department.id).length, policy: policies.find(item => item.departmentId === department.id) ?? { departmentId: department.id, mode: fallback === 'logistics' ? 'local' : fallback, trackingStart: null, version: 0 } }
  }), [departments, members, policies])
  const visible = rows.filter(({ department, policy }) => (filter === 'all' || policy.mode === filter) && department.name.includes(search.trim()))
  const error = query.error || management?.error
  const ready = query.data?.ready === true && management?.ready === true && !error
  const unassigned = members.filter(member => !departments.some(department => department.id === member.departmentId)).length
  return <div className="space-y-4">
    <Card className="space-y-2 p-5 text-sm"><h2 className="font-semibold">부서·팀 관리 구분</h2><p className="text-muted-foreground">부서·팀에 관리 방식을 지정하면 소속 직원 전체에 자동 적용됩니다. 신규 입사·부서 이동도 현재 소속의 설정을 따릅니다. 계정과 기존 업무 권한·기록은 유지합니다.</p><p className="text-muted-foreground">현장 자체관리는 본사 근태·연차를 사용하지 않으며 직원 명부는 유지합니다. 외부 협력사는 본사 직원 명부에서도 제외합니다. 물류 관리자의 담당 범위는 확대하지 않습니다.</p></Card>
    {(!ready || error) && <div role="status" className="rounded-xl border border-warning/30 bg-warning/5 p-4 text-sm">{query.isPending || management?.loading ? '부서 관리 설정을 불러오는 중입니다.' : error ? <>부서 관리 설정을 불러오지 못했습니다. <Button size="sm" variant="outline" onClick={() => { void query.refetch(); void management?.refresh() }}>다시 불러오기</Button></> : '부서별 저장 기능은 DB 적용 대기입니다. 기본 구분을 표시하며 아직 저장할 수 없습니다.'}</div>}
    <StatGrid>{Object.entries(LABELS).map(([key, label]) => <StatTile key={key} label={label} value={`${rows.filter(row => row.policy.mode === key).length}개 부서`} hint={`소속 직원 ${rows.filter(row => row.policy.mode === key).reduce((sum, row) => sum + row.count, 0)}명`} />)}</StatGrid>
    <FilterBar><Input aria-label="관리 대상 부서 검색" placeholder="부서·팀 검색" value={search} onChange={event => setSearch(event.target.value)} className="sm:w-52" /><Select aria-label="관리 방식 필터" value={filter} onChange={event => setFilter(event.target.value)} className="sm:w-48"><option value="all">전체 관리 방식</option>{Object.entries(LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></FilterBar>
    {unassigned > 0 && <p className="text-sm text-muted-foreground">소속 미지정·비활성 부서 직원 {unassigned}명은 기존 기본 구분을 유지합니다. 활성 부서 배치 후 해당 부서의 설정이 적용됩니다.</p>}
    <Card className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-sm"><thead className="bg-primary text-primary-foreground"><tr>{['부서·팀', '현재 관리', '변경할 관리 방식', '본사 근태 시작일', '적용 범위', '저장'].map(label => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody>{visible.map(({ department, count, policy }) => <PolicyRow key={`${userId}:${department.id}:${policy.version}`} department={department} count={count} policy={policy} canEdit={canEdit && ready} />)}{visible.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">표시할 부서가 없습니다.</td></tr>}</tbody></table></Card>
  </div>
}
