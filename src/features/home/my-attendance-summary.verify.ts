import assert from 'node:assert/strict'
import type { PersonalRequest } from '../settings/personal-requests.ts'
import type { AttendanceClock } from '../settings/my-attendance.ts'
import { actualOvertimeHours, countMyLateDays } from './my-attendance-summary.ts'

const today = '2026-10-27'
const request = (patch: Partial<PersonalRequest>): PersonalRequest => ({
  id: 'overtime', kind: 'overtime', from: '2026-10-26', to: '2026-10-26', start: '18:00', end: '21:00', place: '', note: '마감', status: 'approved', createdAt: '2026-10-01', ...patch,
})
assert.equal(countMyLateDays([{ date: '2026-10-26', clockIn: '09:06' }], '09:00', 5, today), 1)
assert.equal(countMyLateDays([{ date: '2026-10-26', clockIn: '09:05' }], '09:00', 5, today), 0)
assert.equal(countMyLateDays([{ date: '2026-10-03', clockIn: '11:00' }], '09:00', 5, today), 0, '주말은 지각이 아님')
assert.equal(countMyLateDays([{ date: '2026-10-05', clockIn: '11:00' }], '09:00', 5, today), 0, '대체공휴일은 지각이 아님')
assert.equal(countMyLateDays([{ date: '2026-10-28', clockIn: '11:00' }], '09:00', 5, today), 0, '오늘 이후는 제외')
assert.equal(countMyLateDays([{ date: '2026-10-26', clockIn: '09:06' }], '', 5, today), null)
const clock = (patch: Partial<AttendanceClock> = {}): AttendanceClock => ({ date: '2026-10-26', clockIn: '09:00', clockOutAt: '2026-10-26T20:00:00+09:00', ...patch })
const actual = { requestId: 'overtime', startAt: '2026-10-26T18:00:00+09:00', endAt: '2026-10-26T20:00:00+09:00', breakMinutes: 15, revision: 1, savedAt: '' }
const overtime = (clocks: AttendanceClock[], requests: PersonalRequest[] = [], reports: typeof actual[] = []) => actualOvertimeHours(clocks, requests, '12:00', '13:00', '2026-10', today, '09:00', reports)
assert.equal(overtime([clock()]), 0, '야근 신청 없는 늦은 퇴근 제외')
assert.equal(overtime([clock()], [request({})]), 0, '실제 야근 미입력 제외')
assert.equal(overtime([clock()], [request({})], [actual]), 1.75)
assert.equal(overtime([], [request({})], [actual]), 1.75, '외근 등도 출퇴근 추정 대신 본인 실제 야근 입력으로 계산')
assert.equal(overtime([], [request({status:'pending'})], [actual]), 0)
assert.equal(overtime([], [request({kind:'offsite'})], [actual]), 0)
console.log('my-attendance-summary.verify ok')
