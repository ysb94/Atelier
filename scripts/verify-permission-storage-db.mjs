import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

// 저장 전용 변경이 기존 인증·승인·권한 함수에 손대지 않는지 실제 PostgreSQL로 확인한다.
const db=await PGlite.create()
const company='e0000000-0000-4000-8000-000000000001', other='e0000000-0000-4000-8000-000000000002'
const admin='10000000-0000-4000-8000-000000000001', staff='10000000-0000-4000-8000-000000000002', outsider='10000000-0000-4000-8000-000000000003'
const dept='20000000-0000-4000-8000-000000000001', foreignDept='20000000-0000-4000-8000-000000000002'
const actor=async id=>db.exec(`reset role; select set_config('request.jwt.claim.sub','${id}',false); set role authenticated;`)
const scalar=async(sql,params)=>Object.values((await db.query(sql,params)).rows[0])[0]
async function denied(sql,params,code='42501'){await assert.rejects(()=>db.query(sql,params),error=>error.code===code)}
async function originals(){return (await db.query(`select jsonb_build_object(
 'profiles',(select jsonb_agg(to_jsonb(p) order by id) from public.profiles p),
 'approvers',(select jsonb_agg(to_jsonb(a) order by department_id) from public.department_request_approvers a),
 'functions',(select jsonb_agg(pg_get_functiondef(oid) order by proname) from pg_proc where pronamespace='app'::regnamespace and proname in ('is_admin','usage_partner_can_manage','is_chat_room_member')),
 'policies',(select jsonb_agg(to_jsonb(p) order by policyname) from pg_policies p where tablename='profiles')) as snapshot`)).rows[0].snapshot}
try{
 await db.exec(`create role anon; create role authenticated; create schema app; create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public,app,auth to authenticated,anon;
 create table public.companies(id uuid primary key);
 create table public.departments(id uuid primary key,company_id uuid,name text,is_active boolean);
 create table public.profiles(id uuid primary key,company_id uuid,department_id uuid,display_name text,status text,position text,is_admin boolean);
 create table public.brands(id uuid primary key,company_id uuid,name text);
 create table public.code_usage_targets(id uuid primary key,brand_id uuid,name text);
 create table public.chat_rooms(id uuid primary key,company_id uuid,name text);
 create table public.department_request_approvers(company_id uuid,department_id uuid,request_type text,approver_id uuid,substitute_id uuid);
 create function app.is_admin() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.profiles where id=auth.uid() and status='active' and is_admin)$$;
 create function app.usage_partner_can_manage(uuid) returns boolean language sql stable as $$select false$$;
 create function app.is_chat_room_member(uuid) returns boolean language sql stable as $$select false$$;
 alter table public.profiles enable row level security;
 create policy profile_self_read on public.profiles for select to authenticated using(id=auth.uid());
 insert into public.companies values('${company}'),('${other}');
 insert into public.departments values('${dept}','${company}','디자인팀',true),('${foreignDept}','${other}','다른 회사 부서',true);
 insert into public.profiles values('${admin}','${company}','${dept}','기존 관리자','active','사원',true),('${staff}','${company}','${dept}','기존 직원','active','사원',false),('${outsider}','${other}','${foreignDept}','다른 회사 직원','active','사원',true);
 insert into public.department_request_approvers values('${company}','${dept}','leave','${staff}','${admin}');`)
 const before=await originals()
 const files=(await fs.readdir('supabase/migrations')).filter(name=>name.endsWith('_permission_assignment_storage.sql'))
 assert.equal(files.length,1)
 await db.exec(await fs.readFile(`supabase/migrations/${files[0]}`,'utf8'))
 assert.deepEqual(await originals(),before,'기존 사용자·승인자·권한 함수·프로필 RLS를 그대로 유지')
 await actor(admin)
 let directory=await scalar('select public.permission_directory()')
 assert.equal(directory.activation,'pending')
 assert.equal(directory.grants.length,0,'기존 사용자에게 새 권한을 일괄 부여하지 않음')
 assert.equal(directory.profiles.length,2,'같은 회사의 직원만 조회')
 const args=[staff,'notice.department.write','department',dept]
 await denied('select public.set_permission_grant($1,$2,$3,$4,true,$5)',[admin,'permissions.manage','company',company,directory.revision])
 await denied('select public.set_permission_grant($1,$2,$3,$4,true,$5)',[outsider,'notice.department.write','department',dept,directory.revision],'P0001')
 await denied('select public.set_permission_grant($1,$2,$3,$4,true,$5)',[staff,'notice.department.write','department',foreignDept,directory.revision])
 await db.query('select public.set_permission_grant($1,$2,$3,$4,true,$5)',[...args,directory.revision])
 await denied('select public.set_permission_grant($1,$2,$3,$4,true,$5)',[...args,directory.revision],'40001')
 directory=await scalar('select public.permission_directory()')
 assert.equal(directory.grants.length,1,'재조회해도 지정한 사람·기능·범위가 유지')
 assert.equal(directory.events.length,1)
 await actor(staff)
 assert.equal((await scalar('select public.list_my_permission_grants()')).length,1)
 assert.equal(await scalar('select app.is_admin()'),false,'저장만으로 기존 관리자 권한이 바뀌지 않음')
 await denied('select public.permission_directory()')
 await denied('delete from public.permission_grants')
 await actor(outsider)
 assert.equal(await scalar('select count(*) from public.permission_grants'),0,'회사 간 RLS 격리')
 await actor(admin)
 await db.query('select public.set_permission_grant($1,$2,$3,$4,false,$5)',[...args,directory.revision])
 directory=await scalar('select public.permission_directory()')
 assert.equal(directory.grants.length,0)
 assert.equal(directory.events.length,2,'지정·해제 이력 보존')
 await db.exec('reset role')
 assert.deepEqual(await originals(),before,'전체 검증 뒤에도 사용자·승인 상태·승인자·기존 정책 불변')
 console.log('permission-storage-db: 실제 저장·재조회·해제·이력·본인/타사/동시 수정 차단·기존 사용자/승인자/함수/RLS 보존 통과 (운영 연결 없음)')
}catch(error){console.error('permission-storage-db 실패:',{message:error.message,code:error.code,detail:error.detail});process.exitCode=1}finally{await db.close()}
