import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/lib/supabase/auth'
import { PreviewContext, useNavigationPreviewProfile } from '@/lib/company/developer-preview-context'
import { releaseAccess, releaseHref } from '@/lib/company/release-access'
import { useDepartmentApprovers } from '@/features/operations-support/use-department-approvers'
import { assignedDepartmentIds } from '@/lib/supabase/department-approvers'
import { useWorkforceManagement } from '@/lib/company/workforce-management-context'
import type { InboxNotification } from '@/lib/inbox/types'
import { readPollInterval, sharedReadPolicy } from '@/lib/query/shared-read-policy'
import { getMaterialNudgeInbox, materialNudgeKey, materialNudgeUnavailable } from '@/lib/supabase/material-nudges'
import { emptyList } from '@/lib/utils'

function useReleaseState() {
  const { profile: real, session } = useAuth()
  const preview = useContext(PreviewContext)
  const displayed = useNavigationPreviewProfile(real)
  const workforce = useWorkforceManagement()
  const profile = useMemo(() => displayed && workforce ? workforce.decorate(displayed) : displayed, [displayed, workforce])
  const approvals = useDepartmentApprovers()
  const departments = useMemo(() => assignedDepartmentIds(approvals.settings, profile?.id), [approvals.settings, profile?.id])
  const approver = !approvals.loading && !approvals.error && departments.length > 0
  const scope = useMemo(() => releaseAccess(profile), [profile])
  const materialNudgeAccountId = !preview?.selected && real?.status === 'active' && real.companyId && session?.user.id === real.id ? real.id : undefined
  const { data, isPending, error, refetch: refreshMaterialNudges } = useQuery({
    ...sharedReadPolicy,
    queryKey: materialNudgeKey(materialNudgeAccountId),
    queryFn: ({ signal }) => getMaterialNudgeInbox(signal),
    enabled: Boolean(materialNudgeAccountId),
    refetchInterval: query => materialNudgeUnavailable(query.state.error) ? false : readPollInterval(60_000, Boolean(materialNudgeAccountId))(query),
  })
  const materialNudgeViewer = Boolean(materialNudgeAccountId && !error && data?.canView)
  const materialNudgeNotifications = materialNudgeAccountId ? data?.notifications ?? emptyList<InboxNotification>() : emptyList<InboxNotification>()
  const materialNudgeChecking = Boolean(materialNudgeAccountId && isPending)
  const materialNudgeSupported = !materialNudgeUnavailable(error)
  const materialNudgeError = materialNudgeAccountId && materialNudgeSupported ? error : null
  return useMemo(() => ({ profile, scope, approvals: { settings: approvals.settings, loading: approvals.loading, error: approvals.error, refresh: approvals.refresh }, departments, approver,
    href: (href: string) => releaseHref(profile, href, approver, materialNudgeViewer),
    materialNudgeViewer, materialNudgeAccountId, materialNudgeNotifications, materialNudgeChecking, materialNudgeError, materialNudgeSupported, refreshMaterialNudges,
  }), [profile, scope, approvals.settings, approvals.loading, approvals.error, approvals.refresh, departments, approver,
    materialNudgeViewer, materialNudgeAccountId, materialNudgeNotifications, materialNudgeChecking, materialNudgeError, materialNudgeSupported, refreshMaterialNudges])
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
