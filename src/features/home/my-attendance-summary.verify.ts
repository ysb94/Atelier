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
const overtime = (clocks: AttendanceClock[], requests: PersonalRequest[] = []) => actualOvertimeHours(clocks, requests, '12:00', '13:00', '2026-10', today, '09:00')
assert.equal(overtime([clock()], [request({})]), 2, '승인 3시간이어도 실제 20시 퇴근이면 2시간')
assert.equal(overtime([clock({ clockOutAt: '2026-10-26T22:00:00+09:00' })], [request({})]), 4, '승인 신청시간으로 실제 야근을 제한하지 않음')
assert.equal(overtime([clock()]), 2, '야근 신청 없이도 실제 출퇴근으로 집계')
assert.equal(overtime([], [request({})]), 0, '승인된 신청만으로 근무시간을 만들지 않음')
assert.equal(overtime([clock({ clockOutAt: null, autoClosedAt: '2026-10-26T23:15:00+09:00' })], [request({})]), 0, '자동 종료는 실제 퇴근 기록이 아님')
assert.equal(overtime([clock({ autoClosedAt: '2026-10-26T23:15:00+09:00', clockOutReportedAt: '2026-10-27T09:00:00+09:00' })]), 2, '나중에 실제 퇴근을 등록하면 집계')
assert.equal(overtime([clock({ date: '2026-10-28', clockOutAt: '2026-10-28T20:00:00+09:00' }), clock({ date: '2026-11-02', clockOutAt: '2026-11-02T20:00:00+09:00' })]), 0, '미래와 다른 달 기록은 제외')
assert.equal(overtime([clock({ clockIn: '13:00', clockOutAt: '2026-10-26T18:00:00+09:00' })], [request({ kind: 'half', start: '09:00', end: '13:00' })]), 0, '오전 반차 후 18시까지는 정규 근무')
assert.equal(overtime([clock({ clockOutAt: '2026-10-26T17:00:00+09:00' })], [request({ kind: 'quarter', start: '16:00', end: '18:00' })]), 1, '반반차는 실제 근무 6시간 초과분')
assert.equal(overtime([clock()], [request({ kind: 'annual' })]), 0, '종일 휴가일은 운영지원과 같이 제외')
assert.equal(overtime([clock({ date: '2026-10-25', clockIn: '10:00', clockOutAt: '2026-10-25T14:00:00+09:00' })]), 3, '휴일은 점심을 뺀 근무 전체')
assert.equal(actualOvertimeHours([clock()], [], '12:00', '14:00', '2026-10', today, '09:00'), 1, '회사에 설정된 점심시간을 반영')
assert.equal(overtime([clock({ clockIn: '10:00', clockOutAt: '2026-10-26T21:00:00+09:00' })]), 3, '지각과 무관하게 예정 퇴근 이후 3시간')
assert.equal(actualOvertimeHours([clock()], [], '12:00', '13:00', '2026-10', today, ''), null, '출근 기준이 없으면 추정하지 않음')
console.log('my-attendance-summary.verify ok')
