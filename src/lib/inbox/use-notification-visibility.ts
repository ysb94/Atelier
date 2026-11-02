import { useEffect, useState } from 'react'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'

/** Kept-alive workspace panels and background browser tabs must not acknowledge content. */
export function useNotificationDetailVisibility() {
  const active = useWorkspaceTabActivity()
  const [visible,setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState === 'visible')
  useEffect(() => {
    const update=()=>setVisible(document.visibilityState==='visible')
    document.addEventListener('visibilitychange',update)
    return()=>document.removeEventListener('visibilitychange',update)
  },[])
  return active&&visible
}
