import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs/promises'
import {createServer} from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import {chromium} from 'playwright-core'
import {createWorkTestDb,ids,departments} from './work-request-test-db.mjs'

const db=await createWorkTestDb(),root=process.cwd(),events=new Set(),objects=new Map()
const origin='http://127.0.0.1:5196'
let queue=Promise.resolve(),browser,server,failNextSave=false
const rpcNames=new Set(['get_my_basic_work_access','begin_work_request','save_work_request','delete_work_request','send_work_request_message','set_active_work_request','list_work_requests','begin_work_request_file','finish_work_request_file','finish_work_request_delete','save_product_draft'])
async function localApi(req,res){
 const route=req.url.split('?')[0].split('/').pop()
 if(route==='events'){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});res.write(':ready\n\n');events.add(res);req.on('close',()=>events.delete(res));return}
 let bytes='';for await(const chunk of req)bytes+=chunk
 const body=JSON.parse(bytes||'{}'),actor=req.headers['x-test-actor']
 const task=queue.then(async()=>{
  try{
   if(!Object.values(ids).includes(actor))throw Error('Invalid test actor')
   await db.exec(`reset role;select set_config('request.jwt.claim.sub','${actor}',false);set role authenticated`)
   let data
   if(route==='rpc'){
    if(body.name==='list_org_chart_members'){await db.exec('reset role');data=(await db.query("select p.id,p.display_name,p.department_id,p.position,p.job_grade,p.hire_date,d.name as department_name from public.profiles p left join public.departments d on d.id=p.department_id where p.company_id='e0000000-0000-4000-8000-000000000001' and p.status='active'")).rows}
    else {if(!rpcNames.has(body.name))throw Error('Unsupported test RPC '+body.name);if(body.name==='save_work_request'&&failNextSave){failNextSave=false;throw Error('저장 실패 재시도 검증')}const names=Object.keys(body.args);if(names.some(name=>!/^p_[a-z_]+$/.test(name)))throw Error('Invalid argument');data=(await db.query(`select public.${body.name}(${names.map((name,i)=>name+'=>$'+(i+1)).join(',')}) as data`,Object.values(body.args))).rows[0].data}
   }else if(route==='table'){
    if(!['brands','product_drafts','draft_colors','draft_options','seasons','styles'].includes(body.table))throw Error('Unsupported table '+body.table)
    if(body.table==='brands')data=[{id:'b0000000-0000-4000-8000-000000000001',slug:'atelier',name:'ATELIER',name_ko:'ATELIER',company_id:'e0000000-0000-4000-8000-000000000001'}]
    else {
     const values=[],where=[]
     for(const filter of body.filters||[]){if(!/^[a-z_]+$/.test(filter.column))throw Error('Invalid column');values.push(filter.value);where.push('t.'+filter.column+(filter.op==='in'?'=any($':'=$')+values.length+(filter.op==='in'?')':''))}
     const rows=(await db.query('select to_jsonb(t) as row from public.'+body.table+' t'+(where.length?' where '+where.join(' and '):''),values)).rows.map(r=>r.row)
     data=body.single?rows[0]??null:rows
    }
   }else if(route==='failNextSave'){failNextSave=true;data={}
   }else if(route==='upload'){
    await db.query("insert into storage.objects(bucket_id,name,metadata) values('company-work-requests',$1,$2)",[body.path,{size:body.size}]);objects.set(body.path,Buffer.from(body.bytes,'base64'));data={}
   }else if(route==='download'){
    const allowed=(await db.query("select id from storage.objects where bucket_id='company-work-requests' and name=$1",[body.path])).rows
    if(!allowed.length||!objects.has(body.path))throw Error('File permission denied');data=objects.get(body.path).toString('base64')
   }else if(route==='remove'){for(const name of body.paths){await db.query("delete from storage.objects where bucket_id='company-work-requests' and name=$1",[name]);objects.delete(name)}data={}}
   else throw Error('Unknown test route')
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data,error:null}))
   if(route==='rpc'&&!['get_my_basic_work_access','list_work_requests','list_org_chart_members'].includes(body.name))for(const stream of events)stream.write('data: changed\n\n')
  }catch(error){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:null,error:{message:error.message,code:error.code}}))}
 });queue=task.catch(()=>{});await task
}
try{
 await db.exec('reset role');for(const [name,id] of Object.entries(departments))await db.query('update public.departments set name=$2 where id=$1',[id,{planning:'기획팀',design:'Visual Team',md:'MD Team',logistics:'물류팀',china:'중국팀'}[name]])
 server=await createServer({configFile:false,envDir:false,cacheDir:path.join(root,'node_modules/.cache/work-live-vite'),logLevel:'error',plugins:[{name:'work-live-test',enforce:'pre',resolveId(source,importer){if(importer&&source.startsWith('.')){const target=path.resolve(path.dirname(importer),source).replace(/\.tsx?$/,'');if(target===path.join(root,'src/lib/supabase/auth'))return path.join(root,'dev-tools/ai-workflow/browser-fixture/work-live-auth.tsx');if(target===path.join(root,'src/lib/supabase/client'))return path.join(root,'dev-tools/ai-workflow/browser-fixture/work-live-client.ts')}},configureServer(vite){vite.middlewares.use((req,res,next)=>{if(req.url.startsWith('/__work-test/')){void localApi(req,res).catch(next);return}if(!req.headers.accept?.includes('text/html'))return next();void vite.transformIndexHtml(req.url,'<html><body><div id="root"></div><script type="module" src="/dev-tools/ai-workflow/browser-fixture/work-live-entry.tsx"></script></body></html>').then(html=>{res.setHeader('Content-Type','text/html');res.end(html)}).catch(next)})}},react(),tailwindcss()],resolve:{alias:[{find:'@/components/layout/company-brand-scope',replacement:path.join(root,'dev-tools/ai-workflow/browser-fixture/work-live-brand.ts')},{find:'@/lib/supabase/auth',replacement:path.join(root,'dev-tools/ai-workflow/browser-fixture/work-live-auth.tsx')},{find:'@/lib/supabase/client',replacement:path.join(root,'dev-tools/ai-workflow/browser-fixture/work-live-client.ts')},{find:'@',replacement:path.join(root,'src')}]},server:{host:'127.0.0.1',port:5196,strictPort:true,hmr:false}})
 await server.listen();browser=await chromium.launch({executablePath:process.env.ATELIER_CHROMIUM_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[]
 await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort())
 page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(15000)
 const managerPage=await context.newPage();managerPage.on('pageerror',error=>errors.push(error.message))
 await managerPage.goto(origin+'/work-requests/design?actor=manager')
 await managerPage.getByRole('button',{name:'작업 요청 하기',exact:true}).waitFor()
 await page.goto(origin+'/work-requests/design?actor=planner&mode=new')
 await page.locator('#work-request-title').fill('브라우저 실제 저장 요청')
 await page.locator('input[type=date]').first().fill('2030-01-01')
 await page.locator('[contenteditable=true]').first().fill('부서 간 실제 작업 요청입니다.')
 await page.locator('input[type=file]').first().setInputFiles({name:'업무자료.txt',mimeType:'text/plain',buffer:Buffer.from('로컬 첨부 저장 검증')})
 await page.getByRole('button',{name:'작업 요청 등록',exact:true}).click()
 await page.waitForURL(/requestId=/)
 await page.getByText('서버에 저장 중...', {exact:true}).waitFor({state:'hidden'})
 const requestId=new URL(page.url()).searchParams.get('requestId');assert.ok(requestId)
 await managerPage.getByText('브라우저 실제 저장 요청',{exact:true}).first().waitFor({timeout:5000})
 await page.reload();await page.getByText('브라우저 실제 저장 요청',{exact:true}).first().waitFor()
 await page.getByText('업무자료.txt',{exact:true}).first().waitFor()
 await page.getByRole('combobox',{name:'직원 계정 전환'}).selectOption('planner2')
 await page.waitForFunction(()=>!document.body.textContent.includes('브라우저 실제 저장 요청'))
 await page.getByRole('combobox',{name:'직원 계정 전환'}).selectOption('manager')
 await page.goto(origin+'/work-requests/design?actor=manager')
 await page.getByText('브라우저 실제 저장 요청',{exact:true}).first().waitFor()
 // Change queue stages through the same production RPC adapter, then inspect production screens.
 async function command(actor,name,args){const response=await page.request.post(origin+'/__work-test/rpc',{headers:{'X-Test-Actor':actor},data:{name,args}});const result=await response.json();assert.equal(result.error,null,JSON.stringify(result.error));return result.data}
 let snapshot=await command(ids.manager,'list_work_requests',{p_owner:'design'}),revision=snapshot.requests.find(r=>r.id===requestId).revision
 revision=await command(ids.manager,'save_work_request',{p_id:requestId,p_revision:revision,p_patch:{status:'accepted',assignee:ids.design,collaborators:[],confirmedDueDate:'2030-01-02',managerPriority:'normal'},p_command:crypto.randomUUID()})
 await page.goto(origin+'/work-requests/design?actor=design&requestId='+requestId)
 await page.getByText('브라우저 실제 저장 요청',{exact:true}).first().waitFor()
 await page.getByRole('textbox',{name:/대화|메시지/}).first().fill('실제 작업 대화')
 await page.getByRole('button',{name:/보내기|전송/}).first().click()
 await page.getByText('실제 작업 대화',{exact:true}).waitFor()
 await page.reload();await page.getByText('실제 작업 대화',{exact:true}).waitFor()
 snapshot=await command(ids.design,'list_work_requests',{p_owner:'design'});revision=snapshot.requests.find(r=>r.id===requestId).revision
 revision=await command(ids.design,'save_work_request',{p_id:requestId,p_revision:revision,p_patch:{status:'completionReview',completionResult:'실제 완료 결과'},p_command:crypto.randomUUID()})
 revision=await command(ids.manager,'save_work_request',{p_id:requestId,p_revision:revision,p_patch:{status:'completionConfirm'},p_command:crypto.randomUUID()})
 await page.goto(origin+'/work-requests/design?actor=planner&requestId='+requestId)
 await page.getByRole('complementary').getByRole('button',{name:'결과 확인',exact:true}).click()
 await page.getByText('서버에 저장 중...', {exact:true}).waitFor({state:'hidden'})
 snapshot=await command(ids.planner,'list_work_requests',{p_owner:'design'});assert.equal(snapshot.requests.find(r=>r.id===requestId).status,'completed')
 await page.goto(origin+'/settings/profile?part=work&actor=planner');await page.getByRole('link',{name:/브라우저 실제 저장 요청/}).waitFor()
 await page.screenshot({path:'.tmp/work-requests-live-desktop.png',fullPage:true})
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'.tmp/work-requests-live-mobile.png',fullPage:true})
 await page.setViewportSize({width:1440,height:1000})
 await page.goto(origin+'/drafts/new?actor=planner')
 await page.getByPlaceholder('투웨이 셔링 호보백_글로우').fill('작성자 계정 검증 기획안')
 await page.getByRole('button',{name:'저장',exact:true}).click()
 await page.waitForURL(url=>/\/drafts\/[0-9a-f-]{36}/.test(url.pathname))
 await page.getByRole('button',{name:'저장',exact:true}).waitFor()
 assert.equal(await page.getByRole('button',{name:'저장',exact:true}).isEnabled(),true)
 await page.getByRole('combobox',{name:'직원 계정 전환'}).selectOption('planner2')
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].find(button=>button.textContent?.trim()==='저장')?.disabled===true)
 assert.equal(await page.getByRole('button',{name:'삭제',exact:true}).count(),0)
 await page.getByRole('combobox',{name:'직원 계정 전환'}).selectOption('ceo')
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].find(button=>button.textContent?.trim()==='저장')?.disabled===false)
 assert.equal(await page.getByRole('button',{name:'삭제',exact:true}).count(),1)
 await page.getByRole('combobox',{name:'직원 계정 전환'}).selectOption('planner')
 await page.getByRole('button',{name:'저장',exact:true}).waitFor({state:'visible'})
 assert.equal(await page.getByPlaceholder('투웨이 셔링 호보백_글로우').inputValue(),'작성자 계정 검증 기획안')
 await page.goto(origin+'/work-requests/design?actor=planner&mode=new')
 await page.locator('#work-request-title').fill('저장 실패 후 재시도 요청')
 await page.locator('input[type=date]').first().fill('2030-01-03')
 await page.locator('[contenteditable=true]').first().fill('실패해도 본문은 남아 있어야 합니다.')
 await page.request.post(origin+'/__work-test/failNextSave',{headers:{'X-Test-Actor':ids.planner},data:{}})
 await page.getByRole('button',{name:'작업 요청 등록',exact:true}).click()
 await page.getByRole('alert').filter({hasText:'저장 실패 재시도 검증'}).waitFor()
 assert.equal(await page.locator('#work-request-title').inputValue(),'저장 실패 후 재시도 요청')
 assert.equal(new URL(page.url()).searchParams.get('mode'),'new')
 await page.getByRole('button',{name:'작업 요청 등록',exact:true}).click()
 await page.waitForURL(/requestId=/)
 const afterRetry=await command(ids.planner,'list_work_requests',{p_owner:'design'})
 assert.equal(afterRetry.requests.filter(request=>request.values.title==='저장 실패 후 재시도 요청').length,1)
 assert.deepEqual(errors,[])
 console.log('work-requests-browser: real create/reload/attachment, two-window realtime refresh, same-department account switch, private chat, completion review/result confirmation, My home hub, desktop/mobile and draft creator/read-only/operator transition passed (local PostgreSQL, no production writes)')
}catch(error){console.error('work-requests-browser:',{message:error.message});if(browser){const pages=browser.contexts().flatMap(c=>c.pages());for(const page of pages)await page.screenshot({path:'.tmp/work-requests-browser-failure.png',fullPage:true}).catch(()=>{})}process.exitCode=1}finally{for(const stream of events)stream.end();await browser?.close();await server?.close();await db.close()}
