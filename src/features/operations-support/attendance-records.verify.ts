import assert from 'node:assert/strict'
import type { LeaveRequest } from '../../lib/supabase/leave-requests.ts'
import { buildAttendanceRecords } from './attendance-records.ts'

const dates = ['2026-10-05', '2026-10-06', '2026-10-07']
const leave = (patch: Partial<LeaveRequest>): LeaveRequest => ({
  id: 'leave', employeeId: 'emp', employeeName: '직원', departmentId: null, departmentName: '',
  kind: 'annual', from: '2026-10-05', to: '2026-10-05', start: '09:00', end: '18:00', note: '', place: '',
  status: 'approved', createdAt: '2026-10-01', decidedAt: null, decidedByName: null, ...patch,
})
const records = buildAttendanceRecords(dates, [
  { employeeId: 'emp', date: '2026-10-05', clockIn: '09:12' },
  { employeeId: 'emp', date: '2026-10-06', clockIn: '09:01' },
], [
  leave({}),
  leave({ id: 'half', kind: 'half', from: '2026-10-06', to: '2026-10-06', start: '14:00', end: '18:00', status: 'pending' }),
  leave({ id: 'quarter', kind: 'quarter', from: '2026-10-06', to: '2026-10-06', start: '16:00', end: '18:00' }),
  leave({ id: 'out', kind: 'offsite', from: '2026-10-07', to: '2026-10-07', start: '10:00', end: '16:00' }),
  leave({ id: 'no', status: 'rejected', from: '2026-10-07', to: '2026-10-07' }),
  leave({ id: 'night', kind: 'overtime', from: '2026-10-05', to: '2026-10-05', start: '18:00', end: '21:00' }),
])
assert.equal(records['2026-10-05']?.emp.status, 'annual')
assert.equal(records['2026-10-05']?.emp.start, '09:12')
assert.equal(records['2026-10-06']?.emp.status, 'half-pm')
assert.equal(records['2026-10-06']?.emp.start, '09:01')
assert.match(records['2026-10-06']?.emp.note ?? '', /반반차 16:00–18:00/)
assert.match(records['2026-10-06']?.emp.note ?? '', /승인 대기/)
assert.equal(records['2026-10-07']?.emp.status, 'offsite')
assert.equal(records['2026-10-07']?.emp.start, '')
const quarterOnly = buildAttendanceRecords(dates, [], [leave({ id: 'q', kind: 'quarter', from: '2026-10-05', to: '2026-10-05', start: '09:00', end: '11:00' })])
assert.equal(quarterOnly['2026-10-05']?.emp.status, 'unset', '반반차만으로는 출근으로 만들지 않는다')
assert.match(quarterOnly['2026-10-05']?.emp.note ?? '', /반반차/)
console.log('attendance-records.verify ok')
