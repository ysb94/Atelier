import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { chromium } from 'playwright-core'

const root = process.cwd(), folder = path.join(root, '.tmp/leave-balance-panel')
fs.mkdirSync(folder, { recursive: true })
const fixtures = {
  '@/lib/supabase/auth': `export function useAuth(){return {profile:{id:'manager',status:'active',permissionGrants:[],capabilities:[],memberships:[]}}}`,
  '@/lib/supabase/basic-work-access': `export function useBasicWorkAccess(){return {access:{domains:location.hash==='#denied'?[]:['operations']},isPending:false}}`,
  '@/features/operations-support/ops-directory': `const members=[{id:'a',displayName:'가 직원',departmentId:'ops',hireDate:'2024-01-01'},{id:'b',displayName:'나 직원',departmentId:'md',hireDate:null},{id:'c',displayName:'다 직원',departmentId:'ops',hireDate:'2025-01-01'}];export function useOpsDirectory(){return {members,departments:[{id:'ops',name:'운영지원'},{id:'md',name:'MD'}],departmentName:id=>id==='ops'?'운영지원':'MD',loading:false,error:null,refetch(){}}}`,
  '@/lib/supabase/employee-extra-leave': `const s=window.__bonus={entries:JSON.parse(sessionStorage.getItem('bonus')||'[]'),ready:true,fail:false,writes:0};export async function listExtraLeave(){return {ready:s.ready,fefoReady:true,events:[{id:'expiry-fixture',employeeId:'a',source:'base',kind:'expired',days:-1,date:'2026-10-29'}],entries:[...s.entries],balances:[{profileId:'a',available:s.entries.reduce((sum,e)=>sum+e.days-e.used,0)}]}};export async function saveExtraLeave(input){if(s.fail){s.fail=false;throw Error('추가 연차 저장 실패')}s.writes++;const entry=s.entries.find(e=>e.id===input.id);s.entries=input.remove?s.entries.filter(e=>e.id!==input.id):entry?s.entries.map(e=>e.id===input.id?{...e,...input,version:e.version+1}:e):[...s.entries,{...input,created:'2026-10-29',used:0,version:1}];sessionStorage.setItem('bonus',JSON.stringify(s.entries))}`,
  '@/lib/supabase/client': `const s=window.__leave={remaining:JSON.parse(sessionStorage.getItem('remaining')||'"initial"'),writes:[],reads:0,fail:false,readFail:false};export function getSupabase(){return {rpc:async()=>({data:null,error:{code:'PGRST202',message:'server pending'}}),from(table){if(table!=='employee_roster')throw Error(table);const q={select(){return q},upsert:async row=>{s.writes.push(row);if(s.fail){s.fail=false;return {error:{message:'save failed'}}}s.remaining=row.remaining_annual_leave;sessionStorage.setItem('remaining',JSON.stringify(s.remaining));return {error:null}},then:resolve=>{s.reads++;return Promise.resolve(s.readFail?{data:null,error:{message:'read failed'}}:{data:[{profile_id:'a',remaining_annual_leave:s.remaining==='initial'?7.75:s.remaining,accrued_annual_leave:15},{profile_id:'b',remaining_annual_leave:0,accrued_annual_leave:0}],error:null}).then(resolve)}};return q}}}`,
}
const aliases = []
for (const [index, [find, source]] of Object.entries(fixtures).entries()) {
  const replacement = path.join(folder, `mock-${index}.ts`)
  fs.writeFileSync(replacement, source)
  aliases.push({ find, replacement })
}
fs.writeFileSync(path.join(folder, 'entry.tsx'), `import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {LeaveBalancePanel} from '@/features/operations-support/LeaveBalancePanel';import '@/index.css';const cache=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false},mutations:{retry:false}}});window.__refresh=()=>cache.invalidateQueries({queryKey:['employee-roster']});window.__cached=()=>cache.getQueryData(['employee-roster']);createRoot(document.getElementById('root')).render(<QueryClientProvider client={cache}><LeaveBalancePanel/></QueryClientProvider>);`)
const server = await createServer({ configFile: false, envDir: false, logLevel: 'error',
  plugins: [{ name: 'leave-balance-fixtures', enforce: 'pre', resolveId(source, importer) {
    if (!importer || !source.startsWith('.')) return
    const target = path.resolve(path.dirname(importer), source).replace(/\.tsx?$/, '')
    return aliases.find(alias => path.join(root, 'src', alias.find.slice(2)) === target)?.replacement
  }, configureServer(vite) {
    vite.middlewares.use((req, res, next) => {
      if (!req.headers.accept?.includes('text/html')) return next()
      vite.transformIndexHtml(req.url, '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/.tmp/leave-balance-panel/entry.tsx"></script></body></html>').then(html => { res.setHeader('Content-Type', 'text/html'); res.end(html) }).catch(next)
    })
  } }, react(), tailwindcss()], resolve: { alias: [...aliases, { find: '@', replacement: path.join(root, 'src') }] },
  server: { host: '127.0.0.1', port: 5197, strictPort: true, hmr: false } })
