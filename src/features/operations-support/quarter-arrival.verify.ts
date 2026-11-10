import assert from 'node:assert/strict'
import { approvedQuarterIntervals, quarterArrivalStart } from './quarter-arrival.ts'
import { buildAttendanceRecords } from './attendance-records.ts'
import { recordTiming } from './monthly-attendance.ts'
import { countMyLateDays } from '../home/my-attendance-summary.ts'
import { workdayGuidance } from '../home/attendance-guidance.ts'
import type { LeaveRequest } from '../../lib/supabase/leave-requests.ts'

const date = '2026-11-10'
const lunch = { start: '13:00', end: '14:00' }
const leave: LeaveRequest = { id: 'quarter', kind: 'quarter', status: 'approved', employeeId: 'a', employeeName: '직원', departmentId: 'd', departmentName: '부서', from: date, to: date, start: '09:00', end: '11:00', note: '', place: '', createdAt: '', decidedAt: null, decidedByName: null }
const arrival = (requests: LeaveRequest[], start = '09:00') => quarterArrivalStart(start, approvedQuarterIntervals(requests, date), lunch)
assert.equal(arrival([leave]), '11:00')
assert.equal(arrival([leave], ''), '')
for (const status of ['pending', 'cancelled', 'rejected'] as const) assert.equal(arrival([{ ...leave, status }]), '09:00')
assert.equal(arrival([{ ...leave, from: '2026-11-09', to: '2026-11-09' }]), '09:00')
assert.equal(arrival([{ ...leave, start: '16:00', end: '18:00' }]), '09:00', '오후 휴가는 오전 지각을 지우지 않음')
assert.equal(arrival([{ ...leave, start: '11:00', end: '13:00' }], '11:00'), '14:00', '실제 회사 점심시간 제외')
assert.equal(arrival([{ ...leave, start: '11:00', end: '13:00' }, leave]), '14:00', '연속 휴가를 정렬하여 반영')
assert.equal(arrival([leave, { ...leave, start: '12:00', end: '15:00' }]), '11:00', '중간 근무 시간은 건너뛰지 않음')
const clock = { employeeId: 'a', date, clockIn: '10:46' }
const records = buildAttendanceRecords([date], [clock], [leave], lunch)
assert.equal(records[date].a.start, '10:46', '실제 출근 원본 보존')
assert.equal(recordTiming(records[date].a, { start: '09:00', grace: 5 }).exceeded, false)
assert.equal(countMyLateDays([clock], '09:00', 5, date, [leave], lunch), 0)
assert.equal(countMyLateDays([{ ...clock, clockIn: '11:05' }], '09:00', 5, date, [leave], lunch), 0)
assert.equal(countMyLateDays([{ ...clock, clockIn: '11:06' }], '09:00', 5, date, [leave], lunch), 1)
const other = buildAttendanceRecords([date], [{ ...clock, employeeId: 'b' }], [leave], lunch)
assert.equal(recordTiming(other[date].b, { start: '09:00', grace: 5 }).exceeded, true)
const basis = { date, start: '09:00', lunchStart: lunch.start, lunchEnd: lunch.end, configured: true }
assert.equal(new Date(workdayGuidance(date, basis, [leave]).end!).toISOString(), '2026-11-10T09:00:00.000Z', '퇴근은 18시 그대로')
console.info('Quarter arrival: 10:46 on time, approvals/cancel/afternoon/lunch/contiguous intervals/isolation/grace/unchanged checkout passed')
