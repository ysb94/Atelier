import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { listCompanyMeetings } from '@/lib/supabase/meetings'
import { listLeaveRequests } from '@/lib/supabase/leave-requests'
import { useAuth } from '@/lib/supabase/auth'
import { emptyList } from '@/lib/utils'
import type { MeetingSeries } from '@/features/meetings/meeting-schedule'
import type { PersonalRequest } from '@/features/settings/personal-requests'
import { homeCalendarWindow, homeLeaveEvents, homeMeetingEvents, sortHomeCalendarEvents, type HomeCalendarEvent } from './home-calendar-events'

export function useHomeCalendarEvents(month: string) {
  const { profile, session } = useAuth()
  const userId = session?.user.id ?? ''
  const active = useWorkspaceTabActivity()
  const allowed = profile?.status === 'active' && Boolean(userId)
  const window = useMemo(() => homeCalendarWindow(month), [month])
  const meetings = useQuery({
    queryKey: ['home-my-meetings', userId, profile?.companyId],
    queryFn: listCompanyMeetings,
    enabled: allowed && active,
  })
  const leaves = useQuery({
    queryKey: ['home-my-leave', userId, window.from, window.to],
    queryFn: () => listLeaveRequests(userId, false, { from: window.from, to: window.to }),
    enabled: allowed && active,
  })
  useEffect(() => {
    if (meetings.error) console.warn('[home-calendar] 내 회의 조회 실패', meetings.error)
  }, [meetings.error])
  useEffect(() => {
    if (leaves.error) console.warn('[home-calendar] 내 신청 조회 실패', leaves.error)
  }, [leaves.error])
  const meetingRows = meetings.data ?? emptyList<MeetingSeries>()
  const leaveRows = leaves.data ?? emptyList<PersonalRequest>()
  const events = useMemo(
    () => sortHomeCalendarEvents([
      ...homeMeetingEvents(meetingRows, userId, window.from, window.to),
      ...homeLeaveEvents(leaveRows, window.from, window.to),
    ]),
    [meetingRows, leaveRows, userId, window.from, window.to],
  )
  return {
    events,
    loading: allowed && (meetings.isPending || leaves.isPending),
    error: Boolean(meetings.error || leaves.error),
  }
}

export type { HomeCalendarEvent }
