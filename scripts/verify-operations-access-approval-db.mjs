import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

// 네트워크/운영 DB 연결 없이 실제 트리거와 RLS를 실행한다.
const db = await PGlite.create()
const company = 'e0000000-0000-4000-8000-000000000001'
const operations = '2e49ef43-75b9-4c89-b42d-9fd50ad9087b'
const actorId = '10000000-0000-4000-8000-000000000001'
const targetId = '10000000-0000-4000-8000-000000000002'
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0]
const migration = await readFile('supabase/migrations/20261105065548_operations_access_approval_guard_order.sql', 'utf8')
const departmentMigration = await readFile('supabase/migrations/20261105070652_operations_access_approval_department_guard.sql', 'utf8')
try {
  await db.exec(`
    create role anon; create role authenticated; create schema auth; create schema app;
    create function auth.uid() returns uuid language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
    grant usage on schema public,app,auth to authenticated,anon;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
    create table public.departments(id uuid primary key,company_id uuid,name text,is_active boolean,personnel_scope text);
    create table public.profiles(id uuid primary key references auth.users(id),email text not null,display_name text,avatar_url text,
      department_id uuid references public.departments(id),position text,is_admin boolean not null default false,
      status text not null default 'pending' check(status in('active','pending','rejected','disabled')),
      requested_at timestamptz,approved_by uuid references public.profiles(id),approved_at timestamptz,request_note text,
      created_at timestamptz not null default now(),updated_at timestamptz not null default now(),company_id uuid,
      name_confirmed_at timestamptz,job_grade text,hire_date date);
    create table public.personnel_titles(company_id uuid,kind text,name text);
    create function app.handle_new_user() returns trigger language plpgsql security definer set search_path='' as $$begin
      insert into public.profiles(id,email,status) values(new.id,coalesce(new.email,''),'pending'); return new; end;$$;
    create trigger on_auth_user_created after insert on auth.users for each row execute function app.handle_new_user();
    create function app.is_admin() returns boolean language sql stable security definer set search_path='' as $$
      select exists(select 1 from public.profiles where id=auth.uid() and status='active' and is_admin)$$;
    create function app.is_dev_login() returns boolean language sql stable as $$select false$$;
    create function app.is_company_manager() returns boolean language sql stable as $$select false$$;
    create function app.can_manage_personnel() returns boolean language sql stable security definer set search_path='' as $$
      select app.is_admin() or exists(select 1 from public.profiles p join public.departments d on d.id=p.department_id
        where p.id=auth.uid() and p.status='active' and d.is_active and
        (d.personnel_scope='members' or(d.personnel_scope='leaders' and p.position in('팀장','이사'))))$$;
    create function app.can_approve(uuid) returns boolean language sql stable security definer set search_path='' as $$select app.can_manage_personnel()$$;
    create function app.can_edit_org_assignment() returns boolean language sql stable security definer set search_path='' as $$
      select app.is_dev_login() or exists(select 1 from public.profiles p left join public.departments d on d.id=p.department_id
        where p.id=auth.uid() and p.status='active' and(lower(p.email)='dev@atelier.local' or(d.is_active and d.name='운영지원팀')))$$;
    create function app.basic_work_allowed(text) returns boolean language sql stable security definer set search_path='' as $$
      select exists(select 1 from public.profiles where id=auth.uid() and status='active' and company_id='${company}'
        and department_id='${operations}')$$;
    insert into public.departments values('${operations}','${company}','운영지원팀',true,'leaders');
    insert into auth.users values('${actorId}','operations@example.invalid','{}'),('${targetId}','pending@example.invalid','{}');
    update public.profiles set company_id='${company}',display_name='검증 직원';
    update public.profiles set status='active',department_id='${operations}' where id='${actorId}';
  `)
  await db.exec(await readFile('supabase/migrations/20261105041100_operations_access_approval.sql', 'utf8'))
  await db.exec(`
    alter table public.profiles enable row level security;
    grant select,update on public.profiles to authenticated;
    grant select on public.departments,public.personnel_titles to authenticated;
    create policy profiles_select_self_or_approver on public.profiles for select to authenticated
      using(id=auth.uid() or app.can_view_members());
    create policy profiles_update_self_or_approver on public.profiles for update to authenticated
      using(id=auth.uid() or app.is_admin() or app.can_approve(id) or app.can_edit_org_assignment())
      with check(id=auth.uid() or app.is_admin() or app.can_approve(id) or app.can_edit_org_assignment());
    create policy profiles_operations_read on public.profiles for select to authenticated
      using(app.basic_work_allowed('operations') and company_id='${company}');
    create policy profiles_operations_update on public.profiles for update to authenticated
      using(app.basic_work_allowed('operations') and company_id='${company}')
      with check(app.basic_work_allowed('operations') and company_id='${company}');
    create trigger profiles_guard_changes before update on public.profiles for each row execute function app.guard_profile_changes();
    select set_config('request.jwt.claim.sub','${actorId}',false); set role authenticated;
  `)
  assert.equal(await scalar('select app.can_edit_org_assignment()'), true)
  assert.equal(await scalar('select app.can_approve($1)', [targetId]), false)
  await assert.rejects(() => db.query("update public.profiles set status='active',approved_by=$1,approved_at=now() where id=$2", [actorId,targetId]),
    error => error.code === 'P0001' && error.message.includes('부서와 직책·직급만'), '기존 검사 순서의 실제 승인 실패 재현')
  await db.exec("reset role; select set_config('request.jwt.claim.sub','',false)")
  const before = (await db.query('select * from public.profiles order by id')).rows
  const policies = (await db.query("select * from pg_policies where schemaname='public' and tablename='profiles' order by policyname")).rows
  const acl = await scalar("select proacl from pg_proc where oid='app.guard_profile_changes()'::regprocedure")
  await db.exec(migration)
  await db.exec(departmentMigration)
  await db.exec(departmentMigration) // 재적용해도 원본·권한을 바꾸지 않는다.
  assert.deepEqual((await db.query('select * from public.profiles order by id')).rows, before)
  assert.deepEqual((await db.query("select * from pg_policies where schemaname='public' and tablename='profiles' order by policyname")).rows, policies)
  assert.deepEqual(await scalar("select proacl from pg_proc where oid='app.guard_profile_changes()'::regprocedure"), acl)
  const proof = await readFile('supabase/tests/operations_access_approval.sql', 'utf8')
  const result = await db.exec(proof)
  assert.equal(result.at(-1).rows[0].verification.passed, true)
  assert.deepEqual((await db.query('select * from public.profiles order by id')).rows, before, '가상 승인·거절을 포함한 모든 테스트 원본 롤백')
  assert.equal(await scalar('select count(*) from auth.users'), 2, '가상 Auth 계정도 롤백')
  // 조직 편집 RLS도 가진 운영지원 직원이 타 회사 신청을 승인하는 우회는 차단한다.
  const otherCompany = 'e0000000-0000-4000-8000-000000000002'
  const inactiveDepartment = '20000000-0000-4000-8000-000000000001'
  const foreignDepartment = '20000000-0000-4000-8000-000000000002'
  await db.query('insert into public.departments values($1,$2,$3,false,null),($4,$5,$6,true,null)',
    [inactiveDepartment,company,'비활성 검증',foreignDepartment,otherCompany,'타 회사 검증'])
  await db.exec(`select set_config('request.jwt.claim.sub','${actorId}',false); set role authenticated`)
  for (const department of [inactiveDepartment,foreignDepartment]) {
    await assert.rejects(() => db.query("update public.profiles set status='active',department_id=$1 where id=$2", [department,targetId]),
      error => error.code==='P0001' && error.message.includes('같은 회사의 활성 부서'))
  }
  await db.exec("reset role; select set_config('request.jwt.claim.sub','',false)")
  await db.query('update public.profiles set company_id=$1 where id=$2', [otherCompany,targetId])
  await db.exec(`select set_config('request.jwt.claim.sub','${actorId}',false); set role authenticated`)
  await assert.rejects(() => db.query("update public.profiles set status='active' where id=$1", [targetId]))
  await db.exec("reset role; select set_config('request.jwt.claim.sub','',false)")
  await db.query('update public.profiles set company_id=$1 where id=$2', [company,targetId])
  // 같은 이름의 타 회사 운영지원 계정도 이 회사의 가입 승인 권한을 얻지 못한다.
  await db.query('update public.profiles set company_id=$1 where id=$2', [otherCompany,actorId])
  await db.exec(`select set_config('request.jwt.claim.sub','${actorId}',false); set role authenticated`)
  assert.equal(await scalar('select app.is_operations_department_member()'), false)
  await assert.rejects(() => db.query("update public.profiles set status='active' where id=$1", [targetId]))
  console.log('operations-access-approval-db: 기존 오류 재현, 운영지원 전체 승인·거절, 보호 항목/회사 경계/비활성/자기 승인 차단, 정책·권한·원본 보존, 가상 기록 롤백 통과')
} finally {
  await db.close()
}
