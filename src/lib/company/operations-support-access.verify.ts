import assert from 'node:assert/strict'
import { canAccessOperationsSupport, canViewOperationsSupportPart, canEditOrgAssignment, canManagePersonnel, canReviewMember, canViewDraftsByOwner, canViewMembers } from './capabilities.ts'
import { companyNavGroupsForProfile } from '../../components/layout/company-workspace-nav.ts'
import type { PermissionCode } from './permissions.ts'
import { RELEASE_COMPANY_ID, RELEASE_OPERATIONS_ID } from './release-access.ts'
import { OPERATIONS_SECTIONS, canViewOperationsSection, canViewPeopleMembers, canViewPeopleOrg, defaultOperationsSection, legacyOperationsHref, operationsSectionFromPath } from '../../features/operations-support/operations-support-sections.ts'

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
const opsLinks = (profile: Parameters<typeof companyNavGroupsForProfile>[0]) => links(profile).filter(href => href.startsWith('/operations-support') || href === '/settings/permissions')
assert.deepEqual(opsLinks(member),[])
assert.deepEqual(opsLinks(assigned('attendance.manage')),[],'기존 작업 권한이 있어도 타 부서에는 아직 미공개')
assert.deepEqual(opsLinks(assigned('personnel.manage')),[])
const operations = {...member,companyId:RELEASE_COMPANY_ID,departmentId:RELEASE_OPERATIONS_ID}
assert.deepEqual(opsLinks(operations),['/operations-support/people','/settings/permissions'],'운영지원 공개 화면: 관리 권한 없이는 조직·멤버와 권한·담당자만')
const opsManager = {...operations,permissionGrants:[{ permission:'attendance.manage' as const, scopeKind:'company' as const, scopeId:RELEASE_COMPANY_ID }]}
assert.deepEqual(opsLinks(opsManager),['/operations-support/attendance','/operations-support/leave','/operations-support/people','/settings/permissions','/operations-support/settings'],'지정 관리자는 운영지원 메뉴 전체')
for (const section of OPERATIONS_SECTIONS.map(item => item.id)) assert.equal(canViewOperationsSection(operations,section),section === 'people',`운영지원 소속만으로 ${section} 진입 불가`)
assert.equal(canViewPeopleOrg(operations) && canViewPeopleMembers(operations),true,'운영지원은 조직도와 멤버 탭을 본다')
assert.equal(defaultOperationsSection(operations),'people')
assert.equal(defaultOperationsSection(assigned('attendance.manage')),'attendance')
assert.equal(defaultOperationsSection(null),'people')
assert.equal(legacyOperationsHref('?part=org&orgView=new','attendance'),'/operations-support/people?orgView=new')
assert.equal(legacyOperationsHref('?part=attendance&attendanceView=holiday&holidayMonth=2026-11','people'),'/operations-support/attendance?attendanceView=holiday&holidayMonth=2026-11')
assert.equal(legacyOperationsHref('?part=attendance&attendanceView=settings','people'),'/operations-support/settings?settingsView=hours')
assert.equal(legacyOperationsHref('?part=attendance&attendanceView=exemptions','people'),'/operations-support/settings?settingsView=exemptions')
assert.equal(legacyOperationsHref('?part=leave&leaveView=balance','people'),'/operations-support/leave?leaveView=balance')
assert.equal(legacyOperationsHref('?part=notices','people'),'/operations-support/settings?settingsView=notices')
assert.equal(legacyOperationsHref('?part=hours','people'),'/operations-support/settings?settingsView=hours')
assert.equal(legacyOperationsHref('?part=documents','attendance'),'/operations-support/attendance','숨긴 서류 출력은 기본 업무로')
assert.equal(legacyOperationsHref('','people'),'/operations-support/people')
assert.equal(operationsSectionFromPath('/operations-support/leave/'),'leave')
assert.equal(operationsSectionFromPath('/operations-support/unknown'),null)
assert.equal(operationsSectionFromPath('/settings/permissions'),null)
assert.equal(canAccessOperationsSupport(operations),false,'공개 화면 설정이 실제 업무 권한을 부여하지 않음')
assert.equal(canViewOperationsSupportPart(operations,'org'),true,'운영지원은 관리 권한 없이도 조직도에 진입')
assert.equal(canEditOrgAssignment(operations),false,'조직도 진입이 편집 권한을 만들지 않음')
assert.equal(canManagePersonnel(operations),false,'직원 관리 권한은 유지')
assert.equal(canViewMembers(operations),true,'운영지원 부서원은 멤버 목록을 본다')
assert.equal(canReviewMember(operations,'pending'),true,'운영지원 부서원은 대기 신청을 승인한다')
for (const position of [null, '사원', '팀장', '이사']) {
  assert.equal(canReviewMember({...operations,position},'pending'),true,'운영지원은 직책·개인 지정 권한 없이 대기 신청을 승인한다')
  assert.equal(canReviewMember({...operations,position},'active'),false,'가입 승인 권한이 기존 재직자 관리 권한을 만들지 않는다')
}
assert.equal(canReviewMember(operations,'active'),false,'운영지원 소속만으로 재직 계정을 관리하지 않음')
assert.equal(canReviewMember({...operations,status:'pending'},'pending'),false,'비활성 계정은 승인하지 못함')
assert.equal(canReviewMember(member,'pending'),false,'다른 소속은 대기 승인을 받지 않음')
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
