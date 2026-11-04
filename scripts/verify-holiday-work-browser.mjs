import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

// Real panel, mutation/query hooks and common notification/read hooks. All RPCs
// are deterministic local fixtures; no production sessions or requests are used.
const root=process.cwd(),dir=path.join(root,'.tmp/holiday-work-browser')
await fs.mkdir(dir,{recursive:true})
const fixture=path.join(dir,'fixture.tsx')
await fs.writeFile(fixture,`
import React,{createContext,useContext,useMemo,useState} from 'react';
const Auth=createContext(null);window.__writes=[];window.__reads=[];window.__fail=false;window.__policy=null;
window.__rows=[{id:'day-a',employeeId:'staff',employeeName:'검증 직원',departmentName:'기획팀',date:'2026-10-10',dayKind:'rest',location:'mixed',state:'unreported',version:0,intervals:[],plannedIntervals:[],reason:'',reviewNote:null,actualMinutes:null,nightMinutes:null,creditUnits:null,remainingUnits:0,legacySettled:false,source:{offsites:[{id:'offsite-a'}],clocks:[{date:'2026-10-10',in:'09:00',out:'2026-10-10T18:00+09:00'}]},settlements:[]}];window.__events=[];
export function FixtureAuth({children}){const[role,setRole]=useState('staff');window.__role=role;window.__setRole=setRole;const profile=useMemo(()=>({id:role,companyId:'company',status:'active'}),[role]);return <Auth.Provider value={{profile,session:{user:{id:role}}}}>{children}</Auth.Provider>}
export const useAuth=()=>useContext(Auth),usePagePreview=()=>null,useRenderWatch=()=>{};
export const useMeetingNotices=()=>({items:[],series:[],ready:true,error:null}),listMeetingInvitations=async()=>[],listMyLeaveUsageNotices=async()=>[],listMyLateStatementNotices=async()=>[],lateStatementNoticeItems=()=>[],leaveNoticeItems=()=>[];
function add(kind,audience,tab,body,action){const r=window.__rows[0];window.__events.unshift({event_key:'holiday:'+kind+':'+r.version,entity_id:r.id,created_at:new Date(Date.now()+r.version*1000).toISOString(),event_type:'holiday-'+kind,tab,kind:'overtime',employee_name:r.employeeName,from_date:r.date,to_date:r.date,start_time:'',end_time:'',note:body,decision_note:null,action_needed:action,status:r.state,current:true,read_at:null,title:r.employeeName+' · '+body,action_key:'holiday-work:'+r.id,audience})}
function events(){return window.__events.filter(e=>e.audience===window.__role).map(e=>({...e,action_needed:e.event_type==='holiday-submitted'?window.__rows[0].state==='submitted':e.event_type==='holiday-settle'?window.__rows[0].remainingUnits>0:e.action_needed,current:e.event_type==='holiday-submitted'?window.__rows[0].state==='submitted':e.current}))}
export const getSupabase=()=>({rpc:async(name,args={})=>{
 if(name==='list_my_home_work_notifications')return{data:events(),error:null};
 if(name==='read_my_home_work_notification'){window.__reads.push(args.p_key);const e=window.__events.find(e=>e.event_key===args.p_key);if(e)e.read_at=new Date().toISOString();return{data:null,error:null}}
 if(name!=='holiday_work')throw Error('unexpected '+name);
 const{p_action:a,p_payload:p}=args;let r=window.__rows[0];
 if(a==='list')return{data:{ready:true,isOperations:window.__role==='ops',policy:window.__policy,rows:window.__role==='peer'?[]:window.__rows.map(r=>({...r,canSubmit:window.__role==='staff'&&['unreported','returned','planned'].includes(r.state),canReview:window.__role==='approver'&&r.state==='submitted',canSettle:window.__role==='ops'&&r.state==='approved'}))},error:null};
 window.__writes.push({a,p});if(window.__fail)return{data:null,error:{code:'23514',message:'저장 연결 실패 · 입력 유지'}};
 if(a==='submit'){r.state='submitted';r.version++;r.intervals=p.intervals;r.reason=p.note;add('submitted','approver','approvals','실제 시간 확인 요청',true)}
 if(a==='review'){r.state='approved';r.version++;r.actualMinutes=120;r.nightMinutes=0;r.creditUnits=360;r.remainingUnits=360;add('approved','staff','my-attendance','시간 확인 완료',false);add('settle','ops','holiday-work','보상 정산 대기',true)}
 if(a==='settle'){r.version++;const units=p.mode==='cash'?r.remainingUnits:p.days*960;r.remainingUnits-=units;r.settlements.push({id:p.id,version:1,mode:p.mode,units,amountWon:p.mode==='cash'?Math.ceil(units*p.rate/120):null,paymentMonth:p.month,paidOn:null,days:p.days,expires:p.expires,note:p.note});add('settled','staff','my-attendance','보상 확정',false)}
 if(a==='paid'){r.settlements.find(s=>s.id===p.id).paidOn=p.date;r.version++}
 if(a==='policy'){window.__policy={ref:p.ref,date:p.date}}
 return{data:{saved:true,id:r.id},error:null}
}});
`)
await fs.writeFile(path.join(dir,'entry.tsx'),`
import React,{useState}from'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{BrowserRouter,useNavigate}from'react-router-dom';
import{HolidayWorkPanel}from'../../src/features/operations-support/HolidayWorkPanel';import{MyHomeNotificationList,MyHomeNotificationBadge}from'../../src/features/settings/MyHomeNotificationList';import{WorkspaceTabActivityContext}from'../../src/components/layout/workspace-tab-activity';import{FixtureAuth,useAuth}from'./fixture';
const cache=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});window.__refresh=()=>cache.invalidateQueries();
function App(){const{profile}=useAuth();const[active,setActive]=useState(true);window.__active=setActive;window.__navigate=useNavigate();const scope=profile.id==='ops'?'operations':profile.id==='approver'?'review':'mine';const tab=profile.id==='ops'?'holiday-work':profile.id==='approver'?'approvals':'my-attendance';return <WorkspaceTabActivityContext.Provider value={active}><div><MyHomeNotificationBadge tab={tab}/></div>{scope!=='operations'&&<MyHomeNotificationList tab={tab}/>}<HolidayWorkPanel key={profile.id} scope={scope}/></WorkspaceTabActivityContext.Provider>}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={cache}><FixtureAuth><BrowserRouter><App/></BrowserRouter></FixtureAuth></QueryClientProvider>);
`)
const mocked=['lib/supabase/auth','lib/supabase/client','lib/company/page-preview-context','features/meetings/use-meeting-notices','lib/supabase/meetings','lib/supabase/leave-usage-notices','lib/supabase/late-arrival-statements','features/home/LateStatementReview','features/operations-support/leave-usage-notices','lib/diagnostics']
await build({entryPoints:[path.join(dir,'entry.tsx')],outfile:path.join(dir,'bundle.js'),bundle:true,format:'esm',jsx:'automatic',define:{'import.meta.env.DEV':'false','process.env.NODE_ENV':'"test"'},loader:{'.css':'empty'},alias:{'@':path.join(root,'src')},plugins:[{name:'fixtures',setup(b){b.onResolve({filter:/.*/},args=>{if(!args.importer.includes(path.join(root,'src')))return;const target=(args.path.startsWith('@/')?path.join(root,'src',args.path.slice(2)):path.resolve(args.resolveDir,args.path)).replaceAll('\\','/').replace(/\.tsx?$/,'');if(mocked.some(m=>target===path.join(root,'src',m).replaceAll('\\','/')))return{path:fixture}})}}],logLevel:'silent'})
const css=(await fs.readdir('dist/assets')).find(n=>/^index-.*\.css$/.test(n))
const server=http.createServer(async(req,res)=>{if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(await fs.readFile(path.join(dir,'bundle.js')))}else if(req.url==='/app.css'){res.setHeader('Content-Type','text/css');res.end(await fs.readFile(path.join(root,'dist/assets',css)))}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><div style="padding:24px" id="root"></div><script type="module" src="/bundle.js"></script>')}})
let browser
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const page=await browser.newPage({viewport:{width:1450,height:1100},timezoneId:'Asia/Seoul'}),errors=[],external=[]
 page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():(external.push(r.request().url()),r.abort()))
 await page.goto(origin+'/settings/profile');await page.getByLabel('휴일 근무 월',{exact:true}).fill('2026-10')
 await page.getByRole('button',{name:'실제 시간 입력',exact:true}).click();const form=page.getByRole('dialog',{name:'주말·공휴일 실제 근무 제출'})
 assert.equal(await form.getByLabel('근무 구간 1 시작').inputValue(),'','actual work never copied from clock or plan')
 await form.getByLabel('근무 구간 1 시작').fill('09:00');await form.getByLabel('근무 구간 1 종료').fill('11:00');await form.getByLabel('휴일 근무 업무 내용').fill('실제 현장 업무 완료')
 await page.evaluate(()=>window.__fail=true);await form.getByRole('button',{name:'부서 승인자에게 제출'}).click();await form.getByRole('alert').waitFor();assert.equal(await form.getByLabel('근무 구간 1 종료').inputValue(),'11:00')
 await page.evaluate(()=>window.__fail=false);await form.getByRole('button',{name:'부서 승인자에게 제출'}).click();await form.waitFor({state:'hidden'})
 await page.evaluate(()=>window.__setRole('approver'));await page.getByText('실제 시간 확인 요청',{exact:false}).first().waitFor()
 assert.equal(await page.getByLabel('처리 필요 1건').count(),1);assert.equal((await page.evaluate(()=>window.__reads)).length,0,'list does not mark read')
 await page.evaluate(()=>window.__active(false));await page.evaluate(()=>window.__navigate('/settings/profile?part=approvals&holidayWork=day-a&holidayMonth=2026-10&holidayEvent=holiday%3Asubmitted%3A1'))
 await page.waitForTimeout(100);assert.equal((await page.evaluate(()=>window.__reads)).length,0,'hidden detail is not read')
 await page.evaluate(()=>window.__active(true));await page.getByLabel('주말·공휴일 근무 상세').waitFor();await page.waitForFunction(()=>window.__reads.includes('holiday:submitted:1'))
 assert.equal(await page.getByLabel('처리 필요 1건').count(),1,'reading leaves approval pending')
 await page.getByRole('button',{name:'실제 시간 확인',exact:true}).click();await page.getByText('정산 대기 · 시간 보관',{exact:false}).first().waitFor()
 await page.evaluate(()=>window.__setRole('ops'));await page.getByText(/서면합의 기준 미등록/).waitFor();await page.getByLabel('검증 직원 2026-10-10 정산 선택').check();await page.getByRole('button',{name:'선택한 시간 정산',exact:true}).click()
 const settle=page.getByRole('dialog',{name:'휴일근무 보상 확정'});assert.equal(await settle.locator('option[value="leave"]').evaluate(el=>el.disabled),true,'no written agreement means no leave issuance')
 await settle.getByRole('button',{name:'닫기',exact:true}).click();await page.getByRole('button',{name:'합의 기준 등록',exact:true}).click();await page.getByLabel('보상휴가 서면합의 기준명').fill('격리 검증용 체결 기준');await page.getByLabel('보상휴가 서면합의 체결일').fill('2026-10-01');await page.getByLabel('해당 서면합의가 체결되어 있고 적용 범위를 확인했습니다.').check();await page.getByRole('button',{name:'합의 기준 저장'}).click()
 await page.getByLabel('검증 직원 2026-10-10 정산 선택').check();await page.getByRole('button',{name:'선택한 시간 정산',exact:true}).click();await settle.getByLabel('휴일 근무 보상 방식').selectOption('leave');await settle.getByLabel('보상휴가 지급 일수').fill('0.25');await settle.getByLabel('보상휴가 사용기한').fill('2027-01-31');await settle.getByLabel('휴일 보상 확정 사유').fill('일부 보상휴가, 잔여 시간 보존');await settle.getByLabel('근무 확인 내역·가산 기준·중복 지급 여부를 확인했습니다.').check();await settle.getByRole('button',{name:'보상 확정',exact:true}).click();await settle.waitFor({state:'hidden'});await page.getByText('일부 정산 · 잔여 시간 보관',{exact:false}).first().waitFor()
 assert.equal(await page.evaluate(()=>window.__rows[0].remainingUnits),120)
 await page.getByLabel('검증 직원 2026-10-10 정산 선택').check();await page.getByRole('button',{name:'선택한 시간 정산',exact:true}).click();await settle.getByLabel('휴일 근무 통상시급').fill('10000');await settle.getByLabel('휴일 수당 지급 예정 월').fill('2026-11');await settle.getByLabel('휴일 보상 확정 사유').fill('잔여 시간 수당 확정');await settle.getByLabel('근무 확인 내역·가산 기준·중복 지급 여부를 확인했습니다.').check();await settle.getByRole('button',{name:'보상 확정',exact:true}).click();await settle.waitFor({state:'hidden'})
 await page.getByRole('button',{name:'상세',exact:true}).click();await page.getByLabel('주말·공휴일 근무 상세').getByText(/10,000원/).waitFor();assert.equal(await page.getByRole('button',{name:'수당 지급 완료 기록'}).isDisabled(),true)
 await page.screenshot({path:path.join(dir,'operations-holiday-work.png'),fullPage:true});await page.getByLabel('실제 지급을 확인했습니다.').check();await page.getByRole('button',{name:'수당 지급 완료 기록'}).click();await page.getByText(/지급 완료/).first().waitFor()
 await page.evaluate(()=>window.__setRole('peer'));await page.getByText('해당하는 근무가 없습니다.').waitFor();assert.equal(await page.getByLabel('주말·공휴일 근무 상세').count(),0);assert.equal(await page.getByRole('button',{name:'선택한 시간 정산'}).count(),0)
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log('holiday-work browser: employee entry/failure, approver/read synchronization, hidden screen, agreement lock, partial leave, remaining cash, payment confirmation and account switch passed')
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}
