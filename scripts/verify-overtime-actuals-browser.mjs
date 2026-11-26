import assert from 'node:assert/strict'
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises'
import path from 'node:path'
import {createServer} from 'node:http'
import {build} from 'esbuild'
import {chromium} from 'playwright-core'
const root=process.cwd(),dir=path.join(root,'.tmp/overtime-actuals-browser')
await mkdir(dir,{recursive:true})
await writeFile(path.join(dir,'data.tsx'),`import React,{createContext,useContext,useState} from 'react';
export const request={id:'approved',employeeId:'a',employeeName:'실제 입력 직원',departmentId:'d',departmentName:'디자인',kind:'overtime',status:'approved',from:'2026-11-02',to:'2026-11-02',start:'18:00',end:'22:00',note:'상품 촬영',place:'',createdAt:'2026-11-01'};
export const requests=[request,{...request,id:'missing',employeeId:'b',employeeName:'미입력 직원'},{...request,id:'pending',employeeId:'c',employeeName:'미승인 직원',status:'pending'},{...request,id:'offsite',employeeId:'d',employeeName:'외근 직원',kind:'offsite',start:'10:00',end:'21:00',place:'거래처',note:'매장 방문'},{...request,id:'offsite-ten',employeeId:'ten',employeeName:'10시 기준 직원',kind:'offsite',end:'21:30'},{...request,id:'offsite-unset',employeeId:'unset',employeeName:'미설정 외근 직원',departmentId:null,kind:'offsite'},{...request,id:'offsite-night',employeeId:'night',employeeName:'새벽 외근 직원',kind:'offsite',end:'03:00',endNextDay:true},{...request,id:'offsite-cancelled',employeeId:'cancelled',employeeName:'취소 외근 직원',kind:'offsite',status:'cancelled'}];
requests.push({...request,id:'offsite-shifted',employeeId:'shifted',employeeName:'당일 변경 외근 직원',kind:'offsite',start:'16:00',end:'20:00',offsiteWorkStart:'10:00'});
export const schedules={index:new Map([['2026-11:department:d',{start:'09:00'}],['2026-11:employee:ten',{start:'10:00'}]]),settings:[],loading:false,error:null,refresh(){}};
export const directory={members:[{id:'late',displayName:'미신청 직원',departmentId:'d',hireDate:'2025-01-01'}],departments:[{id:'d',name:'디자인'}],departmentName:()=> '디자인',loading:false,error:null,refetch(){}};
const C=createContext(null);export function Provider({children}){const [rows,setRows]=useState([]);const [fail,setFail]=useState(false);return <C.Provider value={{rows,setRows,fail}}><button onClick={()=>setRows([{requestId:'approved',startAt:'2026-11-02T18:00:00+09:00',endAt:'2026-11-02T23:00:00+09:00',checkoutAt:'2026-11-02T23:00:00+09:00',clockLinked:true,breakMinutes:0,revision:0,savedAt:'2026-11-03'}])}>테스트 퇴근</button><button onClick={()=>setRows([{requestId:'approved',startAt:'2026-11-02T18:00:00+09:00',endAt:'2026-11-02T19:00:00+09:00',clockLinked:true,breakMinutes:0,revision:0,savedAt:'2026-11-03'}])}>테스트 짧은 퇴근</button><button onClick={()=>setRows([])}>테스트 퇴근 무르기</button><button onClick={()=>setFail(!fail)}>저장 오류 전환</button>{children}</C.Provider>};export const useData=()=>useContext(C);
`)
await writeFile(path.join(dir,'stubs.tsx'),`import {useData,requests,directory} from './data';
export const useAuth=()=>({session:{user:{id:'a'}},profile:{id:'a',status:'active',companyId:'company',departmentId:'d',permissionGrants:[{permission:'attendance.manage',scopeKind:'company',scopeId:'company'},...(window.__rosterReadOnly?[]:[{permission:'org.manage',scopeKind:'company',scopeId:'company'}])]}});
export const useMonthlyWorkRequests=()=>({rows:requests,isPending:false,isError:false,isSuccess:true,refetch(){}});
export const listCompanyAttendanceSpans=async()=>window.__unrequested?[{employeeId:'late',date:'2026-11-02',clockIn:'09:00',clockOutAt:'2026-11-02T20:25:00+09:00',clockOutSource:'manual'}]:[];
export const useLeaveRequests=()=>({requests,userId:'a',busy:false,loading:false,error:null,refresh(){},create:{},transition:{}});
export const useOpsDirectory=()=>directory;export const useDepartmentApprovers=()=>({loading:false,error:null,settings:[]});export const useMyClockIn=()=>({rows:[]});export const useMyHomeNotifications=()=>({items:[]});
export const listOffsiteSettlements=async()=>({ready:true,rows:[]});export const offsiteSettlementPreview=async()=>({dates:[],settlement:null});export const saveOffsiteSettlement=async()=>{};export const useWorkspaceTabActivity=()=>true;
export const loadCompanyLunch=async()=>({start:'12:00',end:'13:00',saved:true});
export function useOvertimeActuals(){const {rows,setRows,fail}=useData();return {rows,ready:true,isPending:false,isError:false,refetch(){},save:{async mutateAsync(v){if(fail)throw Error('연결 오류: 입력을 유지합니다.');setRows(rows.filter(r=>r.requestId!==v.requestId).concat({...v,revision:v.revision+1,savedAt:'2026-11-03'}))}}}}
export const useHolidayOvertimeCredits=(month)=>({rows:window.__holidayCredits&&month==='2026-11'?[{id:'holiday-credit',employeeId:'a',employeeName:'실제 입력 직원',departmentId:'d',departmentName:'디자인',date:'2026-11-07',minutes:135}]:[],isPending:false,isError:false,refetch(){}});
export const MembersPage=()=>null;
const roster=new Map([['a',{profile_id:'a',inclusive_overtime_hours:1}]]);
const staff=[{id:'a',display_name:'실제 입력 직원',department_id:'d',hire_date:'2025-01-01'},{id:'late',display_name:'미신청 직원',department_id:'d',hire_date:'2025-01-01'}];
window.__rosterWrites=[];
export const getSupabase=()=>({
  channel:()=>({on(){return this},subscribe(){return this}}),removeChannel(){},
  async rpc(name){return {error:null,data:name==='list_org_chart_members'?staff:name==='employee_extra_leave_records'?{ready:true,entries:[],balances:[]}:[]}},
  from(table){
    let columns=[];
    const query={select(value){columns=value.split(',').map(column=>column.trim());return query},order(){return query},range(){return query},eq(){return query},in(){return query},
      async upsert(row){if(table!=='employee_roster')throw Error(table);window.__rosterWrites.push(row);roster.set(row.profile_id,{...roster.get(row.profile_id),...row});return {error:null}},
      then(resolve){const defaults=Object.fromEntries(columns.map(column=>[column,'']));
        const data=table==='employee_roster'?[...roster.values()].map(row=>({...defaults,...row}))
          : table==='departments'?[{id:'d',name:'디자인',is_active:true,sort_order:0}]
          : table==='employee_roster_header_settings'?[{header_key:'inclusiveOvertimeHours',label:null,hidden:true}]:[];
        return Promise.resolve({data,error:null}).then(resolve)}
    };return query;
  },
});
`)
await writeFile(path.join(dir,'entry.tsx'),`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{Link,MemoryRouter,useLocation}from'react-router-dom';import{Provider,directory,schedules}from'./data';import{OvertimePanel}from'@/features/settings/OvertimePanel';import{AttendanceOvertimePanel}from'@/features/operations-support/AttendanceOvertimePanel';import{AttendanceOffsitePanel}from'@/features/operations-support/AttendanceOffsitePanel';import{OperationsPeoplePanel}from'@/features/operations-support/OperationsPeoplePanel';function App(){const [tab,setTab]=useState('mine');const route=useLocation();if(route.pathname==='/operations-support/people')return <><Link to="/">야근으로 돌아가기</Link><OperationsPeoplePanel/></>;return <><button onClick={()=>setTab('mine')}>개인 야근</button><button onClick={()=>setTab('admin')}>관리 야근</button><button onClick={()=>setTab('offsite')}>관리 외근</button>{tab==='mine'?<OvertimePanel/>:tab==='admin'?<AttendanceOvertimePanel directory={directory} schedules={schedules}/>:<AttendanceOffsitePanel directory={directory} schedules={schedules}/>}</>}createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter><Provider><App/></Provider></MemoryRouter></QueryClientProvider>);`)
const mockNames=['offsite-settlements','workspace-tab-activity','use-overtime-actuals','use-holiday-work','use-monthly-work-requests','auth','use-leave-requests','use-ops-directory','ops-directory','use-department-approvers','use-my-clock-in','use-my-home-notifications','company-work-hours','attendance-clocks','client','MembersPage']
await build({entryPoints:[path.join(dir,'entry.tsx')],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',jsx:'automatic',define:{'import.meta.env':'{"DEV":false}'},plugins:[{name:'local-fixture',setup(b){b.onResolve({filter:/.*/},args=>{if(args.importer.includes(dir))return;let base=args.path.split('/').at(-1).replace(/\.tsx?$/,'');if(mockNames.includes(base)&& (args.path.startsWith('.')||args.path.startsWith('@/')))return{path:path.join(dir,'stubs.tsx')}})}}],alias:{'@':path.join(root,'src')},logLevel:'silent'})
const css=(await readdir('dist/assets')).find(name=>/^index-.*\.css$/.test(name))
const server=createServer(async(req,res)=>{if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(await readFile(path.join(dir,'app.js')))}else if(req.url==='/app.css'){res.setHeader('Content-Type','text/css');res.end(await readFile(path.join('dist/assets',css)))}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>')}})
let browser
try{
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const page=await browser.newPage({viewport:{width:1500,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));const origin=`http://127.0.0.1:${server.address().port}`;await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
await page.clock.setFixedTime(new Date('2026-11-26T12:00:00+09:00'))
await page.goto(origin);await page.waitForTimeout(500);assert.deepEqual(errors,[])
await page.getByRole('button',{name:'관리 야근',exact:true}).click();await page.getByText('표시할 야근·연장근무 기록이 없습니다.',{exact:true}).waitFor()
await page.getByRole('button',{name:'개인 야근',exact:true}).click();assert.equal(await page.getByRole('button',{name:'실제 시간 입력·수정',exact:true}).count(),0);assert.equal(await page.getByLabel('실제 야근 휴게시간').count(),0)
await page.getByRole('button',{name:'테스트 퇴근',exact:true}).click();await page.getByText('퇴근 기록 자동 연결 · 23:00',{exact:true}).waitFor();await page.getByRole('cell',{name:'5시간 퇴근 기록 자동 연결 · 23:00',exact:true}).waitFor()
await page.getByRole('button',{name:'테스트 짧은 퇴근',exact:true}).click();await page.getByText('퇴근 기록 자동 연결 · 19:00',{exact:true}).waitFor()
await page.getByRole('button',{name:'테스트 퇴근 무르기',exact:true}).click();await page.getByRole('cell',{name:'퇴근 기록 대기',exact:true}).first().waitFor()
await page.getByRole('button',{name:'테스트 퇴근',exact:true}).click()
await page.getByRole('button',{name:'관리 야근',exact:true}).click();await page.getByRole('cell',{name:'실제 입력 직원',exact:true}).waitFor();assert.equal(await page.getByRole('cell',{name:'미입력 직원',exact:true}).count(),0);assert.equal(await page.getByRole('cell',{name:'미승인 직원',exact:true}).count(),0);assert.equal(await page.getByRole('cell',{name:'외근 직원',exact:true}).count(),0)
const row=page.getByRole('row').filter({has:page.getByRole('cell',{name:'실제 입력 직원',exact:true})});assert.deepEqual(await row.getByRole('cell').allTextContents(),['실제 입력 직원','디자인','1건','4시간','5시간','0분','1시간','4시간','입력 내역'])
await page.getByRole('button',{name:'입력 내역',exact:true}).click();await page.getByRole('cell',{name:'18:00–23:00',exact:true}).waitFor();await page.screenshot({path:path.join(dir,'overtime.png'),fullPage:true})
await page.getByRole('button',{name:'관리 외근',exact:true}).click();await page.getByRole('cell',{name:'외근 직원',exact:true}).waitFor();await page.getByRole('cell',{name:'거래처',exact:true}).waitFor();
await page.evaluate(()=>window.__holidayCredits=true)
await page.getByRole('button',{name:'관리 야근',exact:true}).click()
await row.getByRole('cell',{name:'7시간 15분',exact:true}).waitFor()
assert.deepEqual(await row.getByRole('cell').allTextContents(),['실제 입력 직원','디자인','2건','6시간 15분','7시간 15분','0분','1시간','6시간 15분','입력 내역'])
await row.getByRole('button',{name:'입력 내역',exact:true}).click()
await page.getByRole('cell',{name:'주말·공휴일 근무',exact:true}).waitFor()
await page.getByRole('button',{name:'관리 외근',exact:true}).click()
const offsiteRow=name=>page.getByRole('row').filter({has:page.getByRole('cell',{name,exact:true})});
await offsiteRow('외근 직원').getByRole('cell',{name:'3시간',exact:true}).waitFor();await offsiteRow('외근 직원').getByRole('cell',{name:'09:00–18:00',exact:true}).waitFor();
await offsiteRow('10시 기준 직원').getByRole('cell',{name:'2시간 30분',exact:true}).waitFor();await offsiteRow('10시 기준 직원').getByRole('cell',{name:'10:00–19:00',exact:true}).waitFor();
await offsiteRow('당일 변경 외근 직원').getByRole('cell',{name:'1시간',exact:true}).waitFor();await offsiteRow('당일 변경 외근 직원').getByRole('cell',{name:'10:00–19:00',exact:true}).waitFor();
assert.equal(await offsiteRow('미설정 외근 직원').getByRole('cell',{name:'기준 미설정',exact:true}).count(),2);
await offsiteRow('새벽 외근 직원').getByRole('cell',{name:/^9시간/}).waitFor();assert.equal(await offsiteRow('취소 외근 직원').getByRole('cell',{name:'—',exact:true}).count(),2);
await page.getByLabel('외근 관리 검색').fill('없음');await page.getByText('해당하는 외근 등록이 없습니다.',{exact:true}).waitFor();await page.getByLabel('외근 관리 검색').fill('');
await page.getByRole('group',{name:'외근 관리 부서'}).getByRole('button',{name:/^소속 없음/}).click();await page.getByRole('cell',{name:'미설정 외근 직원',exact:true}).waitFor();assert.equal(await page.getByRole('cell',{name:'외근 직원',exact:true}).count(),0);await page.getByRole('group',{name:'외근 관리 부서'}).getByRole('button',{name:/^전체/}).click();
await page.getByLabel('외근 진행 구분').selectOption('cancelled');await offsiteRow('취소 외근 직원').waitFor();assert.equal(await offsiteRow('외근 직원').count(),0);await page.getByLabel('외근 진행 구분').selectOption('all');
await page.screenshot({path:path.join(dir,'offsite.png'),fullPage:true});assert.deepEqual(errors,[])
await page.addInitScript(()=>{window.__unrequested=true})
await page.reload()
await page.getByRole('button',{name:'관리 야근',exact:true}).click()
const unrequested=page.getByRole('row').filter({has:page.getByRole('cell',{name:'미신청 직원',exact:true})})
await unrequested.getByRole('cell',{name:'2시간 25분',exact:true}).waitFor()
assert.deepEqual((await unrequested.getByRole('cell').allTextContents()).slice(2,6),['0건','0분','0분','2시간 25분'])
const rosterLink=unrequested.getByRole('link',{name:'미등록·확인 필요',exact:true})
assert.equal(await rosterLink.getAttribute('href'),'/operations-support/people?peopleView=org&orgView=members&overtimeEmployee=late')
await unrequested.getByRole('button',{name:'입력 내역',exact:true}).click()
const history=page.getByRole('table',{name:'미신청 연장근무 내역'})
for (const value of ['2026-11-02','18:00','20:25','2시간 25분']) await history.getByRole('cell',{name:value,exact:true}).waitFor()
await page.getByLabel('야근 관리 검색').fill('없음')
assert.equal(await unrequested.count(),0)
await page.getByLabel('야근 관리 검색').fill('')
await page.evaluate(()=>window.__rosterReadOnly=true)
await rosterLink.click()
await page.getByRole('status').filter({hasText:'직원 배치 수정 권한이 필요합니다'}).waitFor()
assert.equal(await page.getByRole('spinbutton',{name:/약정 연장근로시간 입력/}).count(),0)
await page.evaluate(()=>window.__rosterReadOnly=false)
await page.getByRole('link',{name:'야근으로 돌아가기',exact:true}).click()
await rosterLink.click()
const overtimeInput=page.getByRole('spinbutton',{name:'미신청 직원 약정 연장근로시간 입력',exact:true})
await overtimeInput.waitFor();await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='미신청 직원 약정 연장근로시간 입력')
assert.equal(await page.getByRole('spinbutton',{name:/약정 연장근로시간 입력/}).count(),1)
assert.deepEqual(await page.evaluate(()=>window.__rosterWrites),[])
await overtimeInput.fill('16.3');await overtimeInput.press('Tab')
await page.waitForFunction(()=>window.__rosterWrites.length===1)
const [rosterWrite]=await page.evaluate(()=>window.__rosterWrites)
assert.equal(rosterWrite.profile_id,'late');assert.equal(rosterWrite.inclusive_overtime_hours,16.3)
await page.getByRole('button',{name:'전체 직원 보기',exact:true}).click()
await page.getByRole('textbox',{name:'직원·부서 검색'}).waitFor()
assert.equal(await overtimeInput.count(),0,'직접 입력을 닫으면 기존 헤더 숨김 설정 복원')
await page.getByRole('link',{name:'야근으로 돌아가기',exact:true}).click()
await unrequested.getByText('16시간 18분',{exact:true}).waitFor()
assert.equal(await rosterLink.count(),0)
assert.deepEqual(errors,[])
console.info('Browser: personal and operations overtime, roster link access/focus/save/refresh, and offsite filters passed; no external requests')
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}
