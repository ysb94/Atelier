import assert from 'node:assert/strict'
import { checkoutCorrection, checkoutNoticeRoute } from './checkout-notice'
import { DEFAULT_REMINDER_BASIS, validateRequest, type PersonalRequest } from './personal-requests'
import type { AttendanceClock } from './my-attendance'

const rows: AttendanceClock[] = [
  { date: '2026-10-29', clockIn: '09:00', clockOutAt: null, autoClosedAt: '2026-10-29T20:00:00+09:00' },
  { date: '2026-10-30', clockIn: '09:00', clockOutAt: '2026-10-30T18:00:00+09:00' },
  { date: '2026-11-02', clockIn: '09:00', clockOutAt: null, autoClosedAt: '2026-11-02T20:00:00+09:00' },
]
assert.equal(checkoutNoticeRoute(rows, [], '2026-10-29', '2026-11-02'), 'correction', '오래된 자동 종료는 기존 정정 승인으로만 처리')
assert.equal(checkoutNoticeRoute(rows, [], '2026-10-30', '2026-11-02'), 'handled')
assert.equal(checkoutNoticeRoute(rows, [], '2026-11-02', '2026-11-02'), 'next-day')
assert.equal(checkoutNoticeRoute([], [], '2026-10-29', '2026-11-02'), 'missing')
const previous = [rows[0], rows[2]]
assert.equal(checkoutNoticeRoute(previous, [], '2026-10-29', '2026-11-02'), 'direct', '직전 출근일만 기존 확인으로 저장')
assert.equal(checkoutNoticeRoute([rows[0]], [], '2026-10-29', '2026-11-02'), 'clock-in')
const correction = checkoutCorrection('2026-10-29', '09:00:00', '2026-10-29T18:30:00+09:00', '퇴근 미기록 확인')
assert.equal(correction.start, '09:00'); assert.equal(correction.end, '18:30')
assert.equal(correction.kind, 'correction'); assert.equal(correction.endNextDay, false)
assert.equal(validateRequest(correction, [], DEFAULT_REMINDER_BASIS, '2026-11-02'), '')
const pending: PersonalRequest = { ...correction, id: 'pending', status: 'pending', createdAt: '2026-11-02' }
assert.equal(checkoutNoticeRoute(rows, [pending], '2026-10-29', '2026-11-02'), 'handled')
assert.notEqual(validateRequest(correction, [pending], DEFAULT_REMINDER_BASIS, '2026-11-02'), '', '기존 중복 신청 제한')
assert.notEqual(validateRequest({ ...correction, note: '' }, [], DEFAULT_REMINDER_BASIS), '', '정정 사유 필수')
assert.equal(checkoutCorrection('2026-10-29', '09:00', '2026-10-29T16:00:00Z', '새벽 퇴근').endNextDay, true)
assert.throws(() => checkoutCorrection('2026-10-29', '09:00', '2026-10-31T18:00:00+09:00', '범위 초과'))
assert.throws(() => checkoutCorrection('2026-10-29', '09:00', 'invalid', '잘못된 입력'))
console.log('checkout-notice: 오래된 자동 종료 정정 경로·직전일 확인·오늘/미출근/처리 완료·중복·사유·새벽·날짜 범위 검증 통과')
