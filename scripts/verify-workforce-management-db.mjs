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
  const before = await snapshot()
  await db.exec(await readFile('supabase/migrations/20261105080213_workforce_management_and_logistics_operations.sql', 'utf8'))
  assert.deepEqual(await snapshot(), before, 'all existing records, policies, grants and worker ACLs preserved')
  assert.equal(await scalar('select app.workforce_mode($1)', [id(4)]), 'external')
  assert.equal(await scalar('select app.workforce_mode($1)', [id(3)]), 'logistics')
  // Existing head-office paths continue; excluded people receive no recalculation or new automatic work.
  for (const employee of [id(2), id(3), id(4)]) {
    await db.query('select app.refresh_employee_leave($1,current_date)', [employee])
    await db.query('select app.ensure_employee_birthday_leave($1,current_date)', [employee])
  }
  for (const clock of [id(30), id(31), id(32)]) await db.query('select app.advance_attendance_presence($1,now())', [clock])
  assert.equal(await scalar('select app.dispatch_extra_leave_grant_notice($1)', [id(41)]), 0)
  assert.equal(await scalar('select app.dispatch_extra_leave_grant_notice($1)', [id(42)]), 0)
  assert.equal(await scalar('select app.dispatch_extra_leave_grant_notice($1)', [id(40)]), 1)
  await db.query('select app.process_attendance_presence()')
  assert.equal(await scalar('select count(*)::int from app.original_calls where employee_id<>$1', [id(2)]), 0)
  assert.equal(await scalar('select count(*)::int from app.original_calls where employee_id=$1', [id(2)]), 5)
  assert.equal(await scalar('select app.dispatch_leave_usage_notices_before_extra()'), 3)
  await actor(id(1))
  assert.equal((await scalar('select public.list_my_home_work_notifications()')).length, 3)
  const managedWork = await scalar('select public.list_my_managed_work_notifications()')
  assert.equal(managedWork.length, 1);assert.equal(managedWork[0].entity_id, id(20))
  const managedLate = await scalar('select public.list_my_managed_late_notices()')
  assert.equal(managedLate.length, 1);assert.equal(managedLate[0].statement_id, id(50));assert.ok(managedLate[0].read_at)
  await actor(id(2));assert.equal((await scalar('select public.list_my_managed_work_notifications()')).length, 1)
  for (const who of [id(3), id(4), id(5)]) {
    await actor(who)
    assert.deepEqual(await scalar('select public.list_my_managed_work_notifications()'), [])
    assert.deepEqual(await scalar('select public.list_my_managed_late_notices()'), [])
  }
  const work = { id: id(100), employeeId: id(3), kind: 'work', startedAt: '2026-11-06T00:00:00Z', endedAt: '2026-11-06T18:00:00Z', breakMinutes: 90, note: '야간 수동 기록', version: 0 }
  await actor(manager)
  let state = await list(); assert.deepEqual(state.employees.map(x => x.id).sort(), [manager, id(3)].sort())
  assert.equal((await save(work)).version, 1)
  assert.equal((await save(work)).version, 1, 'network retry does not duplicate a new entry')
  assert.equal(await scalar('select count(*)::int from logistics_operation_records'), 1)
  assert.equal(await scalar('select count(*)::int from logistics_operation_events'), 1)
  state = await list(); assert.equal(state.entries[0].from_date, '2026-11-06');assert.equal(state.entries[0].to_date, '2026-11-07')
  await assert.rejects(save({ ...work, id: id(101) }), error => error.code === '22023')
  await assert.rejects(save({ ...work, id: id(101), employeeId: id(4) }), error => error.code === '42501')
  await assert.rejects(save({ ...work, id: id(101), employeeId: id(2) }), error => error.code === '42501')
  await assert.rejects(save({ ...work, id: id(101), employeeId: id(5) }), error => error.code === '42501')
  await assert.rejects(save({ ...work, id: id(101), breakMinutes: 1081 }), error => error.code === '22023')
  assert.equal((await save({ ...work, note: '수정', version: 1 })).version, 2)
  await assert.rejects(save({ ...work, note: '동시 수정', version: 1 }), error => error.code === '40001')
  const leave = { id: id(102), employeeId: id(3), kind: 'leave', from: '2026-11-08', to: '2026-11-08', leaveKind: 'quarter', leaveDays: 0.25, note: '', version: 0 }
  await save(leave)
  await assert.rejects(save({ ...leave, id: id(103) }), error => error.code === '22023')
  await assert.rejects(save({ ...leave, id: id(103), from: '2026-11-09', to: '2026-11-09', leaveDays: 0.3 }), error => error.code === '22023')
  assert.equal((await save({ id: work.id, version: 2, action: 'cancel' })).version, 3)
  assert.equal((await save({ id: work.id, version: 2, action: 'cancel' })).version, 3)
  assert.equal(await scalar('select count(*)::int from logistics_operation_records'), 2, 'cancellation keeps source and audit history')
  await deny('update logistics_operation_records set note=$1', ['direct write'])
  await deny('delete from logistics_operation_records')
  for (const who of [id(1), id(2), id(3), id(4), id(5), id(6)]) {
    await actor(who);await deny("select public.get_logistics_operations('2026-11-01','2026-11-30')")
    await deny('select public.save_logistics_operation($1::jsonb)', [JSON.stringify(work)])
    assert.equal(await scalar('select count(*)::int from logistics_operation_records'), 0)
    assert.equal(await scalar('select count(*)::int from logistics_operation_events'), 0)
  }
  await actor(id(2));const policies = await scalar('select public.list_workforce_management()')
  assert.ok(policies.every(row => ![id(5), id(6)].includes(row.employeeId)))
  await deny('select public.save_workforce_management($1::jsonb)', [JSON.stringify({ employeeId: id(4), mode: 'external', version: 0 })])
  await actor(id(1));const result = await policy({ employeeId: id(4), mode: 'external', trackingStart: null, version: 0 })
  assert.equal(result.version, 1)
  await assert.rejects(policy({ employeeId: id(4), mode: 'head-office', trackingStart: '2026-11-02', version: 1 }), error => error.code === '22023')
  const today = await scalar("select (now() at time zone 'Asia/Seoul')::date::text")
  assert.equal((await policy({ employeeId: id(4), mode: 'head-office', trackingStart: today, version: 1 })).version, 2)
  await assert.rejects(policy({ employeeId: id(4), mode: 'external', version: 1 }), error => error.code === '40001')
  await assert.rejects(policy({ employeeId: id(5), mode: 'external', version: 0 }), error => error.code === '42501')
  await actor(id(6));await deny('select public.list_workforce_management()')
  await actor(null);await deny('select public.list_workforce_management()')
  await db.exec('reset role;set role anon')
  for (const query of ['select public.list_workforce_management()', "select public.get_logistics_operations('2026-11-01','2026-11-30')", 'select * from logistics_operation_records', 'select * from workforce_management_overrides']) await deny(query)
  await db.exec('reset role');assert.deepEqual(await snapshot(), before)
  console.info('Workforce DB: manager-only API/RLS, manual work/leave, overnight/breaks, duplicate retry, overlap, version conflicts, cancellation audit, headquarters scope/activation and existing records/permissions preserved')
} catch (error) {
  console.error('Workforce DB verification failed', { message: error.message, code: error.code, where: error.where })
  process.exitCode = 1
} finally { await db.close() }
