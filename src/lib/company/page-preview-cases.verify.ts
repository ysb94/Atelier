import assert from 'node:assert/strict'
import { pagePreviewCases } from './page-preview-cases'
import { completePagePreviewCases } from './page-preview-coverage'
import { previewProfile } from './profile-preview'
import { resolveWorkRequestViewRole, WORK_REQUEST_OWNERS } from '../../features/work-requests/work-request-form-config'
import type { Profile } from '../supabase/profiles'
const real={id:'real-user',companyId:'company',email:'real@invalid',status:'active',memberships:[]} as unknown as Profile
for(const owner of WORK_REQUEST_OWNERS) {
 const cases=completePagePreviewCases('/work-requests/'+owner,real).filter(item=>!item.facts?.chatRole)
 assert.deepEqual(cases.map(item=>item.id),['manager','employee','requester'])
 for(const item of cases) {
  const profile=previewProfile(real,item.settings)
  assert.equal(resolveWorkRequestViewRole(owner,profile.departmentName,profile.position,profile.capabilities,profile),item.id)
  assert.equal(profile.id,real.id)
  assert.ok(profile.permissionGrants?.length)
 }
}
assert.deepEqual(pagePreviewCases('/settings/profile',real).map(item=>item.id),['manager','employee'])
for(const path of ['/org-chart','/products','/drafts/new','/design/styled-cuts']) assert.equal(pagePreviewCases(path,real).length,0)
console.log('page-preview-cases: 사례별 명시 권한·업무 배정·본인 ID 보존 통과')