let browser
try {
  await server.listen()
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = [], remote = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:5197/') ? route.continue() : (remote.push(route.request().url()), route.abort()))
  await page.goto('http://127.0.0.1:5197/')
  const input = page.getByRole('spinbutton', { name: '가 직원 남은 연차 입력', exact: true })
  await input.waitFor()
  await page.getByRole('cell', { name: '다 직원 추가 연차', exact: true }).getByText('기본 연차 미등록', { exact: true }).waitFor()
  await page.getByRole('cell', { name: '나 직원 추가 연차', exact: true }).getByText('0일', { exact: true }).waitFor()
  await page.getByRole('cell', { name: '가 직원 추가 연차', exact: true }).getByText('0일', { exact: true }).waitFor()
  await page.getByRole('button', { name: '가 직원 추가 연차 추가', exact: true }).click()
  const additional = page.getByRole('dialog', { name: '가 직원 추가 연차 입력', exact: true })
  await additional.getByRole('region', { name: '가 직원 연차 변동 이력', exact: true }).getByText('기본 연차 만료', { exact: false }).waitFor()
  await additional.getByRole('spinbutton', { name: '가 직원 추가 일수', exact: true }).fill('1.5')
  await additional.getByRole('textbox', { name: '가 직원 추가 연차 메모', exact: true }).fill('추가 사유 확인')
  await additional.getByRole('button', { name: '가 직원 추가 연차 사용 기한', exact: true }).click()
  const expiryPicker = page.getByRole('dialog', { name: '가 직원 추가 연차 사용 기한 선택', exact: true })
  await expiryPicker.getByRole('button', { name: '2026년', exact: true }).click()
  await expiryPicker.getByRole('button', { name: '12월', exact: true }).click()
  await expiryPicker.getByRole('button', { name: '31일', exact: true }).click()
  await expiryPicker.getByRole('button', { name: '적용', exact: true }).click()
  assert.equal(await page.evaluate(() => window.__leave.writes.length), 0, '추가 연차 입력은 아직 저장하지 않음')
  await page.evaluate(() => { window.__bonus.fail = true })
  await additional.getByRole('button', { name: '이력에 추가', exact: true }).click()
  await additional.getByRole('alert').waitFor()
  assert.equal(await additional.getByRole('spinbutton', { name: '가 직원 추가 일수', exact: true }).inputValue(), '1.5')
  await additional.getByRole('button', { name: '이력에 추가', exact: true }).click()
  await additional.getByText('+1.5일', { exact: true }).waitFor()
  await additional.getByText('(26.12.31까지) [추가 사유 확인]', { exact: false }).waitFor()
  assert.equal(await input.inputValue(), '9.25', '추가 연차 잔여에 합산')
  await page.reload(); await input.waitFor(); assert.equal(await input.inputValue(), '9.25')
  await page.getByRole('button', { name: '가 직원 추가 연차 추가', exact: true }).click()
  await additional.getByText('+1.5일', { exact: true }).waitFor()
  await additional.getByRole('button', { name: '수정', exact: true }).click()
  await additional.getByRole('spinbutton', { name: '가 직원 추가 일수', exact: true }).fill('2')
  await additional.getByRole('button', { name: '수정 반영', exact: true }).click()
  await additional.getByText('+2일', { exact: true }).waitFor()
  await additional.getByRole('button', { name: '부여 취소', exact: true }).click()
  await additional.getByRole('textbox', { name: '가 직원 부여 취소 사유', exact: true }).fill('부여 사유 취소 검증')
  await additional.getByRole('button', { name: '취소 확정', exact: true }).click()
  await additional.getByText('추가 이력이 없습니다.', { exact: true }).waitFor()
  await additional.getByRole('button', { name: '닫기', exact: true }).click()
  assert.equal(await additional.count(), 0)
  assert.equal(await input.inputValue(), '7.75')
  assert.equal(await page.getByRole('spinbutton', { name: '나 직원 남은 연차 입력', exact: true }).inputValue(), '0')
  assert.equal(await page.getByRole('spinbutton', { name: '다 직원 남은 연차 입력', exact: true }).inputValue(), '')
  await page.getByRole('cell', { name: '가 직원 발생일수', exact: true }).getByText('15일').waitFor()
  assert.equal(await page.getByRole('combobox', { name: '연차 연도' }).count(), 0)
  const row = page.getByRole('row').filter({ has: input })
  await input.fill('-4.5')
  await row.getByRole('button', { name: '저장', exact: true }).click()
  await row.getByRole('status').waitFor()
  assert.equal(await page.evaluate(() => window.__cached().find(row => row.profileId === 'a').remainingAnnualLeave), -4.5)
  assert.deepEqual(await page.evaluate(() => Object.keys(window.__leave.writes[0]).sort()), ['company_id', 'profile_id', 'remaining_annual_leave'])
  await page.reload(); await input.waitFor(); assert.equal(await input.inputValue(), '-4.5')
  await page.evaluate(() => { window.__leave.fail = true })
  await input.fill('6.25'); await row.getByRole('button', { name: '저장', exact: true }).click()
  await row.getByRole('alert').waitFor(); assert.equal(await input.inputValue(), '6.25')
  assert.equal(await page.evaluate(() => window.__cached().find(row => row.profileId === 'a').remainingAnnualLeave), -4.5)
  await row.getByRole('button', { name: '저장', exact: true }).click(); await row.getByRole('status').waitFor()
  await page.evaluate(async () => { window.__leave.remaining = 3.75; await window.__refresh() })
  assert.equal(await input.inputValue(), '3.75')
  await input.fill('9'); await row.getByRole('button', { name: '취소', exact: true }).click(); assert.equal(await input.inputValue(), '3.75')
  await input.fill(''); await row.getByRole('button', { name: '저장', exact: true }).click(); await row.getByRole('status').waitFor()
  assert.equal(await page.evaluate(() => window.__cached().find(row => row.profileId === 'a').remainingAnnualLeave), null)
  await page.getByRole('combobox', { name: '연차 부서' }).selectOption('md')
  assert.equal(await input.count(), 0)
  await page.getByRole('combobox', { name: '연차 부서' }).selectOption('all')
  await page.getByRole('textbox', { name: '연차 직원 검색' }).fill('다 직원')
  assert.equal(await page.getByRole('spinbutton').count(), 1)
  await page.setViewportSize({ width: 390, height: 844 })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 390), '모바일에서 표 내부 스크롤')
  await page.getByRole('textbox', { name: '연차 직원 검색' }).fill('')
  await page.evaluate(async () => { window.__leave.readFail = true; await window.__refresh() })
  await page.getByRole('alert').waitFor(); assert.equal(await page.getByRole('spinbutton').count(), 0)
  await page.evaluate(() => { window.__leave.readFail = false })
  await page.getByRole('button', { name: '새로고침', exact: true }).click(); await input.waitFor()
  await page.evaluate(() => {
    sessionStorage.setItem('remaining', '3.75')
    sessionStorage.setItem('bonus', JSON.stringify([{id:'birthday-fixture',employeeId:'a',days:0.5,expires:'2026-11-12',created:'2026-10-29',note:'2026년 생일 반차 · 26.10.29~26.11.12 사용 · 자동 부여',version:1,used:0}]))
  })
  await page.reload();await input.waitFor();assert.equal(await input.inputValue(),'4.25','자동 생일 .5일도 기존 추가 연차와 동일 합산')
  await page.getByRole('button', { name: '가 직원 추가 연차 추가', exact: true }).click()
  await additional.getByText('+0.5일', { exact: true }).waitFor()
  await additional.getByText('2026년 생일 반차 · 26.10.29~26.11.12 사용 · 자동 부여', { exact: false }).waitFor()
  await additional.getByText('등록 날짜: 26.10.29', { exact: true }).waitFor()
  await additional.getByRole('button', { name: '닫기', exact: true }).click()
  await page.goto('http://127.0.0.1:5197/#denied'); await page.reload()
  await page.getByText('연차 현황은 직원 명부 관리 권한이 있는 담당자만 조회·수정할 수 있습니다.').waitFor()
  assert.equal(await page.getByRole('spinbutton').count(), 0)
  assert.equal(await page.evaluate(() => window.__leave.reads), 0)
  assert.deepEqual(errors, []); assert.deepEqual(remote, [])
  console.log('leave-balance-panel: 실제 저장 API 연결·공유 캐시·새로고침·음수/0/미등록·실패 재시도·부서/이름 검색·권한 제한·모바일 검증 통과 (실제 직원 변경 없음)')
} finally { await browser?.close(); await server.close() }
