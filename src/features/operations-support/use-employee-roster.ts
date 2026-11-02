import { useQuery } from '@tanstack/react-query'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { useAuth } from '@/lib/supabase/auth'
import { getEmployeeRosterSnapshot } from '@/lib/supabase/employee-roster'
import { leaveQueryPolicy } from './leave-query-policy'

// Org chart and leave management share one request/cache, including extra leave.
export function useEmployeeRoster(enabled: boolean) {
  const { profile } = useAuth()
  const active = useWorkspaceTabActivity()
  return useQuery({
    queryKey: ['employee-roster', profile?.id],
    queryFn: getEmployeeRosterSnapshot,
    ...leaveQueryPolicy,
    enabled: enabled && active && Boolean(profile?.id) && profile?.status === 'active',
  })
}
