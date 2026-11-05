import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

// Real My home / My Schedule / shared hooks. Only server responses and unrelated
// screens are fixtures; no real account, attendance record or external API is used.
const root = process.cwd(), dir = path.join(root, '.tmp/hidden-schedule-browser')
await fs.mkdir(dir, { recursive: true })
const fixture = path.join(dir, 'fixture.tsx'), entry = path.join(dir, 'entry.tsx')
const mocked = [
  'lib/supabase/auth', 'lib/supabase/client', 'lib/supabase/profiles',
  'lib/supabase/attendance-clocks', 'lib/supabase/attendance-exemptions', 'lib/supabase/access-ip',
  'lib/supabase/attendance-entry', 'lib/supabase/offsite-attendance', 'lib/supabase/offsite-groups',
  'lib/supabase/leave-requests', 'lib/supabase/department-approvers', 'lib/supabase/company-notices',
  'lib/supabase/personal-schedule-todos', 'lib/supabase/leave-advances', 'lib/supabase/meetings', 'lib/supabase/department-schedule',
  'lib/supabase/impersonation', 'lib/diagnostics', 'lib/company/permissions', 'lib/company/capabilities',
  'components/layout/release-access-context', 'components/layout/PageHeader',
  'features/home/HomeAttendanceSummary', 'features/home/LateArrivalClockIn', 'features/home/LateStatementReview',
  'features/home/attendance-entry-context', 'features/home/OffsiteStatus',
  'features/operations-support/LeaveApprovalPanel', 'features/work-requests/WorkRequestHubPage',
  'features/meetings/CompanyMeetingsPage', 'features/settings/MyHomeNotificationList',
  'features/settings/HomeNoticeBoard', 'features/settings/MyAttendanceStartPanel',
  'features/settings/OvertimePanel', 'features/settings/RequiredInformationButton',
  'features/settings/OffsiteGroupFields', 'features/settings/OffsiteSettlementResult',
  'features/settings/OffsiteWorkdayStartField', 'features/settings/use-my-home-notifications',
  'features/settings/MyLeaveAdvanceSummary', 'lib/supabase/holiday-work',
]
await fs.writeFile(fixture, `
import React, {createContext,useContext,useState} from 'react';
import {useMyClockIn} from '../../src/features/home/use-my-clock-in';
import {useLeaveRequests} from '../../src/features/operations-support/use-leave-requests';
import {useDepartmentApprovers} from '../../src/features/operations-support/use-department-approvers';
import {useOpsDirectory} from '../../src/features/operations-support/ops-directory';
import {useLeaveAdvances} from '../../src/features/operations-support/use-leave-advances';
const EMPTY=[];const Auth=createContext(null);window.__counts={};window.__failMonth=false;window.__failMembers=false;window.__revision=0;window.__writes=[];window.__holdDirectory=false;window.__heldDirectory=[];
function hit(name){window.__counts[name]=(window.__counts[name]||0)+1}
const employee=id=>({id,companyId:'company',departmentId:'planning',departmentName:'기획팀',displayName:id==='employee-a'?'일반 직원 A':'일반 직원 B',status:'active',capabilities:[]});
export function FixtureAuth({children}){const [profile,setProfile]=useState(employee('employee-a'));const[sessionId,setSessionId]=useState('employee-a');window.__employeeId=profile.id;window.__companyId=profile.companyId;window.__switchEmployee=id=>{setProfile(employee(id));setSessionId(id)};window.__switchCompany=id=>setProfile(p=>({...p,companyId:id}));window.__setSessionOnly=setSessionId;return <Auth.Provider value={{profile,session:{user:{id:sessionId}},email:'fixture@example.invalid'}}>{children}</Auth.Provider>}
export const useAuth=()=>useContext(Auth);
export function HomeAttendanceSummary(){const clock=useMyClockIn();useLeaveRequests();return <output data-testid="global-clock">{clock.loading?'조회 중':clock.needsClockOut?'퇴근 가능':clock.needsClockIn?'출근 필요':'기록 완료'}</output>}
export function ReleaseAccessProvider({children}){return children}
export function useReleaseAccess(){const {profile}=useAuth();const approvals=useDepartmentApprovers();return{profile,scope:{unrestricted:false},approvals,departments:EMPTY,approver:false}}
export const canAccessOperationsSupport=()=>false,capabilityLabel=value=>value,hasPermission=()=>false;
export const useRenderWatch=()=>{},useAttendanceEntry=()=>null,readImpersonationState=()=>null;
export const PageHeader=({title})=><h1>{title}</h1>;
export const LateArrivalHeaderButton=()=>null,LateStatementApprovalList=()=>null,LateStatementNoticeDialog=()=>null;
export const LeaveApprovalPanel=()=>null,WorkRequestHubPage=()=>null,HomeNoticeBoard=()=>null,MyAttendanceStartPanel=()=>null,OvertimePanel=()=>null,RequiredInformationButton=()=>null;
export const CompanyMeetingsPage=()=> <p>회의 화면</p>;
export const MyHomeNotificationBadge=()=>null,MyHomeNotificationList=()=>null,MyHomeWorkNoticeDetail=()=>null;
export function OffsiteGroupHistory(){const directory=useOpsDirectory();return <output data-testid="directory">{JSON.stringify({members:directory.members.map(m=>m.id),departments:directory.departments.map(d=>d.id)})}</output>}
export const OffsiteStartEditor=()=>null,OffsiteConnectionNotice=()=>null,OffsiteSettlementResult=()=>null,OffsiteWorkdayStartField=()=>null;
export const MyLeaveAdvanceSummary=()=>{useLeaveAdvances();return null};
export const useReadMyHomeNotification=()=>({error:null,retry:()=>{}});
export const useMyHomeNotifications=()=>({work:EMPTY,items:EMPTY,ready:true,error:null});
export const listHolidayWork=async()=>{hit('holiday-work');return{ready:true,rows:EMPTY,isOperations:false,policy:null}};
export const changeHolidayWork=async()=>{throw Error('Unexpected holiday write')};
export const getMyAttendanceExemption=async()=>{hit('exemption');return false};
export const listMyAttendanceClocks=async(owner,month)=>{hit(month?'month-clocks':'global-clocks');if(month&&window.__failMonth)throw Error('검증용 월별 조회 실패');return [{date:'2026-11-04',clockIn:'09:00',clockOutAt:null}]};
export const clockOutToday=async()=>{window.__writes.push('clock-out')},undoClockOutToday=async()=>{window.__writes.push('undo-clock-out')},recordAccessIp=async()=>{};
export const getSupabase=()=>({rpc:async()=>{throw Error('Unexpected RPC')}});
export const offsiteAction=async()=>{hit('overnight-offsite');return null};
export const getMyWorkdayBasis=async()=>({configured:true,start:'09:00'});
async function directoryIdentity(key){hit(key);const scope=window.__employeeId+':'+window.__companyId;if(window.__holdDirectory)await new Promise(resolve=>window.__heldDirectory.push(resolve));return scope}
export const listDepartments=async()=>{const scope=await directoryIdentity('departments');return[{id:'department:'+scope,name:'기획팀'}]};
export const listOrgChartMembers=async()=>{const scope=await directoryIdentity('members');if(window.__failMembers)throw Error('검증용 명부 조회 실패');return[{id:'member:'+scope,displayName:'범위 확인 직원',departmentId:'planning'}]};
export const listDepartmentApprovers=async()=>{hit('approvers');return EMPTY},saveDepartmentApprovers=async()=>{};
export const listCompanyNotices=async()=>{hit('notices');return EMPTY};
export const listOffsiteGroups=async()=>{hit('offsite-groups');return EMPTY},registerOffsiteGroup=async()=>{throw Error('Unexpected group write')};
const leave={id:'leave-a',employeeId:'employee-a',kind:'annual',from:'2026-11-05',to:'2026-11-05',start:'09:00',end:'18:00',place:'',note:'검증용 연차',status:'approved',createdAt:'2026-11-04',decidedBy:null};
export const listLeaveRequests=async(owner)=>{hit('leave');return owner==='employee-a'?[{...leave}]:EMPTY};
export const submitLeaveRequest=async()=>{throw Error('Unexpected create')};
export const transitionLeaveRequest=async(id,status)=>{window.__writes.push({id,status});leave.status=status;return{...leave}};
export const uploadLeaveFile=async()=>{throw Error('Unexpected upload')};
export const listLeaveAdvances=async()=>{hit('advances');return{ready:true,employees:[],events:[]}};
export const listScheduleTodos=async(owner)=>{hit('todos');return owner==='employee-a'?[{id:'todo-a',date:'2026-11-04',title:'서버 일정 '+window.__revision,done:false}]:[]};
export const saveScheduleTodo=async()=>{},deleteScheduleTodo=async()=>{};
export const listCompanyMeetings=async()=>{hit('meetings');return []};
export const listDepartmentAbsences=async()=>{hit('department-schedule');return{ready:true,rows:EMPTY}};
`)
await fs.writeFile(entry, `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{BrowserRouter,useNavigate}from'react-router-dom';
import{ProfileSettingsPage}from'../../src/features/settings/ProfileSettingsPage';
import{MyAttendancePanel}from'../../src/features/settings/MyAttendancePanel';
import{WorkspaceTabActivityContext}from'../../src/components/layout/workspace-tab-activity';
import{FixtureAuth}from'./fixture';
const cache=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});window.__cache=cache;
function App(){const[active,setActive]=useState(true);const navigate=useNavigate();window.__workspace=setActive;window.__navigate=navigate;return <WorkspaceTabActivityContext.Provider value={active}><ProfileSettingsPage/>{new URLSearchParams(location.search).has('unscopedBaseline')&&<div hidden><MyAttendancePanel/></div>}</WorkspaceTabActivityContext.Provider>}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={cache}><FixtureAuth><BrowserRouter><App/></BrowserRouter></FixtureAuth></QueryClientProvider>);
`)
const aliases = new Map(mocked.map(name => [path.join(root, 'src', name).replaceAll('\\', '/'), fixture]))
await build({ entryPoints: [entry], bundle: true, format: 'esm', outfile: path.join(dir, 'bundle.js'), jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"test"', 'import.meta.env.DEV': 'true' }, loader: { '.css': 'empty' },
  plugins: [{name:'fixture-only',setup(builder){builder.onResolve({filter:/.*/},args=>{
    if(args.path.startsWith('@/')){const target=path.join(root,'src',args.path.slice(2)).replaceAll('\\','/');return{path:aliases.get(target)||target+(target.endsWith('.css')?'':fsSyncExtension(target))}}
    if(!args.path.startsWith('.'))return;
    const target=path.resolve(args.resolveDir,args.path).replaceAll('\\','/').replace(/\.tsx?$/,'');
    if(aliases.has(target))return{path:fixture};
  })}}] })
