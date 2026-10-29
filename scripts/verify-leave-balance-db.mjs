import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import * as holidays from '@hyunbinseo/holidays-kr/all'

const db = await PGlite.create()
const company='e0000000-0000-4000-8000-000000000001', other='e0000000-0000-4000-8000-000000000002'
const staff='10000000-0000-4000-8000-000000000001', peer='10000000-0000-4000-8000-000000000002'
const foreign='10000000-0000-4000-8000-000000000003', ops='10000000-0000-4000-8000-000000000004'
const dept='20000000-0000-4000-8000-000000000001'
const value = async (sql,args) => Object.values((await db.query(sql,args)).rows[0])[0]
const actor = id => db.exec(`reset role;select set_config('request.jwt.claim.sub','${id}',false);set role authenticated`)
const balance = async () => { await db.exec('reset role'); return Number(await value('select remaining_annual_leave from employee_roster where profile_id=$1',[staff])) }
async function create(kind,date,endDate=date,employee=staff) {
  return (await db.query(`insert into public.company_leave_requests(employee_id,company_id,kind,from_date,to_date,start_time,end_time,note,place)
    values($1,$2,$3,$4,$5,'09:00',$6,'검증','방문 장소') returning *`,[employee,company,kind,date,endDate,kind==='half'?'14:00':kind==='quarter'?'11:00':'18:00'])).rows[0]
}
async function reject(fn,pattern) { await assert.rejects(fn,pattern) }
async function deniedWrite(sql,args) {
  let result
  try { result=await db.query(sql,args) } catch(error) {
    assert.match(error.message,/이미 처리|permission denied|본인|재직/)
    return
  }
  assert.equal(result.rows.length,0,'권한 없는 변경 또는 중복 처리는 허용하지 않음')
}
async function definition(path,name,delimiter='function') {
  const source=await readFile(path,'utf8')
  const match=source.match(new RegExp(`CREATE OR REPLACE FUNCTION app\\.${name}\\(\\)[\\s\\S]*?\\$${delimiter}\\$\\s*;`,'i'))
  assert.ok(match,`Missing production function ${name}`)
  return match[0]
}
try {
  await db.exec(`create role anon;create role authenticated;create schema app;create schema auth;
    grant usage on schema public,app,auth to authenticated,anon;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table companies(id uuid primary key);
    create table profiles(id uuid primary key,company_id uuid,department_id uuid,status text,display_name text,hire_date date);
    create table departments(id uuid primary key,name text);
    create table employee_roster(profile_id uuid primary key references profiles(id),company_id uuid,remaining_annual_leave numeric(7,2),updated_at timestamptz default now(),note text default '기존 명부');
    create table company_leave_requests(id uuid primary key default gen_random_uuid(),company_id uuid,employee_id uuid,employee_name text,department_id uuid,department_name text,kind text,from_date date,to_date date,start_time time,end_time time,note text,place text,status text default 'pending',created_at timestamptz default now(),decision_note text,decided_at timestamptz,decided_by uuid,decided_by_name text);
    create table company_leave_files(id uuid,request_id uuid,ready boolean);
    create table app.leave_notice_balance_cycles(employee_id uuid primary key,company_id uuid,hire_date date,expires_on date,recorded_at timestamptz default now());
    create function app.leave_notice_cycle(h date,d date) returns date language sql stable as $$select date '2099-01-01'$$;
    create function app.can_edit_org_assignment() returns boolean language sql stable as $$select auth.uid()='${ops}'::uuid$$;
    create function app.basic_work_allowed(domain text) returns boolean language sql stable as $$select false$$;
    create function app.is_department_request_approver(c uuid,d uuid,k text) returns boolean language sql stable as $$select false$$;
    insert into companies values('${company}'),('${other}');
    insert into departments values('${dept}','테스트 부서');
    insert into profiles values('${staff}','${company}','${dept}','active','직원','2020-01-01'),('${peer}','${company}','${dept}','active','동료','2020-01-01'),('${foreign}','${other}','${dept}','active','타사','2020-01-01'),('${ops}','${company}','${dept}','active','운영지원','2020-01-01');
    insert into employee_roster(profile_id,company_id,remaining_annual_leave) values('${staff}','${company}',7),('${peer}','${company}',null);
    insert into app.leave_notice_balance_cycles(employee_id,company_id,hire_date,expires_on) values('${staff}','${company}','2020-01-01','2001-12-31');
    insert into company_leave_requests(id,company_id,employee_id,kind,from_date,to_date,start_time,end_time,note,status) values('30000000-0000-4000-8000-000000000001','${company}','${staff}','annual','2026-10-01','2026-10-01','09:00','18:00','','approved');
    alter table company_leave_requests enable row level security;
    create policy leave_read on company_leave_requests for select to authenticated using(employee_id=auth.uid() and company_id=(select company_id from profiles where id=auth.uid() and status='active'));
    create policy leave_create on company_leave_requests for insert to authenticated with check(employee_id=auth.uid() and company_id=(select company_id from profiles where id=auth.uid() and status='active') and (status='pending' or(status='approved' and kind in ('annual','half','quarter'))));
    create policy leave_transition on company_leave_requests for update to authenticated using(employee_id=auth.uid()) with check(employee_id=auth.uid());
    alter table employee_roster enable row level security;
    create policy roster_ops on employee_roster for all to authenticated using(app.can_edit_org_assignment()) with check(app.can_edit_org_assignment());
    grant select on profiles,departments,company_leave_files to authenticated;
    grant select,insert,update on company_leave_requests,employee_roster to authenticated;`)
  await db.exec(await definition('supabase/migrations/20261027044909_department_work_access.sql','guard_employee_roster'))
  await db.exec('create trigger employee_roster_guard before insert or update on employee_roster for each row execute function app.guard_employee_roster()')
  await db.exec(await readFile('supabase/migrations/20261028071856_attendance_self_approval.sql','utf8'))
  await db.exec(await readFile('supabase/migrations/20261028072226_attendance_offsite_insert_policy.sql','utf8'))
  await db.exec('create trigger company_leave_request_guard before insert or update on company_leave_requests for each row execute function app.guard_company_leave_request()')
  const before=await value("select md5(jsonb_build_object('roster',(select jsonb_agg(r order by profile_id) from employee_roster r),'requests',(select jsonb_agg(r order by id) from company_leave_requests r))::text)")
  const policyBefore=await value("select md5(jsonb_agg(p order by policyname)::text) from pg_policies p where schemaname='public' and policyname<>'leave_create'")
  await db.exec(await readFile('supabase/migrations/20261029082849_leave_balance_auto_deduction.sql','utf8'))
  await db.exec('create trigger capture_leave_notice_balance_cycle after insert or update of remaining_annual_leave on employee_roster for each row execute function app.capture_leave_notice_balance_cycle()')
  assert.equal(await value("select md5(jsonb_build_object('roster',(select jsonb_agg(r order by profile_id) from employee_roster r),'requests',(select jsonb_agg(r order by id) from company_leave_requests r))::text)"),before,'적용 시 기존 데이터 유지')
  assert.equal(await value("select md5(jsonb_agg(p order by policyname)::text) from pg_policies p where schemaname='public' and policyname<>'leave_create'"),policyBefore)
  assert.equal(Number(await value('select count(*) from app.leave_balance_entries')),0)
  if (process.argv.includes('--anniversary')) {
    await db.exec(await readFile('supabase/migrations/20261029093102_employee_leave_import.sql','utf8'))
    await db.exec("select set_config('test.today','2026-10-29',false)")
    const accrual = await readFile('supabase/migrations/20261029093112_employee_leave_anniversary_accrual.sql','utf8')
    await db.exec(accrual.replaceAll("(now() at time zone 'Asia/Seoul')::date", "current_setting('test.today')::date"))
  }
  for(let year=2018;year<=2027;year++) for(const date of Object.keys(holidays[`y${year}`])) {
    assert.equal(Number(await value('select count(*) from app.leave_balance_holidays where day=$1',[date])),1)
  }
  await actor(staff)
  const annual=await create('annual','2026-11-02');assert.equal(annual.status,'approved');assert.equal(await balance(),6)
  await actor(staff);const half=await create('half','2026-11-03');assert.equal(await balance(),5.5)
  await actor(staff);await create('quarter','2026-11-04');assert.equal(await balance(),5.25)
  await actor(staff);await create('annual','2026-12-24','2026-12-28');assert.equal(await balance(),3.25,'주말·성탄절 제외')
  assert.equal(await value('select expires_on::text from app.leave_notice_balance_cycles where employee_id=$1',[staff]),'2001-12-31','자동 차감이 잔여 확인 연도를 갱신하지 않음')
  assert.equal(await value('select note from employee_roster where profile_id=$1',[staff]),'기존 명부')
  await actor(staff);await create('offsite','2026-11-05');await create('overtime','2026-11-06');assert.equal(await balance(),3.25,'외근·야근은 차감하지 않음')
  await actor(staff);await db.query("update company_leave_requests set status='cancelled' where id=$1",[annual.id]);assert.equal(await balance(),4.25)
  await actor(staff);await deniedWrite("update company_leave_requests set status='cancelled' where id=$1 returning id",[annual.id]);assert.equal(await balance(),4.25,'중복 복원 거부')
  await actor(staff);await db.query("update company_leave_requests set status='cancelled' where id='30000000-0000-4000-8000-000000000001'");assert.equal(await balance(),4.25,'기존 신청 취소는 잔여를 추가하지 않음')
  await actor(staff)
  for(const day of ['2026-11-07','2026-05-05']) await reject(()=>create('annual',day),/주말·공휴일/)
  await reject(()=>create('half','2026-05-05'),/주말·공휴일/)
  await reject(()=>create('annual','2028-01-03'),/공휴일 기준/)
  await reject(()=>create('annual','2026-11-09','2026-11-13'),/부족/)
  await reject(()=>create('annual','2026-11-16','2026-11-16',peer),/본인 신청/)
  await reject(()=>db.query('select * from app.leave_balance_entries'),/permission denied/)
  await reject(()=>db.query("select app.leave_balance_days('annual','2026-11-02','2026-11-02')"),/permission denied/)
  await reject(()=>db.query('select app.sync_leave_request_balance()'),/permission denied/)
  assert.equal((await db.query('update employee_roster set remaining_annual_leave=999 where profile_id=$1 returning *',[staff])).rows.length,0,'직접 잔여 위조 불가')
  assert.notEqual(await value("select current_setting('app.roster_import',true)"),'on','내부 권한 스위치 복원')
  assert.notEqual(await value("select current_setting('app.leave_balance_sync',true)"),'on')
  await actor(peer);await reject(()=>create('annual','2026-11-16','2026-11-16',peer),/등록되지 않았/)
  await actor(foreign);await deniedWrite("update company_leave_requests set status='cancelled' where id=$1 returning *",[half.id])
  await db.exec('reset role');assert.equal(Number(await value('select count(*) from app.leave_balance_entries')),4,'실패 요청은 차감 원장에 남지 않음')
  await actor(ops);await db.query('update employee_roster set remaining_annual_leave=0.25 where profile_id=$1',[staff])
  await db.exec('reset role')
  assert.equal(await value('select expires_on::text from app.leave_notice_balance_cycles where employee_id=$1',[staff]),'2098-12-31','운영지원의 명시 저장은 기존 확인 연도 기능 유지')
  await actor(staff);await reject(()=>create('annual','2026-11-17'),/부족/)
  await create('quarter','2026-11-17');assert.equal(await balance(),0)
  await actor(staff);await reject(()=>create('quarter','2026-11-18'),/부족/)
  await db.exec('reset role');await db.query("update profiles set status='inactive' where id=$1",[staff]);await actor(staff)
  await reject(()=>create('annual','2026-11-19'),/재직/)
  if (process.argv.includes('--anniversary')) {
    const { verifyAnniversaryLeave } = await import('./verify-leave-anniversary-cases.mjs')
    await verifyAnniversaryLeave({db,actor,value,create,peer,ops,company})
  }
  if (process.argv.includes('--additional')) {
    const { verifyExtraLeave } = await import('./verify-extra-leave-cases.mjs')
    await verifyExtraLeave({db,actor,value,create,staff,peer,ops,foreign,company})
  }
  if (process.argv.includes('--fefo')) {
    const { verifyFefoLeave } = await import('./verify-leave-fefo-cases.mjs')
    await verifyFefoLeave({db,actor,value,create,ops,company,foreign})
  }
  if (process.argv.includes('--birthday')) {
    assert.ok(['--anniversary','--additional','--fefo'].every(flag=>process.argv.includes(flag)), '생일 검증에는 기존 연차 검증을 함께 실행합니다.')
    const { verifyBirthdayLeave } = await import('./verify-birthday-leave-cases.mjs')
    await verifyBirthdayLeave({db,actor,value,create,ops,company,foreign})
  }
  console.log('leave-balance-db: 기존 값·정책 보존, 1/0.5/0.25일 차감, 주말·공휴일 제외, 취소 1회 복원, 기존 취소 무가산, 미등록·부족·타인·타사·직접 위조 차단, 외근·야근 무차감, 사용연도 확인 보존 통과')
} catch(error) {
  console.error('leave-balance-db 실패:',error.message,{code:error.code,query:error.query})
  process.exitCode=1
} finally { await db.close() }
