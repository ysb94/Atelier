import { useQuery, type QueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/supabase/auth'
import { usePagePreview } from '@/lib/company/page-preview-context'
import { readImpersonationState } from '@/lib/supabase/impersonation'
import { listOffsiteGroups } from '@/lib/supabase/offsite-groups'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { sharedReadPolicy, readPollInterval } from '@/lib/query/shared-read-policy'
export async function refreshOffsiteQueries(cache: QueryClient) {
  await Promise.all(['offsite-groups','company-leave-requests','my-offsite-attendance','my-workday-basis','my-attendance-basis','home-my-leave','attendance-clock-ins','attendance-presence','company-attendance-clocks','company-attendance-spans','late-arrival-cumulative','late-arrival-statements','my-home-work-notices'].map(key => cache.invalidateQueries({ queryKey: [key] })))
}
export function useOffsiteGroups() {
  const { session, profile } = useAuth()
  const preview = usePagePreview()
  const active = useWorkspaceTabActivity()
  const enabled = Boolean(session?.user.id === profile?.id && profile?.status === 'active' && !preview?.active && !readImpersonationState())
  return useQuery({ queryKey: ['offsite-groups', session?.user.id], queryFn: listOffsiteGroups, ...sharedReadPolicy, enabled: enabled && active, refetchInterval: readPollInterval(30_000, enabled && active) })
}
