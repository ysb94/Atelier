import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

// Run the real AuthProvider against delayed, controllable auth/profile reads.
// No employee session, production API, or personal data is used.
const dir = path.resolve('.tmp/auth-loading')
await mkdir(dir, { recursive: true })
await writeFile(path.join(dir, 'client.ts'), `
const params=new URLSearchParams(location.search),listeners=new Set();
const sessionFor=(id,token=id+'-token')=>id?{user:{id,email:id+'@example.invalid'},access_token:token}:null;
export const fixture={session:sessionFor('ordinary'),jobs:[],sessionCalls:0,insideCallback:false,readInCallback:0,sessionResolvers:[],sessionMode:params.has('session-hang')?'hang':params.has('session-reject')?'reject':'ok',
 recoverSession(id='ordinary'){this.sessionMode='ok';this.session=sessionFor(id)},
 finishSessions(id){for(const resolve of this.sessionResolvers)resolve({data:{session:sessionFor(id)},error:null})},
 emit(event,id='ordinary',token){this.session=sessionFor(id,token);for(const fn of listeners){this.insideCallback=true;try{fn(event,this.session)}finally{this.insideCallback=false}}},
 finish(index,patch={}){const job=this.jobs[index];job.resolve(patch===null?null:{id:job.id,status:'active',nameConfirmedAt:'done',permissionGrants:['staff'],...patch})},
 fail(index){this.jobs[index].reject(new Error('fixture profile read failed'))},
};
export function getMyProfile(){fixture.readInCallback+=Number(fixture.insideCallback);const id=fixture.session?.user.id;return new Promise((resolve,reject)=>fixture.jobs.push({id,resolve,reject}))}
export const getSupabase=()=>({auth:{
 getSession(){fixture.sessionCalls++;if(fixture.sessionMode==='reject')return Promise.reject(new Error('fixture session failed'));if(fixture.sessionMode==='hang')return new Promise(resolve=>fixture.sessionResolvers.push(resolve));return Promise.resolve({data:{session:fixture.session},error:null})},
 onAuthStateChange(fn){listeners.add(fn);setTimeout(()=>{if(listeners.has(fn))fn('INITIAL_SESSION',fixture.sessionMode==='ok'?fixture.session:null)},0);return {data:{subscription:{unsubscribe(){listeners.delete(fn)}}}}},
 signOut:async()=>{fixture.emit('SIGNED_OUT',null);return{error:null}},
}});
export const isSupabaseConfigured=()=>true;
export const readImpersonationState=()=>null,clearImpersonationState=()=>{},returnToOperator=async()=>{};
`)
const baselineRef = process.env.ATELIER_AUTH_BASELINE_REF
if (baselineRef) {
  const source = execFileSync('git', ['show', `${baselineRef}:src/lib/supabase/auth.tsx`], { encoding: 'utf8' })
    .replace("'../company/permissions'", "'@/lib/company/permissions'")
  await writeFile(path.join(dir, 'baseline.tsx'), source)
}
await writeFile(path.join(dir, 'entry.tsx'), `
import React from 'react';import{createRoot}from'react-dom/client';
import{AuthProvider,useAuth}from'${baselineRef ? './baseline' : '../../src/lib/supabase/auth'}';
import{fixture}from'./client';
function Screen(){const auth=useAuth();window.fixture=fixture;window.auth=auth;return <output>{JSON.stringify({ready:auth.ready,user:auth.session?.user.id,profile:auth.profile,error:auth.profileError})}</output>}
createRoot(document.getElementById('root')).render(<React.StrictMode><AuthProvider><Screen/></AuthProvider></React.StrictMode>);
`)
await build({ entryPoints: [path.join(dir, 'entry.tsx')], outfile: path.join(dir, 'app.js'), bundle: true, format: 'esm', jsx: 'automatic',
  alias: { '@/lib/supabase/client': path.join(dir, 'client.ts'), '@/lib/supabase/profiles': path.join(dir, 'client.ts'), '@/lib/supabase/impersonation': path.join(dir, 'client.ts'), '@': path.resolve('src') },
  define: { 'import.meta.env.DEV': 'false' }, logLevel: 'silent' })
