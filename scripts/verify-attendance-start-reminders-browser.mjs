import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {existsSync} from 'node:fs'
import http from 'node:http'
import {build} from 'esbuild'
import {chromium} from 'playwright-core'
const root=process.cwd(),dir=path.join(root,'.tmp/attendance-start-reminders-browser');await fs.mkdir(dir,{recursive:true})
const fixture=path.join(dir,'fixture.tsx'),entry=path.join(dir,'entry.tsx')
await fs.writeFile(fixture,`
import React,{createContext,useContext,useState}from'react';import{useQueryClient}from'@tanstack/react-query';
const Auth=createContext(null),EMPTY=[];window.__actor='primary';window.__version='1:a';window.__reads={};window.__calls=[];window.__failed=false;window.__settings={};window.__loading=false;
const members=[{id:'one',displayName:'직원 하나',departmentId:'planning'},{id:'two',displayName:'직원 둘',departmentId:'planning'}];
export function Fixture({children}){const[id,setId]=useState('primary');window.__switch=id=>{window.__actor=id;setId(id)};return <Auth.Provider value={{profile:{id,status:'active',companyId:'company'},session:{user:{id}}}}>{children}</Auth.Provider>}
export const useAuth=()=>useContext(Auth),usePagePreview=()=>null;
const approvals=[{departmentId:'planning',approverId:'primary',substituteId:'substitute'}];export const useDepartmentApprovers=()=>({settings:approvals,loading:false});window.__assignments=approvals;export const listDepartmentApprovers=async()=>[...window.__assignments];
export const useOpsDirectory=()=>({members,departments:[{id:'planning',name:'기획팀'}],departmentName:()=> '기획팀',loading:window.__loading});
export function useAttendanceStartSettings(){const cache=useQueryClient(),[revision,setRevision]=useState(0);window.__rerender=()=>setRevision(v=>v+1);return{index:new Map(Object.entries(window.__settings)),loading:window.__loading,save:{isPending:false,mutateAsync:async input=>{window.__settings[input.month+':employee:'+input.employeeId]={start:input.start};setRevision(v=>v+1);await cache.invalidateQueries({queryKey:['attendance-start-reminders']})}}}}
export const getSupabase=()=>({rpc:async(name,args)=>{window.__calls.push({name,args,actor:window.__actor});if(name==='read_attendance_start_reminder'){if(window.__failed)return{error:{code:'57014'}};if(args.p_version===window.__version)window.__reads[window.__actor]=window.__version;return{error:null,data:true}};const missing=members.filter(m=>!window.__settings['2026-12:employee:'+m.id]).length;return{error:null,data:[{id:'notice',departmentId:'planning',department:'기획팀',month:'2026-12',version:window.__version,issuedAt:'2026-11-24T00:00:00Z',readAt:window.__reads[window.__actor]===window.__version?'2026-11-24T01:00:00Z':null,total:2,missing,current:missing>0,overdue:false}]}}});
export const diagnosticOperation=(d,n,fn)=>fn({run:(n,fn)=>fn({}),block:()=>{}}),tracedQuery=q=>q;
`)
await fs.writeFile(entry,`
import React from'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{MemoryRouter,useNavigate}from'react-router-dom';
import{Fixture}from'./fixture';import{MyAttendanceStartPanel}from'../../src/features/settings/MyAttendanceStartPanel';import{useAttendanceStartReminders}from'../../src/features/settings/use-attendance-start-reminders';import{attendanceStartReminderItems}from'../../src/features/settings/attendance-start-reminders';import{NotificationPanel}from'../../src/components/layout/NotificationPanel';
const cache=new QueryClient({defaultOptions:{queries:{retry:false}}});window.__cache=cache;
function App(){const reminders=useAttendanceStartReminders(true),navigate=useNavigate();window.__go=navigate;return <main><aside><NotificationPanel items={attendanceStartReminderItems(reminders.rows)} titleId="notice" onOpen={item=>navigate(item.href)} onClose={()=>{}}/></aside><MyAttendanceStartPanel departmentIds={['planning']}/></main>}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={cache}><Fixture><MemoryRouter initialEntries={['/settings/profile?part=attendance&month=2026-12']}><App/></MemoryRouter></Fixture></QueryClientProvider>);
`)
const mocks=['lib/supabase/auth','lib/company/page-preview-context','features/operations-support/use-department-approvers','lib/supabase/department-approvers','features/operations-support/ops-directory','features/operations-support/use-attendance-start-settings','lib/supabase/client','lib/diagnostics/workflow-trace'].map(p=>path.join(root,'src',p).replaceAll('\\','/'))
await build({entryPoints:[entry],bundle:true,format:'esm',outfile:path.join(dir,'bundle.js'),jsx:'automatic',loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"test"','import.meta.env':'{"DEV":false}'},plugins:[{name:'isolated-api',setup(b){b.onResolve({filter:/.*/},a=>{
 if(a.path.startsWith('@/')){const p=path.join(root,'src',a.path.slice(2)).replaceAll('\\','/');if(mocks.includes(p))return{path:fixture};for(const ext of (p.endsWith('.css')?['']:['.ts','.tsx','/index.ts']))if(existsSync(p+ext))return{path:p+ext}}
 if(a.path.startsWith('.')){const p=path.resolve(a.resolveDir,a.path).replaceAll('\\','/').replace(/\.tsx?$/,'');if(mocks.includes(p))return{path:fixture}}
})}}]})
const css=(await fs.readdir('dist/assets')).filter(p=>p.endsWith('.css'));const style=(await Promise.all(css.map(p=>fs.readFile(path.join('dist/assets',p),'utf8')))).join('\n')
const server=http.createServer(async(req,res)=>{if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(await fs.readFile(path.join(dir,'bundle.js')))}else res.end('<!doctype html><meta charset="utf-8"><style>'+style+'main{max-width:1100px;margin:auto;padding:20px}aside{max-width:430px;margin-bottom:20px}</style><div id="root"></div><script type="module" src="/bundle.js"></script>')});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port
let browser
try{
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
 const page=await browser.newPage({viewport:{width:1300,height:1000}}),errors=[],remote=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():(remote.push(r.request().url()),r.abort()))
 await page.goto(origin);await page.getByText('12월 · 2명 중 2명 미지정',{exact:true}).waitFor()
 await page.waitForFunction(()=>window.__reads.primary===window.__version)
 assert.equal(await page.getByLabel('안 읽음',{exact:true}).count(),0,'local view synchronizes inbox read')
 assert.equal(await page.getByText('출근시간 지정 필요',{exact:true}).count(),1,'reading does not complete unfinished work')
 await page.getByRole('button',{name:'11월',exact:true}).click();await page.getByText('11월 · 2명 중 2명 미지정',{exact:true}).waitFor();await page.getByRole('button',{name:/2026년 12월 출근시간을 지정해 주세요/}).click();await page.getByText('12월 · 2명 중 2명 미지정',{exact:true}).waitFor()
 await page.evaluate(()=>{window.__version='2:a';window.__cache.invalidateQueries({queryKey:['attendance-start-reminders']})});await page.waitForFunction(()=>window.__reads.primary==='2:a')
 await page.getByRole('checkbox',{name:'미지정만 보기',exact:true}).check();await page.getByRole('checkbox',{name:'직원 하나 선택',exact:true}).check()
 await page.getByRole('button',{name:'12월 · 1명 적용',exact:true}).click();await page.getByText('12월 · 2명 중 1명 미지정',{exact:true}).waitFor()
 assert.equal(await page.getByRole('checkbox',{name:'직원 하나 선택',exact:true}).count(),0)
 await page.getByRole('checkbox',{name:'직원 둘 선택',exact:true}).check();await page.getByRole('button',{name:'12월 · 1명 적용',exact:true}).click()
 await page.getByText('12월 · 2명 중 0명 미지정',{exact:true}).waitFor();await page.getByText('출근시간 지정 필요',{exact:true}).waitFor({state:'hidden'})
 await page.screenshot({path:path.join(dir,'desktop.png'),fullPage:true})
 // An unread version must wait for successful roster/settings, including failures.
 await page.evaluate(()=>{window.__settings={};window.__version='3:a';window.__loading=true;window.__rerender();window.__cache.invalidateQueries({queryKey:['attendance-start-reminders']})})
 await page.getByLabel('안 읽음',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.__reads.primary),'2:a')
 await page.evaluate(()=>{window.__loading=false;Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));window.__rerender()});await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>window.__reads.primary),'2:a','background tab must not mark read');
 await page.evaluate(()=>{window.__failed=true;Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'))});await page.getByRole('alert').filter({hasText:'읽음 저장에 실패'}).waitFor()
 assert.equal(await page.evaluate(()=>window.__reads.primary),'2:a')
 await page.evaluate(()=>window.__failed=false);await page.getByRole('button',{name:'읽음 저장 재시도',exact:true}).click();await page.waitForFunction(()=>window.__reads.primary==='3:a')
 await page.evaluate(()=>window.__switch('substitute'));await page.waitForFunction(()=>window.__reads.substitute==='3:a')
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(dir,'mobile.png'),fullPage:true})
 await page.evaluate(()=>{window.__assignments=[];window.__cache.invalidateQueries({queryKey:['department-approvers']})});await page.getByText('출근시간 지정 필요',{exact:true}).waitFor({state:'hidden'});
 assert.deepEqual(errors,[]);assert.deepEqual(remote,[])
 console.log('PASS reminder browser: month deep-link, shared inbox reads/pending, bulk save/filter/complete, next version, failed/unloaded read guard/retry, substitute/account switch, mobile; no external API')
}finally{await browser?.close();await new Promise(r=>server.close(r))}
