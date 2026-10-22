import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getSupabase } from '@/lib/supabase/client'

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
      .on('system', { event: '*' }, payload => {
        if (!disposed && payload.extension === 'postgres_changes' && payload.status === 'error') {
          setConnected(false)
          console.warn('[meetings] 알림 변경 구독 실패', { payload })
        }
      })
      .subscribe(status => {
        if (disposed) return
        if (status === 'SUBSCRIBED') { setConnected(true); refresh() }
        else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
          setConnected(false)
          console.warn('[meetings] 알림 실시간 연결 끊김', { status })
        }
      })
    const visible = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', visible)
    return () => {
      disposed = true
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', visible)
      void client.removeChannel(channel).catch(error => console.warn('[meetings] 알림 구독 해제 실패', { error }))
    }
  }, [enabled, personId, companyId, cache])
  return connected
}
