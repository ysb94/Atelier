import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

// Actual notification hooks + QueryClient, ordinary employee; only network/auth are fixtures.
const root = process.cwd(), dir = path.join(root, '.tmp/shared-read-load')
await mkdir(dir, { recursive: true })
await writeFile(path.join(dir, 'auth.ts'), `
import {useSyncExternalStore} from 'react';
let id='ordinary-staff';const listeners=new Set();
export function switchEmployee(next){id=next;listeners.forEach(fn=>fn())}
export function useAuth(){const user=useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>id);return {profile:{id:user,companyId:'company',status:'active',role:'employee'},session:{user:{id:user}}}}
`)
await writeFile(path.join(dir, 'client.ts'), `
export const counts={};export const channels=new Map();let fail=false;
export function setFailure(value){fail=value}
function result(name){counts[name]=(counts[name]||0)+1;return Promise.resolve(fail?{data:null,error:{code:'57014',message:'fixture timeout'}}:{data:[],error:null})}
export function emit(prefix){for(const [name,channel]of channels)if(name.startsWith(prefix))channel.handlers.forEach(fn=>fn())}
export function getSupabase(){return {
rpc:(name)=>result(name),
from:(table)=>{const q={select:()=>q,eq:()=>q,order:()=>q,then:(ok,bad)=>result(table).then(ok,bad)};return q},
channel:(name)=>{const channel={handlers:[],on(_type,_filter,fn){this.handlers.push(fn);return this},subscribe(fn){this.status=fn;return this}};channels.set(name,channel);return channel},
removeChannel:async channel=>{for(const [name,value]of channels)if(value===channel)channels.delete(name)}
}}
export const isSupabaseConfigured=()=>true;
`)
await writeFile(path.join(dir, 'entry.tsx'), `
import React,{useState}from'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';
import{useMyHomeNotifications}from'@/features/settings/use-my-home-notifications';import{useLeaveUsageNotices}from'@/features/operations-support/use-leave-usage-notices';
import{counts,emit,setFailure}from'./client';import{switchEmployee}from'./auth';
const cache=new QueryClient({defaultOptions:{queries:{retry:1,refetchOnWindowFocus:false}}});
function Receiver(){useLeaveUsageNotices();return null}
function Badge(){useMyHomeNotifications();return null}
function App(){const [badges,setBadges]=useState(1);const notices=useMyHomeNotifications({coordinator:true});
window.probe={counts,emit,setFailure,setBadges,switchEmployee,refresh:()=>cache.invalidateQueries(),keys:()=>cache.getQueryCache().getAll().map(q=>q.queryKey)};
return <><output>{notices.error?'error':notices.ready?'ready':'loading'}</output><Receiver/>{Array.from({length:badges},(_,i)=><Badge key={i}/>)}</>}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={cache}><App/></QueryClientProvider>);
`)
await build({ entryPoints: [path.join(dir, 'entry.tsx')], outfile: path.join(dir, 'app.js'), bundle: true, format: 'esm', jsx: 'automatic', define: { 'import.meta.env': '{}' }, alias: { '@/lib/supabase/auth': path.join(dir, 'auth.ts'), '@/lib/supabase/client': path.join(dir, 'client.ts'), '@': path.join(root, 'src') }, plugins: [{ name: 'relative-fixtures', setup(b) { b.onResolve({ filter: /^\./ }, args => { const target = path.resolve(path.dirname(args.importer), args.path).replace(/\.tsx?$/, ''); for (const name of ['auth', 'client']) if (target === path.join(root, 'src/lib/supabase', name)) return { path: path.join(dir, `${name}.ts`) } }) } }], logLevel: 'silent' })
const server = createServer(async (req, res) => { res.setHeader('Content-Type', req.url === '/app.js' ? 'text/javascript' : 'text/html'); res.end(req.url === '/app.js' ? await readFile(path.join(dir, 'app.js')) : '<meta charset="utf-8"><div id="root"></div><script type="module" src="/app.js"></script>') })
let browser
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  browser = await chromium.launch({ executablePath: process.env.ATELIER_CHROMIUM_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage(), errors = []
  page.on('pageerror', error => errors.push(error.message))
  const origin = `http://127.0.0.1:${server.address().port}`
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort())
  await page.clock.install()
  await page.goto(origin)
  await page.locator('output').filter({ hasText: 'ready' }).waitFor()
  const count = () => page.evaluate(() => ({ ...window.probe.counts }))
  const initial = await count()
  for (const name of ['list_my_home_work_notifications', 'list_my_late_statement_notices', 'list_my_extra_leave_notices', 'leave_usage_notices', 'list_my_meeting_invitations', 'list_company_meetings']) assert.equal(initial[name], 1, `${name}: shared initial read`)
  await page.evaluate(() => window.probe.setBadges(12))
  await page.clock.runFor(500)
  assert.deepEqual(await count(), initial, '12 ordinary-staff badges reuse fetched results')

  await page.evaluate(() => { for (let i=0;i<10;i++) { window.probe.emit('my-home-work:'); window.probe.emit('extra-leave-notices:') } })
  await page.clock.runFor(500)
  const burst = await count()
  assert.equal(burst.list_my_home_work_notifications, initial.list_my_home_work_notifications + 1, '20 work events coalesce to one fresh read')
  assert.equal(burst.list_my_extra_leave_notices, initial.list_my_extra_leave_notices + 1, '10 leave events coalesce to one fresh read')
  await page.clock.runFor(30_500)
  const healthy = await count()
  assert.ok(healthy.list_my_home_work_notifications > burst.list_my_home_work_notifications, 'healthy 30s polling remains')

  await page.evaluate(async () => { window.probe.setFailure(true); await window.probe.refresh() })
  await page.locator('output').filter({ hasText: 'error' }).waitFor()
  const failed = await count()
  await page.evaluate(() => window.probe.setBadges(20))
  await page.clock.runFor(31_000)
  assert.deepEqual(await count(), failed, 'no retry storm from failed reads, new consumers, or 30s tick')
  await page.clock.runFor(30_000)
  const retried = await count()
  assert.equal(retried.list_my_home_work_notifications, failed.list_my_home_work_notifications + 1, 'one retry on 60s failed-read interval')
  assert.equal(retried.list_my_late_statement_notices, failed.list_my_late_statement_notices + 1)
  await page.evaluate(async () => { window.probe.setFailure(false); await window.probe.refresh() })
  await page.locator('output').filter({ hasText: 'ready' }).waitFor()
  const recovered = await count()
  await page.clock.runFor(30_500)
  assert.ok((await count()).list_my_home_work_notifications > recovered.list_my_home_work_notifications, 'recovery restores healthy polling')

  const beforeSwitch = await count()
  await page.evaluate(() => window.probe.switchEmployee('other-ordinary-staff'))
  await page.clock.runFor(500)
  await page.locator('output').filter({ hasText: 'ready' }).waitFor()
  assert.equal((await count()).list_my_home_work_notifications, beforeSwitch.list_my_home_work_notifications + 1, 'new employee gets own query')
  assert.ok(await page.evaluate(() => window.probe.keys().some(key => key[0] === 'my-home-work-notices' && key[1] === 'other-ordinary-staff')))
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ result: 'PASS', account: 'ordinary employee (no admin or preview)', initialReadsPerSource: 1, additionalReadsFor11Consumers: 0, realtimeBurstReads: 1, healthyPollSeconds: 30, failedPollSeconds: 60, recoveredPolling: true, accountScoped: true }))
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)) }
