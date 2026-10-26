import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const db=await PGlite.create()
try {
 await db.exec(`create role anon; create role authenticated; create schema app; create schema auth;
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema public,app,auth to anon,authenticated;
 create table public.companies(id uuid primary key);
 create table public.profiles(id uuid primary key,company_id uuid,status text,is_admin boolean);
 grant select on public.profiles to authenticated;
 create function app.can_edit_org_assignment() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.profiles where id=auth.uid() and status='active' and is_admin) $$;
 insert into public.companies values('10000000-0000-4000-8000-000000000001');
 insert into public.profiles values('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','active',true),('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','active',false);`)
 await db.exec(await readFile('supabase/migrations/20261026112500_employee_roster.sql','utf8'))
 await db.exec(`select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',false);`)
 await db.exec(`insert into public.employee_roster(profile_id,company_id,phone,note) values('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','기존 전화번호','기존 메모')`)
 const before=(await db.query('select phone,note from public.employee_roster')).rows
 await db.exec(await readFile('supabase/migrations/20261026122732_employee_remaining_annual_leave.sql','utf8'))
 assert.equal((await db.query('select remaining_annual_leave from public.employee_roster')).rows[0].remaining_annual_leave,null,'미등록은 0으로 바꾸지 않음')
 await db.exec(`select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',false);set role authenticated;`)
 for(const value of [0,7.75,-4.5]){
  await db.query('update public.employee_roster set remaining_annual_leave=$1',[value])
  assert.equal(Number((await db.query('select remaining_annual_leave from public.employee_roster')).rows[0].remaining_annual_leave),value)
 }
 assert.deepEqual((await db.query('select phone,note from public.employee_roster')).rows,before,'명부의 다른 값 유지')
 await db.exec(`reset role;select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',false);set role authenticated;`)
 assert.equal((await db.query('select remaining_annual_leave from public.employee_roster')).rows.length,0,'일반 직원에게 명부 추가 공개하지 않음')
 assert.equal((await db.query('update public.employee_roster set remaining_annual_leave=99 returning profile_id')).rows.length,0)
 await db.exec('reset role;set role anon')
 await assert.rejects(()=>db.query('select remaining_annual_leave from public.employee_roster'),/permission denied/)
 console.log('roster-leave-balance: 미등록/0/소수/음수·기존 명부 보존·운영지원 조회·일반직원/익명 제한 통과 (로컬 PostgreSQL)')
} catch(error){console.error('roster-leave-balance:',{message:error.message,code:error.code});process.exitCode=1} finally {await db.close()}
