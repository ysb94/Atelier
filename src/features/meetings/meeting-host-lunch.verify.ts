import assert from 'node:assert/strict'
import { meetingOverlapsLunch, resolveStartTimeState } from './meeting-slots'
import { canDeleteMeetingSeries } from './meeting-schedule'

const lunch={start:'12:30',end:'13:30'}
for(const [clock,duration,expected] of [['11:30',60,false],['11:30',90,true],['12:30',30,true],['13:00',60,true],['13:30',60,false]] as const)
  assert.equal(meetingOverlapsLunch(clock,duration,lunch),expected,`${clock} + ${duration}분 점심시간 경계`)
const input={dateKey:'2030-01-08',clock:'11:30',durationMinutes:60,attendees:[],attendance:[],occupants:[],now:new Date('2026-10-26T00:00:00Z')}
assert.equal(resolveStartTimeState(input).available,false,'기본 점심시간을 걸치는 시작도 차단')
assert.equal(resolveStartTimeState({...input,lunch}).available,true,'회사에 설정한 점심시간 사용')
assert.equal(resolveStartTimeState({...input,clock:'12:30',lunch}).reason,'점심시간 12:30–13:30')
assert.equal(canDeleteMeetingSeries({host:{id:'host',name:'호스트'}},{id:'member'}),false)
assert.equal(canDeleteMeetingSeries({host:{id:'host',name:'호스트'}},{id:'host'}),true)
console.log('meeting-host-lunch: 점심 부분 겹침·종료/시작 경계·회사 설정·호스트 삭제 제한 통과')
