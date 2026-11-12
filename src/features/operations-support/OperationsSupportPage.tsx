import { Navigate, useLocation, useParams } from 'react-router-dom'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { useRenderWatch } from '@/lib/diagnostics'
import { AttendancePanel } from './AttendancePanel'
import { LeavePanel } from './LeavePanel'
import { OperationsPeoplePanel } from './OperationsPeoplePanel'
import { OperationsSettingsPanel } from './OperationsSettingsPanel'
import './operations-support.css'
import { useAuth } from '@/lib/supabase/auth'
import { canEditOrgAssignment, isOperationsDepartmentMember } from '@/lib/company/capabilities'
import {
  OPERATIONS_SECTIONS,
  OPERATIONS_SUPPORT_ROOT,
  canViewOperationsSection,
  defaultOperationsSection,
  isOperationsSection,
  legacyOperationsHref,
} from './operations-support-sections'

export function OperationsSupportPage() {
  useRenderWatch('OperationsSupportPage')
  const { profile } = useAuth()
  const { section } = useParams()
  const { search } = useLocation()

  // 예전 `?part=` 주소와 알림 링크는 업무별 주소로 옮긴다.
  if (!section) return <Navigate to={legacyOperationsHref(search, defaultOperationsSection(profile))} replace />
  if (!isOperationsSection(section)) return <Navigate to={OPERATIONS_SUPPORT_ROOT} replace />

  // Hide the entire subtree so denied users never mount employee/attendance queries.
  if (!canViewOperationsSection(profile, section)) {
    return <p role="status" className="rounded-xl border border-border bg-card px-5 py-6 text-sm text-muted-foreground shadow-sm">운영지원 기능 또는 회사 현황 조회 권한이 필요합니다.</p>
  }

  const current = OPERATIONS_SECTIONS.find(item => item.id === section) ?? OPERATIONS_SECTIONS[0]
  const canReviewAdvances = section === 'leave' && isOperationsDepartmentMember(profile)
  return (
    <div className="operations-support">
      <PageHeader
        title={current.label}
        description={current.description}
        actions={canEditOrgAssignment(profile) || canReviewAdvances ? undefined : <Badge variant="muted" title="운영지원 자료를 조회할 수 있습니다. 저장·승인은 기존 업무 권한을 따릅니다.">조회 전용 · 저장은 업무 권한에 따름</Badge>}
      />
      {section === 'attendance' ? <AttendancePanel /> : null}
      {section === 'leave' ? <LeavePanel /> : null}
      {section === 'people' ? <OperationsPeoplePanel /> : null}
      {section === 'settings' ? <OperationsSettingsPanel /> : null}
    </div>
  )
}
