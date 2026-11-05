import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { chromium } from 'playwright-core'

// Real My Schedule calendar + department hook/UI. All unrelated APIs and writes
// are isolated fixtures; no employee or production record is used.
const root = process.cwd(), port = 5218, origin = `http://127.0.0.1:${port}`
const mockId = path.join(root, '__department-mock.tsx').replaceAll('\\', '/'), entryId = path.join(root, '__department-entry.tsx').replaceAll('\\', '/')
const mocked = ['lib/supabase/auth', 'lib/supabase/department-schedule', 'lib/supabase/attendance-clocks', 'lib/supabase/company-notices',
  'features/home/use-my-clock-in', 'features/home/attendance-entry-context', 'components/layout/workspace-tab-activity',
  'features/operations-support/use-leave-requests', 'features/operations-support/use-leave-advances', 'features/operations-support/use-department-approvers',
  'features/operations-support/ops-directory', 'features/operations-support/HolidayWorkPanel', 'features/settings/MyLeaveAdvanceSummary',
  'features/settings/OffsiteGroupFields', 'features/settings/offsite-group-state', 'features/settings/use-my-home-notifications',
  'features/settings/use-schedule-todos', 'features/settings/use-my-schedule-meetings', 'features/home/OffsiteStatus',
  'features/settings/OffsiteSettlementResult', 'features/settings/OffsiteWorkdayStartField', 'features/settings/OffsiteDateTimeFields']
