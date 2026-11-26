import { useQuery, useQueryClient } from '@tanstack/react-query'
import { readPollInterval, sharedReadPolicy } from '@/lib/query/shared-read-policy'
import { useAuth } from '@/lib/supabase/auth'
import { listCompanyMeetings, listMeetingNoticeContext } from '@/lib/supabase/meetings'

export function useMeetingNoticeContext(enabled: boolean, poll = false, background = false) {
  const { profile } = useAuth()
  const cache = useQueryClient()
  const personId = profile?.id
  const companyId = profile?.companyId
  const allowed = Boolean(enabled && personId && companyId && profile?.status === 'active')
  return useQuery({
    queryKey: ['meeting-invitations', personId, companyId, 'context'],
    queryFn: () => listMeetingNoticeContext(personId!, () => cache.fetchQuery({
      queryKey: ['company-meetings', personId, companyId], queryFn: listCompanyMeetings, ...sharedReadPolicy,
    })),
    ...sharedReadPolicy,
    enabled: allowed,
    refetchInterval: readPollInterval(30_000, allowed && poll),
    refetchIntervalInBackground: background && poll,
  })
}

/** Detail readers must match the displayed event against a successful read for this account. */
export function useCachedMeetingInvitations() {
  const query = useMeetingNoticeContext(false)
  return query.isSuccess ? query.data.invitations : undefined
}
