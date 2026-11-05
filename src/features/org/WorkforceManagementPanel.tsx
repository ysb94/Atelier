import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { FilterBar } from '@/components/ui/filter-bar'
import { StatGrid, StatTile } from '@/components/ui/stat-tile'
import { Badge } from '@/components/ui/badge'
import { useRenderWatch } from '@/lib/diagnostics'
import { startWorkflow } from '@/lib/diagnostics/workflow-trace'
import { useWorkforceManagement } from '@/lib/company/workforce-management-context'
import { workforceMode, type WorkforceMode } from '@/lib/company/workforce-management'
import { saveWorkforceManagement, type WorkforcePolicy } from '@/lib/supabase/workforce-management'
import type { OrgChartMember } from '@/lib/supabase/profiles'
import { koreaDateKey } from '@/features/settings/my-attendance'
import { attendanceTrackingStart } from '@/features/operations-support/attendance-period'

const LABELS: Record<WorkforceMode, string> = { 'head-office': '본사 관리', logistics: '물류 별도 관리', external: '외부 협력사' }
function PolicyRow({ member, policy, team, canEdit }: { member: OrgChartMember; policy: WorkforcePolicy; team: string; canEdit: boolean }) {
  const [mode, setMode] = useState(policy.mode)
  const [from, setFrom] = useState(policy.trackingStart ?? attendanceTrackingStart(member.hireDate))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const cache = useQueryClient()
  const changed = mode !== policy.mode || (mode === 'head-office' && from !== (policy.trackingStart ?? attendanceTrackingStart(member.hireDate)))
  async function save() {
    const trace = startWorkflow('app', 'workforce_policy_save')
    trace.step('validate_input')
    if (!canEdit || !changed || busy || (mode === 'head-office' && !from)) { trace.block('invalid_input'); return }
    trace.step('check_access')
    setBusy(true); setError(''); setNotice('')
    try {
      await trace.run('save_policy', context => saveWorkforceManagement({ employeeId: member.id, mode, trackingStart: mode === 'head-office' ? from : null, version: policy.version }, context))
      await trace.run('refresh_queries', () => Promise.all([
        cache.invalidateQueries({ queryKey: ['workforce-management'] }),
        cache.invalidateQueries({ queryKey: ['logistics-operations'] }),
      ]), { writeOutcome: 'committed' })
      setNotice('저장했습니다.'); trace.done({ writeOutcome: 'committed' })
    } catch (failure) { trace.fail(failure); setError(failure instanceof Error ? failure.message : '저장하지 못했습니다.') }
    finally { setBusy(false) }
  }
  return <tr className="border-t border-border align-top">
    <td className="px-4 py-3 font-medium">{member.displayName || '이름 미등록'}<small className="mt-1 block font-normal text-muted-foreground">{team}</small></td>
    <td className="px-4 py-3"><Badge variant="outline">{LABELS[policy.mode]}</Badge></td>
    <td className="px-4 py-3"><Select aria-label={`${member.displayName} 관리 방식`} value={mode} disabled={!canEdit || busy} onChange={event => {
      const next = event.target.value as WorkforceMode
      setMode(next); setNotice('')
      if (next === 'head-office' && policy.mode !== 'head-office') setFrom(koreaDateKey())
    }}>{Object.entries(LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></td>
    <td className="px-4 py-3">{mode === 'head-office' ? <Input aria-label={`${member.displayName} 본사 근태 시작일`} type="date" value={from} min={policy.mode === 'head-office' ? '2026-11-02' : koreaDateKey()} disabled={!canEdit || busy} onChange={event => setFrom(event.target.value)} /> : <span className="text-muted-foreground">본사 근태 미사용</span>}</td>
    <td className="px-4 py-3 text-xs text-muted-foreground">{mode === 'external' ? '본사 직원 명부·근태·연차에서 제외' : mode === 'logistics' ? '직원 명부 유지 · 물류 관리자가 기록' : '본사 출퇴근·연차 관리'}</td>
    <td className="px-4 py-3"><Button size="sm" disabled={!canEdit || !changed || busy} onClick={() => void save()}>{busy ? '저장 중…' : '저장'}</Button>{error && <p role="alert" className="mt-2 max-w-64 text-xs text-danger">{error}</p>}{notice && <p role="status" className="mt-2 text-xs text-muted-foreground">{notice}</p>}</td>
  </tr>
}

export function WorkforceManagementPanel({ members, departmentName, canEdit }: { members: OrgChartMember[]; departmentName: (id: string | null) => string; canEdit: boolean }) {
  useRenderWatch('WorkforceManagementPanel')
  const management = useWorkforceManagement()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const rows = useMemo(() => members.map(member => ({ member, policy: management?.byId.get(member.id) ?? { employeeId: member.id, mode: workforceMode(member), trackingStart: null, version: 0 } })), [members, management])
  const visible = rows.filter(({ member, policy }) => (filter === 'all' || policy.mode === filter) && (member.displayName ?? '').includes(search.trim()))
  return <div className="space-y-4">
    <Card className="space-y-2 p-5 text-sm"><h2 className="font-semibold">본사 관리 대상</h2><p className="text-muted-foreground">중국팀은 외부 협력사, 물류팀은 별도 관리가 기본입니다. 계정과 기존 업무 권한·기록은 유지합니다. 본사 관리로 전환할 때는 근태 시작일을 지정합니다.</p><p className="text-muted-foreground">물류 운영관리는 김보영 님만 조회·입력할 수 있습니다.</p></Card>
    {(management?.error || !management?.ready) && <div role="status" className="rounded-xl border border-warning/30 bg-warning/5 p-4 text-sm">{management?.loading ? '관리 대상 설정을 불러오는 중입니다.' : management?.error ? <>관리 대상 설정을 불러오지 못했습니다. <Button size="sm" variant="outline" onClick={() => void management.refresh()}>다시 불러오기</Button></> : '관리 대상 저장 설정 적용 대기입니다. 기본 부서 구분을 표시하며 저장은 아직 사용할 수 없습니다.'}</div>}
    <StatGrid>{Object.entries(LABELS).map(([key, label]) => <StatTile key={key} label={label} value={`${rows.filter(row => row.policy.mode === key).length}명`} />)}</StatGrid>
    <FilterBar><Input aria-label="관리 대상 직원 검색" placeholder="직원 이름 검색" value={search} onChange={event => setSearch(event.target.value)} className="sm:w-52" /><Select aria-label="관리 방식 필터" value={filter} onChange={event => setFilter(event.target.value)} className="sm:w-48"><option value="all">전체 관리 방식</option>{Object.entries(LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></FilterBar>
    <Card className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-sm"><thead className="bg-primary text-primary-foreground"><tr>{['직원 · 부서', '현재 관리', '변경할 관리 방식', '본사 근태 시작일', '적용 범위', '저장'].map(label => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody>{visible.map(({ member, policy }) => <PolicyRow key={`${member.id}:${policy.version}`} member={member} policy={policy} team={departmentName(member.departmentId)} canEdit={canEdit && management?.ready === true && !management.error} />)}{visible.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">표시할 직원이 없습니다.</td></tr>}</tbody></table></Card>
  </div>
}
