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
import{useQuery}from'@tanstack/react-query';
const Auth=createContext(null);window.__writes=[];window.__reads=[];window.__fail=false;window.__policy=null;
window.__rows=[{id:'day-a',employeeId:'staff',employeeName:'검증 직원',departmentName:'기획팀',date:'2026-10-10',dayKind:'rest',location:'mixed',state:'unreported',version:0,intervals:[],plannedIntervals:[],reason:'',reviewNote:null,actualMinutes:null,nightMinutes:null,creditUnits:null,remainingUnits:0,legacySettled:false,source:{offsites:[{id:'offsite-a'}],clocks:[{date:'2026-10-10',in:'09:00',out:'2026-10-10T18:00+09:00'}]},settlements:[]}];window.__events=[];
export function FixtureAuth({children}){const[role,setRole]=useState('staff');window.__role=role;window.__setRole=setRole;const profile=useMemo(()=>({id:role,companyId:'company',status:'active'}),[role]);return <Auth.Provider value={{profile,session:{user:{id:role}}}}>{children}</Auth.Provider>}
export const useAuth=()=>useContext(Auth),usePagePreview=()=>null,useRenderWatch=()=>{};
export const useMeetingNotices=()=>({items:[],series:[],ready:true,error:null}),useMeetingNoticeContext=()=>({data:{invitations:[]}}),listMyLeaveUsageNotices=async()=>[],listMyLateStatementNotices=async()=>[],lateStatementNoticeItems=()=>[],leaveNoticeItems=()=>[];
window.__offsites=[];window.__caseQueries=[];window.__weekdaySaved=null;window.__failAction=null;window.__confirmationWorkflow=false;window.__offlineCompensation=false;window.__confirmedSettlement=false;window.__uploads=[];
export function useMonthlyWorkRequests(month,enabled=true){const q=useQuery({queryKey:['company-leave-cover',window.__role,month],enabled,queryFn:async()=>window.__offsites.filter(r=>r.from.slice(0,7)<=month&&r.to.slice(0,7)>=month)});return{...q,rows:q.data??[]}}
export const offsiteSettlementPreview=async(request)=>request==='weekend-trip'
 ? {settlement:null,dates:[{date:'2026-11-07',minutes:480}]}
 : {settlement:window.__weekdaySaved,dates:[{date:'2026-10-30',minutes:360},{date:'2026-10-31',minutes:1380},{date:'2026-11-01',minutes:1380},{date:'2026-11-02',minutes:180}]};
