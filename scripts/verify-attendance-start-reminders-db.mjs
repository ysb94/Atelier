import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
const db=new PGlite(),id=n=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0]
const owner=()=>db.exec('reset role'),actor=async n=>db.exec(`reset role;set request.jwt.claim.sub='${id(n)}';set role authenticated`)
const at=async stamp=>{await owner();await db.query("select set_config('test.clock',$1,false)",[stamp+'+09:00'])}
const dispatch=()=>scalar('select app.dispatch_attendance_start_reminders()')
const list=()=>scalar('select public.list_my_attendance_start_reminders()')
const read=async row=>scalar('select public.read_attendance_start_reminder($1,$2)',[row.id,row.version])
try{
await db.exec(`create schema app;create schema auth;create schema cron;create role authenticated;create role anon;
grant usage on schema app,public,auth to authenticated,anon;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function app.test_clock() returns timestamptz language sql stable as $$select current_setting('test.clock')::timestamptz$$;
create table cron.jobs(name text primary key,schedule text,command text);
create function cron.schedule(text,text,text) returns int language sql as $$insert into cron.jobs values($1,$2,$3);select 1$$;
create table companies(id uuid primary key);insert into companies values('${id(10)}'),('${id(11)}');
create table departments(id uuid primary key,company_id uuid,name text,is_active boolean);
insert into departments values('${id(20)}','${id(10)}','기획팀',true),('${id(21)}','${id(10)}','Visual',true),('${id(22)}','${id(11)}','타사',true);
create table profiles(id uuid primary key,company_id uuid,department_id uuid,status text);
insert into profiles values('${id(1)}','${id(10)}','${id(20)}','active'),('${id(2)}','${id(10)}','${id(21)}','active'),('${id(3)}','${id(10)}','${id(20)}','active'),('${id(4)}','${id(10)}','${id(20)}','active'),('${id(5)}','${id(10)}','${id(20)}','pending'),('${id(6)}','${id(11)}','${id(22)}','active');
create table attendance_exemptions(company_id uuid,profile_id uuid);insert into attendance_exemptions values('${id(10)}','${id(1)}'),('${id(10)}','${id(2)}'),('${id(11)}','${id(6)}');
create table department_request_approvers(company_id uuid,department_id uuid,approver_id uuid,substitute_id uuid);
insert into department_request_approvers values('${id(10)}','${id(20)}','${id(1)}','${id(2)}'),('${id(10)}','${id(20)}','${id(1)}','${id(2)}');
create table attendance_start_settings(id uuid primary key,company_id uuid,department_id uuid,employee_id uuid,month date,start_time time);
insert into attendance_start_settings values('${id(100)}','${id(10)}','${id(20)}',null,'2026-11-01','09:00');`)
await at('2026-11-23T09:00:00')
const snapshot=()=>scalar(`select md5(jsonb_build_object('settings',(select jsonb_agg(t order by id) from attendance_start_settings t),'profiles',(select jsonb_agg(t order by id) from profiles t),'departments',(select jsonb_agg(t order by id) from departments t),'approvers',(select jsonb_agg(t) from department_request_approvers t),'exemptions',(select jsonb_agg(t) from attendance_exemptions t),'policies',(select jsonb_agg(t) from pg_policies t))::text)`);const original=await snapshot()
const source=await readFile('supabase/migrations/20261105101454_attendance_start_reminders.sql','utf8')
assert.equal(/dispatch_attendance_start_reminders\([^)]*p_/.test(source),false,'production dispatcher accepts no forged time')
await db.exec(source.replaceAll('clock_timestamp()','app.test_clock()'))
assert.equal(await snapshot(),original,'migration preserves existing staff/settings/approvals/exemptions/policies')
assert.equal(await scalar("select schedule from cron.jobs where name='atelier-attendance-start-reminders'"),'0 0 * * *')
assert.equal(await scalar('select count(*) from app.attendance_start_reminders'),0,'no past-month backfill')
await at('2026-11-24T08:59:59');assert.equal(await dispatch(),0)
await at('2026-11-24T09:00:00');assert.equal(await dispatch(),1)
assert.equal(await dispatch(),0,'same day retry is idempotent')
await actor(1);let rows=await list();assert.equal(rows.length,1,'duplicate approval types yield one notification')
let row=rows[0];assert.equal(row.month,'2026-12');assert.equal(row.total,2);assert.equal(row.missing,2);assert.equal(row.overdue,false)
await assert.rejects(db.query('select * from app.attendance_start_reminders'),e=>e.code==='42501')
await assert.rejects(dispatch(),e=>e.code==='42501','employees cannot issue versions')
assert.equal(await read(row),true);assert.equal(await read(row),false,'repeated reads do not rewrite')
assert.ok((await list())[0].readAt)
await actor(2);assert.equal((await list())[0].readAt,null,'substitute has independent shared-server read state');assert.equal(await read(row),true)
for(const n of [3,6]){await actor(n);assert.deepEqual(await list(),[]);assert.equal(await read(row),false)}
await actor(5);await assert.rejects(list(),e=>e.code==='42501')
await db.exec('reset role;set role anon');await assert.rejects(list(),e=>e.code==='42501')
await at('2026-11-25T09:00:00');assert.equal(await dispatch(),1)
await actor(1);let next=(await list())[0];assert.notEqual(next.version,row.version);assert.equal(next.readAt,null)
assert.equal(await read(row),false,'stale displayed event cannot read the next day');assert.equal(await read(next),true)
await owner();await db.exec(`insert into attendance_start_settings values('${id(101)}','${id(10)}','${id(20)}',null,'2026-12-01','09:00')`)
await actor(1);assert.equal((await list())[0].current,false,'department default completes immediately without waiting for cron')
await at('2026-11-26T09:00:00');assert.equal(await dispatch(),0)
await owner();await db.exec(`insert into attendance_start_settings values('${id(102)}','${id(10)}','${id(20)}','${id(3)}','2026-12-01',null)`)
await actor(1);next=(await list())[0];assert.equal(next.missing,1,'individual unset overrides common setting like the UI');assert.equal(next.readAt,null)
assert.equal(await read(row),false,'changed missing roster invalidates an old read event')
await at('2026-12-01T09:00:00');assert.equal(await dispatch(),1)
await actor(1);assert.equal((await list())[0].overdue,true,'continue after target month starts')
await owner();await db.exec(`delete from attendance_start_settings where id='${id(102)}'`)
await actor(1);assert.equal((await list())[0].missing,0)
await at('2026-12-02T09:00:00');assert.equal(await dispatch(),0)
// Current assignment, department state and workforce override are always rechecked.
await owner();await db.exec(`delete from department_request_approvers where substitute_id='${id(2)}'`)
await actor(2);assert.deepEqual(await list(),[]);assert.equal(await read(next),false)
await owner();await db.exec(`create function app.workforce_mode(uuid) returns text language sql as $$select case when $1='${id(3)}' then 'external' else 'head-office' end$$`)
assert.equal((await db.query(`select total from app.attendance_start_progress('${id(10)}','${id(20)}','2026-12-01')`)).rows[0].total,1)
// Boundary months/year: each cycle begins exactly seven days before month start.
for(const [stamp,month]of [['2026-12-25T09:00:00','2027-01-01'],['2027-02-22T09:00:00','2027-03-01'],['2028-02-23T09:00:00','2028-03-01']]){
 await at(stamp);await dispatch();assert.ok(Number(await scalar('select count(*) from app.attendance_start_reminders where target_month=$1',[month]))>0)
}
console.log('PASS attendance reminder SQL: date/09:00 boundaries, leap/year rollover, dedupe, personal/common completion, shared recipient reads, stale versions, overdue, permissions, workforce scope, original settings preserved')
}finally{await db.close()}
