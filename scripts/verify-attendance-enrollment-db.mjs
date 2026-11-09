import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const id = n => `61000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const company = id(90), other = id(91)
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0]
const actor = async user => db.exec(`reset role;select set_config('request.jwt.claim.sub','${user ?? ''}',false);set role authenticated`)
const rejected = (sql, code = '42501') => assert.rejects(() => db.query(sql), error => error.code === code)
const snapshot = () => scalar(`select jsonb_build_object(
 'profiles',(select md5(jsonb_agg(to_jsonb(p) order by p.id)::text) from public.profiles p),
 'clocks',(select jsonb_agg(to_jsonb(c) order by c.id) from public.attendance_clock_ins c),
 'leave',(select jsonb_agg(to_jsonb(r) order by r.id) from public.company_leave_requests r),
 'grants',(select jsonb_agg(to_jsonb(g) order by g.id) from public.permission_grants g),
 'policies',(select jsonb_agg(to_jsonb(p) order by p.policyname) from pg_policies p where schemaname='public'),
 'functions',(select jsonb_agg(jsonb_build_object('name',p.proname,'acl',p.proacl,'body',p.prosrc,'config',p.proconfig) order by p.proname)
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('app','public') and p.proname in('permission_company_id','list_org_chart_members','attendance_start_for_date','holiday_work_day_kind'))) `)
try {
  await db.exec(`create role anon;create role authenticated;create schema app;create schema auth;
    grant usage on schema public,app,auth to anon,authenticated;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.companies(id uuid primary key);insert into public.companies values('${company}'),('${other}');
    create table public.profiles(id uuid primary key,company_id uuid,department_id uuid,status text,hire_date date,approved_at timestamptz);
    create table public.attendance_start_settings(employee_id uuid primary key,start_time time);
    create function app.permission_company_id() returns uuid language sql stable security definer set search_path='' as $$select company_id from public.profiles where id=auth.uid() and status='active'$$;
    create function public.list_org_chart_members() returns table(id uuid) language sql stable security definer set search_path='' as $$select p.id from public.profiles p where p.status='active' and exists(select 1 from public.profiles me where me.id=auth.uid() and me.status='active')$$;
    create function app.attendance_start_for_date(p_employee uuid,p_date date) returns time language sql stable security definer set search_path='' as $$select start_time from public.attendance_start_settings where employee_id=p_employee$$;
    create table app.leave_balance_calendar_years(year integer primary key);insert into app.leave_balance_calendar_years values(2026),(2027);
    create table app.leave_balance_holidays(day date primary key);insert into app.leave_balance_holidays values('2027-01-01');
    create function app.holiday_work_day_kind(p_date date) returns text language plpgsql stable security definer set search_path='' as $$begin
      if not exists(select 1 from app.leave_balance_calendar_years where year=extract(year from p_date)::integer) then raise exception 'calendar missing' using errcode='23514';end if;
      if extract(isodow from p_date)=7 or exists(select 1 from app.leave_balance_holidays where day=p_date) then return 'holiday';end if;
      if extract(isodow from p_date)=6 then return 'rest';end if;return null;end$$;
    create table public.attendance_clock_ins(id uuid primary key,employee_id uuid,work_date date,clock_in time);
    create table public.company_leave_requests(id uuid primary key,employee_id uuid,kind text,days numeric);
    create table public.permission_grants(id uuid primary key,employee_id uuid,permission text);
    insert into public.attendance_clock_ins values('${id(80)}','${id(2)}','2026-11-03','09:12');
    insert into public.company_leave_requests values('${id(81)}','${id(2)}','annual',1);
    insert into public.permission_grants values('${id(82)}','${id(1)}','org.manage');
    alter table public.profiles enable row level security;
    grant select,update on public.profiles to authenticated;
    create policy profiles_read on public.profiles for select to authenticated using(company_id=app.permission_company_id());
    create policy profiles_edit on public.profiles for update to authenticated using(auth.uid()='${id(1)}') with check(company_id=app.permission_company_id());`)
  const rows = [
    [1, '2026-10-28T18:00:00+09:00', null],
    [2, '2026-11-05T16:11:26+09:00', null],
    [3, '2026-11-05T08:59:59+09:00', '09:00'],
    [4, '2026-11-05T09:00:00+09:00', '09:00'],
    [5, '2026-11-05T09:00:01+09:00', '09:00'],
    [6, '2026-11-06T10:00:00+09:00', '09:00'],
    [7, '2026-11-08T08:00:00+09:00', '09:00'],
    [8, '2026-12-31T10:00:00+09:00', '09:00'],
    [9, null, null], [10, '2026-10-20T10:00:00+09:00', null],
  ]
  for (const [n, approval, start] of rows) {
    await db.query('insert into public.profiles values($1,$2,null,$3,$4,$5)', [id(n), n === 10 ? other : company, 'active', n === 2 ? '2026-11-03' : '2020-01-01', approval])
    if (start) await db.query('insert into public.attendance_start_settings values($1,$2)', [id(n), start])
  }
  await db.exec(`insert into public.profiles values('${id(11)}','${company}',null,'pending','2026-11-03',null)`)
  await db.exec(`insert into public.profiles values('${id(13)}','${company}',null,'disabled','2020-01-01',null)`)
  const before = await snapshot()
  await db.exec(await readFile('supabase/migrations/20261105094711_attendance_approval_tracking_start.sql', 'utf8'))
  assert.deepEqual(await snapshot(), before, 'original accounts, hire dates, clocks, leave, permissions, policies and function bodies/ACLs preserved')
  await actor(id(1))
  const enrolled = await scalar('select public.list_attendance_enrollments()')
  const byId = new Map(enrolled.map(row => [row.employeeId, row.startsOn]))
  for (const [n, date] of [[1,'2026-11-02'],[2,'2026-11-06'],[3,'2026-11-05'],[4,'2026-11-05'],[5,'2026-11-06'],[6,'2026-11-09'],[7,'2026-11-09'],[8,'2027-01-04'],[9,'2026-11-02']]) assert.equal(byId.get(id(n)), date, `approval boundary ${n}`)
  assert.equal(byId.has(id(10)), false, 'other companies omitted')
  assert.equal(byId.has(id(11)), false, 'pending employees omitted')
  assert.deepEqual(Object.keys(enrolled[0]).sort(), ['employeeId','startsOn'], 'minimal date metadata only')
  await rejected('select * from app.attendance_enrollments')
  await rejected("select app.attendance_enrollment_start(now(),'09:00')")
  await rejected(`insert into app.attendance_enrollments(employee_id,company_id,source) values('${id(11)}','${company}','approval')`)
  await db.exec(`update public.profiles set status='active',approved_at='2026-11-09T10:00:00+09:00' where id='${id(11)}'`)
  let newlyApproved = (await scalar('select public.list_attendance_enrollments()')).find(row => row.employeeId === id(11))
  assert.equal(newlyApproved.startsOn, '2026-11-10', 'future approval captured without profile write API changes')
  await db.exec(`update public.profiles set approved_at='2026-11-20T20:00:00+09:00' where id='${id(11)}';update public.profiles set status='disabled' where id='${id(11)}';update public.profiles set status='active' where id='${id(11)}'`)
  newlyApproved = (await scalar('select public.list_attendance_enrollments()')).find(row => row.employeeId === id(11))
  assert.equal(newlyApproved.startsOn, '2026-11-10', 'later edits/reactivation do not reset original enrollment')
  await db.exec('reset role')
  await db.exec(`update public.attendance_start_settings set start_time='08:00';insert into public.attendance_start_settings values('${id(2)}','08:00')`)
  await actor(id(1))
  assert.equal((await scalar('select public.list_attendance_enrollments()')).find(row => row.employeeId === id(2)).startsOn, '2026-11-06', 'later schedule changes do not create retroactive absences')
  await actor(id(2));assert.equal((await scalar('select public.list_attendance_enrollments()')).length, 10)
  await actor(id(10));assert.equal((await scalar('select public.list_attendance_enrollments()')).length, 1)
  await actor(id(1));await db.exec(`update public.profiles set status='active' where id='${id(13)}'`)
  assert.equal((await scalar('select public.list_attendance_enrollments()')).find(row => row.employeeId === id(13)).startsOn, '2026-11-02', 'legacy disabled accounts retain their original boundary on reactivation')
  await db.exec('reset role');await db.exec(`insert into public.profiles values('${id(12)}','${company}',null,'pending','2026-11-03',null)`)
  await actor(id(12));await rejected('select public.list_attendance_enrollments()')
  await db.exec('reset role;set role anon');await rejected('select public.list_attendance_enrollments()')
  await db.exec('reset role')
  await rejected("select app.attendance_enrollment_start('2028-01-03T08:00:00+09:00','09:00')", '23514')
  await db.exec(`delete from app.attendance_enrollments where employee_id='${id(2)}'`)
  await actor(id(1));await rejected('select public.list_attendance_enrollments()', '55000')
  console.info('Attendance enrollment DB: approval time/boundaries, unknown start, weekends/holidays, future approval capture, immutable enrollment, missing/calendar failures, role isolation and original data/rights preserved')
} finally { await db.close() }
