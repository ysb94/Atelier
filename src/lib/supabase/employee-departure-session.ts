import { useEffect } from 'react'
import { diagnosticRealtime, startWorkflow } from '@/lib/diagnostics/workflow-trace'
import { getSupabase } from './client'

export function useEmployeeDepartureSession(userId: string | undefined, onDeparture: (userId: string) => void) {
  useEffect(() => {
    if (!userId) return
    const client = getSupabase()
    let active = true
    let revoked = false
    let checking = false
    let available = true
    function finish() {
      if (!active || revoked || !userId) return
      revoked = true
      onDeparture(userId)
    }
    async function check() {
      if (!active || revoked || checking || !available || document.visibilityState !== 'visible') return
      checking = true
      try {
        const { data, error } = await client.from('employee_departure_signals').select('employee_id')
          .eq('employee_id', userId!).maybeSingle()
        if (data) finish()
        if (error && ['42P01', 'PGRST205'].includes(error.code)) available = false
      } finally {
        checking = false
      }
    }
    const checkSession = () => { void check().catch(error => startWorkflow('app', 'employee_departure_session_check').fail(error)) }
    const channel = client.channel(`employee-departure:${userId}:${crypto.randomUUID()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'employee_departure_signals', filter: `employee_id=eq.${userId}` }, finish)
      .subscribe(status => {
        if (!active) return
        diagnosticRealtime('app', 'employee_departure_session_channel', status)
        if (status === 'SUBSCRIBED') checkSession()
      })
    checkSession()
    const interval = window.setInterval(checkSession, 60_000)
    document.addEventListener('visibilitychange', checkSession)
    window.addEventListener('online', checkSession)
    return () => {
      active = false
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', checkSession)
      window.removeEventListener('online', checkSession)
      void client.removeChannel(channel).catch(error => startWorkflow('app', 'employee_departure_session_disconnect').fail(error))
    }
  }, [onDeparture, userId])
}
