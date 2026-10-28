import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
const db=await PGlite.create(),company='e0000000-0000-4000-8000-000000000001',other='e0000000-0000-4000-8000-000000000002',manager='10000000-0000-4000-8000-000000000001',staff='10000000-0000-4000-8000-000000000002',outsider='10000000-0000-4000-8000-000000000003',ops='10000000-0000-4000-8000-000000000004'
const actor=async id=>db.exec(`reset role;select set_config('request.jwt.claim.sub','${id}',false);set role authenticated`)
const value=async(sql,args)=>Object.values((await db.query(sql,args)).rows[0])[0]
const denied=async(sql,args)=>assert.rejects(()=>db.query(sql,args))
try{
 await db.exec(`create role anon;create role authenticated;create schema app;create schema auth;grant usage on schema auth,app,public to anon,authenticated;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.companies(id uuid primary key);create table public.profiles(id uuid primary key,company_id uuid,status text,manager boolean,basic boolean,display_name text);
 create table public.employee_roster(profile_id uuid,phone text);create table public.employee_roster_columns(id uuid,label text,kind text);create table public.employee_roster_values(column_id uuid,profile_id uuid,value text);
 create function app.can_edit_org_assignment() returns boolean language sql stable as $$select exists(select 1 from public.profiles where id=auth.uid() and manager and status='active')$$;
 create function app.basic_work_allowed(text) returns boolean language sql stable as $$select exists(select 1 from public.profiles where id=auth.uid() and basic and status='active')$$;
 grant select on public.profiles to authenticated;insert into public.companies values('${company}'),('${other}');
 insert into public.profiles values('${manager}','${company}','active',true,false,'관리 담당자'),('${staff}','${company}','active',false,false,'직원'),('${outsider}','${other}','active',true,false,'다른 회사'),('${ops}','${company}','active',false,true,'운영지원');
 insert into public.employee_roster values('${staff}','010-1234-5678');insert into public.employee_roster_columns values(gen_random_uuid(),'기존 헤더','text');insert into public.employee_roster_values select id,'${staff}','기존 값' from public.employee_roster_columns;`)
 const snapshot=await value("select md5(jsonb_build_array((select jsonb_agg(p) from public.profiles p),(select jsonb_agg(r) from public.employee_roster r),(select jsonb_agg(c) from public.employee_roster_columns c),(select jsonb_agg(v) from public.employee_roster_values v))::text)")
 await db.exec(await readFile('supabase/migrations/20261028080858_employee_roster_header_settings.sql','utf8'))
 await actor(manager);await db.query("insert into public.employee_roster_header_settings(company_id,header_key,label) values($1,'name','사원명')",[company]);await db.query("update public.employee_roster_header_settings set hidden=true where header_key='name'");assert.equal(await value("select hidden from public.employee_roster_header_settings where header_key='name'"),true);await db.query("update public.employee_roster_header_settings set hidden=false where header_key='name'");assert.equal(await value("select hidden from public.employee_roster_header_settings where header_key='name'"),false)
 await denied("update public.employee_roster_header_settings set company_id=$1",[other]);await denied("insert into public.employee_roster_header_settings(company_id,header_key,label) values($1,'name','가로채기')",[other]);await denied("update public.employee_roster_header_settings set label=''");await denied('delete from public.employee_roster_header_settings')
 await actor(staff);assert.equal(await value("select label from public.employee_roster_header_settings where header_key='name'"),'사원명');assert.equal((await db.query("update public.employee_roster_header_settings set label='변조' returning header_key")).rows.length,0);await denied("insert into public.employee_roster_header_settings(company_id,header_key,label) values($1,'department','변조')",[company])
 await actor(outsider);assert.equal(Number(await value('select count(*) from public.employee_roster_header_settings')),0);assert.equal((await db.query("update public.employee_roster_header_settings set label='변조' returning header_key")).rows.length,0)
 await actor(ops);await db.query("insert into public.employee_roster_header_settings(company_id,header_key,label,hidden) values($1,'column:existing','추가 표시명',true)",[company]);assert.equal(Number(await value('select count(*) from public.employee_roster_header_settings')),2)
 await db.exec('reset role;set role anon');await denied('select * from public.employee_roster_header_settings');await db.exec('reset role');assert.equal(await value("select md5(jsonb_build_array((select jsonb_agg(p) from public.profiles p),(select jsonb_agg(r) from public.employee_roster r),(select jsonb_agg(c) from public.employee_roster_columns c),(select jsonb_agg(v) from public.employee_roster_values v))::text)"),snapshot)
 console.log('roster-header-settings-db: 기본/추가 표시명·삭제/복원·관리/운영지원 저장·일반직원 읽기·타사/익명 차단·직원/명부/추가헤더/입력값 원본 보존 통과')
}catch(error){console.error(error.message,{code:error.code});process.exitCode=1}finally{await db.close()}
