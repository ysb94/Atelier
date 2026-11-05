import assert from 'node:assert/strict'
import { koreanHolidayLabel, koreanHolidayNames } from './korean-holidays.ts'
import { ATTENDANCE_TRACKING_START, attendanceTrackingStart } from './attendance-period.ts'
import { EMPTY_ATTENDANCE, isWorkday, monthDates, monthlyAttendance, recordTiming, shiftMonth, timeSeconds, type AttendanceRecord, type AttendanceRecords } from './monthly-attendance.ts'

const schedule = { start: '09:00', grace: 5 }
const record = (patch: Partial<AttendanceRecord>): AttendanceRecord => ({ ...EMPTY_ATTENDANCE, status: 'present', start: '08:59:00', ...patch })
assert.equal(monthDates('2024-02').length, 29)
assert.equal(shiftMonth('2026-12', 1), '2027-01')
assert.equal(timeSeconds('24:00'), null)
assert.equal(timeSeconds('09:60:00'), null)
assert.equal(recordTiming(record({ start: '09:00:01' }), schedule).after, true)
assert.equal(recordTiming(record({ start: '09:05:00' }), schedule).exceeded, false)
assert.equal(recordTiming(record({ start: '09:05:01' }), schedule).exceeded, true)
assert.equal(recordTiming(record({ status: 'half-am', start: '13:00' }), schedule).after, false)
assert.equal(recordTiming(record({ status: 'half-am', start: '13:05:01', expectedStart: '13:00' }), schedule).exceeded, true)
const records: AttendanceRecords = {
  '2026-09-01': { a: record({ start: '09:05:01' }), b: record({ start: '10:00' }) },
  '2026-09-02': { a: record({ status: 'annual', start: '' }) },
  '2026-09-03': { a: record({ status: 'half-am', start: '13:00', reviewed: true }) },
  '2026-09-04': { a: record({ status: 'present', start: '', reviewed: true }) },
  '2026-09-05': { a: record({ status: 'annual', start: '' }) },
  '2026-09-07': { a: record({ start: '08:00' }) },
}
const s = monthlyAttendance('a', '2026-09', records, schedule, {}, '2026-09-06')
assert.equal(s.records, 2)
assert.equal(s.dueDays, 4)
assert.equal(s.annual, 1)
assert.equal(s.half, 1)
assert.equal(s.after, 1)
assert.equal(s.exceeded, 1)
assert.deepEqual(s.missingDates, ['2026-09-04'])
assert.deepEqual(s.pendingDates, ['2026-09-01', '2026-09-04'])
assert.equal(s.earliest, 32701)
assert.equal(s.latest, 46800)
assert.equal(s.average, (32701 + 46800) / 2)
const reviewed = { ...records, '2026-09-01': { a: record({ start: '09:05:01', reviewed: true }) } }
assert.equal(monthlyAttendance('a', '2026-09', reviewed, schedule, {}, '2026-09-06').pending, 1)
assert.equal(monthlyAttendance('a', '2026-09', records, schedule, { '2026-09-04': false, '2026-09-05': true }, '2026-09-06').annual, 2)
assert.equal(monthlyAttendance('a', '2026-09', records, { start: '', grace: 5 }, {}, '2026-09-01').scheduleMissing, true)
assert.equal(monthlyAttendance('a', '2026-10', records, schedule, {}, '2026-09-30').pending, 0)
assert.equal(monthlyAttendance('b', '2026-09', records, { start: '10:00', grace: 5 }, {}, '2026-09-01').records, 1)
assert.equal(isWorkday('2026-10-05', {}), false)
assert.equal(isWorkday('2026-10-06', {}), true)
assert.equal(isWorkday('2026-10-09', {}), false)
assert.equal(isWorkday('2026-10-05', { '2026-10-05': true }), true)
assert.equal(isWorkday('2026-10-02', { '2026-10-02': false }), false)
assert.equal(isWorkday('2026-06-03', {}), false)
assert.equal(isWorkday('2025-06-03', {}), false)
assert.equal(koreanHolidayNames('2026-06-03')[0], '전국동시지방선거')
assert.equal(koreanHolidayLabel(koreanHolidayNames('2026-10-05')), '개천절 대체')
assert.equal(koreanHolidayLabel(koreanHolidayNames('2026-10-09')), '한글날')
assert.equal(koreanHolidayLabel(koreanHolidayNames('2025-06-03')), '대통령선거')
assert.deepEqual(monthlyAttendance('a', '2026-10', {}, schedule, {}, '2026-10-07').missingDates, ['2026-10-01', '2026-10-02', '2026-10-06', '2026-10-07'])
assert.equal(ATTENDANCE_TRACKING_START, '2026-11-02')
assert.equal(attendanceTrackingStart('2020-03-01'), '2026-11-02')
assert.equal(attendanceTrackingStart('2026-11-02'), '2026-11-02')
assert.equal(attendanceTrackingStart('2026-11-04'), '2026-11-04')
for (const missing of [undefined, null, '', 'invalid', '2026-02-30', '2026-13-01']) {
  assert.equal(attendanceTrackingStart(missing), '2026-11-02', '입사일 미등록·잘못된 날짜는 사이트 도입일을 사용')
}
const beforeTracking = monthlyAttendance('a', '2026-10', {}, { start: '', grace: 5 }, {}, '2026-11-05', attendanceTrackingStart('2020-01-01'))
assert.equal(beforeTracking.dueDays, 0)
assert.equal(beforeTracking.pending, 0)
assert.equal(beforeTracking.scheduleMissing, false)
assert.deepEqual(beforeTracking.missingDates, [])
const november: AttendanceRecords = {
  '2026-11-02': { a: record({ start: '10:00' }) },
  '2026-11-03': { a: record({ status: 'annual', start: '' }) },
  '2026-11-04': { a: record({ start: '09:06' }) },
  '2026-11-05': { a: record({ status: 'absent', start: '' }) },
}
const original = JSON.stringify(november)
const afterHire = monthlyAttendance('a', '2026-11', november, schedule, {}, '2026-11-05', attendanceTrackingStart('2026-11-04'))
assert.equal(afterHire.dueDays, 2)
assert.equal(afterHire.records, 1)
assert.equal(afterHire.exceeded, 1)
assert.equal(afterHire.absent, 1)
assert.equal(afterHire.annual, 0, '입사 전 연차·출근 원본도 월 집계에서 제외')
assert.equal(afterHire.average, 9 * 3600 + 6 * 60)
assert.deepEqual(afterHire.pendingDates, ['2026-11-04', '2026-11-05'])
const missingAfterHire = monthlyAttendance('a', '2026-11', {}, schedule, {}, '2026-11-05', attendanceTrackingStart('2026-11-04'))
assert.deepEqual(missingAfterHire.missingDates, ['2026-11-04', '2026-11-05'])
assert.equal(monthlyAttendance('a', '2026-11', november, schedule, {}, '2026-11-02', attendanceTrackingStart(null)).records, 1, '도입 당일 기록 포함')
assert.equal(monthlyAttendance('a', '2026-11', november, schedule, {}, '2026-11-05', attendanceTrackingStart('2026-11-10')).pending, 0, '입사 전 직원은 확인 대기도 생성하지 않음')
assert.equal(monthlyAttendance('a', '2026-11', {}, schedule, {}, '2026-11-08', '2026-11-07').dueDays, 0, '주말은 기존 근무일 기준 유지')
assert.equal(JSON.stringify(november), original, '집계 필터로 출퇴근·휴가 원본을 수정하지 않음')
assert.equal(attendanceTrackingStart('2026-11-03', undefined, '2026-11-06'), '2026-11-06', '오후 승인 직원은 승인 다음 근무일부터 집계')
assert.equal(attendanceTrackingStart('2026-11-10', undefined, '2026-11-06'), '2026-11-10', '나중의 입사일을 승인 기준이 앞당기지 않음')
assert.equal(attendanceTrackingStart('2026-11-03', '2026-11-12', '2026-11-06'), '2026-11-12', '별도 본사 관리 전환일도 보존')
const afterApproval = monthlyAttendance('a', '2026-11', november, schedule, {}, '2026-11-05', attendanceTrackingStart('2026-11-03', undefined, '2026-11-06'))
assert.equal(afterApproval.exceeded, 0)
assert.equal(afterApproval.absent, 0)
assert.deepEqual(afterApproval.missingDates, [])
console.log('monthly attendance verify: ok (seconds, exceptions, workdays, future dates, employee isolation, holidays, tracking start, hire dates, source preservation)')
