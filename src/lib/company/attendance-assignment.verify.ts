import assert from 'node:assert/strict'
import { canManageDepartmentAttendance, assignedDepartmentIds } from './attendance-assignment'
import type { DepartmentApprover } from '../supabase/department-approvers'
import type { PermissionProfile } from './permissions'

const profile: PermissionProfile = { status: 'active', companyId: 'company', permissionGrants: [] }
const settings: DepartmentApprover[] = [
  { departmentId: 'planning', type: 'leave', approverId: 'approver', substituteId: 'substitute', updatedAt: '' },
  { departmentId: 'planning', type: 'overtime', approverId: 'approver', substituteId: 'substitute', updatedAt: '' },
  { departmentId: 'visual', type: 'leave', approverId: 'other', substituteId: null, updatedAt: '' },
]
for (const actor of ['approver', 'substitute']) {
  const departments = assignedDepartmentIds(settings, actor)
  assert.deepEqual(departments, ['planning'], '중복 지정은 같은 부서 한 번만 표시한다')
  assert.equal(canManageDepartmentAttendance(profile, departments, 'planning'), true)
  assert.equal(canManageDepartmentAttendance(profile, departments, 'visual'), false)
  assert.equal(canManageDepartmentAttendance(profile, departments, null), false)
  assert.equal(canManageDepartmentAttendance({ ...profile, status: 'resigned' }, departments, 'planning'), false)
}
assert.equal(canManageDepartmentAttendance(profile, assignedDepartmentIds(settings, 'staff'), 'planning'), false)
const changed = settings.map(row => ({ ...row, approverId: 'replacement', substituteId: null }))
assert.equal(canManageDepartmentAttendance(profile, assignedDepartmentIds(changed, 'approver'), 'planning'), false, '지정 해제 뒤 기존 범위를 사용할 수 없다')
assert.equal(canManageDepartmentAttendance({ ...profile, permissionGrants: [{ permission: 'attendance.manage', scopeKind: 'department', scopeId: 'visual' }] }, [], 'visual'), true, '기존 명시적 부서 권한 유지')
console.log('attendance-assignment: 승인자·대체 승인자, 담당/타부서, 해제·퇴사, 기존 권한 검증 통과')
