import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getMyAttendanceExemption } from '@/lib/supabase/attendance-exemptions'
import { useAuth } from '@/lib/supabase/auth'
import { isHeadOfficeMember } from '@/lib/company/workforce-management'
import { useWorkforceManagement } from '@/lib/company/workforce-management-context'
import { getSupabase } from '@/lib/supabase/client'
import { recordAccessIp } from '@/lib/supabase/access-ip'
import { emptyList } from '@/lib/utils'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { clockOutToday, listMyAttendanceClocks, undoClockOutToday } from '@/lib/supabase/attendance-clocks'
import { clockOutLabel, koreaDateKey, type AttendanceClock } from '@/features/settings/my-attendance'
import { offsiteAction } from '@/lib/supabase/offsite-attendance'
import { continuingOffsiteClock } from './attendance-guidance'
import { continuingOvertimeClock } from './overtime-clock'
import { listLeaveRequests } from '@/lib/supabase/leave-requests'
import { getMyWorkdayBasis } from '@/lib/supabase/attendance-entry'
import { sharedReadPolicy, readPollInterval } from '@/lib/query/shared-read-policy'
import { diagnosticOperation, newDiagnosticContext, type DiagnosticContext } from '@/lib/diagnostics/workflow-trace'

async function clockInToday(): Promise<string> {
  void recordAccessIp('clock_in_request')
  const { data, error } = await getSupabase().rpc('clock_in_today')
  if (error) { console.warn('[attendance-clock] 출근 기록 실패', error); throw new Error(error.message) }
  return String(data).slice(0, 5)
}

