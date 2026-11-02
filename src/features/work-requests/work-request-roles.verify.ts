/**
 * 부서 작업 요청 역할·소속 매칭 검증.
 * 실행: npx tsx src/features/work-requests/work-request-roles.verify.ts
 */
import {
  departmentDisplayName,
  isMemberOfOwnerDepartment,
  isSameDepartment,
  resolveWorkRequestViewRole,
} from './work-request-form-config'
import { RELEASE_COMPANY_ID, RELEASE_EXCEPTION_IDS } from '../../lib/company/release-access'
import {
  needsLeadCompletionReview,
  nextCompletionStatus,
  type WorkRequestRecord,
} from './work-request-types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

assert(isMemberOfOwnerDepartment('VisualTeam', 'design'), 'VisualTeam은 디자인 대상 부서')
assert(isMemberOfOwnerDepartment('디자인팀', 'design'), '디자인팀은 디자인 대상 부서')
assert(isMemberOfOwnerDepartment('비주얼', 'design'), '비주얼은 디자인 별칭')
assert(!isMemberOfOwnerDepartment('물류', 'design'), '물류는 디자인 대상 부서가 아님')
assert(isMemberOfOwnerDepartment('물류팀', 'logistics'), '물류팀은 물류 대상 부서')
assert(!isMemberOfOwnerDepartment('VisualTeam', 'logistics'), 'VisualTeam은 물류 대상 부서가 아님')

assert(isSameDepartment('VisualTeam', '디자인'), 'VisualTeam과 디자인은 같은 소속')
assert(isSameDepartment('물류팀', '물류'), '물류 표기는 같은 소속')
assert(!isSameDepartment('물류', 'VisualTeam'), '물류와 VisualTeam은 다른 소속')

assert(departmentDisplayName('디자인팀') === 'VisualTeam', '디자인 표시명은 VisualTeam')
assert(departmentDisplayName('물류팀') === '물류', '물류 표시명은 물류')

const employee = { status: 'active', companyId: RELEASE_COMPANY_ID, permissionGrants: [] }
for (const position of ['사원', '과장', '팀장', '이사']) {
  assert(resolveWorkRequestViewRole('design', 'VisualTeam', position, [], employee) === 'employee', `${position}도 지정 없으면 일반 직원`)
}
for (const id of RELEASE_EXCEPTION_IDS) {
  for (const owner of ['planning', 'design', 'md', 'logistics'] as const) {
    assert(resolveWorkRequestViewRole(owner, '다른 부서', null, [], { ...employee, id }) === 'manager', `${id}: 모든 작업 요청 관리`)
    assert(resolveWorkRequestViewRole(owner, '다른 부서', null, [], { ...employee, id, status: 'pending' }) !== 'manager', '승인 대기 예외 계정은 관리자 아님')
    assert(resolveWorkRequestViewRole(owner, '다른 부서', null, [], { ...employee, id, companyId: 'other-company' }) !== 'manager', '다른 회사 예외 계정은 관리자 아님')
  }
}
const designated = { ...employee, permissionGrants: [{ permission: 'work.manage' as const, scopeKind: 'department' as const, scopeId: '7ac8b7a8-7f12-4f3e-a371-d2dac7e492f1', scopeName: '이름이 바뀐 부서' }] }
assert(resolveWorkRequestViewRole('design', '다른 부서', '사원', [], designated) === 'manager', '직책·부서명 대신 지정한 Visual UUID 기준')
assert(resolveWorkRequestViewRole('md', 'MD', '이사', [], designated) === 'employee', 'Visual 지정자는 MD 관리자 아님')
assert(resolveWorkRequestViewRole('design', 'VisualTeam', '팀장', [], { ...designated, permissionGrants: [] }) === 'employee', '지정 해제 시 직책으로 관리 권한이 남지 않음')

assert(
  resolveWorkRequestViewRole('design', '물류', '사원') === 'requester',
  '물류 구성원이 디자인 요청함이면 요청자',
)
assert(
  resolveWorkRequestViewRole('design', 'VisualTeam', '사원') === 'employee',
  'VisualTeam 사원은 사원 화면',
)
assert(
  resolveWorkRequestViewRole('design', '디자인', '대리') === 'employee',
  '디자인 대리는 사원 화면',
)
assert(
  resolveWorkRequestViewRole('design', 'VisualTeam', '과장') === 'employee',
  'VisualTeam 과장은 사원 화면',
)
assert(
  resolveWorkRequestViewRole('design', 'VisualTeam', '팀장') === 'employee',
  'VisualTeam 팀장도 지정 없으면 일반 업무 화면',
)
assert(
  resolveWorkRequestViewRole('design', '디자인팀', '이사') === 'employee',
  '디자인 이사도 지정 없으면 일반 업무 화면',
)
assert(
  resolveWorkRequestViewRole('logistics', 'VisualTeam', '팀장') === 'requester',
  'VisualTeam이 물류 요청함에 들어가면 요청자',
)
assert(
  resolveWorkRequestViewRole('design', '물류', '사원', ['design']) === 'employee',
  '부서가 달라도 디자인 역량이 있으면 수신 부서',
)

const selfAssigned = {
  assignee: 'local-self',
  assignedBy: 'local-self',
} as WorkRequestRecord
const leadAssigned = {
  assignee: 'member-min',
  assignedBy: 'local-self',
} as WorkRequestRecord

assert(!needsLeadCompletionReview(selfAssigned), '팀장이 직접 맡은 일은 팀장 확인을 건너뛴다')
assert(needsLeadCompletionReview(leadAssigned), '사원에게 준 일은 팀장 확인이 필요하다')
assert(nextCompletionStatus(selfAssigned) === 'completionConfirm', '직접 맡은 일은 요청자 확인으로')
assert(nextCompletionStatus(leadAssigned) === 'completionReview', '사원 일은 팀장 확인으로')

console.log('work-request-roles.verify ok')
