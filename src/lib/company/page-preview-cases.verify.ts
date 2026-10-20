import assert from 'node:assert/strict'
import { pagePreviewCases } from './page-preview-cases.ts'
import { resolveWorkRequestViewRole, WORK_REQUEST_OWNERS } from '../../features/work-requests/work-request-form-config.ts'
import { canAccessOperationsSupport, canEditOrgAssignment, canViewDraftsByOwner, isCompanyManager } from './capabilities.ts'
import type { Profile } from '../supabase/profiles'

const real = { id: 'dev', email: 'dev@atelier.local', isAdmin: true, memberships: [{ brandId: 'brand', isLead: true }] } as Profile
for (const owner of WORK_REQUEST_OWNERS) {
  const cases = pagePreviewCases(`/work-requests/${owner}`, real)
  assert.deepEqual(cases.map(item => item.id), ['manager', 'employee', 'requester'])
  for (const item of cases) {
    const profile = item.settings
    assert.equal(resolveWorkRequestViewRole(owner, profile.departmentName, profile.position, profile.capabilities), item.id)
    assert.equal(profile.isAdmin, false, '개발자 관리자 설정을 물려받지 않음')
  }
}
assert.deepEqual(pagePreviewCases('/drafts', real).map(item => canViewDraftsByOwner(item.settings)), [true, false])
assert.deepEqual(pagePreviewCases('/operations-support', real).map(item => canEditOrgAssignment(item.settings)), [true, false, false])
assert.deepEqual(pagePreviewCases('/operations-support', real).map(item => canAccessOperationsSupport(item.settings)), [true, false, true])
assert.deepEqual(pagePreviewCases('/work', real).map(item => item.id), ['employee', 'manager', 'unassigned'])
assert.equal(pagePreviewCases('/work', real)[1].settings.position, '팀장')
assert.equal(pagePreviewCases('/work', real)[2].settings.departmentName, null)
const homeCases = pagePreviewCases('/settings/profile', real)
assert.deepEqual(homeCases.map(item => item.id), ['manager', 'employee'])
assert.deepEqual(homeCases.map(item => isCompanyManager(item.settings)), [true, false])
for (const path of ['/org-chart', '/products', '/drafts/new', '/design/styled-cuts']) {
  assert.equal(pagePreviewCases(path, real).length, 0, `${path}: 역할 분기 없음`)
}
assert.equal(pagePreviewCases('/drafts/', real).length, 2)
console.log('page-preview-cases verify: ok')
