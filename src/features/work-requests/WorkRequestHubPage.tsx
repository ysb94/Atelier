import { useAuth } from '@/lib/supabase/auth'
import { isCompanyManager, isCompanyReviewer } from '@/lib/company/capabilities'
import { MyWorkDashboard } from './MyWorkDashboard'

export function WorkRequestHubPage() {
  const { profile } = useAuth()
  const role = isCompanyManager(profile) || isCompanyReviewer(profile) ? 'lead' : 'employee'
  return <MyWorkDashboard key={`${profile?.id ?? 'unassigned'}:${role}`}
    name={profile?.displayName || '나'} department={profile?.departmentName || '소속 미지정'} initialRole={role}/>
}
