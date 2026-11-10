import { FilterTabs } from '@/components/ui/filter-tabs'
import { useAuth } from '@/lib/supabase/auth'
import { canEditOrgAssignment } from '@/lib/company/capabilities'
import { LeaveApprovalPanel } from './LeaveApprovalPanel'
import { useSearchParams } from 'react-router-dom'
import { LeaveUsageNoticePanel } from './LeaveUsageNoticePanel'
import { LeaveBalancePanel } from './LeaveBalancePanel'

type LeaveView = 'requests' | 'balance' | 'alarm'

export function LeavePanel() {
  const { profile } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedView = searchParams.get('leaveView')
  const view: LeaveView = requestedView === 'alarm' || requestedView === 'balance' ? requestedView : 'requests'
  function setView(next: LeaveView) { setSearchParams(previous => { const params = new URLSearchParams(previous); if(next === 'requests') params.delete('leaveView'); else params.set('leaveView', next); return params }, { replace: true }) }
  return <div className="space-y-4">
    <FilterTabs<LeaveView> ariaLabel="연차 업무" value={view} onChange={setView} variant="underline" size="large" tabs={[{ value: 'requests', label: '신청 현황' }, { value: 'balance', label: '연차 현황' }, { value: 'alarm', label: '연차 소진 알람' }]} />
    {view === 'requests' ? <LeaveApprovalPanel readOnly officialReview={canEditOrgAssignment(profile)}/> : view === 'balance' ? <LeaveBalancePanel/> : <LeaveUsageNoticePanel/>}
  </div>
}
