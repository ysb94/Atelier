import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
const db=await PGlite.create()
const company='e0000000-0000-4000-8000-000000000001',other='e0000000-0000-4000-8000-000000000002'
const manager='10000000-0000-4000-8000-000000000001',staff='10000000-0000-4000-8000-000000000002',foreign='10000000-0000-4000-8000-000000000003'
const value=async(sql,args)=>Object.values((await db.query(sql,args)).rows[0])[0]
const actor=async id=>db.exec(`reset role;select set_config('request.jwt.claim.sub','${id}',false);set role authenticated`)
try{
 await db.exec(`create role anon;create role authenticated;create schema app;create schema auth;grant usage on schema app,auth,public to anon,authenticated;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.companies(id uuid primary key);create table public.profiles(id uuid primary key,company_id uuid,status text,manager boolean);
 create function app.can_edit_org_assignment() returns boolean language sql stable as $$select exists(select 1 from public.profiles where id=auth.uid() and manager and status='active')$$;
 grant select on public.profiles to authenticated;
 insert into public.companies values('${company}'),('${other}');insert into public.profiles values('${manager}','${company}','active',true),('${staff}','${company}','active',false),('${foreign}','${other}','active',true);`)
 await db.exec(await readFile('supabase/migrations/20261026112500_employee_roster.sql','utf8'))
 await db.exec(await readFile('supabase/migrations/20261026122732_employee_remaining_annual_leave.sql','utf8'))
 await db.exec(await readFile('supabase/migrations/20261028160000_inclusive_overtime_hours.sql','utf8'))
 await db.exec(`select set_config('app.roster_import','on',false);insert into public.employee_roster(profile_id,company_id,phone,remaining_annual_leave,inclusive_overtime_hours) values('${staff}','${company}','기존 연락처',7.5,null),('${foreign}','${other}','타사 기존값',2,10);select set_config('app.roster_import','off',false);`)
 const sourceSql="select md5(string_agg((to_jsonb(r)-'fixed_overtime_plan')::text,'' order by profile_id)) from public.employee_roster r"
 const aclSql="select md5(relacl::text) from pg_class where oid='public.employee_roster'::regclass"
 const policySql="select md5(string_agg(row(policyname,roles,cmd,qual,with_check)::text,'' order by policyname)) from pg_policies where schemaname='public' and tablename='employee_roster'"
 const before=await value(sourceSql),acl=await value(aclSql),policy=await value(policySql)
 await db.exec(await readFile('supabase/migrations/20261029031250_employee_fixed_overtime_plan.sql','utf8'))
 assert.equal(await value(sourceSql),before);assert.equal(await value(aclSql),acl);assert.equal(await value(policySql),policy)
 assert.equal(Number(await value("select count(*) from public.employee_roster where fixed_overtime_plan=''")),2)
 await actor(manager);await db.query('update public.employee_roster set fixed_overtime_plan=$1,inclusive_overtime_hours=$2 where profile_id=$3',['유형 1',16.3,staff])
 assert.equal(await value('select fixed_overtime_plan from public.employee_roster where profile_id=$1',[staff]),'유형 1')
 assert.equal(Number(await value('select inclusive_overtime_hours from public.employee_roster where profile_id=$1',[staff])),16.3)
 assert.equal(Number(await value('select remaining_annual_leave from public.employee_roster where profile_id=$1',[staff])),7.5)
 assert.equal(await value('select phone from public.employee_roster where profile_id=$1',[staff]),'기존 연락처')
 await db.query('update public.employee_roster set fixed_overtime_plan=$1 where profile_id=$2',['유형 2',staff])
 await assert.rejects(()=>db.query('update public.employee_roster set fixed_overtime_plan=$1 where profile_id=$2',['유형 3',staff]))
 await db.query("update public.employee_roster set fixed_overtime_plan='' where profile_id=$1",[staff])
 assert.equal(Number(await value('select inclusive_overtime_hours from public.employee_roster where profile_id=$1',[staff])),16.3,'classification must not silently alter agreed hours')
 assert.equal((await db.query("update public.employee_roster set fixed_overtime_plan='유형 2' where profile_id=$1 returning profile_id",[foreign])).rows.length,0)
 await actor(staff);assert.equal(Number(await value('select count(*) from public.employee_roster')),0)
 assert.equal((await db.query("update public.employee_roster set fixed_overtime_plan='유형 2' returning profile_id")).rows.length,0)
 await actor(foreign);assert.equal(Number(await value('select count(*) from public.employee_roster')),1)
 await db.exec('reset role;set role anon');await assert.rejects(()=>db.query('select fixed_overtime_plan from public.employee_roster'))
 console.log('fixed-overtime-plan-db: additive default, allowed types, independent hours, old leave/contact preservation, unchanged grants/RLS, staff/foreign/anonymous isolation passed')
}finally{await db.close()}
