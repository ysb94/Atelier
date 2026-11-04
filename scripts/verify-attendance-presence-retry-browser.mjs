import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

// Real monitor, QueryClient and RPC adapter; only auth/context and the server are
// fixtures. No external request or real attendance write is allowed.
const root = process.cwd(), dir = path.join(root, '.tmp/attendance-presence-retry-browser')
// Optional proof against an explicit old revision, e.g. --baseline 05e5128.
const baselineIndex = process.argv.indexOf('--baseline')
const baseline = baselineIndex < 0 ? null : process.argv[baselineIndex + 1]
if (baselineIndex >= 0 && !baseline) throw new Error('--baseline requires the old Git revision to reproduce')
await mkdir(dir, { recursive: true })
const fixture = path.join(dir, 'fixture.tsx')
await writeFile(fixture, `
import {useSyncExternalStore} from 'react';
let enabled=true;const listeners=new Set();
export const useAuth=()=>({session:{user:{id:'ordinary-staff'}}});
export function useAttendanceEntry(){const active=useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>enabled);return{phase:'ready',clock:{needsClockOut:active},today:'2026-11-04',checkoutOpen:false}}
export const usePagePreview=()=>null,readImpersonationState=()=>null,useRenderWatch=()=>{};
let checkId='check-1',state='awaiting_delivery',serial=0,failures=${baseline ? 3 : 'Infinity'},hold=false,release;
export const calls=[];
function data(){return {serverNow:new Date(Date.now()+ ++serial).toISOString(),state,missedCount:0,check:state==='awaiting_delivery'||state==='waiting'?{id:checkId,dueAt:new Date(Date.now()).toISOString(),deliveredAt:state==='waiting'?new Date(Date.now()).toISOString():null,deadlineAt:state==='waiting'?new Date(Date.now()+300000).toISOString():null}:null}}
export const setFailures=value=>{failures=value};
export const setEnabled=value=>{enabled=value;listeners.forEach(fn=>fn())};
export const nextCheck=id=>{checkId=id;state='awaiting_delivery'};
export const holdPresent=()=>{hold=true};
export const releasePresent=()=>{release?.();release=undefined};
export function getSupabase(){return{rpc:async(name,args)=>{
 if(name!=='my_attendance_presence')throw Error('Unexpected RPC: '+name);
 const action=args.p_action;calls.push({action,checkId:args.p_check_id,at:Date.now()});
 if(action!=='poll'&&args.p_check_id!==checkId)return{data:null,error:{message:'fixture stale check',code:'P0001'}};
 if(action==='present'){
  if(hold){hold=false;await new Promise(resolve=>{release=resolve})}
  if(failures>0){failures--;return{data:null,error:{message:'fixture delivery failure',code:'55P03'}}}
  state='waiting';
 }else if(action==='continue')state='scheduled';else if(action==='clock_out')state='clocked_out';
 return{data:data(),error:null};
}}}
`)
let component = path.join(root, 'src/features/home/AttendancePresenceMonitor.tsx')
if (baseline) {
  component = path.join(dir, 'baseline.tsx')
  await writeFile(component, execFileSync('git', ['show', `${baseline}:src/features/home/AttendancePresenceMonitor.tsx`], { cwd: root }))
}
await writeFile(path.join(dir, 'entry.tsx'), `
import React from 'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';
import{AttendancePresenceMonitor}from'presence-monitor';import*as fixture from'./fixture';
const cache=new QueryClient({defaultOptions:{queries:{retry:1,refetchOnWindowFocus:false}}});
window.probe={...fixture,refresh:()=>cache.invalidateQueries({queryKey:['attendance-presence']}),counts:()=>Object.fromEntries(['poll','present','continue','clock_out'].map(action=>[action,fixture.calls.filter(c=>c.action===action).length]))};
createRoot(document.getElementById('root')).render(<QueryClientProvider client={cache}><AttendancePresenceMonitor/></QueryClientProvider>);
`)
const mocked = ['lib/supabase/auth', 'lib/supabase/client', 'lib/supabase/impersonation', 'lib/company/page-preview-context', 'lib/diagnostics']
await build({ entryPoints: [path.join(dir, 'entry.tsx')], outfile: path.join(dir, 'app.js'), bundle: true, format: 'esm', jsx: 'automatic',
  alias: { 'presence-monitor': component, ...Object.fromEntries(mocked.map(name => [`@/${name}`, fixture])), '@': path.join(root, 'src') },
  plugins: [{ name: 'relative-fixtures', setup(b) {
    b.onResolve({ filter: /^\./ }, args => {
      if (args.path === './attendance-entry-context') return { path: fixture }
      const target = path.resolve(path.dirname(args.importer), args.path).replace(/\.tsx?$/, '')
      if (target === path.join(root, 'src/lib/supabase/client')) return { path: fixture }
    })
  } }], logLevel: 'silent' })
