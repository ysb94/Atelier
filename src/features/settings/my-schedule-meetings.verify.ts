import assert from 'node:assert/strict'
import type { MeetingRound, MeetingSeries } from '../meetings/meeting-schedule'
import { myScheduleMeetings } from './my-schedule-meetings'

const host = { id: 'host', name: '호스트' }, member = { id: 'member', name: '참석자' }
const round = (patch: Partial<MeetingRound> = {}): MeetingRound => ({
  id: 'round', round: 2, startsAt: '2026-11-02T10:00', roomId: 'room', quarterId: 'q1',
  confirmed: true, durationMinutes: 90, responses: [{ profileId: member.id, status: 'pending' }],
  prepMaterials: [], content: '', result: '', ...patch,
})
const series = (patch: Partial<MeetingSeries> = {}): MeetingSeries => ({
  id: 'series', title: '기획 회의', kind: 'project', phase: 'published', host, members: [member],
  status: 'in_progress', durationMinutes: 60, rounds: [round()], ...patch,
})
const events = (item: MeetingSeries, user = member.id) => myScheduleMeetings([item], user, '2026-11')
assert.equal(events(series(), host.id).length, 1, '호스트는 응답 대기 중이어도 등록된 일정 표시')
assert.equal(events(series({ phase: 'preparing', rounds: [round({ confirmed: false })] }), host.id).length, 1, '호스트는 본인의 준비 일정도 날짜 등록 후 표시')
assert.equal(events(series()).length, 0, '응답 전에는 멤버 달력에 표시하지 않음')
assert.equal(events(series({ rounds: [round({ responses: [{ profileId: member.id, status: 'unavailable' }] })] })).length, 0)
const accepted = series({ rounds: [round({ responses: [{ profileId: member.id, status: 'available' }] })] })
const event = events(accepted)[0]!
assert.equal(event.end, '11:30'); assert.equal(event.round, 2); assert.equal(event.isHost, false)
assert.equal(event.href, '/settings/profile?part=meetings&meeting=series&round=round')
assert.equal(events(accepted, 'other').length, 0, '다른 직원의 일정 제외')
assert.equal(events({ ...accepted, members: [] }).length, 0, '멤버에서 제거되면 남은 응답이 있어도 제외')
assert.equal(events({ ...accepted, phase: 'preparing' }).length, 0, '준비 중 일정은 멤버에게 숨김')
assert.equal(events({ ...accepted, rounds: [round({ confirmed: false, responses: accepted.rounds[0].responses })] }).length, 0)
assert.equal(events({ ...accepted, rounds: [round({ manualConfirmation: { excludedIds: [member.id], decidedAt: '2026-11-02', actorId: host.id }, responses: accepted.rounds[0].responses })] }).length, 0, '수동 확정에서 제외된 멤버는 숨김')
assert.equal(events({ ...accepted, rounds: [round({ startsAt: '2026-11-03T11:00', scheduleVersion: 2, responses: [] })] }).length, 0, '일정 변경으로 응답 초기화되면 달력에서 제거')
assert.equal(events(series({ kind: 'meeting' })).length, 1, '응답 없는 미팅은 멤버도 즉시 표시')
assert.equal(events(series({ kind: 'interview' })).length, 0, '면접은 참석 응답 필요')
assert.equal(events(series({ rounds: [round({ startsAt: '' })] }), host.id).length, 0, '날짜 없는 회차 제외')
assert.equal(events(series({ rounds: [round({ startsAt: '2026-12-01T10:00' })] }), host.id).length, 0, '다른 달 제외')
assert.equal(events({ ...accepted, status: 'done' }).length, 1, '완료한 회의의 기존 일정은 보존')
assert.equal(myScheduleMeetings([], member.id, '2026-11').length, 0, '삭제한 회의는 제거')
assert.equal(myScheduleMeetings([accepted], '', '2026-11').length, 0)
const before = JSON.stringify(accepted)
events(accepted);assert.equal(JSON.stringify(accepted), before, '조회 원본을 수정하지 않음')
console.log('my-schedule-meetings: 호스트 등록·멤버 수락·불참·수락 초기화·수동 제외·미팅·면접·회차 링크·완료 이력·원본 보존 통과')
