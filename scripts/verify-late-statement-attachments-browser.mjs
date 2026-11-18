import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

// Real React forms, SDK, transport wrappers and attachment store. All requests
// are intercepted fixtures; production accounts, files and DB are never used.
const root = process.cwd(), dir = path.join(root, '.tmp/late-attachment-browser')
await mkdir(dir, { recursive: true })
const fixture = path.join(dir, 'fixture.tsx')
await writeFile(fixture, `
import React,{createContext,useContext,useMemo,useState}from'react';
const Auth=createContext(null);
export function FixtureAuth({children}){const[actor,setActor]=useState('employee');window.fixtureActor=actor;window.switchActor=setActor;const value=useMemo(()=>({profile:{id:actor,status:'active',displayName:'검증 직원',departmentName:'기획팀'},session:{user:{id:actor}}}),[actor]);return <Auth.Provider value={value}>{children}</Auth.Provider>}
export const useAuth=()=>useContext(Auth);
const scenario=new URLSearchParams(window.location.search).get('arrival');
export const useMyClockIn=()=>({todayClock:'09:07',todayRecord:scenario==='overnight'?undefined:{clockIn:scenario==='offsite'?'10:00':scenario==='half'?'14:39':'09:07',clockInSource:scenario==='offsite'?'offsite':'manual'}});
export const getMyWorkdayBasis=async()=>scenario==='half'?{start:'10:00',arrivalStart:'14:00',quarterArrivalSupported:true}:{start:'09:00'};
`)
await writeFile(path.join(dir, 'entry.tsx'), `
import React,{useState}from'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider,useQuery}from'@tanstack/react-query';
import{BrowserRouter}from'react-router-dom';
import{FixtureAuth,useAuth}from'./fixture';import{LateArrivalHeaderButton,LateArrivalStatementDocument}from'../../src/features/home/LateArrivalClockIn';
import{LateArrivalAppealNoticeDialog}from'../../src/features/home/LateArrivalAppeal';
import{getSupabase}from'../../src/lib/supabase/client';import{listLateArrivalStatements,uploadLateStatementFile}from'../../src/lib/supabase/late-arrival-statements';
import{createSupabaseFetch}from'../../src/lib/supabase/request-policy';import{createDiagnosticFetch}from'../../src/lib/diagnostics/request-watch';
const query=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});
getSupabase().auth.getSession=async()=>({data:{session:{user:{id:window.fixtureActor},access_token:'fixture-'+window.fixtureActor}},error:null});
window.fixture={setActor:actor=>{query.clear();window.switchActor(actor)},upload:uploadLateStatementFile,refresh:()=>query.invalidateQueries()};
window.fixture.empty=async()=>{const run=createDiagnosticFetch('https://api.fixture.invalid',createSupabaseFetch('https://api.fixture.invalid'));const out=[];for(const [method,status]of[['POST',204],['GET',204],['GET',205],['GET',304],['HEAD',200]]){const r=await run('https://api.fixture.invalid/rest/v1/empty/'+status,{method});out.push({method,status:r.status,text:await r.text(),marker:r.headers.get('x-fixture')})}return out};
function App(){
  const[review,setReview]=useState(false);
  const{session}=useAuth();
  window.fixture.review=()=>setReview(true);
  const rows=useQuery({queryKey:['review-fixture',session.user.id],queryFn:()=>listLateArrivalStatements('2026-11-05','2026-11-05'),enabled:review});
  if(!review)return <div data-testid="late-header"><LateArrivalHeaderButton/><LateArrivalAppealNoticeDialog/></div>;
  if(rows.isPending)return <p>조회 중</p>;
  if(!rows.data?.length)return <p>열람할 수 없습니다.</p>;
  return <LateArrivalStatementDocument statement={rows.data[0]} review={session.user.id==='hr'?'hr':'view'} onClose={()=>setReview(false)}/>;
}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={query}><FixtureAuth><BrowserRouter><App/></BrowserRouter></FixtureAuth></QueryClientProvider>);
`)
const mocked = ['lib/supabase/auth', 'features/home/use-my-clock-in', 'lib/supabase/attendance-entry'].map(p => path.join(root, 'src', p).replaceAll('\\', '/'))
await build({ entryPoints: [path.join(dir, 'entry.tsx')], outfile: path.join(dir, 'app.js'), bundle: true, format: 'esm', jsx: 'automatic', loader: { '.css': 'empty' }, alias: { '@': path.join(root, 'src') },
  define: { 'import.meta.env.DEV': 'false', 'import.meta.env.VITE_SUPABASE_URL': '"https://api.fixture.invalid"', 'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': '"fixture-key"', 'process.env.NODE_ENV': '"test"' },
  plugins: [{ name: 'local-ui-context', setup(b) { b.onResolve({ filter: /.*/ }, args => { if (!args.importer.startsWith(path.join(root, 'src'))) return; const target = (args.path.startsWith('@/') ? path.join(root, 'src', args.path.slice(2)) : path.resolve(args.resolveDir, args.path)).replaceAll('\\', '/').replace(/\.tsx?$/, ''); if (mocked.includes(target)) return { path: fixture } }) } }], logLevel: 'silent' })
