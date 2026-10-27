import assert from 'node:assert/strict'
import { deferredClockOutViews } from './deferred-clock-outs.ts'

const rows = deferredClockOutViews([
  { employeeId: 'a', date: '2026-10-26', clockIn: '09:12:00', clockOutAt: '2026-10-26T09:40:00Z', reportedAt: '2026-10-26T23:48:00Z' },
  { employeeId: 'a', date: '2026-09-30', clockIn: '09:00', clockOutAt: '2026-09-30T09:00:00Z', reportedAt: '2026-10-01T00:10:00Z' },
  { employeeId: 'b', date: '2026-10-20', clockIn: '10:00', clockOutAt: '2026-10-20T10:30:00Z', reportedAt: '2026-10-20T23:05:00Z' },
  { employeeId: 'c', date: '2026-10-21', clockIn: '09:00', clockOutAt: null, reportedAt: 'not-a-date' },
], '2026-10')

assert.deepEqual(rows.map(row => [row.employeeId, row.date, row.clockIn, row.clockOutText, row.reportedText, row.totalCount]), [
  ['a', '2026-10-26', '09:12', '18:40', '10.27 08:48', 2],
  ['b', '2026-10-20', '10:00', '19:30', '10.21 08:05', 1],
])
assert.equal(rows.some(row => row.employeeId === 'c'), false)
console.log('deferred-clock-outs.verify ok')
