import { createContext, useContext, useEffect, useRef } from 'react'

export type BrowserBadge = { token: symbol; owner: string; count: number; page?: string }
export type ReportBrowserBadge = (badge: BrowserBadge | null, token: symbol) => void
export const BrowserBadgeContext = createContext<ReportBrowserBadge>(() => {})

/** The existing header (or separate chat window) supplies its already-loaded unread count. */
export function useBrowserTabIdentity(owner: string | undefined, count: number, page?: string) {
  const report = useContext(BrowserBadgeContext)
  const token = useRef(Symbol('browser-badge')).current
  useEffect(() => {
    report(owner ? { token, owner, count, page } : null, token)
    return () => report(null, token)
  }, [owner, count, page, report, token])
}
