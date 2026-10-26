import assert from 'node:assert/strict'
import { RELEASE_COMPANY_ID, RELEASE_EXCEPTION_IDS, RELEASE_HOME, RELEASE_LOGISTICS_ID, RELEASE_LOGISTICS_PAGES, RELEASE_OPERATIONS_ID, releaseAccess, releaseHref, releasePersonalPart } from './release-access.ts'
import { companyNavGroupsForProfile, companyTopNavForProfile } from '../../components/layout/company-workspace-nav.ts'
const staff = { id:'employee',companyId:RELEASE_COMPANY_ID,status:'active',departmentId:'other',email:'staff@invalid' }
const ops = {...staff,departmentId:RELEASE_OPERATIONS_ID}
const logistics = {...staff,departmentId:RELEASE_LOGISTICS_ID}
const links = (profile: typeof staff) => [...companyTopNavForProfile(profile),...companyNavGroupsForProfile(profile).flatMap(group=>group.items)].map(item=>item.to)
assert.deepEqual(links(staff),[RELEASE_HOME])
assert.equal(releaseHref(staff,'/settings/profile?part=meetings'),'/settings/profile?part=meetings')
assert.equal(releaseHref(staff,'/settings/profile?part=approvals'),null)
assert.equal(releaseHref(staff,'/settings/profile?part=approvals',true),'/settings/profile?part=approvals')
for(const part of ['work','profile','attendance','company-notice','department-notice']) assert.equal(releasePersonalPart(staff,part,true),false)
for(const path of ['/','/operations','/products','/data/all','/drafts','/settings/access-ip','/brands','/settings/ai','/org-chart']) assert.equal(releaseHref(staff,path),null)
for(const path of ['/operations-support','/members','/settings/permissions']) { assert.ok(links(ops).includes(path)); assert.equal(releaseHref(logistics,path),null) }
for(const path of RELEASE_LOGISTICS_PAGES) { assert.ok(links(logistics).includes(path)); assert.equal(releaseHref(staff,path),null); assert.equal(releaseHref(ops,path),null) }
assert.equal(releaseHref(logistics,'/products/atelier/M%2F1?brand=atelier'),'/product-work/logistics/atelier/M%2F1?brand=atelier')
assert.equal(releaseHref(logistics,'/logistics/invoice-data-entry?brand=atelier'),'/logistics/invoices?brand=atelier')
assert.equal(releaseHref(logistics,'/work-requests/logistics-malicious'),null)
assert.equal(releaseHref(logistics,'/logistics/finder-malicious'),null)
assert.equal(releaseHref(staff,'/chat/room/room-id'),'/chat/room/room-id')
assert.equal(releaseHref(staff,'/meetings?meeting=one'),'/settings/profile?meeting=one&part=meetings')
for(const href of ['https://attacker.invalid/','//attacker.invalid/','javascript:alert(1)']) assert.equal(releaseHref(staff,href),null)
for(const id of RELEASE_EXCEPTION_IDS) {
  const owner = {...staff,id}
  for(const path of ['/','/data/all','/drafts','/settings/profile?part=work']) assert.equal(releaseHref(owner,path),path)
  assert.equal(releaseAccess({...owner,status:'disabled'}).unrestricted,false)
  assert.equal(releaseAccess({...owner,companyId:'other'}).unrestricted,false)
  assert.equal(releaseAccess({...owner,email:'ui-preview@example.invalid'}).unrestricted,false)
}
assert.equal(releaseAccess({...staff,email:'dev@atelier.local',isAdmin:true,position:'대표이사'} as typeof staff).unrestricted,false,'이메일·관리자·직책으로 예외를 만들지 않음')
assert.equal(releaseAccess({...staff,departmentName:'운영지원팀'} as typeof staff).operations,false,'부서 이름이 아닌 지정 UUID')
console.log('release-access: 직원·승인자·부서·예외 3계정·메뉴·직접 주소·상세 경로·비공개 링크·업무 권한 분리 통과')