let browser
try {
  browser = await chromium.launch({ executablePath: process.env.ATELIER_CHROMIUM_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage(), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => route.abort())
  await page.clock.install()
  await page.setContent('<meta charset="utf-8"><div id="root"></div>')
  await page.addScriptTag({ type: 'module', content: await readFile(path.join(dir, 'app.js'), 'utf8') })
  const counts = () => page.evaluate(() => window.probe.counts())
  if (baseline) {
    await page.getByRole('button', { name: '계속 근무 중' }).waitFor()
    await page.waitForFunction(() => window.probe.counts().present === 4)
    assert.equal((await counts()).poll, 4, 'each failed delivery immediately triggers another poll')
    const span = await page.evaluate(() => { const rows=window.probe.calls.filter(c=>c.action==='present');return rows.at(-1).at-rows[0].at })
    assert.ok(span < 1_000, 'three delivery failures retry immediately without advancing the browser clock')
    console.log(JSON.stringify({ result: 'BASELINE REPRODUCED', failedDeliveries: 3, immediatePresentCalls: 4, pollCalls: 4, retrySpanMs: span }))
  } else {
    await page.getByRole('alert').filter({ hasText: 'fixture delivery failure' }).waitFor()
    assert.deepEqual(await counts(), { poll: 1, present: 1, continue: 0, clock_out: 0 }, 'failed delivery does not immediately poll/retry')
    await page.evaluate(async () => { for (let i=0;i<8;i++) await window.probe.refresh() })
    assert.equal((await counts()).present, 1, 'fresh server timestamps do not bypass backoff')
    await page.clock.runFor(59_000)
    assert.equal((await counts()).present, 1, 'no automatic delivery before 60 seconds')
    const pollsBeforeRetry = (await counts()).poll
    assert.ok(pollsBeforeRetry >= 12, 'ordinary 15-second polls continue during delivery backoff')
    await page.clock.runFor(2_000)
    assert.equal((await counts()).present, 2, 'one automatic delivery retries after 60 seconds')
    await page.clock.runFor(1_000)
    assert.equal((await counts()).present, 2, 'second delivery failure also backs off')

    await page.evaluate(() => { window.probe.setFailures(0); window.probe.holdPresent() })
    await page.getByRole('button', { name: '다시 연결' }).click()
    await page.waitForFunction(() => window.probe.counts().present === 3)
    await page.evaluate(async () => { for (let i=0;i<4;i++) await window.probe.refresh() })
    assert.equal((await counts()).present, 3, 'manual retry bypasses delay without duplicating an in-flight delivery')
    await page.evaluate(() => window.probe.releasePresent())
    await page.waitForFunction(() => !document.querySelector('button:disabled') && !document.querySelector('[role="alert"]'))
    await page.getByRole('button', { name: '계속 근무 중' }).click()
    await page.waitForFunction(() => window.probe.counts().continue === 1)
    await page.getByRole('dialog').waitFor({ state: 'hidden' })

    await page.evaluate(async () => { window.probe.setFailures(Infinity); window.probe.nextCheck('check-2'); await window.probe.refresh() })
    await page.getByRole('alert').filter({ hasText: 'fixture delivery failure' }).waitFor()
    assert.equal((await counts()).present, 4, 'a different check starts immediately')
    await page.evaluate(() => window.probe.setEnabled(false))
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    const disabled = await counts()
    await page.clock.runFor(61_000)
    assert.deepEqual(await counts(), disabled, 'disabled monitor does not retry a failed delivery')
    await page.evaluate(() => { window.probe.setFailures(0); window.probe.nextCheck('check-3'); window.probe.setEnabled(true) })
    await page.waitForFunction(() => window.probe.calls.some(c=>c.action==='present'&&c.checkId==='check-3'))
    await page.getByRole('button', { name: '지금 퇴근하기' }).click()
    await page.waitForFunction(() => window.probe.counts().clock_out === 1)
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    assert.deepEqual(errors, [])
    console.log(JSON.stringify({ result: 'PASS', component: 'actual AttendancePresenceMonitor + QueryClient + RPC adapter', normalPollSeconds: 15, failedDeliveryRetrySeconds: 60, freshPollBurstDoesNotRetry: true, manualRetry: true, inFlightDeduplicated: true, disabledMonitorStops: true, newCheckIndependent: true, continueAndClockOutPreserved: true }))
  }
} finally { await browser?.close() }
