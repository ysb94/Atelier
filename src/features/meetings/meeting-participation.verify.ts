import assert from 'node:assert/strict'
import { buildOngoingMeetingParticipation, buildMeetingParticipationSummary } from './meeting-participation'
import type { MeetingPerson, MeetingSeries } from './meeting-schedule'

const viewer: MeetingPerson = { id: 'viewer', name: '조회자' }
const member: MeetingPerson = { id: 'member', name: '참석자' }
const other: MeetingPerson = { id: 'other', name: '다른 호스트' }
const meeting = (id: string, changes: Partial<MeetingSeries> = {}): MeetingSeries => ({
  id, title: id, host: viewer, members: [member], status: 'in_progress',
  phase: 'published', createdBy: viewer.id, durationMinutes: 60, rounds: [], ...changes,
})
let checks = 0
function check(name: string, run: () => void) { run(); checks++; console.log('ok', name) }

check('zero meetings', () => assert.equal(buildOngoingMeetingParticipation([], viewer, false).size, 0))
check('done meetings excluded', () => assert.equal(buildOngoingMeetingParticipation([meeting('done', { status: 'done' })], viewer, true).size, 0))
check('host and repeated member IDs counted once per meeting', () => {
  const map = buildOngoingMeetingParticipation([meeting('dedupe', { host: member, members: [member, member, viewer] })], viewer, false)
  assert.equal(map.get(member.id)?.count, 1); assert.equal(map.get(viewer.id)?.count, 1)
})
check('distinct meetings with identical titles retained', () => {
  const value = buildOngoingMeetingParticipation([meeting('a', { title: '같은 제목' }), meeting('b', { title: '같은 제목' })], viewer, false).get(member.id)!
  assert.equal(value.count, 2); assert.equal(value.visibleMeetings.length, 2)
  assert.deepEqual(value.visibleMeetings.map(item => item.id), ['a', 'b'])
})
check('hidden title and meeting ID never enter returned summaries', () => {
  const map = buildOngoingMeetingParticipation([meeting('public'), meeting('secret-meeting-id', { title: 'CONFIDENTIAL_TITLE_DO_NOT_EXPOSE', host: other, members: [member] })], viewer, false)
  const value = map.get(member.id)!
  assert.equal(value.count, 2); assert.equal(value.hiddenCount, 1)
  assert.deepEqual(value.visibleMeetings.map(item => item.title), ['public'])
  assert.equal(value.count, value.visibleMeetings.length + value.hiddenCount)
  const serialized = JSON.stringify([...map]); assert(!serialized.includes('CONFIDENTIAL_TITLE_DO_NOT_EXPOSE')); assert(!serialized.includes('secret-meeting-id'))
})
check('admin can view other published meetings', () => {
  const value = buildOngoingMeetingParticipation([meeting('published', { host: other, members: [member] })], viewer, true).get(member.id)!
  assert.equal(value.visibleMeetings.length, 1); assert.equal(value.hiddenCount, 0)
})
check('preparing in-progress meetings count but remain private to host or creator', () => {
  const draft = meeting('draft', { phase: 'preparing', host: other, createdBy: other.id, members: [member, viewer] })
  const value = buildOngoingMeetingParticipation([draft], viewer, true).get(member.id)!
  assert.equal(value.count, 1); assert.equal(value.hiddenCount, 1); assert.equal(value.visibleMeetings.length, 0)
  assert.equal(buildOngoingMeetingParticipation([draft], other, false).get(member.id)?.visibleMeetings.length, 1)
  assert.equal(buildOngoingMeetingParticipation([{ ...draft, createdBy: viewer.id }], viewer, false).get(member.id)?.visibleMeetings.length, 1)
})
check('empty title gets safe fallback; long title preserved', () => {
  const long = '긴 제목 '.repeat(200)
  const value = buildOngoingMeetingParticipation([meeting('empty', { title: '   ' }), meeting('long', { title: long })], viewer, false).get(member.id)!
  assert.equal(value.visibleMeetings[0]?.title, '제목 없는 회의'); assert.equal(value.visibleMeetings[1]?.title, long.trim())
})
check('all participants have reconciled counts and input remains unchanged', () => {
  const input = [meeting('a'), meeting('b', { host: other, members: [member, other] }), meeting('done', { status: 'done' })]
  const before = JSON.stringify(input)
  for (const value of buildOngoingMeetingParticipation(input, viewer, false).values()) assert.equal(value.count, value.visibleMeetings.length + value.hiddenCount)
  assert.equal(JSON.stringify(input), before)
})
console.log(`meeting-participation.verify: ${checks} checks passed`)

const rows = [{ profile_id: 'other-department', titles: ['타부서 확정 회의', '같은 제목', '같은 제목'] }, { profile_id: 'empty', titles: [] }]
const before = JSON.stringify(rows)
const summaries = buildMeetingParticipationSummary(rows)
assert.equal(summaries.get('other-department')?.count, 3)
assert.deepEqual(summaries.get('other-department')?.visibleMeetings.map(item => item.title), rows[0].titles)
assert.equal(new Set(summaries.get('other-department')?.visibleMeetings.map(item => item.id)).size, 3)
assert.equal(summaries.get('empty')?.count, 0)
for (const summary of summaries.values()) { assert.equal(summary.count, summary.visibleMeetings.length); assert.equal(summary.hiddenCount, 0) }
assert.equal(JSON.stringify(rows), before)
console.log('meeting-participation-summary: 제목 전용 응답·건수 일치·같은 제목 개별 표시·0건·입력 보존 통과')
