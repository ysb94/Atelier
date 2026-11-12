import { FilterTabs, type FilterTab } from '@/components/ui/filter-tabs'
import { Button } from '@/components/ui/button'
import { WorkspaceTabOverlay } from '@/components/layout/workspace-tab-overlay'
import { useAuth } from '@/lib/supabase/auth'
import { canAccessOperationsSupport, canEditOrgAssignment, isOperationsDepartmentMember } from '@/lib/company/capabilities'
import { MyHomeNotificationBadge, MyHomeNotificationList } from '@/features/settings/MyHomeNotificationList'
import { LeaveApprovalPanel } from './LeaveApprovalPanel'
import { LeaveAdvanceReview } from './LeaveAdvanceReview'
import { useSearchParams } from 'react-router-dom'
import { LeaveUsageNoticePanel } from './LeaveUsageNoticePanel'
import { LeaveBalancePanel } from './LeaveBalancePanel'
import { useLeaveAdvances } from './use-leave-advances'

type LeaveView = 'requests' | 'balance' | 'alarm'

export function LeavePanel() {
  const { profile } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedView = searchParams.get('leaveView')
  const fullAccess = canAccessOperationsSupport(profile)
  const operationsMember = isOperationsDepartmentMember(profile)
  const canViewBalance = fullAccess || operationsMember
  const view: LeaveView = requestedView === 'balance' && canViewBalance ? 'balance'
    : requestedView === 'alarm' && fullAccess ? 'alarm' : 'requests'
  const reviewId = operationsMember && view === 'balance' ? searchParams.get('advanceRequest') : null
  const advances = useLeaveAdvances(false, operationsMember && view === 'balance', { operationsReview: true })
  const approvalReady = advances.data?.approvalMode === 'operations' && advances.data.ready && !advances.isError
  const tabs: FilterTab<LeaveView>[] = [
    { value: 'requests', label: '신청 현황' },
    ...(canViewBalance ? [{ value: 'balance' as const, label: '연차 현황', trailing: operationsMember && <MyHomeNotificationBadge tab="operations-leave" /> }] : []),
    ...(fullAccess ? [{ value: 'alarm' as const, label: '연차 소진 알람' }] : []),
  ]
  function setView(next: LeaveView) {
    setSearchParams(previous => {
      const params = new URLSearchParams(previous)
      if (next === 'requests') params.delete('leaveView')
      else params.set('leaveView', next)
      params.delete('advanceRequest')
      if (next !== 'requests') params.delete('request')
      return params
    }, { replace: true })
  }
  function closeReview() {
    setSearchParams(previous => {
      const params = new URLSearchParams(previous)
      params.delete('advanceRequest')
      return params
    }, { replace: true })
  }
  return <div className="space-y-4">
    <FilterTabs ariaLabel="연차 업무" value={view} onChange={setView} variant="underline" size="large" tabs={tabs} />
    {view === 'requests' ? <LeaveApprovalPanel readOnly officialReview={fullAccess && canEditOrgAssignment(profile)} openAdvanceReview={operationsMember} advanceOnly={!fullAccess}/>
    : view === 'balance' ? <>
      {operationsMember && approvalReady && <MyHomeNotificationList tab="operations-leave" />}
      {operationsMember && advances.isError && <p role="alert" className="text-sm text-danger">선사용 승인 설정을 확인하지 못했습니다. <Button type="button" size="sm" variant="outline" onClick={() => void advances.refetch()}>다시 조회</Button></p>}
      {operationsMember && !approvalReady && advances.isSuccess && <p role="status" className="text-sm text-muted-foreground">운영지원 선사용 승인 연결 대기 중입니다.</p>}
      {fullAccess && <LeaveBalancePanel reviewOpen={reviewId !== null}/>}
      {reviewId && <WorkspaceTabOverlay><LeaveAdvanceReview key={reviewId} requestId={reviewId} approvalReady={approvalReady} onClose={closeReview}/></WorkspaceTabOverlay>}
    </> : <LeaveUsageNoticePanel/>}
  </div>
}
