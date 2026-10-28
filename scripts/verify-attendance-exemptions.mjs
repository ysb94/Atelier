import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
const db=await PGlite.create()
const company='e0000000-0000-4000-8000-000000000001',other='e0000000-0000-4000-8000-000000000002'
const manager='20000000-0000-4000-8000-000000000001',staff='20000000-0000-4000-8000-000000000002',foreign='20000000-0000-4000-8000-000000000003',inactive='20000000-0000-4000-8000-000000000004'
const initial=['2dedf0e7-3237-417a-a22f-1fc2cd89272a','56074867-fdc2-4ce5-8e97-cea431decc36']
const actor=async id=>db.exec(`reset role;select set_config('request.jwt.claim.sub','${id}',false);set role authenticated;`)
const value=async(sql,args)=>Object.values((await db.query(sql,args)).rows[0])[0]
const denied=async(sql,args)=>assert.rejects(()=>db.query(sql,args),error=>error.code==='42501')
try{
 await db.exec(`create role anon;create role authenticated;create schema app;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public,app,auth to authenticated,anon;
 create table public.companies(id uuid primary key);
 create table public.profiles(id uuid primary key,company_id uuid,status text,is_manager boolean,position text);
 create table public.attendance_clock_ins(id uuid primary key,employee_id uuid,clock_in time);
 grant select on public.profiles to authenticated;
 create function app.can_edit_org_assignment() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.profiles where id=auth.uid() and status='active' and is_manager)$$;
 insert into public.companies values('${company}'),('${other}');
 insert into public.profiles values('${initial[0]}','${company}','active',false,'이사'),('${initial[1]}','${company}','active',false,'대표이사'),
 ('${manager}','${company}','active',true,'사원'),('${staff}','${company}','active',false,'이사'),('${foreign}','${other}','active',true,'대표이사'),('${inactive}','${company}','disabled',true,'이사');
 insert into public.attendance_clock_ins values(gen_random_uuid(),'${staff}','10:30');`)
 const snapshot=await value("select md5(jsonb_build_object('profiles',(select jsonb_agg(to_jsonb(p) order by id) from public.profiles p),'clocks',(select jsonb_agg(to_jsonb(c) order by id) from public.attendance_clock_ins c))::text)")
 await db.exec(await readFile('supabase/migrations/20261028045843_attendance_exemptions.sql','utf8'))
 await actor(manager)
 assert.deepEqual(await value('select public.list_company_attendance_exempt()'),initial)
 assert.equal(await value('select public.is_my_attendance_exempt()'),false,'운영 권한이 있어도 자동 제외하지 않음')
 await actor(staff)
 assert.equal(await value('select public.is_my_attendance_exempt()'),false,'이사 직책이어도 명단에 없으면 제외하지 않음')
 await denied('select public.set_attendance_exemption($1,true)',[staff])
 await denied('insert into public.attendance_exemptions(company_id,profile_id,created_by) values($1,$2,$2)',[company,staff])
 await actor(manager)
 await db.query('select public.set_attendance_exemption($1,true)',[staff])
 await db.query('select public.set_attendance_exemption($1,true)',[staff])
 assert.equal((await value('select public.list_company_attendance_exempt()')).length,3,'중복 지정은 한 건')
 await denied('select public.set_attendance_exemption($1,true)',[foreign])
 await denied('select public.set_attendance_exemption($1,true)',[inactive])
 await actor(staff)
 assert.equal(await value('select public.is_my_attendance_exempt()'),true,'직접 지정 후 본인 제외')
 assert.equal(Number(await value('select count(*) from public.attendance_exemptions')),1,'명부 직접 조회는 본인만')
 assert.equal((await db.query('delete from public.attendance_exemptions returning profile_id')).rows.length,0,'본인도 임의 해제 불가')
 await actor(foreign)
 assert.deepEqual(await value('select public.list_company_attendance_exempt()'),[],'다른 회사 명단 차단')
 await denied('select public.set_attendance_exemption($1,true)',[staff])
 await actor(inactive)
 await denied('select public.is_my_attendance_exempt()')
 await denied('select public.list_company_attendance_exempt()')
 await actor(manager)
 await db.query('select public.set_attendance_exemption($1,false)',[staff])
 await db.query('select public.set_attendance_exemption($1,false)',[staff])
 assert.deepEqual(await value('select public.list_company_attendance_exempt()'),initial,'해제는 다른 제외자에 영향 없음')
 await actor(staff);assert.equal(await value('select public.is_my_attendance_exempt()'),false)
 await db.exec('reset role;set role anon');await denied('select public.list_company_attendance_exempt()');await denied('select public.is_my_attendance_exempt()')
 await db.exec('reset role')
 assert.equal(await value("select md5(jsonb_build_object('profiles',(select jsonb_agg(to_jsonb(p) order by id) from public.profiles p),'clocks',(select jsonb_agg(to_jsonb(c) order by id) from public.attendance_clock_ins c))::text)"),snapshot,'사용자·승인 상태·기존 출퇴근 기록 보존')
 console.log('attendance-exemptions: 기존 2명 승계·직책/운영 권한 무관·추가/해제/중복·본인 조회·관리자만 변경·타사/익명/미승인 차단·기존 사용자/출퇴근 보존 통과')
}finally{await db.close()}
