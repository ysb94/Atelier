import { useEffect, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { RELEASE_HOME } from '@/lib/company/release-access'
import { clearImpersonationView } from '@/lib/workspace/impersonation-view'
import { Button } from '@/components/ui/button'
import { useWorkspaceTabActivity } from './workspace-tab-activity'
import { ReleaseAccessProvider, useReleaseAccess } from './release-access-context'

export function ReleasePageGate({ children }: { children: ReactNode }) {
  return <ReleaseAccessProvider><ReleasePageContent>{children}</ReleasePageContent></ReleaseAccessProvider>
}
function ReleasePageContent({ children }: { children: ReactNode }) {
  const { href, scope, approvals } = useReleaseAccess()
  const location = useLocation()
  const active = useWorkspaceTabActivity()
  const navigate = useNavigate()
  const current = location.pathname + location.search
  const checking = !scope.unrestricted && location.pathname === RELEASE_HOME && new URLSearchParams(location.search).get('part') === 'approvals'
  const waiting = checking && (approvals.loading || Boolean(approvals.error))
  const target = href(current)
  useEffect(() => {
    if (active && !waiting && target !== current) {
      clearImpersonationView()
      navigate(target ?? RELEASE_HOME, { replace: true })
    }
  }, [active, waiting, target, current, navigate])
  if (waiting) return <div role={approvals.error ? 'alert' : 'status'} className="space-y-2 p-4 text-sm">
    <p>{approvals.error ? '승인자 지정을 확인하지 못했습니다.' : '승인자 지정을 확인하고 있습니다.'}</p>
    {approvals.error && <Button variant="outline" size="sm" onClick={() => void approvals.refresh()}>다시 확인</Button>}
    <Link to={RELEASE_HOME} className="text-primary underline">My Schedule로 이동</Link>
  </div>
  if (target !== current) return <p role="status" className="p-4 text-sm text-muted-foreground">공개된 화면으로 이동합니다. <Link to={target ?? RELEASE_HOME} className="text-primary underline">이동</Link></p>
  return children
}
