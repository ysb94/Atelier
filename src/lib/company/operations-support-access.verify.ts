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
assert.equal(links(member).includes('/operations-support'), true)
assert.equal(links({...member,departmentName:'기획팀'}).includes('/operations-support'), false)
assert.equal(links({...member,departmentName:'기획팀',isAdmin:true}).includes('/operations-support'), false)
assert.equal(links({...member,departmentName:'기획팀',isAdmin:true}).includes('/members'), true, '운영지원 화면과 인사 관리 권한을 별도로 유지')
assert.equal(links({...member,departmentName:'기획팀'}).includes('/org-chart'), true, '회사 조직도 메뉴 유지')
const reviewer = {...member,departmentName:'운영진',position:'대표이사'}
assert.equal(canAccessOperationsSupport(reviewer), true)
assert.equal(canEditOrgAssignment(reviewer), false, '조회와 조직 수정 분리')
assert.equal(canManagePersonnel(reviewer), false, '인사 승인 권한을 추가하지 않음')
assert.equal(canViewDraftsByOwner(reviewer), true)
assert.equal(links(reviewer).includes('/operations-support'), true)
assert.equal(links(reviewer).includes('/members'), true)
assert.equal(canAccessOperationsSupport({...reviewer,status:'disabled'}), false)
assert.equal(canAccessOperationsSupport({...reviewer,status:'pending'}), false)
console.log('operations support access verify: ok')
