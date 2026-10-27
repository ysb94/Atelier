import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { chromium } from 'playwright-core'

// 실제 공통 알림 컴포넌트·쿼리·타이머를 실행한다. 인증/DB 경계만 대역으로 바꿔 운영 쓰기는 없다.
const root = process.cwd()
const initial = {
  id: 'meeting-one', title: '주간 회의', phase: 'published', status: 'in_progress', durationMinutes: 60,
  host: { id: 'host', name: '호스트' }, members: [{ id: 'member', name: '멤버' }],
  rounds: [{ id: 'round-one', round: 1, confirmed: true, scheduleVersion: 1, startsAt: '2030-01-08T10:00', roomId: 'room-1', quarterId: 'q1', prepMaterials: [], content: '', result: '' }],
}
const source = {
  entry: `import React from 'react'; import {createRoot} from 'react-dom/client';
    import {BrowserRouter} from 'react-router-dom'; import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
    import {MeetingStartReminder} from '/src/features/meetings/MeetingStartReminder.tsx'; import '/src/index.css';
    window.fixture={profile:{id:'member',companyId:'company',status:'active'},rows:[${JSON.stringify(initial)}],calls:0};
    const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:30000,refetchOnWindowFocus:false}}});
    window.changeFixture=async patch=>{Object.assign(window.fixture,patch);window.dispatchEvent(new Event('fixture'));await client.invalidateQueries({queryKey:['company-meetings']});};
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><BrowserRouter><main>다른 업무 화면</main><MeetingStartReminder/></BrowserRouter></QueryClientProvider>);`,
  auth: `import {useSyncExternalStore} from 'react'; const subscribe=fn=>{window.addEventListener('fixture',fn);return()=>window.removeEventListener('fixture',fn)}; export function useAuth(){const profile=useSyncExternalStore(subscribe,()=>window.fixture.profile);return {profile}}`,
  attendance: `export const useAttendanceEntry=()=>null;`,
  api: `export async function listCompanyMeetings(){window.fixture.calls++;return structuredClone(window.fixture.rows)};export async function listMeetingRooms(){return [{id:'room-1',name:'대회의실'},{id:'room-2',name:'소회의실'}]}`,
}
const virtual = name => path.join(root, `__meeting-reminder-${name}.tsx`).replaceAll('\\', '/')
const server = await createServer({ root, configFile: false, envFile: false, logLevel: 'error',
  cacheDir: path.join(root, 'node_modules/.cache/meeting-start-reminders/vite'),
  optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', '@tanstack/react-query', 'react-router-dom'] },
  plugins: [{ name: 'meeting-start-fixture', enforce: 'pre',
    resolveId(id) {
      if (Object.keys(source).some(key => virtual(key) === id)) return id
      if (id.startsWith('/__meeting-reminder-')) return path.join(root, id.slice(1)).replaceAll('\\', '/')
    },
    load(id) { const name = Object.keys(source).find(key => virtual(key) === id); if (name) return source[name] },
    configureServer(vite) { vite.middlewares.use((req, res, next) => {
      if (!req.headers.accept?.includes('text/html')) return next()
      vite.transformIndexHtml(req.url, '<!doctype html><html lang="ko"><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/__meeting-reminder-entry.tsx"></script></body></html>')
        .then(html => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html) }).catch(next)
    }) },
  }, react(), tailwindcss()],
  resolve: { alias: [
    { find: '@/lib/supabase/auth', replacement: virtual('auth') },
    { find: '@/lib/supabase/meetings', replacement: virtual('api') },
    { find: '@/features/home/attendance-entry-context', replacement: virtual('attendance') },
    { find: '@', replacement: path.join(root, 'src') },
  ] },
  server: { host: '127.0.0.1', port: 5198, strictPort: true, hmr: false, fs: { allow: [root] } },
})
let browser
try {
  await server.listen()
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch({ executablePath: process.env.ATELIER_CHROMIUM_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const context = await browser.newContext({ timezoneId: 'America/Los_Angeles', viewport: { width: 360, height: 760 } })
  const errors = [], external = []
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)))
  await context.route('**/*', route => {
    if (route.request().url().startsWith(origin + '/')) return route.continue()
    external.push(route.request().url()); return route.abort()
  })
  const page = await context.newPage()
  await page.clock.install({ time: new Date('2030-01-08T00:29:00Z') })
  const panel = page.getByRole('dialog', { name: '회의 시작 전 확인', exact: true })
  const waitHidden = async () => { await panel.waitFor({ state: 'hidden' }) }
  await page.goto(origin)
  await page.waitForFunction(() => window.fixture?.calls > 0)
  assert.equal(await panel.count(), 0, '31분 전에는 안 뜸')
  await page.clock.fastForward(60_000)
  await panel.waitFor()
  await panel.getByText('30분 후 시작 · 내 역할: 멤버', { exact: true }).waitFor()
  await panel.getByText('2030-01-08 10:00 (한국 시간)', { exact: true }).waitFor()
  await panel.getByText('대회의실', { exact: true }).waitFor()
  await page.reload()
  await panel.waitFor()
  await panel.getByRole('button', { name: '확인', exact: true }).click()
  await waitHidden()
  await page.reload()
  await page.waitForFunction(() => window.fixture?.calls > 0)
  assert.equal(await panel.count(), 0, '확인한 일정은 새로고침해도 반복하지 않음')

  const changed = structuredClone(initial)
  Object.assign(changed.rounds[0], { scheduleVersion: 2, roomId: 'room-2', durationMinutes: 90 })
  await page.evaluate(rows => window.changeFixture({ rows }), [changed])
  await panel.waitFor()
  await panel.getByText('소회의실', { exact: true }).waitFor()
  await panel.getByText('90분', { exact: true }).waitFor()
  await page.evaluate(rows => window.changeFixture({ rows }), [{ ...changed, members: [] }])
  await waitHidden()
  await page.evaluate(rows => window.changeFixture({ rows }), [{ ...changed, status: 'done' }])
  assert.equal(await panel.count(), 0, '완료한 회의는 제외')
  await page.evaluate(rows => window.changeFixture({ rows }), [changed])
  await panel.waitFor()
  await panel.getByRole('button', { name: '확인하고 회의 보기' }).click()
  await waitHidden()
  await page.waitForURL('**/settings/profile?part=meetings&meeting=meeting-one&round=round-one')

  await page.evaluate(() => window.changeFixture({ profile: { id: 'host', companyId: 'company', status: 'active' } }))
  await panel.waitFor()
  await panel.getByText('30분 후 시작 · 내 역할: 호스트', { exact: true }).waitFor()
  const second = { ...structuredClone(changed), id: 'meeting-two', title: '상품 회의', rounds: [{ ...changed.rounds[0], id: 'round-two' }] }
  await page.evaluate(rows => window.changeFixture({ rows }), [changed, second])
  await panel.getByRole('heading', { name: '회의 시작 전 확인 · 2건' }).waitFor()
  const box = await panel.evaluate(node => ({ scroll: node.scrollWidth, width: node.clientWidth }))
  assert.ok(box.scroll <= box.width + 1, '모바일에서 여러 회의를 가로 잘림 없이 표시')
  await fs.mkdir('dev-tools/ai-workflow/.state', { recursive: true })
  await page.screenshot({ path: 'dev-tools/ai-workflow/.state/meeting-start-reminders-360.png' })
  await page.setViewportSize({ width: 1280, height: 760 })
  await page.screenshot({ path: 'dev-tools/ai-workflow/.state/meeting-start-reminders-1280.png' })
  await page.clock.fastForward(30 * 60_000)
  await waitHidden()
  assert.deepEqual(errors, [], '렌더·타이머 오류 없음')
  assert.deepEqual(external, [], '운영/외부 네트워크 호출 없음')
  console.log('meeting-start-reminders-browser: 다른 메뉴에서 30분 경계, 확인·새로고침, 재확정·완료·탈퇴, 역할·계정 분리, 회의 이동, 여러 회의, 360px/데스크톱, 시작 후 만료 통과')
} finally {
  await browser?.close()
  await server.close()
}
