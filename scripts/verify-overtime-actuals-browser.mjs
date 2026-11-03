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
export const directory={members:[],departments:[{id:'d',name:'디자인'}],departmentName:()=> '디자인',loading:false,error:null,refetch(){}};
const C=createContext(null);export function Provider({children}){const [rows,setRows]=useState([]);const [fail,setFail]=useState(false);return <C.Provider value={{rows,setRows,fail}}><button onClick={()=>setFail(!fail)}>저장 오류 전환</button>{children}</C.Provider>};export const useData=()=>useContext(C);
`)
await writeFile(path.join(dir,'stubs.tsx'),`import {useData,requests,directory} from './data';
export const useAuth=()=>({session:{user:{id:'a'}},profile:{id:'a',status:'active',companyId:'company',departmentId:'d'}});
export const useMonthlyWorkRequests=()=>({rows:requests,isPending:false,isError:false,refetch(){}});
export const useLeaveRequests=()=>({requests,userId:'a',busy:false,loading:false,error:null,refresh(){},create:{},transition:{}});
export const useOpsDirectory=()=>directory;export const useDepartmentApprovers=()=>({loading:false,error:null,settings:[]});export const useMyClockIn=()=>({rows:[]});export const useMyHomeNotifications=()=>({items:[]});
export const loadCompanyLunch=async()=>({start:'12:00',end:'13:00',saved:true});
export function useOvertimeActuals(){const {rows,setRows,fail}=useData();return {rows,ready:true,isPending:false,isError:false,refetch(){},save:{async mutateAsync(v){if(fail)throw Error('연결 오류: 입력을 유지합니다.');setRows(rows.filter(r=>r.requestId!==v.requestId).concat({...v,revision:v.revision+1,savedAt:'2026-11-03'}))}}}}
export const getSupabase=()=>({from:()=>({select:()=>({order:()=>({range:async()=>({data:[{profile_id:'a',inclusive_overtime_hours:1}],error:null})})})})});
`)
await writeFile(path.join(dir,'entry.tsx'),`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{MemoryRouter}from'react-router-dom';import{Provider,directory,schedules}from'./data';import{OvertimePanel}from'${root.replaceAll('\\','/')}/src/features/settings/OvertimePanel';import{AttendanceOvertimePanel}from'${root.replaceAll('\\','/')}/src/features/operations-support/AttendanceOvertimePanel';import{AttendanceOffsitePanel}from'${root.replaceAll('\\','/')}/src/features/operations-support/AttendanceOffsitePanel';function App(){const [tab,setTab]=useState('mine');return <><button onClick={()=>setTab('mine')}>개인 야근</button><button onClick={()=>setTab('admin')}>관리 야근</button><button onClick={()=>setTab('offsite')}>관리 외근</button>{tab==='mine'?<OvertimePanel/>:tab==='admin'?<AttendanceOvertimePanel directory={directory}/>:<AttendanceOffsitePanel directory={directory} schedules={schedules}/>}</>}createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter><Provider><App/></Provider></MemoryRouter></QueryClientProvider>);`)
const mockNames=['use-overtime-actuals','use-monthly-work-requests','auth','use-leave-requests','use-ops-directory','ops-directory','use-department-approvers','use-my-clock-in','use-my-home-notifications','company-work-hours','client']
await build({entryPoints:[path.join(dir,'entry.tsx')],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',jsx:'automatic',define:{'import.meta.env':'{"DEV":false}'},plugins:[{name:'local-fixture',setup(b){b.onResolve({filter:/.*/},args=>{if(args.importer.includes(dir))return;let base=args.path.split('/').at(-1).replace(/\.tsx?$/,'');if(mockNames.includes(base)&& (args.path.startsWith('.')||args.path.startsWith('@/')))return{path:path.join(dir,'stubs.tsx')}})}}],alias:{'@':path.join(root,'src')},logLevel:'silent'})
const css=(await readdir('dist/assets')).find(name=>/^index-.*\.css$/.test(name))
const server=createServer(async(req,res)=>{if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(await readFile(path.join(dir,'app.js')))}else if(req.url==='/app.css'){res.setHeader('Content-Type','text/css');res.end(await readFile(path.join('dist/assets',css)))}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>')}})
let browser
try{
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const page=await browser.newPage({viewport:{width:1500,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));const origin=`http://127.0.0.1:${server.address().port}`;await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());await page.goto(origin);await page.waitForTimeout(500);assert.deepEqual(errors,[])
await page.getByRole('button',{name:'관리 야근',exact:true}).click();await page.getByText('승인 후 실제 야근 시간을 입력한 직원이 없습니다.',{exact:true}).waitFor()
await page.getByRole('button',{name:'개인 야근',exact:true}).click();await page.getByRole('button',{name:'실제 시간 입력·수정',exact:true}).first().click()
await page.getByLabel('실제 야근 시작',{exact:true}).fill('2026-11-02T18:30');await page.getByLabel('실제 야근 종료',{exact:true}).fill('2026-11-02T21:00');await page.getByLabel('실제 야근 휴게시간').fill('30');await page.getByText('누적 반영: 2시간',{exact:true}).waitFor()
await page.getByRole('button',{name:'저장 오류 전환'}).click();await page.getByRole('button',{name:'실제 야근 저장',exact:true}).click();await page.getByRole('alert').filter({hasText:'연결 오류'}).waitFor();assert.equal(await page.getByLabel('실제 야근 시작',{exact:true}).inputValue(),'2026-11-02T18:30')
await page.getByRole('button',{name:'저장 오류 전환'}).click();await page.getByRole('button',{name:'실제 야근 저장',exact:true}).click();await page.getByText('실제 야근을 저장했습니다. 승인된 야근의 실제 입력 시간만 누적됩니다.',{exact:true}).waitFor()
await page.getByRole('button',{name:'관리 야근',exact:true}).click();await page.getByRole('cell',{name:'실제 입력 직원',exact:true}).waitFor();assert.equal(await page.getByRole('cell',{name:'미입력 직원',exact:true}).count(),0);assert.equal(await page.getByRole('cell',{name:'미승인 직원',exact:true}).count(),0);assert.equal(await page.getByRole('cell',{name:'외근 직원',exact:true}).count(),0)
const row=page.getByRole('row').filter({has:page.getByRole('cell',{name:'실제 입력 직원',exact:true})});assert.deepEqual(await row.getByRole('cell').allTextContents(),['실제 입력 직원','디자인','1건','4시간','2시간','1시간','1시간','입력 내역'])
await page.getByRole('button',{name:'입력 내역',exact:true}).click();await page.getByRole('cell',{name:'18:30–21:00',exact:true}).waitFor();await page.screenshot({path:path.join(dir,'overtime.png'),fullPage:true})
await page.getByRole('button',{name:'관리 외근',exact:true}).click();await page.getByRole('cell',{name:'외근 직원',exact:true}).waitFor();await page.getByRole('cell',{name:'거래처',exact:true}).waitFor();
const offsiteRow=name=>page.getByRole('row').filter({has:page.getByRole('cell',{name,exact:true})});
await offsiteRow('외근 직원').getByRole('cell',{name:'3시간',exact:true}).waitFor();await offsiteRow('외근 직원').getByRole('cell',{name:'09:00–18:00',exact:true}).waitFor();
await offsiteRow('10시 기준 직원').getByRole('cell',{name:'2시간 30분',exact:true}).waitFor();await offsiteRow('10시 기준 직원').getByRole('cell',{name:'10:00–19:00',exact:true}).waitFor();
await offsiteRow('당일 변경 외근 직원').getByRole('cell',{name:'1시간',exact:true}).waitFor();await offsiteRow('당일 변경 외근 직원').getByRole('cell',{name:'10:00–19:00',exact:true}).waitFor();
assert.equal(await offsiteRow('미설정 외근 직원').getByRole('cell',{name:'기준 미설정',exact:true}).count(),2);
await offsiteRow('새벽 외근 직원').getByRole('cell',{name:'9시간',exact:true}).waitFor();assert.equal(await offsiteRow('취소 외근 직원').getByRole('cell',{name:'—',exact:true}).count(),2);
await page.getByLabel('외근 관리 검색').fill('없음');await page.getByText('해당하는 외근 등록이 없습니다.',{exact:true}).waitFor();await page.getByLabel('외근 관리 검색').fill('');
await page.getByLabel('외근 관리 부서').selectOption('unassigned');await page.getByRole('cell',{name:'미설정 외근 직원',exact:true}).waitFor();assert.equal(await page.getByRole('cell',{name:'외근 직원',exact:true}).count(),0);await page.getByLabel('외근 관리 부서').selectOption('all');
await page.screenshot({path:path.join(dir,'offsite.png'),fullPage:true});assert.deepEqual(errors,[])
console.info('Browser: real personal/admin/offsite components; only approved explicit reports counted, failed save preserves input, breaks/allowance excess/detail, offsite filters passed; no external requests')
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}
