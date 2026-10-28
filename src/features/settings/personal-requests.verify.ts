import assert from 'node:assert/strict'
import { DEFAULT_REMINDER_BASIS as basis, reminderPreview, validateRequest, isSelfApprovedRequest, isDirectRegistration, requiresDepartmentApproval, requestStatusLabel, type RequestForm, type PersonalRequest } from './personal-requests.ts'
import { endAfterMinutes, leaveTimePresets, leaveWorkMinutes, rangeMinutes } from './request-time-options.ts'
const form: RequestForm = { kind: 'half', from: '2026-10-08', to: '2026-10-08', start: '09:00', end: '14:00', note: '', place: '' }
assert.deepEqual(leaveTimePresets('half').map(({start,end})=>[start,end]),[['09:00','14:00'],['14:00','18:00']])
assert.deepEqual(leaveTimePresets('quarter').map(({start,end})=>[start,end]),[['09:00','11:00'],['16:00','18:00']])
for (const kind of ['half','quarter'] as const) for (const preset of leaveTimePresets(kind)) {
  assert.equal(validateRequest({...form,kind,start:preset.start,end:preset.end},[],basis),'','빠른 선택도 기존 검증을 통과해야 함')
  assert.equal(leaveWorkMinutes(preset.start,preset.end),kind==='half'?240:120)
}
assert.equal(leaveWorkMinutes('11:00','14:00'),120,'점심시간은 휴가 사용시간에서 제외')
assert.equal(endAfterMinutes('18:07',90),'19:37','직접 입력한 분을 반올림하지 않음')
assert.equal(rangeMinutes('18:07','19:37'),90)
assert.equal(endAfterMinutes('23:30',30),null,'24:00으로 자동 변환하지 않음')
assert.equal(endAfterMinutes('23:45',60),null,'다음날로 자동 이동하지 않음')
assert.equal(endAfterMinutes('18:',60),null)
assert.equal(rangeMinutes('19:00','18:00'),null)
assert.equal(validateRequest(form,[],basis),'')
assert.match(reminderPreview(form,basis)[0],/14:00/)
assert.match(reminderPreview({...form,start:'14:00',end:'18:00'},basis)[1],/14:00/)
assert.match(validateRequest({...form,end:'13:00'},[],basis),/4시간/)
const quarter: RequestForm = {...form,kind:'quarter',end:'11:00'}
assert.equal(validateRequest(quarter,[],basis),'')
assert.match(reminderPreview(quarter,basis)[0],/11:00/)
assert.match(validateRequest({...quarter,start:'11:00',end:'13:00'},[],basis),/2시간/)
assert.match(reminderPreview({...quarter,start:'11:00',end:'14:00'},basis)[0],/09:00/)
assert.match(reminderPreview({...form,kind:'annual'},basis)[0],/보내지 않습니다/)
assert.match(reminderPreview({...form,kind:'overtime',start:'18:00',end:'21:00'},basis)[1],/21:00.*20:50/)
assert.match(validateRequest({...form,from:'2026-02-30',to:'2026-02-30'},[],basis),/시작일/)
assert.match(validateRequest({...form,kind:'overtime',start:'18:00',end:'21:00'},[],basis),/사유/)
assert.match(validateRequest({...form,kind:'offsite'},[],basis),/장소/)
assert.match(validateRequest({...form,kind:'official',from:'2026-10-08',to:'2026-10-09',note:''},[],basis),/사유/)
assert.equal(validateRequest({...form,kind:'official',from:'2026-10-08',to:'2026-10-09',note:'예비군'},[],basis),'')
const pending: PersonalRequest = {...form,id:'a',status:'pending',createdAt:'2026-10-07'}
assert.match(validateRequest(form,[pending],basis),/같은 시간/)
assert.equal(validateRequest(form,[{...pending,status:'cancelled'}],basis),'')
assert.equal(validateRequest(quarter,[{...pending,kind:'remote',start:'09:00',end:'18:00'}],basis),'')
assert.match(validateRequest({...form,kind:'annual'},[{...pending,kind:'remote',start:'09:00',end:'18:00'}],basis),/같은 시간/)
assert.equal(validateRequest({...form,kind:'overtime',start:'18:00',end:'21:00',note:'작업'},[pending],basis),'')
assert.match(validateRequest(form,[],{...basis,breakStart:'19:00',breakEnd:'20:00'}),/근무·휴게/)
assert.match(reminderPreview({...form,kind:'correction'},basis)[0],/변경하지 않습니다/)
const remoteWeek: PersonalRequest = {...pending,id:'remote',kind:'remote',from:'2026-10-07',to:'2026-10-09',start:'09:00',end:'18:00'}
assert.equal(validateRequest({...form,kind:'overtime',from:'2026-10-08',to:'2026-10-08',start:'18:00',end:'21:00',note:'마감'},[remoteWeek],basis),'')
assert.match(validateRequest({...form,kind:'offsite',from:'2026-10-08',to:'2026-10-08',start:'13:00',end:'15:00',place:'거래처'},[remoteWeek],basis),/같은 시간/)
assert.equal(validateRequest({...form,kind:'offsite',from:'2026-10-12',to:'2026-10-13',start:'10:00',end:'17:00',place:'거래처'},[remoteWeek],basis),'')
const correction: RequestForm = {...form,kind:'correction',from:'2026-10-12',to:'2026-10-12',start:'09:00',end:'18:00',note:'퇴근 누락'}
assert.equal(validateRequest(correction,[remoteWeek],basis,'2026-10-13'),'')
assert.match(validateRequest({...correction,from:'2026-10-14',to:'2026-10-14'},[],basis,'2026-10-13'),/앞으로의 날짜/)
assert.match(validateRequest(correction,[{...pending,...correction,id:'fix',status:'pending'}],basis,'2026-10-13'),/승인 대기 중인 출퇴근 정정/)
assert.equal(validateRequest(correction,[{...pending,...correction,id:'fix',status:'approved'}],basis,'2026-10-13'),'')
console.log('personal requests verify: ok (leave durations, break time, reminders, schedule conflicts, location overlaps, correction rules)')

for (const kind of ['annual','half','quarter','offsite'] as const) { assert.equal(isDirectRegistration(kind),true); assert.equal(requiresDepartmentApproval(kind),false);assert.equal(requestStatusLabel({...form,kind,status:'approved'}),'등록') }
for (const kind of ['overtime','correction'] as const) assert.equal(requiresDepartmentApproval(kind),true)
assert.equal(isDirectRegistration('official'),false)
assert.match(validateRequest({...form,kind:'remote'},[],basis),/재택은 등록할 수 없습니다/)
assert.equal(isSelfApprovedRequest({status:'approved',employeeId:'a',decidedBy:'a'}),true)
for(const record of [{status:'approved',employeeId:'a',decidedBy:null},{status:'approved',employeeId:'a',decidedBy:'b'},{status:'cancelled',employeeId:'a',decidedBy:'a'}] as const)assert.equal(isSelfApprovedRequest(record),false)
