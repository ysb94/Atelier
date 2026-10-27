import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { chromium } from 'playwright-core'

// DB 검증이 출력한 실제 알림을 제품 컴포넌트에 연결한다. 운영 인증·네트워크 사용 없음.
const root = process.cwd()
const entryId = path.join(root, '__meeting-change-notice.tsx').replaceAll('\\', '/')
const notices = JSON.parse(await fs.readFile('node_modules/.cache/meeting-change-notices/notices.json', 'utf8'))
const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
 import {NotificationPanel} from '/src/components/layout/NotificationPanel.tsx'; import '/src/index.css';
 createRoot(document.getElementById('root')).render(<main style={{width:'100%',maxWidth:384,height:650,margin:'16px auto'}}>
 <NotificationPanel items={${JSON.stringify(notices)}} titleId="notice-title" onMarkAllRead={()=>{}} onOpen={()=>{}} onClose={()=>{}}/></main>);`
const server = await createServer({ root, configFile: false, envFile: false, logLevel: 'error',
  cacheDir: path.join(root, 'node_modules/.cache/meeting-change-notices/vite'),
  plugins: [{ name: 'meeting-change-notice-fixture', enforce: 'pre',
    resolveId(source) { if (source === '/__meeting-change-notice.tsx') return entryId },
    load(id) { if (id === entryId) return entry },
    configureServer(vite) { vite.middlewares.use((req, res, next) => {
      if (!req.headers.accept?.includes('text/html')) return next()
      vite.transformIndexHtml(req.url, '<!doctype html><html lang="ko"><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/__meeting-change-notice.tsx"></script></body></html>')
        .then(html => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html) }).catch(next)
    }) },
  }, react(), tailwindcss()],
  resolve: { alias: { '@': path.join(root, 'src') } },
  server: { host: '127.0.0.1', port: 5197, strictPort: true, hmr: false, fs: { allow: [root] } },
})
let browser
try {
  await server.listen()
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch({ executablePath: process.env.ATELIER_CHROMIUM_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const context = await browser.newContext()
  const errors = [], external = []
  await context.route('**/*', route => {
    if (route.request().url().startsWith(origin + '/')) return route.continue()
    external.push(route.request().url()); return route.abort()
  })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await fs.mkdir('dev-tools/ai-workflow/.state', { recursive: true })
  for (const width of [1280, 360]) {
    await page.setViewportSize({ width, height: 760 })
    await page.goto(origin)
    const panel = page.getByRole('dialog', { name: '알림', exact: true })
    await panel.waitFor()
    const body = panel.getByText(notices[0].body, { exact: true })
    await body.waitFor()
    const layout = await body.evaluate(element => ({
      whitespace: getComputedStyle(element).whiteSpace, overflow: getComputedStyle(element).textOverflow,
      scrollWidth: element.scrollWidth, clientWidth: element.clientWidth,
      lines: element.innerText.split('\n').length,
    }))
    assert.equal(layout.whitespace, 'pre-line', '변경 전후의 줄바꿈 유지')
    assert.notEqual(layout.overflow, 'ellipsis', '비교 내용을 말줄임으로 숨기지 않음')
    assert.ok(layout.scrollWidth <= layout.clientWidth + 1, `${width}px 화면에서 가로 잘림 없음`)
    assert.equal(layout.lines, 5)
    await panel.getByText('회의에서 참석 여부 응답 →', { exact: true }).waitFor()
    await page.screenshot({ path: `dev-tools/ai-workflow/.state/meeting-change-notice-${width}.png` })
  }
  assert.deepEqual(errors, [], '실제 알림 컴포넌트 렌더 오류 없음')
  assert.deepEqual(external, [], '운영·외부 네트워크 호출 없음')
  console.log('meeting-change-notices-browser: 실제 SQL 알림의 전후 비교·응답 안내·줄바꿈·360px/데스크톱 표시 통과')
} finally {
  await browser?.close()
  await server.close()
}
