import assert from 'node:assert/strict'
import { accessStatusLabel, inNewEmployeeView, newEmployeeRows } from './new-employee-access'
import { RELEASE_COMPANY_ID } from '@/lib/company/release-access'
import type { Profile } from '@/lib/supabase/profiles'
import type { OnboardingEmployee } from '@/lib/supabase/employee-onboarding'

const pending={id:'pending',companyId:RELEASE_COMPANY_ID,status:'pending',displayName:'검증 직원',email:'fixture@example.invalid',requestedAt:null,departmentId:null,position:null,jobGrade:null,hireDate:null} as Profile
const record={id:'case',profileId:pending.id,isTest:false,status:'active',displayName:'검증 직원',email:pending.email,requestedAt:null,departmentId:'assigned',position:null,jobGrade:null,hireDate:null,submittedAt:null,companySaved:false,completedAt:null,version:0,employeeFiles:0,signedFiles:0} as OnboardingEmployee
const missing=newEmployeeRows([], [pending,{...pending,id:'external',departmentId:'bf926822-910c-422f-9c17-5fd3d8ddb3ba'}])
assert.equal(missing.length,2,'서류 기록·신청일·부서 배치·본사 근태 대상 여부와 무관하게 가입 대기 표시')
assert.ok(missing.every(row=>!row.connected&&inNewEmployeeView(row,'active')))
assert.equal(newEmployeeRows([], [{...pending,companyId:'other-company'}]).length,0,'타 회사 신청 미노출')
const joined=newEmployeeRows([record],[pending])
assert.equal(joined.length,1,'계정과 서류 기록을 직원 단위로 연결')
assert.equal(joined[0].status,'pending','최신 가입 대기 상태 사용')
assert.equal(joined[0].id,'case','서류 상세 연결 ID 유지')
const active=newEmployeeRows([record],[])[0]
assert.equal(inNewEmployeeView(active,'active'),true,'승인·부서 배치 뒤에도 완료 전까지 남음')
assert.equal(inNewEmployeeView({...active,completedAt:'2026-11-05'},'active'),false)
assert.equal(inNewEmployeeView({...active,completedAt:'2026-11-05'},'complete'),true)
assert.equal(inNewEmployeeView({...joined[0],completedAt:'2026-11-05'},'active'),true,'예전 완료 기록이 있어도 가입 대기자를 숨기지 않음')
const rejected=newEmployeeRows([], [{...pending,status:'rejected'}])[0]
assert.equal(inNewEmployeeView(rejected,'rejected'),true)
assert.equal(inNewEmployeeView(rejected,'active'),false)
assert.equal(accessStatusLabel(rejected.status),'거절','거절을 승인 완료로 표시하지 않음')
assert.equal(newEmployeeRows([{...record,id:'test-case',isTest:true}],[pending]).length,2,'개발자 테스트와 실제 가입 신청을 섞지 않음')
assert.equal(record.status,'active','조회 원본을 수정하지 않음')
console.log('new-employee-access: 누락 없는 대기 목록, 중복 방지, 배치 후 유지, 완료·거절 분리, 테스트 격리 통과')
