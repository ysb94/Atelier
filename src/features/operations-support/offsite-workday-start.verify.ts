import assert from 'node:assert/strict'
import { attendanceStartIndex } from './attendance-start-settings.ts'
import { offsiteWorkdayStart, resolveWorkdayStart } from './offsite-workday-start.ts'
import { offsiteExtraHours } from './offsite-extra-hours.ts'
import { buildAttendanceRecords } from './attendance-records.ts'
import { monthlyAttendance, recordTiming } from './monthly-attendance.ts'
import { countMyLateDays } from '../home/my-attendance-summary.ts'
import { workdayGuidance } from '../home/attendance-guidance.ts'
import { offsiteSubmission } from '../settings/offsite-form.ts'
import { DEFAULT_REMINDER_BASIS, validateRequest } from '../settings/personal-requests.ts'
import type { LeaveRequest } from '../../lib/supabase/leave-requests.ts'

const request: LeaveRequest = { id: 'offsite', kind: 'offsite', status: 'approved', employeeId: 'a', employeeName: '직원', departmentId: 'd', departmentName: '부서', from: '2026-11-04', to: '2026-11-04', start: '16:00', end: '20:00', offsiteWorkStart: '10:00', note: '', place: '거래처', createdAt: '', decidedAt: null, decidedByName: null }
const index = attendanceStartIndex([{ id: 'monthly', month: '2026-11', departmentId: 'd', employeeId: null, source: 'department', start: '09:00', grace: 5 }])
const basis = { date: request.from, start: '09:00', lunchStart: '12:00', lunchEnd: '13:00', configured: true }
assert.equal(offsiteWorkdayStart([request], request.from), '10:00')
assert.equal(offsiteWorkdayStart([request], '2026-11-05'), null)
assert.equal(offsiteWorkdayStart([{ ...request, status: 'cancelled' }], request.from), null)
assert.equal(resolveWorkdayStart(index, 'a', 'd', request.from, [request]).start, '10:00')
assert.equal(resolveWorkdayStart(index, 'b', 'd', request.from, [request]).start, '09:00')
assert.equal(resolveWorkdayStart(index, 'a', 'd', '2026-11-05', [request]).start, '09:00')
assert.equal(new Date(workdayGuidance(request.from, basis, [request]).end!).toISOString(), '2026-11-04T10:00:00.000Z', '퇴근 안내는 19시')
assert.deepEqual(offsiteExtraHours(request, '2026-11', index, { start: '12:00', end: '13:00' }, [request]), { minutes: 60, days: 1, baseline: '10:00–19:00' })
assert.equal(offsiteExtraHours({ ...request, offsiteWorkStart: undefined }, '2026-11', index, { start: '12:00', end: '13:00' }, []).minutes, 120)
assert.equal(countMyLateDays([{ date: request.from, clockIn: '10:00' }], '09:00', 5, request.from, [request]), 0)
assert.equal(countMyLateDays([{ date: request.from, clockIn: '10:06' }], '09:00', 5, request.from, [request]), 1)
const dates = [request.from, '2026-11-05']
const records = buildAttendanceRecords(dates, [{ employeeId: 'a', date: request.from, clockIn: '10:00' }, { employeeId: 'a', date: dates[1], clockIn: '09:06' }], [request])
assert.equal(records[request.from].a.expectedStart, '10:00')
assert.equal(recordTiming(records[request.from].a, { start: '09:00', grace: 5 }).exceeded, false)
assert.equal(monthlyAttendance('a', '2026-11', records, { start: '09:00', grace: 5 }, {}, '2026-11-05').exceeded, 1)
assert.match(validateRequest({ ...request, offsiteWorkStart: '10:01:01' }, [], DEFAULT_REMINDER_BASIS, '2026-11-04'), /출근 기준/)
assert.match(validateRequest(request, [], DEFAULT_REMINDER_BASIS, '2026-11-05'), /지난 날짜/)
assert.match(validateRequest({ ...request, offsiteWorkStart: '09:00', start: '20:00', end: '21:00' }, [request], DEFAULT_REMINDER_BASIS, request.from), /다른 출근 기준/)
const night = offsiteSubmission({ ...request, to: '2026-11-05', end: '03:00' }).request!
assert.equal(night.to, request.from)
assert.equal(night.offsiteWorkStart, '10:00')
assert.equal(night.endNextDay, true)
console.info('Offsite workday start: office 10:00, offsite 16–20, regular end 19:00, extra 1h; home/late/calendar/next day/cancel/overnight passed')
