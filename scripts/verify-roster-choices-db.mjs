import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
const db=await PGlite.create(),company='e0000000-0000-4000-8000-000000000001',other='e0000000-0000-4000-8000-000000000002',manager='10000000-0000-4000-8000-000000000001',staff='10000000-0000-4000-8000-000000000002',outsider='10000000-0000-4000-8000-000000000003',ops='10000000-0000-4000-8000-000000000004'
const actor=async id=>db.exec(`reset role;select set_config('request.jwt.claim.sub','${id}',false);set role authenticated`)
const val=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0]
const denied=async(sql,args=[])=>assert.rejects(()=>db.query(sql,args))
try{
await db.exec(`create role anon;create role authenticated;create schema app;create schema auth;grant usage on schema public,app,auth to authenticated;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table companies(id uuid primary key);insert into companies values('${company}'),('${other}');
create table profiles(id uuid primary key,company_id uuid,status text,editor boolean,operations boolean);
insert into profiles values('${manager}','${company}','active',true,false),('${staff}','${company}','active',false,false),('${outsider}','${other}','active',true,false),('${ops}','${company}','active',false,true);
grant select on profiles to authenticated;
create function app.can_edit_org_assignment() returns boolean language sql stable as $$select coalesce((select editor from public.profiles where id=auth.uid()),false)$$;
create function app.basic_work_allowed(text) returns boolean language sql stable as $$select coalesce((select operations from public.profiles where id=auth.uid()),false)$$;
create table employee_roster(profile_id uuid,bank_name text,workplace text);insert into employee_roster values('${staff}','예전 은행','기존 사무실');`)
await db.exec(await readFile('supabase/migrations/20261028080858_employee_roster_header_settings.sql','utf8'))
await db.query("insert into employee_roster_header_settings(company_id,header_key,label,hidden) values($1,'bankName','급여은행',true)",[company])
const data=await val('select md5(jsonb_agg(r)::text) from employee_roster r')
const policies=await val("select md5(jsonb_agg(p order by policyname)::text) from pg_policies p where tablename='employee_roster_header_settings'")
const acl=await val("select relacl::text from pg_class where oid='public.employee_roster_header_settings'::regclass")
await db.exec(await readFile('supabase/migrations/20261102115851_roster_choice_options.sql','utf8'))
assert.equal(await val('select md5(jsonb_agg(r)::text) from employee_roster r'),data)
assert.equal(await val("select md5(jsonb_agg(p order by policyname)::text) from pg_policies p where tablename='employee_roster_header_settings'"),policies)
assert.equal(await val("select relacl::text from pg_class where oid='public.employee_roster_header_settings'::regclass"),acl)
await actor(manager)
await db.query("select save_roster_choice_options('bankName',$1,0)",[['은행 B','은행 A']])
let row=(await db.query("select * from employee_roster_header_settings where header_key='bankName'")).rows[0]
assert.equal(row.label,'급여은행');assert.equal(row.hidden,true);assert.deepEqual(row.choice_options,['은행 B','은행 A']);assert.equal(Number(row.choice_revision),1)
await denied("select save_roster_choice_options('bankName',$1,0)",[['덮어쓰기']])
await denied("select save_roster_choice_options('bankName',$1,1)",[['중복','중복']])
await denied("select save_roster_choice_options('gender',$1,0)",[['12345678901']])
await denied("select save_roster_choice_options('phone',$1,0)",[['잘못된 헤더']])
await denied("select save_roster_choice_options('bankName',$1,1)",[[null]])
await denied("select save_roster_choice_options('bankName',$1,1)",[Array.from({length:101},(_,i)=>String(i))])
await db.query("select save_roster_choice_options('bankName',$1,1)",[[]]);assert.deepEqual(await val("select choice_options from employee_roster_header_settings where header_key='bankName'"),[])
await actor(staff);assert.equal(Number(await val('select count(*) from employee_roster_header_settings')),1)
await denied("select save_roster_choice_options('bankName',$1,2)",[['일반 직원 수정']])
await actor(outsider);assert.equal(Number(await val('select count(*) from employee_roster_header_settings')),0)
await db.query("select save_roster_choice_options('bankName',$1,0)",[['타사 은행']])
await actor(ops);await db.query("select save_roster_choice_options('workplace',$1,0)",[['사무실 A','사무실 B']])
await db.exec('reset role');assert.equal(await val('select md5(jsonb_agg(r)::text) from employee_roster r'),data)
await db.exec('set role anon');await denied("select save_roster_choice_options('gender',$1,0)",[['여']]);await denied('select * from employee_roster_header_settings')
console.info('Roster choices DB: existing values/labels/visibility/policies preserved; ordering, empty lists, conflicts, validation, manager/operations/staff/company/anon scope passed')
}catch(error){console.error(error.message,{code:error.code});process.exitCode=1}finally{await db.close()}
