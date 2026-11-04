import assert from 'node:assert/strict'
import path from 'node:path'
import {mkdir,writeFile} from 'node:fs/promises'
import {createServer} from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import {chromium} from 'playwright-core'
import {build} from 'esbuild'
import {pathToFileURL} from 'node:url'
const root=process.cwd(),temp=path.join(root,'node_modules/.tmp/onboarding-browser'),company='e0000000-0000-4000-8000-000000000001',staff='10000000-0000-4000-8000-000000000002',ops='10000000-0000-4000-8000-000000000001',dev='d0000000-0000-4000-8000-000000000001'
await mkdir(temp,{recursive:true})
await build({entryPoints:['src/features/org/company-information-values.ts'],bundle:true,platform:'node',format:'esm',outfile:path.join(temp,'wages.mjs')})
const {calculateCompanyWage,calculateCompanyPeriods}=await import(pathToFileURL(path.join(temp,'wages.mjs')).href)
const records=new Map([['case-employee',{id:'case-employee',profileId:staff,isTest:false,version:0,submittedAt:null,completedAt:null,personal:{},company:null,rosterStamp:'original',files:[]}]]),pendingFiles=new Map(),writes=[]
let sequence=0,failUpload=false
const summary=c=>({...c,displayName:c.isTest?'개발자 · 테스트':'검증 직원',email:'staff@example.invalid',status:'active',requestedAt:'2026-11-03',departmentId:null,position:null,jobGrade:null,hireDate:null,employeeFiles:c.files.filter(f=>!['contract','privacyConsent','biometricConsent'].includes(f.kind)).length,signedFiles:c.files.filter(f=>['contract','privacyConsent','biometricConsent'].includes(f.kind)).length,companySaved:Boolean(c.company)})
const authFixture=`import {useSyncExternalStore} from 'react';let mode=new URLSearchParams(location.search).get('actor')||'staff';const listeners=new Set();window.setOnboardingActor=value=>{mode=value;listeners.forEach(fn=>fn())};export function useAuth(){const current=useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>mode);window.fixtureActor=current;const id=current==='ops'?'${ops}':current==='dev'?'${dev}':current==='other'?'other-user':'${staff}';return {profile:{id,status:'active',companyId:'${company}',departmentId:current==='ops'?'2e49ef43-75b9-4c89-b42d-9fd50ad9087b':null,displayName:current==='ops'?'검증 관리자':'검증 직원',email:'staff@example.invalid'},session:{user:{id}}}}`
const clientFixture=`const call=async(name,args)=>{const response=await fetch('/fixture-api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,args,actor:window.fixtureActor})});return response.json()};export function getSupabase(){return {rpc:(name,args={})=>call(name,args),storage:{from:()=>({upload:async(path,file,options)=>call('upload',{path,name:file.name,size:file.size,mime:options.contentType}),download:async()=>({data:new Blob(['fixture']),error:null})})}}}`
const choicesFixture=`export async function listRosterChoiceSettings(){return {ready:true,settings:Object.entries({workDays:['주5일(월~금)'],workHours:['09:00 ~ 18:00'],breakTime:['13:00 ~ 14:00'],payBasis:['월급x12개월'],employmentType:['정규직'],workplace:['서울']}).map(([key,options])=>({key,options,revision:1}))}}`
await writeFile(path.join(temp,'entry.tsx'),`import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{RequiredInformationButton}from'@/features/settings/RequiredInformationButton';import{NewEmployeesPanel}from'@/features/org/NewEmployeesPanel';import'@/index.css';const client=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><main className="space-y-5 p-4"><RequiredInformationButton/><NewEmployeesPanel departments={[{id:'dept',name:'검증 부서'}]} duties={['담당']} grades={['사원']} canApprove={false} canAssign={true}/></main></QueryClientProvider>);`)
const fixtures=new Map([['@/lib/supabase/auth',authFixture],['@/lib/supabase/client',clientFixture],['@/lib/supabase/roster-choices',choicesFixture],['@/lib/supabase/onboarding-company-information',`export async function loadOnboardingCompanyInformation(){return null}`],['@/lib/supabase/profiles',`export async function listManageableProfiles(){return []};export async function approveMember(){throw Error('Unexpected approval')};export async function rejectMember(){throw Error('Unexpected rejection')}`]])
const server=await createServer({root,configFile:false,envDir:false,logLevel:'error',cacheDir:path.join(temp,'cache'),plugins:[{name:'onboarding-fixture',enforce:'pre',resolveId(source,importer){const resolved=importer&&source.startsWith('.')?path.resolve(path.dirname(importer.split('?')[0]),source).replace(/\\/g,'/').replace(/\.tsx?$/,''):'';const normalized=source.replace(/\\/g,'/').replace(/\.tsx?$/,'');for(const key of fixtures.keys())if(normalized===key||normalized===path.join(root,'src',key.slice(2)).replace(/\\/g,'/')||resolved===path.join(root,'src',key.slice(2)).replace(/\\/g,'/'))return '\0'+key},load(id){if(id.startsWith('\0'))return fixtures.get(id.slice(1))},configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
 if(req.url==='/fixture-api'){
  let body='';for await(const chunk of req)body+=chunk;const {name,args:p={},actor}=JSON.parse(body);let data=null,error=null
  try{
   if(name==='get_my_employee_onboarding_status')data=actor==='staff'?{id:'case-employee',submittedAt:records.get('case-employee').submittedAt,completedAt:records.get('case-employee').completedAt}:null
   else if(name==='list_employee_onboardings')data=[...records.values()].map(summary)
   else if(name==='get_employee_onboarding'){data=structuredClone(records.get(p.p_case));if(actor==='staff')data.company=null}
   else if(name==='start_employee_onboarding_test'){data='case-test';if(!records.has(data))records.set(data,{...records.get('case-employee'),id:data,profileId:dev,isTest:true,personal:{},company:null,files:[],version:0,submittedAt:null,completedAt:null})}
   else if(name==='save_employee_onboarding'){const c=records.get(p.p_case);assert.equal(c.version,p.p_version);if(p.p_section==='company')c.company=calculateCompanyWage(calculateCompanyPeriods(p.p_data)).value;else c.personal=p.p_data;if(p.p_section==='submit')c.submittedAt=new Date().toISOString();c.version++;data=c;writes.push(p.p_section)}
   else if(name==='begin_employee_onboarding_file'){data={id:'file-'+(++sequence),path:'fixture/'+sequence};pendingFiles.set(data.id,{...p,...data})}
   else if(name==='upload'){if(failUpload){failUpload=false;error={code:'test',message:'upload failed'}}}
   else if(name==='finish_employee_onboarding_file'){const f=pendingFiles.get(p.p_file),c=records.get(f.p_case);c.files=c.files.filter(old=>old.kind!==f.p_kind);c.files.push({id:f.id,kind:f.p_kind,name:f.p_name,size:f.p_size});data=c}
   else if(name==='remove_employee_onboarding_file'){for(const c of records.values())if(c.files.some(f=>f.id===p.p_file)){c.files=c.files.filter(f=>f.id!==p.p_file);data=c}}
   else if(name==='set_employee_onboarding_complete'){const c=records.get(p.p_case);assert.equal(c.version,p.p_version);c.completedAt=p.p_complete?new Date().toISOString():null;c.version++;data=c}
   else if(name==='get_employee_onboarding_file_path')data='fixture/download'
   else throw Error('Unexpected mock call '+name)
  }catch(e){error={code:'P0001',message:e.message}}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data,error}));return
 }
 if(!req.headers.accept?.includes('text/html'))return next();res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml(req.url,'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/node_modules/.tmp/onboarding-browser/entry.tsx"></script></body></html>'))
})}},react(),tailwindcss()],resolve:{alias:{'@':path.join(root,'src')}},server:{host:'127.0.0.1',port:5296,strictPort:true,hmr:false}})
let browser
try{
 await server.listen();const origin='http://127.0.0.1:5296';browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
 const context=await browser.newContext(),page=await context.newPage(),remote=[],errors=[];page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message))
 await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():(remote.push(route.request().url()),route.abort()))
 await page.goto(origin+'/?actor=staff',{timeout:90000});console.log('fixture loaded');const required=page.getByRole('dialog',{name:'필수정보 입력',exact:true})
 const initialManager=await context.newPage();await initialManager.goto(origin+'/?actor=ops',{timeout:90000})
 const emptyRow=initialManager.getByRole('row').filter({hasText:'검증 직원'}),emptyCase=records.get('case-employee')
 await emptyRow.getByRole('button',{name:'완료',exact:true}).click();const confirmation=initialManager.getByRole('dialog',{name:'검증 직원 · 완료 처리',exact:true})
 assert.match(await confirmation.innerText(),/정말 완료 처리하시겠습니까/);assert.equal(emptyCase.completedAt,null)
 await confirmation.getByRole('button',{name:'닫기',exact:true}).click();assert.equal(emptyCase.completedAt,null,'취소하면 완료하지 않음')
 await emptyRow.getByRole('button',{name:'완료',exact:true}).click();await confirmation.getByRole('button',{name:'확인하고 완료',exact:true}).click();await confirmation.waitFor({state:'detached'})
 assert.ok(emptyCase.completedAt);assert.deepEqual(emptyCase.personal,{});assert.equal(emptyCase.company,null);assert.deepEqual(emptyCase.files,[])
 await page.getByRole('button',{name:'필수정보 입력',exact:true}).click()
 await page.waitForFunction(()=>![...document.querySelectorAll('button')].some(button=>button.textContent==='필수정보 입력'))
 assert.equal(await required.count(),0,'다른 화면에서 완료했다면 오래 열린 버튼을 눌러도 입력창을 열지 않음')
 await page.reload({waitUntil:'networkidle'});assert.equal(await page.getByRole('button',{name:/^(필수정보 입력|제출 정보 확인)$/}).count(),0,'미입력 상태로 완료해도 직원 버튼 숨김')
 await initialManager.getByRole('button',{name:'완료 목록',exact:true}).click();await emptyRow.getByRole('button',{name:'진행 중으로 되돌리기',exact:true}).click();await confirmation.getByRole('button',{name:'진행 중으로 되돌리기',exact:true}).click();await confirmation.waitFor({state:'detached'})
 await page.reload({waitUntil:'networkidle'});assert.equal(await page.getByRole('button',{name:'필수정보 입력',exact:true}).count(),1,'되돌리면 직원 입력 버튼 다시 표시')
 await initialManager.close()
 await page.getByRole('button',{name:'필수정보 입력',exact:true}).click();await required.getByLabel('영문명 *',{exact:true}).fill('TEST STAFF');await required.getByRole('button',{name:'임시 저장',exact:true}).click();await required.getByRole('status').filter({hasText:'임시 저장했습니다.'}).waitFor()
 await required.getByRole('button',{name:'닫기',exact:true}).click();await page.reload();await page.getByRole('button',{name:'필수정보 입력',exact:true}).click();assert.equal(await required.getByLabel('영문명 *',{exact:true}).inputValue(),'TEST STAFF')
 for(const [label,value] of [['주민등록번호 앞 6자리','940102'],['주민등록번호 뒤 7자리','1000000'],['연락처 *','01012345678'],['G메일 *','test.staff@gmail.com'],['네이버메일 *','test.staff@naver.com'],['현 거주지 *','검증 주소'],['계좌번호 *','123456']])await required.getByLabel(label,{exact:true}).fill(value)
 assert.equal(await required.getByLabel('연락처 *',{exact:true}).inputValue(),'010-1234-5678');assert.equal(await required.getByLabel('G메일 *',{exact:true}).inputValue(),'test.staff')
 await required.getByRole('combobox',{name:'은행',exact:true}).selectOption('KB국민은행')
 async function file(dialog,label,name='proof.pdf'){await dialog.getByLabel(label+' 업로드',{exact:true}).setInputFiles({name,mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7\nfixture')});await dialog.getByText(name,{exact:true}).waitFor()}
 for(const label of ['신분증 사본','통장 사본','학력 증명서','주민등록등본','사업자등록증 사실 증명서']){await required.getByLabel(label+' 업로드',{exact:true}).setInputFiles({name:label+'.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7\nfixture')});await required.getByText(label+'.pdf',{exact:true}).waitFor()}
 await required.getByRole('checkbox').check();await required.getByRole('button',{name:'입력 내용 확인',exact:true}).click();assert.ok(!(await required.getByRole('region',{name:'입력 내용 확인'}).innerText()).includes('940102-1000000'));await required.getByRole('button',{name:'제출하기',exact:true}).click();await required.waitFor({state:'detached'});assert.ok(records.get('case-employee').submittedAt)
 const manager=await context.newPage();manager.setDefaultTimeout(30000);manager.on('pageerror',e=>errors.push(e.message));await manager.goto(origin+'/?actor=ops',{timeout:90000})
 const row=manager.getByRole('row').filter({hasText:'검증 직원'});await row.getByRole('button',{name:'회사정보 입력',exact:true}).click();const companyDialog=manager.getByRole('dialog',{name:'검증 직원 · 회사 입력정보',exact:true})
 await companyDialog.getByLabel('부서',{exact:true}).selectOption('dept');await companyDialog.getByLabel('직급',{exact:true}).selectOption('사원');await companyDialog.getByLabel('입사일',{exact:true}).fill('2026-11-03');await companyDialog.getByLabel('근로계약서 작성일',{exact:true}).fill('2026-11-03')
 for(const [label,value] of [['연봉기준 목록','월급x12개월'],['근로일 목록','주5일(월~금)'],['근로시간 목록','09:00 ~ 18:00'],['휴게시간 목록','13:00 ~ 14:00']])await companyDialog.getByLabel(label,{exact:true}).selectOption(value)
 await companyDialog.getByLabel('연봉',{exact:true}).fill('30000000');await companyDialog.getByLabel('식대',{exact:true}).fill('200000');assert.equal(await companyDialog.getByLabel('근로유형',{exact:true}).inputValue(),'유형 1 · 주 2.5시간')
 await companyDialog.getByRole('button',{name:'회사정보 저장',exact:true}).click();await companyDialog.waitFor({state:'detached'});await manager.reload();await row.getByRole('button',{name:'필수서류 보기',exact:true}).click();const docs=manager.getByRole('dialog',{name:'검증 직원 · 필수서류',exact:true})
 await docs.getByRole('button',{name:'근로계약서 미리보기',exact:true}).click();const preview=manager.getByRole('dialog',{name:'근로계약서 미리보기',exact:true}),paper=manager.frameLocator('iframe[title="근로계약서 양식"]');assert.equal(await paper.locator('[data-field="annualSalary"]').innerText(),'금 30,000,000원');assert.equal(await paper.locator('[data-field="employeeName"]').innerText(),'검증 직원');assert.equal(await paper.locator('[data-field="basePay"]').innerText(),'금 2,119,130원');assert.ok((await paper.locator('[data-signature]').allTextContents()).every(t=>!t.trim()));await preview.getByRole('button',{name:'닫기',exact:true}).click()
 for(const label of ['근로계약서','개인정보 수집 동의서','생체인식정보 동의서'])await file(docs,label,label+'.pdf')
 failUpload=true;await docs.getByLabel('신분증 사본 업로드',{exact:true}).setInputFiles({name:'replacement.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7\nfixture')});await docs.getByRole('alert').waitFor();assert.equal(records.get('case-employee').files.find(f=>f.kind==='identity').name,'신분증 사본.pdf')
 await docs.getByRole('button',{name:'닫기',exact:true}).click();await row.getByRole('button',{name:'완료',exact:true}).click();let complete=manager.getByRole('dialog',{name:'검증 직원 · 완료 처리',exact:true});await complete.getByRole('button',{name:'확인하고 완료',exact:true}).click();await complete.waitFor({state:'detached'});assert.equal(await row.count(),0)
 await page.reload({waitUntil:'networkidle'});assert.equal(await page.getByRole('button',{name:/^(필수정보 입력|제출 정보 확인)$/}).count(),0,'제출 후 완료한 경우에도 버튼 숨김')
 await manager.getByRole('button',{name:'완료 목록',exact:true}).click();await row.waitFor();await row.getByRole('button',{name:'진행 중으로 되돌리기',exact:true}).click();await complete.getByRole('button',{name:'진행 중으로 되돌리기',exact:true}).click();await complete.waitFor({state:'detached'});await manager.getByRole('button',{name:'진행 중',exact:true}).click();await row.waitFor()
 await manager.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='진행 중'&&b.className.includes('bg-primary')));await manager.screenshot({path:path.join(temp,'manager-desktop.png')});await manager.setViewportSize({width:390,height:844});await manager.screenshot({path:path.join(temp,'manager-mobile.png')});assert.ok(await manager.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
 await manager.evaluate(()=>window.setOnboardingActor('other'));assert.equal(await manager.getByRole('button',{name:'회사정보 입력',exact:true}).count(),0);assert.equal(await manager.locator('input[name="residentBack"]').count(),0)
 await page.goto(origin+'/?actor=dev');await page.getByRole('button',{name:'필수정보 입력',exact:true}).click();assert.match(await page.getByRole('dialog').innerText(),/실제 개발자 계정의 정보/)
 await page.getByRole('button',{name:'필수정보 입력 닫기',exact:true}).click()
 const developerRow=page.getByRole('row').filter({hasText:'개발자 · 테스트'})
 await developerRow.getByRole('button',{name:'완료',exact:true}).click();const developerComplete=page.getByRole('dialog',{name:'개발자 · 테스트 · 완료 처리',exact:true})
 await developerComplete.getByRole('button',{name:'확인하고 완료',exact:true}).click();await developerComplete.waitFor({state:'detached'});await page.getByRole('button',{name:'필수정보 입력',exact:true}).waitFor({state:'hidden'});assert.equal(await page.getByRole('button',{name:'필수정보 입력',exact:true}).count(),0,'개발자 테스트도 완료 후 상태 갱신으로 숨김')
 await page.reload({waitUntil:'networkidle'});assert.equal(await page.getByRole('button',{name:'필수정보 입력',exact:true}).count(),0,'새로고침해도 개발자 완료 상태 유지')
 await page.getByRole('button',{name:'완료 목록',exact:true}).click();await developerRow.getByRole('button',{name:'진행 중으로 되돌리기',exact:true}).click();await developerComplete.getByRole('button',{name:'진행 중으로 되돌리기',exact:true}).click();await developerComplete.waitFor({state:'detached'});await page.getByRole('button',{name:'필수정보 입력',exact:true}).waitFor({state:'visible'});assert.equal(await page.getByRole('button',{name:'필수정보 입력',exact:true}).count(),1)
 assert.deepEqual(remote,[]);assert.deepEqual(errors,[]);assert.ok(writes.includes('draft')&&writes.includes('submit')&&writes.includes('company'))
 console.log('PASS empty-case completion/confirmation cancel, staff/developer button hide/reopen/reload/stale open, two browser screens, draft, uploads, submit, payroll, A4, failure preservation, PC/mobile and actor switch; all requests stayed in fixture server')
}catch(error){console.error(error);throw error}finally{await browser?.close();await server.close()}
