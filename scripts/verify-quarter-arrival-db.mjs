import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

// Isolated in-memory database. Never connects to the shared production database.
const db = await PGlite.create()
const staff = '10000000-0000-4000-8000-000000000001', peer = '10000000-0000-4000-8000-000000000002'
const company = 'e0000000-0000-4000-8000-000000000001'
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0]
try {
  await db.exec(`create role anon; create role authenticated; create schema app; create schema auth;
    grant usage on schema app,auth,public to authenticated,anon;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.companies(id uuid primary key);
    create table public.profiles(id uuid primary key,company_id uuid,department_id uuid,status text,display_name text,position text);
    create table public.departments(id uuid primary key,name text);
    create table public.attendance_start_settings(id uuid primary key default gen_random_uuid(),company_id uuid,employee_id uuid,department_id uuid,month date,start_time time,updated_at timestamptz default now());
    create table public.attendance_start_options(company_id uuid,start_time time);
    create table public.company_work_hours(company_id uuid,lunch_start time,lunch_end time);
    create table public.attendance_clock_ins(id uuid primary key default gen_random_uuid(),company_id uuid,employee_id uuid,work_date date,clock_in time,clock_out_at timestamptz,clock_out_reported_at timestamptz,auto_closed_at timestamptz,work_confirmed_at timestamptz,clock_in_source text default 'manual',clock_out_source text,offsite_returned_at timestamptz,unique(employee_id,work_date));
    create table public.company_leave_requests(id uuid primary key default gen_random_uuid(),company_id uuid,employee_id uuid,kind text,status text,from_date date,to_date date,start_time time,end_time time,offsite_work_start time,offsite_continuous boolean default false,end_next_day boolean default false,created_at timestamptz default now(),decided_at timestamptz);
    create function app.can_edit_org_assignment() returns boolean language sql as $$select false$$;
    create function app.company_review_company_id() returns uuid language sql as $$select null::uuid$$;
    insert into public.companies values('${company}');
    insert into public.profiles values('${staff}','${company}',null,'active','staff','staff'),('${peer}','${company}',null,'active','peer','peer');
    insert into public.attendance_start_settings(company_id,employee_id,month,start_time) values('${company}','${staff}','2026-11-01','09:00');
    insert into public.company_work_hours values('${company}','13:00','14:00');
    insert into public.attendance_clock_ins(company_id,employee_id,work_date,clock_in) values('${company}','${staff}','2026-11-10','10:46');
    insert into public.company_leave_requests(company_id,employee_id,kind,status,from_date,to_date,start_time,end_time) values('${company}','${staff}','quarter','approved','2026-11-10','2026-11-10','09:00','11:00');
    select set_config('request.jwt.claim.sub','${staff}',false);`)
  const oldSource = await readFile('supabase/migrations/20261103105053_offsite_workday_start_override.sql', 'utf8')
  await db.exec(oldSource.match(/create function app\.attendance_start_for_date\([\s\S]*?\$\$;/)[0])
  const lateSource = await readFile('supabase/migrations/20261102141000_late_arrival_statements.sql', 'utf8')
  await db.exec(lateSource.match(/create table public\.late_arrival_statements[\s\S]*?\n\);/)[0])
  const effectiveSource = await readFile('supabase/migrations/20261102063022_offsite_attendance_automation.sql', 'utf8')
  await db.exec(effectiveSource.match(/create function public\.list_effective_attendance_clocks\([\s\S]*?\$\$;/)[0])
  const before = await scalar('select to_jsonb(c) from public.attendance_clock_ins c')
  const migration = await readFile('supabase/migrations/20261110024519_quarter_leave_arrival.sql', 'utf8')
  await db.exec(migration.replaceAll('pg_catalog.clock_timestamp()', "'2026-11-10T12:00:00+09:00'::timestamptz"))
  const arrivalMigration = await readFile('supabase/migrations/20261118111222_offsite_and_half_leave_arrival.sql', 'utf8')
  await db.exec(arrivalMigration)
  const arrival = () => scalar("select app.attendance_arrival_start_for_date($1,'2026-11-10')", [staff])
  assert.equal(await arrival(), '11:00:00')
  assert.equal(await scalar("select app.attendance_start_for_date($1,'2026-11-10')", [staff]), '09:00:00', '정규 근무 기준 유지')
  const basis = await scalar("select app.get_my_workday_basis('2026-11-10')")
  assert.equal(basis.start_time, '09:00:00'); assert.equal(basis.arrival_start_time, '11:00:00')
  assert.equal(basis.quarterArrivalSupported, true)
  await assert.rejects(scalar("select app.save_my_late_statement('무','기타','내용','대책')"), /지각이 아니라서/)
  assert.equal(await scalar("select start_time from app.attendance_workday_starts_between($1,'2026-11-10','2026-11-10')", [staff]), '11:00:00')
  await assert.rejects(scalar("select * from app.attendance_workday_starts_between($1,'2026-11-10','2026-11-10')", [peer]), /볼 수 없습니다/)
  for (const status of ['pending', 'cancelled', 'rejected']) {
    await db.query('update public.company_leave_requests set status=$1', [status])
    assert.equal(await arrival(), '09:00:00')
  }
  await db.exec("update public.company_leave_requests set status='approved',start_time='16:00',end_time='18:00'")
  assert.equal(await arrival(), '09:00:00')
  await db.exec("update public.company_leave_requests set start_time='09:00',end_time='11:00'; update public.attendance_clock_ins set clock_in='11:06'")
  assert.equal((await scalar("select to_jsonb(app.save_my_late_statement('무','기타','내용','대책'))")).late_minutes, 6)
  await db.exec("update public.attendance_clock_ins set clock_in='10:46'; update public.company_leave_requests set start_time='11:00',end_time='13:00'; update public.attendance_start_settings set start_time='11:00'")
  assert.equal(await arrival(), '14:00:00', '설정된 점심시간 반영')
  assert.equal(await scalar("select app.attendance_arrival_start_for_date($1,'2026-11-11')", [staff]), '11:00:00', '다음 날 휴가 미적용')
  assert.equal(await scalar("select has_function_privilege('anon','app.attendance_arrival_start_for_date(uuid,date)','EXECUTE')"), false)
  assert.equal(await scalar("select has_function_privilege('authenticated','app.attendance_arrival_start_for_date(uuid,date)','EXECUTE')"), false)
  assert.deepEqual(await scalar('select to_jsonb(c) from public.attendance_clock_ins c'), before, '원본 복구 및 마이그레이션 비변조 검증')

  const file = () => scalar("select to_jsonb(app.save_my_late_statement('무','기타','내용','대책'))")
  await db.exec(`delete from public.late_arrival_statements;
    delete from public.company_leave_requests;
    update public.attendance_start_settings set start_time='09:00';
    update public.attendance_clock_ins set clock_in='10:00',clock_in_source='offsite';
    insert into public.company_leave_requests(company_id,employee_id,kind,status,from_date,to_date,start_time,end_time)
    values('${company}','${staff}','offsite','approved','2026-11-10','2026-11-10','10:00','19:00');`)
  assert.equal(await arrival(), '10:00:00')
  await assert.rejects(file(), /지각이 아니라서/)
  await db.exec(`insert into public.company_leave_requests(company_id,employee_id,kind,status,from_date,to_date,start_time,end_time)
    values('${company}','${staff}','correction','approved','2026-11-10','2026-11-10','10:12','19:00');`)
  assert.equal(await arrival(), '09:00:00', '승인 정정 출근에 외근 자동 출근 예외를 적용하지 않음')
  assert.equal((await file()).late_minutes, 72, '승인된 출근 정정 10:12 사용')
  assert.equal(await scalar('select clock_in from public.attendance_clock_ins'), '10:00:00')
  await db.exec(`delete from public.late_arrival_statements;
    delete from public.company_leave_requests;
    update public.attendance_start_settings set start_time='10:00';
    update public.attendance_clock_ins set clock_in='14:39',clock_in_source='manual';
    insert into public.company_leave_requests(company_id,employee_id,kind,status,from_date,to_date,start_time,end_time)
    values('${company}','${staff}','half','approved','2026-11-10','2026-11-10','09:00','14:00');`)
  assert.equal(await arrival(), '14:00:00')
  assert.equal((await scalar("select app.get_my_workday_basis('2026-11-10')")).arrival_start_time, '14:00:00')
  assert.equal(await scalar("select start_time from app.attendance_workday_starts_between($1,'2026-11-10','2026-11-10')", [staff]), '14:00:00')
  assert.equal((await file()).late_minutes, 39)
  await db.exec("update public.attendance_clock_ins set clock_in='14:05'")
  await assert.rejects(file(), /지각이 아니라서/)
  await db.exec("update public.attendance_clock_ins set clock_in='10:40'; update public.company_leave_requests set kind='offsite',start_time='14:00',end_time='20:30'; delete from public.late_arrival_statements")
  assert.equal(await arrival(), '10:00:00')
  assert.equal((await file()).late_minutes, 40)
  assert.equal(await scalar('select clock_in from public.attendance_clock_ins'), '10:40:00')
  console.info('Attendance arrival DB: half/quarter leave, scheduled offsite, afternoon office arrival, correction, permissions and original values passed')
} finally { await db.close() }
