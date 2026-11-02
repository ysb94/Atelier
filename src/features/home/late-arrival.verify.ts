import assert from 'node:assert/strict'
import { LATE_ATTACHMENT_LIMIT, LATE_ATTACHMENT_MAX_BYTES, cumulativeLateText, cumulativeLateTotal, lateAttachmentError, lateConfirmStamp, lateMinutes } from './late-arrival.ts'

assert.equal(lateMinutes('09:00', '09:05'), 0)
assert.equal(lateMinutes('09:00', '09:06'), 6)
assert.equal(lateMinutes('10:00', '10:09'), 9)
assert.equal(lateMinutes('', '09:10'), 0)
assert.equal(LATE_ATTACHMENT_LIMIT, 5)
assert.equal(lateAttachmentError('지연증명.txt', 10), '')
assert.equal(lateAttachmentError('virus.exe', 10), '20MB 이하의 실행 파일이 아닌 서류만 올려 주세요.')
assert.equal(lateAttachmentError('big.pdf', LATE_ATTACHMENT_MAX_BYTES + 1), '20MB 이하의 실행 파일이 아닌 서류만 올려 주세요.')
const clocks = [
  { date: '2025-12-31', clockIn: '18:00' },
  { date: '2026-10-03', clockIn: '11:00' },
  { date: '2026-10-05', clockIn: '11:00' },
  { date: '2026-10-26', clockIn: '09:06' },
  { date: '2026-10-26', clockIn: '11:00' },
  { date: '2026-10-27', clockIn: '10:34' },
  { date: '2026-11-02', clockIn: '11:00' },
]
const total = cumulativeLateTotal(clocks, date => date.startsWith('2026-10') ? '09:00' : '10:00', '2026-10-27')
assert.deepEqual(total, { count: 2, minutes: 100 })
assert.equal(cumulativeLateText(total), '2회 (1시간 40분)')
assert.equal(cumulativeLateText({ count: 17, minutes: 94 }), '17회 (1시간 34분)')
assert.equal(cumulativeLateText({ count: 1, minutes: 6 }), '1회 (6분)')
assert.equal(cumulativeLateText({ count: 2, minutes: 120 }), '2회 (2시간)')
assert.equal(cumulativeLateText({ count: 0, minutes: 0 }), '0회 (0분)')
assert.deepEqual(cumulativeLateTotal([{ date: '2026-10-26', clockIn: '09:06' }], () => '', '2026-10-27'), { count: 0, minutes: 0 })
assert.equal(lateConfirmStamp('김민수', '2026-11-01T16:00:00Z'), '김민수 2026.11.2')
assert.equal(lateConfirmStamp('부서장 없음', null), '부서장 없음')
console.log('late-arrival.verify ok')
