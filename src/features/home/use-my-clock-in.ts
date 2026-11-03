import { useCallback, useEffect, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getMyAttendanceExemption } from '@/lib/supabase/attendance-exemptions'
import { useAuth } from '@/lib/supabase/auth'
import { getSupabase } from '@/lib/supabase/client'
import { recordAccessIp } from '@/lib/supabase/access-ip'
import { emptyList } from '@/lib/utils'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { clockOutToday, listMyAttendanceClocks, undoClockOutToday } from '@/lib/supabase/attendance-clocks'
import { clockOutLabel, koreaDateKey, type AttendanceClock } from '@/features/settings/my-attendance'
import { offsiteAction } from '@/lib/supabase/offsite-attendance'
import { continuingOffsiteClock } from './attendance-guidance'

async function clockInToday(): Promise<string> {
  void recordAccessIp('clock_in_request')
  const { data, error } = await getSupabase().rpc('clock_in_today')
  if (error) { console.warn('[attendance-clock] 출근 기록 실패', error); throw new Error(error.message) }
  return String(data).slice(0, 5)
}

export function useMyClockIn() {
  const { profile, session } = useAuth()
  const userId = session?.user.id
  const allowed = profile?.status === 'active' && Boolean(userId)
  const active = useWorkspaceTabActivity()
  const client = useQueryClient()
  const exemption = useQuery({ queryKey: ['my-attendance-exemption', userId], queryFn: () => getMyAttendanceExemption(userId!), enabled: allowed, refetchInterval: allowed && active ? 30_000 : false })
  const exempt = exemption.data === true && !exemption.error
  const query = useQuery({ queryKey: ['attendance-clock-ins', userId, allowed], queryFn: () => listMyAttendanceClocks(userId!), enabled: allowed, refetchInterval: allowed && active ? 30_000 : false })
  useEffect(() => { if (query.error) console.warn('[attendance-clock] 출근 기록 불러오기 실패', query.error) }, [query.error])
  useEffect(() => { if (exemption.error) console.warn('[attendance-clock] 제외 설정 확인 실패', exemption.error) }, [exemption.error])
  const rows = allowed ? query.data ?? emptyList<AttendanceClock>() : emptyList<AttendanceClock>()
  const byDate = useMemo(() => Object.fromEntries(rows.map(row => [row.date, row.clockIn])), [rows])
  const today = koreaDateKey()
  const todayRecord = rows.find(row => row.date === today)
  const overnightEnabled = allowed && !exempt && !todayRecord && rows.some(row => row.date < today && !row.clockOutAt && !row.autoClosedAt)
  const overnight = useQuery({ queryKey: ['my-offsite-attendance', userId, today], queryFn: () => offsiteAction('my_offsite_attendance'), enabled: overnightEnabled, refetchInterval: overnightEnabled && active ? 30_000 : false, retry: false })
  useEffect(() => { if (overnightEnabled && overnight.error) console.warn('[attendance-clock] 전일 외근 상태 확인 실패', overnight.error) }, [overnightEnabled, overnight.error])
  const ongoingOffsiteRecord = overnightEnabled && !overnight.error ? continuingOffsiteClock(rows, today, overnight.data) : null
  const workingRecord = todayRecord ?? ongoingOffsiteRecord
  const save = useMutation({ mutationFn: clockInToday, onSuccess: () => client.invalidateQueries({ queryKey: ['attendance-clock-ins'] }) })
  const departure = useMutation({ mutationFn: clockOutToday, onSuccess: () => client.invalidateQueries({ queryKey: ['attendance-clock-ins'] }) })
  const undoDeparture = useMutation({ mutationFn: undoClockOutToday, onSuccess: () => client.invalidateQueries({ queryKey: ['attendance-clock-ins'] }) })
  const saving = save.isPending || departure.isPending || undoDeparture.isPending
  const error = save.error instanceof Error ? save.error.message : departure.error instanceof Error ? departure.error.message : undoDeparture.error instanceof Error ? undoDeparture.error.message : save.error || departure.error || undoDeparture.error ? '출퇴근을 기록하지 못했습니다.' : ''
  const recordIn = save.mutateAsync, recordOut = departure.mutateAsync, undoOut = undoDeparture.mutateAsync
  const reloadClocks = query.refetch, reloadExemption = exemption.refetch, reloadOvernight = overnight.refetch
  const refresh = useCallback(() => Promise.all([reloadClocks(), reloadExemption(), ...(overnightEnabled ? [reloadOvernight()] : [])]), [reloadClocks, reloadExemption, overnightEnabled, reloadOvernight])
  const loading = allowed && (query.isPending || exemption.isPending || (overnightEnabled && overnight.isPending))
  const queryError = query.error || exemption.error || (overnightEnabled ? overnight.error : null)
  return useMemo(() => ({
    rows,
    todayRecord,
    ongoingOffsiteRecord,
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
  }), [rows, todayRecord, ongoingOffsiteRecord, workingRecord, byDate, exempt, allowed, loading, queryError, saving, error, recordIn, recordOut, undoOut, refresh])
}
