import assert from 'node:assert/strict'
import { monthlyOvertimeHours, workDurationLabel, workedMinutes } from './overtime-hours.ts'

const lunch = ['12:00', '13:00'] as const
assert.equal(workedMinutes('2026-10-26', '09:00', '2026-10-26T09:00:00Z', ...lunch), 480)
assert.equal(workedMinutes('2026-10-26', '09:00', '2026-10-26T12:00:00Z', ...lunch), 660)
assert.equal(workedMinutes('2026-10-26', '09:00', '2026-10-25T23:00:00Z', ...lunch), null)

const leave = (patch: { employeeId?: string; kind: string; status?: string; from: string; to?: string; start?: string; end?: string }) => ({
  employeeId: patch.employeeId ?? 'a', status: patch.status ?? 'approved', to: patch.to ?? patch.from, start: patch.start ?? '09:00', end: patch.end ?? '18:00', ...patch,
})
const span = (date: string, clockIn: string, clockOutAt: string | null, employeeId = 'a') => ({ employeeId, date, clockIn, clockOutAt })
const rows = monthlyOvertimeHours([
  span('2026-10-26', '09:00', '2026-10-26T09:00:00Z'),
  span('2026-10-27', '09:00', '2026-10-27T12:00:00Z'),
  span('2026-10-22', '09:00', null),
  span('2026-10-23', '09:00', '2026-10-23T09:00:00Z'),
  span('2026-10-25', '10:00', '2026-10-25T05:00:00Z'),
  span('2026-11-02', '09:00', '2026-11-02T12:00:00Z'),
  span('2026-10-21', '09:00', '2026-10-21T05:00:00Z', 'b'),
], [
  leave({ kind: 'annual', from: '2026-10-23' }),
  leave({ kind: 'half', from: '2026-10-21', employeeId: 'b' }),
  leave({ kind: 'overtime', from: '2026-10-27', start: '18:00', end: '21:00' }),
  leave({ kind: 'overtime', from: '2026-10-20', start: '18:00', end: '20:00', status: 'pending' }),
], ...lunch, '2026-10', '2026-10-27')

const mine = rows.find(row => row.employeeId === 'a')
const half = rows.find(row => row.employeeId === 'b')
assert.equal(mine?.completeDays, 3)
assert.equal(mine?.openDays, 1)
assert.equal(mine?.workedMinutes, 480 + 660 + 180)
assert.equal(mine?.extraMinutes, 180 + 180)
assert.equal(mine?.approvedMinutes, 180)
assert.equal(half?.workedMinutes, 240)
assert.equal(half?.extraMinutes, 0)
assert.equal(workDurationLabel(200), '3시간 20분')
assert.equal(workDurationLabel(120), '2시간')
assert.equal(workDurationLabel(15), '15분')
console.log('overtime-hours.verify ok')
