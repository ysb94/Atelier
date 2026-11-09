import { useSearchParams } from 'react-router-dom'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { useAuth } from '@/lib/supabase/auth'
import { VISUAL_REVIEW_PARAM } from './work-request-navigation'
import { WorkRequestForm } from './WorkRequestPage'

export function VisualWorkNoticeDetail() {
  const { profile, session } = useAuth()
  const [params] = useSearchParams()
  const active = useWorkspaceTabActivity()
  const requestId = params.get('requestId')
  if (!active || profile?.status !== 'active' || session?.user.id !== profile.id
    || params.get(VISUAL_REVIEW_PARAM) !== '1' || !requestId
    || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(requestId)) return null
  return <WorkRequestForm key={profile.id + ':' + requestId} owner="design" surface="notice" />
}
