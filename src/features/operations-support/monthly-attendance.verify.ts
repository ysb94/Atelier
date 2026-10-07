import assert from 'node:assert/strict'
import { koreanHolidayLabel, koreanHolidayNames } from './korean-holidays.ts'
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
console.log('monthly attendance verify: ok (seconds, exceptions, workdays, future dates, employee isolation, national holidays)')
