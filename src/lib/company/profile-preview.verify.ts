import assert from 'node:assert/strict'
import type { Profile } from '../supabase/profiles'
import { canPreviewProfile, initialPreview, previewDepartment, previewProfile } from './profile-preview.ts'
import { canEditOrgAssignment, canManagePersonnel, canViewDraftsByOwner, hasCapability } from './capabilities.ts'

const real = { id: 'developer-id', email: 'dev@atelier.local', status: 'active', isAdmin: true, position: '팀장', departmentId: 'ops', departmentName: '운영지원팀', departmentPersonnelScope: 'leaders', capabilities: ['planning'], memberships: [{ brandId: 'brand', isLead: true }] } as Profile
assert.equal(canPreviewProfile(real, real.email), true)
assert.equal(canPreviewProfile({ ...real, email: 'staff@example.com' }, real.email), false)
assert.equal(canPreviewProfile(real, 'staff@example.com'), false)
assert.equal(canPreviewProfile({ ...real, status: 'disabled' }, real.email), false)
const settings = { ...initialPreview(real), position: '사원', isAdmin: false, ...previewDepartment({ id: 'planning', name: '기획팀', personnelScope: null } as never) }
const employee = previewProfile(real, settings)
assert.equal(employee.id, real.id)
assert.equal(canEditOrgAssignment(employee), false, '개발자 이메일 예외를 일반 직원에게 적용하지 않음')
assert.equal(canViewDraftsByOwner(employee), false)
assert.equal(hasCapability(employee, 'planning'), true)
assert.equal(hasCapability(employee, 'md'), false)
assert.equal(canViewDraftsByOwner(previewProfile(real, { ...settings, position: '팀장' })), true)
const support = { ...settings, ...previewDepartment({ id: 'ops', name: '운영지원팀', personnelScope: 'leaders' } as never) }
assert.equal(canEditOrgAssignment(previewProfile(real, support)), true)
assert.equal(canManagePersonnel(previewProfile(real, support)), false)
assert.equal(canManagePersonnel(previewProfile(real, { ...support, position: '팀장' })), true)
assert.equal(real.isAdmin, true)
assert.equal(real.email, 'dev@atelier.local')
assert.equal(real.departmentId, 'ops')

console.log('profile-preview verify: ok')
