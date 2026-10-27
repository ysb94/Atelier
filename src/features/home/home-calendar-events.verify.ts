import assert from 'node:assert/strict'
import type { MeetingPerson, MeetingSeries } from '../meetings/meeting-schedule.ts'
import type { PersonalRequest } from '../settings/personal-requests.ts'
import { homeCalendarWindow, homeLeaveEvents, homeMeetingEvents } from './home-calendar-events.ts'

const mine = 'user-1'
const other = 'user-2'
const person = (id: string): MeetingPerson => ({ id, name: id })
const series = (patch: Partial<MeetingSeries>): MeetingSeries => ({
  id: 'series', title: '주간 회의', host: person(mine), members: [person(other)], status: 'in_progress', durationMinutes: 60, rounds: [], ...patch,
})
const round = (id: string, startsAt: string, confirmed = true) => ({
  id, confirmed, round: 1, startsAt, roomId: '', quarterId: 'q1' as const, prepMaterials: [], content: '', result: '', durationMinutes: 30,
})
const request = (patch: Partial<PersonalRequest>): PersonalRequest => ({
  id: 'leave', kind: 'annual', from: '2026-10-15', to: '2026-10-15', start: '09:00', end: '18:00', place: '', note: '', status: 'approved', createdAt: '2026-10-01', ...patch,
})

const window = homeCalendarWindow('2026-10')
assert.equal(window.from, '2026-09-24')
assert.equal(window.to, '2026-11-07')

const meetings = homeMeetingEvents([
  series({ rounds: [round('shown', '2026-10-08T10:00'), round('draft', '2026-10-09T11:00', false), round('outside', '2026-12-01T10:00')] }),
  series({ id: 'foreign', host: person(other), members: [person('user-3')], rounds: [round('hidden', '2026-10-08T15:00')] }),
], mine, window.from, window.to)
assert.deepEqual(meetings.map(event => event.id), ['meeting:shown'])
assert.equal(meetings[0]?.title, '주간 회의')
assert.equal(meetings[0]?.time, '10:00')
assert.equal(meetings[0]?.category, 'meeting')

const leaves = homeLeaveEvents([
  request({ id: 'annual' }),
  request({ id: 'span', kind: 'offsite', from: '2026-10-20', to: '2026-10-21', start: '10:00', end: '16:00', place: '거래처', note: '미팅' }),
  request({ id: 'half', kind: 'half', start: '14:00', end: '18:00', status: 'pending' }),
  request({ id: 'overtime', kind: 'overtime', start: '18:00', end: '21:00' }),
  request({ id: 'fix', kind: 'correction' }),
  request({ id: 'rejected', status: 'rejected' }),
], window.from, window.to)
assert.deepEqual(leaves.map(event => `${event.id}:${event.title}:${event.time}`), [
  'leave:annual:2026-10-15:연차:종일',
  'leave:span:2026-10-20:외근:10:00',
  'leave:span:2026-10-21:외근:10:00',
  'leave:half:2026-10-15:오후 반차 (승인 대기):14:00',
  'leave:overtime:2026-10-15:야근 18:00–21:00:18:00',
])
assert.equal(leaves.find(event => event.id.startsWith('leave:span'))?.note, '거래처 · 미팅')
console.log('home-calendar-events.verify ok')
