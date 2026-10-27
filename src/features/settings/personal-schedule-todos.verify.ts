import assert from 'node:assert/strict'
import { parseScheduleTodos } from './personal-schedule-todos.ts'

const parsed = parseScheduleTodos([
  { id: 'a', date: '2026-10-27', title: '  샘플 확인  ', done: false },
  { id: 'a', date: '2026-10-28', title: '중복', done: true },
  { id: 'b', date: '10-27', title: '날짜 오류', done: false },
  { id: '', date: '2026-10-27', title: '빈 id', done: false },
  { id: 'c', date: '2026-10-27', title: '   ', done: true },
  null,
  'todo',
])

assert.deepEqual(parsed, [{ id: 'a', date: '2026-10-27', title: '샘플 확인', done: false }])
assert.deepEqual(parseScheduleTodos({ id: 'a' }), [])
assert.equal(parseScheduleTodos([{ id: 'd', date: '2026-10-27', title: '끝', done: 1 }])[0]?.done, false)
console.log('personal-schedule-todos.verify ok')
