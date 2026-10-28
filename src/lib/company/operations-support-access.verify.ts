import assert from 'node:assert/strict'
import { canAccessOperationsSupport, canViewOperationsSupportPart, canEditOrgAssignment, canManagePersonnel, canViewDraftsByOwner, canViewMembers } from './capabilities.ts'
import { companyNavGroupsForProfile } from '../../components/layout/company-workspace-nav.ts'
import type { PermissionCode } from './permissions.ts'
import { RELEASE_COMPANY_ID, RELEASE_OPERATIONS_ID } from './release-access.ts'

const member = { companyId: 'company', status: 'active', email: 'staff@invalid', departmentName: '운영지원팀', position: '사원', isAdmin: false, permissionGrants: [] }
const assigned = (...permissions: PermissionCode[]) => ({ ...member, permissionGrants: permissions.map(permission => ({ permission, scopeKind: 'company' as const, scopeId: 'company' })) })
const links = (profile: Parameters<typeof companyNavGroupsForProfile>[0]) => companyNavGroupsForProfile(profile).flatMap(group => group.items.map(item => item.to))
assert.equal(canAccessOperationsSupport(member),false,'운영지원 소속만으로 권한이 생기지 않음')
assert.equal(canAccessOperationsSupport({...member,email:'dev@atelier.local',position:'대표이사',isAdmin:true}),false,'직책·이메일·과거 관리자 예외 없음')
assert.equal(canAccessOperationsSupport(assigned('attendance.manage')),true)
assert.equal(canAccessOperationsSupport(assigned('notice.company.delete')),true,'삭제 전담자도 기능 진입')
assert.equal(canEditOrgAssignment(assigned('org.manage')),true)
assert.equal(canManagePersonnel(assigned('org.manage')),false,'조직과 인사 승인 분리')
assert.equal(canManagePersonnel(assigned('personnel.manage')),true)
assert.equal(canViewMembers(assigned('org.manage')),true,'조직 관리 담당은 멤버 조회 가능')
assert.equal(canViewMembers(assigned('personnel.manage')),true)
assert.equal(canViewMembers(member),false,'운영지원 소속만으로 조회 권한이 생기지 않음')
assert.equal(canViewDraftsByOwner(assigned('company.review')),false,'현황 조회가 기획안 권한을 자동 생성하지 않음')
assert.equal(canViewDraftsByOwner(assigned('drafts.read')),true)
assert.equal(links(member).includes('/operations-support'),false)
assert.equal(links(assigned('attendance.manage')).includes('/operations-support'),false,'기존 작업 권한이 있어도 타 부서에는 아직 미공개')
assert.equal(links(assigned('personnel.manage')).includes('/members'),false)
const operations = {...member,companyId:RELEASE_COMPANY_ID,departmentId:RELEASE_OPERATIONS_ID}
for (const href of ['/operations-support','/members','/settings/permissions']) assert.ok(links(operations).includes(href),'운영지원 공개 화면')
assert.equal(canAccessOperationsSupport(operations),false,'공개 화면 설정이 실제 업무 권한을 부여하지 않음')
assert.equal(canViewOperationsSupportPart(operations,'org'),true,'운영지원은 관리 권한 없이도 조직도에 진입')
assert.equal(canEditOrgAssignment(operations),false,'조직도 진입이 편집 권한을 만들지 않음')
assert.equal(canManagePersonnel(operations),false,'직원 관리 권한은 유지')
for (const part of ['attendance','leave','documents','hours','notices']) {
  assert.equal(canViewOperationsSupportPart(operations,part),false,'운영지원 소속만으로 다른 관리 화면을 열지 않음')
  assert.equal(canViewOperationsSupportPart(assigned('org.manage'),part),true,'기존 지정 관리자의 진입 유지')
}
for (const denied of [null,member,{...operations,status:'pending'},{...operations,status:'disabled'},{...operations,companyId:'other-company'},{...operations,departmentId:'other-department'}]) {
  assert.equal(canViewOperationsSupportPart(denied,'org'),false,'이름·직책·다른 회사·비활성 계정으로 조직도 진입 불가')
}
assert.equal(links(assigned('system.manage')).includes('/settings/permissions'),false,'시스템 운영과 권한 지정 관리 분리')
assert.equal(canAccessOperationsSupport({...assigned('org.manage'),status:'disabled'}),false)
assert.equal(canAccessOperationsSupport(null),false)
console.log('operations-support-access: 명시적 지정·기능 분리·메뉴 접근 검증 통과')
