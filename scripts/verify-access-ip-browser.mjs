import assert from 'node:assert/strict'
import path from 'node:path'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { chromium } from 'playwright-core'
const root = process.cwd(), fixture = path.join(root, 'dev-tools/ai-workflow/browser-fixture')
const browser = await chromium.launch({ executablePath: process.env.ATELIER_CHROMIUM_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const server = await createServer({ root, cacheDir: path.join(root, 'node_modules/.cache/access-ip-vite'), configFile: false, envFile: false,
  define: { 'import.meta.env.VITE_ASSIGNED_PERMISSIONS_ENABLED': 'false' },
  plugins: [{ name: 'access-ip-fixture', enforce: 'pre', resolveId(source, importer) {
    if (importer && source.startsWith('.') && path.resolve(path.dirname(importer), source).replace(/\.tsx?$/, '') === path.join(root, 'src/lib/supabase/client')) return path.join(fixture, 'access-ip-client.ts')
  }, configureServer(vite) { vite.middlewares.use((req, res, next) => {
    if (!req.headers.accept?.includes('text/html')) return next()
    vite.transformIndexHtml(req.url, '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/dev-tools/ai-workflow/browser-fixture/access-ip-entry.tsx"></script></body></html>').then(html => { res.setHeader('Content-Type', 'text/html'); res.end(html) }).catch(next)
  }) } }, react(), tailwindcss()], resolve: { alias: [{ find: '@/lib/supabase/client', replacement: path.join(fixture, 'access-ip-client.ts') }, { find: '@', replacement: path.join(root, 'src') }] },
  server: { host: '127.0.0.1', port: 5194, strictPort: true, hmr: false } })
try {
  await server.listen()
  const origin = 'http://127.0.0.1:5194', context = await browser.newContext(), errors = [], remote = []
  try {
    await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : (remote.push(route.request().url()), route.abort()))
    const page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message))
    await page.goto(origin); await page.getByText('기존 로그인 상태: active', { exact: true }).waitFor()
    await page.getByRole('button', { name: '확인 표시', exact: true }).first().waitFor()
    assert.equal((await page.evaluate(() => window.__accessIpTest.calls)).filter(x => x === 'login').length, 1)
    await page.getByRole('button', { name: '다시 렌더', exact: true }).click()
    assert.equal((await page.evaluate(() => window.__accessIpTest.calls)).filter(x => x === 'login').length, 1)
    await page.getByRole('button', { name: '확인 표시', exact: true }).first().click()
    await page.getByLabel('IP 확인 상태', { exact: true }).selectOption('company')
    await page.getByLabel('IP 확인 메모', { exact: true }).fill('본사에서 직접 확인')
    await page.getByRole('button', { name: '확인 표시 저장', exact: true }).click()
    await page.getByText('IP 확인 표시를 저장했습니다. 로그인·출근 허용 여부는 바뀌지 않습니다.', { exact: true }).waitFor()
    assert.equal(await page.getByText('회사 확인', { exact: true }).count(), 50)
    await page.getByRole('button', { name: '다음', exact: true }).click(); await page.getByText('2페이지', { exact: true }).waitFor()
    assert.equal(await page.locator('tbody tr').count(), 1)
    await page.getByLabel('기록 행동', { exact: true }).selectOption('clock_in_request')
    await page.getByText('1페이지', { exact: true }).waitFor(); assert.equal(await page.locator('tbody tr').count(), 25)
    await page.getByRole('button', { name: '기존 출근 요청', exact: true }).click(); await page.getByText('기존 출근 저장 성공', { exact: true }).waitFor()
    assert.ok((await page.evaluate(() => window.__accessIpTest.calls)).includes('clock_in_request'))
    assert.deepEqual(await page.evaluate(() => window.__accessIpTest.rpcCalls), ['clock_in_today'])
    await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: '.tmp/access-ip-mobile.png', fullPage: true })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, '표 내부에서만 가로 스크롤')
    await page.goto(origin + '/?denied'); await page.getByText('이 화면은 지정된 본인 계정에서만 볼 수 있습니다.', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.__accessIpTest.queries.includes('access_ip_events')), false)
    for (const flag of ['record-error', 'hanging']) {
      await page.goto(origin + '/?' + flag); await page.getByText('기존 로그인 상태: active', { exact: true }).waitFor()
      await page.getByRole('button', { name: '기존 출근 요청', exact: true }).click(); await page.getByText('기존 출근 저장 성공', { exact: true }).waitFor()
      assert.equal(await page.evaluate(() => window.__authRecovery.audit.updates), 0)
    }
    await page.goto(origin + '/?save-error'); await page.getByRole('button', { name: '확인 표시', exact: true }).first().click()
    await page.getByLabel('IP 확인 메모', { exact: true }).fill('실패해도 보존')
    await page.getByRole('button', { name: '확인 표시 저장', exact: true }).click(); await page.getByText('회사 IP 확인 표시를 저장하지 못했습니다.', { exact: true }).waitFor()
    assert.equal(await page.getByLabel('IP 확인 메모', { exact: true }).inputValue(), '실패해도 보존')
    assert.deepEqual(errors, []); assert.deepEqual(remote, [])
    console.log('access-ip-browser: 실제 로그인/출근 훅·기록 실패/무응답에도 기존 동작 유지·승인 상태 무변경·1인 조회 게이트·확인 표시 저장/실패·페이지/필터·모바일 폭 검증 통과 (외부 요청 없음)')
  } finally { await context.close() }
} finally { await server.close(); await browser.close() }
