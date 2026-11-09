import { useEffect, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { RELEASE_HOME } from '@/lib/company/release-access'
import { clearImpersonationView } from '@/lib/workspace/impersonation-view'
import { MATERIAL_REQUESTS_PATH } from '@/lib/workspace/material-request-navigation'
import { Button } from '@/components/ui/button'
import { useWorkspaceTabActivity } from './workspace-tab-activity'
import { ReleaseAccessProvider, useReleaseAccess } from './release-access-context'

export function ReleasePageGate({ children }: { children: ReactNode }) {
  return <ReleaseAccessProvider><ReleasePageContent>{children}</ReleasePageContent></ReleaseAccessProvider>
}
function ReleasePageContent({ children }: { children: ReactNode }) {
  const { href, scope, approvals, materialNudgeChecking, materialNudgeError, refreshMaterialNudges } = useReleaseAccess()
  const location = useLocation()
  const active = useWorkspaceTabActivity()
  const navigate = useNavigate()
  const current = location.pathname + location.search
  const checking = !scope.unrestricted && location.pathname === RELEASE_HOME && ['approvals', 'attendance'].includes(new URLSearchParams(location.search).get('part') ?? '')
  const target = href(current)
  const waitingMaterial = target !== current && location.pathname.replace(/\/$/, '') === MATERIAL_REQUESTS_PATH
    && (materialNudgeChecking || Boolean(materialNudgeError))
  const waiting = waitingMaterial || (checking && (approvals.loading || Boolean(approvals.error)))
  useEffect(() => {
    if (active && !waiting && target !== current) {
      clearImpersonationView()
      navigate(target ?? RELEASE_HOME, { replace: true })
    }
  }, [active, waiting, target, current, navigate])
  if (waitingMaterial) return <div role={materialNudgeError ? 'alert' : 'status'} className="space-y-2 p-4 text-sm">
    <p>{materialNudgeError ? '자재요청을 볼 수 있는지 확인하지 못했습니다.' : '자재요청 조회 권한을 확인하고 있습니다.'}</p>
    {materialNudgeError && <Button variant="outline" size="sm" onClick={() => void refreshMaterialNudges()}>다시 확인</Button>}
    <Link to={RELEASE_HOME} className="text-primary underline">My Schedule로 이동</Link>
  </div>
  if (waiting) return <div role={approvals.error ? 'alert' : 'status'} className="space-y-2 p-4 text-sm">
    <p>{approvals.error ? '승인자 지정을 확인하지 못했습니다.' : '승인자 지정을 확인하고 있습니다.'}</p>
    {approvals.error && <Button variant="outline" size="sm" onClick={() => void approvals.refresh()}>다시 확인</Button>}
    <Link to={RELEASE_HOME} className="text-primary underline">My Schedule로 이동</Link>
  </div>
  if (target !== current) return <p role="status" className="p-4 text-sm text-muted-foreground">공개된 화면으로 이동합니다. <Link to={target ?? RELEASE_HOME} className="text-primary underline">이동</Link></p>
  return children
}
