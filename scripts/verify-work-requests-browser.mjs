import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import path from 'node:path'
import {createServer} from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import {chromium} from 'playwright-core'
import {createWorkTestDb,ids,departments} from './work-request-test-db.mjs'

const db=await createWorkTestDb(),root=process.cwd(),events=new Set(),objects=new Map()
const origin='http://127.0.0.1:5196'
const proposerOnly=process.argv.includes('--draft-proposer-only')
const draftCreationOnly=process.argv.includes('--draft-creation-only')
const draftWorkspaceRoutes = {
 name: 'draft-workspace-test-routes',
 enforce: 'pre',
 resolveId(source, importer) {
  if (source === './company-routes' && importer?.replaceAll('\\', '/').endsWith('/layout/workspace-tabs.tsx')) {
   return '\0draft-workspace-test-routes'
  }
 },
 load(id) {
  if (id !== '\0draft-workspace-test-routes') return
  return `
   import { createElement as h } from 'react'
   import { Route } from 'react-router-dom'
   import { CompanyDraftsPage } from '@/features/drafts/DraftsPage'
   import { DraftEditPage } from '@/features/drafts/DraftEditPage'
   export const companyWorkspaceRoutes = [
    h(Route, { key: 'home', path: '/', element: h('h1', null, '검증 홈') }),
    h(Route, { key: 'drafts', path: '/drafts', element: h(CompanyDraftsPage) }),
    h(Route, { key: 'draft-edit', path: '/drafts/:draftId', element: h(DraftEditPage) }),
   ]
  `
 },
}
let queue=Promise.resolve(),browser,server,failNextSave=false,failPlannerExemptions=false
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
    else if(body.name==='list_company_attendance_exempt'){
     if(actor===ids.planner&&failPlannerExemptions)throw Error('출퇴근 제외 조회 실패 검증')
     data=[]
    }
    else if(body.name==='get_sample_work_order_pack')data=null
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
   if(route==='rpc'&&!['get_my_basic_work_access','list_work_requests','list_org_chart_members','list_company_attendance_exempt','get_sample_work_order_pack'].includes(body.name))for(const stream of events)stream.write('data: changed\n\n')
  }catch(error){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:null,error:{message:error.message,code:error.code}}))}
 });queue=task.catch(()=>{});await task
}
try{
 await db.exec('reset role');for(const [name,id] of Object.entries(departments))await db.query('update public.departments set name=$2 where id=$1',[id,{planning:'기획팀',design:'Visual Team',md:'MD Team',logistics:'물류팀',china:'중국팀'}[name]])
 await db.exec(await readFile('supabase/migrations/20261126081745_draft_planning_collaboration.sql','utf8'))
 const brandId = 'b0000000-0000-4000-8000-000000000001'
 const folderId = '20000000-0000-4000-8000-000000000001'
 await db.query("insert into public.seasons(id,brand_id,code,name,release_timing,year,status) values($1,$2,'TEST-FOLDER','출시 폴더 검증','',2030,'active')",[folderId,brandId])
 server=await createServer({configFile:false,envDir:false,cacheDir:path.join(root,'node_modules/.cache/work-live-vite'),logLevel:'error',plugins:[draftWorkspaceRoutes,{name:'work-live-test',enforce:'pre',resolveId(source,importer){if(importer&&source.startsWith('.')){const target=path.resolve(path.dirname(importer),source).replace(/\.tsx?$/,'');if(target===path.join(root,'src/lib/supabase/auth'))return path.join(root,'dev-tools/ai-workflow/browser-fixture/work-live-auth.tsx');if(target===path.join(root,'src/lib/supabase/client'))return path.join(root,'dev-tools/ai-workflow/browser-fixture/work-live-client.ts')}},configureServer(vite){vite.middlewares.use((req,res,next)=>{if(req.url.startsWith('/__work-test/')){void localApi(req,res).catch(next);return}if(!req.headers.accept?.includes('text/html'))return next();void vite.transformIndexHtml(req.url,'<html><body><div id="root"></div><script type="module" src="/dev-tools/ai-workflow/browser-fixture/work-live-entry.tsx"></script></body></html>').then(html=>{res.setHeader('Content-Type','text/html');res.end(html)}).catch(next)})}},react(),tailwindcss()],resolve:{alias:[{find:'@/components/layout/company-brand-scope',replacement:path.join(root,'dev-tools/ai-workflow/browser-fixture/work-live-brand.ts')},{find:'@/lib/supabase/auth',replacement:path.join(root,'dev-tools/ai-workflow/browser-fixture/work-live-auth.tsx')},{find:'@/lib/supabase/client',replacement:path.join(root,'dev-tools/ai-workflow/browser-fixture/work-live-client.ts')},{find:'@',replacement:path.join(root,'src')}]},server:{host:'127.0.0.1',port:5196,strictPort:true,hmr:false}})
 await server.listen();browser=await chromium.launch({executablePath:process.env.ATELIER_CHROMIUM_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[]
 await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort())
 page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(15000)
 async function command(actor,name,args){const response=await page.request.post(origin+'/__work-test/rpc',{headers:{'X-Test-Actor':actor},data:{name,args}});const result=await response.json();assert.equal(result.error,null,JSON.stringify(result.error));return result.data}
 if(!proposerOnly&&!draftCreationOnly){
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
 }
 async function openNewDraft(search) {
  const params = new URLSearchParams(search)
  params.set('draft-workspace', '1')
  await page.goto(origin+'/drafts?'+params,{waitUntil:'domcontentloaded',timeout:120000})
  await page.getByRole('link',{name:'기획안 추가',exact:true}).click()
  await page.getByRole('heading',{name:'새 기획안',exact:true}).waitFor()
  return new URL(page.url()).searchParams
 }
 const draftBrand = page.getByRole('combobox',{name:'브랜드 선택',exact:true})
 const nameOnNewDraft = page.getByRole('textbox',{name:'한글명',exact:true})
 for (const search of ['', '?scope=unassigned']) {
  // A stray old folder filter must never supply a brand in an unscoped list.
  const params = await openNewDraft(search ? search+'&folder='+folderId : '?folder='+folderId)
  assert.equal(params.has('brand') || params.has('season'),false)
  assert.equal(await draftBrand.inputValue(),'')
  assert.equal(await nameOnNewDraft.inputValue(),'')
 }
 const folderParams = await openNewDraft('?scope=atelier&folder='+folderId)
 assert.equal(folderParams.get('brand'),'atelier')
 assert.equal(folderParams.get('season'),folderId)
 assert.equal(await draftBrand.inputValue(),brandId)
 assert.equal(await nameOnNewDraft.inputValue(),'')
 await page.getByText('출시 폴더 · 출시 폴더 검증',{exact:true}).waitFor()
 await nameOnNewDraft.fill('선택 폴더 신규 기획안')
 const newDraftPhoto = page.getByRole('button',{name:'사진 선택',exact:true})
 const photoPreview = newDraftPhoto.locator('img')
 const imageToDrop = await page.evaluateHandle(async () => {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 2
  canvas.getContext('2d').fillRect(0, 0, 2, 2)
  const image = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
  const transfer = new DataTransfer()
  transfer.items.add(new File([image], '대표 사진.png', { type:'image/png' }))
  return transfer
 })
 await newDraftPhoto.dispatchEvent('dragover',{dataTransfer:imageToDrop})
 await newDraftPhoto.dispatchEvent('drop',{dataTransfer:imageToDrop})
 await imageToDrop.dispose()
 await photoPreview.waitFor()
 const uploadedImage = await photoPreview.getAttribute('src')
 assert.match(uploadedImage,/^data:image\/png;base64,/)
 const textToDrop = await page.evaluateHandle(() => {
  const transfer = new DataTransfer()
  transfer.items.add(new File(['test'], '메모.txt', { type:'text/plain' }))
  return transfer
 })
 await newDraftPhoto.dispatchEvent('drop',{dataTransfer:textToDrop})
 await textToDrop.dispose()
 await page.getByRole('alert').filter({hasText:'대표 사진은 JPG, PNG, WebP 파일만 추가할 수 있습니다.'}).waitFor()
 assert.equal(await photoPreview.getAttribute('src'),uploadedImage)
 const newDraftTab = page.getByRole('button',{name:'기획안 추가 탭 닫기',exact:true})
 const rpcPattern = '**/__work-test/rpc'
 async function failDraftSave(route) {
  if (route.request().postDataJSON().name !== 'save_product_draft') return route.fallback()
  await route.fulfill({ json: { data:null, error:{ message:'기획안 저장 실패 검증' } } })
 }
 await page.route(rpcPattern, failDraftSave)
 await page.getByRole('button',{name:'저장',exact:true}).click()
 await page.getByText('기획안 저장 실패 검증',{exact:true}).waitFor()
 await page.unroute(rpcPattern, failDraftSave)
 assert.equal(await nameOnNewDraft.inputValue(),'선택 폴더 신규 기획안')
 assert.equal(await newDraftTab.isVisible(),true)
 await page.getByRole('button',{name:'저장',exact:true}).click()
 await page.waitForURL(url=>url.pathname==='/drafts' && url.searchParams.get('scope')==='atelier' && url.searchParams.get('folder')===folderId)
 await newDraftTab.waitFor({state:'detached'})
 await nameOnNewDraft.waitFor({state:'detached'})
 const storedDraft = await db.query('select brand_id, season_id, image_url from public.product_drafts where name_ko=$1',['선택 폴더 신규 기획안'])
 assert.deepEqual(storedDraft.rows,[{brand_id:brandId,season_id:folderId,image_url:uploadedImage}])
 await page.getByText('선택 폴더 신규 기획안',{exact:true}).first().waitFor()
 await page.getByRole('link',{name:'기획안 추가',exact:true}).click()
 await nameOnNewDraft.waitFor()
 assert.notEqual(new URL(page.url()).searchParams.get('entry'),folderParams.get('entry'))
 assert.equal(await nameOnNewDraft.inputValue(),'')
 assert.equal(await draftBrand.inputValue(),brandId)
 assert.equal(await photoPreview.count(),0)
 const choosingPhoto = page.waitForEvent('filechooser')
 await newDraftPhoto.click()
 await (await choosingPhoto).setFiles({ name:'대표 사진.png', mimeType:'image/png', buffer:Buffer.from(uploadedImage.split(',')[1], 'base64') })
 await photoPreview.waitFor()
 assert.equal(await photoPreview.getAttribute('src'),uploadedImage)
 await draftBrand.selectOption('')
 assert.equal(await page.getByText('출시 폴더 · 출시 폴더 검증',{exact:true}).count(),0)
 await page.getByRole('button',{name:'목록',exact:true}).click()
 await page.getByRole('button',{name:/^ATELIER/}).click()
 await page.waitForURL(url=>url.pathname==='/drafts' && !url.searchParams.has('scope'))
 await page.getByRole('link',{name:'기획안 추가',exact:true}).click()
 await nameOnNewDraft.waitFor()
 assert.equal(await nameOnNewDraft.inputValue(),'')
 assert.equal(await draftBrand.inputValue(),'')
 assert.equal(await page.getByRole('textbox',{name:'영문명',exact:true}).inputValue(),'')
 const collaborationDraft = (await db.query('select id,draft_no from public.product_drafts where name_ko=$1',['선택 폴더 신규 기획안'])).rows[0]
 await page.goto(origin+'/drafts?actor=planner2',{waitUntil:'domcontentloaded',timeout:120000})
 const collaborationFolder = page.getByRole('combobox',{name:`${collaborationDraft.draft_no} 출시 폴더`,exact:true})
 await page.waitForFunction(label=>[...document.querySelectorAll('select')].some(select=>select.getAttribute('aria-label')===label&&!select.disabled),`${collaborationDraft.draft_no} 출시 폴더`)
 assert.equal(await collaborationFolder.inputValue(),folderId)
 await page.goto(origin+'/drafts/'+collaborationDraft.id+'?actor=planner2',{waitUntil:'domcontentloaded',timeout:120000})
 const collaborationSave = page.getByRole('button',{name:'저장',exact:true})
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(button=>button.textContent?.trim()==='저장'&&!button.disabled))
 assert.equal(await page.getByRole('button',{name:'삭제',exact:true}).count(),0)
 assert.equal(await page.getByLabel('1차 샘플 작업지시서 파일',{exact:true}).isEnabled(),true)
 await page.goto(origin+'/drafts/'+collaborationDraft.id+'?actor=design',{waitUntil:'domcontentloaded',timeout:120000})
 await page.getByText(/조회 전용/).waitFor()
 assert.equal(await collaborationSave.isDisabled(),true)
 assert.equal(await page.getByLabel('1차 샘플 작업지시서 파일',{exact:true}).count(),0)
 if(!draftCreationOnly){
 await page.goto(origin+'/drafts/new?actor=planner',{waitUntil:'domcontentloaded',timeout:120000})
 const draftNameKo=page.getByRole('textbox',{name:'한글명',exact:true})
 const draftNameEn=page.getByRole('textbox',{name:'영문명',exact:true})
 const confirmDraftName=page.getByRole('button',{name:'네임확정',exact:true})
 await confirmDraftName.waitFor()
 assert.equal(await confirmDraftName.isDisabled(),true)
 await draftNameKo.fill('작성자 계정 검증 기획안')
 await draftNameEn.fill(' ')
 assert.equal(await confirmDraftName.isDisabled(),true)
 await draftNameKo.clear()
 await draftNameEn.fill('Draft name check')
 assert.equal(await confirmDraftName.isDisabled(),true)
 await draftNameKo.fill('작성자 계정 검증 기획안')
 await confirmDraftName.click()
 assert.equal(await draftNameKo.getAttribute('readonly'),'')
 assert.equal(await draftNameEn.getAttribute('readonly'),'')
 await page.getByRole('button',{name:'네임수정',exact:true}).click()
 await draftNameEn.clear()
 const brandSelect=page.getByRole('combobox',{name:'브랜드 선택',exact:true})
 const destination=page.getByRole('combobox',{name:'샘플 진행처 선택',exact:true})
 const brandMark=page.getByRole('img',{name:'ATELIER 브랜드',exact:true})
 assert.equal(await brandSelect.inputValue(),'')
 assert.equal(await brandMark.count(),0)
 await page.getByText('No. 저장 시 발급',{exact:true}).waitFor()
 assert.deepEqual(await brandSelect.locator('option').allTextContents(),['브랜드 미정','ATELIER'])
 await brandSelect.selectOption({label:'ATELIER'})
 await brandMark.waitFor()
 assert.match(await brandMark.locator('img').getAttribute('src'),/^data:image\/png/)
 await brandSelect.selectOption('')
 assert.equal(await brandMark.count(),0)
 await brandSelect.selectOption({label:'ATELIER'})
 await destination.selectOption({label:'PROMOTION [중국]'})
 const proposerPicker=page.getByRole('button',{name:'제안자 선택 (선택 사항)',exact:true})
 const proposerSearch=page.getByRole('textbox',{name:'제안자 이름 검색',exact:true})
 failPlannerExemptions=true
 await proposerPicker.click()
 await proposerSearch.fill('design')
 await page.getByRole('button',{name:'design',exact:true}).waitFor()
 await proposerSearch.evaluate(input=>input.blur())
 assert.equal(await proposerPicker.getAttribute('aria-expanded'),'true','Losing focus without an outside interaction keeps the choices open')
 await page.getByRole('button',{name:'design',exact:true}).click()
 failPlannerExemptions=false
 await page.getByText('제안자 design',{exact:true}).waitFor()
 const photo=page.getByRole('button',{name:'사진 선택',exact:true})
 const [photoBox,brandBox]=await Promise.all([photo.boundingBox(),brandMark.boundingBox()])
 assert.ok(photoBox.x+photoBox.width<brandBox.x&&Math.abs(photoBox.y-brandBox.y)<1)
 await page.setViewportSize({width:390,height:844})
 assert.ok((await photo.boundingBox()).y<(await brandMark.boundingBox()).y)
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false)
 await page.setViewportSize({width:1440,height:1000})
 await page.getByRole('button',{name:'저장',exact:true}).click()
 await page.waitForURL(url=>url.pathname==='/drafts')
 const savedDraft = await db.query('select id from public.product_drafts where name_ko=$1',['작성자 계정 검증 기획안'])
 assert.equal(savedDraft.rows.length,1)
 await page.goto(origin+'/drafts/'+savedDraft.rows[0].id+'?actor=planner',{waitUntil:'domcontentloaded',timeout:120000})
 await page.getByRole('button',{name:'저장',exact:true}).waitFor()
 assert.equal(await page.getByRole('button',{name:'저장',exact:true}).isEnabled(),true)
 await page.reload()
 await brandSelect.waitFor()
 assert.equal(await brandSelect.locator('option:checked').textContent(),'ATELIER')
 await brandMark.waitFor()
 await page.getByText('제안자 design',{exact:true}).waitFor()
 assert.equal(await destination.inputValue(),'PROMOTION [중국]')
 assert.match(await proposerPicker.textContent(),/design/)
 await proposerPicker.click()
 await proposerSearch.press('Escape')
 assert.equal(await proposerPicker.getAttribute('aria-expanded'),'false')
 await proposerPicker.click()
 await proposerSearch.fill('md')
 await page.getByRole('button',{name:'md',exact:true}).click()
 await page.getByText('제안자 md',{exact:true}).waitFor()
 await page.getByRole('button',{name:'저장',exact:true}).click()
 await page.getByText(/저장됨$/).waitFor()
 await page.reload()
 await page.getByText('제안자 md',{exact:true}).waitFor()
 await proposerPicker.click()
 await page.getByRole('button',{name:'미지정',exact:true}).click()
 await page.getByRole('button',{name:'저장',exact:true}).click()
 await page.getByText(/저장됨$/).waitFor()
 await page.reload()
 await page.getByText('제안자 미지정',{exact:true}).waitFor()
 const draftId=new URL(page.url()).pathname.split('/').at(-1)
 const nextSample=page.locator('#next-sample')
 const sampleCard=round=>page.getByRole('region',{name:`등록된 ${round}차 샘플`,exact:true})
 async function uploadSample(round, container){
  await container.getByLabel(`${round}차 샘플 작업지시서 파일`,{exact:true})
   .setInputFiles({name:`sample-${round}.pdf`,mimeType:'application/pdf',buffer:Buffer.from(`sample ${round}`)})
  await container.getByRole('button',{name:'등록',exact:true}).click()
  await sampleCard(round).getByRole('link',{name:`sample-${round}.pdf`,exact:true}).waitFor()
 }
 async function setSampleState(round, fields){
  await queue
  await db.exec('reset role')
  const {rows}=await db.query(`update public.product_drafts
    set sample_work_orders=jsonb_set(sample_work_orders, array[$2::text], (sample_work_orders -> $2::integer) || $3::jsonb)
    where id=$1 returning id`,[draftId,round-1,JSON.stringify(fields)])
  assert.equal(rows.length,1)
  await page.reload()
  await sampleCard(round).waitFor()
 }
 await uploadSample(1,page)
 await nextSample.waitFor({state:'detached'})
 await setSampleState(1,{shipped:true,returnedAt:'2026-11-24T01:00:00Z'})
 assert.equal(await nextSample.count(),0,'발송 상태만으로는 다음 지시서 업로드가 열리지 않음')
 await setSampleState(1,{receivedAt:'2026-11-24T02:00:00Z'})
 await nextSample.getByRole('radio',{name:'2차 샘플 진행',exact:true}).waitFor()
 await uploadSample(2,nextSample)
 await nextSample.waitFor({state:'detached'})
 await setSampleState(2,{receivedAt:'2026-11-24T03:00:00Z'})
 await nextSample.getByRole('radio',{name:'3차 샘플 진행',exact:true}).waitFor()
 assert.equal(await sampleCard(1).getByRole('link',{name:'sample-1.pdf',exact:true}).count(),1)
 await page.getByRole('combobox',{name:'직원 계정 전환'}).selectOption('planner2')
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].find(button=>button.textContent?.trim()==='저장')?.disabled===false)
 assert.equal(await page.getByRole('button',{name:'삭제',exact:true}).count(),0)
 await page.getByRole('combobox',{name:'직원 계정 전환'}).selectOption('ceo')
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].find(button=>button.textContent?.trim()==='저장')?.disabled===false)
 assert.equal(await page.getByRole('button',{name:'삭제',exact:true}).count(),1)
 await page.getByRole('combobox',{name:'직원 계정 전환'}).selectOption('planner')
 await page.getByRole('button',{name:'저장',exact:true}).waitFor({state:'visible'})
 assert.equal(await page.getByRole('textbox',{name:'한글명',exact:true}).inputValue(),'작성자 계정 검증 기획안')
 }
 if(!proposerOnly&&!draftCreationOnly){
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
 }
 assert.deepEqual(errors,[])
 console.log(draftCreationOnly
  ? 'Draft creation browser: image drop, failed save, clean reopening, coworker folder and sample controls, and other-department read-only mode passed (local PostgreSQL)'
  : proposerOnly
  ? 'Draft proposer browser: create, edit, clear, search focus, failed attendance lookup independence, and saved reload passed (local PostgreSQL)'
  : 'work-requests-browser: real create/reload/attachment, two-window realtime refresh, same-department account switch, private chat, completion review/result confirmation, My home hub, desktop/mobile and draft creator/read-only/operator transition passed (local PostgreSQL, no production writes)')
}catch(error){console.error('work-requests-browser:',{message:error.message});if(browser){const pages=browser.contexts().flatMap(c=>c.pages());for(const page of pages)await page.screenshot({path:'.tmp/work-requests-browser-failure.png',fullPage:true}).catch(()=>{})}process.exitCode=1}finally{for(const stream of events)stream.end();await browser?.close();await server?.close();await db.close()}
