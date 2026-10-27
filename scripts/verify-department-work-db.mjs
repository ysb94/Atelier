import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'

const db=await PGlite.create()
const company='e0000000-0000-4000-8000-000000000001',brand='b0000000-0000-4000-8000-000000000001'
const ids={planner:'10000000-0000-4000-8000-000000000001',planner2:'10000000-0000-4000-8000-000000000002',md:'10000000-0000-4000-8000-000000000003',logistics:'10000000-0000-4000-8000-000000000004',design:'10000000-0000-4000-8000-000000000005',china:'10000000-0000-4000-8000-000000000006',manager:'10000000-0000-4000-8000-000000000007',ordinary:'10000000-0000-4000-8000-000000000008',outsider:'10000000-0000-4000-8000-000000000009',developer:'d0000000-0000-4000-8000-000000000001',delegate:'a5afdd00-4a61-44dc-a1a3-082fa8a1345d',ceo:'56074867-fdc2-4ce5-8e97-cea431decc36'}
const departments={planning:'ced99f89-ea80-4eeb-8f03-272bf72f5db1',design:'7ac8b7a8-7f12-4f3e-a371-d2dac7e492f1',md:'919b2c44-afb6-4d7e-a5b8-b7203df9cef9',logistics:'c5d4cfca-97ce-4ca7-b30a-6beed842cf1e',china:'bf926822-910c-422f-9c17-5fd3d8ddb3ba'}
const actor=async id=>db.exec(`reset role;select set_config('request.jwt.claim.sub','${id}',false);set role authenticated`)
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0]
async function denied(sql,args=[],code){await assert.rejects(()=>db.query(sql,args),e=>!code||e.code===code)}
async function save(id,revision,patch,key=crypto.randomUUID()){return scalar('select public.save_work_request($1,$2,$3,$4)',[id,revision,patch,key])}
try {
 await db.exec(await readFile('supabase/tests/department_work_fixture.sql','utf8'))
 const legacyHelpersBefore=await scalar("select md5(string_agg(pg_get_functiondef(p.oid),',' order by p.proname)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app' and p.proname in ('is_admin','has_any_capability','can_edit_brand','can_edit_company')")
 const legacyDraft=crypto.randomUUID();await db.query("insert into public.product_drafts(id,company_id,owner,name_ko,status,draft_no) values($1,$2,'planner','기존 작성자 미확정 자료','open','PL-0001')",[legacyDraft,company])
 await db.exec(await readFile('supabase/migrations/20261027044909_department_work_access.sql','utf8'))
 await db.exec(await readFile('supabase/migrations/20261027044916_work_requests_storage.sql','utf8'))
 assert.equal(await scalar("select md5(string_agg(pg_get_functiondef(p.oid),',' order by p.proname)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app' and p.proname in ('is_admin','has_any_capability','can_edit_brand','can_edit_company')"),legacyHelpersBefore,'Legacy broad helpers are not expanded')
 await db.query('insert into public.companies(id) values($1)',[company])
 await db.query('insert into public.brands(id,company_id) values($1,$2)',[brand,company])
 for(const [domain,id] of Object.entries(departments))await db.query('insert into public.departments(id,company_id,name,is_active) values($1,$2,$3,true)',[id,company,domain])
 for(const [key,id] of Object.entries(ids)) {
  const domain=key.startsWith('planner')?'planning':key==='manager'?'design':key
  await db.query("insert into public.profiles(id,company_id,department_id,display_name,status,is_admin,position) values($1,$2,$3,$4,'active',false,'')",[id,key==='outsider'?'e0000000-0000-4000-8000-000000000002':company,departments[domain]??null,key==='planner2'?'planner':key])
 }
 await db.query("insert into public.permission_grants(id,profile_id,company_id,permission,scope_kind,scope_id) values(gen_random_uuid(),$1,$2,'work.manage','department',$3)",[ids.manager,company,departments.design])
 const profileBefore=await scalar('select md5(jsonb_agg(to_jsonb(p) order by id)::text) from public.profiles p')
 for(const [name,domain] of [['planner','planning'],['md','md'],['logistics','logistics'],['design','design'],['china','china']]){
  await actor(ids[name]);assert.equal(await scalar('select app.basic_work_allowed($1,$2)',[domain,brand]),true)
  assert.equal(await scalar('select app.is_admin()'),false)
  assert.equal(await scalar('select app.has_any_capability()'),false,'Basic work must not create old broad capabilities')
 }
 for(const name of ['developer','delegate','ceo']){await actor(ids[name]);for(const domain of Object.keys(departments))assert.equal(await scalar('select app.basic_work_allowed($1,$2)',[domain,brand]),true)}
 await actor(ids.ordinary);assert.equal(await scalar("select app.basic_work_allowed('planning')"),false)
 await actor(ids.outsider);assert.equal(await scalar("select app.basic_work_allowed('planning')"),false)
 await actor(ids.planner)
 assert.equal(await scalar('select created_by from public.product_drafts where id=$1',[legacyDraft]),null,'Legacy owner labels never become creator UUIDs')
 assert.equal(await scalar('select app.draft_write_allowed($1)',[legacyDraft]),false)
 const draft=await scalar("select public.save_product_draft($1,null,null,$2,'[]','[]')",[company,{nameKo:'작성자 확인',owner:'임의 담당자'}])
 assert.equal(await scalar('select created_by from public.product_drafts where id=$1',[draft]),ids.planner)
 await db.query("update public.product_drafts set owner='다른 사람' where id=$1",[draft])
 await denied('update public.product_drafts set created_by=$2 where id=$1',[draft,ids.planner2],'42501')
 await actor(ids.planner2);assert.equal(await scalar('select count(*)::int from public.product_drafts where id=$1',[draft]),1,'Shared read remains')
 assert.equal((await db.query("update public.product_drafts set name_ko='위조' where id=$1 returning id",[draft])).rows.length,0)
 await denied("select public.save_product_draft($1,null,$2,$3,'[]','[]')",[company,draft,{nameKo:'위조'}])
 assert.equal((await db.query('delete from public.product_drafts where id=$1 returning id',[draft])).rows.length,0)
 await actor(ids.ceo);assert.equal(await scalar('select app.draft_write_allowed($1)',[draft]),true)
 // Chinese collaboration changes only the specific work-order item, never the draft body.
 await actor(ids.planner)
 await db.query("update public.product_drafts set sample_work_orders=$2,specs=$3 where id=$1",[draft,[{id:'sample-1',url:'data:text/plain;base64,eA==',name:'지시서',shipped:true,assigneeId:null,assigneeName:'',fileCheckedAt:null,returnedAt:null}],{colorSampleRounds:[{id:'round-1',url:'data:text/plain;base64,eA==',returnedAt:null}]}])
 const color=await scalar("insert into public.draft_colors(id,company_id,brand_id,draft_id,name,sample_work_order_url) values(gen_random_uuid(),$1,null,$2,'컬러','data:text/plain;base64,eA==') returning id",[company,draft])
 const beforeChina=await scalar('select name_ko from public.product_drafts where id=$1',[draft]);let stamp=await scalar('select updated_at::text from public.product_drafts where id=$1',[draft])
 await actor(ids.china)
 await db.query("select public.apply_china_work_order($1,'sample-1','sample','assign',$2,$3)",[draft,ids.china,stamp])
 await denied("select public.apply_china_work_order($1,'sample-1','sample','ship',null,$2)",[draft,stamp],'40001')
 stamp=await scalar('select updated_at::text from public.product_drafts where id=$1',[draft])
 await db.query("select public.apply_china_work_order($1,'sample-1','sample','check',null,$2)",[draft,stamp])
 stamp=await scalar('select updated_at::text from public.product_drafts where id=$1',[draft])
 await db.query("select public.apply_china_work_order($1,'sample-1','sample','ship',null,$2)",[draft,stamp])
 stamp=await scalar('select updated_at::text from public.product_drafts where id=$1',[draft])
 await db.query("select public.apply_china_work_order($1,$2,'color','ship',null,$3)",[draft,color,stamp])
 assert.equal(await scalar('select name_ko from public.product_drafts where id=$1',[draft]),beforeChina)
 assert.ok(await scalar("select sample_work_orders->0->>'returnedAt' from public.product_drafts where id=$1",[draft]))
 assert.equal(await scalar('select sample_work_order_shipped from public.draft_colors where id=$1',[color]),true)
 await denied("select public.save_product_draft($1,null,$2,$3,'[]','[]')",[company,draft,{nameKo:'중국팀 본문 위조'}])
 await db.query("select set_config('app.china_workorder','on',false)")
 assert.equal((await db.query("update public.product_drafts set name_ko='권한 위조' where id=$1 returning id",[draft])).rows.length,0)
 await db.query("select set_config('app.china_workorder','off',false)")
 await db.exec('reset role')
 await db.query("insert into public.brand_fields(id,brand_id,system_key,owner) values(gen_random_uuid(),$1,'retailPrice','md'),(gen_random_uuid(),$1,'weightG','logistics')",[brand])
 const style=await scalar("insert into public.styles(id,brand_id,name,retail_price,weight_g,values,custom_fields) values(gen_random_uuid(),$1,'shared',10,20,'{}','{}') returning id",[brand])
 await actor(ids.md);await db.query('update public.styles set retail_price=11 where id=$1',[style]);await denied('update public.styles set weight_g=99 where id=$1',[style],'42501')
 await actor(ids.logistics);await db.query('update public.styles set weight_g=21 where id=$1',[style]);await denied('update public.styles set retail_price=99 where id=$1',[style],'42501')
 const feedback=crypto.randomUUID();await db.query('insert into public.ai_recommendation_feedback(id,brand_id) values($1,$2)',[feedback,brand])
 assert.equal((await db.query('delete from public.ai_recommendation_feedback where id=$1 returning id',[feedback])).rows.length,0,'Basic invoice saving must not add feedback deletion rights')
 await actor(ids.md);await denied('insert into public.ai_recommendation_feedback(id,brand_id) values(gen_random_uuid(),$1)',[brand],'42501')
 // Requests survive new sessions and are owned by UUID, not department or matching names.
 await actor(ids.planner);const request=crypto.randomUUID();let revision=await scalar('select public.begin_work_request($1,$2)',[request,'design'])
 revision=await save(request,revision,{status:'requested',values:{title:'실제 요청',dueDate:'2030-01-01',blocks:[{id:'t',type:'text',text:'작업 내용'}],referenceFiles:[]},brandId:brand})
 await actor(ids.planner2);assert.equal(await scalar('select app.work_request_read($1)',[request]),false);await denied('select public.save_work_request($1,$2,$3,$4)',[request,revision,{status:'cancelled'},crypto.randomUUID()],'42501')
 await actor(ids.manager);const duplicate=crypto.randomUUID();revision=await save(request,revision,{status:'reviewing'},duplicate);assert.equal(await save(request,revision-1,{status:'reviewing'},duplicate),revision,'Idempotent retry')
 await denied('select public.save_work_request($1,$2,$3,$4)',[request,revision-1,{status:'accepted'},crypto.randomUUID()],'40001')
 revision=await save(request,revision,{status:'accepted',managerPriority:'normal',confirmedDueDate:'2030-01-02',assignee:ids.design,collaborators:[]})
 await actor(ids.design);assert.equal(await scalar('select app.work_request_read($1)',[request]),true)
 await denied('select public.save_work_request($1,$2,$3,$4)',[request,revision,{assignee:ids.planner},crypto.randomUUID()],'42501')
 revision=await save(request,revision,{status:'inProgress'})
 await db.query('select public.set_active_work_request($1)',[request]);await db.query('select public.set_active_work_request($1)',[request]);assert.equal(await scalar('select count(*)::int from public.work_request_time_entries where mounted_at is not null'),1)
 await denied('select public.send_work_request_message($1,$2,$3,$4)',[request,'requester','secret',crypto.randomUUID()],'42501')
 await db.query('select public.send_work_request_message($1,$2,$3,$4)',[request,ids.design,'담당자 대화',crypto.randomUUID()])
 revision=await save(request,revision,{status:'completionReview',completionResult:'작업 결과'})
 assert.equal(await scalar('select count(*)::int from public.work_request_time_entries where mounted_at is not null'),0)
 await actor(ids.manager);revision=await save(request,revision,{status:'completionConfirm'})
 await actor(ids.planner2);await denied('select public.save_work_request($1,$2,$3,$4)',[request,revision,{status:'completed'},crypto.randomUUID()],'42501')
 await actor(ids.planner);revision=await save(request,revision,{status:'completed'});const loaded=await scalar('select public.list_work_requests(null)');assert.equal(loaded.requests[0].status,'completed');assert.equal(loaded.requests[0].completionResult,'작업 결과');assert.equal(loaded.requests[0].messages.length,0,'Requester cannot read worker-private thread')
 await denied("update public.work_requests set status='inProgress' where id=$1",[request],'42501')
 await db.exec('reset role');assert.equal(await scalar('select md5(jsonb_agg(to_jsonb(p) order by id)::text) from public.profiles p'),profileBefore,'User status/department/admin untouched')
 // Exercise the exact new operations save functions without changing any existing account state.
 await db.exec(`begin;
 create function app.can_edit_org_assignment() returns boolean language sql stable as $$select false$$;
 create function app.can_approve(uuid) returns boolean language sql stable as $$select false$$;
 create function app.can_set_department_attendance(uuid,uuid) returns boolean language sql stable as $$select false$$;
 create trigger test_profile_guard before update on public.profiles for each row execute function app.guard_profile_changes();
 create unique index test_company_hours on public.company_work_hours(company_id);
 create unique index test_start_options on public.attendance_start_options(company_id,start_time);
 create unique index test_start_department on public.attendance_start_settings(company_id,department_id,month) where employee_id is null;
 create unique index test_start_employee on public.attendance_start_settings(company_id,employee_id,month) where employee_id is not null;
 alter table public.employee_roster enable row level security;
 create trigger test_roster_guard before insert or update on public.employee_roster for each row execute function app.guard_employee_roster();
 alter table public.profiles enable row level security;
 create policy test_self_read on public.profiles for select to authenticated using(id=auth.uid());`)
 await actor(ids.ceo)
 await db.query("select app.save_company_lunch('12:00','13:00')")
 await db.query("select app.add_attendance_start_option('10:00')")
 assert.equal(await scalar("select app.save_attendance_start_settings('2030-01-01','2030-01-01',$1,null,'09:00',5)",[departments.planning]),1)
 assert.ok(await scalar("select app.save_company_notice(null,'company',null,'회사 공지','저장 검증',null,null,true)"))
 await db.query('update public.profiles set hire_date=$1 where id=$2',['2024-01-01',ids.planner])
 assert.equal(await scalar('select hire_date::text from public.profiles where id=$1',[ids.planner]),'2024-01-01')
 const deniedOps=async(sql,args=[])=>{await db.exec('savepoint expected_denial');await denied(sql,args);await db.exec('rollback to savepoint expected_denial')}
 await deniedOps("update public.profiles set status='pending' where id=$1",[ids.planner])
 await deniedOps('update public.profiles set is_admin=true where id=$1',[ids.planner])
 await db.query('insert into public.employee_roster(profile_id,company_id,note) values($1,$2,$3)',[ids.planner,company,'명부 저장'])
 await actor(ids.md)
 await deniedOps("select app.save_company_lunch('11:00','12:00')")
 await deniedOps('insert into public.employee_roster(profile_id,company_id,note) values($1,$2,$3)',[ids.md,company,'권한 없음'])
 await db.exec('reset role;rollback;')
 console.log('department-work-db: basic scopes, creator UUID, shared read, cross-owner denial, department field protection, operations saves without user approval/admin changes, real work lifecycle, duplicate/revision/timer/private chat, existing user preservation passed')
}catch(error){console.error('department-work-db:',{message:error.message,code:error.code,detail:error.detail,where:error.where});process.exitCode=1}finally{await db.close()}
