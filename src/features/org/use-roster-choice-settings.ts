import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/lib/supabase/auth'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { listRosterChoiceSettings } from '@/lib/supabase/roster-choices'

export function useRosterChoiceSettings(enabled=true) {
  const {profile}=useAuth()
  const active=useWorkspaceTabActivity()
  return useQuery({queryKey:['employee-roster-choice-settings',profile?.companyId,profile?.id],queryFn:()=>listRosterChoiceSettings(profile!.companyId!),enabled:enabled&&profile?.status==='active'&&Boolean(profile.companyId),retry:false,refetchInterval:enabled&&active?30_000:false})
}
