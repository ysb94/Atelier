import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
const db=await PGlite.create()
const staff='10000000-0000-4000-8000-000000000001',approver='10000000-0000-4000-8000-000000000002',peer='10000000-0000-4000-8000-000000000003'
const company='20000000-0000-4000-8000-000000000001',dept='30000000-0000-4000-8000-000000000001'
const actor=async id=>db.exec(`reset role;select set_config('request.jwt.claim.sub','${id}',false);set role authenticated`)
const val=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0]
try{
await db.exec(`create role anon;create role authenticated;create schema app;create schema auth;
grant usage on schema app,auth,public to authenticated;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table profiles(id uuid primary key,company_id uuid,status text);
insert into profiles values('${staff}','${company}','active'),('${approver}','${company}','active'),('${peer}','${company}','active');
grant select on profiles to authenticated;
create table company_leave_requests(id uuid primary key default gen_random_uuid(),company_id uuid,employee_id uuid,department_id uuid,employee_name text,kind text,from_date date default current_date,to_date date default current_date,start_time time default '09:00',end_time time default '18:00',note text default '',decision_note text,status text,created_at timestamptz default now(),advance_requested boolean default false);
alter table company_leave_requests enable row level security;
create policy request_read on company_leave_requests for select to authenticated using(employee_id=auth.uid() or auth.uid()='${approver}');
grant select on company_leave_requests to authenticated;
create function app.is_department_request_approver(uuid,uuid,text) returns boolean language sql stable as $$select auth.uid()='${approver}'::uuid$$;
create function list_my_approval_requests() returns setof company_leave_requests language sql security invoker as $$select * from public.company_leave_requests where auth.uid()='${approver}'::uuid$$;
create table attendance_exemptions(profile_id uuid);grant select on attendance_exemptions to authenticated;
create table clocks(employee_id uuid,work_date date,clock_in time,clock_out_at timestamptz,auto_closed_at timestamptz);
create function list_effective_attendance_clocks(date,date,uuid) returns setof clocks language sql security invoker as $$select * from public.clocks where employee_id=auth.uid()$$;
grant select on clocks to authenticated;
create table companies(id uuid primary key);insert into companies values('${company}');
create table meeting_rounds(id uuid primary key,schedule_version integer);
create table meeting_invitations(id uuid primary key,round_id uuid,profile_id uuid,sent_at timestamptz,read_at timestamptz);
create table meeting_host_notices(id uuid primary key,round_id uuid,recipient_id uuid,created_at timestamptz,read_at timestamptz);
create function app.meeting_notifications() returns jsonb language sql security definer as $$select coalesce(jsonb_agg(jsonb_build_object('id',id,'createdAt',sent_at,'readAt',read_at)),'[]'::jsonb) from public.meeting_invitations where profile_id=auth.uid()$$;
create function app.meeting_read_invitation(uuid) returns void language sql security definer as $$update public.meeting_invitations set read_at=coalesce(read_at,now()) where id=$1 and profile_id=auth.uid()$$;
insert into company_leave_requests(company_id,employee_id,department_id,employee_name,kind,status) values('${company}','${staff}','${dept}','직원','overtime','approved');`)
const original=await val('select md5(jsonb_agg(r)::text) from company_leave_requests r')
await db.exec(await readFile('supabase/migrations/20261102074629_my_home_notification_queue.sql','utf8'))
assert.equal(await val('select md5(jsonb_agg(r)::text) from company_leave_requests r'),original)
assert.equal(await val('select count(*)::int from my_home_request_events'),0,'No historical result backfill')
const id=await val(`insert into company_leave_requests(company_id,employee_id,department_id,employee_name,kind,status) values($1,$2,$3,'직원','overtime','pending') returning id`,[company,staff,dept])
await actor(approver)
let rows=await val('select list_my_home_work_notifications()');assert.equal(rows.length,1);assert.equal(rows[0].action_needed,true)
await db.query('select read_my_home_work_notification($1)',[rows[0].event_key]);await db.query('select read_my_home_work_notification($1)',[rows[0].event_key])
rows=await val('select list_my_home_work_notifications()');assert.ok(rows[0].read_at);assert.equal(rows[0].action_needed,true,'Read is separate from approval')
await actor(peer);assert.equal((await val('select list_my_home_work_notifications()')).length,0)
await assert.rejects(()=>db.query('select read_my_home_work_notification($1)',[`request-approval:${id}`]))
await assert.rejects(()=>db.query('insert into my_home_notification_reads(reader_id,event_key) values($1,$2)',[staff,'forged']))
await db.exec('reset role');await db.query("update company_leave_requests set status='approved' where id=$1",[id])
assert.equal(await val('select count(*)::int from my_home_request_events'),1)
await actor(approver);assert.equal((await val('select list_my_home_work_notifications()')).filter(row=>row.current).length,0,'Other approver completion removes pending')
await actor(staff);rows=await val('select list_my_home_work_notifications()');assert.equal(rows.length,1);assert.equal(rows[0].status,'approved');assert.equal(rows[0].action_needed,false)
await db.query('select read_my_home_work_notification($1)',[rows[0].event_key]);assert.ok((await val('select list_my_home_work_notifications()'))[0].read_at)
await db.exec('reset role')
const round=await val('insert into meeting_rounds values(gen_random_uuid(),1) returning id')
const invite=await val('insert into meeting_invitations values(gen_random_uuid(),$1,$2,now(),null) returning id',[round,staff])
const stamp=await val('select sent_at from public.meeting_invitations where id=$1',[invite])
await actor(peer);await assert.rejects(()=>db.query('select read_meeting_notice_version($1,$2,1)',[invite,stamp]))
await actor(staff);await assert.rejects(()=>db.query('select read_meeting_notice_version($1,$2,2)',[invite,stamp]))
await db.query('select read_meeting_notice_version($1,$2,1)',[invite,stamp])
await db.exec('reset role');assert.ok(await val('select read_at from public.meeting_invitations where id=$1',[invite]))
await db.query('update meeting_rounds set schedule_version=2 where id=$1',[round]);await db.query('update meeting_invitations set sent_at=clock_timestamp(),read_at=null where id=$1',[invite])
await actor(staff);await assert.rejects(()=>db.query('select read_meeting_notice_version($1,$2,1)',[invite,stamp]))
await db.exec('reset role');assert.equal(await val('select read_at from public.meeting_invitations where id=$1',[invite]),null)
await db.exec('reset role');
await db.query("insert into clocks values($1,current_date-1,'09:00',null,null)",[staff]);
await actor(staff);rows=await val('select list_my_home_work_notifications()');
assert.equal(rows.filter(row=>row.event_type==='checkout').length,1,'Missing previous checkout is actionable');
const checkout=rows.find(row=>row.event_type==='checkout');await db.query('select read_my_home_work_notification($1)',[checkout.event_key]);
assert.equal((await val('select list_my_home_work_notifications()')).find(row=>row.event_type==='checkout').action_needed,true,'Reading does not register checkout');
await db.exec('reset role');await db.query('update clocks set clock_out_at=now() where employee_id=$1',[staff]);
await actor(staff);assert.equal((await val('select list_my_home_work_notifications()')).filter(row=>row.event_type==='checkout').length,0);
await db.exec('reset role');await db.query("insert into clocks values($1,current_date-2,'09:00',null,null)",[peer]);
await actor(staff);assert.equal((await val('select list_my_home_work_notifications()')).filter(row=>row.event_type==='checkout').length,0,'Other employee clocks are excluded');
await db.exec('reset role');await db.query("update profiles set status='inactive' where id=$1",[staff]);await actor(staff);assert.equal((await val('select list_my_home_work_notifications()')).length,0);assert.equal(await val('select count(*)::int from my_home_notification_reads'),0,'Inactive staff cannot read notification metadata');
await db.exec('reset role');await db.exec('set role anon');await assert.rejects(()=>db.query('select list_my_home_work_notifications()'))
console.info('My home DB notifications: pending/read, result, idempotency, isolation, version guard passed')
} catch(error) { console.error(error.message,error.query??'');process.exitCode=1 } finally {await db.close()}
