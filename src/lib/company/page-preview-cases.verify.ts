import assert from 'node:assert/strict'
import { pagePreviewCases } from './page-preview-cases'
import { previewProfile } from './profile-preview'
import { resolveWorkRequestViewRole, WORK_REQUEST_OWNERS } from '../../features/work-requests/work-request-form-config'
import type { Profile } from '../supabase/profiles'
const real={id:'real-user',companyId:'company',email:'real@invalid',status:'active',departmentId:'real-department',departmentName:'디자인팀',capabilities:[],memberships:[]} as unknown as Profile
const snapshot=JSON.stringify(real)
for(const owner of WORK_REQUEST_OWNERS){
 const cases=pagePreviewCases('/work-requests/'+owner,real)
 assert.deepEqual(cases.map(item=>item.label),['전체 관리','해당 부서 · 일반','해당 부서 · 담당자','타부서 · 일반','타부서 · 담당자'])
 const expected={all:'manager',employee:'employee',manager:'manager','other-employee':'requester','other-manager':'manager'}
 for(const item of cases){
  const p=previewProfile(real,item.settings)
  assert.equal(resolveWorkRequestViewRole(owner,p.departmentName,p.position,p.capabilities,p),expected[item.id as keyof typeof expected],owner+':'+item.id)
  assert.equal(p.id,real.id,'로그인 사용자 ID로만 조회')
  assert.equal(p.position,'사원','직책 변경으로 담당자 화면을 만들지 않음')
  assert.equal(p.jobGrade,'사원')
 }
 const cross=cases.find(item=>item.id==='other-manager')!
 const different=WORK_REQUEST_OWNERS.find(item=>item!==owner)!
 const p=previewProfile(real,cross.settings)
 assert.notEqual(resolveWorkRequestViewRole(different,p.departmentName,p.position,[],p),'manager','타부서 담당자도 지정한 업무의 범위만 표시')
}
for(const path of ['/settings/ai','/drafts','/org-chart','/meetings']){
 const items=pagePreviewCases(path,real)
 assert.deepEqual(items.map(item=>item.label),['일반','담당자'],'부서 차이가 없는 화면은 타부서 버튼을 중복 표시하지 않음')
}
assert.equal(pagePreviewCases('/schedule',real).length,0,'표시 차이가 없는 화면은 역할 버튼 없음')
assert.equal(JSON.stringify(real),snapshot)
console.log('page-preview-cases: 공통 5가지 기준·직책 독립·타부서 담당 범위·화면별 버튼 축소·실제 프로필 보존 통과')
