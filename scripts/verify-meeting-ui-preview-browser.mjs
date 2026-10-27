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
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, timezoneId: 'Asia/Seoul' })
  const origin = 'http://127.0.0.1:5197'
  await context.route('**/*', route => { if (route.request().url().startsWith(origin + '/')) return route.continue(); external.push(route.request().url()); return route.abort() })
  await context.addInitScript(() => {
    if (sessionStorage.getItem('fixture:scale')) return
    const host = { id: 'fixture-user', name: '화면 검수', departmentName: '기획팀' }, member = { id: 'other-user', name: '검증 동료', departmentName: 'MD팀' }
    const round = (id, roomId, clock) => ({ id, roomId, startsAt: '2030-01-07T' + clock, round: 1, confirmed: true, quarterId: 'q1', prepMaterials: [], content: '참석자만 보는 회의 내용', result: '', responses: [] })
    sessionStorage.setItem('atelier:meeting-fixture', JSON.stringify({ files: {}, audit: [], participation: [{profile_id:'other-user',titles:['기존 프로젝트','응답할 프로젝트','비참석 진행 회의']}], series: [
      { id: 'fixture-meeting', title: '기존 프로젝트', revision: 1, phase: 'published', host, members: [member], status: 'in_progress', durationMinutes: 60, rounds: [round('fixture-round', 'room-1', '10:00')] },
      { id: 'member-meeting', title: '응답할 프로젝트', revision: 1, phase: 'published', host: member, members: [host], status: 'in_progress', durationMinutes: 60, rounds: [round('member-round', 'room-2', '14:00')] },
    ] }))
  })
  page = await context.newPage(); page.setDefaultTimeout(15000)
  await page.clock.install({ time: new Date('2030-01-07T08:00:00+09:00') })
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
  await page.getByText('회의 성격 미리보기', { exact: false }).waitFor()
  await page.getByRole('tab', { name: '대회의실', exact: true }).waitFor()
  await page.evaluate(() => { window.__previewCalls = [] })
  const row = title => page.getByRole('listitem').filter({ has: page.getByText(title, { exact: true }) })
  const drawer = title => page.getByRole('dialog', { name: title, exact: true })
  async function openCreate(kind, title) {
    await page.getByRole('button', { name: '회의 생성', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '회의 생성', exact: true })
    if (page.viewportSize().width >= 768) assert.equal(Math.round((await dialog.boundingBox()).width), Math.round(originalWidth), '기존 생성 창을 그대로 재사용')
    await dialog.getByLabel('회의 성격', { exact: true }).selectOption(kind)
    await dialog.getByLabel('회의 주제', { exact: true }).fill(title)
    if (kind === 'project' || kind === 'routine' || kind === 'meeting' || kind === 'interview') {
      await dialog.getByRole('button', { name: '멤버 목록 열기', exact: true }).click()
      const member = dialog.getByRole('button', { name: '검증 동료 진행 중 3건', exact: true })
      await member.click()
      const tooltip = page.getByRole('tooltip').filter({ hasText: '검증 동료님의 진행 회의' })
      await tooltip.getByText('비참석 진행 회의', { exact: true }).waitFor({ state: 'visible' })
      await dialog.getByRole('button', { name: '멤버 목록 열기', exact: true }).click()
    }
    return dialog
  }
  async function prepare(kind, title) {
    const dialog = await openCreate(kind, title)
    await dialog.getByRole('button', { name: kind === 'meeting' ? '미팅 생성' : '준비 회의 생성', exact: true }).click()
    await drawer(title).waitFor()
    return drawer(title)
  }
  async function closeDetail(dialog) { await dialog.getByRole('button', { name: '닫기', exact: true }).last().click(); await dialog.waitFor({ state: 'hidden' }) }
  async function openDetail(title) { await row(title).getByRole('button', { name: '상세', exact: true }).click(); await drawer(title).waitFor(); return drawer(title) }
  let bookedMeeting = false
  async function schedule(dialog, date, room, clock) {
    if (await dialog.getByRole('button', { name: '일정 확정하기', exact: true }).count()) await dialog.getByRole('button', { name: '일정 확정하기', exact: true }).click()
    const picker = page.getByRole('dialog', { name: '회의 일정 확정', exact: true })
    await picker.getByLabel('회의 시간', { exact: true }).selectOption('60')
    await picker.getByLabel('회의 연도', { exact: true }).selectOption(date.slice(0, 4))
    await picker.getByLabel('회의 월', { exact: true }).selectOption(String(Number(date.slice(5, 7))))
    await picker.getByRole('button', { name: `${date} 날짜 선택`, exact: true }).click()
    assert.equal(await picker.getByRole('button', { name: '대회의실 12:00 시작', exact: true }).isDisabled(), true)
    if (date === '2030-01-07') assert.equal(await picker.getByRole('button', { name: '대회의실 10:00 시작', exact: true }).isDisabled(), true)
    if (date === '2030-01-07' && bookedMeeting) assert.equal(await picker.getByRole('button', { name: '소회의실 11:00 시작', exact: true }).isDisabled(), true, '미팅도 다른 회의의 중복 예약을 막음')
    await picker.getByRole('button', { name: `${room === 'room-1' ? '대회의실' : '소회의실'} ${clock} 시작`, exact: true }).click()
    const conflicts = picker.getByRole('checkbox', { name: '멤버의 겹치는 일정을 확인했으며 이 시간으로 진행합니다.', exact: true })
    if (await conflicts.count()) await conflicts.check()
    await picker.getByRole('button', { name: '일정 확정', exact: true }).click()
    await picker.waitFor({ state: 'hidden' })
  }
  await page.screenshot({ path: path.join(root, '.tmp/meeting-ui-preview-desktop.png'), fullPage: true })
  let dialog = await openCreate('meeting', '미팅 예약 검수')
  await dialog.getByRole('button', { name: '미팅 생성', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '회의 일정 확정', exact: true })
  await dialog.waitFor()
  assert.equal(await drawer('미팅 예약 검수').count(), 0, '미팅 생성 후 상세를 거치지 않고 바로 일정 선택')
  assert.equal(await dialog.locator('textarea').count(), 0, '미팅은 내용·회의록을 작성하지 않음')
  assert.equal(await dialog.getByRole('button', { name: '미팅 완료', exact: true }).count(), 0, '일정 확정 전에는 바로 완료할 수 없음')
  await schedule(dialog, '2030-01-07', 'room-2', '11:00')
  bookedMeeting = true
  await page.getByRole('tab', { name: '소회의실', exact: true }).click()
  await page.getByRole('table').getByText(/미팅 예약 검수/).waitFor()
  dialog = await openDetail('미팅 예약 검수')
  await dialog.getByText('2030-01-07 · 11:00–12:00 · 소회의실', { exact: true }).waitFor()
  await dialog.getByRole('button', { name: '검증 동료 · 일정 공유', exact: true }).waitFor()
  assert.equal(await dialog.getByRole('button', { name: '참석 가능', exact: true }).count(), 0)
  assert.equal(await dialog.getByRole('button', { name: '참석 불가', exact: true }).count(), 0)
  assert.equal(await row('미팅 예약 검수').getByText('참석 응답 대기', { exact: true }).count(), 0)
  assert.equal(await dialog.locator('textarea').count(), 0)
  assert.equal(await dialog.getByRole('button', { name: '저장하고 다음 회의 진행', exact: true }).count(), 0)
  await dialog.getByRole('button', { name: '미팅 완료', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  assert.equal(await page.getByRole('tab', { name: /^완료/ }).getAttribute('aria-selected'), 'true')
  dialog = await prepare('one_off', '1회성 회의 UI 검수')
  await dialog.getByLabel('회의 안내', { exact: true }).fill('한 번의 회의 안건')
  await dialog.locator('input[type=file]').setInputFiles({ name: 'preview-notes.txt', mimeType: 'text/plain', buffer: Buffer.from('화면 안에서만 첨부하는 검증 자료') })
  await dialog.getByText('preview-notes.txt', { exact: true }).waitFor()
  await schedule(dialog, '2030-01-07', 'room-1', '15:00')
  dialog = await openDetail('1회성 회의 UI 검수')
  assert.equal(await dialog.getByLabel('회의 내용', { exact: true }).inputValue(), '한 번의 회의 안건')
  await dialog.getByText('preview-notes.txt', { exact: true }).waitFor()
  assert.equal(await dialog.getByRole('button', { name: '저장하고 다음 회의 진행', exact: true }).count(), 0)
  await dialog.getByLabel('회의 결과', { exact: true }).fill('1회성 회의 결정 사항')
  await dialog.getByRole('button', { name: '회의건 종료', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  await row('1회성 회의 UI 검수').waitFor()
  dialog = await prepare('project', '프로젝트 UI 검수')
  await dialog.getByLabel('회의 안내', { exact: true }).fill('프로젝트 준비 내용')
  await closeDetail(dialog)
  await row('프로젝트 UI 검수').getByRole('button', { name: /1차 회의/ }).getByText('일정 미확정', { exact: true }).waitFor()
  dialog = await prepare('routine', '루틴 UI 검수')
  await dialog.getByLabel('회의 안내', { exact: true }).fill('1차 루틴 회의 안건')
  assert.equal(await dialog.getByLabel('반복 주기').count(), 0)
  assert.equal(await dialog.getByLabel('반복 종료일').count(), 0)
  await schedule(dialog, '2030-01-07', 'room-2', '09:00')
  dialog = await openDetail('루틴 UI 검수')
  await row('루틴 UI 검수').getByText('루틴 회의', { exact: true }).evaluate(element => { if (!element.classList.contains('text-success')) throw new Error('루틴 색상 누락') })
  await row('기존 프로젝트').getByText('프로젝트 회의', { exact: true }).evaluate(element => { if (!element.classList.contains('text-primary')) throw new Error('프로젝트 색상 누락') })
  await page.locator('[title="09:00–10:00 루틴 UI 검수"]').evaluate(element => { if (!element.classList.contains('text-success')) throw new Error('일정표 루틴 색상 불일치') })
  await dialog.getByLabel('회의 결과', { exact: true }).fill('1차 회의 결과')
  await dialog.getByRole('button', { name: '저장하고 다음 회의 진행', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  await row('루틴 UI 검수').getByRole('button', { name: /2차 회의/ }).getByText('회의 안내 미작성', { exact: true }).waitFor()
  await row('루틴 UI 검수').getByRole('button', { name: /2차 회의/ }).click()
  dialog = drawer('루틴 UI 검수')
  await dialog.getByLabel('회의 안내', { exact: true }).fill('2차 루틴 회의 안건')
  await schedule(dialog, '2030-01-14', 'room-1', '11:00')
  const secondRound = row('루틴 UI 검수').getByRole('button', { name: /2차 회의/ })
  assert.equal(await secondRound.getAttribute('title'), '이전 차보다 7일 뒤')
  await secondRound.getByText('+7일', { exact: true }).waitFor()
  assert.equal(await row('루틴 UI 검수').getByRole('button', { name: /3차 회의/ }).count(), 0)
  assert.equal(await page.getByRole('tab', { name: /^진행중/ }).getAttribute('aria-selected'), 'true')
  dialog = await openCreate('interview', '기획팀 면접')
  assert.equal(await dialog.getByLabel('지원자 이름').count(), 0)
  assert.equal(await dialog.getByLabel('지원자 연락처').count(), 0)
  assert.equal(await dialog.getByLabel('면접 메모').count(), 0)
  await dialog.getByRole('button', { name: '면접 생성', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '회의 일정 확정', exact: true })
  await dialog.waitFor()
  assert.equal(await drawer('기획팀 면접').count(), 0, '면접도 생성 후 바로 일정 선택')
  await schedule(dialog, '2030-01-07', 'room-2', '16:00')
  await row('기획팀 면접').getByText('참석 응답 대기', { exact: true }).waitFor()
  dialog = await openDetail('기획팀 면접')
  await dialog.getByRole('button', { name: '검증 동료 · 응답 대기', exact: true }).waitFor()
  assert.equal(await dialog.getByRole('region', { name: '비공개 지원자 정보', exact: true }).count(), 0)
  await dialog.getByLabel('회의 내용', { exact: true }).fill('면접 진행 안내')
  await closeDetail(dialog)
  await row('응답할 프로젝트').getByRole('button', { name: '참석 가능', exact: true }).click()
  await row('응답할 프로젝트').getByRole('button', { name: '화면 검수 · 참석 가능', exact: true }).waitFor()
  dialog = await openDetail('응답할 프로젝트')
  await dialog.getByText('내 응답 · 참석 가능', { exact: true }).waitFor()
  await closeDetail(dialog)
  assert.equal(await row('기존 프로젝트').getByRole('button', { name: '전체 멤버와 대화', exact: true }).isDisabled(), true, '기존 화면 테스트와 같이 실제 대화방 생성 방지')
  await row('프로젝트 UI 검수').getByRole('button', { name: '삭제', exact: true }).click()
  const deletion = page.getByRole('dialog', { name: '회의건 영구 삭제', exact: true })
  await deletion.getByRole('checkbox').check()
  await deletion.getByRole('button', { name: '다음', exact: true }).click()
  await deletion.getByLabel('삭제 확인 주제', { exact: true }).fill('프로젝트 UI 검수')
  await deletion.getByRole('button', { name: '영구 삭제', exact: true }).click()
  await deletion.waitFor({ state: 'hidden' })
  assert.equal(await row('프로젝트 UI 검수').count(), 0)
  const calls = await page.evaluate(() => window.__previewCalls)
  assert.deepEqual(calls.filter(name => !name.startsWith('list_')), [], '실제 저장·예약·첨부·응답·삭제·알림 RPC 없음')
  assert.equal(calls.includes('list_meeting_availability'), false, '서버에 없는 미리보기 회의로 개인정보 조회를 요청하지 않음')
  assert.equal(await page.evaluate(() => sessionStorage.getItem('atelier:meeting-fixture')), initial)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: path.join(root, '.tmp/meeting-ui-preview-mobile.png'), fullPage: true })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  dialog = await openCreate('routine', '모바일 루틴 검수')
  assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth), true)
  await page.screenshot({ path: path.join(root, '.tmp/meeting-ui-preview-mobile-create.png'), fullPage: true })
  await dialog.getByRole('button', { name: '닫기', exact: true }).click()
  await page.getByRole('button', { name: '기존 화면', exact: true }).click()
  await page.getByRole('button', { name: '새 화면 미리보기', exact: true }).click()
  assert.equal(await row('루틴 UI 검수').count(), 0)
  await page.getByRole('button', { name: '검증 계정 전환', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: '기존 화면', exact: true }).getAttribute('aria-pressed'), 'true')
  await page.getByRole('button', { name: '새 화면 미리보기', exact: true }).click()
  dialog = await prepare('one_off', '조회 실패 검수')
  await dialog.getByRole('button', { name: '일정 확정하기', exact: true }).click()
  const failurePicker = page.getByRole('dialog', { name: '회의 일정 확정', exact: true })
  await failurePicker.getByLabel('회의 시간', { exact: true }).selectOption('60')
  await page.evaluate(() => { sessionStorage.setItem('fixture:calendar-error', '1'); return window.__previewRefresh() })
  assert.equal(await failurePicker.getByRole('button', { name: '일정 확정', exact: true }).isDisabled(), true)
  await page.reload()
  assert.equal(await page.getByRole('button', { name: '기존 화면', exact: true }).getAttribute('aria-pressed'), 'true')
  assert.deepEqual(errors, [])
  assert.deepEqual(external, [])
  // 긴 제목·다수 멤버·20개 회차를 가진 회의 8건에서도 카드 내부가 넘치지 않아야 한다.
  await page.evaluate(() => {
    sessionStorage.removeItem('fixture:calendar-error')
    sessionStorage.setItem('fixture:scale', '1')
    const fixture = JSON.parse(sessionStorage.getItem('atelier:meeting-fixture'))
    const base = fixture.series[0]
    fixture.series = Array.from({ length: 8 }, (_, index) => ({ ...base,
      id: `scale-meeting-${index}`, title: `확장 검수 ${index + 1} · ${'여러 부서가 함께 논의하는 장기 프로젝트의 진행 상황과 다음 작업을 확인하는 회의 '.repeat(4)}`,
      members: Array.from({ length: 24 }, (_, member) => ({ id: `scale-person-${member}`, name: `참석직원${member + 1}`, departmentName: '기획팀' })),
      rounds: Array.from({ length: 20 }, (_, round) => ({ ...base.rounds[0], id: `scale-round-${index}-${round}`, round: round + 1,
        startsAt: `2030-01-${String(round + 1).padStart(2, '0')}T10:00`, responses: [],
      })),
    }))
    sessionStorage.setItem('atelier:meeting-fixture', JSON.stringify(fixture))
  })
  await page.reload()
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1100 })
    const entries = page.getByRole('listitem').filter({ has: page.getByText(/^확장 검수 /) })
    await entries.first().waitFor()
    assert.equal(await entries.count(), 8)
    const entry = entries.first()
    if (width < 640) assert.ok((await entry.getByText(/^확장 검수 /).boundingBox()).width > (await entry.boundingBox()).width * 0.8, '모바일 제목은 카드 전체 너비 사용')
    const members = entry.getByRole('group', { name: '회의 멤버', exact: true })
    const rounds = entry.getByRole('group', { name: '회의 회차', exact: true })
    assert.equal(await members.getByRole('button').count(), 26, '호스트·24명·전체 대화 버튼 유지')
    const first = await rounds.getByRole('button', { name: /^1차 회의/ }).boundingBox()
    const last = await rounds.getByRole('button', { name: /20차 회의/ }).boundingBox()
    assert.ok(last.y > first.y, '20개 회차가 여러 줄로 배치')
    assert.ok((await members.boundingBox()).y > (await entry.getByText(/^확장 검수 /).boundingBox()).y, '멤버는 제목 아래 별도 행')
    assert.equal(await entries.evaluateAll(elements => elements.every(element => element.scrollWidth <= element.clientWidth)), true, '회의 카드 가로 넘침 없음')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    await entry.screenshot({ path: path.join(root, `.tmp/meeting-list-scale-${width}.png`) })
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(external, [])
  console.log('meeting-ui-preview-browser: shared original UI/form/drawer/calendar/rounds/materials/response/delete; meeting date/time/room booking and conflict blocking without notes; one-off completion; open-ended routine; interview without applicant fields; mobile; reset/failure guards; zero server mutations or external requests passed')
} catch (error) {
  if (page) await page.screenshot({ path: path.join(root, '.tmp/meeting-ui-preview-failure.png'), fullPage: true }).catch(error => console.warn('[meeting-ui-preview-test] 실패 화면 캡처 실패', error))
  throw error
} finally { await browser?.close(); await server?.close() }
