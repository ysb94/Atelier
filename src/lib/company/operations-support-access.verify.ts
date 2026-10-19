import assert from 'node:assert/strict'
import { canAccessOperationsSupport, canEditOrgAssignment, canManagePersonnel, canViewDraftsByOwner } from './capabilities.ts'
import { companyNavGroupsForProfile } from '../../components/layout/company-workspace-nav.ts'

const member = { status: 'active', email: 'staff@example.com', departmentName: '운영지원팀', position: '사원', isAdmin: false }
assert.equal(canAccessOperationsSupport(member), true)
assert.equal(canAccessOperationsSupport({...member,departmentName:'기획팀'}), false)
assert.equal(canAccessOperationsSupport({...member,departmentName:'물류팀',position:'팀장',isAdmin:true}), false)
assert.equal(canAccessOperationsSupport({...member,departmentName:null}), false)
assert.equal(canAccessOperationsSupport({...member,departmentName:'물류팀',email:'dev@atelier.local'}), true)
assert.equal(canAccessOperationsSupport({...member,status:'pending'}), false)
assert.equal(canAccessOperationsSupport({...member,status:'disabled',email:'dev@atelier.local'}), false)
assert.equal(canAccessOperationsSupport(null), false)
const links = (profile: Parameters<typeof companyNavGroupsForProfile>[0]) => companyNavGroupsForProfile(profile).flatMap(group=>group.items.map(item=>item.to))
const menuGroup = (profile: Parameters<typeof companyNavGroupsForProfile>[0], to: string) =>
  companyNavGroupsForProfile(profile).find((group) => group.items.some((item) => item.to === to))?.title
const personnelAdmin = {...member,departmentName:'기획팀',isAdmin:true}
assert.equal(links(member).includes('/operations-support'), true)
assert.equal(links({...member,departmentName:'기획팀'}).includes('/operations-support'), false)
assert.equal(links(personnelAdmin).includes('/operations-support'), false)
assert.equal(links(personnelAdmin).includes('/members'), true, '운영지원 화면과 인사 관리 권한을 별도로 유지')
assert.equal(menuGroup(personnelAdmin, '/members'), '운영지원', '멤버·권한은 운영지원 메뉴에 둔다')
assert.equal(menuGroup(personnelAdmin, '/org-chart'), '회사', '회사 메뉴에는 멤버·권한을 두지 않는다')
assert.equal(links({...member,departmentName:'기획팀'}).includes('/org-chart'), true, '회사 조직도 메뉴 유지')
assert.equal(links(member).includes('/members'), false, '운영지원 소속만으로 멤버·권한 메뉴를 열지 않는다')
const reviewer = {...member,departmentName:'운영진',position:'대표이사'}
assert.equal(canAccessOperationsSupport(reviewer), true)
assert.equal(canEditOrgAssignment(reviewer), false, '조회와 조직 수정 분리')
assert.equal(canManagePersonnel(reviewer), false, '인사 승인 권한을 추가하지 않음')
assert.equal(canViewDraftsByOwner(reviewer), true)
assert.equal(links(reviewer).includes('/operations-support'), true)
assert.equal(links(reviewer).includes('/members'), true)
assert.equal(menuGroup(reviewer, '/members'), '운영지원')
assert.equal(menuGroup(reviewer, '/operations-support'), '운영지원')
assert.equal(canAccessOperationsSupport({...reviewer,status:'disabled'}), false)
assert.equal(canAccessOperationsSupport({...reviewer,status:'pending'}), false)
console.log('operations support access verify: ok')
