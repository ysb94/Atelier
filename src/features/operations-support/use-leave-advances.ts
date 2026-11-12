import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { useAuth } from '@/lib/supabase/auth'
import { useHeadOfficeSelfService } from '@/lib/company/workforce-management-context'
import { isOperationsDepartmentMember } from '@/lib/company/capabilities'
import { listLeaveAdvances } from '@/lib/supabase/leave-advances'
import { leaveQueryPolicy } from './leave-query-policy'

export function useLeaveAdvances(manage = false, enabled = true, { operationsReview = false } = {}) {
  const { session, profile } = useAuth()
  const selfService = useHeadOfficeSelfService()
  const active = useWorkspaceTabActivity()
  const userId = session?.user.id
  const reviewer = operationsReview && isOperationsDepartmentMember(profile)
  const query = useQuery({ queryKey: ['employee-leave-advances', userId, manage],
    queryFn: () => listLeaveAdvances(manage), ...leaveQueryPolicy,
    enabled: enabled && active && Boolean(userId) && profile?.id === userId && profile?.status === 'active' && (manage || selfService || reviewer) })
  useEffect(() => { if (query.error) console.warn('[leave-advance] 선사용 화면 조회 실패', query.error) }, [query.error])
  return query
}
