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
  const add = async (start = '16:00', end = '20:00', shift = '10:00', date = '2026-11-04', kind = 'offsite', employee = staff) => scalar(`insert into public.company_leave_requests(company_id,employee_id,kind,from_date,to_date,start_time,end_time,offsite_work_start,place,note) values($1,$2,$3,$4,$4,$5,$6,$7,'거래처','업무') returning id`, [company,employee,kind,date,start,end,shift])
  await db.exec('set role authenticated')
  const id = await add()
  assert.equal((await scalar("select public.get_my_workday_basis('2026-11-04')")).start_time, '10:00:00')
  assert.equal((await scalar("select public.get_my_workday_basis('2026-11-05')")).start_time, '09:00:00')
  const starts = (await db.query("select * from public.attendance_workday_starts_between($1,'2026-11-04','2026-11-05')", [staff])).rows
  assert.deepEqual(starts.map(row => row.start_time), ['10:00:00','09:00:00'])
  await assert.rejects(add('20:00','21:00','09:00'), /다른 출근 기준/)
  await assert.rejects(add('20:00','21:00','11:00'), /선택지/)
  await assert.rejects(add('20:00','21:00','10:00','2026-11-03'), /오늘 이후/)
  await assert.rejects(add('20:00','21:00','10:00','2026-11-05','annual'), /하루 외근/)
  await assert.rejects(db.query("update public.company_leave_requests set status='cancelled',offsite_work_start=$1 where id=$2",['09:00',id]), /원본/)
  await assert.rejects(db.query("select * from public.attendance_workday_starts_between($1,'2026-11-04','2026-11-05')",[peer]), /볼 수 없습니다/)
  await assert.rejects(db.query("select app.attendance_start_for_date($1,'2026-11-04')",[staff]), /permission denied/)
  const second = await add('20:00','21:00')
  await db.query("update public.company_leave_requests set status='cancelled' where id=$1",[id])
  assert.equal((await scalar("select public.get_my_workday_basis('2026-11-04')")).start_time, '10:00:00', '같은 기준의 두 번째 유효 외근이 있으면 유지')
  await db.query("update public.company_leave_requests set status='cancelled' where id=$1",[second])
  assert.equal((await scalar("select public.get_my_workday_basis('2026-11-04')")).start_time, '09:00:00', '모든 관련 외근 취소 시 월별 기준')
  await add()
  await db.query("insert into public.company_leave_requests(company_id,employee_id,kind,from_date,to_date,start_time,end_time,end_next_day,offsite_work_start,place,note) values($1,$2,'offsite','2026-11-05','2026-11-05','16:00','03:00',true,'10:00','거래처','밤샘')",[company,staff])
  assert.equal((await scalar("select public.get_my_workday_basis('2026-11-05')")).start_time, '10:00:00')
  assert.equal((await scalar("select public.get_my_workday_basis('2026-11-06')")).start_time, '09:00:00', '밤샘 외근도 기준 변경은 시작일만')
  await db.exec('reset role')
  const clockId = await scalar('select id from public.attendance_clock_ins')
  assert.equal(new Date(await scalar('select app.attendance_presence_end_original($1)',[clockId])).toISOString(),'2026-11-04T10:00:00.000Z', '서버 근무 확인 기준도 19시')
  await assert.rejects(db.query("select app.save_my_late_statement('없음','기타','업무','확인')"), /지각이 아니라서/)
  await db.exec("update public.attendance_clock_ins set clock_in='10:06'")
  const statement = await scalar("select to_jsonb(app.save_my_late_statement('없음','기타','업무','확인'))")
  assert.equal(statement.baseline_time,'10:00:00');assert.equal(statement.late_minutes,6)
  await db.exec(`select set_config('request.jwt.claim.sub','${peer}',false);set role authenticated`)
  await assert.rejects(add('16:00','20:00','10:00','2026-11-05','offsite',peer), /월별 출근 기준/)
  await db.exec(`reset role;update public.profiles set status='inactive' where id='${peer}';set role authenticated`)
  await assert.rejects(db.query("select public.get_my_workday_basis('2026-11-04')"), /재직 중/)
  await db.exec('reset role;set role anon')
  await assert.rejects(db.query("select * from public.attendance_workday_starts_between($1,'2026-11-04','2026-11-05')",[staff]), /permission denied/)
  console.info('DB: real request guard + migration; day/next day, conflicting registrations, cancellation, immutable source, server presence/late statement, RLS/permissions and original clock preservation passed')
} catch (error) {
  console.error('offsite-workday-start-db:', { message: error.message, code: error.code, where: error.where, at: error.stack?.split('\n').find(line => line.includes('verify-offsite-workday-start-db.mjs')) })
  process.exitCode = 1
} finally { await db.close() }
