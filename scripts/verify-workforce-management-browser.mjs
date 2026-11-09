import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const root = process.cwd(), dir = path.join(root, '.tmp/workforce-management-preview')
await mkdir(dir, { recursive: true })
const fixture = path.join(dir, 'fixture.tsx')
await writeFile(fixture, `
import {useSyncExternalStore} from 'react';
import {workforceMode,WORKFORCE_COMPANY_ID as company,LOGISTICS_DEPARTMENT_ID as logistics,CHINA_DEPARTMENT_ID as china,LOGISTICS_OPERATIONS_MANAGER_ID as manager} from '../../src/lib/company/workforce-management';
const id=n=>'60000000-0000-4000-8000-'+String(n).padStart(12,'0');
const person=(id,name,departmentId,permissionGrants=[])=>({id,displayName:name,name,companyId:company,status:'active',email:'fixture@example.invalid',departmentId,hireDate:'2020-01-01',position:'사원',jobGrade:'사원',capabilities:[],memberships:[],permissionGrants});
export const profiles={manager:person(manager,'김보영',logistics),warehouse:person(id(3),'물류직원',logistics),china:person(id(4),'협력사직원',china),hr:person(id(1),'인사담당',null,[{permission:'org.manage',scopeKind:'company',scopeId:company}]),normal:person(id(2),'본사직원',null),developer:person('d0000000-0000-4000-8000-000000000001','개발자',null)};
const members=Object.values(profiles);window.profileSnapshot=JSON.stringify(members);window.fixtureProfiles=members;
const listeners=new Set();window.account=new URL(location.href).searchParams.get('actor')||'manager';window.setAccount=next=>{window.account=next;listeners.forEach(fn=>fn())};
const subscribe=fn=>{listeners.add(fn);return()=>listeners.delete(fn)};
export function useAuth(){const role=useSyncExternalStore(subscribe,()=>window.account);const profile=profiles[role];return{profile,session:{user:{id:profile.id}}}}
window.policies=members.map(p=>({employeeId:p.id,mode:workforceMode(p),trackingStart:null,version:0}));window.policyWrites=0;window.opsQueries=0;window.opsWrites=0;window.records=[];window.failNextSave=false;
export const listWorkforceManagement=async()=>{if(window.failPolicyRead)throw new Error('분류 조회 연결 실패');return{ready:true,items:structuredClone(window.policies)}};
export const allDepartments=[{id:logistics,name:'물류팀'},{id:china,name:'중국팀'},{id:id(70),name:'빈 현장팀'}];
window.departmentPolicies=allDepartments.map(d=>({departmentId:d.id,mode:d.id===logistics?'local':d.id===china?'external':'head-office',trackingStart:null,contactIds:d.id===china?[profiles.normal.id]:[],version:0}));
export const listDepartmentWorkforceManagement=async()=>({ready:new URL(location.href).searchParams.get('missing')!=='1',items:structuredClone(window.departmentPolicies)});
export const saveDepartmentWorkforceManagement=async input=>{if(window.failNextPolicySave){window.failNextPolicySave=false;throw new Error('부서 설정 저장 실패. 다시 시도해 주세요.')};window.policyWrites++;const next={...input,version:input.version+1};window.departmentPolicies=window.departmentPolicies.map(row=>row.departmentId===input.departmentId?next:row);window.policies=window.policies.map(row=>members.find(p=>p.id===row.employeeId)?.departmentId===input.departmentId?{...row,mode:input.mode==='local'&&input.departmentId===logistics?'logistics':input.mode,trackingStart:input.trackingStart,version:next.version}:row);return next};
export const getLogisticsOperations=async()=>{window.opsQueries++;return{ready:true,employees:members.filter(p=>window.policies.find(row=>row.employeeId===p.id)?.mode==='logistics').map(p=>({id:p.id,name:p.name,hireDate:p.hireDate})),entries:structuredClone(window.records)}};
export const saveLogisticsOperation=async input=>{window.opsWrites++;if(window.failNextSave){window.failNextSave=false;throw new Error('연결이 끊겼습니다. 입력 내용은 유지됩니다.')};const old=window.records.find(row=>row.id===input.id);let next;if(input.action==='cancel')next={...old,cancelled_at:new Date().toISOString(),version:old.version+1};else next={id:input.id,employee_id:input.employeeId,employee_name:members.find(p=>p.id===input.employeeId).name,kind:input.kind,from_date:input.from,to_date:input.to,started_at:input.startedAt,ended_at:input.endedAt,break_minutes:input.breakMinutes,leave_kind:input.leaveKind,leave_days:input.leaveDays,note:input.note,version:(old?.version||0)+1,cancelled_at:null,updated_at:new Date().toISOString()};window.records=old?window.records.map(row=>row.id===old.id?next:row):[...window.records,next];return{id:next.id,version:next.version}};
const channel=()=>({on(){return this},subscribe(){return this}});export const getSupabase=()=>({channel,removeChannel:async()=> 'ok'});
export const allMembers=members;
`, 'utf8')
const entry = path.join(dir, 'entry.tsx')
await writeFile(entry, `
import React from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router-dom';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';
import{WorkforceManagementProvider,useHeadOfficeSelfService,useWorkforceManagement}from'../../src/lib/company/workforce-management-context';import{LogisticsOperationsPage}from'../../src/features/logistics/operations/LogisticsOperationsPage';import{WorkforceManagementPanel}from'../../src/features/org/WorkforceManagementPanel';import{companyNavGroupsForProfile}from'../../src/components/layout/company-workspace-nav';import{canEditOrgAssignment}from'../../src/lib/company/capabilities';import{useAuth,allMembers,allDepartments}from'./fixture';
const q=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false},mutations:{retry:false}}});
function Shell(){const{profile}=useAuth();const state=useWorkforceManagement();const allowed=useHeadOfficeSelfService();window.refreshPolicies=()=>state.refresh();window.selfServiceAllowed=allowed;window.scopeReadFailed=Boolean(state.error);const items=companyNavGroupsForProfile(profile).flatMap(group=>group.items).filter(item=>item.to==='/logistics/operations');return <main style={{padding:24}}><nav>{items.map(item=><a key={item.to} href={item.to}>{item.label}</a>)}</nav>{new URL(location.href).searchParams.get('page')==='policy'?<WorkforceManagementPanel members={allMembers} departments={allDepartments} canEdit={canEditOrgAssignment(profile)}/>:<LogisticsOperationsPage/>}</main>}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={q}><BrowserRouter><WorkforceManagementProvider><Shell/></WorkforceManagementProvider></BrowserRouter></QueryClientProvider>);
`, 'utf8')
const mocked = /(?:lib\/supabase\/(?:auth|client|workforce-management|logistics-operations))$/
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic', outfile: path.join(dir, 'app.js'), tsconfig: path.join(root, 'tsconfig.app.json'), define: { 'import.meta.env': '{"DEV":true,"PROD":false}', 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'isolated-workforce-api', setup(builder) { builder.onResolve({ filter: mocked }, () => ({ path: fixture })) } }] })
let css = ''
try { const name = (await readdir(path.join(root, 'dist/assets'))).find(name => /^index-.*\.css$/.test(name));if (name) css = await readFile(path.join(root, 'dist/assets', name), 'utf8') } catch (error) { if (error.code !== 'ENOENT') throw error }
const script = await readFile(path.join(dir, 'app.js'))
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {}) })
const errors = [], external = []
try {
  const context = await browser.newContext({ viewport: { width: 1500, height: 1050 }, timezoneId: 'Asia/Seoul' })
  await context.addInitScript(() => { const D = Date;window.Date = class extends D { constructor(...args) { super(...(args.length ? args : ['2026-11-05T03:00:00Z'])) }static now() { return new D('2026-11-05T03:00:00Z').getTime() } } })
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin !== 'https://workforce-preview.invalid') { external.push(url.origin);return route.abort() }
    if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: script })
    if (url.pathname === '/app.css') return route.fulfill({ contentType: 'text/css', body: css })
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>' })
  })
  const open = async (actor, pageType = 'logistics') => { const page = await context.newPage();page.on('pageerror', error => errors.push(error.message));await page.goto(`https://workforce-preview.invalid/?actor=${actor}&page=${pageType}`);return page }
  const page = await open('manager')
  await page.getByRole('button', { name: '근무·휴가 등록', exact: true }).waitFor()
  await page.getByRole('button', { name: '근무·휴가 등록', exact: true }).click()
  await page.getByLabel('물류 기록 직원', { exact: true }).selectOption('60000000-0000-4000-8000-000000000003')
  await page.getByLabel('물류 근무 시작', { exact: true }).fill('2026-11-07T09:00')
  await page.getByLabel('물류 근무 종료', { exact: true }).fill('2026-11-08T03:00')
  await page.getByLabel('물류 휴게시간', { exact: true }).fill('90')
  await page.getByRole('button', { name: '기록 저장', exact: true }).click()
  await page.getByText('물류 기록을 저장했습니다.', { exact: true }).waitFor()
  assert.match(await page.locator('table tbody').innerText(), /16시간 30분/)
  assert.equal(await page.evaluate(() => window.records.length), 1)
  await page.getByRole('button', { name: '근무·휴가 등록', exact: true }).click()
  await page.getByLabel('물류 기록 직원', { exact: true }).selectOption('60000000-0000-4000-8000-000000000003')
  await page.getByLabel('물류 기록 종류', { exact: true }).selectOption('leave')
  await page.getByLabel('물류 휴가 시작일', { exact: true }).fill('2026-11-09')
  await page.getByLabel('물류 휴가 종료일', { exact: true }).fill('2026-11-09')
  await page.getByLabel('물류 휴가 종류', { exact: true }).selectOption('half')
  await page.getByLabel('물류 휴가 일수', { exact: true }).fill('0.5')
  await page.getByRole('button', { name: '기록 저장', exact: true }).click()
  await page.getByText('물류 기록을 저장했습니다.', { exact: true }).waitFor()
  assert.equal(await page.locator('table tbody tr').count(), 2)
  await page.getByRole('button', { name: '수정', exact: true }).first().click()
  await page.getByLabel('물류 기록 메모', { exact: true }).fill('정정 메모')
  await page.getByRole('button', { name: '기록 저장', exact: true }).click()
  await page.getByText('정정 메모', { exact: true }).waitFor()
  await page.screenshot({ path: path.join(dir, 'logistics.png'), fullPage: true })
  await page.getByRole('button', { name: '등록 취소', exact: true }).first().click()
  await page.getByRole('button', { name: '취소 확정', exact: true }).click()
  await page.getByText('기록을 취소했습니다. 변경 이력은 보관됩니다.', { exact: true }).waitFor()
  assert.equal(await page.locator('table tbody tr').count(), 1)
  assert.equal(await page.evaluate(() => window.records.length), 2)
  await page.getByRole('button', { name: '취소 기록도 보기', exact: true }).click()
  assert.equal(await page.locator('table tbody tr').count(), 2)
  await page.getByRole('button', { name: '근무·휴가 등록', exact: true }).click()
  await page.getByLabel('물류 기록 직원', { exact: true }).selectOption('60000000-0000-4000-8000-000000000003')
  await page.getByLabel('물류 근무 시작', { exact: true }).fill('2026-11-10T09:00')
  await page.getByLabel('물류 근무 종료', { exact: true }).fill('2026-11-10T18:00')
  await page.getByLabel('물류 기록 메모', { exact: true }).fill('실패해도 보존')
  await page.evaluate(() => { window.failNextSave = true })
  await page.getByRole('button', { name: '기록 저장', exact: true }).click()
  await page.getByText('연결이 끊겼습니다. 입력 내용은 유지됩니다.', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('물류 기록 메모', { exact: true }).inputValue(), '실패해도 보존')
  assert.equal(await page.evaluate(() => window.records.length), 2)
  await page.getByRole('button', { name: '기록 저장', exact: true }).click()
  await page.getByText('물류 기록을 저장했습니다.', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.records.length), 3)
  await page.evaluate(() => window.setAccount('warehouse'))
  await page.getByText('물류 운영관리 담당자 전용 화면입니다.', { exact: true }).waitFor()
  assert.equal(await page.locator('table').count(), 0)
  assert.equal(await page.getByRole('link', { name: '물류 운영관리', exact: true }).count(), 0)
  for (const actor of ['warehouse', 'china', 'hr', 'normal', 'developer']) {
    const denied = await open(actor)
    await denied.getByText('물류 운영관리 담당자 전용 화면입니다.', { exact: true }).waitFor()
    assert.equal(await denied.getByRole('link', { name: '물류 운영관리', exact: true }).count(), 0)
    assert.equal(await denied.evaluate(() => window.opsQueries), 0)
    await denied.close()
  }
  const policy = await open('hr', 'policy')
  const row = policy.locator('tbody tr').filter({ has: policy.getByLabel('중국팀 관리 방식', { exact: true }) })
  const contacts = row.getByRole('group', { name: '중국팀 소통 담당', exact: true })
  await contacts.getByText('본사 연락 창구입니다. 소통 담당자를 포함한 소속 직원 모두 본사 근태·연차 관리 대상에서 제외됩니다.', { exact: true }).waitFor()
  await contacts.getByRole('button', { name: '담당자 추가' }).waitFor()
  await policy.getByText(/소통 담당 0명/).waitFor()
  await contacts.getByRole('button', { name: '담당자 추가' }).click()
  const contactSearch = contacts.getByLabel('중국팀 소통 담당 검색')
  await contactSearch.fill('찾을 수 없는 이름')
  await contacts.getByText('검색 결과가 없습니다.', { exact: true }).waitFor()
  await contactSearch.fill('협력사')
  await contacts.getByRole('button', { name: '협력사직원 사원' }).click()
  await contacts.getByText('1 / 3명', { exact: true }).waitFor()
  assert.equal(await row.getByLabel('중국팀 본사 근태 시작일').count(), 0)
  assert.equal(await policy.evaluate(() => window.policyWrites), 0)
  await contacts.getByRole('button', { name: '협력사직원 소통 담당 해제' }).click()
  await contacts.getByText('0 / 3명', { exact: true }).waitFor()
  await row.getByLabel('중국팀 관리 방식', { exact: true }).selectOption('head-office')
  await row.getByLabel('중국팀 본사 근태 시작일', { exact: true }).fill('2026-11-06')
  await policy.evaluate(()=>window.failNextPolicySave=true)
  await row.getByRole('button', { name: '저장', exact: true }).click()
  await row.getByRole('alert').waitFor()
  assert.equal(await row.getByLabel('중국팀 관리 방식', {exact:true}).inputValue(),'head-office','save failure retains selection')
  await row.getByRole('button', { name: '저장', exact: true }).click()
  await policy.waitForFunction(() => window.policyWrites === 1 && window.policies.find(p => p.employeeId.endsWith('000000000004')).version === 1)
  await row.getByText('본사 관리', { exact: true }).first().waitFor()
  assert.equal(await row.getByLabel('중국팀 본사 근태 시작일', { exact: true }).inputValue(), '2026-11-06')
  assert.equal(await policy.evaluate(() => JSON.stringify(window.fixtureProfiles) === window.profileSnapshot), true)
  await policy.screenshot({ path: path.join(dir, 'workforce-policy.png'), fullPage: true })
  await policy.setViewportSize({ width: 390, height: 844 })
  assert.equal(await policy.evaluate(() => document.documentElement.scrollWidth), 390)
  assert.equal(await policy.locator('tbody tr').count(),3,'one row per department including empty department')
  await policy.getByLabel('관리 대상 부서 검색').fill('빈 현장')
  assert.equal(await policy.locator('tbody tr').count(),1)
  await policy.getByText('소속 직원 0명 · 신규·이동 직원 자동 적용',{exact:true}).waitFor()
  await policy.getByLabel('관리 대상 부서 검색').fill('')
  const missing = await context.newPage()
  missing.on('pageerror', error => errors.push(error.message))
  await missing.goto('https://workforce-preview.invalid/?actor=hr&page=policy&missing=1')
  await missing.getByText('부서별 저장 기능은 DB 적용 대기입니다. 기본 구분을 표시하며 아직 저장할 수 없습니다.',{exact:true}).waitFor()
  assert.equal(await missing.getByLabel('물류팀 관리 방식',{exact:true}).isDisabled(),true,'missing API cannot pretend saved')
  await missing.close()
  const scope = await open('normal', 'policy')
  await scope.getByLabel('물류팀 관리 방식',{exact:true}).waitFor()
  assert.equal(await scope.getByLabel('물류팀 관리 방식',{exact:true}).isDisabled(),true,'ordinary employee cannot change policy')
  await scope.waitForFunction(() => window.selfServiceAllowed === true)
  await scope.evaluate(() => { window.failPolicyRead = true;void window.refreshPolicies() })
  await scope.waitForFunction(() => window.scopeReadFailed === true)
  assert.equal(await scope.evaluate(() => window.selfServiceAllowed), false, 'failed scope reads must not enable HQ attendance')
  await scope.evaluate(() => { window.failPolicyRead = false })
  await scope.getByRole('button', { name: '다시 불러오기', exact: true }).click()
  await scope.waitForFunction(() => window.selfServiceAllowed === true)
  await scope.evaluate(() => window.setAccount('china'))
  await scope.waitForFunction(() => window.selfServiceAllowed === false)
  await scope.close()
  assert.deepEqual(errors, []);assert.deepEqual(external, [])
  console.info('Workforce browser: manager-only navigation/direct URL/account switch, work/leave create/edit/cancel, overnight/breaks, failed-save preservation/retry, scope settings and original profiles preserved')
} finally { await browser.close() }
