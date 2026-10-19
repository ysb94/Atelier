import assert from 'node:assert/strict'
import { attendanceMonthDates, buildMyAttendance, clockOutLabel, dayClock, koreaDateKey } from './my-attendance.ts'
import type { PersonalRequest } from './personal-requests'

assert.equal(koreaDateKey(new Date('2026-09-30T15:01:00Z')), '2026-10-01')
assert.equal(clockOutLabel('2026-10-12T09:07:00Z'), '18:07')
assert.equal(clockOutLabel(null), '')
assert.equal(attendanceMonthDates('2024-02').length, 29)
assert.equal(attendanceMonthDates('2026-02').length, 28)
assert.throws(() => attendanceMonthDates('2026-13'))
const request = (patch: Partial<PersonalRequest>): PersonalRequest => ({ id: 'annual', kind: 'annual', from: '2026-09-30', to: '2026-10-02', start: '09:00', end: '18:00', place: '', note: '', status: 'approved', createdAt: '2026-09-20T00:00:00Z', ...patch })
const requests = [request({}), request({ id: 'half', kind: 'half', from: '2026-10-05', to: '2026-10-05', start: '13:00', end: '18:00' }), request({ id: 'pending', status: 'pending', from: '2026-10-07', to: '2026-10-07' }), request({ id: 'remote', kind: 'remote', from: '2026-10-07', to: '2026-10-09', place: '집' }),
  request({ id: 'old-fix', kind: 'correction', from: '2026-10-05', to: '2026-10-05', start: '08:50', end: '18:00', createdAt: '2026-10-05T10:00:00Z' }),
  request({ id: 'new-fix', kind: 'correction', from: '2026-10-05', to: '2026-10-05', start: '09:00', end: '18:30', createdAt: '2026-10-06T10:00:00Z' }),
  request({ id: 'pending-fix', kind: 'correction', status: 'pending', from: '2026-10-06', to: '2026-10-06', start: '09:00', end: '18:00' })]
const clocks = [{ date: '2026-10-05', clockIn: '09:03', clockOutAt: '2026-10-05T09:07:00Z' }, { date: '2026-10-06', clockIn: '11:02', clockOutAt: null }]
const original = JSON.stringify({ requests, clocks })
const days = buildMyAttendance('2026-10', clocks, requests, '2026-10-01')
assert.equal(days.length, 31)
assert.deepEqual(days[0].requests.map(item => item.id), ['annual'])
assert.deepEqual(days[1].requests.map(item => item.id), ['annual'])
assert.equal(days[0].future, false)
assert.equal(days[1].future, true)
assert.equal(days[2].requests.length, 0)
assert.deepEqual(days[6].requests.map(item => item.id), ['pending', 'remote'])
assert.deepEqual(days[8].requests.map(item => item.id), ['remote'])
assert.equal(days[4].clockIn, '09:03')
assert.equal(clockOutLabel(days[4].clockOutAt), '18:07')
assert.equal(days[4].correction?.id, 'new-fix')
assert.deepEqual(dayClock(days[4]), { start: '09:00', end: '18:30', corrected: true })
assert.equal(days[5].correction, null)
assert.deepEqual(dayClock(days[5]), { start: '11:02', end: '', corrected: false })
assert.deepEqual(dayClock(days[3]), { start: '', end: '', corrected: false })
assert.equal(days[3].clockIn, '')
assert.equal(days[3].clockOutAt, null)
assert.equal(JSON.stringify({ requests, clocks }), original)
console.info('my-attendance verify: ok (Korea dates/times, leap month, cross-month requests, future, latest approved correction overlay, immutable inputs)')
