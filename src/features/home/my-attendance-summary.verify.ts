import assert from 'node:assert/strict'
import type { PersonalRequest } from '../settings/personal-requests.ts'
import { approvedOvertimeHours, countMyLateDays } from './my-attendance-summary.ts'

const today = '2026-10-27'
const request = (patch: Partial<PersonalRequest>): PersonalRequest => ({
  id: 'overtime', kind: 'overtime', from: '2026-10-06', to: '2026-10-06', start: '18:00', end: '21:00', place: '', note: '마감', status: 'approved', createdAt: '2026-10-01', ...patch,
})
assert.equal(countMyLateDays([{ date: '2026-10-26', clockIn: '09:06' }], '09:00', 5, today), 1)
assert.equal(countMyLateDays([{ date: '2026-10-26', clockIn: '09:05' }], '09:00', 5, today), 0)
assert.equal(countMyLateDays([{ date: '2026-10-03', clockIn: '11:00' }], '09:00', 5, today), 0, '주말은 지각이 아님')
assert.equal(countMyLateDays([{ date: '2026-10-05', clockIn: '11:00' }], '09:00', 5, today), 0, '대체공휴일은 지각이 아님')
assert.equal(countMyLateDays([{ date: '2026-10-28', clockIn: '11:00' }], '09:00', 5, today), 0, '오늘 이후는 제외')
assert.equal(countMyLateDays([{ date: '2026-10-26', clockIn: '09:06' }], '', 5, today), null)
assert.equal(approvedOvertimeHours([request({}), request({ id: 'wait', status: 'pending' }), request({ id: 'next', from: '2026-11-02', to: '2026-11-02' })], '2026-10'), 3)
console.log('my-attendance-summary.verify ok')
