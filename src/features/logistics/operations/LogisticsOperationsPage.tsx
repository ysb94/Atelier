import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/PageHeader'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input, Select } from '@/components/ui/input'
import { FilterBar } from '@/components/ui/filter-bar'
import { StatGrid, StatTile } from '@/components/ui/stat-tile'
import { StatusPill } from '@/components/ui/status-pill'
import { canManageLogisticsOperations } from '@/lib/company/workforce-management'
import { useAuth } from '@/lib/supabase/auth'
import { getSupabase } from '@/lib/supabase/client'
import { getLogisticsOperations, saveLogisticsOperation, type LogisticsRecord, type LogisticsRecordInput } from '@/lib/supabase/logistics-operations'
import { sharedReadPolicy, readPollInterval } from '@/lib/query/shared-read-policy'
import { useRenderWatch } from '@/lib/diagnostics'
import { startWorkflow } from '@/lib/diagnostics/workflow-trace'
import { emptyList } from '@/lib/utils'
import { koreaDateKey } from '@/features/settings/my-attendance'
import { monthDates, shiftMonth } from '@/features/operations-support/monthly-attendance'
import { LogisticsRecordForm } from './LogisticsRecordForm'
import { LOGISTICS_LEAVE_LABELS, logisticsDuration, logisticsLocalTime, logisticsWorkMinutes } from './logistics-records'

