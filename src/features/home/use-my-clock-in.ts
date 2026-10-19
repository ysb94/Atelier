import { useEffect, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isAttendanceExempt } from '@/lib/company/capabilities'
import { useAuth } from '@/lib/supabase/auth'
import { getSupabase } from '@/lib/supabase/client'
import { emptyList } from '@/lib/utils'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { clockOutToday, listMyAttendanceClocks, undoClockOutToday } from '@/lib/supabase/attendance-clocks'
import { clockOutLabel, koreaDateKey, type AttendanceClock } from '@/features/settings/my-attendance'

async function clockInToday(): Promise<string> {
  const { data, error } = await getSupabase().rpc('clock_in_today')
  if (error) { console.warn('[attendance-clock] 출근 기록 실패', error); throw new Error(error.message) }
  return String(data).slice(0, 5)
}

export function useMyClockIn() {
  const { profile, session } = useAuth()
  const userId = session?.user.id
  const allowed = profile?.status === 'active' && Boolean(userId)
  const exempt = isAttendanceExempt(profile)
  const active = useWorkspaceTabActivity()
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['attendance-clock-ins', userId, allowed], queryFn: () => listMyAttendanceClocks(userId!), enabled: allowed, refetchInterval: allowed && active ? 30_000 : false })
  useEffect(() => { if (query.error) console.warn('[attendance-clock] 출근 기록 불러오기 실패', query.error) }, [query.error])
  const rows = allowed ? query.data ?? emptyList<AttendanceClock>() : emptyList<AttendanceClock>()
  const byDate = useMemo(() => Object.fromEntries(rows.map(row => [row.date, row.clockIn])), [rows])
  const today = koreaDateKey()
  const todayRecord = rows.find(row => row.date === today)
  const save = useMutation({ mutationFn: clockInToday, onSuccess: () => client.invalidateQueries({ queryKey: ['attendance-clock-ins'] }) })
  const departure = useMutation({ mutationFn: clockOutToday, onSuccess: () => client.invalidateQueries({ queryKey: ['attendance-clock-ins'] }) })
  const undoDeparture = useMutation({ mutationFn: undoClockOutToday, onSuccess: () => client.invalidateQueries({ queryKey: ['attendance-clock-ins'] }) })
  return {
    byDate,
    todayClock: byDate[today] ?? '',
    todayClockOut: clockOutLabel(todayRecord?.clockOutAt ?? null),
    exempt,
    needsClockIn: allowed && !exempt && !query.isPending && !query.error && !byDate[today],
    needsClockOut: allowed && !exempt && !query.isPending && !query.error && Boolean(todayRecord?.clockIn) && !todayRecord?.clockOutAt,
    clockIn: () => save.mutateAsync(),
    clockOut: () => departure.mutateAsync(),
    undoClockOut: () => undoDeparture.mutateAsync(),
    saving: save.isPending || departure.isPending || undoDeparture.isPending,
    error: save.error instanceof Error ? save.error.message : departure.error instanceof Error ? departure.error.message : undoDeparture.error instanceof Error ? undoDeparture.error.message : save.error || departure.error || undoDeparture.error ? '출퇴근을 기록하지 못했습니다.' : '',
    queryError: query.error,
    refresh: () => query.refetch(),
    loading: allowed && query.isPending,
  }
}
