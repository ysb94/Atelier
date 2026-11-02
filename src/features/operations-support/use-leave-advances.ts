import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { useAuth } from '@/lib/supabase/auth'
import { listLeaveAdvances } from '@/lib/supabase/leave-advances'

export function useLeaveAdvances(manage = false, enabled = true) {
  const { session, profile } = useAuth()
  const active = useWorkspaceTabActivity()
  const query = useQuery({ queryKey: ['employee-leave-advances', session?.user.id, manage],
    queryFn: () => listLeaveAdvances(manage), enabled: enabled && Boolean(session?.user.id) && profile?.status === 'active',
    refetchInterval: enabled && active ? 30_000 : false })
  useEffect(() => { if (query.error) console.warn('[leave-advance] 선사용 화면 조회 실패', query.error) }, [query.error])
  return query
}
