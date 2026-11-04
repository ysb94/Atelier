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
  const third='10000000-0000-4000-8000-000000000003'
  const ids=[staff,peer,third]
  const form={from:'2099-11-04',to:'2099-11-04',start:'16:00',end:'20:00',place:'거래처',note:'공동 외근'}
  const group='30000000-0000-4000-8000-000000000001'
  const register=async(id=group,employees=ids,input=form)=>scalar('select public.register_offsite_group($1,$2,$3)',[id,employees,JSON.stringify(input)])
  await db.exec('set role authenticated')
  await assert.rejects(register(group,[]),/참여 직원/)
  await assert.rejects(register(group,['10000000-0000-4000-8000-000000000099']),/재직 상태/)
  await register(); await register()
  assert.equal(await scalar('select count(*)::int from public.company_leave_requests where offsite_group_id=$1',[group]),1,'RLS exposes only own request')
  assert.equal((await scalar('select public.my_offsite_groups()'))[0].participants.length,3)
  assert.equal((await scalar('select public.list_my_home_work_notifications()')).length,1)
  await assert.rejects(register(group,ids,{...form,note:'different'}),/내용이 다릅니다/)
  await assert.rejects(register('30000000-0000-4000-8000-000000000002',[peer,staff]),/전체 등록을 보류/)
  await db.exec('reset role')
  assert.equal(await scalar('select count(*)::int from public.offsite_groups'),1,'conflict atomically rolls back group')
  assert.equal(await scalar('select count(*)::int from public.company_leave_requests where offsite_group_id=$1',[group]),3)
  const request=await scalar('select id from public.company_leave_requests where offsite_group_id=$1 and employee_id=$2',[group,staff])
  const peerRequest=await scalar('select id from public.company_leave_requests where offsite_group_id=$1 and employee_id=$2',[group,peer])
  await db.exec('set role authenticated')
  await db.query("insert into public.company_leave_requests(company_id,employee_id,employee_name,department_name,kind,from_date,to_date,start_time,end_time,note,place) values($1,$2,'','','offsite','2099-11-04','2099-11-04','20:00','21:00','','거래처')",[company,staff])
  await db.query("select public.set_my_offsite_start($1,'10:00')",[request])
  assert.equal(await scalar("select count(*)::int from public.company_leave_requests where employee_id=$1 and offsite_work_start='10:00'",[staff]),2,'same-day offsites share the start')
  assert.equal((await scalar("select public.get_my_workday_basis('2099-11-04')")).start_time,'10:00:00')
  await assert.rejects(db.query("select public.set_my_offsite_start($1,'10:00')",[peerRequest]),/본인의/)
  await assert.rejects(db.query("update public.company_leave_requests set offsite_work_start='09:00' where id=$1",[request]),/원본|이미 처리/)
  await db.query('select public.set_my_offsite_start($1,null)',[request])
  assert.equal((await scalar("select public.get_my_workday_basis('2099-11-04')")).start_time,'09:00:00')
  await db.query("update public.company_leave_requests set status='cancelled' where id=$1",[request])
  assert.equal((await scalar('select public.my_offsite_groups()'))[0].participants.filter(x=>x.state==='취소').length,1)
  await db.exec(`reset role;select set_config('request.jwt.claim.sub','${peer}',false);set role authenticated`)
  assert.equal((await scalar('select public.my_offsite_groups()'))[0].participants.length,1,'participant sees only self')
  assert.equal((await scalar('select public.list_my_home_work_notifications()')).length,1,'participant receives notice despite creator profile RLS')
  assert.equal(await scalar('select count(*)::int from public.profiles where id=$1',[staff]),0,'creator profile remains private')
  await assert.rejects(db.query('select * from app.offsite_write_context'),/permission denied/)
  await db.exec("reset role;update public.profiles set status='inactive' where id='"+peer+"';set role authenticated")
  await assert.rejects(register('30000000-0000-4000-8000-000000000009'),/재직 중/)
  await db.exec('reset role;set role anon')
  await assert.rejects(register(),/permission denied/)
  await db.exec('reset role')
  assert.equal(await scalar('select count(*)::int from app.offsite_write_context'),0)
  assert.equal(await scalar('select count(*)::int from app.offsite_start_changes'),4)
  assert.equal(await scalar("select md5(jsonb_agg(to_jsonb(t) order by id)::text) from public.attendance_clock_ins t"),before,'original clocks preserved')
  console.info('group offsite: atomic registration, retry, RLS, own cancellation, start changes/audit, notifications and anonymous denial passed')
} finally { await db.close() }
