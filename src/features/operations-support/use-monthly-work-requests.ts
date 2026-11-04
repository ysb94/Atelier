import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/lib/supabase/auth'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { listLeaveRequests, type LeaveRequest } from '@/lib/supabase/leave-requests'
import { canAccessOperationsSupport } from '@/lib/company/capabilities'
import { emptyList } from '@/lib/utils'
import { monthDates } from './monthly-attendance'

export function useMonthlyWorkRequests(month: string, enabled = true) {
  const { profile } = useAuth()
  const active = useWorkspaceTabActivity()
  const allowed = profile?.status === 'active' && canAccessOperationsSupport(profile)
  const valid = /^\d{4}-(0[1-9]|1[0-2])$/.test(month)
  const query = useQuery({ queryKey: ['company-leave-cover', profile?.id, month], enabled: enabled && allowed && valid,
    queryFn: () => { const dates = monthDates(month); return listLeaveRequests(undefined, false, { from: dates[0], to: dates[dates.length - 1] }) },
    refetchInterval: enabled && active && allowed && valid ? 30_000 : false })
  useEffect(() => { if (query.error) console.warn('[attendance-work] 근무 신청 조회 실패', { month, error: query.error }) }, [query.error, month])
  return { ...query, rows: allowed ? query.data ?? emptyList<LeaveRequest>() : emptyList<LeaveRequest>() }
}
