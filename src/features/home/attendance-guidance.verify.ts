import assert from 'node:assert/strict'
import { workdayGuidance, previousMissingClock, validatePreviousClockOut, workInstant } from './attendance-guidance.ts'
import { clockOutLabel } from '../settings/my-attendance.ts'
import type { PersonalRequest } from '../settings/personal-requests.ts'
const date='2026-10-26', today='2026-10-27'
const basis={date,start:'09:00',lunchStart:'12:00',lunchEnd:'13:00',configured:true}
const request=(kind:PersonalRequest['kind'],start:string,end:string,status:PersonalRequest['status']='approved'):PersonalRequest=>({id:kind,kind,from:date,to:date,start,end,status,note:'검증',place:'',createdAt:'2026-10-25'})
const end=(requests:PersonalRequest[]=[],start='09:00')=>workdayGuidance(date,{...basis,start},requests).end
assert.equal(end(),workInstant(date,'18:00'))
assert.equal(end([],'10:00'),workInstant(date,'19:00'))
assert.equal(workdayGuidance(date,{...basis,start:'20:00'},[]).end,workInstant(today,'04:00'))
assert.equal(workdayGuidance(date,basis,[request('half','09:00','14:00')]).start,workInstant(date,'14:00'))
assert.equal(end([request('half','14:00','18:00')]),workInstant(date,'14:00'))
assert.equal(end([request('quarter','16:00','18:00')]),workInstant(date,'16:00'))
assert.equal(end([request('quarter','11:00','14:00')]),workInstant(date,'18:00'))
assert.equal(end([request('overtime','18:00','21:00')]),workInstant(date,'21:00'))
for(const status of ['pending','rejected','cancelled'] as const)assert.equal(end([request('overtime','18:00','21:00',status)]),workInstant(date,'18:00'))
assert.equal(end([request('offsite','09:00','16:00')]),workInstant(date,'18:00'))
assert.equal(end([request('annual','09:00','18:00')]),null)
assert.equal(workdayGuidance(date,basis,[request('official','09:00','18:00')]).fullLeave,true)
assert.equal(workdayGuidance(date,null,[]).end,null)
const previous={date,clockIn:'09:00',clockOutAt:null}
const current={date:today,clockIn:'09:03',clockOutAt:null}
assert.equal(previousMissingClock([current,previous],[],today),previous)
assert.equal(previousMissingClock([previous,{date:'2026-10-27',clockIn:'09:00',clockOutAt:'2026-10-27T09:00:00Z'}],[],'2026-10-28'),null,'직전 날이 완료됐으면 더 이전 미기록은 묻지 않음')
assert.equal(previousMissingClock([{...previous,date:'2026-10-23'}],[],date),null,'기준일 이전은 안내하지 않음')
assert.equal(previousMissingClock([previous],[], '2026-11-02'),previous,'주말·휴일보다 실제 마지막 출근일을 선택')
for(const status of ['pending','approved'] as const)assert.equal(previousMissingClock([previous],[request('correction','09:00','18:00',status)],today),null)
assert.equal(previousMissingClock([previous],[request('annual','09:00','18:00')],today),previous,'휴가일이어도 실제 출근한 기록은 확인')
assert.equal(validatePreviousClockOut(previous,current,workInstant(date,'18:00')),'')
assert.equal(validatePreviousClockOut(previous,current,workInstant(today,'01:00')),'','다음날 새벽 퇴근 허용')
assert.ok(validatePreviousClockOut(previous,current,workInstant(date,'08:59')))
assert.ok(validatePreviousClockOut(previous,current,workInstant(today,'09:04')))
assert.equal(workInstant('2026-02-30','18:00'),null)
assert.equal(clockOutLabel('2026-10-26T16:00:00Z',date),'2026-10-27 01:00')
console.log('attendance-guidance: 근무 기준·휴가·야근·직전 출근일·정정 상태·새벽 퇴근·범위 검증 통과')
