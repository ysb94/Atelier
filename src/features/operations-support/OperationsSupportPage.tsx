import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '@/components/layout/PageHeader'
import { useRenderWatch } from '@/lib/diagnostics'
import { cn } from '@/lib/utils'
import { OrgChartPage } from '@/features/org/OrgChartPage'
import { AttendancePanel } from './AttendancePanel'
import { LeavePanel } from './LeavePanel'
import { DepartmentApproversPanel } from './DepartmentApproversPanel'
import { DocumentOutputPanel } from './DocumentOutputPanel'
import { useAuth } from '@/lib/supabase/auth'
import { canAccessOperationsSupport, canEditOrgAssignment } from '@/lib/company/capabilities'

const PARTS = [
  { id: 'org', label: '조직도', description: '부서 배치와 직책·직급을 관리합니다.' },
  { id: 'attendance', label: '근태', description: '월별 직원 근태를 검토하고 정산 자료를 준비합니다.' },
  { id: 'leave', label: '연차관리', description: '직원 휴가 신청과 연차 현황을 확인합니다.' },
  { id: 'approvers', label: '승인자 설정', description: '부서별 연차·야근 승인 담당자를 지정합니다.' },
  { id: 'documents', label: '서류 출력', description: '관련 서류의 출력 조건과 양식 준비 상태를 확인합니다.' },
] as const

type PartId = (typeof PARTS)[number]['id']

function partFromSearch(value: string | null): PartId {
  return PARTS.some((part) => part.id === value) ? (value as PartId) : 'org'
}

export function OperationsSupportPage() {
  useRenderWatch('OperationsSupportPage')
  const { profile } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const part = partFromSearch(searchParams.get('part'))
  const current = PARTS.find((item) => item.id === part) ?? PARTS[0]

  function selectPart(next: PartId) {
    setSearchParams((previous) => {
      const params = new URLSearchParams(previous)
      if (next === 'org') params.delete('part')
      else params.set('part', next)
      return params
    }, { replace: true })
  }

  // Hide the entire subtree so denied users never mount employee/attendance queries.
  if (!canAccessOperationsSupport(profile)) {
    return <p role="status" className="rounded-xl border border-border bg-card px-5 py-6 text-sm text-muted-foreground">운영지원팀 전용 화면입니다.</p>
  }

  return (
    <div>
      <PageHeader title="운영지원" description={current.description} />
      {!canEditOrgAssignment(profile) && <p className="mb-4 rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">제작 화면 검수 · 운영지원 자료를 조회할 수 있습니다. 저장·승인은 기존 업무 권한을 따릅니다.</p>}
      <div role="tablist" aria-label="운영지원 파트" className="mb-5 flex gap-1 overflow-x-auto border-b border-border">
        {PARTS.map((item) => {
          const selected = item.id === part
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => selectPart(item.id)}
              className={cn(
                'shrink-0 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm transition-colors',
                selected
                  ? 'border-primary font-semibold text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {item.label}
            </button>
          )
        })}
      </div>
      {part === 'org' ? <OrgChartPage mode="manage" showHeading={false} /> : null}
      {part === 'attendance' ? <AttendancePanel /> : null}
      {part === 'leave' ? <LeavePanel /> : null}
      {part === 'approvers' ? <DepartmentApproversPanel /> : null}
      {part === 'documents' ? <DocumentOutputPanel /> : null}
    </div>
  )
}
