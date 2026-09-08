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
