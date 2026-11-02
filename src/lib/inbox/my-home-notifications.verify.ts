import assert from 'node:assert/strict'
import { myHomeNotificationSummary, notificationNeedsAttention, sameNotificationEvent, type MyHomeNotificationRecord } from './my-home-notifications'

const record: MyHomeNotificationRecord = {
  id: 'invitation', target: { source: 'meeting', entityId: 'round', eventVersion: '1', tab: 'meetings', href: '/settings/profile?part=meetings' },
  title: '회의 초대', body: '', createdAt: '2026-11-02T00:00:00Z', readAt: null, current: true,
  action: { key: 'meeting:round:1:respond', label: '참석 응답 필요' },
}
assert.equal(notificationNeedsAttention(record), true)
const read = { ...record, readAt: '2026-11-02T00:01:00Z' }
assert.equal(notificationNeedsAttention(read), true, 'Reading must not resolve a pending response')
assert.deepEqual(myHomeNotificationSummary([read]), { unread: 0, pending: 1 })
assert.deepEqual(myHomeNotificationSummary([record, { ...record, id: 'change' }]), { unread: 2, pending: 1 }, 'One business task is counted once')
assert.equal(notificationNeedsAttention({ ...read, action: null }), false)
assert.equal(notificationNeedsAttention({ ...record, current: false }), false, 'Cancelled or superseded requests leave the attention queue')
assert.deepEqual(myHomeNotificationSummary([record], 'overtime'), { unread: 0, pending: 0 })
assert.equal(sameNotificationEvent(record.target, { ...record.target, eventVersion: '2' }), false, 'An old drawer cannot read a new schedule change')
assert.equal(sameNotificationEvent(record.target, record.target), true)
console.info('My home notification state verification passed')