function fsSyncExtension(target){
  // esbuild normally resolves extensions; aliases use exact absolute file names.
  for(const ext of ['.ts','.tsx','/index.ts','/index.tsx'])if(existsSync(target+ext))return ext
  return ''
}
const html='<!doctype html><html lang="ko"><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>'
const server=http.createServer(async(req,res)=>{if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(await fs.readFile(path.join(dir,'bundle.js')))}else{res.setHeader('Content-Type','text/html');res.end(html)}})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const origin=`http://127.0.0.1:${server.address().port}`
let browser
try{
  browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
  const context=await browser.newContext({viewport:{width:1400,height:1000},timezoneId:'Asia/Seoul'}),errors=[],external=[]
  await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():(external.push(route.request().url()),route.abort()))
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message))
  await page.clock.install({time:new Date('2026-11-04T01:00:00Z')})
  await page.goto(origin+'/settings/profile?part=meetings')
  await page.getByTestId('global-clock').getByText('퇴근 가능').waitFor()
  const counts=()=>page.evaluate(()=>({...window.__counts}))
  const initial=await counts()
  assert.deepEqual(Object.keys(initial).sort(),['approvers','exemption','global-clocks','leave'])
  assert.equal(await page.getByRole('tab',{name:'내 정보',exact:true}).count(),0,'normal employee, not privileged preview')
  await page.clock.runFor(31_000)
  const hidden=await counts();assert.ok(hidden['global-clocks']>initial['global-clocks'],'global attendance stays live')
  assert.equal(hidden['month-clocks'],undefined);assert.equal(hidden.advances,undefined)
  await page.getByRole('tab',{name:'My Schedule',exact:true}).click()
  await page.getByTitle(/서버 일정 0$/).waitFor()
  const visible=await counts()
  for(const key of ['month-clocks','members','departments','notices','offsite-groups','advances','todos','meetings'])assert.ok(visible[key]>0,key+' loads when opened')
  await page.getByLabel('신청 검색',{exact:true}).fill('작성 중 검색')
  await page.getByRole('button',{name:'+추가',exact:true}).click()
  await page.getByRole('menuitem',{name:'Todo',exact:true}).click()
  await page.getByLabel('Todo 내용',{exact:true}).fill('저장하지 않은 입력 유지')
  // Navigate programmatically like a workspace switch while a native dialog is open.
  await page.evaluate(()=>window.__navigate('/settings/profile?part=meetings'))
  await page.getByRole('dialog',{name:'Todo',exact:true}).waitFor({state:'hidden'})
  const beforeHiddenPoll=await counts();await page.clock.runFor(31_000)
  await page.evaluate(async()=>{window.__revision=1;await window.__cache.invalidateQueries({queryKey:['personal-schedule-todos']})})
  const afterHiddenPoll=await counts()
  for(const key of ['month-clocks','members','advances','todos','meetings','offsite-groups','holiday-work'])assert.equal(afterHiddenPoll[key],beforeHiddenPoll[key],key+' stays paused')
  assert.ok(afterHiddenPoll['global-clocks']>beforeHiddenPoll['global-clocks'])
  await page.getByRole('tab',{name:'My Schedule',exact:true}).click()
  await page.getByRole('dialog',{name:'Todo',exact:true}).waitFor()
  assert.equal(await page.getByLabel('Todo 내용',{exact:true}).inputValue(),'저장하지 않은 입력 유지')
  await page.getByRole('dialog',{name:'Todo',exact:true}).getByRole('button',{name:'닫기',exact:true}).click()
  assert.equal(await page.getByLabel('신청 검색',{exact:true}).inputValue(),'작성 중 검색')
  await page.getByLabel('신청 검색',{exact:true}).fill('')
  await page.getByTitle(/서버 일정 1$/).waitFor()
  // Own leave cancellation still uses the real mutation hook and invalidates views.
  await page.getByTitle('월차/연차 · 종일',{exact:true}).click()
  await page.getByRole('dialog').getByRole('button',{name:'취소',exact:true}).click()
  await page.getByRole('dialog').waitFor({state:'hidden'})
  assert.deepEqual(await page.evaluate(()=>window.__writes),[{id:'leave-a',status:'cancelled'}])
  await page.getByLabel('신청 검색',{exact:true}).fill('이전 직원 입력')
  assert.match(await page.getByTestId('directory').innerText(),/employee-a:company/)
  const beforeAccountSwitch=await counts()
  // Keep the entire cache: login changes within the same app must not show a
  // previous employee's fresh directory while the new response is pending.
  await page.evaluate(()=>{window.__holdDirectory=true;window.__switchEmployee('employee-b')})
  await page.waitForFunction(()=>window.__heldDirectory.length===2)
  assert.deepEqual(JSON.parse(await page.getByTestId('directory').innerText()),{members:[],departments:[]})
  assert.equal((await counts()).members,beforeAccountSwitch.members+1)
  assert.equal((await counts()).departments,beforeAccountSwitch.departments+1)
  await page.evaluate(()=>{window.__holdDirectory=false;window.__heldDirectory.splice(0).forEach(resolve=>resolve())})
  await page.waitForFunction(()=>window.__cache.isFetching()===0)
  await page.getByTestId('directory').filter({hasText:'employee-b:company'}).waitFor()
  assert.match(await page.getByTestId('directory').innerText(),/employee-b:company/)
  assert.doesNotMatch(await page.getByTestId('directory').innerText(),/employee-a/)
  assert.ok(await page.evaluate(()=>window.__cache.getQueryData(['orgChartMembers','employee-a','company'])),'old cache was not globally cleared')
  assert.equal(await page.getByLabel('신청 검색',{exact:true}).inputValue(),'')
  assert.equal(await page.getByTitle(/서버 일정 1$/).count(),0)
  const beforeMismatch=await counts()
  await page.evaluate(()=>window.__setSessionOnly('session-loading'))
  await page.waitForFunction(()=>document.querySelector('[data-testid="directory"]').textContent==='{"members":[],"departments":[]}')
  assert.equal((await counts()).members,beforeMismatch.members)
  assert.equal((await counts()).departments,beforeMismatch.departments)
  await page.evaluate(()=>window.__setSessionOnly('employee-b'))
  await page.getByTestId('directory').filter({hasText:'employee-b:company'}).waitFor()
  await page.evaluate(()=>{window.__holdDirectory=true;window.__switchCompany('company-b')})
  await page.waitForFunction(()=>window.__heldDirectory.length===2)
  assert.deepEqual(JSON.parse(await page.getByTestId('directory').innerText()),{members:[],departments:[]})
  await page.evaluate(()=>{window.__holdDirectory=false;window.__heldDirectory.splice(0).forEach(resolve=>resolve())})
  await page.getByTestId('directory').filter({hasText:'employee-b:company-b'}).waitFor()
  await page.evaluate(()=>window.__switchCompany('company'))
  await page.waitForFunction(()=>window.__cache.isFetching()===0)
  // Parent workspace inactivity also disables the nested panel; errors recover on re-entry.
  await page.evaluate(()=>window.__workspace(false));const background=await counts();await page.clock.runFor(31_000)
  for(const key of ['month-clocks','members','advances','todos','meetings','offsite-groups','holiday-work'])assert.equal((await counts())[key],background[key])
  await page.evaluate(()=>{window.__failMonth=true;window.__failMembers=true;window.__workspace(true)})
  await page.getByRole('alert').filter({hasText:'2026년 11월 출퇴근 기록'}).waitFor()
  await page.waitForFunction(()=>window.__cache.getQueryState(['orgChartMembers','employee-b','company'])?.status==='error')
  await page.evaluate(()=>window.__workspace(false));await page.evaluate(()=>{window.__failMonth=false;window.__failMembers=false;window.__workspace(true)})
  await page.getByRole('alert').filter({hasText:'2026년 11월 출퇴근 기록'}).waitFor({state:'hidden'})
  await page.waitForFunction(()=>window.__cache.getQueryState(['orgChartMembers','employee-b','company'])?.status==='success')
  assert.deepEqual(errors,[]);assert.deepEqual(external,[])
  // Comparator mounts the same panel hidden under the old outer activity scope.
  // It measures API work caused by the missing inner scope, not server latency.
  const baseline=await context.newPage();await baseline.clock.install({time:new Date('2026-11-04T01:00:00Z')})
  await baseline.goto(origin+'/settings/profile?part=meetings&unscopedBaseline')
  await baseline.waitForFunction(()=>window.__counts?.['month-clocks']&&window.__cache.isFetching()===0)
  const baselineReads=await baseline.evaluate(()=>({...window.__counts}));await baseline.close()
  // The new department schedule is also suppressed by the inner activity scope.
  assert.equal(Object.keys(baselineReads).length-Object.keys(initial).length,10)
  const report={normalEmployee:true,initialHiddenReads:initial,unscopedBaselineReads:baselineReads,initialCallsSaved:10,firstVisibleReads:visible,checks:['hidden first-load/poll suppressed','department schedule hidden read suppressed','global attendance retained','form preserved','invalidation refetch on return','own cancellation','account reset','account/company directory cache isolation without cache.clear','session/profile mismatch blocked','workspace inactivity','failed read recovery'],externalRequests:external.length}
  await fs.writeFile(path.join(dir,'result.json'),JSON.stringify(report,null,2))
  console.log('hidden-schedule-browser: PASS '+JSON.stringify(report))
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}
