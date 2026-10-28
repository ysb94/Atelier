import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/supabase/auth'
import { readImpersonationState } from '@/lib/supabase/impersonation'
import { confirmPreviousClockOut, getMyWorkdayBasis } from '@/lib/supabase/attendance-entry'
import { listLeaveRequests } from '@/lib/supabase/leave-requests'
import { emptyList } from '@/lib/utils'
import { koreaDateKey, type AttendanceClock } from '@/features/settings/my-attendance'
import { useMyClockIn } from './use-my-clock-in'
import { clockInHiddenForOperator, developerCanSkipClockIn } from './clock-in-prompt'
import { ATTENDANCE_GUIDANCE_START, previousClock, previousMissingClock, workdayGuidance } from './attendance-guidance'

const SKIP_KEY = 'atelier:clock-in-developer-skip'
function skippedTarget() {
  try { return sessionStorage.getItem(SKIP_KEY) } catch { return null /* 저장소 접근이 막히면 개발자 건너뛰기를 기억하지 않는다. */ }
}

function useEntryState() {
  const { session, profile, signOut } = useAuth()
  const userId = session?.user.id
  const allowed = Boolean(userId && profile?.status === 'active')
  const cache = useQueryClient()
  const clock = useMyClockIn()
  const [now, setNow] = useState(() => new Date())
  const today = koreaDateKey(now)
  const identity = `${userId}:${today}`
  const [skipped, setSkipped] = useState<string | null>(skippedTarget)
  const [resolved, setResolved] = useState('')
  const [checkoutFor, setCheckoutFor] = useState<string | null>(null)
  const stored = readImpersonationState()
  const developerSkip = developerCanSkipClockIn(userId, stored)
  const exempt = clock.exempt || clockInHiddenForOperator(userId, stored) || Boolean(developerSkip && stored?.targetId === skipped)
  const enabled = allowed && !exempt
  const requestQuery = useQuery({ queryKey: ['company-leave-requests', userId, 'mine', allowed], queryFn: () => listLeaveRequests(userId), enabled,
    refetchInterval: enabled ? 30_000 : false })
  const requests = requestQuery.data ?? emptyList<Awaited<ReturnType<typeof listLeaveRequests>>[number]>()
  const previous = useMemo(() => previousClock(clock.rows, today), [clock.rows, today])
  const missing = useMemo(() => previousMissingClock(clock.rows, requests, today), [clock.rows, requests, today])
  const target = resolved === `${identity}:${missing?.date}` ? null : missing
  const todayBasis = useQuery({ queryKey: ['my-workday-basis', userId, today], queryFn: () => getMyWorkdayBasis(today), enabled: enabled && Boolean(clock.todayRecord), refetchInterval: enabled ? 60_000 : false })
  const previousDate = previous?.date ?? today
  const previousBasis = useQuery({ queryKey: ['my-workday-basis', userId, previousDate], queryFn: () => getMyWorkdayBasis(previousDate),
    enabled: enabled && Boolean(clock.todayRecord) && Boolean(previous && !previous.clockOutAt && previous.date >= ATTENDANCE_GUIDANCE_START) })
  const schedule = useMemo(() => workdayGuidance(today, todayBasis.error || requestQuery.error ? null : todayBasis.data, requests), [today, todayBasis.data, todayBasis.error, requestQuery.error, requests])
  const suggestion = useMemo(() => target && !previousBasis.error ? workdayGuidance(target.date, previousBasis.data, requests).end : null, [target, previousBasis.data, previousBasis.error, requests])
  const confirmation = useMutation({ mutationFn: (input: { workDate: string; value: string }) => confirmPreviousClockOut(input.workDate, input.value),
    onSuccess: data => {
      setResolved(`${identity}:${data.work_date}`)
      if (data.clock_out_at) cache.setQueryData<AttendanceClock[]>(['attendance-clock-ins', userId, allowed], rows => rows?.map(row => row.date === data.work_date ? { ...row, clockOutAt: data.clock_out_at, clockOutReportedAt: data.clock_out_reported_at } : row))
      void cache.invalidateQueries({ queryKey: ['attendance-clock-ins', userId] })
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
    if (clock.loading) phase = 'loading'
    else if (clock.queryError) phase = 'error'
    else if (!clock.todayRecord) phase = 'clock-in'
    else if (target) phase = requestQuery.isPending ? 'loading' : requestQuery.error ? 'error' : 'previous'
  }
  const targetId = stored?.targetId
  const skip = useCallback(() => {
    if (!developerSkip || !targetId) return
    try { sessionStorage.setItem(SKIP_KEY, targetId) } catch { /* 저장 실패 시 이번 화면에서만 건너뛴다. */ }
    setSkipped(targetId)
  }, [developerSkip, targetId])
  const resetConfirmation = confirmation.reset
  useEffect(() => { resetConfirmation(); setResolved(''); setCheckoutFor(null) }, [identity, resetConfirmation])
  return useMemo(() => ({ userId, today, now, identity, clock, target, phase, signOut, refresh, developerSkip, skip,
    suggestion, basisLoading: previousBasis.isPending, basisError: previousBasis.error,
    retryBasis: previousBasis.refetch, confirmPrevious: confirmation.mutateAsync, confirming: confirmation.isPending,
    confirmationError: confirmation.error instanceof Error ? confirmation.error.message : '', confirmationResult: confirmation.data,
    checkoutOpen: checkoutFor === identity, requestCheckout: () => setCheckoutFor(identity), closeCheckout: () => setCheckoutFor(null),
    schedule, scheduleUnavailable: Boolean(todayBasis.error || requestQuery.error || todayBasis.isPending || requestQuery.isPending),
  }), [userId, today, now, identity, clock, target, phase, signOut, refresh, developerSkip, skip, suggestion, previousBasis.isPending, previousBasis.error, previousBasis.refetch, confirmation.mutateAsync, confirmation.isPending, confirmation.error, confirmation.data, checkoutFor, schedule, todayBasis.error, requestQuery.error, todayBasis.isPending, requestQuery.isPending])
}

const EntryContext = createContext<ReturnType<typeof useEntryState> | null>(null)
export function AttendanceEntryProvider({ children }: { children: ReactNode }) {
  const state = useEntryState()
  return <EntryContext.Provider value={state}>{children}</EntryContext.Provider>
}
export function useAttendanceEntry() { return useContext(EntryContext) }
