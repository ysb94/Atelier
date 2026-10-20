import { PageHeader } from '@/components/layout/PageHeader'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useAuth } from '@/lib/supabase/auth'
import { capabilityLabel, isCompanyManager } from '@/lib/company/capabilities'
import { usePagePreview } from '@/lib/company/page-preview-context'
import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useRenderWatch } from '@/lib/diagnostics'
import { LeaveApprovalPanel } from '@/features/operations-support/LeaveApprovalPanel'
import { WorkRequestHubPage } from '@/features/work-requests/WorkRequestHubPage'
import { useDepartmentApprovers } from '@/features/operations-support/use-department-approvers'
import { assignedDepartmentIds } from '@/lib/supabase/department-approvers'
import { MyAttendanceStartPanel } from './MyAttendanceStartPanel'
import { MyAttendancePanel } from './MyAttendancePanel'
import './personal-requests.css'

function formatHireDate(value: string | null | undefined) {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value?.trim() ?? '')
  if (!matched) return '입사일 미등록'
  const month = Number(matched[2])
  const day = Number(matched[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return '입사일 미등록'
  return `${matched[1]}년 ${month}월 ${day}일`
}

type PersonalPart = 'work' | 'my-attendance' | 'profile' | 'approvals' | 'attendance'

function personalPart(value: string | null): PersonalPart {
  if (
    value === 'work' ||
    value === 'profile' ||
    value === 'approvals' ||
    value === 'attendance'
  ) {
    return value
  }
  return 'my-attendance'
}

export function ProfileSettingsPage() {
  useRenderWatch('ProfileSettingsPage')
  const { profile, email } = useAuth()
  const preview = usePagePreview()
  const approvals = useDepartmentApprovers()
  const departments = useMemo(() => assignedDepartmentIds(approvals.settings, profile?.id), [approvals.settings, profile?.id])
  const [searchParams, setSearchParams] = useSearchParams()
  const part = personalPart(searchParams.get('part'))
  function selectPart(next: PersonalPart) {
    const params = new URLSearchParams(searchParams)
    if (next === 'my-attendance') params.delete('part')
    else params.set('part', next)
    setSearchParams(params, { replace: true })
  }
  const hasDepartments = departments.length > 0
  const noDepartments = !hasDepartments && !approvals.loading && !approvals.error
  const rolePreview = Boolean(preview?.active && !preview.facts?.chatRole)
  const showDepartmentTab = preview?.facts?.departmentApprover ?? (isCompanyManager(profile) || (!rolePreview && hasDepartments))
  const visiblePart = part === 'attendance' && !showDepartmentTab ? 'my-attendance' : part

  return (
    <div>
      <PageHeader
        title="마이페이지"
        description="내 출퇴근 기록과 휴가·근무·정정 신청을 한 달력에서 확인합니다."
      />

      <div className="personal-page-tabs" role="tablist" aria-label="마이페이지 메뉴">
        <button type="button" role="tab" id="personal-work-tab" aria-selected={visiblePart === 'work'} aria-controls="personal-work-panel" onClick={() => selectPart('work')}>내 업무</button>
        <button type="button" role="tab" id="personal-my-attendance-tab" aria-selected={visiblePart === 'my-attendance'} aria-controls="personal-my-attendance-panel" onClick={() => selectPart('my-attendance')}>내 근태</button>
        <button type="button" role="tab" id="personal-profile-tab" aria-selected={visiblePart === 'profile'} aria-controls="personal-profile-panel" onClick={() => selectPart('profile')}>내 정보</button>
        <button type="button" role="tab" id="personal-approvals-tab" aria-selected={visiblePart === 'approvals'} aria-controls="personal-approvals-panel" onClick={() => selectPart('approvals')}>승인할 신청</button>
        {showDepartmentTab ? (
          <button type="button" role="tab" id="personal-attendance-tab" className="is-department" aria-selected={visiblePart === 'attendance'} aria-controls="personal-attendance-panel" onClick={() => selectPart('attendance')}>
            부서 출근시간
            <small>관리자</small>
          </button>
        ) : null}
      </div>
      {part === 'work' && <div id="personal-work-panel" role="tabpanel" aria-labelledby="personal-work-tab"><WorkRequestHubPage /></div>}
      <div id="personal-my-attendance-panel" role="tabpanel" aria-labelledby="personal-my-attendance-tab" hidden={visiblePart !== 'my-attendance'}><MyAttendancePanel /></div>
      {visiblePart === 'attendance' && showDepartmentTab && <div id="personal-attendance-panel" role="tabpanel" aria-labelledby="personal-attendance-tab">
        {approvals.error && <p className="personal-page-notice is-error" role="alert">
          {hasDepartments ? '담당 부서 정보를 다시 불러오지 못했습니다. 아래 내용이 최신이 아닐 수 있으니 잠시 후 다시 확인해 주세요.'
            : '담당 부서 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'}
        </p>}
        {hasDepartments ? <MyAttendanceStartPanel departmentIds={departments} />
          : approvals.loading ? <p className="personal-page-notice" role="status">담당 부서 정보를 불러오는 중입니다.</p>
          : noDepartments && <p className="personal-page-notice">지정된 담당 부서가 없어 설정할 직원이 없습니다. 담당 지정은 운영지원팀에 요청해 주세요.</p>}
      </div>}
      {visiblePart === 'approvals' && <div id="personal-approvals-panel" role="tabpanel" aria-labelledby="personal-approvals-tab">
        {noDepartments && <p className="personal-page-notice">지정된 승인 담당이 아니면 목록이 비어 있을 수 있습니다.</p>}
        <LeaveApprovalPanel />
      </div>}
      <div id="personal-profile-panel" role="tabpanel" aria-labelledby="personal-profile-tab" hidden={visiblePart !== 'profile'}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader>
            <CardTitle>프로필</CardTitle>
            <CardDescription>
              확인한 본명은 직접 바꿀 수 없습니다. 개명이나 오타, 직급·입사일
              변경은 운영지원팀 또는 담당자에게 요청해 주세요.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <p className="text-sm font-medium">본명</p>
              <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                {profile?.displayName?.trim() || '본명 미입력'}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <p className="text-sm font-medium">팀</p>
                <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                  {profile?.departmentName || '팀 미정'}
                </p>
              </div>
              <div className="space-y-1.5">
                <p className="text-sm font-medium">직책</p>
                <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                  {profile?.position?.trim() || '직책 미정'}
                </p>
              </div>
              <div className="space-y-1.5">
                <p className="text-sm font-medium">직급</p>
                <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                  {profile?.jobGrade?.trim() || '직급 미정'}
                </p>
              </div>
              <div className="space-y-1.5">
                <p className="text-sm font-medium">입사일</p>
                <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                  {formatHireDate(profile?.hireDate)}
                </p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              본명, 팀, 직책, 직급, 입사일 변경은 운영지원팀 또는 담당자에게 요청해 주세요.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>계정 정보</CardTitle>
            <CardDescription>로그인 계정과 회사 업무 역량입니다.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                이메일
              </div>
              <div className="mt-1">{email ?? profile?.email ?? '—'}</div>
            </div>

            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                업무 역량
              </div>
              {profile?.capabilities.length ? (
                <ul className="mt-2 space-y-2">
                  {profile.capabilities.map((capability) => (
                    <li
                      key={capability}
                      className="rounded-md border border-border px-3 py-2"
                    >
                      {capabilityLabel(capability)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-muted-foreground">지정된 역량 없음</p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                역량 변경은 멤버 관리자에게 요청해 주세요. 승인된 직원은 모든
                브랜드를 조회할 수 있습니다.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
      </div>
    </div>
  )
}
