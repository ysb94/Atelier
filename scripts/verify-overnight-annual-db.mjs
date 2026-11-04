import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const db = await PGlite.create()
const company = 'e0000000-0000-4000-8000-000000000001', staff = '10000000-0000-4000-8000-000000000001', peer = '10000000-0000-4000-8000-000000000002'
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0]
try {
  await db.exec(`create role anon;create role authenticated;create schema app;create schema auth;
    grant usage on schema app,auth,public to authenticated,anon;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.companies(id uuid primary key);
    create table public.profiles(id uuid primary key,company_id uuid,department_id uuid,status text,display_name text,position text);
    create table public.departments(id uuid primary key,name text);
    create table public.attendance_exemptions(profile_id uuid primary key);
    create table public.attendance_start_settings(id uuid primary key default gen_random_uuid(),company_id uuid,employee_id uuid,department_id uuid,month date,start_time time,updated_at timestamptz default now());
    create table public.attendance_start_options(company_id uuid,start_time time);
    create table public.company_work_hours(company_id uuid,lunch_start time,lunch_end time);
    create table public.attendance_clock_ins(id uuid primary key default gen_random_uuid(),company_id uuid,employee_id uuid,work_date date,clock_in time,clock_out_at timestamptz,unique(employee_id,work_date));
    create table public.company_leave_requests(id uuid primary key default gen_random_uuid(),company_id uuid,employee_id uuid,employee_name text,department_id uuid,department_name text,kind text,from_date date,to_date date,start_time time,end_time time,note text default '',place text default '',status text,created_at timestamptz default now(),decided_at timestamptz,decided_by uuid,decided_by_name text,decision_note text,advance_requested boolean default false,end_next_day boolean default false);
    create table public.company_leave_files(request_id uuid,ready boolean);
    create function app.is_department_request_approver(uuid,uuid,text) returns boolean language sql as $$select false$$;
    create function app.can_edit_org_assignment() returns boolean language sql as $$select false$$;
    create function app.company_review_company_id() returns uuid language sql as $$select null::uuid$$;
    insert into public.companies values('${company}');
    insert into public.profiles values('${staff}','${company}',null,'active','staff','staff'),('${peer}','${company}',null,'active','peer','peer');
    insert into public.attendance_start_settings(company_id,employee_id,month,start_time) values('${company}','${staff}','2026-11-01','09:00');
    insert into public.attendance_start_options values('${company}','09:00'),('${company}','10:00');
    insert into public.company_work_hours values('${company}','12:00','13:00');
    insert into public.attendance_clock_ins(company_id,employee_id,work_date,clock_in) values('${company}','${staff}','2026-11-04','10:00');
    alter table public.company_leave_requests enable row level security;
    create policy own_request on public.company_leave_requests to authenticated using(employee_id=auth.uid()) with check(employee_id=auth.uid());
    grant select,insert,update on public.company_leave_requests to authenticated;
    grant select on public.profiles,public.departments,public.company_leave_files to authenticated;
    select set_config('request.jwt.claim.sub','${staff}',false);`)
  const lateSource = await readFile('supabase/migrations/20261102141000_late_arrival_statements.sql', 'utf8')
  await db.exec(lateSource.match(/create table public\.late_arrival_statements[\s\S]*?\n\);/)[0])
  const oldGuard = (await readFile('supabase/migrations/20261102063022_offsite_attendance_automation.sql', 'utf8')).match(/create or replace function app\.guard_company_leave_request\([\s\S]*?\$function\$[\s\S]*?\$function\$;/i)[0]
  await db.exec(oldGuard + `create trigger company_leave_request_guard before insert or update on public.company_leave_requests for each row execute function app.guard_company_leave_request();`)
  const oldBasis = (await readFile('supabase/migrations/20261026103425_attendance_previous_checkout.sql', 'utf8')).split('create function app.confirm_previous_clock_out')[0]
  await db.exec(oldBasis)
  const oldPresence = (await readFile('supabase/migrations/20261029130013_attendance_presence_confirmation.sql','utf8')).match(/create function app\.attendance_presence_end\([\s\S]*?\$\$;/)[0].replace('app.attendance_presence_end(', 'app.attendance_presence_end_original(')
  await db.exec(oldPresence)
  await db.exec(lateSource.match(/create function app\.save_my_late_statement\([\s\S]*?\$\$;/)[0])
  await db.exec('revoke all on function app.attendance_presence_end_original(uuid),app.save_my_late_statement(text,text,text,text) from public,anon,authenticated;grant execute on function app.save_my_late_statement(text,text,text,text) to authenticated;')
  const oldAcls = await scalar("select jsonb_agg(jsonb_build_array(proname,proacl::text) order by proname) from pg_proc where pronamespace='app'::regnamespace and proname in ('get_my_workday_basis','attendance_presence_end_original','save_my_late_statement')")
  const before = await scalar("select md5(jsonb_agg(to_jsonb(t) order by id)::text) from public.attendance_clock_ins t")
  const beforePolicies = await scalar("select md5(jsonb_agg(to_jsonb(t) order by policyname)::text) from pg_policies t")
  const migration = await readFile('supabase/migrations/20261103105053_offsite_workday_start_override.sql', 'utf8')
  await db.exec(migration.replace(/(?:pg_catalog\.)?clock_timestamp\(\)/g, "'2026-11-04T11:00:00+09:00'::timestamptz"))
  assert.deepEqual(await scalar("select jsonb_agg(jsonb_build_array(proname,proacl::text) order by proname) from pg_proc where pronamespace='app'::regnamespace and proname in ('get_my_workday_basis','attendance_presence_end_original','save_my_late_statement')"), oldAcls, '기존 함수 실행 권한 유지')
  assert.equal(await scalar("select md5(jsonb_agg(to_jsonb(t) order by id)::text) from public.attendance_clock_ins t"), before)
  assert.equal(await scalar("select md5(jsonb_agg(to_jsonb(t) order by policyname)::text) from pg_policies t"), beforePolicies)

  await db.exec(`alter table public.company_leave_requests add column offsite_continuous boolean not null default false;
    create table public.offsite_settlements(request_id uuid primary key);
    create table app.offsite_attendance_days(employee_id uuid,work_date date,returned_at timestamptz);
    create table public.my_home_notification_reads(reader_id uuid,event_key text,read_at timestamptz);
    grant select on public.my_home_notification_reads to authenticated;
    create function public.list_my_home_work_notifications() returns jsonb language sql as $$select '[]'::jsonb$$;
    create function app.offsite_finish(r public.company_leave_requests,d date) returns timestamptz language sql as $$select (r.to_date+r.end_time) at time zone 'Asia/Seoul'$$;
    insert into public.profiles values('10000000-0000-4000-8000-000000000003','${company}',null,'active','third','staff');
    insert into public.attendance_start_settings(company_id,employee_id,month,start_time) values('${company}','${staff}','2099-11-01','09:00');`)
  await db.exec(await readFile('supabase/migrations/20261104033803_offsite_group_registration.sql','utf8'))
  await db.exec("alter table public.profiles enable row level security;create policy profiles_self on public.profiles for select to authenticated using(id=auth.uid());")
  await db.exec(await readFile('supabase/migrations/20261104034900_offsite_group_member_notifications.sql','utf8'))

  await db.exec(`create or replace function app.offsite_finish(r public.company_leave_requests,d date) returns timestamptz language sql as $$select ((case when r.offsite_continuous then r.to_date else d+case when r.end_next_day then 1 else 0 end end)+r.end_time) at time zone 'Asia/Seoul'$$;`)
  const acls=await scalar("select proacl::text from pg_proc where oid='app.guard_company_leave_request()'::regprocedure")
  await db.exec(await readFile('supabase/migrations/20261104041501_overnight_offsite_annual_overlap.sql','utf8'))
  assert.equal(await scalar("select proacl::text from pg_proc where oid='app.guard_company_leave_request()'::regprocedure"),acls)
  const clear=async()=>db.exec('reset role;delete from public.company_leave_requests;set role authenticated')
  const add=async(kind,from,to,start,end,next=false,continuous=false,shift=null)=>scalar(`insert into public.company_leave_requests(company_id,employee_id,kind,from_date,to_date,start_time,end_time,end_next_day,offsite_continuous,offsite_work_start,note,place) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'검증','거래처') returning id`,[company,staff,kind,from,to,start,end,next,continuous,shift])
  const annual=()=>add('annual','2099-11-05','2099-11-05','09:00','18:00')
  const night=(end='05:00')=>add('offsite','2099-11-04','2099-11-04','16:00',end,true)
  await db.exec('set role authenticated')
  for(const first of ['offsite','annual']) {
    for(const end of ['05:00','09:00']) {
      await clear()
      if(first==='offsite'){await night(end);await annual()}else{await annual();await night(end)}
      assert.equal(await scalar("select count(*)::int from public.company_leave_requests where status='approved'"),2,first+' then other: '+end)
    }
    await clear()
    if(first==='offsite'){await night('09:01');await assert.rejects(annual(),/같은 시간/)}else{await annual();await assert.rejects(night('09:01'),/같은 시간/)}
  }
  await clear()
  await db.exec(`reset role;update public.attendance_start_settings set start_time='10:00' where employee_id='${staff}' and month='2099-11-01';set role authenticated`)
  await night('10:00');await annual()
  await clear();await annual();await assert.rejects(night('10:01'),/같은 시간/)
  await clear()
  await db.exec(`reset role;update public.attendance_start_settings set start_time='09:00' where employee_id='${staff}' and month='2099-11-01';set role authenticated`)
  const prior=await night('09:30')
  await add('offsite','2099-11-05','2099-11-05','20:00','21:00',false,false,'10:00')
  await assert.rejects(db.query('select app.overnight_offsite_before_annual($1,null,null)',[staff]),/permission denied/)
  await db.exec('reset role')
  assert.equal(await scalar(`select app.overnight_offsite_before_annual($1,r,jsonb_populate_record(null::public.company_leave_requests,'{"kind":"annual","from_date":"2099-11-05","to_date":"2099-11-05"}')) from public.company_leave_requests r where id=$2`,[staff,prior]),true,'day-specific override used for annual boundary')
  await db.exec('set role authenticated')
  await assert.rejects(annual(),/같은 시간/,'another offsite on the annual day still conflicts')
  await clear()
  // A previous day's override must not become the next day's start.
  await db.exec(`reset role;update public.attendance_start_settings set start_time='09:00' where employee_id='${staff}' and month='2099-11-01';set role authenticated`)
  await add('offsite','2099-11-04','2099-11-04','16:00','09:30',true,false,'10:00');await assert.rejects(annual(),/같은 시간/)
  await clear()
  await add('offsite','2099-11-03','2099-11-05','16:00','05:00',false,true);await annual()
  await clear();await annual();await assert.rejects(add('offsite','2099-11-03','2099-11-05','16:00','11:00',false,true),/같은 시간/)
  await clear();await annual();await assert.rejects(add('offsite','2099-11-05','2099-11-05','06:00','08:00'),/같은 시간/)
  await clear();await night();await assert.rejects(add('official','2099-11-05','2099-11-05','09:00','18:00'),/같은 시간/)
  await clear()
  await db.exec(`reset role;delete from public.attendance_start_settings where employee_id='${staff}' and month='2099-11-01';set role authenticated`)
  await night();await assert.rejects(annual(),/같은 시간/)
  await db.exec('reset role')
  assert.equal(await scalar("select md5(jsonb_agg(to_jsonb(t) order by id)::text) from public.attendance_clock_ins t"),before)
  console.info('Overnight annual DB: both orders, exact/over boundary, monthly and prior-day override, continuous, same-day/official conflicts, missing basis, ACL and original clocks passed')
} finally {await db.close()}
