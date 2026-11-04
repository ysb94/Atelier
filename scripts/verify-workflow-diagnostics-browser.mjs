import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const root = process.cwd(), dir = path.join(root, '.tmp/workflow-diagnostics-browser')
await mkdir(dir, { recursive: true })
await writeFile(path.join(dir, 'entry.ts'), `
import { QueryClient } from '@tanstack/react-query'
import { exposeDiagnosticsSwitch } from '@/lib/diagnostics/debug-flags'
import { installWorkflowDiagnostics } from '@/lib/diagnostics/runtime-watch'
import { startWorkflow, diagnosticReport } from '@/lib/diagnostics/workflow-trace'
import { createDiagnosedClient } from '@/lib/supabase/diagnosed-client'
import { diagnosticQuery } from '@/lib/supabase/diagnostic-query'
exposeDiagnosticsSwitch(); installWorkflowDiagnostics(new QueryClient())
const db = createDiagnosedClient(location.origin, 'fixture-publishable-key', {auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},db:{retry:false}})
document.body.innerHTML='<main><h1>진단 로그 검증</h1><input aria-label="비공개 입력"><button id="blocked">신청 검사</button><button id="denied">권한 오류</button><button id="missing">함수 미적용</button><button id="pool">DB 연결 풀 대기</button><button id="network">연결 오류</button><button id="slow_headers">응답 지연</button><button id="slow_body">본문 지연</button><pre id="status"></pre></main>'
for (const button of document.querySelectorAll('button')) button.addEventListener('click',async()=>{
  const trace=startWorkflow(button.id==='blocked'?'leave':'offsite',button.id)
  trace.step('validate_input')
  if(button.id==='blocked'){trace.step('load_workday_basis',{missingCount:1});trace.step('validate_conflicts');trace.block('workday_basis_missing');document.querySelector('#status').textContent='DB 전송 전 검사에서 중단';return}
  try {await trace.run('save',context=>diagnosticQuery('offsite',button.id,db.rpc(button.id,{p_note:'PRIVATE_DIAGNOSTIC_NOTE'}),context));trace.done();document.querySelector('#status').textContent=button.id+' 완료'}
  catch {document.querySelector('#status').textContent=button.id+' 실패'}
})
window.fixtureReport=diagnosticReport
`)
await build({ entryPoints: [path.join(dir, 'entry.ts')], outfile: path.join(dir, 'app.js'), bundle: true, format: 'esm', alias: { '@': path.join(root, 'src') }, define: { 'import.meta.env': '{"DEV":false,"VITE_ATELIER_RELEASE":"browser-fixture"}' }, logLevel: 'warning' })
let apiCalls = 0
const server = createServer(async (req, res) => {
  if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(await readFile(path.join(dir, 'app.js'))); return }
  if (req.url.startsWith('/rest/v1/rpc/')) {
    apiCalls++
    const action = req.url.split('/').pop()
    res.setHeader('content-type', 'application/json'); res.setHeader('sb-request-id', 'browser-fixture-123')
    if (action === 'network') { req.socket.destroy(); return }
    if (action === 'denied' || action === 'missing' || action === 'pool') {
      res.statusCode = action === 'denied' ? 403 : action === 'pool' ? 504 : 404
      res.end(JSON.stringify({ code: action === 'denied' ? '42501' : action === 'pool' ? 'PGRST003' : 'PGRST202', message: 'PRIVATE_DIAGNOSTIC_MESSAGE', details: 'PRIVATE_DIAGNOSTIC_DETAIL', hint: 'PRIVATE_DIAGNOSTIC_HINT' })); return
    }
    if (action === 'slow_headers') { setTimeout(() => res.end('{"ok":true}'), 4_200); return }
    if (action === 'slow_body') { res.write('{"ok":'); setTimeout(() => res.end('true}'), 4_200); return }
    res.end('{"ok":true}'); return
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end('<!doctype html><meta charset="utf-8"><style>body{font:16px system-ui;padding:32px;background:#f7f7f7}button,input{padding:12px;margin:8px}pre{padding:20px;background:white}</style><script type="module" src="/app.js"></script>')
})
let browser
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  let transportCalls = 0
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/rest/v1/rpc/')) transportCalls++ })
  await page.addInitScript(() => {
    window.fixtureConsole = []
    for (const level of ['info', 'warn', 'error']) {
      const original = console[level]
      console[level] = (...args) => { if (/^\[(workflow|db-request)\]/.test(String(args[0]))) window.fixtureConsole.push(JSON.stringify(args)); original.apply(console, args) }
    }
  })
  const origin = `http://127.0.0.1:${server.address().port}`
  await page.route('**/*', route => route.request().url() === origin + '/rest/v1/rpc/network' ? route.abort('failed') : route.request().url().startsWith(origin) ? route.continue() : route.abort())
  await page.goto(origin + '/settings/profile?private=PRIVATE_DIAGNOSTIC_QUERY')
  await page.getByLabel('비공개 입력').fill('PRIVATE_DIAGNOSTIC_INPUT')
  await page.getByRole('button', { name: '신청 검사', exact: true }).click()
  await page.getByText('DB 전송 전 검사에서 중단', { exact: true }).waitFor()
  assert.equal(apiCalls, 0, 'blocked validation must never send a DB request')
  assert(await page.evaluate(() => window.atelierDebug.report().events.some(event => event.phase === 'blocked' && event.stage === 'validate_conflicts' && event.meta.reason === 'workday_basis_missing')))
  for (const [button, category] of [['권한 오류', 'permission'], ['함수 미적용', 'schema_missing'], ['DB 연결 풀 대기', 'connection_pool_timeout'], ['연결 오류', 'network']]) {
    const before = transportCalls
    await page.getByRole('button', { name: button, exact: true }).click()
    await page.waitForFunction(category => window.atelierDebug.report().events.some(event => event.phase === 'failed' && event.meta.category === category), category)
    assert.equal(transportCalls, before + 1, 'logging must not retry an uncertain write')
  }
  await page.getByRole('button', { name: '응답 지연', exact: true }).click()
  await page.getByRole('button', { name: '본문 지연', exact: true }).click()
  await page.waitForFunction(() => {
    const events = window.atelierDebug.report().events
    return events.some(event => event.meta.reason === 'response_headers_pending') && events.some(event => event.meta.reason === 'response_body_pending')
  })
  await page.waitForFunction(() => ['slow_headers', 'slow_body'].every(action => window.atelierDebug.report().events.some(event => event.domain === 'offsite' && event.action === action && event.phase === 'completed')))
  assert.equal(transportCalls, 6)
  assert.equal(apiCalls, 5, 'the failed connection is isolated by the browser route')
  const report = await page.evaluate(() => window.atelierDebug.report())
  for (const action of ['denied', 'missing', 'pool', 'network', 'slow_headers', 'slow_body']) {
    const first = report.events.find(event => event.domain === 'offsite' && event.action === action && event.phase === 'started')
    assert(report.events.some(event => event.domain === 'db' && event.traceId === first.traceId), action + ' transport must share its workflow ID')
  }
  await page.evaluate(() => window.dispatchEvent(new ErrorEvent('error', { message: 'PRIVATE_DIAGNOSTIC_ERROR', error: new Error('PRIVATE_DIAGNOSTIC_ERROR'), filename: location.origin + '/assets/index-fixture.js', lineno: 11, colno: 4 })))
  assert(await page.evaluate(() => window.atelierDebug.report().events.some(event => event.action === 'uncaught' && event.meta.source === 'index-fixture.js')))
  assert(!JSON.stringify(await page.evaluate(() => [window.atelierDebug.report(), window.fixtureConsole])).includes('PRIVATE_DIAGNOSTIC_'))
  assert.equal(report.path, '/settings/profile')
  await page.evaluate(() => { window.atelierDebug.on(); window.atelierDebug.clear() })
  assert.equal((await page.evaluate(() => window.atelierDebug.report())).events.length, 0)
  await page.getByRole('button', { name: '신청 검사', exact: true }).click()
  assert((await page.evaluate(() => window.fixtureConsole)).some(line => line.includes('validate_input')))
  await page.screenshot({ path: path.join(dir, 'diagnostic-cases.png'), fullPage: true })
  assert.deepEqual(errors, [])
  console.info('Workflow browser diagnostics: validation before DB, actual SDK trace IDs, SQLSTATE, network/headers/body delays, no write retry, production-mode report, privacy and verbose switch passed.')
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
