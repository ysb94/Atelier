import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const company = 'e0000000-0000-4000-8000-000000000001'
const logistics = 'c5d4cfca-97ce-4ca7-b30a-6beed842cf1e', china = 'bf926822-910c-422f-9c17-5fd3d8ddb3ba'
const manager = '7f159ac7-9e05-41a4-8891-f9929d3af806', id = n => `60000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0]
const actor = async who => db.exec(`reset role;select set_config('request.jwt.claim.sub','${who ?? ''}',false);set role authenticated`)
const deny = (sql, args = [], code = '42501') => assert.rejects(() => db.query(sql, args), error => error.code === code)
const save = input => scalar('select public.save_logistics_operation($1::jsonb)', [JSON.stringify(input)])
const policy = input => scalar('select public.save_workforce_management($1::jsonb)', [JSON.stringify(input)])
const list = () => scalar("select public.get_logistics_operations('2026-11-01','2026-11-30')")
try {
  await db.exec(`create role anon;create role authenticated;create schema app;create schema auth;
    grant usage on schema public,app,auth to authenticated,anon;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table companies(id uuid primary key);insert into companies values('${company}'),('${id(90)}');
    create table profiles(id uuid primary key,company_id uuid,department_id uuid,status text,display_name text,hire_date date,editor boolean default false);
    insert into profiles values
    ('${manager}','${company}','${logistics}','active','물류관리자','2020-01-01',false),
    ('${id(1)}','${company}',null,'active','인사담당','2020-01-01',true),
    ('${id(2)}','${company}',null,'active','본사직원','2020-01-01',false),
    ('${id(3)}','${company}','${logistics}','active','물류직원','2020-01-01',false),
    ('${id(4)}','${company}','${china}','active','협력사','2020-01-01',false),
    ('${id(5)}','${id(90)}',null,'active','타사직원','2020-01-01',true),
    ('${id(6)}','${company}',null,'pending','승인대기','2020-01-01',true);
    create function app.permission_company_id() returns uuid language sql stable security definer set search_path='' as $$select company_id from public.profiles where id=auth.uid() and status='active'$$;
    create function app.can_edit_org_assignment() returns boolean language sql stable security definer set search_path='' as $$select coalesce((select editor from public.profiles where id=auth.uid() and status='active'),false)$$;
    create table employee_roster(profile_id uuid primary key,remaining_annual_leave numeric,note text);insert into employee_roster values('${id(2)}',12,'보존'),('${id(3)}',8,'보존'),('${id(4)}',4,'보존');
    create table permission_grants(id uuid primary key,profile_id uuid,permission text);insert into permission_grants values('${id(80)}','${manager}','work.manage');
    create table company_leave_requests(id uuid primary key,employee_id uuid,kind text);insert into company_leave_requests values('${id(20)}','${id(2)}','offsite'),('${id(21)}','${id(3)}','offsite'),('${id(22)}','${id(4)}','offsite');
    create table attendance_clock_ins(id uuid primary key,employee_id uuid,work_date date);insert into attendance_clock_ins values('${id(30)}','${id(2)}','2026-11-02'),('${id(31)}','${id(3)}','2026-11-02'),('${id(32)}','${id(4)}','2026-11-02');
    create table app.employee_extra_leave(id uuid primary key,employee_id uuid);insert into app.employee_extra_leave values('${id(40)}','${id(2)}'),('${id(41)}','${id(3)}'),('${id(42)}','${id(4)}');
    create table app.holiday_work_days(id uuid primary key,employee_id uuid);
    create table late_arrival_statements(id uuid primary key,employee_id uuid,read_at timestamptz);
    insert into late_arrival_statements values('${id(50)}','${id(2)}','2026-11-03T00:00:00Z'),('${id(51)}','${id(3)}',null),('${id(52)}','${id(4)}',null);
    create function public.list_my_home_work_notifications() returns jsonb language sql stable security invoker as $$
      select coalesce(jsonb_agg(jsonb_build_object('entity_id',r.id,'event_type','approval','employee_name',p.display_name,'read_at','2026-11-03T00:00:00Z')),'[]')
      from public.company_leave_requests r join public.profiles p on p.id=r.employee_id
      where p.company_id=app.permission_company_id() and (r.employee_id=auth.uid() or app.can_edit_org_assignment())$$;
    create function public.list_my_late_statement_notices() returns table(kind text,notice_id uuid,statement_id uuid,employee_name text,work_date date,late_minutes integer,created_at timestamptz,read_at timestamptz)
      language sql stable security invoker as $$select 'manager',s.id,s.id,p.display_name,'2026-11-02'::date,7,'2026-11-02T00:00:00Z'::timestamptz,s.read_at
      from public.late_arrival_statements s join public.profiles p on p.id=s.employee_id
      where p.company_id=app.permission_company_id() and (s.employee_id=auth.uid() or app.can_edit_org_assignment())$$;
    create table app.original_calls(operation text,employee_id uuid);
    create function app.refresh_employee_leave(p_employee uuid,p_today date) returns void language plpgsql security definer set search_path='' as $$begin insert into app.original_calls values('refresh',p_employee);end$$;
    create function app.ensure_employee_birthday_leave(p_employee uuid,p_today date) returns void language plpgsql security definer set search_path='' as $$begin insert into app.original_calls values('birthday',p_employee);end$$;
    create function app.advance_attendance_presence(p_clock_id uuid,p_now timestamptz) returns void language plpgsql security definer set search_path='' as $$begin insert into app.original_calls select 'presence',employee_id from public.attendance_clock_ins where id=p_clock_id;end$$;
    create function app.dispatch_extra_leave_grant_notice(p_grant uuid) returns integer language plpgsql security definer set search_path='' as $$begin insert into app.original_calls select 'extra_notice',employee_id from app.employee_extra_leave where id=p_grant;return 1;end$$;
    create function app.dispatch_leave_usage_notices_before_extra() returns integer language plpgsql security definer set search_path='' as $$declare result integer;begin select count(*) into result from public.profiles p where p.status='active';return result;end$$;
    create function app.process_attendance_presence() returns void language plpgsql security definer set search_path='' as $$begin insert into app.original_calls select 'offsite',r.employee_id from public.company_leave_requests r where r.kind='offsite';end$$;
    grant select on profiles,employee_roster,company_leave_requests,attendance_clock_ins,permission_grants,late_arrival_statements to authenticated;
    alter table employee_roster enable row level security;create policy original_roster on employee_roster for select to authenticated using(true);`)
  const originalTables = ['profiles', 'employee_roster', 'permission_grants', 'company_leave_requests', 'attendance_clock_ins', 'late_arrival_statements']
  const snapshot = async () => {
    const result = {}
    for (const table of originalTables) result[table] = await scalar(`select md5(coalesce(jsonb_agg(t order by to_jsonb(t)::text)::text,'')) from ${table} t`)
    result.policies = await scalar("select md5(coalesce(jsonb_agg(p order by policyname)::text,'')) from pg_policies p where tablename=any($1)", [originalTables])
    result.grants = await scalar("select md5(coalesce(jsonb_agg(p order by table_name,grantee,privilege_type)::text,'')) from information_schema.table_privileges p where table_name=any($1)", [originalTables])
    result.functionAcl = await scalar("select md5(jsonb_agg(jsonb_build_array(proname,proacl,proconfig) order by proname)::text) from pg_proc where pronamespace='app'::regnamespace and proname=any($1)", [['refresh_employee_leave','ensure_employee_birthday_leave','advance_attendance_presence','dispatch_extra_leave_grant_notice','dispatch_leave_usage_notices_before_extra','process_attendance_presence']])
    return result
  }
  await db.exec(`create table public.departments(id uuid primary key,company_id uuid,name text,sort_order integer,is_active boolean);
    insert into departments values('${logistics}','${company}','물류팀',1,true),('${china}','${company}','중국팀',2,true),('${id(70)}','${company}','현장팀',3,true),('${id(71)}','${id(90)}','타사팀',1,true),('${id(72)}','${company}','중지팀',4,false);
  `)
  const before = await snapshot()
  if (process.env.DEPARTMENT_WORKFORCE_LEGACY_CHAIN === '1') await db.exec(await readFile('supabase/migrations/20261105080213_workforce_management_and_logistics_operations.sql', 'utf8'))
  await db.exec(await readFile('supabase/migrations/20261105123000_department_workforce_management.sql', 'utf8'))
  assert.deepEqual(await snapshot(), before, 'original business data, policies, grants and function ACL preserved')
  const saveDept = input => scalar('select public.save_department_workforce_management($1::jsonb)', [JSON.stringify(input)])
  const read = () => scalar('select public.list_department_workforce_management()')
  await actor(id(1))
  assert.equal((await read()).length, 3, 'includes empty active departments; excludes foreign/inactive')
  assert.equal(await scalar('select count(*) from public.department_workforce_policies'), 0, 'reads do not create settings')
  await saveDept({ departmentId:id(70),mode:'local',version:0 })
  await db.exec(`reset role;update public.profiles set department_id='${id(70)}' where id='${id(2)}';`)
  assert.equal(await scalar('select app.workforce_mode($1)', [id(2)]), 'local', 'moving employee inherits department setting')
  assert.equal(await scalar('select app.workforce_mode($1)', [id(3)]), 'logistics', 'legacy logistics stays narrowly scoped')
  assert.equal(await scalar('select app.workforce_mode($1)', [id(4)]), 'external')
  await actor(id(1))
  const next = { departmentId:china,mode:'head-office',trackingStart:'2099-01-01',version:0 }
  await saveDept(next)
  const inherited = await scalar('select public.list_workforce_management()')
  assert.equal(inherited.find(p=>p.employeeId===id(4)).trackingStart,'2099-01-01')
  assert.equal(inherited.find(p=>p.employeeId===id(4)).mode,'head-office')
  await deny('select public.save_department_workforce_management($1::jsonb)', [JSON.stringify(next)], '40001')
  assert.equal((await saveDept({...next,version:1})).version,1,'same value no-op retains version')
  await deny('select public.save_department_workforce_management($1::jsonb)', [JSON.stringify({departmentId:id(71),mode:'local',version:0})])
  await deny('select public.save_department_workforce_management($1::jsonb)', [JSON.stringify({departmentId:id(72),mode:'local',version:0})])
  await deny('select public.save_department_workforce_management($1::jsonb)', [JSON.stringify({departmentId:id(70),mode:'head-office',trackingStart:'2026-11-02',version:1})], '22023')
  await deny('select public.save_department_workforce_management($1::jsonb)', [JSON.stringify({departmentId:id(70),mode:'logistics',version:1})], '22023')
  await deny("update public.department_workforce_policies set mode='external'")
  await actor(id(2))
  assert.equal((await read()).length,3,'ordinary active employee reads same-company classifications')
  await deny('select public.save_department_workforce_management($1::jsonb)', [JSON.stringify({departmentId:china,mode:'external',version:1})])
  await actor(id(5));assert.equal((await read()).length,1,'foreign reader sees own company only')
  await actor(id(6));await deny('select public.list_department_workforce_management()')
  await db.exec('reset role;set role anon');await deny('select public.list_department_workforce_management()')
  await db.exec('reset role;')
  assert.equal(await scalar('select count(*) from app.department_workforce_events'),2,'server actor audit, one per actual change')
  // New employee automatically inherits without employee-specific writes.
  await db.exec(`insert into public.profiles values('${id(8)}','${company}','${id(70)}','active','신규현장직원','2026-11-06',false);`)
  assert.equal(await scalar('select app.workforce_mode($1)', [id(8)]),'local')
  await db.query('select app.refresh_employee_leave($1,current_date)',[id(8)])
  assert.equal(await scalar('select count(*) from app.original_calls'),0,'non-HQ automatic leave refresh excluded')
  await db.exec(`delete from public.profiles where id='${id(8)}';update public.profiles set department_id=null where id='${id(2)}';`)
  assert.deepEqual(await snapshot(), before, 'fixtures restored; original data/policies/ACL unchanged')
  console.info('Department workforce DB: inheritance, new/moved/empty departments, company/role boundaries, stale writes, no-op, effective dates, audit, original data preserved')
} finally { await db.close() }
