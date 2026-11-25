import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { usePagePreview } from '@/lib/company/page-preview-context'
import { isPreviewProfile } from '@/lib/company/profile-preview'
import { RELEASE_COMPANY_ID } from '@/lib/company/release-access'
import { readPollInterval, sharedReadPolicy } from '@/lib/query/shared-read-policy'
import { useAuth } from '@/lib/supabase/auth'
import { departureHandoverKey, listDepartureHandoverNotices } from '@/lib/supabase/departure-handover'
import { getSupabase } from '@/lib/supabase/client'
import { diagnosticRealtime, startWorkflow } from '@/lib/diagnostics/workflow-trace'

export function useDepartureHandoverNotices(coordinator = false, background = false) {
  const { profile, session } = useAuth()
  const preview = usePagePreview()
  const actor = profile?.id
  const enabled = Boolean(actor && profile?.companyId === RELEASE_COMPANY_ID && profile.status === 'active' &&
    session?.user.id === actor && !preview?.active && !isPreviewProfile(profile))
  const cache = useQueryClient()
  const query = useQuery({ ...sharedReadPolicy, queryKey: departureHandoverKey(actor), queryFn: listDepartureHandoverNotices,
    enabled, refetchInterval: query => query.state.data?.available === false ? false : readPollInterval(30_000, coordinator && enabled)(query),
    refetchIntervalInBackground: coordinator && background })
  const available = query.data?.available === true
  useEffect(() => {
    if (!coordinator || !enabled || !available || !actor) return
    const db = getSupabase()
    const refresh = () => { void cache.invalidateQueries({ queryKey: departureHandoverKey(actor) }) }
    const channel = db.channel(`departure-handover:${actor}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'departure_handover_signals', filter: `recipient_id=eq.${actor}` }, refresh)
      .subscribe(status => {
        if (status) diagnosticRealtime('notification', 'departure_handover_channel', status)
        if (status === 'SUBSCRIBED') refresh()
      })
    return () => { void db.removeChannel(channel).catch(error => startWorkflow('notification', 'departure_handover_unsubscribe').fail(error)) }
  }, [actor, available, cache, coordinator, enabled])
  return { rows: enabled ? query.data?.rows : undefined, checking: enabled && query.isPending, error: enabled ? query.error : null }
}
