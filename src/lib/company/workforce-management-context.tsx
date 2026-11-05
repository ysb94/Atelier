import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/supabase/auth'
import { getSupabase } from '@/lib/supabase/client'
import { listWorkforceManagement, type WorkforcePolicy } from '@/lib/supabase/workforce-management'
import { emptyList } from '@/lib/utils'
import { sharedReadPolicy, readPollInterval } from '@/lib/query/shared-read-policy'
import { isHeadOfficeMember, workforceMode } from './workforce-management'
import { koreaDateKey } from '@/features/settings/my-attendance'

function useManagementState() {
  const [today, setToday] = useState(koreaDateKey)
  useEffect(() => { const timer = setInterval(() => setToday(koreaDateKey()), 60_000); return () => clearInterval(timer) }, [])
  const { profile, session } = useAuth()
  const userId = session?.user.id
  const companyId = profile?.companyId
  const enabled = Boolean(userId && profile?.id === userId && profile.status === 'active' && companyId)
  const cache = useQueryClient()
  const key = useMemo(() => ['workforce-management', userId, companyId], [userId, companyId])
  const query = useQuery({ queryKey: key, queryFn: listWorkforceManagement, ...sharedReadPolicy, enabled, refetchInterval: readPollInterval(30_000, enabled) })
  const policies = enabled ? query.data?.items ?? emptyList<WorkforcePolicy>() : emptyList<WorkforcePolicy>()
  const byId = useMemo(() => new Map(policies.map(item => [item.employeeId, item])), [policies])
  const decorate = useCallback(<T extends { id: string; departmentId?: string | null }>(member: T) => {
    const policy = byId.get(member.id)
    return policy ? { ...member, workforceMode: policy.mode, attendanceTrackedFrom: policy.trackingStart ?? undefined } : member
  }, [byId])
  const ownMode = profile ? byId.get(profile.id)?.mode ?? workforceMode(profile) : 'head-office'
  const startsOn = profile ? byId.get(profile.id)?.trackingStart : null
  // Wait for a successful scope read, including the explicit legacy-server fallback.
  // Otherwise an override or account switch could briefly expose HQ self-service.
  const selfService = enabled && query.isSuccess && !query.error && ownMode === 'head-office' && (!startsOn || startsOn <= today)
  useEffect(() => { if (query.error) console.warn('[workforce] 관리 대상 조회 실패', { code: 'query' }) }, [query.error])
  useEffect(() => {
    if (!enabled || !query.data?.ready) return
    const channel = getSupabase().channel(`workforce-policy:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workforce_management_overrides', filter: `company_id=eq.${companyId}` }, () => { void cache.invalidateQueries({ queryKey: key }) })
      .subscribe(status => { if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') console.warn('[workforce] 관리 대상 실시간 연결 실패', { code: status }) })
    return () => { void getSupabase().removeChannel(channel).catch(() => console.warn('[workforce] 관리 대상 구독 해제 실패', { code: 'unsubscribe' })) }
  }, [enabled, query.data?.ready, userId, companyId, cache, key])
  return useMemo(() => ({ today, policies, byId, decorate, ownMode, selfService, ready: query.data?.ready === true, loading: enabled && query.isPending, error: query.error, refresh: query.refetch }), [today, policies, byId, decorate, ownMode, selfService, query.data?.ready, enabled, query.isPending, query.error, query.refetch])
}
const WorkforceContext = createContext<ReturnType<typeof useManagementState> | null>(null)
export function WorkforceManagementProvider({ children }: { children: ReactNode }) {
  const value = useManagementState()
  return <WorkforceContext.Provider value={value}>{children}</WorkforceContext.Provider>
}
export function useWorkforceManagement() { return useContext(WorkforceContext) }
export function useHeadOfficeSelfService() {
  const { profile } = useAuth()
  const state = useWorkforceManagement()
  return state ? state.selfService : isHeadOfficeMember(profile)
}
