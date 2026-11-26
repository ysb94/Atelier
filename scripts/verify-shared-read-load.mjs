import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

// Actual notification hooks + QueryClient, ordinary employee; only network/auth are fixtures.
const root = process.cwd(), dir = path.join(root, '.tmp/shared-read-load')
await mkdir(dir, { recursive: true })
await writeFile(path.join(dir, 'auth.ts'), `
import {useSyncExternalStore} from 'react';
import {RELEASE_COMPANY_ID} from '@/lib/company/release-access';
let id='ordinary-staff';const listeners=new Set();
export function currentEmployee(){return id}
export function switchEmployee(next){id=next;listeners.forEach(fn=>fn())}
export function useAuth(){const user=useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>id);return {profile:{id:user,companyId:RELEASE_COMPANY_ID,status:'active',role:'employee'},session:{user:{id:user}}}}
`)
await writeFile(path.join(dir, 'client.ts'), `
import {currentEmployee} from './auth';
export const counts={},projections={};export const channels=new Map();let fail=false;
const responses=new Map(),errors=new Map(),writes=[];
const responseKey=name=>JSON.stringify([currentEmployee(),name]);
export function seed(name,value){responses.set(responseKey(name),value)}
export function setEndpointError(name,code){if(code)errors.set(name,code);else errors.delete(name)}
export function recordedWrites(){return [...writes]}
export function setFailure(value){fail=value}
function result(name,args){
  counts[name]=(counts[name]||0)+1;
  const code=errors.get(name)??(fail?'57014':null);
  if(code){
    const message=code==='PGRST202'?'Could not find the function public.'+name+' in the schema cache':'fixture error';
    return Promise.resolve({data:null,error:{code,message}});
  }
  if(name==='read_meeting_notice_version') writes.push({actor:currentEmployee(),args});
  const fallback=name==='list_my_meeting_notice_context'?{invitations:[],series:[],starts:[]}:[];
  return Promise.resolve({data:responses.get(responseKey(name))??fallback,error:null});
}
export function emit(prefix){for(const [name,channel] of channels)if(name.startsWith(prefix))for(const listener of channel.handlers)if(listener.type==='postgres_changes')listener.fn({})}
export function getSupabase(){return {
rpc:(name,args)=>result(name,args),
from:(table)=>{const q={select:(columns)=>{projections[table]=columns;return q},eq:()=>q,order:()=>q,limit:()=>q,like:()=>q,abortSignal:()=>q,then:(ok,bad)=>result(table).then(ok,bad)};return q},
channel:(name)=>{const channel={handlers:[],on(type,_filter,fn){this.handlers.push({type,fn});return this},subscribe(fn){this.status=fn;return this}};channels.set(name,channel);return channel},
removeChannel:async channel=>{for(const [name,value]of channels)if(value===channel)channels.delete(name)}
}}
export const isSupabaseConfigured=()=>true;
`)
await writeFile(path.join(dir, 'entry.tsx'), `
import React,{useState}from'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';
import {MemoryRouter} from 'react-router-dom';
import {MeetingStartReminder} from '@/features/meetings/MeetingStartReminder';
import{useMyHomeNotifications,useReadMyHomeNotification}from'@/features/settings/use-my-home-notifications';import{useLeaveUsageNotices}from'@/features/operations-support/use-leave-usage-notices';
import{counts,emit,setFailure,seed,setEndpointError,recordedWrites,projections}from'./client';import{switchEmployee}from'./auth';
const cache=new QueryClient({defaultOptions:{queries:{retry:1,refetchOnWindowFocus:false}}});
function Receiver(){useLeaveUsageNotices();return null}
function Badge(){useMyHomeNotifications();return null}
function App(){const [badges,setBadges]=useState(1);const [background,setBackground]=useState(false);
const notices=useMyHomeNotifications({coordinator:true,background});
const [version,showVersion]=useState('');
useReadMyHomeNotification('meeting','test-round',version,Boolean(version));
window.probe={counts,emit,setFailure,setEndpointError,setBadges,setBackground,seed,switchEmployee,recordedWrites,showVersion,projections,
refresh:()=>cache.invalidateQueries(),keys:()=>cache.getQueryCache().getAll().map(q=>q.queryKey)};
return <><output>{notices.error?'error':notices.ready?'ready':'loading'}</output><section data-notices>{notices.items.map(item=><div key={item.id}>{item.title}</div>)}</section><MeetingStartReminder/><Receiver/>{Array.from({length:badges},(_,i)=><Badge key={i}/>)}</>}
createRoot(document.getElementById('root')).render(<MemoryRouter><QueryClientProvider client={cache}><App/></QueryClientProvider></MemoryRouter>);
`)
await build({ entryPoints: [path.join(dir, 'entry.tsx')], outfile: path.join(dir, 'app.js'), bundle: true, format: 'esm', jsx: 'automatic', define: { 'import.meta.env': '{}' }, alias: { '@/lib/supabase/auth': path.join(dir, 'auth.ts'), '@/lib/supabase/client': path.join(dir, 'client.ts'), '@': path.join(root, 'src') }, plugins: [{ name: 'relative-fixtures', setup(b) { b.onResolve({ filter: /^\./ }, args => { const target = path.resolve(path.dirname(args.importer), args.path).replace(/\.tsx?$/, ''); for (const name of ['auth', 'client']) if (target === path.join(root, 'src/lib/supabase', name)) return { path: path.join(dir, `${name}.ts`) } }) } }], logLevel: 'silent' })
const origin = 'http://fixture.local'
const html = '<meta charset="utf-8"><div id="root"></div><script type="module" src="/app.js"></script>'
let browser
try {
  browser = await chromium.launch({ executablePath: process.env.ATELIER_CHROMIUM_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const context = await browser.newContext()
  const errors = []
  context.on('page', tab => tab.on('pageerror', error => errors.push(error.message)))
  const page = await context.newPage()
  const bundle = await readFile(path.join(dir, 'app.js'))
  await page.context().route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin !== origin) return route.abort()
    if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: bundle })
    return route.fulfill({ contentType: 'text/html', body: html })
  })
  await page.clock.install()
  await page.goto(origin)
  await page.locator('output').filter({ hasText: 'ready' }).waitFor()
  const count = () => page.evaluate(() => ({ ...window.probe.counts }))
  const initial = await count()
  const feedbackColumns = await page.evaluate(() => window.probe.projections.personal_work_feedback_notices.split(','))
  assert.ok(feedbackColumns.includes('title') && feedbackColumns.includes('read_at'))
  assert.ok(!feedbackColumns.some(column => ['*','card_revision','note'].includes(column)), 'inbox polling omits feedback body and detail revision')
  for (let tick = 0; tick < 4; tick++) await page.clock.runFor(30_250)
  const idle = await count()
  const workload = {
    fullMeetings: idle.list_company_meetings ?? 0,
    separateInvitations: idle.list_my_meeting_invitations ?? 0,
    meetingContext: idle.list_my_meeting_notice_context ?? 0,
    workNotices: idle.list_my_managed_work_notifications ?? 0,
    feedbackInbox: idle.personal_work_feedback_notices ?? 0,
  }
  // Same mounted shell and timers before this change produced 5 full lists,
  // 5 separate invitations, and 5 managed work notice reads.
  assert.deepEqual(workload, {fullMeetings:0, separateInvitations:0, meetingContext:5, workNotices:5, feedbackInbox:5},
    'ordinary employee — initial read plus four 30s cycles')
  assert.equal(initial.list_my_home_work_notifications ?? 0, 0, 'the current server uses the managed work endpoint')
  for (const name of ['list_my_managed_work_notifications', 'list_my_managed_late_notices', 'list_my_extra_leave_notices', 'leave_usage_notices', 'list_my_meeting_notice_context']) assert.equal(initial[name], 1, `${name}: shared initial read`)
  await page.evaluate(() => window.probe.setBadges(12))
  await page.clock.runFor(500)
  assert.deepEqual(await count(), idle, '12 ordinary-staff badges reuse fetched results')

  await page.evaluate(() => { for (let i=0;i<10;i++) { window.probe.emit('my-home-work:'); window.probe.emit('extra-leave-notices:') } })
  await page.clock.runFor(500)
  const burst = await count()
  assert.equal(burst.list_my_managed_work_notifications, idle.list_my_managed_work_notifications + 1, '20 work events coalesce to one fresh read')
  assert.equal(burst.list_my_extra_leave_notices, idle.list_my_extra_leave_notices + 1, '10 leave events coalesce to one fresh read')
  await page.clock.runFor(30_500)
  const healthy = await count()
  assert.ok(healthy.list_my_managed_work_notifications > burst.list_my_managed_work_notifications, 'healthy 30s polling remains')

  await page.evaluate(async () => { window.probe.setFailure(true); await window.probe.refresh() })
  await page.locator('output').filter({ hasText: 'error' }).waitFor()
  const failed = await count()
  await page.evaluate(() => window.probe.setBadges(20))
  await page.clock.runFor(31_000)
  assert.deepEqual(await count(), failed, 'no retry storm from failed reads, new consumers, or 30s tick')
  await page.clock.runFor(30_000)
  const retried = await count()
  assert.equal(retried.list_my_managed_work_notifications, failed.list_my_managed_work_notifications + 1, 'one retry on 60s failed-read interval')
  assert.equal(retried.list_my_managed_late_notices, failed.list_my_managed_late_notices + 1)
  await page.evaluate(async () => { window.probe.setFailure(false); await window.probe.refresh() })
  await page.locator('output').filter({ hasText: 'ready' }).waitFor()
  const recovered = await count()
  await page.clock.runFor(30_500)
  assert.ok((await count()).list_my_managed_work_notifications > recovered.list_my_managed_work_notifications, 'recovery restores healthy polling')

  const meeting = { id:'test-meeting',title:'일반 직원 회의',status:'in_progress',rounds:[{id:'test-round',scheduleVersion:2,response:'pending',finalized:false}] }
  const invitation = { id:'test-notice',title:'내 회의 초대',kind:'meeting_invitation',body:'',
    createdAt:'2026-11-26T00:00:00Z',readAt:null,href:'/settings/profile?part=meetings&meeting=test-meeting&round=test-round',
    meeting:{roundId:'test-round',scheduleVersion:2,role:'member',status:'pending',finalized:false} }
  await page.evaluate(({meeting,invitation}) => {
    window.probe.seed('list_my_meeting_notice_context',{invitations:[invitation],series:[meeting],starts:[]})
    window.probe.seed('list_my_meeting_invitations',[invitation])
    window.probe.seed('list_company_meetings',[{...meeting,rounds:[{...meeting.rounds[0],startsAt:'',responses:[]}]}])
    for(let i=0;i<10;i++) window.probe.emit('meeting-notices:')
  },{meeting,invitation})
  await page.clock.runFor(500)
  await page.locator('[data-notices]').getByText(invitation.title).waitFor()
  await page.evaluate(() => window.probe.showVersion('1'))
  await page.clock.runFor(500)
  assert.deepEqual(await page.evaluate(() => window.probe.recordedWrites()),[], 'older open detail does not acknowledge the new schedule')
  await page.evaluate(() => window.probe.showVersion('2'))
  await page.waitForFunction(() => window.probe.recordedWrites().length===1)
  assert.deepEqual(await page.evaluate(() => window.probe.recordedWrites()),[
    {actor:'ordinary-staff',args:{p_id:invitation.id,p_sent_at:invitation.createdAt,p_schedule_version:2}},
  ],'one acknowledgement for the displayed version')
  await page.evaluate(() => window.probe.showVersion(''))
  const beforeSwitch = await count()
  await page.evaluate(() => window.probe.switchEmployee('other-ordinary-staff'))
  await page.clock.runFor(500)
  await page.locator('output').filter({ hasText: 'ready' }).waitFor()
  assert.equal((await count()).list_my_managed_work_notifications, beforeSwitch.list_my_managed_work_notifications + 1, 'new employee gets own query')
  assert.ok(await page.evaluate(() => window.probe.keys().some(key => key[0] === 'my-home-work-notices' && key[1] === 'other-ordinary-staff')))
  assert.equal(await page.locator('[data-notices]').getByText(invitation.title).count(),0,'previous account notifications removed')
  // Old installations may require the full-list fallback. Permission denials
  // and timeouts must preserve the server's answer without issuing that read.
  for (const code of ['42501','57014']) {
    await page.evaluate(async code => { window.probe.setEndpointError('list_my_meeting_notice_context',code); await window.probe.refresh() },code)
    await page.locator('output').filter({hasText:'error'}).waitFor()
    assert.equal((await count()).list_company_meetings ?? 0,0,`${code} triggers no full-list request`)
    assert.equal((await count()).list_my_meeting_invitations ?? 0,0,`${code} triggers no separate invitation request`)
  }
  await page.evaluate(async () => {window.probe.setEndpointError('list_my_meeting_notice_context','PGRST202');await window.probe.refresh()})
  await page.locator('output').filter({hasText:'ready'}).waitFor()
  const fallback = await count()
  assert.equal(fallback.list_company_meetings,1,'meeting list available on a legacy server')
  assert.equal(fallback.list_my_meeting_invitations,1,'invites available on a legacy server')
  await page.clock.runFor(30_500)
  assert.equal((await count()).list_my_meeting_notice_context,fallback.list_my_meeting_notice_context,'missing RPC is not retried at every tick')
  const sibling = await context.newPage()
  await sibling.goto(origin)
  await sibling.locator('output').filter({hasText:'ready'}).waitFor()
  await sibling.evaluate(async ({meeting,invitation})=>{
    window.probe.seed('list_my_meeting_notice_context',{invitations:[invitation],series:[meeting],starts:[]})
    await window.probe.refresh()
  },{meeting,invitation})
  await sibling.locator('[data-notices]').getByText(invitation.title).waitFor()
  assert.equal(await page.locator('[data-notices]').getByText(invitation.title).count(),0,'another signed-in employee in the same browser sees their own list')
  await sibling.evaluate(() => {
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'hidden'})
    document.dispatchEvent(new Event('visibilitychange'))
  })
  const hidden = await sibling.evaluate(()=>window.probe.counts.list_my_meeting_notice_context)
  await sibling.clock.runFor(30_500)
  assert.equal(await sibling.evaluate(()=>window.probe.counts.list_my_meeting_notice_context),hidden,'desktop notifications off: hidden tab stays idle')
  await sibling.evaluate(()=>window.probe.setBackground(true))
  await sibling.clock.runFor(30_500)
  assert.equal(await sibling.evaluate(()=>window.probe.counts.list_my_meeting_notice_context),hidden+1,'desktop notifications on: hidden tab polls once')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ result:'PASS', account:'ordinary employee (no admin or preview)', initialPlusTwoMinutes:workload, additionalReadsFor11Consumers:0, realtimeBurstReads:1, healthyPollSeconds:30, failedPollSeconds:60, recoveredPolling:true, accountScoped:true, versionedRead:true, legacyFallback:true }))
} finally { await browser?.close() }