const aliases = new Set(mocked.map(name => path.join(root, 'src', name).replaceAll('\\', '/')))
const mock = `
import React,{createContext,useContext,useState}from'react';const EMPTY=[];const Auth=createContext(null),Activity=createContext(true);
window.__deptCalls=[];window.__failed=false;window.__unready=false;window.__hold=false;window.__waiters=[];window.__reads=[];
const profile=(id='employee',departmentId='planning')=>({id,departmentId,companyId:'company',departmentName:departmentId==='planning'?'기획팀':'Visual팀',status:'active'});
export function Fixture({children}){const[p,setP]=useState(profile()),[sessionId,setSession]=useState('employee'),[active,setActive]=useState(true);window.__profile=p;window.__setProfile=next=>{setP(next);setSession(next.id)};window.__mismatch=()=>setSession('different');window.__active=setActive;return <Auth.Provider value={{profile:p,session:{user:{id:sessionId}}}}><Activity.Provider value={active}>{children}</Activity.Provider></Auth.Provider>}
export const useAuth=()=>useContext(Auth),useWorkspaceTabActivity=()=>useContext(Activity),useAttendanceEntry=()=>null;
export const useMyClockIn=()=>({loading:false,exempt:true,refresh:async()=>{}});
const own={id:'own',employeeId:'employee',kind:'annual',from:'2026-11-05',to:'2026-11-05',start:'09:00',end:'18:00',place:'',note:'나의 신청',status:'approved',createdAt:'2026-11-01',decidedBy:null};
const OWN=[own];export const useLeaveRequests=()=>({requests:OWN,userId:'employee',busy:false,loading:false,error:null});
export const useLeaveAdvances=()=>({rows:EMPTY,employees:EMPTY}),useDepartmentApprovers=()=>({settings:EMPTY,loading:false,error:null}),useOpsDirectory=()=>({members:EMPTY,departments:EMPTY,loading:false,error:null});
export const listMyAttendanceClocks=async()=>EMPTY,listEmployeeAttendanceClocks=async()=>EMPTY,listCompanyNotices=async()=>EMPTY;
export const useScheduleTodos=()=>({data:EMPTY,todos:EMPTY,isSuccess:true,busy:false}),useMyScheduleMeetings=()=>({events:EMPTY,loading:false});
export const OffsiteGroupHistory=()=>null,OffsiteStartEditor=()=>null,MyLeaveAdvanceSummary=()=>null,HolidayWorkPanel=()=>null;
export const OffsiteConnectionNotice=()=>null,OffsiteSettlementResult=()=>null,OffsiteWorkdayStartField=()=>null,OffsiteDateTimeFields=()=>null;
export const useOffsiteGroups=()=>({rows:EMPTY}),refreshOffsiteQueries=async()=>{};
export function useReadMyHomeNotification(...args){if(args[3])window.__reads.push(args);return{error:null,retry:()=>{}}}
export const useMyHomeNotifications=()=>({work:EMPTY,items:EMPTY,ready:true,error:null});
export async function listDepartmentAbsences(month){const scope={...window.__profile};window.__deptCalls.push({id:scope.id,dept:scope.departmentId,month});if(window.__hold)await new Promise(r=>window.__waiters.push(r));if(window.__failed)throw Error('fixture timeout');if(window.__unready)return{ready:false,rows:[]};return{ready:true,rows:scope.departmentId==='planning'?Array.from({length:4},(_,n)=>({id:'peer'+n,employeeId:'colleague'+n,name:['동료 가','동료 나','동료 다','동료 라'][n],kind:['annual','half','offsite','official'][n],from:month+'-05',to:month+'-05',start:'14:00',end:'18:00',continuous:false,endNextDay:false})):[{id:'visual',employeeId:'visual-peer',name:'Visual 동료',kind:'quarter',from:month+'-05',to:month+'-05',start:'16:00',end:'18:00',continuous:false,endNextDay:false}]}}
`
const entry = `import React from'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{MemoryRouter}from'react-router-dom';import{Fixture}from'${mockId}';import{MyAttendancePanel}from'/src/features/settings/MyAttendancePanel.tsx';import'/src/index.css';const cache=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});window.__cache=cache;createRoot(document.getElementById('root')).render(<QueryClientProvider client={cache}><Fixture><MemoryRouter><main className="mx-auto max-w-6xl p-4"><MyAttendancePanel/></main></MemoryRouter></Fixture></QueryClientProvider>);`
const server = await createServer({ root, configFile: false, envFile: false, logLevel: 'error', cacheDir: path.join(root, 'node_modules/.cache/department-schedule-vite'),
  optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', '@tanstack/react-query', 'react-router-dom'] },
  plugins: [{ name: 'department-fixture', enforce: 'pre', resolveId(source, importer) {
    if (source === '/__department-entry.tsx' || source === entryId) return entryId
    if (source === mockId) return mockId
    const target = source.startsWith('@/') ? path.join(root, 'src', source.slice(2)) : importer && source.startsWith('.') ? path.resolve(path.dirname(importer), source) : path.isAbsolute(source) ? source : ''
    if (aliases.has(target.replaceAll('\\', '/').replace(/\.tsx?$/, ''))) return mockId
  }, load(id) { if (id === mockId) return mock; if (id === entryId) return entry }, configureServer(vite) {
    vite.middlewares.use((req, res, next) => {
      if (!req.headers.accept?.includes('text/html')) return next()
      vite.transformIndexHtml(req.url, '<!doctype html><html lang="ko"><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/__department-entry.tsx"></script></body></html>').then(html => { res.setHeader('Content-Type', 'text/html'); res.end(html) }).catch(next)
    })
  } }, react(), tailwindcss()], resolve: { alias: [...mocked.map(name => ({ find: '@/' + name, replacement: mockId })), { find: '@', replacement: path.join(root, 'src') }] }, server: { host: '127.0.0.1', port, strictPort: true, hmr: false } })
