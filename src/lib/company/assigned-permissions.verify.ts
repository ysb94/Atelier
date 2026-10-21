import assert from 'node:assert/strict'
import { hasPermission, type PermissionGrant, type PermissionCode } from './permissions'
import { canManagePersonnel, canEditOrgAssignment, canViewDraftsByOwner, isCompanyManager, isCompanyReviewer, hasCapability, brandStorageRoot, inferCapabilityFromDepartment, uniqueCapabilities } from './capabilities'
import { resolveWorkRequestViewRole } from '../../features/work-requests/work-request-form-config'
import { canPreviewProfile, initialPreview, previewProfile } from './profile-preview'
import type { Profile } from '../supabase/profiles'
import { hasAssignedPermission } from '../../../supabase/functions/_shared/assigned-permission'

const companyId = 'company-a'
const base = { id: 'employee', email: 'employee@invalid', status: 'active', companyId, position: '사원', jobGrade: '사원', departmentName: '디자인팀', departmentId: 'design', departmentPersonnelScope: null, isAdmin: false, capabilities: [], memberships: [], permissionGrants: [] } as unknown as Profile
const grants = (...permissions: PermissionCode[]): PermissionGrant[] => permissions.map(permission => ({ permission, scopeKind: 'company', scopeId: companyId }))
const enabled = { ...base, permissionGrants: grants('work.manage','org.manage','personnel.manage','drafts.read','company.review','preview.use','data.planning') }
for (const position of ['사원','팀장','이사','대표이사']) for (const jobGrade of ['사원','과장','부장']) {
  const plain = { ...base, position, jobGrade, email: 'dev@atelier.local', isAdmin: true, departmentName: '운영지원팀', departmentPersonnelScope: 'members' as const }
  for (const check of [isCompanyManager,canManagePersonnel,canEditOrgAssignment,canViewDraftsByOwner,isCompanyReviewer]) assert.equal(check(plain),false,'직책·직급·이메일·소속·기존 관리자 값으로 자동 권한 금지')
  const allowed = { ...enabled, position, jobGrade }
  for (const check of [isCompanyManager,canManagePersonnel,canEditOrgAssignment,canViewDraftsByOwner,isCompanyReviewer]) assert.equal(check(allowed),true,'지정 권한은 직책과 무관')
}
const scoped = { ...base, permissionGrants: [{ permission: 'work.manage', scopeKind: 'department', scopeId: 'design', scopeName: '디자인팀' }] as PermissionGrant[] }
assert.equal(hasPermission(scoped,'work.manage','department','design'),true)
assert.equal(hasPermission(scoped,'work.manage','department','logistics'),false)
assert.equal(hasPermission(scoped,'work.manage','department',null),false,'대상이 없으면 임의로 전체 범위를 허용하지 않음')
assert.equal(hasPermission({ ...enabled, status:'disabled' },'org.manage'),false)
assert.equal(hasPermission({ ...enabled, companyId:'company-b' },'org.manage'),false)
assert.equal(resolveWorkRequestViewRole('design','물류','사원',[],scoped),'manager','다른 부서 사원도 지정한 디자인 업무를 관리')
assert.equal(resolveWorkRequestViewRole('logistics','디자인팀','팀장',[],scoped),'requester','미지정 다른 업무 관리 불가')
assert.equal(resolveWorkRequestViewRole('design','디자인팀','대표이사',[],base),'employee','대표도 지정 없으면 업무 관리자 아님')
assert.equal(hasCapability(enabled,'planning'),true)
assert.equal(hasCapability(enabled,'md'),false)
assert.equal(canPreviewProfile(enabled,enabled.email),true)
assert.equal(canPreviewProfile(enabled,'different@invalid'),false)
assert.equal(canPreviewProfile(base,base.email),false)
const settings = initialPreview(enabled)
settings.permissionGrants = grants('basic.use')
const display = previewProfile(enabled,settings)
assert.equal(display.id,enabled.id,'표시 테스트는 타인 ID로 조회하지 않음')
assert.equal(canEditOrgAssignment(display),false,'실제 계정 권한이 표시 프로필에 섞이지 않음')
assert.equal(canEditOrgAssignment(enabled),true,'실제 프로필 유지')
assert.equal(inferCapabilityFromDepartment('VisualTeam'),'design')
assert.deepEqual(uniqueCapabilities(['md','x','md']),['md'])
assert.equal(brandStorageRoot('atelier'),'masmarulez')
assert.equal(brandStorageRoot('new-brand'),'new-brand')
assert.equal(hasAssignedPermission(grants('data.design'),'data.design',companyId,'brand','brand-a'),true)
assert.equal(hasAssignedPermission([{permission:'data.design',scopeKind:'brand',scopeId:'brand-a'}],'data.design',companyId,'brand','brand-a'),true)
assert.equal(hasAssignedPermission([{permission:'data.design',scopeKind:'brand',scopeId:'brand-b'}],'data.design',companyId,'brand','brand-a'),false)
assert.equal(hasAssignedPermission([{permission:'system.manage',scopeKind:'company',scopeId:companyId}],'data.design',companyId,'brand','brand-a'),false,'시스템 운영도 이미지 권한을 자동으로 주지 않음')
assert.equal(hasAssignedPermission(null,'data.design',companyId,'brand','brand-a'),false)
console.log('assigned-permissions: 지정 권한·직책 독립·대상 범위·기본 차단·표시 테스트 격리·기존 공통 유틸리티 통과')
