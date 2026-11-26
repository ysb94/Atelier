import assert from 'node:assert/strict'
import type { LeaveRequest } from '../../lib/supabase/leave-requests.ts'
import { attendanceStartIndex } from './attendance-start-settings.ts'
import { unrequestedOvertime } from './unrequested-overtime.ts'

const month = '2026-11', monday = `${month}-16`, friday = `${month}-20`, sunday = `${month}-22`
const now = Date.parse(`${month}-26T12:00:00+09:00`)
const lunch = { start: '13:00', end: '14:00' }
const employee = { id: 'employee', departmentId: 'team', hireDate: '2025-01-01' }
const starts = attendanceStartIndex([{ id: 'team-start', month, departmentId: 'team', employeeId: null, source: 'department', start: '10:00', grace: 5 }])
const clock = { employeeId: employee.id, date: monday, clockIn: '09:55', clockOutAt: `${monday}T21:04:00+09:00`, clockOutSource: 'manual' }
const leave: LeaveRequest = {
  id: 'leave', kind: 'overtime', from: monday, to: monday, start: '19:00', end: '21:00', status: 'pending',
  place: '', note: '', createdAt: monday, employeeId: employee.id, employeeName: '직원', departmentId: 'team', departmentName: '팀', decidedAt: null, decidedByName: null,
}
const minutes = (row = clock, requests: LeaveRequest[] = [], member: typeof employee & { attendanceTrackedFrom?: string; attendanceExempt?: boolean } = employee, settings = starts) =>
  unrequestedOvertime([row], [member], requests, settings, lunch, month, now).get(employee.id)?.[0]?.minutes ?? 0

assert.equal(minutes(), 124)
assert.equal(minutes({ ...clock, clockIn: '20:00' }), 64, '실제 출근하기 전 시간은 집계하지 않는다')
assert.equal(minutes({ ...clock, clockOutSource: 'correction' }), 124)
assert.equal(minutes({ ...clock, clockOutSource: 'offsite' }), 0)
assert.equal(minutes({ ...clock, clockOutSource: '', clockOutAt: '' }), 0)
assert.equal(minutes(clock, [leave]), 0)
assert.equal(minutes(clock, [{ ...leave, status: 'approved' }]), 0)
assert.equal(minutes(clock, [{ ...leave, status: 'cancelled' }]), 0)
assert.equal(minutes(clock, [{ ...leave, status: 'rejected' }]), 0)
assert.equal(minutes(clock, [{ ...leave, kind: 'offsite', status: 'approved' }]), 0)
assert.equal(minutes(clock, [{ ...leave, kind: 'annual', status: 'approved' }]), 0)
assert.equal(minutes({ ...clock, clockOutAt: `${monday}T14:20:00+09:00` }, [{ ...leave, kind: 'half', status: 'approved', start: '14:00', end: '19:00' }]), 20)
assert.equal(minutes({ ...clock, date: sunday, clockOutAt: `${sunday}T22:00:00+09:00` }), 0)
assert.equal(minutes({ ...clock, date: friday, clockOutAt: `${month}-21T02:00:00+09:00` }), 300, '토요일 시작 전까지만 합산한다')
assert.equal(minutes(clock, [], { ...employee, attendanceExempt: true }), 0)
assert.equal(minutes(clock, [], { ...employee, attendanceTrackedFrom: `${month}-17` }), 0)
assert.equal(minutes(clock, [], employee, new Map()), 0)
assert.equal(minutes(clock, [], employee, new Map(starts).set(`${month}:employee:employee`, { id: 'personal-start', month, departmentId: 'team', employeeId: 'employee', source: 'individual', start: '09:00', grace: 5 })), 184)
console.info('미신청 연장근무 검증 통과')
