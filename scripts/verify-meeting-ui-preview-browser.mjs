import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { chromium } from 'playwright-core'

// 실제 화면/조회 모듈을 렌더하되 인증·DB는 기존 오프라인 fixture로 교체한다.
const root = process.cwd(), temp = path.join(root, '.tmp/meeting-ui-preview-check')
fs.mkdirSync(temp, { recursive: true })
const entry = path.join(temp, 'entry.tsx'), client = path.join(temp, 'client.ts')
const auth = path.join(root, 'dev-tools/ai-workflow/browser-fixture/page-preview-auth.tsx')
const originalClient = '/dev-tools/ai-workflow/browser-fixture/page-preview-client.ts'
fs.writeFileSync(client, `import {getSupabase as original} from '${originalClient}'; export const isSupabaseConfigured=()=>true;
export function getSupabase(){const base=original();return {...base,rpc(name,args){(window.__previewCalls??=[]).push(name);if(name==='list_meeting_calendar'&&sessionStorage.getItem('fixture:calendar-error'))return Promise.resolve({data:null,error:{message:'검증용 일정 조회 실패'}});return base.rpc(name,args)}}}`)
fs.writeFileSync(entry, `import {useState} from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {BrowserRouter} from 'react-router-dom';
import {CompanyMeetingsPage} from '@/features/meetings/CompanyMeetingsPage';import {useAuth,AuthDisplayProvider} from '@/lib/supabase/auth';import '@/index.css';
const cache=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});window.__previewRefresh=()=>cache.invalidateQueries();
function App(){const {profile}=useAuth();const [other,setOther]=useState(false);return <QueryClientProvider client={cache}><AuthDisplayProvider profile={other?{...profile,id:'other-user',displayName:'검증 동료'}:profile}><BrowserRouter><main style={{maxWidth:1500,margin:'auto',padding:24}}><button onClick={()=>setOther(x=>!x)}>검증 계정 전환</button><CompanyMeetingsPage/></main></BrowserRouter></AuthDisplayProvider></QueryClientProvider>};createRoot(document.getElementById('root')).render(<App/>);`)
let server, browser, page
const errors = [], external = []
try {
  server = await createServer({ configFile: false, envDir: false, logLevel: 'error', cacheDir: path.join(root, 'node_modules/.cache/meeting-ui-preview'),
    plugins: [{ name: 'meeting-ui-preview-fixture', enforce: 'pre', resolveId(source, importer) {
      if (!importer || !source.startsWith('.')) return
      const target = path.resolve(path.dirname(importer), source).replace(/\.tsx?$/, '')
      if (target === path.join(root, 'src/lib/supabase/auth')) return auth
      if (target === path.join(root, 'src/lib/supabase/client')) return client
    }, configureServer(vite) { vite.middlewares.use((req, res, next) => {
      if (!req.headers.accept?.includes('text/html')) return next()
      void vite.transformIndexHtml(req.url, '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/.tmp/meeting-ui-preview-check/entry.tsx"></script></body></html>').then(html => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html) }).catch(next)
    }) } }, react(), tailwindcss()],
    resolve: { alias: [{ find: '@/lib/supabase/auth', replacement: auth }, { find: '@/lib/supabase/client', replacement: client }, { find: '@', replacement: path.join(root, 'src') }] },
    server: { host: '127.0.0.1', port: 5197, strictPort: true, hmr: false, watch: { ignored: ['**/docs/backups/**'] } },
  })
  await server.listen()
  browser = await chromium.launch({ executablePath: process.env.ATELIER_CHROMIUM_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
  const origin = 'http://127.0.0.1:5197'
  await context.route('**/*', route => { if (route.request().url().startsWith(origin + '/')) return route.continue(); external.push(route.request().url()); return route.abort() })
  await context.addInitScript(() => {
    const host = { id: 'fixture-user', name: '화면 검수', departmentName: '기획팀' }, member = { id: 'other-user', name: '검증 동료', departmentName: 'MD팀' }
    const round = (id, roomId, clock) => ({ id, roomId, startsAt: '2030-01-07T' + clock, round: 1, confirmed: true, quarterId: 'q1', prepMaterials: [], content: '참석자만 보는 회의 내용', result: '', responses: [] })
    sessionStorage.setItem('atelier:meeting-fixture', JSON.stringify({ files: {}, audit: [], participation: [{profile_id:'other-user',titles:['기존 프로젝트','응답할 프로젝트','비참석 진행 회의']}], series: [
      { id: 'fixture-meeting', title: '기존 프로젝트', revision: 1, phase: 'published', host, members: [member], status: 'in_progress', durationMinutes: 60, rounds: [round('fixture-round', 'room-1', '10:00')] },
      { id: 'member-meeting', title: '응답할 프로젝트', revision: 1, phase: 'published', host: member, members: [host], status: 'in_progress', durationMinutes: 60, rounds: [round('member-round', 'room-2', '14:00')] },
    ] }))
  })
  page = await context.newPage(); page.setDefaultTimeout(15000)
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(origin + '/meetings')
  await page.getByRole('button', { name: '기존 화면', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '기존 화면', exact: true }).getAttribute('aria-pressed'), 'true')
  await page.getByRole('button', { name: '회의 생성', exact: true }).click()
  const oldDialog = page.getByRole('dialog', { name: '회의 생성', exact: true })
  const originalWidth = (await oldDialog.boundingBox()).width
  await oldDialog.getByRole('button', { name: '닫기', exact: true }).click()
  const initial = await page.evaluate(() => sessionStorage.getItem('atelier:meeting-fixture'))
  await page.getByRole('button', { name: '새 화면 미리보기', exact: true }).click()
  await page.getByLabel('회의실 일정 날짜').fill('2030-01-07')
  await page.waitForFunction(() => [...document.querySelectorAll('[data-meeting-ui-preview] button')].some(button => button.textContent === '회의 생성' && !button.disabled))
  assert.equal(await page.getByText('한눈에 보는 회의실', { exact: true }).count(), 0)
  await page.getByRole('tab', { name: '대회의실', exact: true }).waitFor()
  await page.getByRole('tab', { name: /^진행중/ }).waitFor()
  await page.evaluate(() => { window.__previewCalls = [] })
  await page.screenshot({ path: path.join(root, '.tmp/meeting-ui-preview-desktop.png'), fullPage: true })
  async function create(kind, title) {
    await page.getByRole('button', { name: '회의 생성', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '회의 생성 미리보기', exact: true })
    if (page.viewportSize().width >= 768) assert.equal(Math.round((await dialog.boundingBox()).width), Math.round(originalWidth), '생성 창 너비는 기존 회의 생성과 동일')
    await dialog.getByLabel('회의 성격', { exact: true }).selectOption(kind)
    await dialog.getByLabel('회의 주제', { exact: true }).fill(title)
    if (kind === 'project' || kind === 'routine') {
      await dialog.getByRole('button', { name: '멤버 목록 열기', exact: true }).click()
      const member = dialog.getByRole('button', { name: '검증 동료 진행 중 3건', exact: true })
      await member.click()
      const tooltip = page.getByRole('tooltip').filter({ hasText: '검증 동료님의 진행 회의' })
      await tooltip.getByText('비참석 진행 회의', { exact: true }).waitFor({ state: 'visible' })
      const visibleAboveDialog = await tooltip.evaluate(element => { const r=element.getBoundingClientRect(); return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest('[role="tooltip"]')===element })
      assert.equal(visibleAboveDialog, true, '진행 회의 제목이 생성 창 위에서 보임')
      await dialog.getByRole('button', { name: '멤버 목록 열기', exact: true }).click()
    }
    return dialog
  }
  async function schedule(dialog, room, clock) {
    await dialog.getByLabel('지금 일정 정하기').check()
    await dialog.getByLabel('미리보기 회의실', { exact: true }).selectOption(room)
    await dialog.getByRole('button', { name: `${room === 'room-1' ? '대회의실' : '소회의실'} ${clock} 선택`, exact: true }).click()
  }
  async function close(dialog) { await dialog.getByLabel('미리보기 창 닫기').click() }
  let dialog = await create('meeting', '미팅 진행 기록 검수')
  assert.equal(await dialog.getByLabel('회의 내용·안내', { exact: true }).count(), 0, '미팅은 회의록 입력 없음')
  assert.equal(await dialog.getByLabel('회의 결과·기록', { exact: true }).count(), 0, '미팅은 결과 입력 없음')
  assert.equal(await dialog.getByLabel('지금 일정 정하기').count(), 0)
  const meetingDate = await dialog.getByLabel('미팅 날짜', { exact: true }).inputValue()
  await dialog.getByRole('button', { name: '미팅 기록 미리보기', exact: true }).click()
  await page.getByRole('button', { name: '미팅 진행 기록 검수', exact: true }).waitFor()
  assert.equal(await page.getByRole('tab', { name: /^완료/ }).getAttribute('aria-selected'), 'true')
  await page.getByLabel('회의실 일정 날짜').fill(meetingDate)
  assert.equal(await page.getByRole('table').getByText('미팅 진행 기록 검수', { exact: false }).count(), 0, '진행 기록은 회의실 예약을 생성하지 않음')
  await page.getByLabel('회의실 일정 날짜').fill('2030-01-07')
  dialog = await create('one_off', '1회성 회의 UI 검수')
  await dialog.getByLabel('회의 내용·안내', { exact: true }).fill('한 번의 회의 안건')
  await dialog.getByLabel('회의 결과·기록', { exact: true }).fill('결정 사항 기록')
  await schedule(dialog, 'room-1', '15:00')
  assert.equal(await dialog.getByRole('button', { name: '대회의실 12:00 선택', exact: true }).isDisabled(), true)
  assert.equal(await dialog.getByRole('button', { name: '대회의실 10:00 선택', exact: true }).isDisabled(), true)
  assert.equal(await dialog.getByRole('button', { name: '대회의실 11:30 선택', exact: true }).isDisabled(), true)
  await dialog.getByRole('button', { name: '일정 확정 미리보기', exact: true }).click()
  await page.getByRole('button', { name: '1회성 회의 UI 검수', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '회의 상세 미리보기', exact: true })
  assert.equal(await dialog.getByLabel('상세 회의 내용').inputValue(), '한 번의 회의 안건')
  assert.equal(await dialog.getByLabel('상세 회의 결과').inputValue(), '결정 사항 기록')
  assert.equal(await dialog.getByRole('button', { name: '다음 회차 미리보기', exact: true }).count(), 0)
  await dialog.getByLabel('상세 회의 결과').fill('회의 완료 기록')
  await dialog.getByRole('button', { name: '회의 완료 미리보기', exact: true }).click()
  await close(dialog)
  await page.getByRole('button', { name: '1회성 회의 UI 검수', exact: true }).waitFor()
  dialog = await create('project', '프로젝트 UI 검수')
  await dialog.getByRole('button', { name: '준비 회의 생성 미리보기', exact: true }).click()
  await page.getByRole('button', { name: '프로젝트 UI 검수', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '회의 상세 미리보기', exact: true })
  await dialog.getByRole('button', { name: '일정 정하기 미리보기', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '회의 일정 확정 미리보기', exact: true })
  await schedule(dialog, 'room-2', '16:00')
  await dialog.getByRole('button', { name: '일정 확정 미리보기', exact: true }).click()
  dialog = await create('routine', '루틴 UI 검수')
  assert.equal(await dialog.getByLabel('반복 주기').count(), 0)
  assert.equal(await dialog.getByLabel('반복 종료일').count(), 0)
  assert.equal(await dialog.getByLabel('지금 일정 정하기').isChecked(), false)
  await dialog.evaluate(element => { element.scrollTop = 0 })
  await page.screenshot({ path: path.join(root, '.tmp/meeting-ui-preview-create.png'), fullPage: true })
  await dialog.getByRole('button', { name: '준비 회의 생성 미리보기', exact: true }).click()
  await page.getByRole('button', { name: '루틴 UI 검수', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '회의 상세 미리보기', exact: true })
  await dialog.getByRole('button', { name: '일정 정하기 미리보기', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '회의 일정 확정 미리보기', exact: true })
  await schedule(dialog, 'room-2', '09:00')
  await dialog.getByRole('button', { name: '일정 확정 미리보기', exact: true }).click()
  await page.getByRole('button', { name: '루틴 UI 검수', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '회의 상세 미리보기', exact: true })
  await dialog.getByLabel('상세 회의 결과').fill('1차 회의 결과')
  await dialog.getByRole('button', { name: '회차 완료 미리보기', exact: true }).click()
  await dialog.getByRole('button', { name: '다음 회차 미리보기', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '다음 회차 미리보기', exact: true })
  await dialog.getByRole('button', { name: '2030-01-14 선택', exact: true }).click()
  await schedule(dialog, 'room-1', '11:00')
  await dialog.getByRole('button', { name: '일정 확정 미리보기', exact: true }).click()
  const routineRow = page.getByRole('listitem').filter({ has: page.getByRole('button', { name: '루틴 UI 검수', exact: true }) })
  assert.equal(await routineRow.getByRole('button', { name: /^1차 회의/ }).count(), 1)
  assert.equal(await routineRow.getByRole('button', { name: /^2차 회의/ }).count(), 1)
  assert.equal(await routineRow.getByRole('button', { name: /^3차 회의/ }).count(), 0)
  assert.equal(await page.getByRole('tab', { name: /^진행중/ }).getAttribute('aria-selected'), 'true', '회차 완료 후에도 루틴은 계속 진행 중')
  dialog = await create('interview', '기획팀 면접')
  await dialog.getByLabel('지원자 이름').fill('비공개 지원자 예시')
  await dialog.getByLabel('지원자 연락처').fill('연락처 예시')
  await schedule(dialog, 'room-2', '17:00')
  await dialog.getByRole('button', { name: '일정 확정 미리보기', exact: true }).click()
  assert.equal(await page.getByText('비공개 지원자 예시', { exact: true }).count(), 0)
  assert.equal(await page.getByText('연락처 예시', { exact: true }).count(), 0)
  await page.getByRole('button', { name: '참석 가능', exact: true }).first().click()
  await page.getByRole('button', { name: '전체 멤버와 대화', exact: true }).first().click()
  await close(page.getByRole('dialog', { name: '전체 멤버 대화 미리보기', exact: true }))
  dialog = await create('one_off', '참석자 충돌 검수')
  await schedule(dialog, 'room-2', '11:00')
  await dialog.getByRole('button', { name: '소회의실 10:00 선택', exact: true }).click()
  await dialog.getByRole('button', { name: '일정 확정 미리보기', exact: true }).click()
  await dialog.getByRole('alert').filter({ hasText: '겹치는 일정' }).waitFor()
  await dialog.getByRole('checkbox', { name: '겹치는 일정을 확인했습니다.', exact: true }).check()
  await dialog.getByRole('button', { name: '일정 확정 미리보기', exact: true }).click()
  await page.getByRole('button', { name: '참석자 충돌 검수', exact: true }).waitFor()
  const calls = await page.evaluate(() => window.__previewCalls)
  assert.deepEqual(calls.filter(name => !name.startsWith('list_')), [])
  assert.equal(await page.evaluate(() => sessionStorage.getItem('atelier:meeting-fixture')), initial)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: path.join(root, '.tmp/meeting-ui-preview-mobile.png'), fullPage: true })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  dialog = await create('routine', '모바일 루틴 검수')
  assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth), true)
  await dialog.evaluate(element => { element.scrollTop = 0 })
  await page.screenshot({ path: path.join(root, '.tmp/meeting-ui-preview-mobile-create.png'), fullPage: true })
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '기존 화면', exact: true }).click()
  await page.getByRole('button', { name: '새 화면 미리보기', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: '루틴 UI 검수', exact: true }).count(), 0)
  await page.getByRole('button', { name: '검증 계정 전환', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: '기존 화면', exact: true }).getAttribute('aria-pressed'), 'true')
  await page.getByRole('button', { name: '새 화면 미리보기', exact: true }).click()
  await page.evaluate(() => { sessionStorage.setItem('fixture:calendar-error', '1'); return window.__previewRefresh() })
  await page.getByRole('alert').filter({ hasText: '빈 시간으로 판단하지 않습니다' }).waitFor()
  assert.equal(await page.getByRole('button', { name: '회의 생성', exact: true }).isDisabled(), true)
  await page.reload()
  assert.equal(await page.getByRole('button', { name: '기존 화면', exact: true }).getAttribute('aria-pressed'), 'true')
  assert.deepEqual(errors, [])
  assert.deepEqual(external, [])
  console.log('meeting-ui-preview-browser: original list/2-week calendar; compact five-kind creation; meeting record without booking/notes; one-off content/result/completion; project preparation; open-ended routine with individually scheduled rounds; private interview; local attendance/chat; mobile; reset/error guards; zero mutation RPCs/external requests passed')
} catch (error) {
  if (page) await page.screenshot({ path: path.join(root, '.tmp/meeting-ui-preview-failure.png'), fullPage: true }).catch(error => console.warn('[meeting-ui-preview-test] 실패 화면 캡처 실패', error))
  throw error
} finally { await browser?.close(); await server?.close() }
