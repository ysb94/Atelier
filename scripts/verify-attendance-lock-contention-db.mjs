// In-memory PostgreSQL regression only. Real competing sessions are verified separately.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const db = await PGlite.create()
const company = 'e0000000-0000-4000-8000-000000000001'
const employee = number => `10000000-0000-4000-8000-${String(number).padStart(12, '0')}`
const value = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0]
const migration = name => readFile(`supabase/migrations/${name}`, 'utf8')
const snapshot = async () => {
  const tables = (await db.query("select schemaname,tablename from pg_tables where schemaname in ('public','app','cron') order by 1,2")).rows
  return Promise.all(tables.map(async ({ schemaname, tablename }) => [schemaname, tablename,
    await value(`select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'')) from "${schemaname}"."${tablename}" t`)]))
}
const functionIdentity = () => db.query(`select proname,proowner,prosecdef,proargtypes::text,prorettype,proacl::text
  from pg_proc where pronamespace='app'::regnamespace order by proname,proargtypes::text`)

try {
  await db.exec(`create role anon; create role authenticated; create schema app; create schema auth; create schema cron;
    grant usage on schema app,auth,public to authenticated,anon;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table cron.job(jobname text,schedule text,command text);
    create function cron.schedule(text,text,text) returns bigint language sql as $$insert into cron.job values($1,$2,$3);select 1::bigint$$;
    create table companies(id uuid primary key);
    create table profiles(id uuid primary key,company_id uuid,department_id uuid,status text,display_name text);
    create table departments(id uuid primary key,name text);
    create table attendance_exemptions(profile_id uuid primary key);
    create table attendance_start_settings(id uuid primary key,company_id uuid,month date,department_id uuid,employee_id uuid,start_time time,updated_at timestamptz);
    create table company_work_hours(company_id uuid primary key,lunch_start time,lunch_end time);
    create table app.leave_balance_calendar_years(year integer primary key);
    create table app.leave_balance_holidays(day date primary key,label text);
    create table attendance_clock_ins(id uuid primary key default gen_random_uuid(),company_id uuid,employee_id uuid,work_date date,clock_in time,
      created_at timestamptz default now(),unique(employee_id,work_date));
    create table company_leave_requests(id uuid primary key default gen_random_uuid(),company_id uuid,employee_id uuid,employee_name text,
      department_id uuid,department_name text,kind text,from_date date,to_date date,start_time time,end_time time,note text default '',place text default '',
      status text,created_at timestamptz default now(),decided_at timestamptz,decided_by uuid,decided_by_name text,decision_note text,
      advance_requested boolean default false,constraint company_leave_requests_span_check check(true));
    create table company_leave_files(request_id uuid,ready boolean);
    alter table attendance_clock_ins enable row level security;
    alter table company_leave_requests enable row level security;
    create policy own_clock on attendance_clock_ins for select to authenticated using(employee_id=auth.uid());
    create policy own_request on company_leave_requests for select to authenticated using(employee_id=auth.uid());
    grant select on attendance_clock_ins,company_leave_requests to authenticated;
    create function app.clock_in_today() returns time language sql as $$select time '09:00'$$;
    create function app.is_department_request_approver(uuid,uuid,text) returns boolean language sql as $$select false$$;
    create function app.can_edit_org_assignment() returns boolean language sql as $$select false$$;
    create function app.company_review_company_id() returns uuid language sql as $$select null::uuid$$;
    insert into companies values('${company}');
    insert into company_work_hours values('${company}','12:00','13:00');
    insert into app.leave_balance_calendar_years select extract(year from current_date+i)::integer from generate_series(-1,1) s(i) group by 1;
    insert into profiles select ('10000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'${company}',null,'active','fixture '||i
      from generate_series(1,4) s(i);`)
  for (const name of [
    '20261012034832_attendance_clock_out.sql', '20261012081000_undo_clock_out_today.sql',
    '20261026103425_attendance_previous_checkout.sql', '20261029130013_attendance_presence_confirmation.sql',
    '20261102063022_offsite_attendance_automation.sql',
  ]) await db.exec(await migration(name))
  const today = await value("select (clock_timestamp() at time zone 'Asia/Seoul')::date::text")
  const yesterday = await value("select ((clock_timestamp() at time zone 'Asia/Seoul')::date-1)::text")
  await db.exec(`update app.offsite_attendance_config set activated_at='${yesterday}T00:00:00+09:00';
    insert into company_leave_requests(company_id,employee_id,kind,from_date,to_date,start_time,end_time,status,created_at)
      select '${company}',id,'offsite','${yesterday}','${yesterday}','09:00','18:00','approved','${yesterday}T08:00:00+09:00'
      from profiles where id in ('${employee(1)}','${employee(2)}');`)
  const beforeRows = await snapshot(), beforeFunctions = await functionIdentity()
  await db.exec(await migration('20261102101948_attendance_lock_contention_guard.sql'))
  assert.deepEqual(await snapshot(), beforeRows, 'migration changes no rows or cron schedule')
  assert.deepEqual(await functionIdentity(), beforeFunctions, 'existing signatures, security definers and execution grants remain identical')
  assert.deepEqual((await db.query("select schedule,command from cron.job where jobname='atelier-attendance-presence'")).rows,
    [{ schedule: '* * * * *', command: 'select app.process_attendance_presence();' }])

  // PGlite has one session: inject PostgreSQL's lock exception after an actual clock write.
  // This verifies per-employee rollback/continuation, not real concurrent lock acquisition.
  await db.exec(`create function app.fixture_offsite_lock() returns trigger language plpgsql as $$begin
      if new.employee_id='${employee(1)}' and new.action='auto_out' then raise exception 'fixture lock' using errcode='55P03';end if;return new;end$$;
    create trigger fixture_offsite_lock before insert on app.offsite_attendance_events for each row execute function app.fixture_offsite_lock();
    select app.process_attendance_presence();`)
  assert.equal(Number(await value('select count(*) from attendance_clock_ins where employee_id=$1', [employee(1)])), 0, 'deferred offsite employee rolls back partial auto-in/out')
  assert.equal(await value('select clock_out_source from attendance_clock_ins where employee_id=$1', [employee(2)]), 'offsite', 'other offsite employee continues')
  await db.exec('drop trigger fixture_offsite_lock on app.offsite_attendance_events; select app.process_attendance_presence(); select app.process_attendance_presence();')
  assert.equal(Number(await value('select count(*) from attendance_clock_ins')), 2, 'next run catches up without duplicate clocks')
  assert.equal(Number(await value("select count(*) from app.offsite_attendance_events where action='auto_out'")), 2, 'one auto-out event per employee')

  await db.exec(`insert into attendance_start_settings
      select gen_random_uuid(),'${company}',date_trunc('month','${yesterday}'::date)::date,null,id,'09:00',now() from profiles where id in ('${employee(3)}','${employee(4)}');
    insert into attendance_clock_ins(company_id,employee_id,work_date,clock_in)
      select '${company}',id,'${yesterday}','09:00' from profiles where id in ('${employee(3)}','${employee(4)}');
    insert into app.attendance_presence_sessions(clock_id,expected_end,next_prompt_at)
      select id,app.attendance_presence_end(id),clock_timestamp()-interval '1 second' from attendance_clock_ins where employee_id in ('${employee(3)}','${employee(4)}');
    create function app.fixture_presence_lock() returns trigger language plpgsql as $$begin
      if exists(select 1 from public.attendance_clock_ins where id=new.clock_id and employee_id='${employee(3)}') then
        raise exception 'fixture lock' using errcode='55P03';end if;return new;end$$;
    create trigger fixture_presence_lock before insert on app.attendance_presence_checks for each row execute function app.fixture_presence_lock();
    select app.process_attendance_presence();`)
  assert.equal(Number(await value(`select count(*) from app.attendance_presence_checks q join attendance_clock_ins c on c.id=q.clock_id where c.employee_id=$1`, [employee(3)])), 0)
  assert.equal(Number(await value(`select count(*) from app.attendance_presence_checks q join attendance_clock_ins c on c.id=q.clock_id where c.employee_id=$1`, [employee(4)])), 1, 'other presence employee continues')
  await db.exec('drop trigger fixture_presence_lock on app.attendance_presence_checks; select app.process_attendance_presence(); select app.process_attendance_presence();')
  assert.equal(Number(await value('select count(*) from app.attendance_presence_checks')), 2, 'deferred presence catches up once')
  assert.equal(Number(await value('select sum(missed_count) from app.attendance_presence_sessions')), 0, 'undelivered prompts are not fabricated misses')

  // Unrelated failures still fail the worker rather than masquerading as a successful skip.
  await db.exec(`create function app.fixture_real_failure() returns trigger language plpgsql as $$begin raise exception 'fixture non-lock failure';end$$;
    update app.attendance_presence_checks set due_at=clock_timestamp()-interval '10 minutes';
    create trigger fixture_real_failure before update on app.attendance_presence_checks for each row execute function app.fixture_real_failure();`)
  await assert.rejects(() => db.exec('select app.process_attendance_presence()'), /fixture non-lock failure/)
  await db.exec('drop trigger fixture_real_failure on app.attendance_presence_checks')

  await db.exec(`select set_config('request.jwt.claim.sub','${employee(1)}',false);set role authenticated;`)
  await assert.rejects(() => db.exec('select app.process_attendance_presence()'), /permission denied/)
  await assert.rejects(() => db.exec("select app.advance_offsite_attendance(auth.uid(),current_date,now())"), /permission denied/)
  assert.equal((await value('select public.my_attendance_presence()')).state, 'inactive', `no current-day record invented on ${today}`)
  console.log('attendance-lock-contention-db: full migration, unchanged rows/ACLs/schedule, deferred employee rollback, other employees progress, retry/idempotence, real errors propagate, authority passed; PGlite is single-session, real contention requires the separate PostgreSQL check')
} catch (error) {
  console.error('attendance-lock-contention-db failed:', error.message, { code: error.code, query: error.query })
  process.exitCode = 1
} finally { await db.close() }
