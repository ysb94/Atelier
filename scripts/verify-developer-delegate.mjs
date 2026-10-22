import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { PERMISSION_CATALOG } from '../src/lib/company/permissions.ts'
import { legacyPermissionGrants } from '../src/lib/company/permission-rollout.ts'
import { DEVELOPER_DELEGATE_ID, usesDeveloperDelegation } from '../src/lib/company/developer-delegate.ts'
import { showAccessIpMenu } from '../src/lib/company/access-ip.ts'

const owner = 'd0000000-0000-4000-8000-000000000001', delegate = DEVELOPER_DELEGATE_ID
const staff = '10000000-0000-4000-8000-000000000003', company = 'e0000000-0000-4000-8000-000000000001'
const department = '20000000-0000-4000-8000-000000000001', brand = 'b0000000-0000-4000-8000-000000000001'
const file = (await fs.readdir('supabase/migrations')).find(name => name.endsWith('_developer_account_delegate.sql'))
const migration = await fs.readFile('supabase/migrations/' + file, 'utf8')
const db = await PGlite.create()
async function actor(id) { await db.exec(`reset role; select set_config('request.jwt.claim.sub','${id}',false); set role authenticated`) }
const key = grant => `${grant.permission}:${grant.scopeKind ?? grant.scope_kind}:${grant.scopeId ?? grant.scope_id}`
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema app; grant usage on schema auth,app,public to authenticated,anon;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table auth.users(id uuid primary key); create table public.companies(id uuid primary key);
    create table public.departments(id uuid primary key,name text,is_active boolean);
    create table public.profiles(id uuid primary key,email text,display_name text,company_id uuid,status text,is_admin boolean,position text,department_id uuid);
    create table public.brand_members(brand_id uuid,profile_id uuid,is_lead boolean,primary key(brand_id,profile_id));
    create table app.permission_catalog(code text primary key);
    create table public.permission_grants(id uuid default gen_random_uuid() primary key,company_id uuid,profile_id uuid,permission text references app.permission_catalog(code),scope_kind text,scope_id uuid,updated_by uuid,unique(company_id,profile_id,permission,scope_kind,scope_id));
    create table public.permission_grant_events(company_id uuid,actor_id uuid,profile_id uuid,permission text,scope_kind text,scope_id uuid,enabled boolean);
    create table public.impersonation_operators(profile_id uuid primary key);
    insert into public.companies values('${company}');
    insert into public.departments values('${department}','개발부',true);
    insert into auth.users values('${owner}'),('${delegate}'),('${staff}');
    insert into public.profiles values('${owner}','dev@atelier.local','개발자','${company}','active',true,'팀장','${department}'),
      ('${delegate}','owner@example.invalid','윤설빈','${company}','active',true,null,null),
      ('${staff}','staff@example.invalid','윤설빈','${company}','active',true,'사원',null);
    insert into public.brand_members values('${brand}','${owner}',true),('${brand}','${delegate}',false);
    insert into public.impersonation_operators values('${owner}');`)
  for (const [code] of PERMISSION_CATALOG) await db.query('insert into app.permission_catalog values($1)', [code])
  await db.exec(await fs.readFile('supabase/migrations/20261022094409_access_ip_records.sql','utf8'))
  const before = (await db.query('select * from public.profiles order by id')).rows
  await db.exec(migration)
  assert.deepEqual((await db.query('select * from public.profiles order by id')).rows, before, '로그인·승인·직책·부서는 한 열도 바꾸지 않음')
  const profile = { id: owner, email:'dev@atelier.local', companyId:company, status:'active', isAdmin:true, position:'팀장', departmentId:department, departmentName:'개발부', capabilities:['logistics'], memberships:[{brandId:brand,isLead:true}] }
  const expected = legacyPermissionGrants(profile).map(key).sort()
  const stored = (await db.query('select * from public.permission_grants where profile_id=$1',[delegate])).rows
  assert.deepEqual(stored.map(key).sort(), expected, '실제 legacy 권한 생성기와 SQL 지정 내역의 코드·범위가 같음')
  assert.equal((await db.query('select * from public.permission_grant_events')).rows.length, expected.length)
  await db.exec(migration)
  assert.equal((await db.query('select * from public.permission_grant_events')).rows.length, expected.length, '재실행 시 변경 이력 중복 없음')
  assert.equal((await db.query('select is_lead from public.brand_members where profile_id=$1',[delegate])).rows[0].is_lead, true)
  assert.equal((await db.query('select * from public.impersonation_operators where profile_id=$1',[delegate])).rows.length, 1)
  for (const id of [owner, delegate]) {
    await actor(id)
    const row = (await db.query('select app.is_dev_login() developer,app.is_company_manager() manager,app.can_edit_org_assignment() org,app.mamam_inbox_company_id() inbox')).rows[0]
    assert.deepEqual(row, { developer:true, manager:true, org:true, inbox:company })
    assert.equal((await db.query('select * from public.access_ip_reviewers')).rows.length, 1, '각 본인 지정만 조회')
    await db.query("insert into public.office_ip_reviews(ip_address,status,reviewed_by) values($1,'company',$2) on conflict(ip_address) do update set status='unconfirmed'",['203.0.113.9',id])
  }
  await actor(staff)
  assert.deepEqual((await db.query('select app.is_dev_login() developer,app.is_company_manager() manager,app.can_edit_org_assignment() org,app.mamam_inbox_company_id() inbox')).rows[0], { developer:false, manager:false, org:false, inbox:null }, '같은 이름·관리자여도 미지정 계정은 승격하지 않음')
  assert.equal((await db.query('select * from public.office_ip_reviews')).rows.length, 0)
  assert.equal((await db.query('select * from public.access_ip_reviewers')).rows.length, 0)
  await db.exec(`reset role; update public.profiles set status='disabled' where id='${delegate}'`)
  await actor(delegate)
  assert.equal((await db.query('select app.is_dev_login() ok')).rows[0].ok, false, '중지 계정은 개발자 권한 없음')
  assert.equal(usesDeveloperDelegation({id:delegate,status:'active'}), true)
  assert.equal(usesDeveloperDelegation({id:staff,status:'active'}), false)
  assert.equal(usesDeveloperDelegation({id:delegate,status:'pending'}), false)
  assert.equal(showAccessIpMenu({id:delegate,email:'owner@example.invalid',status:'active'}), true)
  assert.equal(showAccessIpMenu({id:delegate,email:'ui-preview@example.invalid',status:'active'}), false)
  console.log(`developer-delegate: 개발자와 동일한 ${expected.length}개 권한·범위, 직원 전환/IP 접근, 서버 판정, 중지·동명이인 차단, 프로필 무변경, 재실행 중복 방지 통과 (운영 DB 연결 없음)`)
} finally { await db.close() }
