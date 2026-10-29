import { Button } from '@/components/ui/button'
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
    <div className="flex gap-2" role="group" aria-label="연차관리 보기">
      <Button variant={view === 'requests' ? 'default' : 'outline'} aria-pressed={view === 'requests'} onClick={() => setView('requests')}>신청 현황</Button>
      <Button variant={view === 'balance' ? 'default' : 'outline'} aria-pressed={view === 'balance'} onClick={() => setView('balance')}>연차 현황</Button>
      <Button variant={view === 'alarm' ? 'default' : 'outline'} aria-pressed={view === 'alarm'} onClick={() => setView('alarm')}>연차 소진 알람</Button>
    </div>
    {view === 'requests' ? <LeaveApprovalPanel readOnly officialReview={canEditOrgAssignment(profile)}/> : view === 'balance' ? <LeaveBalancePanel/> : <LeaveUsageNoticePanel/>}
  </div>
}
