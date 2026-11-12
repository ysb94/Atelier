import { FilterTabs, type FilterTab } from '@/components/ui/filter-tabs'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/supabase/auth'
import { canAccessOperationsSupport, canEditOrgAssignment, isOperationsDepartmentMember } from '@/lib/company/capabilities'
import { MyHomeNotificationBadge, MyHomeNotificationList } from '@/features/settings/MyHomeNotificationList'
import { LeaveApprovalPanel } from './LeaveApprovalPanel'
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
  const view: LeaveView = fullAccess && (requestedView === 'alarm' || requestedView === 'balance') ? requestedView : 'requests'
  const advances = useLeaveAdvances(false, operationsMember && view === 'requests', { operationsReview: true })
  const advanceReview = operationsMember && advances.data?.approvalMode === 'operations' && advances.data.ready
  const tabs: FilterTab<LeaveView>[] = [
    { value: 'requests', label: '신청 현황', trailing: operationsMember && <MyHomeNotificationBadge tab="operations-leave" /> },
    ...(fullAccess ? [{ value: 'balance' as const, label: '연차 현황' }, { value: 'alarm' as const, label: '연차 소진 알람' }] : []),
  ]
  function setView(next: LeaveView) { setSearchParams(previous => { const params = new URLSearchParams(previous); if(next === 'requests') params.delete('leaveView'); else params.set('leaveView', next); return params }, { replace: true }) }
  return <div className="space-y-4">
    <FilterTabs ariaLabel="연차 업무" value={view} onChange={setView} variant="underline" size="large" tabs={tabs} />
    {view === 'requests' ? <>
      {advanceReview && <MyHomeNotificationList tab="operations-leave" />}
      {operationsMember && advances.isError && <p role="alert" className="text-sm text-danger">선사용 승인 설정을 확인하지 못했습니다. <Button type="button" size="sm" variant="outline" onClick={() => void advances.refetch()}>다시 조회</Button></p>}
      {operationsMember && !advanceReview && advances.isSuccess && <p role="status" className="text-sm text-muted-foreground">운영지원 선사용 승인 연결 대기 중입니다.</p>}
      <LeaveApprovalPanel readOnly officialReview={fullAccess && canEditOrgAssignment(profile)} advanceReview={advanceReview} advanceOnly={!fullAccess}/>
    </> : view === 'balance' ? <LeaveBalancePanel/> : <LeaveUsageNoticePanel/>}
  </div>
}
