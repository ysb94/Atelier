import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises'
import { spawn } from 'node:child_process'

const visualHarness = (await readFile('scripts/verify-visual-category-workflow-browser.mjs','utf8')).replace(/\r\n/g,'\n')
const mark = 'const checks = String.raw' + String.fromCharCode(96)
const start = visualHarness.indexOf(mark)
const end = visualHarness.indexOf(String.fromCharCode(96) + '\n\nconst homeFixture',start + mark.length)
if(start<0 || end<0) throw new Error('Visual browser fixture not found')
const checks = String.raw`
 async function command(actor,name,args={}) {
   const response=await page.request.post(origin+'/__work-test/rpc',{headers:{'X-Test-Actor':actor},data:{name,args}})
   const reply=await response.json()
   assert.equal(reply.error,null,JSON.stringify(reply.error))
   return reply.data
 }
 await db.exec('reset role')
 await db.exec('begin')
 for (const name of ['20261102114206_work_request_cancellation','20261109192913_visual_assignment_history_visibility',
   '20261109202708_visual_worker_feedback_counts','20261109210739_visual_workflow_review_rounds',
   '20261118103641_sent_visual_request_content_edits']) {
   await db.exec(await fs.readFile('supabase/migrations/'+name+'.sql','utf8'))
 }
 await db.exec('commit')
 const supervisor=ids.manager,worker=ids.design,requester=ids.planner
 const settings=await command(supervisor,'get_work_request_settings',{p_owner:'design'})
 await command(supervisor,'save_visual_work_request_settings',{p_revision:settings.revision,p_supervisors:[supervisor],
   p_categories:settings.categories.map(item=>({...item,assigneeId:item.id==='banner'?supervisor:''}))})
 const requestId=crypto.randomUUID(),title='보낸 작업 요청 수정 검증'
 let revision=await command(requester,'begin_work_request',{p_id:requestId,p_owner:'design'})
 revision=await command(requester,'publish_visual_category_work',{p_id:requestId,p_revision:revision,p_command:crypto.randomUUID(),p_patch:{
   status:'requested',values:{title,dueDate:'2030-01-01',referenceFiles:[],blocks:[
     {id:'main',type:'text',text:'기존 메인 내용'},
     {id:'visual-request-section:banner',type:'text',text:'배너 작업 요청'},
     {id:'banner-body',type:'text',text:'기존 배너 내용'},
   ],visualRequest:{categories:[{id:'banner',fields:{}}]}},
 }})
 const act=(action,category,person=null)=>command(supervisor,'change_visual_category_work',{
   p_request:requestId,p_revision:revision,p_action:action,p_category:category,p_person:person,p_note:'',p_result_url:'',p_command:crypto.randomUUID(),
 })
 revision=await act('receipt','')
 revision=await act('assign_worker','banner',worker)

 await page.goto(origin+'/settings/profile?part=work&actor=planner',{waitUntil:'domcontentloaded'})
 await page.getByRole('link',{name:'수정',exact:true}).click()
 await page.waitForURL(url=>url.searchParams.get('mode')==='edit')
 await page.getByRole('heading',{name:'VisualTeam 작업 요청 수정',exact:true}).waitFor()
 assert.equal(await page.getByRole('checkbox',{name:'배너',exact:true}).isDisabled(),true)
 await page.locator('[contenteditable=true]').filter({hasText:'기존 메인 내용'}).fill('수정한 메인 내용')
 await page.locator('[contenteditable=true]').filter({hasText:'기존 배너 내용'}).fill('수정한 배너 내용')
 await page.getByRole('button',{name:'수정 내용 저장',exact:true}).click()
 await page.waitForURL(url=>url.searchParams.get('requestId')===requestId&&!url.searchParams.has('mode'))
 const saved=(await command(requester,'get_department_work',{p_id:requestId})).requests[0]
 assert.deepEqual(saved.values.blocks.filter(b=>['main','banner-body'].includes(b.id)).map(b=>b.text),['수정한 메인 내용','수정한 배너 내용'])

 await page.goto(origin+'/work-requests/design?actor=design',{waitUntil:'domcontentloaded'})
 const alerts=page.getByRole('region',{name:'이 탭의 알림',exact:true})
 await alerts.getByText('메인 내용이 수정되었습니다.',{exact:true}).waitFor()
 const pending=(await command(worker,'list_my_visual_workflow_notices_with_content')).find(row=>row.kind==='content_updated'&&row.requestId===requestId&&row.categoryId==='banner')
 assert.ok(pending && !pending.readAt)
 const acknowledgement=page.waitForResponse(response=>{
   if(!response.url().endsWith('/__work-test/rpc'))return false
   const call=response.request().postDataJSON()
   return call.name==='read_my_visual_workflow_notices'&&call.args.p_ids.includes(pending.id)
 })
 await alerts.getByText('배너 업무 내용이 수정되었습니다.',{exact:true}).click()
 await page.waitForURL(url=>url.searchParams.get('requestId')===requestId&&url.searchParams.get('visualTab')==='banner')
 const drawer=page.getByRole('complementary',{name:title+' 상세',exact:true})
 await drawer.getByText('수정한 메인 내용',{exact:true}).waitFor()
 await drawer.getByText('수정한 배너 내용',{exact:true}).waitFor()
 assert.equal((await (await acknowledgement).json()).error,null)
 await alerts.getByText('배너 업무 내용이 수정되었습니다.',{exact:true}).waitFor({state:'hidden'})
 const seen=(await command(worker,'list_my_visual_workflow_notices_with_content')).filter(row=>row.kind==='content_updated'&&row.requestId===requestId)
 assert.equal(seen.length,2)
 assert.ok(seen.every(row=>row.readAt))
 assert.deepEqual(errors,[])
 console.log('PASS sent Visual request browser: edit entry, save, category link and read state')
`

const harness=(visualHarness.slice(0,start)+mark+checks+visualHarness.slice(end))
  .replace("'list_my_visual_workflow_notices','read_my_visual_workflow_notices'", "'list_my_visual_workflow_notices','list_my_visual_workflow_notices_with_content','read_my_visual_workflow_notices'")
  .replace("'list_visual_workflow_entries','list_my_visual_workflow_notices']", "'list_visual_workflow_entries','list_my_visual_workflow_notices','list_my_visual_workflow_notices_with_content']")
  .replaceAll('5204','5216')
  .replaceAll('visual-category-','sent-visual-edit-')
const runner='node_modules/.tmp/sent-visual-edit-wrapper.mjs'
await mkdir('node_modules/.tmp',{recursive:true})
await writeFile(runner,harness)
try {
  const child=spawn(process.execPath,[runner],{stdio:'inherit'})
  process.exitCode=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>resolve(code??1))})
} finally {
  await unlink(runner)
}
