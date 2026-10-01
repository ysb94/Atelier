/**
 * 회사 역량·브랜드 저장 경로 검증.
 * 실행: npx tsx src/lib/company/capabilities.verify.ts
 */
import {
  brandStorageRoot,
  canEditBrandData,
  hasAnyCapability,
  hasCapability,
  inferCapabilityFromDepartment,
  canEditOrgAssignment,
  canManagePersonnel,
  canViewDraftsByOwner,
  isCompanyManager,
  uniqueCapabilities,
} from './capabilities'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

assert(
  inferCapabilityFromDepartment('VisualTeam') === 'design',
  'VisualTeam은 디자인 역량',
)
assert(
  inferCapabilityFromDepartment('기획팀') === 'planning',
  '기획팀은 기획 역량',
)
assert(inferCapabilityFromDepartment('MD Team') === 'md', 'MD Team은 MD 역량')
assert(uniqueCapabilities(['md', 'md', 'x']).join(',') === 'md', '역량 중복 제거')

const employee = {
  status: 'active' as const,
  isAdmin: false,
  position: '사원',
  capabilities: ['planning'],
}
assert(hasCapability(employee, 'planning'), '기획 역량 있음')
assert(!hasCapability(employee, 'logistics'), '물류 역량 없음')
assert(canEditBrandData(employee, 'planning'), '기획은 수정 가능')
assert(!canEditBrandData(employee, 'logistics'), '물류는 수정 불가')
assert(hasAnyCapability(employee), '역량이 하나라도 있으면 쓰기 후보')

const manager = {
  status: 'active' as const,
  isAdmin: false,
  position: '팀장',
  capabilities: ['logistics'],
}
assert(isCompanyManager(manager), '팀장은 회사 관리자')
assert(!isCompanyManager(employee), '사원은 회사 관리자가 아님')
assert(
  canManagePersonnel({
    status: 'active',
    isAdmin: false,
    position: '팀장',
    departmentPersonnelScope: 'leaders',
  }),
  '직책 관리 부서의 팀장은 인사 담당',
)
assert(
  !canManagePersonnel({
    status: 'active',
    isAdmin: false,
    position: '사원',
    departmentPersonnelScope: 'leaders',
  }),
  '팀장·이사만 설정된 부서의 사원은 인사 담당이 아님',
)
assert(
  canManagePersonnel({
    status: 'active',
    isAdmin: false,
    position: '사원',
    departmentPersonnelScope: 'members',
  }),
  '소속 전원으로 설정된 부서의 사원은 인사 담당',
)
assert(
  !canManagePersonnel({
    status: 'active',
    isAdmin: false,
    position: '팀장',
    departmentPersonnelScope: null,
  }),
  '다른 팀 팀장은 인사 담당이 아님',
)
assert(
  !canManagePersonnel({
    status: 'pending',
    isAdmin: false,
    position: '팀장',
    departmentPersonnelScope: 'leaders',
  }),
  '승인 대기 중에는 인사 담당이 아님',
)
assert(
  canManagePersonnel({
    status: 'active',
    isAdmin: true,
    position: '사원',
    departmentPersonnelScope: null,
  }),
  '관리자는 인사 담당',
)
assert(
  canEditOrgAssignment({
    status: 'active',
    email: 'dev@atelier.local',
    departmentName: '물류팀',
  }),
  '개발자 계정은 조직 배치를 수정한다',
)
assert(
  canEditOrgAssignment({
    status: 'active',
    email: 'ops@example.com',
    departmentName: '운영지원팀',
    position: '사원',
  }),
  '운영지원팀 소속은 조직 배치를 수정한다',
)
assert(
  !canEditOrgAssignment({
    status: 'active',
    isAdmin: true,
    email: 'lead@example.com',
    departmentName: '물류팀',
    position: '팀장',
  }),
  '다른 관리자는 조직 배치를 수정하지 못한다',
)
assert(
  !canEditOrgAssignment({
    status: 'active',
    email: 'staff@example.com',
    departmentName: '기획팀',
    position: '팀장',
  }),
  '다른 팀 팀장은 조직 배치를 수정하지 못한다',
)
assert(canViewDraftsByOwner(manager), '팀장은 직원별 기획안을 본다')
assert(!canViewDraftsByOwner(employee), '사원은 직원별 기획안을 못 본다')
assert(
  !canViewDraftsByOwner({
    status: 'active',
    isAdmin: true,
    position: '사원',
    capabilities: [],
  }),
  '관리자여도 사원이면 직원별 기획안을 못 본다',
)

const admin = {
  status: 'active' as const,
  isAdmin: true,
  position: '사원',
  capabilities: [],
}
assert(hasCapability(admin, 'data'), '관리자는 모든 역량')
assert(canEditBrandData(admin, 'md'), '관리자는 전 영역 수정')

assert(brandStorageRoot('atelier') === 'masmarulez', 'ATELIER는 기존 R2 루트')
assert(brandStorageRoot('new-brand') === 'new-brand', '새 브랜드는 slug 루트')

console.log('company-capabilities.verify ok')