export function useMyClockIn() {
  const { profile, session } = useAuth()
  const userId = session?.user.id
  const workforce = useWorkforceManagement()
  const selfService = workforce ? workforce.selfService : isHeadOfficeMember(profile)
  const allowed = profile?.status === 'active' && Boolean(userId) && selfService
  const active = useWorkspaceTabActivity()
  const client = useQueryClient()
  const exemption = useQuery({ queryKey: ['my-attendance-exemption', userId], queryFn: () => getMyAttendanceExemption(userId!), ...sharedReadPolicy, enabled: allowed && active, refetchInterval: readPollInterval(30_000, allowed && active) })
  const exempt = !selfService || (exemption.data === true && !exemption.error)
  const query = useQuery({ queryKey: ['attendance-clock-ins', userId, allowed], queryFn: () => listMyAttendanceClocks(userId!), ...sharedReadPolicy, enabled: allowed && active, refetchInterval: readPollInterval(30_000, allowed && active) })
  useEffect(() => { if (query.error) console.warn('[attendance-clock] 출근 기록 불러오기 실패', query.error) }, [query.error])
  useEffect(() => { if (exemption.error) console.warn('[attendance-clock] 제외 설정 확인 실패', exemption.error) }, [exemption.error])
  const rows = allowed ? query.data ?? emptyList<AttendanceClock>() : emptyList<AttendanceClock>()
  const byDate = useMemo(() => Object.fromEntries(rows.map(row => [row.date, row.clockIn])), [rows])
  const today = koreaDateKey()
  const todayRecord = rows.find(row => row.date === today)
  const overnightEnabled = allowed && !exempt && !todayRecord && rows.some(row => row.date < today && !row.clockOutAt && !row.autoClosedAt)
  const overnight = useQuery({ queryKey: ['my-offsite-attendance', userId, today], queryFn: () => offsiteAction('my_offsite_attendance'), ...sharedReadPolicy, enabled: overnightEnabled && active, refetchInterval: readPollInterval(30_000, overnightEnabled && active) })
  useEffect(() => { if (overnightEnabled && overnight.error) console.warn('[attendance-clock] 전일 외근 상태 확인 실패', overnight.error) }, [overnightEnabled, overnight.error])
  const ongoingOffsiteRecord = overnightEnabled && !overnight.error ? continuingOffsiteClock(rows, today, overnight.data) : null
  const yesterday = koreaDateKey(new Date(Date.now() - 86_400_000))
  const overnightCandidate = allowed && !exempt && !todayRecord && rows.some(row => row.date === yesterday)
  const requests = useQuery({ queryKey: ['company-leave-requests', userId, 'mine', allowed], queryFn: () => listLeaveRequests(userId), ...sharedReadPolicy, enabled: overnightCandidate && active, refetchInterval: readPollInterval(30_000, overnightCandidate && active) })
  const hasOvertime = Boolean(requests.data?.some(row => row.kind === 'overtime' && ['pending', 'approved'].includes(row.status) && row.from === yesterday && row.to === yesterday))
  const basis = useQuery({ queryKey: ['my-workday-basis', userId, today], queryFn: () => getMyWorkdayBasis(today), ...sharedReadPolicy, enabled: overnightCandidate && hasOvertime && active })
  const ongoingOvertimeRecord = !basis.error && !requests.error ? continuingOvertimeClock(rows, requests.data ?? emptyList(), today, basis.data?.start) : null
  const workingRecord = todayRecord ?? ongoingOffsiteRecord ?? ongoingOvertimeRecord
  const save = useMutation({ mutationFn: clockInToday, onSuccess: () => client.invalidateQueries({ queryKey: ['attendance-clock-ins'] }) })
  const checkoutTrace = useRef<DiagnosticContext | undefined>(undefined), undoTrace = useRef<DiagnosticContext | undefined>(undefined)
  const refreshDeparture = (context?: DiagnosticContext) => diagnosticOperation('leave', 'checkout_refresh', trace => trace.run('invalidate_queries', () => Promise.all(['attendance-clock-ins', 'overtime-actuals', 'company-attendance-spans', 'my-home-work-notices'].map(key => client.invalidateQueries({ queryKey: [key] }))), { writeOutcome: 'committed' }), context)
  const departure = useMutation({ mutationFn: () => { checkoutTrace.current = newDiagnosticContext('leave','checkout_overtime','begin'); return clockOutToday(checkoutTrace.current) }, onSuccess: () => refreshDeparture(checkoutTrace.current) })
  const undoDeparture = useMutation({ mutationFn: () => { undoTrace.current = newDiagnosticContext('leave','undo_checkout','begin'); return undoClockOutToday(undoTrace.current) }, onSuccess: () => refreshDeparture(undoTrace.current) })
  const saving = save.isPending || departure.isPending || undoDeparture.isPending
  const error = save.error instanceof Error ? save.error.message : departure.error instanceof Error ? departure.error.message : undoDeparture.error instanceof Error ? undoDeparture.error.message : save.error || departure.error || undoDeparture.error ? '출퇴근을 기록하지 못했습니다.' : ''
  const recordIn = save.mutateAsync, recordOut = departure.mutateAsync, undoOut = undoDeparture.mutateAsync
  const reloadClocks = query.refetch, reloadExemption = exemption.refetch, reloadOvernight = overnight.refetch, reloadRequests = requests.refetch, reloadBasis = basis.refetch
  const refresh = useCallback(() => Promise.all([reloadClocks(), reloadExemption(), ...(overnightEnabled ? [reloadOvernight()] : []), ...(overnightCandidate ? [reloadRequests()] : []), ...(overnightCandidate && hasOvertime ? [reloadBasis()] : [])]), [reloadClocks, reloadExemption, overnightEnabled, reloadOvernight, overnightCandidate, hasOvertime, reloadRequests, reloadBasis])
  const loading = allowed && (query.isPending || exemption.isPending || (overnightEnabled && overnight.isPending) || (overnightCandidate && requests.isPending) || (overnightCandidate && hasOvertime && basis.isPending))
  const queryError = query.error || exemption.error || (overnightEnabled ? overnight.error : null) || (overnightCandidate && requests.error) || (overnightCandidate && hasOvertime && basis.error)
  return useMemo(() => ({
    rows,
    todayRecord,
    ongoingOffsiteRecord,
    ongoingOvertimeRecord,
    byDate,
    todayClock: workingRecord?.clockIn ?? '',
    todayClockOut: clockOutLabel(workingRecord?.clockOutAt ?? null, workingRecord?.date) || (workingRecord?.autoClosedAt ? '자동 퇴근 · 확인 필요' : ''),
    exempt,
    needsClockIn: allowed && !exempt && !loading && !queryError && !workingRecord,
    needsClockOut: allowed && !exempt && !loading && !queryError && Boolean(workingRecord?.clockIn) && !workingRecord?.clockOutAt && !workingRecord?.autoClosedAt,
    clockIn: () => recordIn(),
    clockOut: () => recordOut(),
    undoClockOut: () => undoOut(),
    saving,
    error,
    queryError,
    refresh,
    loading,
  }), [rows, todayRecord, ongoingOffsiteRecord, ongoingOvertimeRecord, workingRecord, byDate, exempt, allowed, loading, queryError, saving, error, recordIn, recordOut, undoOut, refresh])
}
