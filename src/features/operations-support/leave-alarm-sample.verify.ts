import assert from 'node:assert/strict'
import { createLeaveAlarmSamples, LEAVE_SAMPLE_DEVELOPER, LEAVE_SAMPLE_PHASES, sampleNotifications, sampleReceipt, sampleToday } from './leave-alarm-sample'

const now = new Date('2026-10-28T01:00:00Z')
const records = createLeaveAlarmSamples(LEAVE_SAMPLE_PHASES, now)
assert.equal(records.length, 3)
assert.equal(new Set(records.map(row => row.id)).size, 3)
assert.deepEqual(records.map(row => row.phase), [...LEAVE_SAMPLE_PHASES])
assert.deepEqual(records.map(row => row.simulatedOn), ['2026-10-28', '2026-12-28', '2027-01-14'])
assert.ok(records.every(row => row.recipientId === LEAVE_SAMPLE_DEVELOPER && row.expiresOn === '2027-01-28' && row.remaining === 7 && !row.viewedAt && !row.confirmedAt))
assert.equal(sampleToday(new Date('2026-10-27T16:00:00Z')), '2026-10-28')
assert.equal(createLeaveAlarmSamples(['threeMonths'], new Date('2026-11-30T03:00:00Z'))[0].expiresOn, '2027-02-28')
const issued = records[0]
const confirmed = { ...issued, viewedAt: now.toISOString(), confirmedAt: now.toISOString() }
assert.equal(confirmed.body, issued.body, '발송 당시 원문은 본인 확인 후에도 유지')
assert.match(sampleReceipt(confirmed), /법적 증빙 아님/)
assert.ok(records.every(row => !row.body.includes('제출')))
assert.ok(sampleNotifications(records).every(row => !row.href.startsWith('/operations-support') && !row.body.includes('예정일')))
assert.equal(sampleNotifications(records).filter(row => !row.readAt).length, 3)
const read = records.map(row => ({ ...row, readAt: now.toISOString() }))
assert.equal(sampleNotifications(read).filter(row => !row.readAt).length, 0)
assert.ok(read.every(row => !row.viewedAt && !row.confirmedAt), '알림 읽음은 안내문 열람·본인 확인과 구분')
console.log('leave-alarm-sample: 3단계, 한국 날짜/월말, 개발자 수신, 확인 전용 동선, 읽음·열람·확인 분리와 원문 보존 통과')
