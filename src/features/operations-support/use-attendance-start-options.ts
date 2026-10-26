import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listAttendanceStartOptions } from '@/lib/supabase/attendance-start-options'
import { FALLBACK_START_OPTIONS } from './attendance-start-settings'

export function useAttendanceStartOptions() {
  const query = useQuery({ queryKey: ['attendance-start-options'], queryFn: listAttendanceStartOptions })
  useEffect(() => {
    if (query.error) console.warn('[attendance-start] 출근시간 목록 불러오기 실패', query.error)
  }, [query.error])
  return {
    options: query.data ?? FALLBACK_START_OPTIONS,
    loading: query.isPending,
    error: query.error,
    refresh: () => query.refetch(),
  }
}
