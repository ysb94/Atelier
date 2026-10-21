import type { Profile } from '../supabase/profiles'
import { WORK_CAPABILITIES, WORK_CAPABILITY_LABEL, type WorkCapability } from './capabilities'
import { pagePreviewCases, type PagePreviewCase } from './page-preview-cases'
import { casePermissionGrants } from './permission-preview'

export type PreviewFacts = {
  usageAccess?: 'manager' | 'editor' | 'viewer'
  brandLead?: boolean
  chatRole?: 'manager' | 'admin' | 'employee'
  departmentApprover?: boolean
  meetingRole?: 'host' | 'participant' | 'outsider' | 'uploader'
  requestOwner?: 'self' | 'other'
}
export type CompletePreviewCase = PagePreviewCase & { facts?: PreviewFacts }

/** 기존 목록을 보존하면서 실제 페이지의 빠진 권한 분기를 보완한다. */
export function completePagePreviewCases(pathname: string, real: Profile): CompletePreviewCase[] {
  const path = pathname.replace(/\/$/, '') || '/'
  const cases: CompletePreviewCase[] = [...pagePreviewCases(path, real)]
  const base = {
    departmentId: null, departmentName: null, departmentPersonnelScope: null,
    position: '사원', jobGrade: '사원', status: 'active' as const, isAdmin: false,
    capabilities: [] as WorkCapability[], memberships: [],
  }
  function add(id: string, label: string, settings: Partial<PagePreviewCase['settings']> = {}, facts?: PreviewFacts) {
    if (!cases.some(item => item.id === id)) cases.push({ id, label, settings: { ...base, ...settings }, facts })
  }
  const personnel = { departmentName: '운영지원팀', departmentPersonnelScope: 'members' as const }
  const executive = { position: '이사', departmentName: '운영진' }
  const reviewer = { position: '대표이사', departmentName: '운영진' }
  if (path === '/') {
    add('operations', '운영지원 · 사원', { departmentName: '운영지원팀' })
    add('personnel-member', '인사 담당 · 사원', personnel)
    add('executive', '이사 · 출퇴근 제외', executive)
    add('unassigned', '소속 미지정')
    for (const capability of WORK_CAPABILITIES) add(`team-${capability}`, `${WORK_CAPABILITY_LABEL[capability]} 담당`, {
      departmentName: `${WORK_CAPABILITY_LABEL[capability]}팀`, capabilities: [capability],
    })
  }
  if (path === '/settings/profile' || path === '/work') {
    add('manager', '팀장급', { position: '팀장', jobGrade: '과장', departmentName: '디자인팀', capabilities: ['design'] })
    add('employee', '사원급', { departmentName: '디자인팀', capabilities: ['design'] })
    add('reviewer', '대표이사 · 팀 업무 / 출퇴근 제외', reviewer)
    add('executive', '이사 · 팀 업무 / 출퇴근 제외', executive)
    add('unassigned', '소속 미지정')
    add('department-approver', '부서 승인 담당자 · 사원', {}, { departmentApprover: true })
    add('department-unassigned', '부서 승인 미지정 · 사원', {}, { departmentApprover: false })
  }
  if (path === '/members') {
    add('personnel-member', '인사 담당 · 조직 수정 불가', { departmentName: '기획팀', departmentPersonnelScope: 'members' })
    add('admin', '관리자 · 조직 수정 불가', { isAdmin: true })
    add('leader-denied', '인사 범위 · 사원 제한', { departmentPersonnelScope: 'leaders' })
  }
  if (path === '/operations-support') {
    add('operations-lead', '운영지원 · 팀장', { departmentName: '운영지원팀', departmentPersonnelScope: 'leaders', position: '팀장' })
    add('admin-denied', '관리자 · 타 부서 제한', { isAdmin: true, departmentName: '기획팀' })
  }
  if (path === '/settings/profile' || path === '/operations-support') {
    const settings = path === '/operations-support' ? personnel : {}
    add('request-self', '신청 검토 · 본인 신청', settings, { requestOwner: 'self' })
    add('request-other', '신청 검토 · 다른 직원 신청', settings, { requestOwner: 'other' })
  }
  if (path === '/meetings' || path === '/settings/profile') {
    add('meeting-host', '회의 · 주최자', {}, { meetingRole: 'host' })
    add('meeting-participant', '회의 · 참여자', {}, { meetingRole: 'participant' })
    add('meeting-outsider', '회의 · 비참여자', {}, { meetingRole: 'outsider' })
    add('meeting-uploader', '회의 · 자료 등록자', {}, { meetingRole: 'uploader' })
  }
  if (path === '/drafts') add('reviewer', '대표이사 · 담당자별 조회', reviewer)
  if (path === '/brands') {
    // 일반 관리자/브랜드 책임자는 진입이 제한된다. 진입 가능한 대표의 각 편집 조합도 시험한다.
    add('reviewer-admin', '대표 · 브랜드 생성 / 수정 / 삭제', { ...reviewer, isAdmin: true })
    add('reviewer-lead', '대표 · 담당 브랜드 수정', reviewer, { brandLead: true })
  }
  if (path === '/settings/ai') add('brand-lead', '브랜드 책임자 · 편집 가능', {}, { brandLead: true })
  if (path === '/idea-contest') {
    add('reviewer', '대표이사 · 접수함 조회', reviewer)
    add('employee', '일반 직원 · 접근 제한')
    add('admin', '관리자 · 접근 제한', { isAdmin: true })
  }
  if (path === '/usage-codes') {
    add('partner-manager', '관리자 · 담당자 / 헤더 설정', { isAdmin: true }, { usageAccess: 'manager' })
    add('partner-editor', '업체 담당자 · 전용 값 수정', {}, { usageAccess: 'editor' })
    add('partner-viewer', '일반 직원 · 조회 전용', {}, { usageAccess: 'viewer' })
  }
  // 채팅 패널과 별도 채팅 창 안에서만 노출하며 페이지의 역할 선택과 독립적으로 시험한다.
  add('chat-manager', '채팅 · 팀장', {}, { chatRole: 'manager' })
  add('chat-admin', '채팅 · 관리자', {}, { chatRole: 'admin' })
  add('chat-employee', '채팅 · 사원', {}, { chatRole: 'employee' })
  return cases.map(item => ({ ...item, settings: { ...item.settings, permissionGrants: casePermissionGrants(item.id, path, real.companyId ?? '', item.settings.capabilities) } }))
}

/** API 조회 결과를 캐시에 덮어쓰지 않고 화면에만 적용한다. 실제 저장은 원래 권한으로 검사한다. */
export function previewUsageAccess<T extends { canEdit: boolean; canManage: boolean }>(actual: T, mode?: PreviewFacts['usageAccess']): T {
  return mode ? { ...actual, canEdit: mode !== 'viewer', canManage: mode === 'manager' } : actual
}