let browser
try {
  await server.listen(); browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const context = await browser.newContext({ viewport: { width: 1400, height: 1100 }, timezoneId: 'Asia/Seoul' }), external = [], errors = []
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : (external.push(route.request().url()), route.abort()))
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message)); await page.clock.install({ time: new Date('2026-11-05T00:00:00Z') })
  await page.goto(origin, { timeout: 90000 })
  const toggle = page.getByRole('checkbox', { name: '같은 부서 일정 표시', exact: true }), list = page.getByRole('region', { name: '선택 날짜의 부서 일정', exact: true })
  await page.getByRole('button', { name: '부서 일정 +2건', exact: true }).waitFor(); assert.equal(await toggle.isChecked(), true)
  assert.equal(await list.locator('strong').count(), 4); assert.equal(await list.getByRole('button').count(), 0, 'peer list cannot edit, cancel, approve or open private details')
  await list.getByText('14:00–18:00', { exact: true }).first().waitFor()
  assert.equal((await page.evaluate(() => window.__reads)).length, 0, 'peer schedule does not mark somebody else’s notices read')
  // Existing personal schedule and own detail path remain intact.
  const own = page.getByRole('region', { name: '선택 날짜의 근태 일정', exact: true }); await own.getByRole('button', { name: '보기', exact: true }).click()
  await page.getByRole('dialog').waitFor(); await page.getByRole('dialog').getByRole('button', { name: '닫기', exact: true }).click()
  const search = page.getByRole('textbox', { name: '신청 검색', exact: true }); await search.fill('동료 다'); assert.equal(await list.locator('strong').count(), 1); await search.fill('')
  await toggle.uncheck(); assert.equal(await list.count(), 0); assert.equal(await page.locator('.is-department').count(), 0)
  const before = await page.evaluate(() => window.__deptCalls.length); await page.clock.runFor(31000); assert.equal(await page.evaluate(() => window.__deptCalls.length), before, 'disabled layer does not poll')
  await toggle.check(); await list.waitFor()
  await page.getByRole('button', { name: '다음 달', exact: true }).click(); await page.waitForFunction(() => window.__deptCalls.some(c => c.month === '2026-12'))
  assert.equal(await list.count(), 0, 'previous selected date cannot retain another month’s peer rows')
  await page.getByRole('button', { name: '이전 달', exact: true }).click(); await page.getByRole('button', { name: '부서 일정 +2건', exact: true }).click(); await list.waitFor()
  const out = path.join(root, '.tmp/department-schedule-browser'); await fs.mkdir(out, { recursive: true }); await page.screenshot({ path: path.join(out, 'desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
  await page.screenshot({ path: path.join(out, 'mobile.png'), fullPage: true })
  await page.evaluate(() => { window.__hold = true; window.__setProfile({ id: 'other', companyId: 'company', departmentId: 'visual', departmentName: 'Visual팀', status: 'active' }) })
  await page.getByText('부서 일정을 불러오는 중입니다.', { exact: true }).waitFor(); assert.equal(await list.count(), 0, 'new account does not see cached old department rows')
  await page.evaluate(() => { window.__hold = false; window.__waiters.splice(0).forEach(r => r()) }); await list.getByText('Visual 동료', { exact: true }).waitFor()
  await page.evaluate(() => window.__active(false)); const hidden = await page.evaluate(() => window.__deptCalls.length)
  await page.clock.runFor(61000); assert.equal(await page.evaluate(() => window.__deptCalls.length), hidden, 'hidden workspace does not poll')
  await page.evaluate(() => window.__active(true)); await list.waitFor()
  await page.evaluate(() => { window.__failed = true }); await page.getByRole('button', { name: '부서 일정 새로고침', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '부서 일정 조회 실패' }).waitFor(); assert.equal(await list.count(), 0, 'failure is not an available/free schedule')
  await page.evaluate(() => { window.__failed = false; window.__unready = true }); await page.getByRole('button', { name: '부서 일정 새로고침', exact: true }).click()
  await page.getByText('부서 일정 서버 연결 준비 중입니다.', { exact: true }).waitFor(); const pending = await page.evaluate(() => window.__deptCalls.length)
  await page.clock.runFor(61000); assert.equal(await page.evaluate(() => window.__deptCalls.length), pending, 'missing API does not repeat automatic requests')
  await page.evaluate(() => { window.__unready = false }); await page.getByRole('button', { name: '부서 일정 새로고침', exact: true }).click(); await list.waitFor()
  await page.evaluate(() => window.__mismatch()); await page.getByText('활성 직원 계정으로 로그인해 주세요.', { exact: true }).waitFor(); assert.equal(await list.count(), 0)
  assert.deepEqual(errors, []); assert.deepEqual(external, [])
  console.log('PASS real My Schedule PC/mobile: department layer/day list/overflow/search, own detail preserved, month/account isolation, hidden/disabled polling, failures/missing server, no peer mutations/read marks; external API blocked')
} finally { await browser?.close(); await server.close() }
