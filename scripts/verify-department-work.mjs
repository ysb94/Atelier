import assert from 'node:assert/strict'
import { filterDepartmentWork, clearWorkFilters } from '../src/features/work-requests/department-work.ts'
import { readFile } from 'node:fs/promises'
import { createWorkTestDb, ids } from './work-request-test-db.mjs'
const filters=clearWorkFilters()
const sample=[{id:'one',title:'공통 제목',requesterId:'a',assigneeIds:['a','b'],brandId:'brand',status:'inProgress'},{id:'two',title:'완료 제목',requesterId:'b',assigneeIds:[],brandId:'',status:'completed'}]
assert.equal(filterDepartmentWork(sample,filters,'').length,1)
assert.equal(filterDepartmentWork(sample,{...filters,status:['completed']},'').length,1)
assert.equal(filterDepartmentWork(sample,{...filters,requester:['a','b'],assignee:['b']},'공통').length,1)
assert.equal(filterDepartmentWork(sample,{...filters,requester:['b'],assignee:['b']},'').length,0)
assert.equal(filterDepartmentWork(sample,{...filters,status:['completed'],assignee:['unassigned'],brand:['undecided']},'').length,1)
const db=await createWorkTestDb()
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0]
async function actor(id){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated')}
const denied=async(sql,args=[])=>assert.rejects(()=>db.query(sql,args),e=>e.code==='42501')
try {
 await db.exec(await readFile('supabase/migrations/20261102034546_work_request_category_settings.sql','utf8'))
 await db.exec(await readFile('supabase/migrations/20261102043240_work_request_explicit_managers.sql','utf8'))
 const existing=crypto.randomUUID()
 await db.query("insert into public.work_requests(id,company_id,owner,requester_id,status,data) values($1,'e0000000-0000-4000-8000-000000000001','planning',$2,'requested',$3)",[existing,ids.planner,{values:{title:'기존 요청'},messages:[]}])
 const existingBefore=await scalar('select to_jsonb(r) from public.work_requests r where id=$1',[existing])
 const before=await scalar('select md5(jsonb_agg(to_jsonb(p) order by id)::text) from public.profiles p')
 await db.exec(await readFile('supabase/migrations/20261102093634_department_work_board.sql','utf8'))
 assert.equal(await scalar('select md5(jsonb_agg(to_jsonb(p) order by id)::text) from public.profiles p'),before)
 assert.deepEqual(await scalar("select to_jsonb(r)-'kind' from public.work_requests r where id=$1",[existing]),existingBefore)
 assert.equal(await scalar('select kind from public.work_requests where id=$1',[existing]),'request')
 await db.query('delete from public.work_requests where id=$1',[existing])
 for(const [owner, person] of [['planning',ids.planner],['design',ids.design],['md',ids.md],['logistics',ids.logistics]]){
  await actor(person);const id=crypto.randomUUID();let rev=await scalar('select public.begin_department_work($1,$2)',[id,owner])
  rev=await scalar('select public.save_department_work($1,$2,$3,$4)',[id,rev,{status:'requested',values:{title:'부서 자체업무',dueDate:'2030-01-01',blocks:[{id:'body',type:'text',text:'본문'}],referenceFiles:[]}},crypto.randomUUID()])
  assert.equal((await scalar('select public.get_department_work($1)',[id])).requests[0].status,'inProgress')
  await db.exec('reset role');await db.query('delete from public.work_request_commands where request_id=$1',[id]);await db.query('delete from public.work_requests where id=$1',[id])
 }
 const request=crypto.randomUUID(), command=crypto.randomUUID()
 await actor(ids.planner)
 let revision=await scalar("select public.begin_department_work($1,'planning')",[request])
 const values={title:'내부 업무',dueDate:'2030-01-01',blocks:[{id:'body',type:'text',text:'내용'}],referenceFiles:[]}
 revision=await scalar('select public.save_work_request($1,$2,$3,$4)',[request,revision,{status:'requested',values},crypto.randomUUID()])
 revision=await scalar('select public.publish_department_work($1,$2,$3)',[request,revision,command])
 assert.equal(await scalar('select public.publish_department_work($1,1,$2)',[request,command]),revision)
 let detail=await scalar('select public.get_department_work($1)',[request])
 assert.equal(detail.requests[0].assignee,ids.planner);assert.equal(detail.requests[0].status,'inProgress')
 await db.exec('reset role')
 const file=crypto.randomUUID(), unready=crypto.randomUUID()
 await db.query("insert into public.work_request_files(id,request_id,uploader_id,storage_path,file_name,mime_type,size_bytes,ready) values($1,$2,$3,'fixture/ready','자료.txt','text/plain',4,true),($4,$2,$3,'fixture/unready','미완료.txt','text/plain',4,false)",[file,request,ids.planner,unready])
 await db.query("insert into storage.objects(bucket_id,name) values('company-work-requests','fixture/ready'),('company-work-requests','fixture/unready')")
 await actor(ids.planner2)
 assert.equal(Number(await scalar('select count(*) from public.work_request_files where request_id=$1',[request])),1)
 assert.equal(Number(await scalar("select count(*) from storage.objects where bucket_id='company-work-requests'")),1)
 const list=await scalar("select public.list_department_work('planning')")
 assert.equal(list.length,1);assert.equal(list[0].kind,'internal');assert.equal('values' in list[0],false)
 assert.equal((await scalar('select public.get_department_work($1)',[request])).requests.length,1)
 assert.equal((await scalar('select public.get_department_work($1)',[request])).files.length,1)
 await denied('select public.save_work_request($1,$2,$3,$4)',[request,revision,{status:'completed'},crypto.randomUUID()])
 await denied('select public.complete_department_work($1,$2,$3)',[request,revision,crypto.randomUUID()])
 await denied("select public.send_work_request_message($1,'requester','타인 메시지',$2)",[request,crypto.randomUUID()])
 for(const id of [ids.md,ids.outsider]){await actor(id);await denied("select public.list_department_work('planning')");await denied('select public.get_department_work($1)',[request]);await denied("select public.begin_department_work($1,'planning')",[crypto.randomUUID()])}
 for(const id of [ids.developer,ids.delegate,ids.ceo]){await actor(id);assert.equal((await scalar("select public.list_department_work('planning')")).length,1)}
 await actor(ids.planner)
 revision=await scalar('select public.complete_department_work($1,$2,$3)',[request,revision,crypto.randomUUID()])
 assert.equal((await scalar('select public.get_department_work($1)',[request])).requests[0].status,'completed')
 console.info('PASS department work (four departments): preserved profiles, peer content/read-only, foreign department/company blocked, operators, own create/start/complete, idempotency')
}finally{await db.close()}