const script = await readFile(path.join(dir, 'app.js'), 'utf8')
const browser = await chromium.launch({ executablePath: process.env.ATELIER_CHROMIUM_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const errors = [], remote = []
try {
  const context = await browser.newContext()
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin !== 'http://auth-loading.test') { remote.push(url.origin); return route.abort() }
    return route.fulfill({ contentType: url.pathname === '/app.js' ? 'text/javascript' : 'text/html', body: url.pathname === '/app.js' ? script : '<div id="root"></div><script type="module" src="/app.js"></script>' })
  })
  const page = await context.newPage()
  page.on('pageerror', e => errors.push(e.message))
  const state = () => page.evaluate(() => ({ ready: window.auth.ready, id: window.auth.profile?.id, error: window.auth.profileError, sessionError: window.auth.sessionError, user: window.auth.session?.user.id, calls: window.fixture.jobs.length }))
  const jobs = n => page.waitForFunction(n => window.fixture?.jobs.length >= n, n)
  const finish = (i, patch = {}) => page.evaluate(([i, patch]) => window.fixture.finish(i, patch), [i, patch])
  const ready = id => page.waitForFunction(id => window.auth.ready && window.auth.profile?.id === id, id)
  await page.goto('http://auth-loading.test/')
  await jobs(1)
  await page.waitForTimeout(80)
  const initialCalls = (await state()).calls
  if (baselineRef) {
    console.log(JSON.stringify({ baseline: baselineRef, ordinaryInitialProfileReads: initialCalls }))
  } else {
    assert.equal(initialCalls, 1, 'ordinary staff initial getSession + INITIAL_SESSION must share one profile read')
    await page.evaluate(() => { window.fixture.emit('SIGNED_IN'); window.fixture.emit('SIGNED_IN') })
    await page.waitForTimeout(60)
    assert.equal((await state()).calls, 1, 'concurrent same-session sign-in events must reuse the in-flight read')
    await finish(0); await ready('ordinary')
    assert.equal(await page.evaluate(() => window.fixture.readInCallback), 0)

    // A later event refreshes permissions, even for the same staff member.
    await page.evaluate(() => window.fixture.emit('SIGNED_IN')); await jobs(2)
    await finish(1, { permissionGrants: ['changed'] }); await ready('ordinary')
    assert.deepEqual(await page.evaluate(() => window.auth.profile.permissionGrants), ['changed'])
    await page.evaluate(() => window.fixture.emit('TOKEN_REFRESHED', 'ordinary', 'new-token')); await jobs(3)
    await finish(2, { permissionGrants: ['after-token'] })
    await page.waitForFunction(() => window.auth.profile.permissionGrants[0] === 'after-token')

    // Explicit refresh after saving must supersede an older pending read.
    await page.evaluate(() => window.fixture.emit('SIGNED_IN')); await jobs(4)
    await page.evaluate(() => { void window.auth.refreshProfile() }); await jobs(5)
    await finish(4, { permissionGrants: ['after-save'] })
    await page.waitForFunction(() => window.auth.profile.permissionGrants[0] === 'after-save')
    await finish(3, { permissionGrants: ['stale'] }); await page.waitForTimeout(30)
    assert.deepEqual(await page.evaluate(() => window.auth.profile.permissionGrants), ['after-save'])

    // A -> B -> logout, including responses arriving after the identity change.
    await page.evaluate(() => window.fixture.emit('SIGNED_IN')); await jobs(6)
    await page.evaluate(() => window.fixture.emit('SIGNED_IN', 'other')); await jobs(7)
    assert.equal((await state()).id, undefined, 'the old profile must be cleared during account switching')
    await finish(5); assert.equal((await state()).id, undefined)
    await finish(6); await ready('other')
    await page.evaluate(() => window.fixture.emit('SIGNED_IN', 'other')); await jobs(8)
    await page.evaluate(() => { void window.auth.signOut() })
    await page.waitForFunction(() => window.auth.ready && !window.auth.session)
    await finish(7); assert.equal((await state()).id, undefined)

    // A genuine pending account stays pending; failures never become a new profile.
    await page.evaluate(() => window.fixture.emit('SIGNED_IN', 'pending')); await jobs(9)
    await finish(8, { status: 'pending', permissionGrants: [] }); await ready('pending')
    assert.equal(await page.evaluate(() => window.auth.profile.status), 'pending')
    await page.evaluate(() => { void window.auth.refreshProfile() }); await jobs(10)
    await page.evaluate(() => window.fixture.fail(9))
    await page.waitForFunction(() => window.auth.ready && Boolean(window.auth.profileError))
    assert.equal((await state()).id, undefined)
    await page.evaluate(() => { void window.auth.refreshProfile() }); await jobs(11)
    await finish(10, { status: 'pending', permissionGrants: [] }); await ready('pending')

    // Deadline leaves a retryable error, and a late result cannot overwrite recovery.
    await page.clock.install()
    await page.evaluate(() => { void window.auth.refreshProfile() }); await jobs(12)
    await page.clock.fastForward(35_001)
    await page.waitForFunction(() => window.auth.ready && Boolean(window.auth.profileError))
    await page.evaluate(() => { void window.auth.refreshProfile() }); await jobs(13)
    await finish(12, { status: 'pending' }); await ready('pending')
    await finish(11, { status: 'active' })
    assert.equal(await page.evaluate(() => window.auth.profile.status), 'pending', 'late timed-out read must not replace recovered state')

    await page.goto('http://auth-loading.test/?session-reject')
    await page.waitForFunction(() => window.auth?.ready)
    assert.ok((await state()).sessionError)
    assert.equal((await state()).calls, 0, 'a failed session must not query a profile or become a signup')
    await page.evaluate(() => { window.fixture.recoverSession(); window.auth.retrySession() })
    await jobs(1); await finish(0); await ready('ordinary')
    assert.equal((await state()).sessionError, null)
    await page.goto('http://auth-loading.test/?session-hang')
    await page.waitForFunction(() => Boolean(window.auth))
    await page.clock.fastForward(35_001)
    await page.waitForFunction(() => window.auth.ready)
    assert.ok((await state()).sessionError)
    await page.evaluate(() => { window.fixture.recoverSession('recovered'); window.auth.retrySession() })
    await jobs(1); await finish(0); await ready('recovered')
    await page.evaluate(() => window.fixture.finishSessions('stale'))
    await page.waitForTimeout(30)
    assert.equal((await state()).id, 'recovered', 'late initial session cannot replace recovered identity')
    // A successful empty session still reaches the login screen.
    await page.evaluate(() => { window.fixture.recoverSession(null); window.auth.retrySession() })
    await page.waitForFunction(() => window.auth.ready && !window.auth.session)
    assert.equal((await state()).sessionError, null)
    console.log('PASS auth-loading: initial read coalescing; permission/token refresh; account/logout isolation; pending/error recovery; session/profile deadlines; null INITIAL_SESSION failure handling; explicit session recovery and late-response isolation; no remote writes')
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(remote, [])
} finally { await browser.close() }
