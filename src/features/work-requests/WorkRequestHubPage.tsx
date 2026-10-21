import { useAuth } from '@/lib/supabase/auth'
import { hasPermission } from '@/lib/company/permissions'
import { MyWorkDashboard } from './MyWorkDashboard'

export function WorkRequestHubPage() {
  const { profile } = useAuth()
  const role = hasPermission(profile, 'work.manage', 'department', profile?.departmentId) ? 'lead' : 'employee'
  return <MyWorkDashboard key={`${profile?.id ?? 'unassigned'}:${role}`}
    name={profile?.displayName || '나'} department={profile?.departmentName || '소속 미지정'} initialRole={role}/>
}
