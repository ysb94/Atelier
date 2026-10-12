import assert from 'node:assert/strict'
import { attendanceMonthDates, buildMyAttendance, clockOutLabel, koreaDateKey } from './my-attendance.ts'
import type { PersonalRequest } from './personal-requests'

assert.equal(koreaDateKey(new Date('2026-09-30T15:01:00Z')), '2026-10-01')
assert.equal(clockOutLabel('2026-10-12T09:07:00Z'), '18:07')
assert.equal(clockOutLabel(null), '')
assert.equal(attendanceMonthDates('2024-02').length, 29)
assert.equal(attendanceMonthDates('2026-02').length, 28)
assert.throws(() => attendanceMonthDates('2026-13'))
const request = (patch: Partial<PersonalRequest>): PersonalRequest => ({ id: 'annual', kind: 'annual', from: '2026-09-30', to: '2026-10-02', start: '09:00', end: '18:00', place: '', note: '', status: 'approved', createdAt: '2026-09-20T00:00:00Z', ...patch })
const requests = [request({}), request({ id: 'half', kind: 'half', from: '2026-10-05', to: '2026-10-05', start: '13:00', end: '18:00' }), request({ id: 'pending', status: 'pending' }), request({ id: 'cancelled', status: 'cancelled' }), request({ id: 'rejected', status: 'rejected' }), request({ id: 'overtime', kind: 'overtime' })]
const clocks = [{ date: '2026-10-05', clockIn: '09:03', clockOutAt: '2026-10-05T09:07:00Z' }]
const original = JSON.stringify({ requests, clocks })
const days = buildMyAttendance('2026-10', clocks, requests, '2026-10-01')
assert.equal(days.length, 31)
assert.deepEqual(days[0].leaves.map(leave => leave.id), ['annual'])
assert.deepEqual(days[1].leaves.map(leave => leave.id), ['annual'])
assert.equal(days[0].future, false)
assert.equal(days[1].future, true)
assert.equal(days[2].leaves.length, 0)
assert.equal(days[4].clockIn, '09:03')
assert.equal(clockOutLabel(days[4].clockOutAt), '18:07')
assert.deepEqual(days[4].leaves.map(leave => [leave.id, leave.start, leave.end]), [['half', '13:00', '18:00']])
assert.equal(days[3].clockIn, '')
assert.equal(days[3].clockOutAt, null)
assert.equal(JSON.stringify({ requests, clocks }), original)
console.info('my-attendance verify: ok (Korea dates/times, leap month, cross-month approved leave, future, partial leave, immutable inputs)')
