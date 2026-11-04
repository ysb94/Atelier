import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listCompanyMeetings } from '@/lib/supabase/meetings'
import { emptyList } from '@/lib/utils'
import type { MeetingSeries } from '@/features/meetings/meeting-schedule'
import { myScheduleMeetings } from './my-schedule-meetings'
import { sharedReadPolicy, readPollInterval } from '@/lib/query/shared-read-policy'

/** 회의 화면·실시간 알림과 같은 캐시를 써서 등록·응답·일정 변경을 함께 반영한다. */
export function useMyScheduleMeetings(userId: string | undefined, companyId: string | undefined, enabled: boolean, active: boolean, month: string) {
  const query = useQuery({
    queryKey: ['company-meetings', userId, companyId], queryFn: listCompanyMeetings,
    ...sharedReadPolicy,
    enabled: enabled && active && Boolean(userId && companyId),
    refetchInterval: readPollInterval(15_000, enabled && active),
  })
  useEffect(() => {
    if (query.error) console.warn('[my-schedule] 내 회의 일정 조회 실패', { month, error: query.error })
  }, [month, query.error])
  const series = enabled ? query.data ?? emptyList<MeetingSeries>() : emptyList<MeetingSeries>()
  const events = useMemo(() => myScheduleMeetings(series, enabled ? userId ?? '' : '', month), [series, enabled, userId, month])
  return { events, error: query.error, loading: enabled && query.isPending, refresh: query.refetch }
}
