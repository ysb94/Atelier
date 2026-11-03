import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const db = await PGlite.create()
const company = 'e0000000-0000-4000-8000-000000000001'
const staff = '10000000-0000-4000-8000-000000000001'
const peer = '10000000-0000-4000-8000-000000000002'
const value = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0]
try {
  await db.exec(`
    create role anon; create role authenticated; create schema app; create schema auth;
    grant usage on schema app,auth,public to authenticated,anon;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.companies(id uuid primary key);
    create table public.profiles(id uuid primary key,company_id uuid,department_id uuid,status text,display_name text);
    create table public.departments(id uuid primary key,name text);
    create table public.attendance_exemptions(profile_id uuid primary key);
    create table app.leave_balance_calendar_years(year integer primary key);
    create table app.leave_balance_holidays(day date primary key,label text);
    create table public.attendance_clock_ins(id uuid primary key default gen_random_uuid(),company_id uuid,employee_id uuid,work_date date,clock_in time,
      clock_out_at timestamptz,clock_out_reported_at timestamptz,auto_closed_at timestamptz,work_confirmed_at timestamptz,created_at timestamptz default now(),unique(employee_id,work_date));
    create table public.company_leave_requests(id uuid primary key default gen_random_uuid(),company_id uuid,employee_id uuid,employee_name text,
      department_id uuid,department_name text,kind text,from_date date,to_date date,start_time time,end_time time,note text default '',place text default '',
      status text,created_at timestamptz default now(),decided_at timestamptz,decided_by uuid,decided_by_name text,decision_note text,advance_requested boolean default false,
      constraint company_leave_requests_span_check check(true));
    alter table public.attendance_clock_ins enable row level security;
    alter table public.company_leave_requests enable row level security;
    create policy own_clock on public.attendance_clock_ins for select to authenticated using(employee_id=auth.uid());
    create policy own_request on public.company_leave_requests for select to authenticated using(employee_id=auth.uid());
    grant select on public.attendance_clock_ins,public.company_leave_requests to authenticated;
    create function app.attendance_presence_end(uuid) returns timestamptz language sql as $$select null::timestamptz$$;
    create function app.process_attendance_presence() returns void language sql as $$select$$;
    create function app.clock_in_today() returns time language sql as $$select time '09:00'$$;
    create function app.is_department_request_approver(uuid,uuid,text) returns boolean language sql as $$select true$$;
    create function app.can_edit_org_assignment() returns boolean language sql as $$select false$$;
    create function app.company_review_company_id() returns uuid language sql as $$select null::uuid$$;
    create table public.company_leave_files(request_id uuid,ready boolean);
    insert into public.companies values('${company}');
    insert into public.profiles values('${staff}','${company}',null,'active','staff'),('${peer}','${company}',null,'active','peer');
    insert into app.leave_balance_calendar_years values(2026);
  `)
  await db.exec(await readFile('supabase/migrations/20261012081000_undo_clock_out_today.sql', 'utf8'))
  await db.exec(await readFile('supabase/migrations/20261102063022_offsite_attendance_automation.sql', 'utf8'))
  const lockGuard = await readFile('supabase/migrations/20261102101948_attendance_lock_contention_guard.sql', 'utf8')
  for (const name of ['offsite_attendance_state', 'undo_clock_out_today', 'process_attendance_presence', 'clock_out_today']) {
    const definition = lockGuard.match(new RegExp(`create or replace function app\\.${name}\\([\\s\\S]*?\\$\\$;`, 'i'))
    assert.ok(definition, `실제 잠금 보완 함수 ${name}`)
    await db.exec(definition[0])
  }
  await db.exec(`alter function app.clock_in_today() set lock_timeout='2s';revoke all on function app.clock_out_today() from public,anon;grant execute on function app.clock_out_today() to authenticated;
    create table app.attendance_presence_sessions(clock_id uuid,closed_at timestamptz);
    create function app.advance_attendance_presence(uuid,timestamptz) returns void language sql as $$select$$;
    create function app.meeting_availability(uuid,date,uuid[],uuid) returns jsonb language sql stable security definer set search_path='' as $$select '[]'::jsonb$$;
    revoke all on function app.meeting_availability(uuid,date,uuid[],uuid) from public,anon;grant execute on function app.meeting_availability(uuid,date,uuid[],uuid) to authenticated;`)

  await db.exec(await readFile('supabase/migrations/20261103081826_offsite_overnight_schedule.sql','utf8'))
  await db.exec(`
    alter table public.company_leave_requests add column offsite_work_start time;
    alter table public.company_leave_requests add constraint company_leave_offsite_work_start_check check(true);
    create table public.attendance_start_settings(id uuid,company_id uuid,employee_id uuid,department_id uuid,month date,start_time time,updated_at timestamptz);
    create table public.company_work_hours(company_id uuid,lunch_start time,lunch_end time);
    insert into public.company_work_hours values('${company}','12:00','13:00');
    create table public.attendance_start_options(company_id uuid,start_time time);
    create function app.basic_work_allowed(text) returns boolean language sql stable as $$select auth.uid()='${peer}'::uuid$$;
    create table app.employee_extra_leave(id uuid primary key,employee_id uuid,days numeric,expires_on date,note text,deleted_at timestamptz);
    alter table app.employee_extra_leave enable row level security;
    create function app.save_employee_extra_leave(p_id uuid,p_employee uuid,p_days numeric,p_expires date,p_note text,p_version integer,p_delete boolean) returns uuid language plpgsql as $$begin insert into app.employee_extra_leave values(p_id,p_employee,p_days,p_expires,p_note,null);return p_id;end$$;
    create function public.list_my_home_work_notifications() returns jsonb language sql stable security invoker set search_path='' as $$select '[]'::jsonb$$;
    create table public.my_home_notification_reads(reader_id uuid,event_key text,read_at timestamptz default now());
    grant select on public.my_home_notification_reads,public.profiles to authenticated;
    insert into public.attendance_start_settings values(gen_random_uuid(),'${company}','${staff}',null,'2026-11-01','09:00',now());
    insert into public.attendance_start_settings values(gen_random_uuid(),'${company}','${staff}',null,'2026-12-01','09:00',now());
  `)
  const override=await readFile('supabase/migrations/20261103090128_offsite_workday_start_override.sql','utf8')
  for(const name of ['attendance_start_for_date','guard_offsite_workday_start']) {
    const fn=override.match(new RegExp(`create function app\\.${name}\\([\\s\\S]*?\\$\\$;`,'i'))
    assert.ok(fn,name);await db.exec(fn[0])
  }
  await db.exec(await readFile('supabase/migrations/20261103081759_overtime_actual_reports.sql','utf8'))
  await db.exec(`insert into public.company_leave_requests(company_id,employee_id,kind,from_date,to_date,start_time,end_time,status) values('${company}','${peer}','offsite','2025-11-03','2025-11-06','09:00','18:00','approved')`)
  const originalRows=await value("select md5(jsonb_agg(to_jsonb(t) order by id)::text) from public.company_leave_requests t")
  const oldPolicies=await value("select md5(jsonb_agg(to_jsonb(p) order by policyname)::text) from pg_policies p where tablename in ('company_leave_requests','attendance_clock_ins')")
  const oldAcl=await value("select md5(jsonb_agg(jsonb_build_array(proname,proacl::text,prosecdef,proconfig) order by proname)::text) from pg_proc where pronamespace='app'::regnamespace and proname in ('advance_offsite_attendance','offsite_attendance_state','process_attendance_presence','attendance_presence_end','clock_in_today','clock_out_today','attendance_start_for_date','guard_offsite_workday_start')")
  const migration=await readFile('supabase/migrations/20261103102914_offsite_continuous_settlement.sql','utf8')
  await db.exec(migration)
  assert.equal(await value("select md5(jsonb_agg(to_jsonb(t)-'offsite_continuous' order by id)::text) from public.company_leave_requests t"),originalRows,'existing repeated offsite original preserved')
  const clockFunctions=(await db.query("select pg_get_functiondef(oid) as source from pg_proc where pronamespace='app'::regnamespace and proname in ('offsite_attendance_state','clock_in_today','clock_out_today','process_attendance_presence','attendance_presence_end','save_offsite_settlement','offsite_settlement_preview','guard_overtime_actual')")).rows
  for(const fn of clockFunctions) await db.exec(fn.source.replace(/(?:pg_catalog\.)?clock_timestamp\(\)/g,"coalesce(nullif(current_setting('test.now',true),'')::timestamptz,clock_timestamp())"))
  assert.equal(await value("select md5(jsonb_agg(to_jsonb(p) order by policyname)::text) from pg_policies p where tablename in ('company_leave_requests','attendance_clock_ins')"),oldPolicies)
  assert.equal(await value("select md5(jsonb_agg(jsonb_build_array(proname,proacl::text,prosecdef,proconfig) order by proname)::text) from pg_proc where pronamespace='app'::regnamespace and proname in ('advance_offsite_attendance','offsite_attendance_state','process_attendance_presence','attendance_presence_end','clock_in_today','clock_out_today','attendance_start_for_date','guard_offsite_workday_start')"),oldAcl)
  await db.exec("update app.offsite_attendance_config set activated_at='2026-11-01T00:00:00+09:00'; select set_config('test.now','2026-11-06T19:00:00+09:00',false)")
  const request=await value(`insert into public.company_leave_requests(company_id,employee_id,kind,from_date,to_date,start_time,end_time,status,created_at,offsite_continuous) values('${company}','${staff}','offsite','2026-11-04','2026-11-06','09:00','03:00','approved','2026-11-03T00:00:00+09:00',true) returning id`)
  await db.query("select app.advance_offsite_attendance($1,'2026-11-04','2026-11-04T09:00:00+09:00')",[staff])
  await db.exec(`select set_config('request.jwt.claim.sub','${staff}',false); select set_config('test.now','2026-11-06T00:30:00+09:00',false)`)
  const state=await value('select app.offsite_attendance_state(false)')
  assert.equal(state.workDate,'2026-11-04');assert.equal(state.state,'offsite');assert.equal(state.continuousSupported,true)
  assert.equal(await value('select app.attendance_presence_end(id) from public.attendance_clock_ins'),null)
  await assert.rejects(()=>db.query('select app.clock_in_today()'),/외근이 근무 중/)
  await db.exec("select set_config('test.now','2026-11-06T03:00:00+09:00',false)")
  await db.query("select app.advance_offsite_attendance($1,'2026-11-04','2026-11-06T03:00:00+09:00')",[staff])
  assert.equal(new Date(await value('select clock_out_at from public.attendance_clock_ins')).toISOString(),'2026-11-05T18:00:00.000Z')
  assert.equal(Number(await value('select count(*) from public.attendance_clock_ins')),1,'multiple days retain original attendance workday')
  await db.exec(`select set_config('request.jwt.claim.sub','${peer}',false);set role authenticated`)
  const preview=await value('select public.offsite_settlement_preview($1)',[request])
  assert.deepEqual(preview.dates,[{date:'2026-11-04',minutes:360},{date:'2026-11-05',minutes:900},{date:'2026-11-06',minutes:180}])
  await assert.rejects(()=>db.query('select public.save_offsite_settlement($1,$2,$3,null,null,$4)',[request,'overtime',{'2026-11-04':361},'too much']),/넘습니다/)
  await db.query('select public.save_offsite_settlement($1,$2,$3,$4,$5,$6)',[request,'leave',{'2026-11-04':120,'2026-11-05':60},0.5,'2026-12-31','현장 추가 근무 보상'])
  await db.query('select public.save_offsite_settlement($1,$2,$3,$4,$5,$6)',[request,'leave',{'2026-11-04':120,'2026-11-05':60},0.5,'2026-12-31','현장 추가 근무 보상'])
  await db.exec('reset role')
  assert.equal(Number(await value('select count(*) from app.employee_extra_leave')),1,'retry must not grant twice')
  assert.equal(Number(await value('select days from app.employee_extra_leave')),0.5)
  await db.exec(`select set_config('request.jwt.claim.sub','${staff}',false);set role authenticated`)
  assert.equal(Number(await value('select count(*) from public.offsite_settlements')),1,'owner can see own result')
  const notices=await value('select public.list_my_home_work_notifications()')
  assert.equal(notices.length,1);assert.equal(notices[0].event_type,'offsite-settlement');assert.match(notices[0].decision_note,/야근 누적 제외/)
  await assert.rejects(()=>db.query('select public.save_offsite_settlement($1,$2,$3,null,null,$4)',[request,'overtime',{'2026-11-04':120},'unauthorized']),/관리 권한/)
  await assert.rejects(()=>db.query('select public.offsite_settlement_preview($1)',[request]),/관리 권한/)
  await assert.rejects(()=>db.query('update public.offsite_settlements set mode=$1',['overtime']),/permission denied/)
  await db.exec(`reset role;select set_config('request.jwt.claim.sub','${peer}',false);set role authenticated`)
  assert.equal(Number(await value('select count(*) from public.offsite_settlements')),0,'unassigned other employee cannot read result through RLS')
  await assert.rejects(()=>db.query('select public.save_offsite_settlement($1,$2,$3,null,null,$4)',[request,'overtime',{'2026-11-04':120},'stale']),/이미 후처리/)
  await db.exec('reset role')
  await assert.rejects(()=>db.query("update public.company_leave_requests set status='cancelled' where id=$1",[request]),/보상 처리/)
  await assert.rejects(()=>db.query('update app.employee_extra_leave set days=1'),/직접 수정/)
  const overtime=await value(`insert into public.company_leave_requests(company_id,employee_id,kind,from_date,to_date,start_time,end_time,status) values('${company}','${staff}','overtime','2026-11-04','2026-11-04','18:00','20:00','approved') returning id`)
  await db.exec(`select set_config('request.jwt.claim.sub','${staff}',false);set role authenticated`)
  await assert.rejects(()=>db.query("select public.save_overtime_actual($1,'2026-11-04T18:00:00+09:00','2026-11-04T19:00:00+09:00',0,0)",[overtime]),/중복 누적/)
  await db.exec('reset role;set role anon')
  await assert.rejects(()=>db.query('select public.offsite_settlement_preview($1)',[request]),/permission denied/)
  await assert.rejects(()=>db.query('select * from public.offsite_settlements'),/permission denied/)

  await db.exec(`reset role; select set_config('request.jwt.claim.sub','${staff}',false); select set_config('test.now','2026-11-12T23:00:00+09:00',false)`)
  const paid=await value(`insert into public.company_leave_requests(company_id,employee_id,kind,from_date,to_date,start_time,end_time,status,created_at,offsite_continuous) values('${company}','${staff}','offsite','2026-11-09','2026-11-11','09:00','21:00','approved','2026-11-08T00:00:00+09:00',true) returning id`)
  await db.query("select app.advance_offsite_attendance($1,'2026-11-09','2026-11-09T09:00:00+09:00')",[staff])
  await db.exec("select set_config('test.now','2026-11-11T12:00:00+09:00',false)")
  assert.equal((await value('select app.offsite_attendance_state(true)')).state,'returned')
  await db.query("select app.advance_offsite_attendance($1,'2026-11-09','2026-11-12T00:00:00+09:00')",[staff])
  assert.equal(await value("select clock_out_at from public.attendance_clock_ins where work_date='2026-11-09'"),null,'office return stops scheduled checkout')
  await db.exec("select set_config('test.now','2026-11-11T22:00:00+09:00',false)")
  const out=await value('select app.clock_out_today()')
  // The explicit checkout still targets the original workday after returning.
  assert.ok(out)
  await db.exec(`select set_config('test.now','2026-11-12T23:00:00+09:00',false); select set_config('request.jwt.claim.sub','${peer}',false);set role authenticated`)
  await db.query('select public.save_offsite_settlement($1,$2,$3,null,null,$4)',[paid,'overtime',{'2026-11-09':120,'2026-11-10':90},'실제 야근 확인'])
  await db.exec('reset role')
  assert.equal(Number(await value('select count(*) from app.employee_extra_leave')),1,'wage mode does not grant leave')
  await db.exec(`select set_config('request.jwt.claim.sub','${staff}',false);set role authenticated`)
  assert.equal((await value('select minutes_by_date from public.offsite_settlements where request_id=$1',[paid]))['2026-11-10'],90)
  await db.exec('reset role')
  const future=await value(`insert into public.company_leave_requests(company_id,employee_id,kind,from_date,to_date,start_time,end_time,status,created_at,offsite_continuous) values('${company}','${staff}','offsite','2026-12-01','2026-12-04','09:00','03:00','approved','2026-11-03T00:00:00+09:00',true) returning id`)
  await db.exec(`select set_config('request.jwt.claim.sub','${peer}',false);set role authenticated`)
  await assert.rejects(()=>db.query('select public.save_offsite_settlement($1,$2,$3,null,null,$4)',[future,'none',{},'not yet']),/종료된 외근/)
  await db.exec('reset role')
  await db.exec("select set_config('test.now','2026-12-04T03:00:00+09:00',false)")
  await db.query('select app.process_attendance_presence()')
  assert.equal(new Date(await value("select clock_out_at from public.attendance_clock_ins where work_date='2026-12-01' and employee_id=$1",[staff])).toISOString(),'2026-12-03T18:00:00.000Z','cron resolves original multi-day anchor')
  assert.equal(Number(await value("select count(*) from public.attendance_clock_ins where work_date between '2026-12-01' and '2026-12-04' and employee_id=$1",[staff])),1)
  console.info('Continuous offsite DB: >24h original workday, midnight, auto-out, extra minutes, grants atomic/idempotent, duplicate wage prevention, permission/RLS/config preservation passed')
} catch(error) {console.error({message:error.message,where:error.where,detail:error.detail,code:error.code,position:error.position,internal:error.internalQuery,near:error.query?.slice(Math.max(0,Number(error.position)-180),Number(error.position)+160)});process.exitCode=1} finally {await db.close()}
