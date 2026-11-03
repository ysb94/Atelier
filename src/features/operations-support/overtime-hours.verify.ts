import assert from 'node:assert/strict'
import { monthlyOvertimeHours, durationInputMinutes, durationInputValue, formatDurationClock, parseDurationClock, workDurationLabel, workedMinutes } from './overtime-hours.ts'
import { registeredOvertime, type OvertimeActual, type OvertimeRequest } from './overtime-actuals.ts'
const request: OvertimeRequest = { id: 'r', employeeId: 'a', kind: 'overtime', status: 'approved', from: '2026-10-26', to: '2026-10-26', start: '18:00', end: '22:00' }
const actual: OvertimeActual = { requestId: 'r', startAt: '2026-10-26T18:30:00+09:00', endAt: '2026-10-26T21:00:00+09:00', breakMinutes: 30, revision: 1, savedAt: '' }
const total = (requests = [request], reports = [actual]) => monthlyOvertimeHours([{ employeeId: 'a', date: '2026-10-26', clockIn: '09:00', clockOutAt: '2026-10-26T23:00:00+09:00' }], requests, '12:00', '13:00', '2026-10', '2026-10-27', new Map(), reports)
assert.equal(total()[0].extraMinutes, 120, '실제 입력 구간에서 휴게시간만 차감')
assert.equal(total()[0].approvedMinutes, 240)
assert.deepEqual(total([], []), [], '늦은 퇴근만으로 야근 목록 생성 금지')
assert.deepEqual(total([request], []), [], '승인만 받고 실제 입력이 없는 신청 제외')
for (const status of ['pending', 'rejected', 'cancelled']) assert.deepEqual(total([{ ...request, status }]), [])
assert.deepEqual(total([{ ...request, kind: 'offsite' }]), [], '외근 자동 출퇴근을 야근으로 만들지 않음')
assert.deepEqual(total([request], [{ ...actual, requestId: 'other' }]), [])
assert.deepEqual(total([request], [{ ...actual, startAt: '2026-10-26T17:00:00+09:00' }]), [])
assert.deepEqual(total([request], [{ ...actual, endAt: '2026-10-26T23:00:00+09:00' }]), [])
for (const breakMinutes of [-1, 151, 0.5, NaN]) assert.deepEqual(total([request], [{ ...actual, breakMinutes }]), [])
assert.equal(total([request], [actual, { ...actual, revision: 2, breakMinutes: 0 }, actual])[0].extraMinutes, 150, '수정 이력과 중복 응답은 최신 1건만 합산')
assert.equal(registeredOvertime([request], [actual], '2026-11', '2026-11-01').length, 0)
assert.equal(registeredOvertime([request], [actual], '2026-10', '2026-10-25').length, 0)
const night = { ...request, start: '22:00', end: '02:00', endNextDay: true }
const nightActual = { ...actual, startAt: '2026-10-26T23:00:00+09:00', endAt: '2026-10-27T01:30:00+09:00', breakMinutes: 15 }
assert.equal(total([night], [nightActual])[0].extraMinutes, 135)
assert.equal(workedMinutes('2026-10-26','09:00','2026-10-26T18:00:00+09:00','12:00','13:00'), 480)
assert.equal(workDurationLabel(135), '2시간 15분')
assert.equal(formatDurationClock(240), '4:00')
assert.equal(formatDurationClock(90), '1:30')
assert.equal(parseDurationClock('4:00'), 240)
assert.equal(parseDurationClock('3:30'), 210)
assert.equal(parseDurationClock('240'), null)
assert.equal(durationInputValue('240'), '4:00')
assert.equal(durationInputMinutes('240'), 240)
assert.equal(durationInputMinutes('3:30'), 210)
console.info('Overtime: approval + explicit actual only; late clock-outs/offsite/pending/missing reports excluded; breaks, revisions, midnight and month boundaries passed')
