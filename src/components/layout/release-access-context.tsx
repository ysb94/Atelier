import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useAuth } from '@/lib/supabase/auth'
import { useNavigationPreviewProfile } from '@/lib/company/developer-preview-context'
import { releaseAccess, releaseHref } from '@/lib/company/release-access'
import { useDepartmentApprovers } from '@/features/operations-support/use-department-approvers'
import { assignedDepartmentIds } from '@/lib/supabase/department-approvers'

function useReleaseState() {
  const { profile: real } = useAuth()
  const profile = useNavigationPreviewProfile(real)
  const approvals = useDepartmentApprovers()
  const departments = useMemo(() => assignedDepartmentIds(approvals.settings, profile?.id), [approvals.settings, profile?.id])
  const approver = !approvals.loading && !approvals.error && departments.length > 0
  const scope = useMemo(() => releaseAccess(profile), [profile])
  return useMemo(() => ({ profile, scope, approvals: { settings: approvals.settings, loading: approvals.loading, error: approvals.error, refresh: approvals.refresh }, departments, approver,
    href: (href: string) => releaseHref(profile, href, approver),
  }), [profile, scope, approvals.settings, approvals.loading, approvals.error, approvals.refresh, departments, approver])
}
const ReleaseContext = createContext<ReturnType<typeof useReleaseState> | null>(null)
function ReleaseStateProvider({ children }: { children: ReactNode }) {
  const state = useReleaseState()
  return <ReleaseContext.Provider value={state}>{children}</ReleaseContext.Provider>
}
/** 독립 미리보기에서도 같은 규칙을 쓰고, 실제 회사 셸에서는 한 번만 구독한다. */
export function ReleaseAccessProvider({ children }: { children: ReactNode }) {
  const parent = useContext(ReleaseContext)
  return parent ? children : <ReleaseStateProvider>{children}</ReleaseStateProvider>
}
export function useReleaseAccess() {
  const state = useContext(ReleaseContext)
  if (!state) throw new Error('ReleaseAccessProvider가 필요합니다.')
  return state
}
