import { useEffect, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/supabase/auth'
import { getSupabase } from '@/lib/supabase/client'
import { emptyList } from '@/lib/utils'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tabs'
import { toDateKey } from './home-events'

type ClockRow = { work_date: string; clock_in: string }
export type ClockIn = { date: string; clockIn: string }

async function listMyClockIns(): Promise<ClockIn[]> {
  const { data, error } = await getSupabase().from('attendance_clock_ins').select('work_date,clock_in').order('work_date', { ascending: false }).limit(400)
  if (error) { console.warn('[attendance-clock] 출근 기록 조회 실패', error); throw new Error(error.message) }
  return ((data ?? []) as ClockRow[]).map(row => ({ date: row.work_date, clockIn: row.clock_in.slice(0, 5) }))
}
async function clockInToday(): Promise<string> {
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
  const query = useQuery({ queryKey: ['attendance-clock-ins', userId, allowed], queryFn: listMyClockIns, enabled: allowed, refetchInterval: allowed && active ? 30_000 : false })
  useEffect(() => { if (query.error) console.warn('[attendance-clock] 출근 기록 불러오기 실패', query.error) }, [query.error])
  const rows = allowed ? query.data ?? emptyList<ClockIn>() : emptyList<ClockIn>()
  const byDate = useMemo(() => Object.fromEntries(rows.map(row => [row.date, row.clockIn])), [rows])
  const today = toDateKey(new Date())
  const save = useMutation({ mutationFn: clockInToday, onSuccess: () => client.invalidateQueries({ queryKey: ['attendance-clock-ins'] }) })
  return {
    byDate,
    todayClock: byDate[today] ?? '',
    needsClockIn: allowed && !query.isPending && !query.error && !byDate[today],
    clockIn: () => save.mutateAsync(),
    saving: save.isPending,
    error: save.error instanceof Error ? save.error.message : save.error ? '출근을 기록하지 못했습니다.' : '',
    loading: allowed && query.isPending,
  }
}
