import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/supabase/auth'
import { isHeadOfficeMember } from '@/lib/company/workforce-management'
import { useWorkforceManagement } from '@/lib/company/workforce-management-context'
import { readImpersonationState } from '@/lib/supabase/impersonation'
import { confirmPreviousClockOut, getMyWorkdayBasis } from '@/lib/supabase/attendance-entry'
import { listLeaveRequests } from '@/lib/supabase/leave-requests'
import { emptyList } from '@/lib/utils'
import { koreaDateKey, type AttendanceClock } from '@/features/settings/my-attendance'
import { useMyClockIn } from './use-my-clock-in'
import { clockInHiddenForOperator, developerCanSkipClockIn } from './clock-in-prompt'
import { ATTENDANCE_GUIDANCE_START, clockInReminderFor, previousClock, previousMissingClock, workdayGuidance } from './attendance-guidance'
import { sharedReadPolicy, readPollInterval } from '@/lib/query/shared-read-policy'

const SKIP_KEY = 'atelier:clock-in-developer-skip'
const BROWSE_KEY = 'atelier:clock-in-browse'
function readEntrySession(key: string) {
  try { return sessionStorage.getItem(key) } catch { return null /* 저장소가 막히면 새로고침 후 선택을 기억하지 않는다. */ }
}

