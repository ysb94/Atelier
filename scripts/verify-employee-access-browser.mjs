import assert from 'node:assert/strict'
import path from 'node:path'
import {mkdir,writeFile} from 'node:fs/promises'
import {createServer} from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import {chromium} from 'playwright-core'
import {createServer as createNetServer} from 'node:net'

const root=process.cwd(),temp=path.join(root,'.tmp/employee-access-browser')
await mkdir(temp,{recursive:true})
const company='e0000000-0000-4000-8000-000000000001',ops='2e49ef43-75b9-4c89-b42d-9fd50ad9087b',design='7ac8b7a8-7f12-4f3e-a371-d2dac7e492f1',logistics='c5d4cfca-97ce-4ca7-b30a-6beed842cf1e',china='bf926822-910c-422f-9c17-5fd3d8ddb3ba'
const departments=[{id:ops,name:'운영지원팀'},{id:design,name:'디자인팀'},{id:logistics,name:'물류팀'},{id:china,name:'중국팀'}].map(row=>({...row,company_id:company,is_active:true,personnel_scope:'leaders',sort_order:0}))
const raw=(id,name,status='pending',department=null,requested=true)=>({id,email:id+'@example.invalid',display_name:name,status,department_id:department,company_id:company,position:null,job_grade:null,hire_date:null,is_admin:false,requested_at:requested?'2026-11-05T01:00:00Z':null,approved_by:null,approved_at:status==='disabled'?'2026-10-01T00:00:00Z':null,name_confirmed_at:null,avatar_url:null,request_note:null,created_at:'2026-11-05T00:00:00Z',updated_at:'2026-11-05T00:00:00Z'})
const profiles=[raw('pending-one','검증 대기 하나'),raw('pending-raw','', 'pending',china,false),raw('pending-reject','검증 거절 대상'),raw('existing-disabled','보존 계정','disabled'),raw('existing-active','기존 계정','active')]
const cases=new Map()
function enroll(id,companyInfo=null){const row={id:'case-'+id,profileId:id,isTest:false,version:0,submittedAt:null,completedAt:null,personal:{},company:companyInfo,rosterStamp:'fixture',files:[]};cases.set(id,row);return row}
enroll('pending-one',{departmentId:design,position:'',jobGrade:'',hireDate:'2023-01-01',annualSalary:'45000000',wageMode:'manual',periodMode:'manual'})
enroll('pending-reject')
const summary=record=>{const p=profiles.find(row=>row.id===record.profileId);return {...record,displayName:p.display_name||p.email,email:p.email,status:p.status,requestedAt:p.requested_at,departmentId:p.department_id,position:p.position,jobGrade:p.job_grade,hireDate:p.hire_date,companySaved:Boolean(record.company),employeeFiles:0,signedFiles:0}}
let serverReady=true,failDecision=false,failRefresh=false,refreshFailureArmed=false,staleDecision=false
const attempts=[],decisions=[],patches=[],requests=[]
const auth=String.raw`import {useSyncExternalStore} from 'react';
let mode='ops';const listeners=new Set();window.setAccessActor=value=>{mode=value;listeners.forEach(fn=>fn())};
export const getFixtureUserId=()=>mode==='mismatch'?'session-other':mode==='opsB'?'operator-b':mode==='regular'?'ordinary':mode==='foreign'?'foreign':'operator-a';
export function useAuth(){useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>mode);window.fixtureActor=mode;const id=mode==='mismatch'?'operator-a':getFixtureUserId();return {profile:{id,status:mode==='inactive'?'disabled':'active',companyId:mode==='foreign'?'other-company':'${company}',departmentId:['regular','reviewer'].includes(mode)?'${design}':'${ops}',displayName:'검증 운영지원',email:mode==='preview'?'ui-preview@example.invalid':'operator@example.invalid',isAdmin:false,capabilities:[],memberships:[],permissionGrants:(mode==='reviewer'?['personnel.manage']:['manager','preview'].includes(mode)?['personnel.manage','org.manage']:[]).map(permission=>({permission,scopeKind:'company',scopeId:'${company}'}))},session:{user:{id:getFixtureUserId()}}}}`
const client=String.raw`import {createClient} from '@supabase/supabase-js';import {getFixtureUserId} from './auth';
const client=createClient(location.origin+'/fixture-supabase','fixture-key',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(url,options)=>{const headers=new Headers(options?.headers);headers.set('x-fixture-actor',window.fixtureActor||'ops');return fetch(url,{...options,headers})}}});
client.auth.getUser=async()=>({data:{user:{id:getFixtureUserId()}},error:null});export const getSupabase=()=>client;`
const entry=String.raw`import {useState} from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter,Routes,Route,Link} from 'react-router-dom';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {WorkspaceTabActivityContext} from '@/components/layout/workspace-tab-activity';import {OrgChartPage} from '@/features/org/OrgChartPage';import {NewEmployeesPanel} from '@/features/org/NewEmployeesPanel';import {MembersPage} from '@/features/settings/MembersPage';import '@/index.css';
const query=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});function Fixture(){const [active,setActive]=useState(true);window.setAccessActivity=setActive;return <WorkspaceTabActivityContext.Provider value={active}><QueryClientProvider client={query}><BrowserRouter><Routes><Route path='/members' element={<MembersPage/>}/><Route path='/operations-support' element={<OrgChartPage mode='manage'/>}/><Route path='/new-only' element={<NewEmployeesPanel departments={${JSON.stringify(departments)}} duties={['사원']} grades={['대리']}/>}/><Route path='*' element={<Link to='/operations-support?part=org&orgView=new'>신규직원 이동</Link>}/></Routes></BrowserRouter></QueryClientProvider></WorkspaceTabActivityContext.Provider>};createRoot(document.getElementById('root')).render(<Fixture/>);`
for(const [name,content] of Object.entries({'auth.tsx':auth,'client.ts':client,'entry.tsx':entry}))await writeFile(path.join(temp,name),content)
const portProbe=createNetServer();await new Promise(resolve=>portProbe.listen(0,'127.0.0.1',resolve));const port=portProbe.address().port;await new Promise(resolve=>portProbe.close(resolve))
const server=await createServer({root,configFile:false,envFile:false,logLevel:'error',cacheDir:path.join(temp,'vite-cache'),optimizeDeps:{entries:[path.join(temp,'entry.tsx')]},plugins:[{name:'access-fixture',enforce:'pre',resolveId(source,importer){if(importer&&source.startsWith('.')){const target=path.resolve(path.dirname(importer),source).replace(/\.tsx?$/,'');if(target===path.join(root,'src/lib/supabase/auth'))return path.join(temp,'auth.tsx');if(target===path.join(root,'src/lib/supabase/client'))return path.join(temp,'client.ts')}},configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
 if(!req.url.startsWith('/fixture-supabase/')){if(!req.headers.accept?.includes('text/html'))return next();const html=await vite.transformIndexHtml(req.url,'<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/.tmp/employee-access-browser/entry.tsx"></script></body></html>');res.setHeader('Content-Type','text/html');res.end(html);return}
 const url=new URL(req.url,'http://fixture'),endpoint=url.pathname.split('/rest/v1/')[1],actor=req.headers['x-fixture-actor']||'ops';let text='';for await(const chunk of req)text+=chunk;const body=text?JSON.parse(text):{};requests.push({endpoint,method:req.method,actor})
 const send=(data,status=200)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data))},deny=(code,message,status=400)=>send({code,message,details:null,hint:null},status)
 if(endpoint?.startsWith('rpc/')){
  const name=endpoint.slice(4),allowed=['ops','opsB','manager'].includes(actor)
  if(name==='review_employee_access'){
   if(!serverReady)return deny('PGRST202','function unavailable',404)
   if(body.p_decision==='check')return send({ready:true,canReview:allowed||actor==='reviewer'})
   attempts.push({...body});if(!allowed&&actor!=='reviewer')return deny('42501','가입 승인 권한이 없습니다.',403)
   const p=profiles.find(row=>row.id===body.p_profile)
   if(staleDecision){staleDecision=false;p.status='active';enroll(p.id)}
   if(!p||p.status!=='pending')return deny('40001','다른 담당자가 이미 처리했습니다. 목록을 새로고침해 주세요.')
   if(failDecision){failDecision=false;return deny('P0001','검증용 저장 실패')}
   await new Promise(resolve=>setTimeout(resolve,100))
   if(body.p_decision==='approve'){Object.assign(p,{status:'active',display_name:body.p_display_name,department_id:body.p_department,position:body.p_position,job_grade:body.p_job_grade,hire_date:body.p_hire_date});const c=cases.get(p.id)||enroll(p.id);if(c.company)Object.assign(c.company,{departmentId:p.department_id,hireDate:p.hire_date})}
   else p.status='rejected'
   decisions.push({...body});if(failRefresh){failRefresh=false;refreshFailureArmed=true}return send({status:p.status})
  }
  if(name==='list_employee_onboardings'){if(!allowed)return deny('42501','권한 없음',403);if(refreshFailureArmed){refreshFailureArmed=false;return deny('57014','검증용 조회 실패',500)}return send([...cases.values()].filter(c=>['pending','active'].includes(profiles.find(p=>p.id===c.profileId).status)).map(summary))}
  if(name==='get_employee_onboarding')return send([...cases.values()].find(c=>c.id===body.p_case))
  if(name==='set_employee_onboarding_complete'){const c=[...cases.values()].find(c=>c.id===body.p_case);c.completedAt=body.p_complete?'2026-11-05T02:00:00Z':null;c.version++;return send(c)}
  if(name==='get_my_basic_work_access')return send({companyId:company,profileId:'operator-a',domains:['operations']})
  if(name==='list_org_chart_members')return send([])
  return send([])
 }
 let rows=endpoint==='profiles'?profiles:endpoint==='departments'?departments:[]
 for(const [key,filter] of url.searchParams){if(filter.startsWith('eq.'))rows=rows.filter(row=>String(row[key])===filter.slice(3));if(filter.startsWith('in.('))rows=rows.filter(row=>filter.slice(4,-1).split(',').includes(String(row[key])))}
 if(req.method==='PATCH'){patches.push({body:{...body},query:url.search});for(const p of rows)Object.assign(p,body)}
 rows=rows.map(row=>endpoint==='profiles'?{...row,departments:departments.find(d=>d.id===row.department_id)||null}:row)
 if(req.headers.accept?.includes('vnd.pgrst.object'))return rows.length===1?send(rows[0]):deny('PGRST116','No matching row',406)
 send(rows)
})}},react(),tailwindcss()],resolve:{alias:[{find:'@/lib/supabase/auth',replacement:path.join(temp,'auth.tsx')},{find:'@/lib/supabase/client',replacement:path.join(temp,'client.ts')},{find:'@',replacement:path.join(root,'src')}]},server:{host:'127.0.0.1',port,strictPort:true,hmr:false,watch:{ignored:['**/.tmp/**','**/docs/**']},fs:{allow:[root]}}})
let browser
try{
 await server.listen();const origin='http://127.0.0.1:'+server.httpServer.address().port
 browser=await chromium.launch({headless:true,executablePath:process.env.ATELIER_CHROMIUM_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe'})
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],remote=[],storms=[]
 page.on('console',message=>{if(/\[(render-storm|query-storm)\]/.test(message.text()))storms.push(message.text())})
 page.on('pageerror',error=>{errors.push(error.message);console.warn('fixture page error:',error.message)});page.setDefaultTimeout(15000);await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():(remote.push(route.request().url()),route.abort()))
 const row=name=>page.getByRole('row').filter({hasText:name}),dialog=()=>page.getByRole('dialog',{name:/가입 승인 관리/})
 await page.goto(origin+'/operations-support?part=org&orgView=new',{waitUntil:'commit',timeout:30000})
 try{await row('검증 대기 하나').getByRole('button',{name:'관리',exact:true}).waitFor({state:'visible',timeout:60000})}
 catch(error){console.error('fixture startup diagnostics',{requests:requests.slice(-8),pageErrors:errors,body:(await page.locator('body').innerText()).slice(0,600)});throw error}
 await row('검증 대기 하나').getByRole('button',{name:'관리',exact:true}).click()
 await dialog().getByRole('button',{name:'승인',exact:true}).waitFor({state:'visible'})
 assert.equal(await dialog().getByLabel('팀',{exact:true}).inputValue(),design)
 assert.equal(await dialog().getByLabel('입사일',{exact:true}).inputValue(),'2023-01-01')
 await page.screenshot({path:path.join(temp,'access-dialog-desktop.png')});await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(temp,'access-dialog-mobile.png')});assert.notEqual(await dialog().evaluate(node=>getComputedStyle(node).backgroundColor),'rgba(0, 0, 0, 0)');await page.setViewportSize({width:1440,height:1000})
 await page.evaluate(()=>window.setAccessActivity(false));assert.equal(await dialog().getByRole('button',{name:'승인',exact:true}).isDisabled(),true);const beforeHidden=attempts.length;await dialog().locator('form').evaluate(form=>form.requestSubmit());assert.equal(attempts.length,beforeHidden,'숨겨진 탭에서 승인 요청하지 않음');await page.evaluate(()=>window.setAccessActivity(true))
 await dialog().getByLabel('팀',{exact:true}).selectOption(logistics);await dialog().getByLabel('입사일',{exact:true}).fill('2024-02-01')
 await dialog().getByRole('button',{name:'승인',exact:true}).dblclick();await dialog().waitFor({state:'detached'})
 assert.equal(decisions.length,1,'중복 클릭은 한 번만 저장')
 assert.match(await row('검증 대기 하나').innerText(),/승인 완료/)
 assert.equal(cases.get('pending-one').company.annualSalary,'45000000')
 await page.reload();await row('검증 대기 하나').getByRole('button',{name:'완료',exact:true}).click();await page.getByRole('button',{name:'확인하고 완료',exact:true}).click();await row('검증 대기 하나').waitFor({state:'detached'})
 await page.getByRole('button',{name:'완료 목록',exact:true}).click();await row('검증 대기 하나').waitFor({state:'visible'});await page.reload();await page.getByRole('button',{name:'완료 목록',exact:true}).click();await row('검증 대기 하나').waitFor({state:'visible'})
 await page.getByRole('button',{name:'진행 중',exact:true}).click()
 await row('pending-raw@example.invalid').getByRole('button',{name:'관리',exact:true}).click();await dialog().getByLabel('본명',{exact:true}).fill('신규 검증 직원');await dialog().getByRole('button',{name:'승인',exact:true}).click();await dialog().waitFor({state:'detached'})
 assert.match(await row('신규 검증 직원').innerText(),/승인 완료/);assert.ok(cases.has('pending-raw'),'기록 없는 가입 대기의 서류 연결')
 await row('검증 거절 대상').getByRole('button',{name:'관리',exact:true}).click();await dialog().getByRole('button',{name:'거절',exact:true}).click();await dialog().waitFor({state:'detached'})
 await page.getByRole('button',{name:'거절 목록',exact:true}).click();assert.match(await row('검증 거절 대상').innerText(),/거절/);assert.doesNotMatch(await row('검증 거절 대상').innerText(),/승인 완료/);assert.ok(cases.has('pending-reject'),'거절해도 제출 기록 유지')
 profiles.push(raw('pending-later','후속 검증'));await page.evaluate(()=>window.setAccessActor('opsB'));await row('후속 검증').getByRole('button',{name:'관리',exact:true}).click()
 failDecision=true;await dialog().getByRole('button',{name:'승인',exact:true}).click();await dialog().getByRole('alert').filter({hasText:'검증용 저장 실패'}).waitFor({state:'visible'});assert.equal(profiles.find(p=>p.id==='pending-later').status,'pending')
 await dialog().getByRole('button',{name:'닫기',exact:true}).click();serverReady=false;await row('후속 검증').getByRole('button',{name:'관리',exact:true}).click();await dialog().getByRole('status').filter({hasText:'서버 연결 대기'}).waitFor({state:'visible'});assert.equal(await dialog().getByRole('button',{name:'승인',exact:true}).isDisabled(),true)
 serverReady=true;await dialog().getByRole('button',{name:'서버 연결 다시 확인',exact:true}).click();failRefresh=true;await dialog().getByRole('button',{name:'승인',exact:true}).click();await dialog().getByRole('alert').filter({hasText:'처리는 저장됐지만'}).waitFor({state:'visible'});assert.equal(await dialog().getByRole('button',{name:'승인',exact:true}).isDisabled(),true)
 await dialog().getByRole('button',{name:'닫기',exact:true}).click();await page.getByRole('button',{name:'새로고침',exact:true}).click();await row('후속 검증').waitFor({state:'visible'})
 profiles.push(raw('pending-stale','선처리 검증'));await page.getByRole('button',{name:'새로고침',exact:true}).click();await row('선처리 검증').getByRole('button',{name:'관리',exact:true}).click();staleDecision=true;await dialog().getByRole('button',{name:'승인',exact:true}).click();await dialog().getByRole('alert').filter({hasText:'이미 처리했습니다'}).waitFor({state:'visible'});assert.equal(await dialog().getByRole('button',{name:'승인',exact:true}).isDisabled(),true);await dialog().getByRole('button',{name:'닫기',exact:true}).click()
 profiles.push(raw('pending-members-only','멤버 제외 검증'));await page.goto(origin+'/members');assert.equal(await page.getByRole('button',{name:'승인 대기',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'승인',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'거절',exact:true}).count(),0);assert.equal(await page.getByText('멤버 제외 검증',{exact:true}).count(),0)
 await page.evaluate(()=>window.setAccessActor('manager'));await page.getByText('보존 계정',{exact:true}).waitFor({state:'visible'});const account=page.getByText('보존 계정',{exact:true}).locator('xpath=../../../..');await account.getByRole('button',{name:'관리',exact:true}).click();await account.getByRole('button',{name:'저장',exact:true}).click();await account.getByRole('button',{name:'관리',exact:true}).waitFor({state:'visible'})
 assert.equal(profiles.find(p=>p.id==='existing-disabled').status,'disabled');assert.equal(profiles.find(p=>p.id==='existing-disabled').approved_at,'2026-10-01T00:00:00Z');assert.equal(patches.length,1);assert.equal('status' in patches[0].body,false);assert.equal('approved_at' in patches[0].body,false)
 await page.getByRole('link',{name:'조직도 → 신규직원',exact:true}).click();await page.getByRole('heading',{name:'신규 직원',exact:true}).waitFor({state:'visible'});assert.match(page.url(),/orgView=new/);await row('멤버 제외 검증').getByRole('button',{name:'관리',exact:true}).waitFor({state:'visible'})
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(temp,'new-employee-mobile.png')});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:path.join(temp,'new-employee-desktop.png')})
 await page.goto(origin+'/members');await page.getByText('보존 계정',{exact:true}).waitFor({state:'visible'});await page.evaluate(()=>window.setAccessActor('preview'));assert.equal(await page.getByText('보존 계정',{exact:true}).locator('xpath=../../../..').getByRole('button',{name:'관리',exact:true}).isDisabled(),true,'관리 권한이 표시된 미리보기에서도 기존 계정 변경 차단')
 await page.goto(origin+'/new-only');await row('신규 검증 직원').getByRole('button',{name:'필수정보 보기',exact:true}).click();const privateDialog=page.getByRole('dialog');await privateDialog.waitFor({state:'visible'});await page.evaluate(()=>window.setAccessActor('reviewer'));await privateDialog.waitFor({state:'detached'});assert.equal(await page.getByText('신규 검증 직원',{exact:true}).count(),0,'서류 열람 권한이 해제되면 캐시의 입사 기록과 상세도 숨김');await row('멤버 제외 검증').getByRole('button',{name:'관리',exact:true}).waitFor({state:'visible'});assert.equal(requests.filter(r=>r.actor==='reviewer'&&r.endpoint==='rpc/list_employee_onboardings').length,0)
 for(const actor of ['regular','foreign','inactive','preview','mismatch']){await page.evaluate(actor=>window.setAccessActor(actor),actor);await page.waitForTimeout(100);assert.equal(await page.getByRole('button',{name:'관리',exact:true}).count(),0);assert.equal(await page.getByRole('dialog').count(),0)}
 assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);assert.deepEqual(storms,[])
 console.log('PASS employee access browser: actual SDK, operations without grants, direct org link, missing cases/China, persistent active/completed/rejected lists, existing account preservation, duplicate/stale/failure/refresh handling, server pending, PC/mobile and actor/preview boundaries; no remote requests')
}finally{await browser?.close();await server.close()}
