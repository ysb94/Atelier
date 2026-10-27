import assert from 'node:assert/strict'
import type { MeetingSeries } from './meeting-schedule'
import { MEETING_REMINDER_LEAD_MS, meetingNoticeDue, meetingNoticeStorageKey, upcomingMeetingNotices } from './meeting-start-reminders'

const series: MeetingSeries = {
  id: 'series', title: '주간 회의', phase: 'published', status: 'in_progress', durationMinutes: 60,
  host: { id: 'host', name: '호스트' }, members: [{ id: 'member', name: '멤버' }],
  rounds: [{ id: 'round', round: 1, confirmed: true, scheduleVersion: 1, startsAt: '2030-01-08T10:00', roomId: 'room-1', quarterId: 'q1', prepMaterials: [], content: '', result: '' }],
}
const [notice] = upcomingMeetingNotices([series], 'host')
assert.equal(notice.startsAtMs, Date.parse('2030-01-08T01:00:00Z'), '기기 시간대와 무관하게 한국 시각 사용')
assert.equal(notice.role, '호스트')
assert.equal(upcomingMeetingNotices([series], 'member')[0].role, '멤버')
assert.equal(upcomingMeetingNotices([series], 'admin-not-in-meeting').length, 0, '조회 가능한 운영자여도 내 회의만 알림')
assert.equal(upcomingMeetingNotices([series], '').length, 0)
assert.equal(meetingNoticeDue(notice, notice.startsAtMs - MEETING_REMINDER_LEAD_MS - 1), false)
assert.equal(meetingNoticeDue(notice, notice.startsAtMs - MEETING_REMINDER_LEAD_MS), true, '정확히 30분 전')
assert.equal(meetingNoticeDue(notice, notice.startsAtMs - 1), true, '늦게 접속해도 시작 전까지 안내')
assert.equal(meetingNoticeDue(notice, notice.startsAtMs), false, '시작 이후 만료')
for (const patch of [{ status: 'done' as const }, { phase: 'preparing' as const }, { rounds: [{ ...series.rounds[0], confirmed: false }] }, { rounds: [{ ...series.rounds[0], startsAt: '' }] }]) {
  assert.equal(upcomingMeetingNotices([{ ...series, ...patch }], 'host').length, 0)
}
const changed = (patch: Partial<MeetingSeries['rounds'][number]>) => upcomingMeetingNotices([{ ...series, rounds: [{ ...series.rounds[0], ...patch }] }], 'host')[0]
for (const patch of [{ scheduleVersion: 2 }, { startsAt: '2030-01-08T10:30' }, { roomId: 'room-2' }, { durationMinutes: 90 }]) {
  assert.notEqual(changed(patch).token, notice.token, '재확정된 일정은 다시 확인')
}
assert.equal(changed({ content: '회의 내용만 변경' }).token, notice.token, '본문 수정은 반복 알림 없음')
assert.notEqual(meetingNoticeStorageKey('company', 'host', 'round'), meetingNoticeStorageKey('company', 'member', 'round'))
assert.notEqual(meetingNoticeStorageKey('company', 'host', 'round'), meetingNoticeStorageKey('another-company', 'host', 'round'))
assert.equal(notice.href, '/settings/profile?part=meetings&meeting=series&round=round')
assert.deepEqual(upcomingMeetingNotices([{ ...series, rounds: [{ ...series.rounds[0], id: 'later', startsAt: '2030-01-08T11:00' }, series.rounds[0]] }], 'host').map(item => item.roundId), ['round', 'later'])
console.log('meeting-start-reminders: 한국 시각, 30분 경계, 호스트·멤버, 비참석자 제외, 확정·완료, 재확정, 계정별 확인 상태 통과')
