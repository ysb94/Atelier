import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/supabase/auth'
import { listDepartmentAbsences } from '@/lib/supabase/department-schedule'
import { sharedReadPolicy, readPollInterval } from '@/lib/query/shared-read-policy'
import { emptyList } from '@/lib/utils'
import { DEPARTMENT_ABSENCE_LABELS, departmentAbsenceIndex, type DepartmentAbsence, type DepartmentDayAbsence } from './department-schedule'

export function useDepartmentSchedule(month: string, visible: boolean, active: boolean, search: string) {
  const { session, profile } = useAuth()
  const authorized = Boolean(session?.user.id && profile?.id === session.user.id && profile?.status === 'active' && profile?.companyId && profile?.departmentId)
  const enabled = authorized && visible && active
  const query = useQuery({
    queryKey: ['company-leave-requests', session?.user.id, 'department-schedule', profile?.companyId, profile?.departmentId, month],
    queryFn: () => listDepartmentAbsences(month), ...sharedReadPolicy, enabled,
    refetchInterval: state => state.state.data?.ready === false ? false : readPollInterval(30_000, enabled)(state),
  })
  const rows = authorized && visible && !query.isError && query.data?.ready ? query.data.rows : emptyList<DepartmentAbsence>()
  const entries = useMemo(() => departmentAbsenceIndex(rows, month, search), [rows, month, search])
  return { entries, authorized, department: profile?.departmentName || '같은 부서', loading: enabled && query.isPending,
    failed: enabled && query.isError, pending: enabled && query.data?.ready === false, fetching: query.isFetching, refresh: query.refetch }
}
type Schedule = ReturnType<typeof useDepartmentSchedule>

export function DepartmentScheduleToolbar({ schedule, visible, onChange }: { schedule: Schedule; visible: boolean; onChange: (value: boolean) => void }) {
  return <div className="border-b border-border px-3 py-2 text-xs">
    <div className="flex flex-wrap items-center gap-2">
      <label className="inline-flex cursor-pointer items-center gap-2"><input type="checkbox" checked={visible} disabled={!schedule.authorized} onChange={event => onChange(event.target.checked)} aria-label="같은 부서 일정 표시"/>같은 부서 일정</label>
      <span className="text-muted-foreground">{schedule.authorized ? schedule.department : '부서 배치 후 표시됩니다.'}</span>
      {visible && schedule.authorized && <Button type="button" size="sm" variant="ghost" disabled={schedule.fetching} onClick={() => void schedule.refresh()} aria-label="부서 일정 새로고침"><RefreshCw size={13}/>새로고침</Button>}
    </div>
    {visible && schedule.authorized && <p className="mt-1 text-muted-foreground">확정된 동료의 연차·반차·반반차·외근·공가만 표시합니다. 사유·장소·서류는 공유하지 않습니다.</p>}
    {schedule.loading && <p role="status" className="mt-1 text-muted-foreground">부서 일정을 불러오는 중입니다.</p>}
    {schedule.failed && <p role="alert" className="mt-1 text-danger">부서 일정 조회 실패 · 새로고침으로 다시 확인해 주세요.</p>}
    {schedule.pending && <p role="status" className="mt-1 text-warning">부서 일정 서버 연결 준비 중입니다.</p>}
  </div>
}

export function DepartmentScheduleBars({ items, onSelect }: { items: readonly DepartmentDayAbsence[]; onSelect: () => void }) {
  return <>{items.slice(0, 2).map(item => <button key={item.id} type="button" className="agenda-bar is-department" title={`${item.name} · ${DEPARTMENT_ABSENCE_LABELS[item.kind]} · ${item.time}`} onClick={event => { event.stopPropagation(); onSelect() }}>부서 · {item.name} · {DEPARTMENT_ABSENCE_LABELS[item.kind]}</button>)}
    {items.length > 2 && <button type="button" className="agenda-more" onClick={event => { event.stopPropagation(); onSelect() }}>부서 일정 +{items.length - 2}건</button>}</>
}

export function DepartmentScheduleList({ items, dateLabel, department }: { items: readonly DepartmentDayAbsence[]; dateLabel: string; department: string }) {
  if (!items.length) return null
  return <section aria-label="선택 날짜의 부서 일정" className="mt-3 space-y-2 rounded-xl border border-border bg-card p-4">
    <h3 className="text-sm font-semibold">{dateLabel} 부서 일정 · {department}</h3>
    {items.map(item => <div key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border p-3 text-sm"><strong>{item.name}</strong><span>{DEPARTMENT_ABSENCE_LABELS[item.kind]}</span><span className="tabular-nums text-muted-foreground">{item.time}</span></div>)}
  </section>
}
