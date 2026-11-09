import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const root = process.cwd(), dir = path.join(root, '.tmp/attendance-enrollment-browser')
await mkdir(dir, { recursive: true })
const fixture = path.join(dir, 'fixture.tsx')
await writeFile(fixture, `
import{useSyncExternalStore}from'react';
const listeners=new Set();window.actor='hr';window.policyFailure=false;window.enrollmentReads=0;window.currentDay='2026-11-05';
window.setAccount=actor=>{window.actor=actor;listeners.forEach(fn=>fn())};
const subscribe=fn=>{listeners.add(fn);return()=>listeners.delete(fn)};
export function useAuth(){const actor=useSyncExternalStore(subscribe,()=>window.actor);return{profile:{id:actor,companyId:actor==='peer'?'other':'company',status:'active',createdAt:'2026-10-01T00:00:00Z',approvedAt:actor==='new'?'2026-11-05T07:11:26Z':null},session:{user:{id:actor}}}}
const people=[{id:'new',displayName:'신규 직원',departmentId:'office',hireDate:'2026-11-03'},{id:'old',displayName:'기존 직원',departmentId:'office',hireDate:'2020-01-01'}];
window.originalMembers=JSON.stringify(people);window.people=people;
window.clockRows=[...['03','04','05'].map(day=>({employeeId:'new',date:'2026-11-'+day,clockIn:'09:12'})),...['02','03','04'].map(day=>({employeeId:'old',date:'2026-11-'+day,clockIn:'09:00'}))];
export const listDepartments=async()=>[{id:'office',name:'테스트 부서'}];
export const listOrgChartMembers=async()=>window.actor==='peer'?[{id:'peer-member',displayName:'다른 회사 직원',departmentId:'office',hireDate:'2020-01-01'}]:window.people;
export const getSupabase=()=>({rpc:async name=>{if(name==='clock_in_today')window.clockWriteAttempts=(window.clockWriteAttempts||0)+1;if(name==='is_my_attendance_exempt')return{data:false,error:null};if(name!=='list_attendance_enrollments')throw Error('unexpected RPC '+name);window.enrollmentReads++;if(window.policyFailure)return{data:null,error:{code:'57014',message:'connection timeout'}};return{error:null,data:(window.actor==='peer'?[{employeeId:'peer-member',startsOn:'2026-11-02'}]:[{employeeId:'new',startsOn:'2026-11-06'},{employeeId:'old',startsOn:'2026-11-02'},...(window.newlyActivated?[{employeeId:'added',startsOn:'2026-11-09'}]:[])]).filter(row=>!window.partialEnrollment||row.employeeId!=='new')}}});
export const listCompanyAttendanceClocks=async()=>window.clockRows;
export const listMyAttendanceClocks=async()=>{window.ownClockReads=(window.ownClockReads||0)+1;return[]};export const clockOutToday=async()=>{throw Error('unexpected clock write')};export const undoClockOutToday=clockOutToday;
export const listLeaveRequests=async()=>[];export const listLateArrivalStatements=async()=>[];export const countLateStatementsAwaitingHr=async()=>0;
export const LateArrivalStatementDocument=()=>null;export const useRenderWatch=()=>{};
`, 'utf8')
const entry = path.join(dir, 'entry.tsx')
await writeFile(entry, `
import React,{useState}from'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';
import{useOpsDirectory}from'../../src/features/operations-support/ops-directory';import{AttendanceLatePanel}from'../../src/features/operations-support/AttendanceLatePanel';import{AttendanceCalendar}from'../../src/features/operations-support/AttendanceCalendar';import{monthlyAttendance,monthDates}from'../../src/features/operations-support/monthly-attendance';import{attendanceStartIndex}from'../../src/features/operations-support/attendance-start-settings';import{buildAttendanceRecords}from'../../src/features/operations-support/attendance-records';
import{useMyClockIn}from'../../src/features/home/use-my-clock-in';
const cache=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});
const schedule={start:'09:00',grace:5};const schedules={index:attendanceStartIndex([{id:'setting',month:'2026-11',departmentId:'office',employeeId:null,source:'department',start:'09:00',grace:5}]),loading:false,error:null,refresh:async()=>{}};
function Probe(){useOpsDirectory('head-office');return null}
function ClockProbe(){const clock=useMyClockIn();window.clockProbe=clock;return <span>승인 당일 출근 상태</span>}
function Screen(){const directory=useOpsDirectory('head-office');const[tick,setTick]=useState(0);const[showClock,setShowClock]=useState(false);window.openClockProbe=()=>setShowClock(true);window.refreshEnrollment=()=>cache.invalidateQueries({queryKey:['attendance-enrollments']});window.advanceDay=()=>{window.currentDay='2026-11-06';window.testNow='2026-11-06T09:30:00Z';if(!window.clockRows.some(row=>row.employeeId==='new'&&row.date==='2026-11-06'))window.clockRows.push({employeeId:'new',date:'2026-11-06',clockIn:'09:09'});setTick(tick+1);return cache.invalidateQueries({queryKey:['company-attendance-clocks']})};
window.activateMember=()=>{window.newlyActivated=true;window.people=[...window.people,{id:'added',displayName:'추가 승인 직원',departmentId:'office',hireDate:'2026-11-06'}];return cache.invalidateQueries({queryKey:['orgChartMembers']})};
const member=directory.members.find(p=>p.id==='new');const records=buildAttendanceRecords(monthDates('2026-11'),window.clockRows,[]);window.visibleMembers=directory.members;window.summary=member?monthlyAttendance(member.id,'2026-11',records,schedule,{},window.currentDay,member.attendanceTrackedFrom):null;
return <main style={{padding:24}}><Probe/>{showClock&&<ClockProbe/>}<AttendanceLatePanel key={tick} directory={directory} schedules={schedules}/>{member&&<section aria-label="신규 직원 달력"><AttendanceCalendar month="2026-11" memberId={member.id} records={records} schedule={schedule} overrides={{}} today={window.currentDay} trackingStart={member.attendanceTrackedFrom}/></section>}</main>}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={cache}><Screen/></QueryClientProvider>);
`, 'utf8')
const mocks = /(?:lib\/supabase\/(?:auth|client|profiles|attendance-clocks|leave-requests|late-arrival-statements)|features\/home\/LateArrivalClockIn|lib\/diagnostics)$/
await build({ entryPoints: [entry], outfile: path.join(dir, 'app.js'), bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic', tsconfig: path.join(root, 'tsconfig.app.json'), define: { 'import.meta.env': '{"DEV":true,"PROD":false}', 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'isolated-enrollment-api', setup(builder) { builder.onResolve({ filter: /.*/ }, args => {
  if (!args.importer.startsWith(path.join(root, 'src'))) return
  const target = (args.path.startsWith('@/') ? path.join(root, 'src', args.path.slice(2)) : path.resolve(args.resolveDir, args.path)).replaceAll('\\', '/').replace(/\.tsx?$/, '')
  if (mocks.test(target)) return { path: fixture }
}) } }] })
const script = await readFile(path.join(dir, 'app.js'))
const cssName = (await readdir(path.join(root, 'dist/assets'))).find(name => /^index-.*\.css$/.test(name))
const css = cssName ? await readFile(path.join(root, 'dist/assets', cssName)) : ''
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {}) })
try {
  const context = await browser.newContext({ viewport: { width: 1450, height: 1050 }, timezoneId: 'Asia/Seoul' })
  await context.addInitScript(() => { const Original = Date;window.testNow = '2026-11-05T09:30:00Z';window.Date = class extends Original { constructor(...args) { super(...(args.length ? args : [window.testNow])) }static now() { return new Original(window.testNow).getTime() } } })
  const errors = [], external = []
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin !== 'https://enrollment-preview.invalid') { external.push(url.origin);return route.abort() }
    if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: script })
    if (url.pathname === '/app.css') return route.fulfill({ contentType: 'text/css', body: css })
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>' })
  })
  const page = await context.newPage();page.on('pageerror', error => errors.push(error.message))
  await page.goto('https://enrollment-preview.invalid/operations-support')
  await page.locator('tbody').getByText('기존 직원', { exact: true }).waitFor()
  assert.equal(await page.locator('tbody').getByText('신규 직원', { exact: true }).count(), 0, 'pre-approval clocks and missing days are not lateness/absence')
  assert.equal(await page.evaluate(() => window.enrollmentReads), 1, 'shared readers deduplicate the enrollment request')
  assert.equal(await page.evaluate(() => window.visibleMembers.find(p => p.id === 'new').hireDate), '2026-11-03')
  assert.equal(await page.evaluate(() => window.visibleMembers.find(p => p.id === 'new').attendanceTrackedFrom), '2026-11-06')
  assert.equal(await page.evaluate(() => window.summary.exceeded), 0)
  assert.deepEqual(await page.evaluate(() => window.summary.missingDates), [])
  const calendar = page.getByRole('region', { name: '신규 직원 달력' })
  assert.equal(await calendar.getByText('집계 제외', { exact: true }).count(), 5)
  await page.screenshot({ path: path.join(dir, 'approval-day.png'), fullPage: true })
  await page.evaluate(() => { window.policyFailure = true;void window.refreshEnrollment() })
  await page.getByText('기록을 확인하지 못해 지각·결근을 집계하지 않습니다.', { exact: true }).waitFor()
  assert.equal(await page.locator('tbody').getByText('기존 직원', { exact: true }).count(), 0, 'read errors never fabricate attendance judgments')
  await page.evaluate(() => { window.policyFailure = false })
  await page.getByRole('button', { name: '다시 불러오기', exact: true }).click()
  await page.locator('tbody').getByText('기존 직원', { exact: true }).waitFor()
  const readsBeforePartial = await page.evaluate(() => window.enrollmentReads)
  await page.evaluate(() => { window.partialEnrollment = true;void window.refreshEnrollment() })
  await page.getByText('기록을 확인하지 못해 지각·결근을 집계하지 않습니다.', { exact: true }).waitFor()
  await page.getByLabel('지각·결근 검색', { exact: true }).fill('신규')
  await page.getByLabel('지각·결근 검색', { exact: true }).fill('')
  assert.equal((await page.evaluate(() => window.enrollmentReads)) - readsBeforePartial, 1, 'a missing row does not cause observers to repeat requests or create a render loop')
  await page.evaluate(() => { window.partialEnrollment = false })
  await page.getByRole('button', { name: '다시 불러오기', exact: true }).click()
  await page.locator('tbody').getByText('기존 직원', { exact: true }).waitFor()
  await page.evaluate(() => window.advanceDay())
  await page.locator('tbody').getByText('신규 직원', { exact: true }).waitFor()
  const newRow = page.locator('tbody tr').filter({ hasText: '신규 직원' })
  assert.equal(await newRow.count(), 1)
  assert.match(await newRow.innerText(), /11\.06/)
  assert.match(await newRow.innerText(), /지각/)
  assert.equal(await page.evaluate(() => window.summary.exceeded), 1, 'normal assessment resumes from enrollment')
  assert.equal(await page.evaluate(() => JSON.stringify(window.people) === window.originalMembers), true)
  const readsBeforeActivation = await page.evaluate(() => window.enrollmentReads)
  await page.evaluate(() => window.activateMember())
  await page.waitForFunction(() => window.visibleMembers.find(row => row.id === 'added')?.attendanceTrackedFrom === '2026-11-09')
  assert.equal((await page.evaluate(() => window.enrollmentReads)) - readsBeforeActivation, 1, 'an activation replaces stale roster metadata through one shared query')
  assert.equal(await page.locator('tbody').getByText('추가 승인 직원', { exact: true }).count(), 0)
  await page.evaluate(() => window.setAccount('peer'))
  await page.waitForFunction(() => window.visibleMembers.length === 1 && window.visibleMembers[0].id === 'peer-member')
  assert.equal(await page.getByRole('region', { name: '신규 직원 달력' }).count(), 0, 'account changes remove previous attendance data')
  await page.evaluate(() => { window.currentDay = '2026-11-05';window.testNow = '2026-11-05T09:30:00Z';window.setAccount('new');window.openClockProbe() })
  await page.waitForFunction(() => window.clockProbe?.exempt === true && window.clockProbe.loading === false)
  assert.equal(await page.evaluate(() => window.clockProbe.needsClockIn), false, 'approval day does not force a clock-in/late-arrival form')
  assert.equal(await page.evaluate(async () => { try { await window.clockProbe.clockIn();return false } catch { return true } }), true)
  assert.equal(await page.evaluate(() => window.clockWriteAttempts || 0), 0, 'no clock or late-reason record is created before enrollment')
  assert.equal(await page.evaluate(() => window.ownClockReads || 0), 0)
  await page.evaluate(() => window.advanceDay())
  await page.waitForFunction(() => window.clockProbe?.needsClockIn === true && window.clockProbe.loading === false)
  assert.equal(await page.evaluate(() => window.clockProbe.exempt), false, 'the recent approval account can clock in normally from its start date')
  assert.deepEqual(errors, []);assert.deepEqual(external, [])
  console.info('Attendance enrollment browser: real directory + late/absence/calendar/summary, no pre-approval penalties, normal later assessment, shared reads, read-failure retry, account isolation and unchanged inputs passed')
} finally { await browser.close() }
