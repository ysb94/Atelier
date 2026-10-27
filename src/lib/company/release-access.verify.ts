import assert from 'node:assert/strict'
import { RELEASE_COMPANY_ID, RELEASE_DEPARTMENT_SITES, RELEASE_EXCEPTION_IDS, RELEASE_HOME, RELEASE_LOGISTICS_ID, RELEASE_LOGISTICS_PAGES, RELEASE_OPERATIONS_ID, releaseAccess, releaseHref, releasePersonalPart } from './release-access.ts'
import { companyNavGroupsForProfile, companyTopNavForProfile } from '../../components/layout/company-workspace-nav.ts'
const staff = { id:'employee',companyId:RELEASE_COMPANY_ID,status:'active',departmentId:'other',email:'staff@invalid' }
const ops = {...staff,departmentId:RELEASE_OPERATIONS_ID}
const logistics = {...staff,departmentId:RELEASE_LOGISTICS_ID}
const links = (profile: typeof staff) => [...companyTopNavForProfile(profile),...companyNavGroupsForProfile(profile).flatMap(group=>group.items)].map(item=>item.to)
assert.deepEqual(links(staff),[RELEASE_HOME])
assert.equal(releaseHref(staff,'/settings/profile?part=meetings'),'/settings/profile?part=meetings')
assert.equal(releaseHref(staff,'/settings/profile?part=approvals'),null)
assert.equal(releaseHref(staff,'/settings/profile?part=approvals',true),'/settings/profile?part=approvals')
assert.equal(releasePersonalPart(staff,'overtime'),true,'야근은 직원 본인 화면')
assert.equal(releasePersonalPart(staff,'work'),true,'전 직원 작업 요청 입구')
for(const part of ['profile','attendance','company-notice','department-notice']) assert.equal(releasePersonalPart(staff,part,true),false)
for(const path of ['/','/operations','/products','/data/all','/drafts','/settings/access-ip','/brands','/settings/ai','/org-chart']) assert.equal(releaseHref(staff,path),null)
for(const path of ['/operations-support','/members','/settings/permissions']) { assert.ok(links(ops).includes(path)); assert.equal(releaseHref(logistics,path),null) }
for(const path of RELEASE_LOGISTICS_PAGES) { assert.ok(links(logistics).includes(path)); assert.equal(releaseHref(staff,path),path.startsWith('/work-requests/')?path:null); assert.equal(releaseHref(ops,path),path.startsWith('/work-requests/')?path:null) }
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
for (const site of RELEASE_DEPARTMENT_SITES) {
  const member = {...staff,departmentId:site.id}
  assert.ok(companyNavGroupsForProfile(member).some(group=>group.title===site.title),site.title+' 부서 탭')
  for (const target of RELEASE_DEPARTMENT_SITES) for (const path of target.pages) {
    assert.equal(releaseHref(member,path),target.id===site.id||path.startsWith('/work-requests/')?path:null,'타부서 화면 공개 방지: '+site.title+' → '+path)
  }
  assert.equal(releaseHref({...member,status:'disabled'},site.pages[0]??'/drafts'),null)
  assert.equal(releaseHref({...member,companyId:'other-company'},site.pages[0]??'/drafts'),null)
}
for (const [departmentName,title] of [
  ['운영진','운영진'],['Contents Team','Contents'],['Global Online','Global Online'],['Visual Team','Visual'],
  ['B2B 사업팀','B2B 사업'],['OFF LINE TEAM','OFF LINE'],['CHINA','CHINA'],['마케팅팀','마케팅'],
]) {
  const member={...staff,departmentName}
  assert.deepEqual(companyNavGroupsForProfile(member),[{title,items:[]}],'전용 화면이 없는 부서는 자기 부서 준비 중 탭')
  assert.deepEqual(links(member),[RELEASE_HOME])
  assert.deepEqual(companyNavGroupsForProfile({...member,status:'pending'}),[])
  assert.deepEqual(companyNavGroupsForProfile({...member,companyId:'other-company'}),[])
}
const md={...staff,departmentId:RELEASE_DEPARTMENT_SITES.find(site=>site.title==='MD')!.id}
assert.equal(releaseHref(md,'/products/atelier/M%2F1?brand=atelier'),'/product-work/md/atelier/M%2F1?brand=atelier')
assert.equal(releaseHref(md,'/md?brand=atelier'),'/product-work/md?brand=atelier')
assert.equal(releaseHref(md,'/product-work/md-malicious'),null)
const visual={...staff,departmentId:'7ac8b7a8-7f12-4f3e-a371-d2dac7e492f1'}
for (const path of ['/work-requests/design','/design/styled-cuts','/design/file-manager']) {
  assert.equal(releaseHref(visual,path),path,'Visual 팀은 자기 메뉴를 연다')
  assert.equal(releaseHref(staff,path),path.startsWith('/work-requests/')?path:null)
}
assert.deepEqual(companyNavGroupsForProfile(visual).find(group=>group.title==='Visual')?.items.map(item=>item.to),['/work-requests/design','/design/styled-cuts','/design/file-manager'])
assert.equal(releaseHref(visual,'/drafts'),null,'Visual 팀은 기획 화면을 열지 않는다')
assert.equal(releaseHref({...staff,departmentId:RELEASE_DEPARTMENT_SITES.find(site=>site.title==='기획')!.id},'/work-requests/planning-malicious'),null)
assert.equal(releaseHref({...staff,departmentId:RELEASE_DEPARTMENT_SITES.find(site=>site.title==='중국팀')!.id},'/china/work-orders-malicious'),null)
console.log('release-access: 자기 부서 메뉴·준비 중 탭·타부서 차단·부서 UUID·직원/승인자·예외 3계정·직접 주소·상세 경로·업무 권한 분리 통과')
