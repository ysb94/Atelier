import assert from 'node:assert/strict'
import { DEFAULT_REMINDER_BASIS as basis, reminderPreview, validateRequest, type RequestForm, type PersonalRequest } from './personal-requests.ts'
const form: RequestForm = { kind: 'half', from: '2026-10-08', to: '2026-10-08', start: '09:00', end: '14:00', note: '', place: '' }
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
const pending: PersonalRequest = {...form,id:'a',status:'pending',createdAt:'2026-10-07'}
assert.match(validateRequest(form,[pending],basis),/같은 시간/)
assert.equal(validateRequest(form,[{...pending,status:'cancelled'}],basis),'')
assert.equal(validateRequest(quarter,[{...pending,kind:'remote',start:'09:00',end:'18:00'}],basis),'')
assert.match(validateRequest({...form,kind:'annual'},[{...pending,kind:'remote',start:'09:00',end:'18:00'}],basis),/같은 시간/)
assert.equal(validateRequest({...form,kind:'overtime',start:'18:00',end:'21:00',note:'작업'},[pending],basis),'')
assert.match(validateRequest(form,[],{...basis,breakStart:'19:00',breakEnd:'20:00'}),/근무·휴게/)
assert.match(reminderPreview({...form,kind:'correction'},basis)[0],/변경하지 않습니다/)
console.log('personal requests verify: ok (leave durations, break time, reminders, schedule conflicts, correction)')
