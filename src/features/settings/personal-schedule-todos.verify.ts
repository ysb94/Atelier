import assert from 'node:assert/strict'
import { parseScheduleTodos, scheduleTodoError, scheduleTodoTime } from './personal-schedule-todos.ts'
import { availabilityConfirmationKey, availabilityTone, overlapsAvailability } from '../meetings/meeting-availability.ts'

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
const timed={date:'2026-10-27',title:'결산',start:'10:15',end:'11:45',important:true}
assert.equal(scheduleTodoError(timed),'')
for (const patch of [{date:'2026-02-30'},{start:''},{end:''},{end:'10:15'},{end:'09:00'},{start:'24:00'},{title:'  '}]) assert.ok(scheduleTodoError({...timed,...patch}))
assert.equal(scheduleTodoError({...timed,start:'',end:'',important:false}),'')
assert.equal(scheduleTodoTime({...timed,id:'timed',done:false}),'10:15–11:45')
const entry={id:'todo:uuid',personId:'employee',kind:'personal' as const,status:'approved' as const,start:'10:15',end:'11:45'}
assert.equal(availabilityTone(entry),'conflict')
assert.equal(overlapsAvailability(entry,'10:00',30),true)
assert.equal(overlapsAvailability(entry,'11:45',30),false)
assert.equal(overlapsAvailability(entry,'09:45',30),false)
assert.notEqual(availabilityConfirmationKey('same',[entry]),availabilityConfirmationKey('same',[{...entry,end:'12:00'}]))
console.log('schedule-todos: 실제 날짜·시간·중요 필수값·회의 경계·재확인 키 검증 통과')
