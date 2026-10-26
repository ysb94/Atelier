import assert from 'node:assert/strict'
import path from 'node:path'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { chromium } from 'playwright-core'
import { verifyWorkspaceOverlays } from './workspace-overlay-browser.mjs'
import { verifyPagePreviewRoles } from './page-preview-roles-browser.mjs'
import { verifyPermissionSettings } from './permission-settings-browser.mjs'
import { verifyMeetings } from './meetings-browser.mjs'
import { verifyMeetingHostLunchBrowser } from './meeting-host-lunch-browser.mjs'
import { verifyMeetingParticipationBrowser } from './meeting-participation-browser.mjs'

const root = process.cwd(), fixture = path.join(root, 'dev-tools/ai-workflow/browser-fixture')
const auth = path.join(fixture, 'page-preview-auth.tsx'), client = path.join(fixture, 'page-preview-client.ts')
const server = await createServer({ root, configFile: false, envFile: false, logLevel: 'error',
  cacheDir: path.join(root, 'node_modules', '.cache', 'page-preview-vite'),
  plugins: [{ name: 'preview-fixture', enforce: 'pre', resolveId(source, importer) {
    if (importer && source.startsWith('.')) {
      const target = path.resolve(path.dirname(importer), source).replace(/\.tsx?$/, '')
      if (target === path.join(root, 'src/lib/supabase/auth')) return auth
      if (target === path.join(root, 'src/lib/supabase/client')) return client
    }
  }, configureServer(vite) { vite.middlewares.use((req, res, next) => {
    if (!req.headers.accept?.includes('text/html')) return next()
    vite.transformIndexHtml(req.url, '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/dev-tools/ai-workflow/browser-fixture/page-preview-entry.tsx"></script></body></html>')
      .then(html => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html) }).catch(next)
  }) } }, react(), tailwindcss()],
  resolve: { alias: [{ find: '@/lib/supabase/auth', replacement: auth }, { find: '@/lib/supabase/client', replacement: client }, { find: '@', replacement: path.join(root, 'src') }] },
  server: { host: '127.0.0.1', port: 5191, hmr: false, watch: { ignored: ['**/.state/**'] }, fs: { allow: [root] } },
})
await server.listen()
let browser
let diagnosticPage
const errors = []
try {
  browser = await chromium.launch({ executablePath: process.env.ATELIER_CHROMIUM_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  const remote = []
  await context.route('**/*', route => {
    if (route.request().url().startsWith(origin + '/')) return route.continue()
    remote.push(route.request().url()); return route.abort()
  })
  const page = await context.newPage()
  diagnosticPage = page
  page.setDefaultTimeout(10000)
  page.setDefaultNavigationTimeout(120000)
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') console.error('browser-console:', message.text()) })
  page.on('requestfailed', request => console.error('browser-request:', request.url(), request.failure()?.errorText))
  page.on('response', response => { if (response.status() >= 400) console.error('browser-response:', response.status(), response.url()) })
  if (process.argv.includes('--host-lunch-only')) {
    await verifyMeetingHostLunchBrowser(page,origin)
  } else if (process.argv.includes('--participation-only')) {
    await verifyMeetingParticipationBrowser(page,origin)
  } else if (process.argv.includes('--meetings-only')) {
    await verifyMeetingParticipationBrowser(page,origin)
    await verifyMeetings(page,origin)
  } else if (process.argv.includes('--permissions-only')) {
    await verifyPermissionSettings(page,origin)
  } else if (process.argv.includes('--roles-only')) {
    await verifyPagePreviewRoles(page,origin)
  } else {
  await page.goto(origin + '/data/all')
  await page.getByRole('columnheader', { name: '상품명', exact: true }).waitFor()
  await page.getByRole('button', { name: '채팅', exact: true }).click()
  const assertAboveHeaders = async panelId => {
    const result = await page.evaluate(id => {
      const panel = document.getElementById(id)
      const p = panel.getBoundingClientRect()
      const samples = [...document.querySelectorAll('[data-testid="sheet-layering"] th')].flatMap(header => {
        const h = header.getBoundingClientRect()
        const left = Math.max(h.left, p.left, 0), right = Math.min(h.right, p.right, innerWidth)
        const top = Math.max(h.top, p.top, 0), bottom = Math.min(h.bottom, p.bottom, innerHeight)
        if (right - left < 4 || bottom - top < 4) return []
        const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2)
        return [{ header: header.textContent, above: panel.contains(hit), hit: hit?.tagName }]
      })
      return samples
    }, panelId)
    assert.ok(result.length > 0, '표 헤더와 패널이 실제 겹치는 좌표를 검사')
    assert.ok(result.every(sample => sample.above), `${panelId}: 상품 데이터 헤더가 패널을 가립니다: ${JSON.stringify(result)}`)
  }
  await assertAboveHeaders('workspace-chat-panel')
  await page.locator('[data-testid="sheet-layering"] > div').evaluate(element => { element.scrollLeft = 240; element.scrollTop = 160 })
  await assertAboveHeaders('workspace-chat-panel')
  await page.locator('#workspace-chat-panel').click({ position: { x: 160, y: 28 } })
  await page.getByRole('button', { name: /^알림(?:,|$)/ }).click()
  await page.locator('#workspace-notification-panel').waitFor()
  await assertAboveHeaders('workspace-notification-panel')
  await page.keyboard.press('Escape')
  if (!process.argv.includes('--layering-only') && !process.argv.includes('--permissions-only')) await verifyWorkspaceOverlays(page, origin)
  if (!process.argv.includes('--layering-only') && !process.argv.includes('--overlay-only')) await verifyPermissionSettings(page, origin)
  if (process.argv.includes('--layering-only')) {
    console.log('page-preview-layering: 실제 SheetTable 고정 헤더 위에서 채팅/알림 표시·스크롤·내부 클릭·닫기 통과')
  } else if (process.argv.includes('--overlay-only')) {
    console.log('workspace-overlays: 전체 소스 점검과 실제 표·모달 겹침 회귀 검증 통과')
  } else if (process.argv.includes('--permissions-only')) {
    console.log('permission-settings: 통합 권한·담당자 화면 검증 통과')
  } else {
  await verifyPagePreviewRoles(page,origin)
  await verifyMeetings(page,origin)
  }
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(remote, [])
  console.log('page-preview-browser: 선택한 브라우저 시나리오 통과 (오류·외부 요청 0)')
} catch (error) {
  console.error(JSON.stringify({ runtimeErrors: errors, url: diagnosticPage?.url(), text: (await diagnosticPage?.locator('body').innerText().catch(() => ''))?.slice(0, 4500) }))
  throw error
} finally { await browser?.close(); await server.close() }
