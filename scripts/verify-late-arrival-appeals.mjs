import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const db = await PGlite.create()
const employee = '10000000-0000-4000-8000-000000000001'
const peer = '10000000-0000-4000-8000-000000000002'
const operations = '10000000-0000-4000-8000-000000000003'
const foreignOperations = '10000000-0000-4000-8000-000000000004'
const company = 'e0000000-0000-4000-8000-000000000001'
const otherCompany = 'e0000000-0000-4000-8000-000000000002'
const day = '2026-11-18'
const rows = async (sql, params = []) => (await db.query(sql, params)).rows
const act = async user => {
  await db.exec('reset role; set role authenticated')
  await rows("select set_config('request.jwt.claim.sub',$1,false)", [user])
}
const list = id => rows('select * from public.list_late_arrival_appeals($1)', [id ?? null])
const submit = async (note, date = day) => (await rows('select public.submit_late_arrival_appeal($1,$2) as id', [date, note]))[0].id
const review = (id, exclude, note, revision = null) => rows('select public.review_late_arrival_appeal($1,$2,$3,$4)', [id, exclude, note, revision])
try {
  await db.exec(`
    create role anon; create role authenticated; create schema auth; create schema app;
    grant usage on schema auth,app to authenticated,anon;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.companies(id uuid primary key);
    create table public.profiles(id uuid primary key,company_id uuid,status text,display_name text,operations boolean default false);
    create table public.attendance_exemptions(profile_id uuid);
    create table app.leave_balance_holidays(day date);
    create table public.clocks(employee_id uuid,clock_in time);
    create table public.my_home_notification_reads(reader_id uuid,event_key text,read_at timestamptz default now(),primary key(reader_id,event_key));
    create function app.permission_company_id() returns uuid language sql stable as $$select company_id from public.profiles where status='active' and id=auth.uid()$$;
    create function app.is_operations_department_member() returns boolean language sql stable as $$select coalesce((select operations from public.profiles where status='active' and id=auth.uid()),false)$$;
    create function app.workforce_mode(uuid) returns text language sql stable as $$select 'head-office'::text$$;
    create function app.attendance_arrival_start_for_date(uuid,date) returns time language sql stable as $$select time '09:00'$$;
    create function public.list_effective_attendance_clocks(date,date,uuid) returns table(clock_in time)
      language sql stable as $$select c.clock_in from public.clocks c where c.employee_id=$3$$;
    insert into public.companies values('${company}'),('${otherCompany}');
    insert into public.profiles values('${employee}','${company}','active','Employee',false),('${peer}','${company}','active','Peer',false),
      ('${operations}','${company}','active','Operations',true),('${foreignOperations}','${otherCompany}','active','Other Company',true);
    insert into public.clocks values('${employee}','09:39'),('${peer}','09:40'),('${operations}','09:42');
  `)
  const migrationDirectory = 'supabase/migrations'
  const [incidentMigration] = (await readdir(migrationDirectory)).filter(name => name.endsWith('_attendance_incident_adjustments.sql'))
  const incidentSource = await readFile(`${migrationDirectory}/${incidentMigration}`, 'utf8')
  await db.exec(incidentSource.split('create function app.list_attendance_incident_adjustments')[0])
  const migration = await readFile('supabase/migrations/20261118114135_late_arrival_appeals.sql', 'utf8')
  await db.exec(migration.replace("(clock_timestamp() at time zone 'Asia/Seoul')::date", "date '2026-11-18'"))

  await act(employee)
  await assert.rejects(submit('  '), /사유를 확인/)
  await assert.rejects(submit('잘못된 날짜', '2026-11-17'), /오늘의 근무일/)
  const id = await submit('외근 업무 후 출근했습니다.')
  assert.equal(await submit('통신 재시도'), id)
  assert.equal((await list(id))[0].event_key, null, '직원은 대기 목록을 볼 수 있지만 본인에게 처리 대기 알림을 만들지 않음')
  await assert.rejects(review(id, true, '본인 처리'), /운영지원만/)
  await assert.rejects(rows('select * from app.late_arrival_appeals'), /permission denied/)
  await act(peer)
  assert.deepEqual(await list(id), [])
  await rows('select public.read_late_arrival_appeal($1,$2)', [id, `late-appeal-review:${id}`])
  await act(foreignOperations)
  assert.deepEqual(await list(id), [])
  await assert.rejects(review(id, true, '다른 회사'), /찾지 못했습니다/)
  await act(operations)
  const ownId = await submit('본인 건')
  await assert.rejects(review(ownId, true, '자체 승인'), /찾지 못했습니다/)
  const [request] = await list(id)
  assert.equal(request.minutes, 39)
  assert.equal(request.reason, '외근 업무 후 출근했습니다.')
  assert.equal(request.event_key, `late-appeal-review:${id}`)
  await rows('select public.read_late_arrival_appeal($1,$2)', [id, `late-appeal-result:${id}`])
  assert.equal((await list(id))[0].read_at, null)
  await rows('select public.read_late_arrival_appeal($1,$2)', [id, request.event_key])
  assert.ok((await list(id))[0].read_at)
  assert.equal((await list(id))[0].status, 'pending', '읽음은 업무 완료를 의미하지 않음')
  await assert.rejects(review(id, true, '오래된 버전', 'stale'), /다른 사용자가/)
  await review(id, true, request.reason)
  await review(id, true, request.reason)
  await assert.rejects(review(id, false, '동시 반려'), /이미 처리/)
  await act(employee)
  const [completed] = await list(id)
  assert.equal(completed.status, 'corrected')
  assert.equal(completed.event_key, `late-appeal-result:${id}`)
  assert.equal(completed.read_at, null)
  await rows('select public.read_late_arrival_appeal($1,$2)', [id, completed.event_key])
  assert.ok((await list(id))[0].read_at)

  await act(peer)
  const kept = await submit('재확인 요청')
  await act(operations)
  await review(kept, false, '기존 근태 판정 유지')
  assert.equal((await list(kept))[0].status, 'kept')
  await db.exec('reset role')
  assert.deepEqual(await rows('select employee_id,minutes,reason from app.attendance_incident_adjustments'), [{ employee_id: employee, minutes: 0, reason: request.reason }])
  assert.deepEqual(await rows('select clock_in from public.clocks where employee_id=$1', [employee]), [{ clock_in: '09:39:00' }])
  console.info('Late appeals DB: duplicates, tenant and role restrictions, read versions, pending/action, correction, concurrency revision and original clock passed')
} finally {
  await db.close()
}
