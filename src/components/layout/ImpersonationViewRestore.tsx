import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '@/lib/supabase/auth'
import { useAttendanceEntry } from '@/features/home/attendance-entry-context'
import { restoreImpersonationView } from '@/lib/workspace/impersonation-view'
import { useWorkspaceTabActivity } from './workspace-tab-activity'

export function ImpersonationViewRestore() {
  const { profile, session } = useAuth()
  const { pathname, search, hash } = useLocation()
  const entry = useAttendanceEntry()
  const active = useWorkspaceTabActivity()
  const actorId = profile?.id
  const ready = active && profile?.status === 'active' && session?.user.id === profile.id
    && (!entry || (entry.phase === 'ready' && !entry.checkoutOpen))
  useEffect(() => {
    if (ready && actorId) return restoreImpersonationView(actorId)
  }, [ready, actorId, pathname, search, hash])
  return null
}
