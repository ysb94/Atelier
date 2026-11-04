import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getSupabase } from '@/lib/supabase/client'
import { diagnosticRealtime, startWorkflow } from '@/lib/diagnostics/workflow-trace'

/** 앱 상단에서 한 번 구독한다. 이벤트는 원본 조회 신호로만 사용한다. */
export function useMeetingRealtime(enabled: boolean, personId?: string, companyId?: string) {
  const cache = useQueryClient()
  const [connected, setConnected] = useState(false)
  useEffect(() => {
    setConnected(false)
    if (!enabled || !personId || !companyId) return
    const client = getSupabase()
    let timer = 0, disposed = false
    const refresh = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        if (disposed) return
        void cache.invalidateQueries({ queryKey: ['meeting-invitations', personId] })
        void cache.invalidateQueries({ queryKey: ['company-meetings', personId, companyId] })
      }, 150)
    }
    const channel = client.channel(`meeting-notices:${personId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meeting_host_notices', filter: `recipient_id=eq.${personId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meeting_invitations', filter: `company_id=eq.${companyId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meeting_round_notices', filter: `recipient_id=eq.${personId}` }, refresh)
      .on('system', { event: '*' }, payload => {
        if (!disposed && payload.extension === 'postgres_changes' && payload.status === 'error') {
          setConnected(false)
          diagnosticRealtime('meeting','notice_channel','CHANNEL_ERROR')
        }
      })
      .subscribe(status => {
        if (disposed) return
        diagnosticRealtime('meeting','notice_channel',status)
        if (status === 'SUBSCRIBED') { setConnected(true); refresh() }
        else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
          setConnected(false)
        }
      })
    const visible = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', visible)
    return () => {
      disposed = true
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', visible)
      void client.removeChannel(channel).catch(error => startWorkflow('meeting','unsubscribe').fail(error))
    }
  }, [enabled, personId, companyId, cache])
  return connected
}