const cssFile = (await readdir(path.join(root, 'dist/assets'))).find(name => /^index-.*\.css$/.test(name))
assert.ok(cssFile, 'Run the Node 22 build before the browser verification')
const css = await readFile(path.join(root, 'dist/assets', cssFile), 'utf8'), js = await readFile(path.join(dir, 'app.js'), 'utf8')
const browser = await chromium.launch({ executablePath: process.env.ATELIER_CHROMIUM_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const errors = [], unexpected = []
const row = () => ({ id: 'statement-a', employee_id: 'employee', work_date: '2026-11-05', department_name: '기획팀', employee_name: '검증 직원', position_name: '직원', baseline_time: '09:00', actual_time: '09:07', late_minutes: 7, prior_approval: '무', reason_kind: '교통 통제', detail: '기존 사유 본문', prevention: '출근 경로 확인', written_on: '2026-11-05', manager_name: null, manager_confirmed_at: null, hr_name: null, hr_confirmed_at: null })
const image = name => ({ name, mimeType: name.endsWith('.jpeg') ? 'image/jpeg' : 'image/png', buffer: Buffer.from('isolated image fixture') })
async function fixturePage(existing = false, arrival = '') {
  const model = { statement: existing ? row() : null, appeal: null, appealReads: new Set(), files: [], objects: new Set(), calls: [], finishFailure: '', uploadFailure: '', denyVerification: false, blockReadAfterFinish: false, serial: 0, deletes: 0, saves: 0 }
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
  await context.addInitScript(() => {
    const NativeDate = Date
    class FixtureDate extends NativeDate { constructor(...args) { super(...(args.length ? args : ['2026-11-05T01:00:00Z'])) } static now() { return new NativeDate('2026-11-05T01:00:00Z').getTime() } }
    window.Date = FixtureDate
  })
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url()), method = req.method()
    if (url.origin === 'https://late.fixture.invalid') {
      if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: js })
      if (url.pathname === '/app.css') return route.fulfill({ contentType: 'text/css', body: css })
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><main id="root" style="padding:24px"></main><script type="module" src="/app.js"></script>' })
    }
    if (url.origin !== 'https://api.fixture.invalid') { unexpected.push(req.url()); return route.abort() }
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,HEAD,POST,DELETE,OPTIONS', 'access-control-expose-headers': 'x-fixture', 'x-fixture': 'preserved' }
    const json = (data, status = 200) => route.fulfill({ status, headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(data) })
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (url.pathname.startsWith('/rest/v1/empty/')) return route.fulfill({ status: Number(url.pathname.split('/').pop()), headers })
    const actor = req.headers().authorization?.replace('Bearer fixture-', ''), canRead = actor === 'employee' || actor === 'hr'
    model.calls.push({ method, path: url.pathname })
    if (method === 'DELETE' || url.pathname.endsWith('/remove_my_late_statement_file')) { model.deletes++; return json({ message: 'unexpected deletion' }, 500) }
    if (url.pathname === '/rest/v1/late_arrival_statements') return json(canRead && model.statement ? [model.statement] : [])
    if (url.pathname === '/rest/v1/late_arrival_statement_files') {
      if (!canRead || model.denyVerification) return json({ code: '42501', message: '권한 없음' }, 403)
      const id = url.searchParams.get('id')?.replace('eq.', '')
      return json(model.files.filter(f => f.ready && (!id || f.id === id)))
    }
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const name = url.pathname.split('/').pop(), body = req.postDataJSON() ?? {}
      if (name === 'list_late_arrival_appeals') {
        if (!model.appeal || !['employee', 'hr'].includes(actor)) return json([])
        const key = actor === 'hr' ? 'late-appeal-review:appeal-a' : model.appeal.status === 'pending' ? null : 'late-appeal-result:appeal-a'
        return json([{ ...model.appeal, can_review: actor === 'hr', event_key: key, read_at: model.appealReads.has(key) ? '2026-11-05T02:00:00Z' : null }])
      }
      if (name === 'submit_late_arrival_appeal') {
        model.appeal ??= { id: 'appeal-a', employee_name: '검증 직원', work_date: body.p_date, baseline: '09:00', actual: '09:07', minutes: 7, reason: body.p_reason, status: 'pending', created_at: '2026-11-05T01:30:00Z' }
        return json(model.appeal.id)
      }
      if (name === 'read_late_arrival_appeal') { model.appealReads.add(body.p_event_key); return json(null) }
      if (name === 'review_late_arrival_appeal') {
        assert.equal(actor, 'hr')
        assert.equal(body.p_id, 'appeal-a')
        model.appeal = { ...model.appeal, status: body.p_exclude ? 'corrected' : 'kept', review_note: body.p_note, reviewed_at: '2026-11-05T03:00:00Z' }
        return json(null)
      }
      if (name === 'save_my_late_statement') {
        if (actor !== 'employee') return json({ code: '42501', message: '본인만 제출' }, 403)
        model.saves++; model.statement ??= { ...row(), prior_approval: body.p_prior, reason_kind: body.p_reason, detail: body.p_detail, prevention: body.p_prevention }
        return json({ id: model.statement.id })
      }
      if (name === 'begin_late_statement_file') {
        if (actor !== 'employee') return json({ code: '42501', message: '본인만 첨부' }, 403)
        if (model.files.filter(f => f.ready).length >= 5) return json({ message: '첨부파일은 5개까지 올릴 수 있습니다.' }, 400)
        const id = 'file-' + (++model.serial), storage_path = 'companies/fixture/late-statements/statement-a/' + id
        model.files.push({ id, statement_id: 'statement-a', file_name: body.p_name, storage_path, ready: false })
        return json({ id, path: storage_path })
      }
      if (name === 'finish_late_statement_file') {
        if (actor !== 'employee') return json({ code: '42501', message: '본인만 완료' }, 403)
        const file = model.files.find(f => f.id === body.p_id)
        if (!file || !model.objects.has(file.storage_path)) return json({ message: '첨부파일이 저장소에 없습니다.' }, 400)
        const failure = model.finishFailure; model.finishFailure = ''
        if (failure === 'before') return route.abort('failed')
        file.ready = true
        if (model.blockReadAfterFinish) model.denyVerification = true
        if (failure === 'after') return route.abort('failed')
        return route.fulfill({ status: 204, headers })
      }
      if (name === 'late_statement_review') return json({ canHrConfirm: false, waitingForManager: true })
      return json([])
    }
    if (url.pathname.startsWith('/storage/v1/object/company-late-statements/')) {
      const storagePath = url.pathname.slice('/storage/v1/object/company-late-statements/'.length)
      if (method === 'POST') {
        if (actor !== 'employee') return json({ message: '권한 없음' }, 403)
        const failure = model.uploadFailure; model.uploadFailure = ''
        if (failure === 'before') return route.abort('failed')
        model.objects.add(storagePath)
        if (failure === 'after') return route.abort('failed')
        return json({ Key: storagePath, Id: 'object-fixture' })
      }
      if (canRead && model.files.some(f => f.storage_path === storagePath && f.ready)) return route.fulfill({ status: 200, headers, body: 'fixture image' })
      return json({ message: '권한 없음' }, 403)
    }
    return json([])
  })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`https://late.fixture.invalid/?arrival=${arrival}`)
  await page.getByTestId('late-header').waitFor({ state: 'attached' })
  if (arrival !== 'offsite' && arrival !== 'overnight') {
    await page.getByRole('button', { name: existing ? '지각 사유서 확인' : '지각 사유서 작성', exact: true }).waitFor()
  }
  return { page, model, context }
}
async function fill(page, files) {
  await page.getByRole('button', { name: '지각 사유서 작성', exact: true }).click()
  await page.getByLabel('사전 승인', { exact: true }).fill('무')
  await page.getByLabel('사유 구분', { exact: true }).fill('교통 통제')
  await page.getByLabel('상세 사유', { exact: true }).fill('검증용 사유')
  await page.getByLabel('재발 방지 대책', { exact: true }).fill('출근 경로 확인')
  await page.getByLabel('첨부파일', { exact: true }).setInputFiles(files)
}
try {
  for (const arrival of ['offsite', 'overnight']) {
    const run = await fixturePage(false, arrival)
    assert.equal(await run.page.getByRole('button', { name: '지각 사유서 작성', exact: true }).count(), 0)
    assert.equal(run.model.calls.length, 0, `${arrival}: 사유서 조회 불필요`)
    await run.context.close()
  }
  const half = await fixturePage(false, 'half')
  await half.page.getByText('오늘 39분 지각', { exact: true }).waitFor()
  await half.page.getByRole('button', { name: '지각 사유서 작성', exact: true }).click()
  await half.page.getByRole('cell', { name: '14:00', exact: true }).waitFor()
  await half.page.getByRole('cell', { name: '14:39', exact: true }).waitFor()
  await half.context.close()

  const appeal = await fixturePage()
  await appeal.page.getByRole('button', { name: '지각 사유서 작성', exact: true }).click()
  await appeal.page.getByRole('button', { name: '이의신청', exact: true }).click()
  await appeal.page.getByLabel('이의신청 사유', { exact: true }).fill('외근 업무 후 출근했습니다.')
  await appeal.page.getByRole('button', { name: '이의신청 제출', exact: true }).click()
  await appeal.page.getByText('지각 이의신청 · 처리 대기 · 운영지원에 전달했습니다.', { exact: true }).waitFor()
  assert.equal(appeal.model.saves, 0, '이의신청은 사유서 제출과 별개')
  await appeal.page.getByRole('button', { name: '취소', exact: true }).click()
  await appeal.page.goto('https://late.fixture.invalid/?lateAppeal=appeal-a')
  await appeal.page.evaluate(() => window.fixture.setActor('hr'))
  const appealDetail = appeal.page.getByRole('dialog', { name: '지각 이의신청 상세' })
  await appealDetail.getByText('외근 업무 후 출근했습니다.', { exact: true }).waitFor()
  await appealDetail.getByRole('button', { name: '수정', exact: true }).click()
  assert.equal(await appealDetail.getByLabel('처리 사유', { exact: true }).inputValue(), '외근 업무 후 출근했습니다.')
  await appealDetail.getByRole('button', { name: '지각 제외 저장', exact: true }).click()
  await appealDetail.getByText(/검증 직원 .*지각 제외/).waitFor()
  assert.ok(appeal.model.appealReads.has('late-appeal-review:appeal-a'))
  await appeal.page.evaluate(() => window.fixture.setActor('employee'))
  await appealDetail.getByText('운영지원 처리 사유', { exact: true }).waitFor()
  assert.equal(await appealDetail.getByRole('button', { name: '수정', exact: true }).count(), 0)
  await appeal.context.close()

  const normal = await fixturePage()
  const protocol = await normal.page.evaluate(() => window.fixture.empty())
  assert.deepEqual(protocol.map(r => [r.method, r.status, r.text, r.marker]), [['POST',204,'','preserved'],['GET',204,'','preserved'],['GET',205,'','preserved'],['GET',304,'','preserved'],['HEAD',200,'','preserved']])
  await fill(normal.page, [image('증빙 screenshot.png'), image('교통 통제.jpeg')])
  await normal.page.getByRole('button', { name: '사유서 제출', exact: true }).click()
  await normal.page.getByText('지각 사유서와 첨부파일 2개를 제출했습니다.', { exact: true }).waitFor()
  assert.equal(normal.model.saves, 1); assert.equal(normal.model.files.filter(f => f.ready).length, 2); assert.equal(normal.model.deletes, 0)
  await normal.page.getByRole('button', { name: '지각 사유서 확인', exact: true }).click()
  await normal.page.getByRole('button', { name: '증빙 screenshot.png', exact: true }).waitFor()
  const downloading = normal.page.waitForEvent('download')
  await normal.page.getByRole('button', { name: '교통 통제.jpeg', exact: true }).click()
  assert.equal((await downloading).suggestedFilename(), '교통 통제.jpeg')
  await normal.page.screenshot({ path: path.join(dir, 'submitted-files.png'), fullPage: true })
  await normal.page.reload()
  await normal.page.getByRole('button', { name: '지각 사유서 확인', exact: true }).click()
  await normal.page.getByRole('button', { name: '증빙 screenshot.png', exact: true }).waitFor()
  assert.equal(normal.model.saves, 1, 'reload must not resubmit the body')
  await normal.context.close()

  for (const failure of ['before', 'after']) {
    const run = await fixturePage(); run.model.finishFailure = failure
    await fill(run.page, [image('retry.png')])
    await run.page.getByRole('button', { name: '사유서 제출', exact: true }).click()
    if (failure === 'before') {
      await run.page.getByRole('alert').filter({ hasText: '사유서 본문은 저장되었습니다.' }).waitFor()
      assert.equal(await run.page.getByLabel('상세 사유', { exact: true }).getAttribute('readonly'), '')
      await run.page.getByRole('button', { name: '사유서 제출', exact: true }).click()
    }
    await run.page.getByText('지각 사유서와 첨부파일 1개를 제출했습니다.', { exact: true }).waitFor()
    assert.equal(run.model.serial, 1); assert.equal(run.model.objects.size, 1); assert.equal(run.model.saves, 1); assert.equal(run.model.deletes, 0)
    assert.equal(run.model.calls.filter(c => c.method === 'POST' && c.path.startsWith('/storage/')).length, 1, 'finalization retry must not upload bytes twice')
    await run.context.close()
  }
  const uncertain = await fixturePage(true)
  await uncertain.page.getByRole('button', { name: '지각 사유서 확인', exact: true }).click()
  await uncertain.page.getByLabel('첨부파일', { exact: true }).setInputFiles([image('uncertain.png')])
  uncertain.model.finishFailure = 'after'; uncertain.model.blockReadAfterFinish = true
  await uncertain.page.getByRole('button', { name: '첨부파일 저장', exact: true }).click()
  await uncertain.page.getByRole('alert').filter({ hasText: '첨부파일 저장 확인이 필요합니다.' }).waitFor()
  assert.equal(uncertain.model.files.filter(f => f.ready).length, 1); assert.equal(uncertain.model.objects.size, 1); assert.equal(uncertain.model.deletes, 0)
  uncertain.model.blockReadAfterFinish = false; uncertain.model.denyVerification = false
  await uncertain.page.evaluate(() => window.fixture.refresh())
  await uncertain.page.getByRole('button', { name: '첨부파일 저장', exact: true }).click()
  await uncertain.page.getByText('첨부파일 1개가 저장되었습니다.', { exact: true }).waitFor()
  assert.equal(uncertain.model.serial, 1); assert.equal(uncertain.model.deletes, 0)
  await uncertain.context.close()

  const double = await fixturePage(true)
  const ids = await double.page.evaluate(async () => { const file = new File(['same'], 'double.png', { type: 'image/png' }); return Promise.all([window.fixture.upload('statement-a', file), window.fixture.upload('statement-a', file)]).then(results => results.map(f => f.id)) })
  assert.equal(ids[0], ids[1]); assert.equal(double.model.serial, 1); assert.equal(double.model.deletes, 0)
  await double.context.close()

  const switched = await fixturePage(true); switched.model.finishFailure = 'before'
  await switched.page.evaluate(async () => { window.heldFile = new File(['held'], 'account.png', { type: 'image/png' }); try { await window.fixture.upload('statement-a', window.heldFile) } catch { /* deliberately interrupted fixture */ } })
  await switched.page.evaluate(() => window.fixture.setActor('peer'))
  await switched.page.waitForFunction(() => window.fixtureActor === 'peer')
  const denied = await switched.page.evaluate(async () => { try { await window.fixture.upload('statement-a', window.heldFile); return false } catch { return true } })
  assert.equal(denied, true); assert.equal(switched.model.serial, 1); assert.equal(switched.model.deletes, 0)
  assert.equal(switched.model.calls.filter(c => c.path.endsWith('/finish_late_statement_file')).length, 1, 'new account cannot reuse the original pending upload')
  await switched.context.close()

  const existing = await fixturePage(true), original = JSON.stringify(existing.model.statement)
  await existing.page.getByRole('button', { name: '지각 사유서 확인', exact: true }).click()
  await existing.page.getByText('현재 첨부 0개', { exact: false }).waitFor()
  await existing.page.getByLabel('첨부파일', { exact: true }).setInputFiles([image('다시 첨부.png')])
  await existing.page.getByRole('button', { name: '첨부파일 저장', exact: true }).click()
  await existing.page.getByText('첨부파일 1개가 저장되었습니다.', { exact: true }).waitFor()
  await existing.page.getByRole('button', { name: '다시 첨부.png', exact: true }).waitFor()
  assert.equal(JSON.stringify(existing.model.statement), original); assert.equal(existing.model.saves, 0); assert.equal(existing.model.deletes, 0)
  await existing.page.screenshot({ path: path.join(dir, 'existing-body-reattached.png'), fullPage: true })
  await existing.page.evaluate(() => { window.fixture.setActor('hr'); window.fixture.review() })
  await existing.page.getByRole('button', { name: '다시 첨부.png', exact: true }).waitFor()
  assert.equal(await existing.page.getByRole('button', { name: '첨부파일 저장', exact: true }).count(), 0)
  await existing.page.evaluate(() => window.fixture.setActor('peer'))
  await existing.page.getByText('열람할 수 없습니다.', { exact: true }).waitFor()
  await existing.context.close()

  for (const failure of ['before', 'after']) {
    const run = await fixturePage(true); run.model.uploadFailure = failure
    await run.page.getByRole('button', { name: '지각 사유서 확인', exact: true }).click()
    await run.page.getByLabel('첨부파일', { exact: true }).setInputFiles([image('upload-response.png')])
    await run.page.getByRole('button', { name: '첨부파일 저장', exact: true }).click()
    await run.page.getByRole('alert').filter({ hasText: '첨부파일 저장 확인이 필요합니다.' }).waitFor()
    assert.equal(run.model.deletes, 0)
    await run.page.getByRole('button', { name: '첨부파일 저장', exact: true }).click()
    await run.page.getByText('첨부파일 1개가 저장되었습니다.', { exact: true }).waitFor()
    assert.equal(run.model.serial, 1); assert.equal(run.model.objects.size, 1); assert.equal(run.model.deletes, 0)
    await run.context.close()
  }
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, [])
  console.log('PASS late attachments: real Chrome HEAD/204/205/304; two images+download+reload; committed/lost finalize response; denied verification retains files; duplicate clicks/account isolation; explicit retry without duplicate uploads or deletion; existing-body recovery; HR/peer access; upload-response loss; original body preserved; isolated fixtures only')
} finally { await browser.close() }