export function LogisticsOperationsPage() {
  const { profile, session } = useAuth()
  if (!canManageLogisticsOperations(profile) || session?.user.id !== profile?.id) return <p role="status" className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">물류 운영관리 담당자 전용 화면입니다.</p>
  return <LogisticsOperationsWorkspace key={profile?.id} userId={profile!.id} />
}
function LogisticsOperationsWorkspace({ userId }: { userId: string }) {
  useRenderWatch('LogisticsOperationsWorkspace')
  const active = useWorkspaceTabActivity()
  const cache = useQueryClient()
  const [month, setMonth] = useState(koreaDateKey().slice(0, 7))
  const [employee, setEmployee] = useState('all')
  const [kind, setKind] = useState('all')
  const [includeCancelled, setIncludeCancelled] = useState(false)
  const [editing, setEditing] = useState<LogisticsRecord | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [cancelTarget, setCancelTarget] = useState<string | null>(null)
  const dates = useMemo(() => monthDates(month), [month])
  const query = useQuery({ queryKey: ['logistics-operations', userId, month], queryFn: () => getLogisticsOperations(dates[0], dates[dates.length - 1]), ...sharedReadPolicy, enabled: active, refetchInterval: readPollInterval(30_000, active) })
  const data = query.data
  const entries = data?.entries ?? emptyList<LogisticsRecord>()
  const employees = data?.employees ?? emptyList<{ id: string; name: string; hireDate: string | null }>()
  const currentIds = useMemo(() => new Set(employees.map(item => item.id)), [employees])
  const scoped = entries.filter(item => employee === 'all' || item.employee_id === employee)
  const live = scoped.filter(item => !item.cancelled_at)
  const rows = scoped.filter(item => (includeCancelled || !item.cancelled_at) && (kind === 'all' || item.kind === kind))
  useEffect(() => { if (query.error) console.warn('[logistics-operations] 기록 조회 실패', { code: 'query' }) }, [query.error])
  useEffect(() => {
    if (!active || !data?.ready) return
    const channel = getSupabase().channel(`logistics-operations:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'logistics_operation_records' }, () => { void cache.invalidateQueries({ queryKey: ['logistics-operations', userId] }) })
      .subscribe(status => { if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') console.warn('[logistics-operations] 실시간 연결 실패', { code: status }) })
    return () => { void getSupabase().removeChannel(channel).catch(() => console.warn('[logistics-operations] 구독 해제 실패', { code: 'unsubscribe' })) }
  }, [active, data?.ready, userId, cache])
  async function save(input: LogisticsRecordInput | { id: string; version: number; action: 'cancel' }) {
    if (busy || !data?.ready) return
    const trace = startWorkflow('app', 'logistics_record_save')
    trace.step('validate_input'); trace.step('check_access'); setBusy(true); setError(''); setNotice('')
    try {
      await trace.run('save_record', context => saveLogisticsOperation(input, context))
      await trace.run('refresh_queries', () => cache.invalidateQueries({ queryKey: ['logistics-operations', userId] }), { writeOutcome: 'committed' })
      setEditing(undefined); setCancelTarget(null); setNotice(input.action === 'cancel' ? '기록을 취소했습니다. 변경 이력은 보관됩니다.' : '물류 기록을 저장했습니다.'); trace.done({ writeOutcome: 'committed' })
    } catch (failure) { trace.fail(failure); setError(failure instanceof Error ? failure.message : '기록을 저장하지 못했습니다.') }
    finally { setBusy(false) }
  }
  const unavailable = query.isPending || query.isError || !data?.ready
  return <div className="space-y-5">
    <PageHeader title="물류 운영관리" description="물류 관리자가 근무·휴가 현황을 직접 기록합니다. 자동 지각·결근 판정을 하지 않으며 본사 근태·연차 원장과 별도로 보관합니다." />
    <FilterBar>
      <Button variant="outline" aria-label="물류 이전 월" disabled={busy} onClick={() => setMonth(shiftMonth(month, -1))}>이전 월</Button>
      <Input type="month" aria-label="물류 운영관리 월" value={month} className="sm:w-44" disabled={busy} onChange={event => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)) setMonth(event.target.value) }} />
      <Button variant="outline" aria-label="물류 다음 월" disabled={busy} onClick={() => setMonth(shiftMonth(month, 1))}>다음 월</Button>
      <Select aria-label="물류 직원 필터" className="sm:w-44" value={employee} onChange={event => setEmployee(event.target.value)}><option value="all">전체 물류 직원</option>{employees.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>
      <Select aria-label="물류 기록 필터" className="sm:w-36" value={kind} onChange={event => setKind(event.target.value)}><option value="all">근무·휴가 전체</option><option value="work">근무</option><option value="leave">휴가</option></Select>
      <Button className="sm:ml-auto" disabled={unavailable || busy || employees.length === 0} onClick={() => { setEditing(null); setError(''); setNotice('') }}>근무·휴가 등록</Button>
    </FilterBar>
    <StatGrid><StatTile label="물류 관리 대상" value={unavailable ? '—' : `${employees.length}명`} /><StatTile label="근무 기록" value={unavailable ? '—' : `${live.filter(item => item.kind === 'work').length}건`} /><StatTile label="입력된 근무시간" value={unavailable ? '—' : logisticsDuration(live.filter(item => item.kind === 'work').reduce((sum, item) => sum + logisticsWorkMinutes(item), 0))} hint="입력한 휴게시간 제외" /><StatTile label="휴가 사용" value={unavailable ? '—' : `${live.filter(item => item.kind === 'leave').reduce((sum, item) => sum + Number(item.leave_days), 0)}일`} /></StatGrid>
    <p className="text-xs text-muted-foreground">선택한 월의 시작일 기준으로 표시합니다. 휴가 일수는 관리자가 입력한 사용 내역이며, 본사 연차 잔액을 차감하지 않습니다.</p>
    {query.error && <p role="alert" className="text-sm text-danger">{query.error.message}<Button variant="outline" size="sm" onClick={() => void query.refetch()}>다시 불러오기</Button></p>}
    {!query.isPending && !query.error && !data?.ready && <Card className="border-warning/30 bg-warning/5 p-5 text-sm">물류 기록 저장 설정 적용 대기입니다. 기존 직원·출퇴근·휴가 데이터는 그대로 유지됩니다.</Card>}
    {editing !== undefined && <LogisticsRecordForm key={editing?.id ?? 'new'} employees={employees} record={editing} date={month === koreaDateKey().slice(0, 7) ? koreaDateKey() : `${month}-01`} busy={busy} error={error} onSave={input => void save(input)} onClose={() => { setEditing(undefined); setError('') }} />}
    {editing === undefined && error && <p role="alert" className="text-sm text-danger">{error}</p>}{notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
    <div className="flex justify-end"><Button size="sm" variant="outline" aria-pressed={includeCancelled} onClick={() => setIncludeCancelled(value => !value)}>{includeCancelled ? '현재 기록만 보기' : '취소 기록도 보기'}</Button></div>
    <Card className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-sm"><thead className="bg-primary text-primary-foreground"><tr>{['기간 · 한국 시간', '직원', '구분', '근무시간 · 휴가 일수', '메모', '관리'].map(label => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody>
      {rows.map(item => <tr key={item.id} className="border-t border-border align-top"><td className="px-4 py-3">{item.kind === 'work' ? <>{logisticsLocalTime(item.started_at).replace('T', ' ')}<br />~ {logisticsLocalTime(item.ended_at).replace('T', ' ')}</> : `${item.from_date} ~ ${item.to_date}`}</td><td className="px-4 py-3 font-medium">{item.employee_name}</td><td className="px-4 py-3"><StatusPill tone={item.cancelled_at ? 'muted' : 'outline'}>{item.cancelled_at ? '취소' : item.kind === 'work' ? '근무' : LOGISTICS_LEAVE_LABELS[item.leave_kind!]}</StatusPill></td><td className="px-4 py-3">{item.kind === 'work' ? <>{logisticsDuration(logisticsWorkMinutes(item))}<small className="block text-muted-foreground">휴게 {item.break_minutes}분</small></> : `${item.leave_days}일`}</td><td className="max-w-72 whitespace-pre-wrap break-words px-4 py-3">{item.note || '—'}</td><td className="px-4 py-3">{!item.cancelled_at && <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy || unavailable || !currentIds.has(item.employee_id)} onClick={() => { setEditing(item); setError(''); setNotice('') }}>수정</Button>{cancelTarget === item.id ? <><Button size="sm" variant="danger" disabled={busy || unavailable} onClick={() => void save({ id: item.id, version: item.version, action: 'cancel' })}>취소 확정</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => setCancelTarget(null)}>유지</Button></> : <Button size="sm" variant="outline" disabled={busy || unavailable} onClick={() => setCancelTarget(item.id)}>등록 취소</Button>}</div>}</td></tr>)}
      {rows.length === 0 && <tr><td colSpan={6} className="p-10 text-center text-muted-foreground">{query.isPending ? '물류 기록을 불러오는 중…' : query.error ? '기록을 불러오지 못했습니다.' : !data?.ready ? '저장 설정 적용 후 기록할 수 있습니다.' : '등록된 근무·휴가 기록이 없습니다.'}</td></tr>}
    </tbody></table></Card>
  </div>
}