export const saveOffsiteSettlement=async()=>{throw Error('mixed case must use the holiday workflow')};
function add(kind,audience,tab,body,action){const r=window.__rows[0];window.__events.unshift({event_key:'holiday:'+kind+':'+r.version,entity_id:r.id,created_at:new Date(Date.now()+r.version*1000).toISOString(),event_type:'holiday-'+kind,tab,kind:'overtime',employee_name:r.employeeName,from_date:r.date,to_date:r.date,start_time:'',end_time:'',note:body,decision_note:null,action_needed:action,status:r.state,current:true,read_at:null,title:r.employeeName+' · '+body,action_key:'holiday-work:'+r.id,audience})}
function events(){return window.__events.filter(e=>e.audience===window.__role).map(e=>{
 const r=window.__rows.find(row=>row.id===e.entity_id);
 const pending=e.event_type==='holiday-confirmation-request'?Boolean(r?.confirmation&&!r.confirmation.choice)
  :e.event_type==='holiday-confirmation-submitted'?Boolean(r?.remainingUnits):undefined;
 return{...e,action_needed:pending??(e.event_type==='holiday-submitted'?window.__rows[0].state==='submitted':e.event_type==='holiday-settle'?window.__rows[0].remainingUnits>0:e.action_needed),
  current:pending??(e.event_type==='holiday-submitted'?window.__rows[0].state==='submitted':e.current)};
})}
export const getSupabase=()=>({storage:{from:()=>({upload:async(path,file,options)=>{
 window.__uploads.push({path,size:file.size,type:options.contentType});return{data:{path},error:null};
 }})},rpc:async(name,args={})=>{
 if(name==='list_my_managed_work_notifications'||name==='list_my_home_work_notifications')return{data:events(),error:null};
 if(name==='read_my_home_work_notification'){window.__reads.push(args.p_key);const e=window.__events.find(e=>e.event_key===args.p_key);if(e)e.read_at=new Date().toISOString();return{data:null,error:null}}
 if(name!=='holiday_work')throw Error('unexpected '+name);
 const{p_action:a,p_payload:p}=args;let r=window.__rows[0];
 if(a==='list'){if(p.request)window.__caseQueries.push(p.request);return{data:{ready:true,isOperations:window.__role==='ops',confirmationWorkflow:window.__confirmationWorkflow,offlineCompensation:window.__offlineCompensation,confirmedSettlement:window.__confirmedSettlement,policy:window.__policy,rows:window.__role==='peer'?[]:window.__rows.filter(r=>p.request?r.source.offsites.some(o=>o.id===p.request):!window.__offsites.length||r.date.startsWith(p.month.slice(0,7))).map(r=>({...r,confirmation:r.confirmation?{...r.confirmation,signedPath:window.__role==='ops'?r.confirmation.signedPath:null}:undefined,canSubmit:window.__role==='staff'&&['unreported','returned','planned'].includes(r.state),canReview:window.__role==='approver'&&r.state==='submitted',canSettle:window.__role==='ops'&&r.state==='approved'}))},error:null}}
 window.__writes.push({a,p});if(window.__fail||a===window.__failAction)return{data:null,error:{code:'23514',message:'저장 연결 실패 · 입력 유지'}};
 if(a==='submit'){r.state='submitted';r.version++;r.intervals=p.intervals;r.reason=p.note;add('submitted','approver','approvals','실제 시간 확인 요청',true)}
 if(a==='review'){r.state='approved';r.version++;r.actualMinutes=120;r.nightMinutes=0;r.creditUnits=360;r.remainingUnits=360;add('approved','staff','my-attendance','시간 확인 완료',false);add('settle','ops','holiday-work','보상 정산 대기',true)}
 if(a==='settle'){let left=p.mode==='cash'?Infinity:p.days*960;for(const row of window.__rows.filter(row=>p.ids.includes(row.id))){const units=Math.min(row.remainingUnits,left);if(!units)continue;left-=units;row.version++;row.remainingUnits-=units;row.settlements.push({id:p.id,version:1,mode:p.mode,units,amountWon:p.mode==='cash'?Math.ceil(units*p.rate/120):null,paymentMonth:p.month,paidOn:null,days:p.days,expires:p.expires,note:p.note});}add('settled','staff','my-attendance','보상 확정',false)}
 if(a==='settle-confirmed'){
   if(window.__role!=='ops'||!p.verified||r.confirmation?.id!==p.confirmationId||r.version!==p.version)throw Error('invalid settlement');
   r.settlements.push({id:p.id,version:1,mode:r.confirmation.choice==='leave'?'leave':'overtime',units:r.remainingUnits,days:p.days,expires:p.expires,overtimeMinutes:p.minutes});
   r.remainingUnits=0;r.version++;add('settled','staff','my-attendance','보상 확정',false);
 }
 if(a==='paid'){r.settlements.find(s=>s.id===p.id).paidOn=p.date;r.version++}
 if(a==='policy'){window.__policy={ref:p.ref,date:p.date}}
 if(a==='offsite-settle'){window.__weekdaySaved={request_id:p.requestId,mode:p.mode,minutes_by_date:p.minutes,leave_days:p.days,expires_on:p.expires,note:p.note,decided_at:'2026-11-04T12:00:00+09:00'}}
 if(a==='confirmation-request'){
  if(p.confirmationId){r.confirmation.allowLeave=p.leaveAuthorized===true;return{data:{id:r.confirmation.id},error:null}}
  r.confirmation={id:'confirmed-form',work:{name:r.employeeName,department:r.departmentName,grade:r.jobGrade,date:r.date,location:r.location,intervals:r.intervals,actualMinutes:r.actualMinutes,
   creditUnits:r.creditUnits,remainingUnits:r.remainingUnits,reason:r.reason,requestedBy:'운영 담당자'},choice:null,allowLeave:window.__confirmedSettlement||p.leaveAuthorized===true,requestedAt:new Date().toISOString()};
  add('confirmation-request','staff','my-attendance','보상방법 선택 요청',true);
 }
 if(a==='confirmation-respond'){r.confirmation.choice=p.choice;r.confirmation.respondedAt='2026-11-25T01:00:00Z';add('confirmation-submitted','ops','holiday-work','보상 확인서 제출',true)}
 if(a==='confirmation-file'){r.confirmation.signedPath=p.path;r.confirmation.signedAt='2026-11-25T02:00:00Z'}
 return{data:{saved:true,id:r.id},error:null}
}});
`)
await fs.writeFile(path.join(dir,'entry.tsx'),`
import React,{useState}from'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{BrowserRouter,useNavigate,useSearchParams}from'react-router-dom';
import{HolidayWorkPanel}from'../../src/features/operations-support/HolidayWorkPanel';import{OffsiteSettlementEditor}from'../../src/features/operations-support/OffsiteSettlementEditor';import{MyHomeNotificationList,MyHomeNotificationBadge}from'../../src/features/settings/MyHomeNotificationList';import{HolidayWorkConfirmationHeaderButton}from'../../src/features/settings/HolidayWorkConfirmationHeaderButton';import{WorkspaceTabActivityContext}from'../../src/components/layout/workspace-tab-activity';import{FixtureAuth,useAuth}from'./fixture';
const cache=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});window.__refresh=()=>cache.invalidateQueries();
function App(){const{profile}=useAuth();const[params]=useSearchParams();const[active,setActive]=useState(true);window.__active=setActive;window.__navigate=useNavigate();const scope=profile.id==='ops'?'operations':profile.id==='approver'?'review':'mine';const tab=profile.id==='ops'?'holiday-work':profile.id==='approver'?'approvals':'my-attendance';return <WorkspaceTabActivityContext.Provider value={active}><div><HolidayWorkConfirmationHeaderButton key={profile.id}/><MyHomeNotificationBadge tab={tab}/></div>{scope!=='operations'&&<MyHomeNotificationList tab={tab}/>}{params.has('oldOffsite')?<OffsiteSettlementEditor request={window.__offsites[0]} onClose={()=>{}}/>:<HolidayWorkPanel key={profile.id} scope={scope}/>}</WorkspaceTabActivityContext.Provider>}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={cache}><FixtureAuth><BrowserRouter><App/></BrowserRouter></FixtureAuth></QueryClientProvider>);
`)
const mocked=['lib/supabase/auth','lib/supabase/client','lib/company/page-preview-context','features/meetings/use-meeting-notices','features/meetings/use-meeting-notice-context','lib/supabase/meetings','lib/supabase/leave-usage-notices','lib/supabase/late-arrival-statements','features/home/LateStatementReview','features/operations-support/leave-usage-notices','lib/diagnostics','features/operations-support/use-monthly-work-requests','lib/supabase/offsite-settlements']
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
 await page.evaluate(()=>window.__setRole('ops'));await page.getByText('정산 기준',{exact:true}).click();assert.equal(await page.getByText('합의 기준 등록',{exact:true}).count(),0);await page.getByLabel('검증 직원 2026-10-10 정산 선택').check();await page.getByRole('button',{name:'선택한 시간 정산',exact:true}).click()
 const settle=page.getByRole('dialog',{name:'휴일근무 보상 확정'});assert.equal(await settle.locator('option[value="leave"]').evaluate(el=>el.disabled),true,'no written agreement means no leave issuance')
 await settle.getByRole('button',{name:'닫기',exact:true}).click();await page.evaluate(()=>{window.__policy={ref:'기존 정산 기준',date:'2026-10-01'};return window.__refresh()})
 await page.getByLabel('검증 직원 2026-10-10 정산 선택').check();await page.getByRole('button',{name:'선택한 시간 정산',exact:true}).click();await settle.getByLabel('휴일 근무 보상 방식').selectOption('leave');await settle.getByLabel('보상휴가 지급 일수').fill('0.25');await settle.getByLabel('보상휴가 사용기한').fill('2027-01-31');await settle.getByLabel('휴일 보상 확정 사유').fill('일부 보상휴가, 잔여 시간 보존');await settle.getByLabel('근무 확인 내역·가산 기준·중복 지급 여부를 확인했습니다.').check();await settle.getByRole('button',{name:'보상 확정',exact:true}).click();await settle.waitFor({state:'hidden'});await page.getByText('일부 정산 · 잔여 시간 보관',{exact:false}).first().waitFor()
 assert.equal(await page.evaluate(()=>window.__rows[0].remainingUnits),120)
 await page.getByLabel('검증 직원 2026-10-10 정산 선택').check();await page.getByRole('button',{name:'선택한 시간 정산',exact:true}).click();await settle.getByLabel('휴일 근무 통상시급').fill('10000');await settle.getByLabel('휴일 수당 지급 예정 월').fill('2026-11');await settle.getByLabel('휴일 보상 확정 사유').fill('잔여 시간 수당 확정');await settle.getByLabel('근무 확인 내역·가산 기준·중복 지급 여부를 확인했습니다.').check();await settle.getByRole('button',{name:'보상 확정',exact:true}).click();await settle.waitFor({state:'hidden'})
 await page.getByRole('button',{name:'상세',exact:true}).click();await page.getByLabel('주말·공휴일 근무 상세').getByText(/10,000원/).waitFor();assert.equal(await page.getByRole('button',{name:'수당 지급 완료 기록'}).isDisabled(),true)
 await page.screenshot({path:path.join(dir,'operations-holiday-work.png'),fullPage:true});await page.getByLabel('실제 지급을 확인했습니다.').check();await page.getByRole('button',{name:'수당 지급 완료 기록'}).click();await page.getByText(/지급 완료/).first().waitFor()
 await page.evaluate(()=>window.__setRole('peer'));await page.getByText('해당하는 근무가 없습니다.').waitFor();assert.equal(await page.getByLabel('주말·공휴일 근무 상세').count(),0);assert.equal(await page.getByRole('button',{name:'선택한 시간 정산'}).count(),0)
 // Both entry points open the same modal. Mixed trips keep weekday and holiday accounting separate.
 await page.evaluate(()=>{
   window.__policy=null;
   const trip={id:'mixed-trip',kind:'offsite',status:'approved',employeeId:'staff',employeeName:'검증 직원',departmentName:'기획팀',from:'2026-10-30',to:'2026-11-02',start:'09:00',end:'03:00',offsiteContinuous:true,place:'촬영 현장',note:'주말 포함 촬영',createdAt:'2026-10-29'};
   window.__offsites=[trip,{...trip,id:'weekend-trip',from:'2026-11-07',to:'2026-11-07',start:'11:00',end:'19:00'},
     {...trip,id:'pending-trip',employeeName:'외근 승인 대기 직원',status:'pending',from:'2026-10-24',to:'2026-10-24',start:'11:00',end:'19:00'}];
   const base=window.__rows[0],source={offsites:[{id:'mixed-trip'}],clocks:[]};
   window.__rows=[{...base,id:'sat-work',date:'2026-10-31',remainingUnits:360,settlements:[],source},{...base,id:'sun-work',date:'2026-11-01',remainingUnits:360,settlements:[],source},
     {...base,id:'weekend-work',date:'2026-11-07',actualMinutes:480,creditUnits:1440,remainingUnits:1440,settlements:[],source:{offsites:[{id:'weekend-trip'}],clocks:[]}}];
   window.__setRole('ops');window.__navigate('/operations-support?part=attendance&attendanceView=offsite&oldOffsite=1');
 })
 await page.getByRole('link',{name:'주말·공휴일 근무 진행'}).waitFor();assert.equal(await page.getByRole('button',{name:'후처리 확정',exact:true}).count(),0,'mixed trip cannot be split from old tab');assert.equal(await page.getByLabel('2026-10-30 실제 추가 근무 시:분').count(),0)
 await page.evaluate(()=>window.__refresh())
 await page.getByRole('link',{name:'주말·공휴일 근무 진행'}).click()
 const modal=page.getByRole('dialog',{name:'외근 건 전체 진행',exact:true})
 const saveOffsite=modal.getByRole('button',{name:'저장',exact:true})
 await modal.getByText('2026-11-01',{exact:true}).waitFor()
 assert.equal(await modal.getByRole('button',{name:'휴가로 지급',exact:true}).isDisabled(),true)
 const beforeLater=await page.evaluate(()=>window.__writes.length)
 await modal.getByRole('button',{name:'나중에 처리',exact:true}).click();await saveOffsite.click();await modal.waitFor({state:'hidden'})
 assert.equal(await page.evaluate(()=>window.__writes.length),beforeLater,'deferring never posts a settlement')
 const unified=page.getByRole('table',{name:'주말·공휴일 근무 목록',exact:true})
 const mixedRow=unified.getByRole('row').filter({hasText:'2026-10-31'})
 await mixedRow.waitFor()
 assert.equal(await page.getByRole('table').count(),1,'holiday work and trips are one table')
 assert.equal(await unified.getByRole('row').filter({hasText:'검증 직원'}).count(),1,'one monthly row for the same confirmed day')
 assert.equal(await mixedRow.getByRole('checkbox').count(),0,'linked trip has one settlement entry point')
 await unified.getByRole('row').filter({hasText:'외근 승인 대기 직원'}).waitFor()
 await mixedRow.getByRole('button',{name:'진행',exact:true}).click()
 await modal.getByRole('button',{name:'시간으로 정산',exact:true}).click()
 const weekday=modal.getByLabel('2026-10-30 실제 추가 근무 시:분')
 await weekday.fill('2:00');await modal.getByLabel('2026-11-02 실제 추가 근무 시:분').fill('1:00')
 assert.equal(await modal.getByLabel('2026-10-31 실제 추가 근무 시:분').count(),0)
 await modal.getByLabel('통상시급 · 원').fill('10000');await modal.getByLabel('지급 예정 월').fill('2026-11')
 await modal.getByLabel('처리 사유 · 필수').fill('한 화면에서 평일과 주말 후처리')
 await page.evaluate(()=>window.__active(false));await modal.waitFor({state:'hidden'})
 await page.evaluate(()=>window.__active(true));assert.equal(await weekday.inputValue(),'2:00','same-case draft survives hiding')
 await page.evaluate(()=>window.__failAction='settle');await saveOffsite.click()
 await modal.getByRole('alert').filter({hasText:'평일 기록은 저장됐습니다'}).waitFor()
 await page.evaluate(()=>window.__failAction=null);await saveOffsite.click();await modal.waitFor({state:'hidden'})
 assert.deepEqual(await page.evaluate(()=>window.__weekdaySaved.minutes_by_date),{'2026-10-30':120,'2026-11-02':60})
 assert.equal(await page.evaluate(()=>window.__writes.filter(w=>w.a==='offsite-settle').length),1,'retry must not save weekday twice')
 assert.deepEqual(await page.evaluate(()=>window.__writes.filter(w=>w.a==='settle').at(-1).p.ids),['sat-work','sun-work'])
 assert.ok((await page.evaluate(()=>window.__caseQueries)).includes('mixed-trip'))
 await page.evaluate(()=>{window.__policy={ref:'검증용 기준',date:'2026-10-01'};window.__navigate('/operations-support?part=attendance&attendanceView=holiday&holidayMonth=2026-11&offsiteCase=weekend-trip')})
 await modal.getByText('실제 8시간 × 1.5 → 보상 12시간').waitFor()
 await modal.getByRole('button',{name:'휴가로 지급',exact:true}).click()
 assert.equal(await modal.getByText(/평일 추가근무/).count(),0,'Saturday-only trip hides weekday fields')
 await modal.getByLabel('휴일 보상휴가 일수').fill('1');await modal.getByLabel('사용기한').fill('2027-01-31')
 await modal.getByLabel('처리 사유 · 필수').fill('휴일 근무 보상휴가')
 await saveOffsite.click();await modal.waitFor({state:'hidden'})
 assert.deepEqual(await page.evaluate(()=>window.__rows.find(r=>r.id==='weekend-work').remainingUnits),480)
 assert.equal(await page.evaluate(()=>window.__writes.filter(w=>w.a==='offsite-settle').length),1,'no weekday write for a weekend-only trip')
 await page.evaluate(()=>{
   const trip=window.__rows.find(r=>r.id==='weekend-work');
   window.__rows=[{...trip,jobGrade:'사원',reason:'실제 촬영 지원',intervals:[{start:660,end:1140}],state:'approved',remainingUnits:1440,settlements:[]}];
   window.__events=[];window.__confirmationWorkflow=true;window.__offlineCompensation=true;window.__policy=null;
   window.__navigate('/operations-support?part=attendance&attendanceView=holiday&holidayMonth=2026-11&offsiteCase=weekend-trip');
   return window.__refresh();
 })
 await modal.getByRole('button',{name:'2026-11-07 확인서 열기',exact:true}).click()
 const certificate=page.getByRole('region',{name:'주말·휴일근로 보상방법 확인서',exact:true})
 await certificate.getByText('검증 직원 · 기획팀 · 사원',{exact:true}).waitFor()
 assert.equal(await certificate.getByText('실제 8시간 · 가산 반영 12시간').count(),1)
 await certificate.getByLabel('직원에게 제공할 보상방법').selectOption('both')
 await certificate.getByRole('button',{name:'직원에게 확인 요청'}).click()
 await certificate.getByRole('status').getByText('직원 제출 대기').waitFor()
 assert.equal(await page.evaluate(()=>window.__writes.find(w=>w.a==='confirmation-request').p.leaveAuthorized),true)
 await modal.getByRole('button',{name:'닫기',exact:true}).click()
 await page.evaluate(()=>{window.__setRole('staff');window.__navigate('/settings/profile?part=my-attendance')})
 const confirmationButton=page.getByRole('button',{name:'휴일근무 보상 확인서 작성',exact:true})
 await confirmationButton.waitFor()
 assert.equal(await page.getByRole('button',{name:/보상방법 선택 요청/}).count(),0,'employees get the red action button in place of the regular notice')
 assert.equal(await page.getByLabel('처리 필요 1건').count(),0)
 assert.equal(await page.evaluate(()=>window.__reads.filter(key=>key.includes('confirmation-request')).length),0)
 await page.setViewportSize({width:390,height:844})
 await confirmationButton.click()
 const employeeModal=page.getByRole('dialog',{name:'주말·휴일근로 보상방법 선택 및 확인서',exact:true})
 const employeeForm=employeeModal.getByRole('form',{name:'주말·휴일근로 보상방법 확인서',exact:true})
 await employeeForm.getByText('실제 촬영 지원',{exact:true}).waitFor()
 assert.ok((await employeeModal.boundingBox()).width<=390,'the single sheet fits a mobile screen')
 assert.ok(await employeeModal.evaluate(dialog=>dialog.scrollWidth<=dialog.clientWidth+1),'the mobile form does not require horizontal scrolling')
 assert.equal(await employeeForm.getByRole('radio',{name:'보상휴가 부여'}).isDisabled(),false)
 assert.equal(await employeeForm.getByRole('button',{name:'제출',exact:true}).isDisabled(),true)
 await page.waitForFunction(()=>window.__reads.some(key=>key.includes('confirmation-request')))
 await employeeModal.getByRole('button',{name:'닫기',exact:true}).click()
 await confirmationButton.waitFor()
 await page.setViewportSize({width:1450,height:1100})
 await confirmationButton.click()
 await employeeForm.getByRole('radio',{name:'가산임금 지급'}).check()
 assert.equal(Math.round((await employeeModal.boundingBox()).width),794)
 await employeeModal.screenshot({path:path.join(dir,'employee-holiday-confirmation.png')})
 await page.evaluate(()=>window.__failAction='confirmation-respond')
 await employeeForm.getByRole('button',{name:'제출',exact:true}).click()
 await employeeForm.getByRole('alert').waitFor()
 assert.equal(await employeeForm.getByRole('radio',{name:'가산임금 지급'}).isChecked(),true)
 await page.evaluate(()=>window.__failAction=null)
 await employeeForm.getByRole('button',{name:'제출',exact:true}).click()
 await page.getByText('휴일근무 보상 확인서를 제출했습니다.',{exact:true}).waitFor()
 assert.equal(await employeeModal.count(),0)
 assert.equal(await confirmationButton.count(),0)
 await page.evaluate(async()=>{window.__setRole('ops');window.__navigate('/operations-support?part=attendance&attendanceView=holiday&holidayMonth=2026-11');await window.__refresh()})
 await page.getByRole('button',{name:/보상 확인서 제출/}).click()
 await certificate.getByRole('button',{name:'확인서 출력'}).click()
 const printFrame=certificate.frameLocator('iframe')
 await printFrame.getByRole('heading',{name:'주말·휴일근로 보상방법 선택 및 확인서',exact:true}).waitFor()
 assert.equal(await printFrame.getByText(/☑ 가산임금 지급/).count(),2)
 assert.equal(await printFrame.getByText('(서명)',{exact:true}).count(),2)
 const printPage=await browser.newPage()
 try{
   await printPage.setContent(await certificate.locator('iframe').getAttribute('srcdoc'))
   const pdf=await printPage.pdf({path:path.join(dir,'holiday-confirmation.pdf'),preferCSSPageSize:true})
   assert.equal([...pdf.toString('latin1').matchAll(/\/Type\s*\/Page\b/g)].length,2,'confirmation prints as two A4 pages')
 }finally{await printPage.close()}
 await certificate.locator('iframe').evaluate(frame=>{frame.contentWindow.print=()=>{document.body.dataset.printedConfirmation='true'}})
 await certificate.getByRole('button',{name:'인쇄',exact:true}).click()
 assert.equal(await page.locator('body').getAttribute('data-printed-confirmation'),'true')
 await certificate.getByRole('button',{name:'미리보기 닫기',exact:true}).click()
 assert.equal(await page.getByRole('button',{name:'정산 확정',exact:true}).count(),0)
 await certificate.getByLabel('서명본',{exact:true}).setInputFiles({name:'signed.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 fixture')})
 await certificate.getByLabel('직원과 회사의 서명 및 선택 내용을 확인했습니다.').check()
 await page.evaluate(()=>window.__failAction='confirmation-file')
 await certificate.getByRole('button',{name:'서명본 등록',exact:true}).click()
 await certificate.getByRole('alert').waitFor()
 assert.equal(await page.getByRole('button',{name:'정산 확정',exact:true}).count(),0)
 await page.evaluate(()=>window.__failAction=null)
 await certificate.getByRole('button',{name:'서명본 등록',exact:true}).click()
 await certificate.getByRole('button',{name:'서명본 받기',exact:true}).waitFor()
 assert.equal(await page.evaluate(()=>window.__uploads.length),1,'retry attaches the uploaded file without uploading it again')
 await page.getByRole('button',{name:'정산 확정',exact:true}).click()
 assert.equal(await settle.getByLabel('휴일 근무 보상 방식').count(),0,'employee choice is fixed')
 await settle.getByLabel('휴일 근무 통상시급').fill('10000')
 await settle.getByLabel('휴일 수당 지급 예정 월').fill('2026-11')
 await settle.getByLabel('휴일 보상 확정 사유').fill('첨부 서명본 확인 후 지급')
 await settle.getByLabel('근무 확인 내역·가산 기준·중복 지급 여부를 확인했습니다.').check()
 await settle.getByRole('button',{name:'정산 확정',exact:true}).click()
 await certificate.getByText(/정산 확정/).waitFor()
 assert.equal(await page.evaluate(()=>window.__rows[0].remainingUnits),0)
 for(const choice of ['leave','cash']){
   await page.evaluate(async()=>{
     window.__writes=[];window.__events=[];window.__confirmedSettlement=true;window.__policy=null;
     const row=window.__rows[0];window.__rows=[{...row,confirmation:undefined,state:'approved',remainingUnits:1440,settlements:[]}];
     window.__navigate('/operations-support?part=attendance&attendanceView=holiday&holidayMonth=2026-11&offsiteCase=weekend-trip');
     await window.__refresh()
   })
   const weekendCertificate=modal.getByRole('region',{name:'주말·휴일근로 보상방법 확인서',exact:true})
   await weekendCertificate.getByText('가산임금 지급 또는 보상휴가 부여',{exact:true}).waitFor()
   await modal.getByRole('button',{name:'휴가로 지급',exact:true}).waitFor({state:'detached'})
   await weekendCertificate.getByRole('button',{name:'직원에게 확인 요청'}).click()
   await weekendCertificate.getByText('직원 제출 대기',{exact:true}).waitFor()
   assert.equal(await page.evaluate(()=>window.__writes.find(w=>w.a==='confirmation-request').p.leaveAuthorized),undefined)
   await modal.getByRole('button',{name:'닫기',exact:true}).click()
   const waitingRow = page.getByRole('row').filter({ hasText: '직원 제출 대기' })
   await waitingRow.getByRole('button',{name:'제출 상태',exact:true}).click()
   await certificate.getByText('직원 제출 대기',{exact:true}).waitFor()
   assert.equal(await certificate.getByRole('button',{name:'보상휴가 부여',exact:true}).count(),0)
   assert.equal(await certificate.getByRole('button',{name:'직원에게 확인 요청',exact:true}).count(),0)
   await page.getByRole('button',{name:'상세 닫기',exact:true}).click()
   await page.evaluate(()=>{window.__setRole('staff');window.__navigate('/settings/profile?part=my-attendance')})
   await confirmationButton.click()
   const selected=employeeForm.getByRole('radio',{name:choice==='leave'?'보상휴가 부여':'가산임금 지급',exact:true})
   assert.equal(await selected.isEnabled(),true)
   await selected.check()
   await employeeForm.getByRole('button',{name:'제출',exact:true}).click()
   await page.getByText('휴일근무 보상 확인서를 제출했습니다.',{exact:true}).waitFor()
   await page.evaluate(async()=>{window.__setRole('ops');window.__navigate('/operations-support?part=attendance&attendanceView=holiday&holidayMonth=2026-11');await window.__refresh()})
   const submittedRow = page.getByRole('row').filter({ hasText: choice==='leave'?'보상휴가 부여 대기':'야근 누적 반영 대기' })
   const processButton = submittedRow.getByRole('button',{name:choice==='leave'?'보상휴가 처리':'근무시간 처리',exact:true})
   await processButton.waitFor()
   if(choice==='leave') await processButton.click()
   else await page.getByRole('button',{name:/보상 확인서 제출/}).click()
   const finalize=certificate.getByRole('button',{name:choice==='leave'?'보상휴가 부여':'야근 누적 반영',exact:true})
   await finalize.waitFor()
   assert.equal(await certificate.getByRole('button',{name:'확인서 출력'}).count(),0)
   assert.equal(await certificate.locator('input[type=file]').count(),0)
   if(choice==='leave'){
     await certificate.getByLabel('보상휴가 지급 일수').fill('1')
     await certificate.getByLabel('사용기한').fill('2027-12-31')
   }else{
     assert.equal(await certificate.getByLabel('실제 근무시간 (시:분)').inputValue(),'8:00')
     await certificate.getByLabel('실제 근무시간 (시:분)').fill('4:30')
   }
   assert.equal(await finalize.isDisabled(),true)
   await certificate.getByLabel('직원이 제출한 보상방법을 확인했습니다.').check()
   await finalize.click()
   await page.getByLabel('주말·공휴일 근무 상세').getByText(choice==='leave'?'보상휴가 1일 · 2027-12-31까지':'야근 누적 반영 4시간 30분',{exact:true}).waitFor()
   assert.equal(await page.evaluate(()=>window.__writes.filter(w=>w.a==='settle-confirmed').length),1)
 }
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log('holiday-work browser: existing workflow, mixed trips, compensation notification, choice, legacy print/upload, both unsigned outcomes, confirmation checkbox, and settlement passed')
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}
