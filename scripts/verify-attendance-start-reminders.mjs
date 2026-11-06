import assert from 'node:assert/strict'
import {build} from 'esbuild'
const load=async entry=>{const b=await build({entryPoints:[entry],bundle:true,write:false,format:'esm',platform:'node'});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'))}
const {attendanceStartReminderItems:items}=await load('src/features/settings/attendance-start-reminders.ts')
const {myHomeNotificationSummary:summary,sameNotificationEvent}=await load('src/lib/inbox/my-home-notifications.ts')
const {desktopCandidates}=await load('src/lib/inbox/desktop-notifications.ts')
const row={id:'one',departmentId:'dept',department:'기획팀',month:'2026-12',version:'1:abc',issuedAt:'2026-11-24T00:00:00Z',readAt:null,total:8,missing:3,current:true,overdue:false}
const notice=items([row])[0]
assert.match(notice.title,/2026년 12월/);assert.match(notice.body,/8명 중 3명 미지정/)
assert.equal(notice.href,'/settings/profile?part=attendance&month=2026-12')
assert.deepEqual(summary([notice]),{unread:1,pending:1})
assert.deepEqual(summary(items([{...row,readAt:'read'}])),{unread:0,pending:1},'read and actual completion stay separate')
assert.deepEqual(summary(items([{...row,missing:0,current:false}])),{unread:0,pending:0})
assert.match(items([{...row,overdue:true}])[0].title,/아직 미지정/)
const currentMonth={...row,id:'current-month',month:'2026-11',overdue:true}
const monthlyNotices=items([currentMonth,row])
assert.equal(monthlyNotices[0].href,'/settings/profile?part=attendance&month=2026-11')
assert.notEqual(monthlyNotices[0].action.key,monthlyNotices[1].action.key)
assert.deepEqual(summary(monthlyNotices),{unread:2,pending:2})
assert.deepEqual(summary(items([{...currentMonth,missing:0,current:false},row])),{unread:1,pending:1})
assert.equal(sameNotificationEvent(notice.target,items([{...row,version:'2:abc'}])[0].target),false)
assert.equal(sameNotificationEvent(notice.target,items([{...row,version:'1:def'}])[0].target),false)
assert.deepEqual(desktopCandidates([notice],new Set(),true),[],'reminders never create device notifications')
assert.equal(desktopCandidates([{...notice,id:'other',kind:'mention'}],new Set(),true).length,1,'existing notification types remain eligible')
globalThis.__reminder={reply:{data:[row],error:null},calls:[]}
const bundle=await build({entryPoints:['src/lib/supabase/attendance-start-reminders.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'isolated-network',setup(b){
 b.onResolve({filter:/^\.\/client$/},()=>({path:'client',namespace:'fixture'}));b.onResolve({filter:/^@\/lib\/diagnostics\/workflow-trace$/},()=>({path:'trace',namespace:'fixture'}))
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='client'?`export const getSupabase=()=>({rpc:(name,args)=>{globalThis.__reminder.calls.push({name,args});return Promise.resolve(globalThis.__reminder.reply)}})`:`export const diagnosticOperation=(d,n,fn)=>fn({run:(n,fn)=>fn({}),block:()=>{}}),tracedQuery=q=>q;`}))
}}]})
const api=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'))
assert.deepEqual(await api.listAttendanceStartReminders(),{ready:true,rows:[row]})
globalThis.__reminder.reply={data:null,error:{code:'PGRST202'}};assert.deepEqual(await api.listAttendanceStartReminders(),{ready:false,rows:[]})
for(const code of ['57014','42501']){globalThis.__reminder.reply={data:null,error:{code}};await assert.rejects(api.listAttendanceStartReminders(),e=>e.cause.code===code)}
globalThis.__reminder.reply={data:false,error:null};await api.readAttendanceStartReminder('one','2:abc')
assert.deepEqual(globalThis.__reminder.calls.at(-1),{name:'read_attendance_start_reminder',args:{p_id:'one',p_version:'2:abc'}})
delete globalThis.__reminder
console.log('PASS reminder mapping/API: monthly route, read vs pending, completion, old/new version separation, no device push, legacy types, missing server and SQLSTATE preserved')