function useEntryState() {
  const { session, profile, signOut } = useAuth()
  const userId = session?.user.id
  const workforce = useWorkforceManagement()
  const allowed = Boolean(userId && profile?.status === 'active' && (workforce ? workforce.selfService : isHeadOfficeMember(profile)))
  const cache = useQueryClient()
  const clock = useMyClockIn()
  const [now, setNow] = useState(() => new Date())
  const today = koreaDateKey(now)
  const identity = `${userId}:${today}`
  const [skipped, setSkipped] = useState(() => readEntrySession(SKIP_KEY))
  const [browsingFor, setBrowsingFor] = useState(() => readEntrySession(BROWSE_KEY))
  const [resolved, setResolved] = useState('')
  const [checkoutFor, setCheckoutFor] = useState<string | null>(null)
  const stored = readImpersonationState()
  const developerSkip = developerCanSkipClockIn(userId, stored)
  const exempt = clock.exempt || clockInHiddenForOperator(userId, stored) || Boolean(developerSkip && stored?.targetId === skipped)
  const enabled = allowed && !exempt
  const canBrowse = enabled && profile?.id === userId && stored?.targetId !== userId
  const browsingToday = canBrowse && browsingFor === identity
  const canRemind = browsingToday && clock.needsClockIn
  const requestQuery = useQuery({ queryKey: ['company-leave-requests', userId, 'mine', allowed], queryFn: () => listLeaveRequests(userId), enabled,
    refetchInterval: enabled ? 30_000 : false })
  const requests = requestQuery.data ?? emptyList<Awaited<ReturnType<typeof listLeaveRequests>>[number]>()
  const previous = useMemo(() => previousClock(clock.rows, today), [clock.rows, today])
  const missing = useMemo(() => previousMissingClock(clock.rows, requests, today), [clock.rows, requests, today])
  const target = resolved === `${identity}:${missing?.date}` ? null : missing
  const todayBasisEnabled = enabled && (Boolean(clock.todayRecord) || canRemind)
  const todayBasis = useQuery({ queryKey: ['my-workday-basis', userId, today], queryFn: () => getMyWorkdayBasis(today),
    ...sharedReadPolicy, enabled: todayBasisEnabled, refetchInterval: readPollInterval(60_000, todayBasisEnabled) })
  const previousDate = previous?.date ?? today
  const previousBasis = useQuery({ queryKey: ['my-workday-basis', userId, previousDate], queryFn: () => getMyWorkdayBasis(previousDate),
    enabled: enabled && Boolean(clock.todayRecord) && Boolean(previous && !previous.clockOutAt && previous.date >= ATTENDANCE_GUIDANCE_START) })
  const schedule = useMemo(() => workdayGuidance(today, todayBasis.error || requestQuery.error ? null : todayBasis.data, requests), [today, todayBasis.data, todayBasis.error, requestQuery.error, requests])
  const clockInReminder = useMemo(() => canRemind && todayBasis.isSuccess && requestQuery.isSuccess
    ? clockInReminderFor(today, now, todayBasis.data, requests) : null,
  [canRemind, today, now, todayBasis.isSuccess, todayBasis.data, requestQuery.isSuccess, requests])
  const suggestion = useMemo(() => target && !previousBasis.error ? workdayGuidance(target.date, previousBasis.data, requests).end : null, [target, previousBasis.data, previousBasis.error, requests])
  const confirmation = useMutation({ mutationFn: (input: { workDate: string; value: string }) => confirmPreviousClockOut(input.workDate, input.value),
    onSuccess: data => {
      setResolved(`${identity}:${data.work_date}`)
      void cache.invalidateQueries({queryKey:['my-home-work-notices',userId]})
      if (data.clock_out_at) cache.setQueryData<AttendanceClock[]>(['attendance-clock-ins', userId, allowed], rows => rows?.map(row => row.date === data.work_date ? { ...row, clockOutAt: data.clock_out_at, clockOutReportedAt: data.clock_out_reported_at } : row))
      void cache.invalidateQueries({ queryKey: ['attendance-clock-ins', userId] })
      void cache.invalidateQueries({ queryKey: ['overtime-actuals', userId] })
      void cache.invalidateQueries({ queryKey: ['company-leave-requests', userId, 'mine'] })
    } })
  const refresh = useCallback(() => {
    void cache.invalidateQueries({ queryKey: ['my-attendance-exemption', userId] })
    void cache.invalidateQueries({ queryKey: ['attendance-clock-ins', userId] })
    void cache.invalidateQueries({ queryKey: ['company-leave-requests', userId, 'mine'] })
    void cache.invalidateQueries({ queryKey: ['my-workday-basis', userId] })
  }, [cache, userId])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    const visible = () => { if (document.visibilityState === 'visible') { setNow(new Date()); refresh() } }
    document.addEventListener('visibilitychange', visible)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', visible) }
  }, [refresh])
  useEffect(() => {
    if (requestQuery.error) console.warn('[attendance-entry] 본인 일정 조회 실패', { userId, error: requestQuery.error })
  }, [requestQuery.error, userId])
  let phase: 'ready' | 'loading' | 'error' | 'clock-in' | 'previous' = 'ready'
  if (enabled) {
    if (clock.loading) phase = browsingToday && !clock.todayRecord ? 'ready' : 'loading'
    else if (clock.queryError) phase = browsingToday && !clock.todayRecord ? 'ready' : 'error'
    else if (!clock.todayRecord && !clock.ongoingOffsiteRecord && !clock.ongoingOvertimeRecord) phase = browsingToday ? 'ready' : 'clock-in'
    else if (target && target.date !== clock.ongoingOffsiteRecord?.date && target.date !== clock.ongoingOvertimeRecord?.date) phase = requestQuery.isPending ? 'loading' : requestQuery.error ? 'error' : 'previous'
  }
  const browse = useCallback(() => {
    if (!canBrowse || !clock.needsClockIn || clock.saving) return
    try { sessionStorage.setItem(BROWSE_KEY, identity) } catch { /* 현재 화면에서는 둘러보기 상태를 유지한다. */ }
    setBrowsingFor(identity)
  }, [canBrowse, clock.needsClockIn, clock.saving, identity])
  const targetId = stored?.targetId
  const skip = useCallback(() => {
    if (!developerSkip || !targetId) return
    try { sessionStorage.setItem(SKIP_KEY, targetId) } catch { /* 저장 실패 시 이번 화면에서만 건너뛴다. */ }
    setSkipped(targetId)
  }, [developerSkip, targetId])
  const resetConfirmation = confirmation.reset
  useEffect(() => { resetConfirmation(); setResolved(''); setCheckoutFor(null) }, [identity, resetConfirmation])
  return useMemo(() => ({ userId, today, now, identity, clock, target, phase, signOut, refresh, developerSkip, skip, canBrowse, browse, clockInReminder,
    suggestion, basisLoading: previousBasis.isPending, basisError: previousBasis.error,
    retryBasis: previousBasis.refetch, confirmPrevious: confirmation.mutateAsync, confirming: confirmation.isPending,
    confirmationError: confirmation.error instanceof Error ? confirmation.error.message : '', confirmationResult: confirmation.data,
    checkoutOpen: checkoutFor === identity, requestCheckout: () => setCheckoutFor(identity), closeCheckout: () => setCheckoutFor(null),
    schedule, scheduleUnavailable: Boolean(todayBasis.error || requestQuery.error || todayBasis.isPending || requestQuery.isPending),
  }), [userId, today, now, identity, clock, target, phase, signOut, refresh, developerSkip, skip, canBrowse, browse, clockInReminder, suggestion, previousBasis.isPending, previousBasis.error, previousBasis.refetch, confirmation.mutateAsync, confirmation.isPending, confirmation.error, confirmation.data, checkoutFor, schedule, todayBasis.error, requestQuery.error, todayBasis.isPending, requestQuery.isPending])
}

const EntryContext = createContext<ReturnType<typeof useEntryState> | null>(null)
export function AttendanceEntryProvider({ children }: { children: ReactNode }) {
  const state = useEntryState()
  return <EntryContext.Provider value={state}>{children}</EntryContext.Provider>
}
export function useAttendanceEntry() { return useContext(EntryContext) }
