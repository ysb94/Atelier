import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createWorkTestDb,ids} from './work-request-test-db.mjs'
const db=await createWorkTestDb()
const sql=async(text,args=[])=>Object.values((await db.query(text,args)).rows[0])[0]
const actor=async(id)=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated')}
const denied=(run,code='42501')=>assert.rejects(run,error=>error.code===code)
const cancel=(id,rev,action='request',command=crypto.randomUUID())=>sql('select public.cancel_work_request($1,$2,$3,$4)',[id,rev,command,action])
const row=async(id)=>{await db.exec('reset role');return sql('select to_jsonb(r) from public.work_requests r where id=$1',[id])}
async function create(){await actor(ids.planner);const id=crypto.randomUUID();const rev=await sql("select public.begin_work_request($1,'design')",[id]);await sql('select public.save_work_request($1,$2,$3,$4)',[id,rev,{status:'requested',values:{title:'취소 검증',dueDate:'2030-01-01',blocks:[{type:'text',id:'main',text:'기존 내용 유지'}],referenceFiles:[]}},crypto.randomUUID()]);return id}
try{
 for(const name of ['20261102034546_work_request_category_settings','20261102043240_work_request_explicit_managers','20261102093634_department_work_board'])await db.exec(await readFile('supabase/migrations/'+name+'.sql','utf8'))
 const existing=await create();const before=await row(existing)
 const profiles=await sql('select jsonb_agg(to_jsonb(p) order by id) from public.profiles p')
 await db.exec(await readFile('supabase/migrations/20261102114206_work_request_cancellation.sql','utf8'))
 assert.deepEqual(await row(existing),before)
 assert.deepEqual(await sql('select jsonb_agg(to_jsonb(p) order by id) from public.profiles p'),profiles)
 assert.equal(await sql("select has_function_privilege('anon','public.cancel_work_request(uuid,bigint,uuid,text)','execute')"),false)
 await actor(ids.planner)
 const command=crypto.randomUUID();const revision=await cancel(existing,before.revision,'request',command)
 assert.equal(await cancel(existing,before.revision,'request',command),revision)
 let saved=await row(existing);assert.equal(saved.status,'cancelled');assert.equal(saved.data.cancellation.requestedBy,ids.planner)
 assert.equal(saved.data.cancellationHistory.length,1);assert.deepEqual(saved.data.values,before.data.values)
 const id=await create();saved=await row(id)
 await actor(ids.manager)
 let rev=await sql('select public.save_work_request($1,$2,$3,$4)',[id,saved.revision,{status:'accepted',assignee:ids.design},crypto.randomUUID()])
 await actor(ids.planner)
 await denied(()=>sql('select public.save_work_request($1,$2,$3,$4)',[id,rev,{status:'cancelled'},crypto.randomUUID()]))
 rev=await cancel(id,rev)
 saved=await row(id);assert.equal(saved.status,'accepted');assert.equal(saved.data.cancellation.state,'requested')
 for(const who of [ids.planner2,ids.outsider,ids.design]){await actor(who);await denied(()=>cancel(id,rev));await denied(()=>cancel(id,rev,'approve'))}
 await actor(ids.planner);await denied(()=>cancel(id,rev,'approve'))
 await actor(ids.manager);rev=await cancel(id,rev,'reject')
 saved=await row(id);assert.equal(saved.status,'accepted');assert.equal(saved.data.cancellation.state,'rejected');assert.equal(saved.data.cancellation.resolvedBy,ids.manager)
 await actor(ids.planner);await denied(()=>cancel(id,rev-1),'40001');rev=await cancel(id,rev)
 await db.exec('reset role')
 await db.query("insert into public.work_request_time_entries(request_id,profile_id,mounted_at) values($1,$2,clock_timestamp()-interval '1 minute')",[id,ids.design])
 await actor(ids.planner)
 await denied(()=>sql('select public.save_work_request($1,$2,$3,$4)',[id,rev,{cancellation:{state:'approved'}},crypto.randomUUID()]),'P0001')
 await actor(ids.manager)
 const approveCommand=crypto.randomUUID(), approved=await cancel(id,rev,'approve',approveCommand)
 assert.equal(await cancel(id,rev,'approve',approveCommand),approved)
 saved=await row(id);assert.equal(saved.status,'cancelled');assert.equal(saved.data.cancellation.state,'approved');assert.equal(saved.data.cancellationHistory.length,4)
 assert.equal(await sql('select mounted_at from public.work_request_time_entries where request_id=$1',[id]),null)
 assert.ok(Number(await sql('select accumulated_ms from public.work_request_time_entries where request_id=$1',[id]))>=60000)
 assert.equal(Number(await sql('select count(*) from public.work_request_messages where request_id=$1',[id])),4)
 await actor(ids.planner);await denied(()=>cancel(id,approved),'40001')
 const next=await create();saved=await row(next)
 await actor(ids.manager);rev=await sql('select public.save_work_request($1,$2,$3,$4)',[next,saved.revision,{status:'accepted',assignee:ids.design},crypto.randomUUID()])
 await actor(ids.planner);rev=await cancel(next,rev)
 await actor(ids.ceo);await cancel(next,rev,'approve')
 console.log('PASS cancellation: preserved existing rows/profiles, immediate cancel, pending without stopping work, manager reject/approve, operator, peer/worker/company restrictions, stale revision, replay, audit/messages, timer stop, no metadata forgery')
}finally{await db.close()}
