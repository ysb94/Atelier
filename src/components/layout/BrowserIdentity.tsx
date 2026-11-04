import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '@/lib/supabase/auth'
import { browserDocumentTitle, browserEnvironment, browserPageTitle } from '@/lib/workspace/browser-title'

import { BrowserBadgeContext, type BrowserBadge, type ReportBrowserBadge } from './browser-identity-context'

/** One document-title writer, outside all retained workspace pages. No queries or read mutations. */
export function BrowserIdentityProvider({ children }: { children: ReactNode }) {
  const { pathname, search } = useLocation()
  const { ready, session, profile, profileError } = useAuth()
  const owner = ready && !profileError && session?.user.id === profile?.id && profile?.status === 'active' ? profile.id : ''
  const [badge, setBadge] = useState<BrowserBadge | null>(null)
  const report = useCallback<ReportBrowserBadge>((next, token) => {
    setBadge(previous => {
      if (!next) return previous?.token === token ? null : previous
      return previous?.owner === next.owner && previous.count === next.count && previous.page === next.page && previous.token === next.token ? previous : next
    })
  }, [])
  const environment = browserEnvironment(window.location.hostname, import.meta.env.DEV)
  const current = owner && badge?.owner === owner ? badge : null
  const page = !ready ? '' : !session ? '로그인' : profileError ? '계정 확인'
    : profile?.status !== 'active' ? '승인 대기' : current?.page ?? browserPageTitle(pathname, search)
  const title = browserDocumentTitle(page, current?.count, environment)
  useEffect(() => { document.title = title }, [title])
  useEffect(() => () => { document.title = browserDocumentTitle('', 0, environment) }, [environment])
  const context = useMemo(() => report, [report])
  return <BrowserBadgeContext.Provider value={context}>{children}</BrowserBadgeContext.Provider>
}
