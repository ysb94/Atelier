import assert from 'node:assert/strict'
import { inheritRoundMembers, roundAttendees, roundMembers, roundRole } from './meeting-round-members'
import type { MeetingPerson, MeetingSeries } from './meeting-schedule'

const person = (id: string) => ({ id, name: id } as MeetingPerson)
const series: MeetingSeries = {
  id: 'series', title: '회차별 명단', host: person('host'), members: [person('A'), person('B')],
  status: 'in_progress', durationMinutes: 60,
  rounds: [{ id: 'first', round: 1, startsAt: '', roomId: '', quarterId: 'q1', content: '', result: '', prepMaterials: [] }],
}
assert.deepEqual(roundAttendees(series, series.rounds[0]).map(p => p.id), ['A', 'B'])
const second = { ...series.rounds[0], id: 'second', round: 2, membership: [
  { person: person('A'), role: 'attendee' as const },
  { person: person('B'), role: 'result' as const },
  { person: person('C'), role: 'excluded' as const },
] }
series.rounds.push(second)
assert.deepEqual(roundAttendees(series, second).map(p => p.id), ['A'])
assert.equal(roundRole(series, second, 'B'), 'result')
assert.equal(roundRole(series, second, 'C'), 'excluded')
assert.equal(roundRole(series, second, 'host'), 'attendee')
assert.deepEqual(inheritRoundMembers(series).map(m => [m.person.id, m.role]), [['A', 'attendee'], ['B', 'result']])
assert.deepEqual(roundAttendees(series, series.rounds[0]).map(p => p.id), ['A', 'B'], '이전 회차 명단 보존')
assert.deepEqual(roundMembers(series, { ...second, membership: [] }), [], '빈 명단을 이전 명단으로 복원하지 않음')
assert.equal(roundRole(series, { ...second, membership: [] }, 'B'), 'excluded')
assert.deepEqual(roundAttendees(series, { ...second, membership: [
  { person: person('host'), role: 'attendee' },
  { person: person('A'), role: 'attendee' },
  { person: person('A'), role: 'attendee' },
] }).map(p => p.id), ['A'], '호스트·중복 인원 제외')
console.log('meeting-round-members: legacy, round isolation, result-only, inheritance, empty roster and dedup passed')
