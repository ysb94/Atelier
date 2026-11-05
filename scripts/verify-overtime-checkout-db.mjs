import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
const db=new PGlite(),id=n=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const employee=id(1),peer=id(2),ops=id(3),otherCompany=id(4),approver=id(5),company=id(20),foreign=id(21),request=id(10),pending=id(11),clock=id(30)
const value=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0]
const actor=async who=>db.exec(`reset role;set request.jwt.claim.sub='${who}';set role authenticated`)
const asOwner=async sql=>{await db.exec('reset role');await db.exec(sql);await actor(employee)}
const end=async time=>asOwner(`update attendance_clock_ins set clock_out_at='2020-01-06T${time}:00+09:00',clock_out_source='manual' where id='${clock}'`)
const actual=()=>value(`select end_at from overtime_actual_with_checkout where request_id='${request}'`)
try {
await db.exec(`create role authenticated;create role anon;create schema app;create schema auth;
grant usage on schema app,auth,public to authenticated;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table profiles(id uuid primary key,company_id uuid,status text,department_id uuid,operations boolean);
insert into profiles values('${employee}','${company}','active',null,false),('${peer}','${company}','active',null,false),('${ops}','${company}','active',null,true),('${otherCompany}','${foreign}','active',null,true),('${approver}','${company}','active',null,false);
create function app.can_edit_org_assignment() returns boolean language sql stable security definer as $$select coalesce((select operations from public.profiles where id=auth.uid()),false)$$;
create function app.company_review_company_id() returns uuid language sql stable as $$select null::uuid$$;
create function app.is_department_request_approver(uuid,uuid,text) returns boolean language sql stable as $$select auth.uid()='${approver}'::uuid$$;
create function app.attendance_start_for_date(uuid,date) returns time language sql stable as $$select time '09:00'$$;
create table company_leave_requests(id uuid primary key,employee_id uuid,company_id uuid,department_id uuid,kind text,status text,from_date date,to_date date,start_time time,end_time time,end_next_day boolean default false,decided_by uuid,decided_at timestamptz,created_at timestamptz default now(),offsite_continuous boolean default false);
insert into company_leave_requests(id,employee_id,company_id,kind,status,from_date,to_date,start_time,end_time) values
 ('${request}','${employee}','${company}','overtime','approved','2020-01-06','2020-01-06','18:00','20:00'),
 ('${pending}','${employee}','${company}','overtime','pending','2020-01-07','2020-01-07','18:00','20:00');
alter table company_leave_requests enable row level security;
grant select on company_leave_requests,profiles to authenticated;
create policy leave_read on company_leave_requests for select to authenticated using(company_id=(select company_id from profiles where id=auth.uid() and status='active') and (employee_id=auth.uid() or app.can_edit_org_assignment() or app.is_department_request_approver(company_id,department_id,kind)));
create table attendance_clock_ins(id uuid primary key,employee_id uuid,company_id uuid,work_date date,clock_in time,clock_out_at timestamptz,clock_out_reported_at timestamptz,auto_closed_at timestamptz,work_confirmed_at timestamptz,clock_in_source text,clock_out_source text,offsite_returned_at timestamptz);
insert into attendance_clock_ins(id,employee_id,company_id,work_date,clock_in,clock_out_at) values('${clock}','${employee}','${company}','2020-01-06','09:00','2020-01-06T20:00:00+09:00');
alter table attendance_clock_ins enable row level security;grant select on attendance_clock_ins to authenticated;
create policy clocks_read on attendance_clock_ins for select to authenticated using(employee_id=auth.uid() or (company_id=(select company_id from profiles where id=auth.uid()) and app.can_edit_org_assignment()));
create table offsite_settlements(request_id uuid primary key,minutes_by_date jsonb);
create function app.offsite_finish(r company_leave_requests,d date) returns timestamptz language sql stable as $$select (d+r.end_time+case when r.end_next_day then interval '1 day' else interval '0' end) at time zone 'Asia/Seoul'$$;
create table app.leave_balance_holidays(day date primary key);`)
await db.exec(await readFile('supabase/migrations/20261103081759_overtime_actual_reports.sql','utf8'))
await actor(employee)
await db.query('select save_overtime_actual($1,$2,$3,15,0)',[request,'2020-01-06T18:00:00+09:00','2020-01-06T19:00:00+09:00'])
await db.exec('reset role')
const history=await value('select md5(jsonb_agg(r order by request_id,revision)::text) from overtime_actual_reports r')
const oldView=await value("select pg_get_viewdef('overtime_actual_latest'::regclass,true)")
const requestsBefore=await value('select md5(jsonb_agg(r order by id)::text) from company_leave_requests r')
const policiesBefore=await value('select md5(jsonb_agg(p order by schemaname,tablename,policyname)::text) from pg_policies p')
const migration=await readFile('supabase/migrations/20261105024604_overtime_checkout_link.sql','utf8')
await assert.rejects(db.exec(migration),/function changed|policy changed/,'drift preflight stops unknown definitions')
// The fixture policy is deliberately smaller; production preflight is checked above.
await db.exec(migration.slice(migration.indexOf('-- Null for every existing clock')))
await db.exec(`create function public.undo_clock_out_today() returns void language sql security definer as $$select app.undo_clock_out_today_original()$$;revoke all on function public.undo_clock_out_today() from public,anon;grant execute on function public.undo_clock_out_today() to authenticated;`)
assert.equal(await value("select pg_get_viewdef('overtime_actual_latest'::regclass,true)"),oldView,'old deployed read API unchanged')
assert.equal(await value('select md5(jsonb_agg(r order by request_id,revision)::text) from overtime_actual_reports r'),history)
assert.equal(await value('select md5(jsonb_agg(r order by id)::text) from company_leave_requests r'),requestsBefore)
assert.equal(await value('select md5(jsonb_agg(p order by schemaname,tablename,policyname)::text) from pg_policies p'),policiesBefore)
await actor(employee)
assert.equal(Number(await value(`select break_minutes from overtime_actual_with_checkout where request_id='${request}'`)),15,'old report untouched')
await asOwner(`insert into company_leave_requests(id,employee_id,company_id,kind,status,from_date,to_date,start_time,end_time,decided_at) values('${id(16)}','${employee}','${company}','correction','approved','2020-01-06','2020-01-06','09:00','21:30',clock_timestamp())`)
assert.equal(new Date(await actual()).toISOString(),'2020-01-06T12:30:00.000Z','newer correction links a legacy manual report without rewriting it')
await asOwner(`delete from company_leave_requests where id='${id(16)}'`)
assert.equal(Number(await value(`select break_minutes from overtime_actual_with_checkout where request_id='${request}'`)),15,'legacy retained without a newer correction')
await end('21:00')
assert.equal(new Date(await actual()).toISOString(),'2020-01-06T12:00:00.000Z','beyond planned end accepted')
assert.equal(await value(`select clock_linked from overtime_actual_with_checkout where request_id='${request}'`),true)
assert.equal(Number(await value(`select break_minutes from overtime_actual_with_checkout where request_id='${request}'`)),0)
await end('19:00');assert.equal(new Date(await actual()).toISOString(),'2020-01-06T10:00:00.000Z','early checkout')
await end('17:00');assert.equal(new Date(await actual()).toISOString(),'2020-01-06T08:00:00.000Z','before start retained for zero-hour display')
await asOwner(`update attendance_clock_ins set clock_out_at=null where id='${clock}'`)
assert.equal(Number(await value(`select count(*) from overtime_actual_with_checkout where request_id='${request}'`)),0,'undo does not revive old manual report')
await end('22:00');assert.equal(new Date(await actual()).toISOString(),'2020-01-06T13:00:00.000Z')
const countBefore=await value('select count(*) from overtime_actual_reports');await end('22:00');assert.equal(await value('select count(*) from overtime_actual_reports'),countBefore,'no duplicate auto history')
await actor(approver);assert.equal(Number(await value('select count(*) from attendance_clock_ins')),0,'no raw attendance privilege')
assert.equal(Number(await value('select count(*) from overtime_actual_with_checkout')),1,'existing approver report scope preserved')
for(const who of [peer,otherCompany]) {await actor(who);assert.equal(Number(await value('select count(*) from overtime_actual_with_checkout')),0);await assert.rejects(db.query(`select app.overtime_clock_state('${request}')`),e=>e.code==='42501')}
await actor(ops);assert.equal(Number(await value('select count(*) from overtime_actual_with_checkout')),1)
await actor(employee);await assert.rejects(db.exec(`update attendance_clock_ins set clock_out_at=now()`),e=>e.code==='42501')
await asOwner(`insert into attendance_clock_ins(id,employee_id,company_id,work_date,clock_in,clock_out_at,clock_out_source) values('${id(31)}','${employee}','${company}','2020-01-07','09:00','2020-01-07T21:00:00+09:00','manual')`)
assert.equal(Number(await value(`select count(*) from overtime_actual_with_checkout where request_id='${pending}'`)),0)
await asOwner(`update company_leave_requests set status='approved' where id='${pending}'`)
assert.equal(Number(await value(`select count(*) from overtime_actual_with_checkout where request_id='${pending}'`)),1,'late approval uses recorded checkout')
await asOwner(`insert into company_leave_requests(id,employee_id,company_id,kind,status,from_date,to_date,start_time,end_time) values('${id(12)}','${employee}','${company}','correction','approved','2020-01-06','2020-01-06','09:00','23:00')`)
assert.equal(new Date(await actual()).toISOString(),'2020-01-06T14:00:00.000Z','approved correction wins')
await asOwner(`update company_leave_requests set status='cancelled' where id='${id(12)}'`)
await asOwner(`insert into company_leave_requests(id,employee_id,company_id,kind,status,from_date,to_date,start_time,end_time) values('${id(13)}','${employee}','${company}','overtime','approved','2020-01-06','2020-01-06','21:00','23:00')`)
assert.equal(new Date(await actual()).toISOString(),'2020-01-06T12:00:00.000Z','multiple requests partition at next start')
await asOwner(`update company_leave_requests set status='cancelled' where id='${id(13)}'`)
await asOwner(`update attendance_clock_ins set clock_out_at='2020-01-07T01:00:00+09:00',clock_out_source='manual' where id='${clock}'`)
assert.equal(new Date(await actual()).toISOString(),'2020-01-06T16:00:00.000Z','weekday midnight extension')
await asOwner(`insert into company_leave_requests(id,employee_id,company_id,kind,status,from_date,to_date,start_time,end_time) values('${id(15)}','${employee}','${company}','overtime','approved','2020-01-10','2020-01-10','22:00','23:00');insert into attendance_clock_ins(id,employee_id,company_id,work_date,clock_in,clock_out_at,clock_out_source) values('${id(32)}','${employee}','${company}','2020-01-10','09:00','2020-01-11T01:00:00+09:00','manual');update attendance_clock_ins set overtime_linked_at=null where id='${id(32)}'`)
const split=(await db.query(`select end_at,checkout_at from overtime_actual_with_checkout where request_id='${id(15)}'`)).rows[0]
assert.equal(new Date(split.end_at).toISOString(),'2020-01-10T15:00:00.000Z','Friday regular overtime stops at holiday boundary')
assert.equal(new Date(split.checkout_at).toISOString(),'2020-01-10T16:00:00.000Z','actual checkout remains intact')
await end('20:00')
await asOwner(`insert into app.leave_balance_holidays values('2020-01-06')`)
assert.equal(new Date(await actual()).toISOString(),'2020-01-06T09:00:00.000Z','holiday handled separately')
await asOwner('delete from app.leave_balance_holidays')
await asOwner(`insert into company_leave_requests(id,employee_id,company_id,kind,status,from_date,to_date,start_time,end_time) values('${id(14)}','${employee}','${company}','offsite','approved','2020-01-06','2020-01-06','09:00','21:00');insert into offsite_settlements values('${id(14)}','{}')`)
assert.equal(Number(await value(`select count(*) from overtime_actual_with_checkout where request_id='${request}'`)),0,'no double counting settled offsite')
await asOwner(`delete from offsite_settlements;update attendance_clock_ins set clock_out_at='2020-01-06T21:00:00+09:00',clock_out_source='offsite' where id='${clock}'`)
assert.equal(Number(await value(`select count(*) from overtime_actual_with_checkout where request_id='${request}'`)),0,'synthetic checkout excluded')
await db.exec('reset role');assert.equal(await value('select md5(jsonb_agg(r order by request_id,revision)::text) from overtime_actual_reports r'),history,'history append-free automatic calculation')
// Actual checkout RPC uses server time, is idempotent, and undo removes derived overtime.
const today=await value("select (clock_timestamp() at time zone 'Asia/Seoul')::date::text"),yesterday=await value("select ((clock_timestamp() at time zone 'Asia/Seoul')::date-1)::text")
await db.exec(`insert into company_leave_requests(id,employee_id,company_id,kind,status,from_date,to_date,start_time,end_time) values('${id(50)}','${employee}','${company}','overtime','approved','${today}','${today}','00:00','00:01');insert into attendance_clock_ins(id,employee_id,company_id,work_date,clock_in) values('${id(51)}','${employee}','${company}','${today}','00:00')`)
await actor(employee);const stamp=await value('select app.clock_out_today()');assert.equal(new Date(await value('select app.clock_out_today()')).getTime(),new Date(stamp).getTime())
assert.equal(Number(await value(`select count(*) from overtime_actual_with_checkout where request_id='${id(50)}'`)),1)
await value('select public.undo_clock_out_today()');assert.equal(Number(await value(`select count(*) from overtime_actual_with_checkout where request_id='${id(50)}'`)),0)
await asOwner(`delete from attendance_clock_ins where id='${id(51)}';create or replace function app.attendance_start_for_date(uuid,date) returns time language sql stable as $$select time '23:59'$$;
insert into company_leave_requests(id,employee_id,company_id,kind,status,from_date,to_date,start_time,end_time) values('${id(52)}','${employee}','${company}','overtime','approved','${yesterday}','${yesterday}','22:00','23:00');insert into attendance_clock_ins(id,employee_id,company_id,work_date,clock_in) values('${id(53)}','${employee}','${company}','${yesterday}','09:00')`)
await value('select app.clock_out_today()');assert.equal(Number(await value(`select count(*) from overtime_actual_with_checkout where request_id='${id(52)}'`)),1,'overnight actual beyond planned end')
await value('select public.undo_clock_out_today()');assert.equal(Number(await value(`select count(*) from overtime_actual_with_checkout where request_id='${id(52)}'`)),0)
await asOwner(`create or replace function app.attendance_start_for_date(uuid,date) returns time language sql stable as $$select time '00:00'$$`)
await assert.rejects(db.query('select app.clock_out_today()'),/오늘 출근/,'next shift does not keep yesterday open')
// Older deployed clients keep the append-only manual API, without planned end bounds.
await asOwner(`insert into company_leave_requests(id,employee_id,company_id,kind,status,from_date,to_date,start_time,end_time) values('${id(54)}','${employee}','${company}','overtime','approved','2020-01-08','2020-01-08','18:00','20:00')`)
await db.query('select save_overtime_actual($1,$2,$3,0,0)',[id(54),'2020-01-08T17:00:00+09:00','2020-01-08T22:00:00+09:00'])
assert.equal(Number(await value(`select count(*) from overtime_actual_latest where request_id='${id(54)}'`)),1)
await assert.rejects(db.query('select save_overtime_actual($1,$2,$3,0,0)',[id(54),'2020-01-08T17:00:00+09:00','2020-01-08T22:00:00+09:00']),e=>e.code==='40001')
await assert.rejects(db.query('select save_overtime_actual($1,$2,$3,0,1)',[id(54),'2020-01-09T17:00:00+09:00','2020-01-09T22:00:00+09:00']),e=>e.code==='23514')
await actor(peer);await assert.rejects(db.query('select save_overtime_actual($1,$2,$3,0,1)',[id(54),'2020-01-08T17:00:00+09:00','2020-01-08T22:00:00+09:00']),e=>e.code==='42501')
await asOwner(`update profiles set status='pending' where id='${employee}'`)
assert.equal(Number(await value('select count(*) from overtime_actual_with_checkout')),0,'inactive employee cannot read actual overtime')
await assert.rejects(db.query(`select app.overtime_clock_state('${request}')`),e=>e.code==='42501')
await db.exec('reset role;set role anon');await assert.rejects(db.query('select * from overtime_actual_with_checkout'),e=>e.code==='42501')
console.log('PASS: preserved legacy history/RLS; longer/shorter/zero/undo/late approval/corrections/duplicates/holiday/offsite/overnight/permissions/server checkout')
}catch(error){console.error({message:error.message,code:error.code,where:error.where,stack:error.stack?.split('\n').slice(0,3).join('\n')});process.exitCode=1}finally{await db.close()}
