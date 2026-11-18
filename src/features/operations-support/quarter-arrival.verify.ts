import assert from 'node:assert/strict'
import { attendanceArrivalStart } from './attendance-arrival.ts'
import { buildAttendanceRecords } from './attendance-records.ts'
import { monthlyAttendance, recordTiming, timeSeconds } from './monthly-attendance.ts'
import { countMyLateDays } from '../home/my-attendance-summary.ts'
import { workdayGuidance } from '../home/attendance-guidance.ts'
import type { LeaveRequest } from '../../lib/supabase/leave-requests.ts'

const date = '2026-11-10'
const lunch = { start: '13:00', end: '14:00' }
const leave: LeaveRequest = { id: 'quarter', kind: 'quarter', status: 'approved', employeeId: 'a', employeeName: '직원', departmentId: 'd', departmentName: '부서', from: date, to: date, start: '09:00', end: '11:00', note: '', place: '', createdAt: '', decidedAt: null, decidedByName: null }
const arrival = (requests: LeaveRequest[], start = '09:00') => attendanceArrivalStart(start, requests, date, lunch)
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

const testDay = (date: string, baseline: string, actual: string, source: string, request: Partial<LeaveRequest>, minutes: number) => {
  const requests = [{ ...leave, from: date, to: date, ...request }]
  const clock = { employeeId: 'a', date, clockIn: actual, clockInSource: source }
  const { a: record } = buildAttendanceRecords([date], [clock], requests, lunch)[date]
  const timing = recordTiming(record, { start: baseline, grace: 5 })
  assert.equal(timing.actual, timeSeconds(actual), '실제 출근 유지')
  assert.equal(timing.exceeded, minutes > 0)
  assert.equal(timing.exceeded ? (timing.actual! - timing.baseline!) / 60 : 0, minutes)
  assert.equal(countMyLateDays([clock], baseline, 5, date, requests, lunch), minutes > 0 ? 1 : 0)
}

for (const [day, time] of [['06', '09:30'], ['11', '10:00'], ['18', '10:00']]) {
  testDay(`2026-11-${day}`, '09:00', time, 'offsite', { kind: 'offsite', start: time, end: '19:00' }, 0)
}
const morning = { kind: 'half', start: '09:00', end: '14:00' } as const
testDay('2026-11-16', '10:00', '14:39', 'manual', morning, 39)
testDay('2026-11-16', '10:00', '14:05', 'manual', morning, 0)
testDay('2026-11-16', '10:00', '14:06', 'manual', morning, 6)
testDay('2026-11-16', '10:00', '14:39', 'manual', { ...morning, status: 'pending' }, 279)
testDay('2026-11-18', '10:00', '10:40', 'manual', { kind: 'offsite', start: '14:00', end: '20:30' }, 40)
testDay('2026-11-18', '09:00', '10:00', 'correction', { kind: 'offsite', start: '10:00', end: '19:00' }, 60)
testDay('2026-11-18', '10:00', '10:40', 'manual', { kind: 'half', start: '14:00', end: '18:00' }, 40)
testDay('2026-11-18', '09:00', '10:06', 'manual', { kind: 'offsite', start: '16:00', end: '20:00', offsiteWorkStart: '10:00' }, 6)
const nextDate = '2026-11-11'
const adjustment = { employee_id: 'a', minutes: 0, reason: null, revision: null }
const corrected = buildAttendanceRecords([date, nextDate], [clock], [], lunch, [
  { ...adjustment, work_date: date, kind: 'late' },
  { ...adjustment, work_date: nextDate, kind: 'absent' },
])
const summary = monthlyAttendance('a', '2026-11', corrected, { start: '09:00', grace: 5 }, {}, nextDate, date)
assert.equal(corrected[date].a.start, clock.clockIn)
assert.equal(summary.exceeded, 0)
assert.deepEqual(summary.missingDates, [])
assert.equal(summary.pending, 0)
assert.equal(countMyLateDays([clock], '09:00', 5, date, [], lunch, new Set([date])), 0)
console.info('Attendance arrival: adjusted leave and offsite times, grace, correction and manual clock-in parity passed')
