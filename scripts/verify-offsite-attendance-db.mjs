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
  await db.exec("update app.offsite_attendance_config set activated_at='2026-11-02T00:00:00+09:00'")
  await db.query("insert into public.company_leave_requests(company_id,employee_id,kind,from_date,to_date,start_time,end_time,status,created_at) values($1,$2,'offsite','2026-11-02','2026-11-02','09:00','18:00','approved','2026-11-02T08:00:00+09:00')", [company,staff])
  const advance = time => db.query('select app.advance_offsite_attendance($1,$2,$3)', [staff,'2026-11-02',`2026-11-02T${time}:00+09:00`])
  await advance('08:59')
  assert.equal(Number(await value('select count(*) from public.attendance_clock_ins')), 0)
  await advance('09:00'); await advance('09:00')
  assert.equal(await value('select clock_in_source from public.attendance_clock_ins'), 'offsite')
  assert.equal(Number(await value('select count(*) from public.attendance_clock_ins')), 1)
  await advance('18:00'); await advance('18:00')
  assert.equal(await value('select clock_out_source from public.attendance_clock_ins'), 'offsite')
  assert.equal(Number(await value("select count(*) from app.offsite_attendance_events where action='auto_out'")), 1)
  await db.query("insert into public.company_leave_requests(company_id,employee_id,kind,from_date,to_date,start_time,end_time,status,created_at) values($1,$2,'overtime','2026-11-02','2026-11-02','18:00','21:00','approved','2026-11-03T09:00:00+09:00')", [company,staff])
  await db.exec(`select set_config('request.jwt.claim.sub','${staff}',false); set role authenticated`)
  const row=(await db.query("select * from public.list_effective_attendance_clocks('2026-11-02','2026-11-02',$1)",[staff])).rows[0]
  assert.equal(new Date(row.clock_out_at).toISOString(),'2026-11-02T12:00:00.000Z')
  assert.equal(row.clock_out_source,'overtime')
  assert.equal(Number(await value("select count(*) from public.list_effective_attendance_clocks('2026-11-02','2026-11-02',$1)",[peer])),0)
  await assert.rejects(()=>db.query('select * from app.offsite_attendance_events'),/permission denied/)
  await db.exec('reset role')
  await db.query("insert into public.company_leave_requests(company_id,employee_id,kind,from_date,to_date,start_time,end_time,status,created_at) values($1,$2,'correction','2026-11-02','2026-11-02','09:00','20:00','approved','2026-11-03T10:00:00+09:00')", [company,staff])
  await db.exec('set role authenticated')
  const corrected=(await db.query("select * from public.list_effective_attendance_clocks('2026-11-02','2026-11-02',$1)",[staff])).rows[0]
  assert.equal(new Date(corrected.clock_out_at).toISOString(),'2026-11-02T11:00:00.000Z', '승인 정정이 야근 보정보다 우선')
  const approvedId=await value("select id from public.company_leave_requests where kind='overtime'")
  const preview=await value('select public.get_overtime_checkout_preview($1)',[approvedId])
  assert.equal(new Date(preview.before).toISOString(),'2026-11-02T11:00:00.000Z')
  assert.equal(new Date(preview.after).toISOString(),'2026-11-02T11:00:00.000Z','승인된 정정이 미리보기에서도 우선')
  await db.exec('reset role')
  assert.equal(new Date(await value('select clock_out_at from public.attendance_clock_ins')).toISOString(),'2026-11-02T09:00:00.000Z','원래 자동 퇴근은 보존')
  await db.query("insert into public.attendance_clock_ins(company_id,employee_id,work_date,clock_in) values($1,$2,'2026-11-03','08:55')",[company,staff])
  await db.query("insert into public.company_leave_requests(company_id,employee_id,kind,from_date,to_date,start_time,end_time,status,created_at) values($1,$2,'offsite','2026-11-03','2026-11-03','15:00','18:00','approved','2026-11-03T08:00:00+09:00')",[company,staff])
  await db.query("select app.advance_offsite_attendance($1,'2026-11-03','2026-11-03T18:00:00+09:00')",[staff])
  assert.equal((await value("select clock_in::text from public.attendance_clock_ins where work_date='2026-11-03'")), '08:55:00','기존 출근 보존')
  await db.query("insert into public.company_leave_requests(company_id,employee_id,kind,from_date,to_date,start_time,end_time,status,created_at) values($1,$2,'offsite','2026-11-06','2026-11-09','09:00','18:00','approved','2026-11-05T08:00:00+09:00')",[company,staff])
  for (const date of ['2026-11-06','2026-11-07','2026-11-08','2026-11-09']) await db.query('select app.advance_offsite_attendance($1,$2,$3)',[staff,date,`${date}T18:00:00+09:00`])
  assert.equal(Number(await value("select count(*) from public.attendance_clock_ins where work_date between '2026-11-06' and '2026-11-09'")),2,'기간 외근은 주말 제외')
  await db.query("insert into public.company_leave_requests(company_id,employee_id,kind,from_date,to_date,start_time,end_time,status,created_at) values($1,$2,'offsite','2026-11-07','2026-11-07','09:00','18:00','approved','2026-11-06T08:00:00+09:00')",[company,staff])
  await db.query("select app.advance_offsite_attendance($1,'2026-11-07','2026-11-07T18:00:00+09:00')",[staff])
  assert.equal(Number(await value("select count(*) from public.attendance_clock_ins where work_date='2026-11-07'")),1,'휴일 하루 지정은 자동 처리')
  await db.query("insert into public.company_leave_requests(company_id,employee_id,kind,from_date,to_date,start_time,end_time,status,created_at) values($1,$2,'correction','2026-11-10','2026-11-10','09:00','20:00','approved','2026-11-11T09:00:00+09:00')",[company,staff])
  await db.exec('set role authenticated')
  const correctedOnly=(await db.query("select * from public.list_effective_attendance_clocks('2026-11-10','2026-11-10',$1)",[staff])).rows[0]
  assert.equal(correctedOnly.clock_out_source,'correction','원본이 없는 승인 정정도 집계')
  await db.exec('reset role')
  await db.query("insert into public.attendance_clock_ins(company_id,employee_id,work_date,clock_in,clock_out_at) values($1,$2,(clock_timestamp() at time zone 'Asia/Seoul')::date,'09:00',date_trunc('minute',clock_timestamp()))",[company,peer])
  await db.query("insert into public.company_leave_requests(company_id,employee_id,kind,from_date,to_date,start_time,end_time,status,created_at) values($1,$2,'offsite',(clock_timestamp() at time zone 'Asia/Seoul')::date,(clock_timestamp() at time zone 'Asia/Seoul')::date,'09:00','23:59','approved',clock_timestamp())",[company,peer])
  await db.exec(`select set_config('request.jwt.claim.sub','${peer}',false); set role authenticated`)
  assert.equal((await value('select public.my_offsite_attendance()')).state,'inactive','직접 퇴근 후에는 외근 복귀를 표시하지 않음')
  await assert.rejects(()=>db.query('select public.return_from_offsite()'),/직접 기록한 퇴근/)
  await db.exec('reset role')
  await db.query('delete from app.offsite_attendance_days where employee_id=$1',[peer])
  await db.query('delete from public.attendance_clock_ins where employee_id=$1',[peer])
  await db.query('delete from public.company_leave_requests where employee_id=$1',[peer])
  await db.query("insert into public.company_leave_requests(company_id,employee_id,kind,from_date,to_date,start_time,end_time,status,created_at) values($1,$2,'offsite',(clock_timestamp() at time zone 'Asia/Seoul')::date,(clock_timestamp() at time zone 'Asia/Seoul')::date,'23:58','23:59','approved',clock_timestamp())",[company,peer])
  await db.exec('set role authenticated')
  assert.equal((await value('select public.my_offsite_attendance()')).state,'scheduled')
  await assert.rejects(()=>db.query('select public.return_from_offsite()'),/복귀할 외근이 없습니다/,'외근 시작 전 복귀 차단')
  await db.exec('reset role')
  await db.query('delete from app.offsite_attendance_days where employee_id=$1',[peer])
  await db.query('delete from public.company_leave_requests where employee_id=$1',[peer])
  await db.query("insert into public.company_leave_requests(company_id,employee_id,kind,from_date,to_date,start_time,end_time,status,created_at) values($1,$2,'offsite',(clock_timestamp() at time zone 'Asia/Seoul')::date,(clock_timestamp() at time zone 'Asia/Seoul')::date,'00:00','23:59','approved',clock_timestamp()-interval '1 day')",[company,peer])
  await db.exec('set role authenticated')
  assert.equal((await value('select public.my_offsite_attendance()')).state,'offsite')
  assert.equal((await value('select public.return_from_offsite()')).state,'returned','자동 퇴근 전 복귀')
  await db.exec('reset role')
  await db.query("select app.advance_offsite_attendance($1,(clock_timestamp() at time zone 'Asia/Seoul')::date,((clock_timestamp() at time zone 'Asia/Seoul')::date+time '23:59') at time zone 'Asia/Seoul')",[peer])
  assert.equal(await value('select clock_out_at from public.attendance_clock_ins where employee_id=$1',[peer]),null,'복귀 후 자동 퇴근 재발 방지')
  const afterOut='10000000-0000-4000-8000-000000000005'
  await db.query("insert into public.profiles values($1,$2,null,'active','test')",[afterOut,company])
  await db.query("insert into public.company_leave_requests(company_id,employee_id,kind,from_date,to_date,start_time,end_time,status,created_at) values($1,$2,'offsite',(clock_timestamp() at time zone 'Asia/Seoul')::date,(clock_timestamp() at time zone 'Asia/Seoul')::date,'00:00','23:59','approved',clock_timestamp()-interval '1 day')",[company,afterOut])
  await db.query("select app.advance_offsite_attendance($1,(clock_timestamp() at time zone 'Asia/Seoul')::date,((clock_timestamp() at time zone 'Asia/Seoul')::date+time '23:59') at time zone 'Asia/Seoul')",[afterOut])
  await db.query("insert into public.company_leave_requests(company_id,employee_id,kind,from_date,to_date,start_time,end_time,status,created_at,decided_at) values($1,$2,'correction',(clock_timestamp() at time zone 'Asia/Seoul')::date,(clock_timestamp() at time zone 'Asia/Seoul')::date,'00:00','01:00','approved',clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour')",[company,afterOut])
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[afterOut])
  await db.exec('set role authenticated')
  assert.equal((await value('select public.my_offsite_attendance()')).state,'clocked_out')
  assert.equal((await value('select public.return_from_offsite()')).state,'returned','자동 퇴근 후 복귀')
  const resumed=(await db.query("select * from public.list_effective_attendance_clocks((clock_timestamp() at time zone 'Asia/Seoul')::date,(clock_timestamp() at time zone 'Asia/Seoul')::date,$1)",[afterOut])).rows[0]
  assert.equal(resumed.clock_out_at,null,'복귀 이전 정정 퇴근은 재개된 근무를 닫지 않음')
  await db.exec('reset role')
  assert.equal(await value('select clock_out_at from public.attendance_clock_ins where employee_id=$1',[afterOut]),null)
  assert.equal(Number(await value("select count(*) from app.offsite_attendance_events where employee_id=$1 and action in ('auto_out','return')",[afterOut])),2,'자동퇴근과 복귀 이력 보존')
  const undoEmployee='10000000-0000-4000-8000-000000000013'
  await db.query("insert into public.profiles values($1,$2,null,'active','test')",[undoEmployee,company])
  await db.query("insert into public.company_leave_requests(company_id,employee_id,kind,from_date,to_date,start_time,end_time,status,created_at) values($1,$2,'offsite',(clock_timestamp() at time zone 'Asia/Seoul')::date,(clock_timestamp() at time zone 'Asia/Seoul')::date,'00:00','23:59','approved',clock_timestamp()-interval '1 day')",[company,undoEmployee])
  await db.query("select app.advance_offsite_attendance($1,(clock_timestamp() at time zone 'Asia/Seoul')::date,((clock_timestamp() at time zone 'Asia/Seoul')::date+time '23:59') at time zone 'Asia/Seoul')",[undoEmployee])
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[undoEmployee])
  await db.exec('set role authenticated')
  await value('select public.undo_clock_out_today()')
  assert.equal((await value('select public.my_offsite_attendance()')).state,'returned','기존 public 퇴근 무르기로 외근 복귀')
  await db.exec('reset role')
  assert.equal(await value('select clock_out_at from public.attendance_clock_ins where employee_id=$1',[undoEmployee]),null,'기존 무르기가 자동 퇴근 기록을 해제')
  await db.query("select app.advance_offsite_attendance($1,(clock_timestamp() at time zone 'Asia/Seoul')::date,((clock_timestamp() at time zone 'Asia/Seoul')::date+time '23:59') at time zone 'Asia/Seoul')",[undoEmployee])
  assert.equal(await value('select clock_out_at from public.attendance_clock_ins where employee_id=$1',[undoEmployee]),null,'기존 무르기 후 자동 퇴근 재발 방지')
  const twoTrips='10000000-0000-4000-8000-000000000006'
  await db.query("insert into public.profiles values($1,$2,null,'active','test')",[twoTrips,company])
  await db.query("insert into public.company_leave_requests(company_id,employee_id,kind,from_date,to_date,start_time,end_time,status,created_at) values($1,$2,'offsite','2026-11-04','2026-11-04','09:00','12:00','approved','2026-11-03T08:00:00+09:00'),($1,$2,'offsite','2026-11-04','2026-11-04','15:00','18:00','approved','2026-11-03T08:00:00+09:00')",[company,twoTrips])
  await db.query("select app.advance_offsite_attendance($1,'2026-11-04','2026-11-04T10:00:00+09:00')",[twoTrips])
  await db.query("update app.offsite_attendance_days set returned_at='2026-11-04T13:00:00+09:00' where employee_id=$1",[twoTrips])
  await db.query("select app.advance_offsite_attendance($1,'2026-11-04','2026-11-04T14:00:00+09:00')",[twoTrips])
  assert.ok(await value('select returned_at from app.offsite_attendance_days where employee_id=$1',[twoTrips]),'후속 외근 시작 전 복귀 유지')
  await db.query("select app.advance_offsite_attendance($1,'2026-11-04','2026-11-04T15:00:00+09:00')",[twoTrips])
  assert.equal(await value('select returned_at from app.offsite_attendance_days where employee_id=$1',[twoTrips]),null,'후속 외근 시작 시 재활성화')
  await db.query("select app.advance_offsite_attendance($1,'2026-11-04','2026-11-04T18:00:00+09:00')",[twoTrips])
  assert.equal(new Date(await value('select clock_out_at from public.attendance_clock_ins where employee_id=$1',[twoTrips])).toISOString(),'2026-11-04T09:00:00.000Z','후속 외근 18시 자동 퇴근')
  const delayed='10000000-0000-4000-8000-000000000007'
  await db.query("insert into public.profiles values($1,$2,null,'active','test')",[delayed,company])
  await db.exec("update app.offsite_attendance_config set activated_at='2026-10-01T00:00:00+09:00'")
  await db.query("insert into public.company_leave_requests(company_id,employee_id,kind,from_date,to_date,start_time,end_time,status,created_at) values($1,$2,'offsite','2026-10-30','2026-10-30','09:00','18:00','approved','2026-10-29T08:00:00+09:00')",[company,delayed])
  await db.exec('select app.process_attendance_presence(); select app.process_attendance_presence()')
  assert.equal(new Date(await value('select clock_out_at from public.attendance_clock_ins where employee_id=$1',[delayed])).toISOString(),'2026-10-30T09:00:00.000Z','2일 넘는 지연도 예정 시각으로 복구')
  assert.equal(Number(await value("select count(*) from app.offsite_attendance_events where employee_id=$1 and action='auto_out'",[delayed])),1,'지연 복구 재실행은 중복 방지')
  const overlapClock='10000000-0000-4000-8000-000000000010'
  await db.query("insert into public.profiles values($1,$2,null,'active','test')",[overlapClock,company])
  await db.query("insert into public.company_leave_requests(company_id,employee_id,kind,from_date,to_date,start_time,end_time,end_next_day,status,created_at) values($1,$2,'correction',(clock_timestamp() at time zone 'Asia/Seoul')::date-1,(clock_timestamp() at time zone 'Asia/Seoul')::date-1,'23:59','23:58',true,'approved',clock_timestamp()-interval '2 days')",[company,overlapClock])
  await db.query("insert into public.company_leave_requests(company_id,employee_id,kind,from_date,to_date,start_time,end_time,status,created_at) values($1,$2,'offsite',(clock_timestamp() at time zone 'Asia/Seoul')::date,(clock_timestamp() at time zone 'Asia/Seoul')::date,'00:00','23:59','approved',clock_timestamp()-interval '1 day')",[company,overlapClock])
  await db.query("select app.advance_offsite_attendance($1,(clock_timestamp() at time zone 'Asia/Seoul')::date,clock_timestamp())",[overlapClock])
  assert.equal(Number(await value('select count(*) from public.attendance_clock_ins where employee_id=$1',[overlapClock])),0,'직전 유효 퇴근과 겹치는 자동 출근 차단')
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[overlapClock])
  await db.exec('set role authenticated')
  await assert.rejects(()=>db.query('select app.clock_in_today()'),/직전 퇴근시각보다 이르게/,'직전 유효 퇴근과 겹치는 직접 출근 차단')
  await db.exec('reset role')
  const manager='10000000-0000-4000-8000-000000000011', outsider='10000000-0000-4000-8000-000000000012'
  const dept='20000000-0000-4000-8000-000000000001', otherDept='20000000-0000-4000-8000-000000000002'
  await db.query("insert into public.profiles values($1,$3,$4,'active','manager'),($2,$3,$4,'active','outsider')",[manager,outsider,company,dept])
  const allowedPreview=await value("insert into public.company_leave_requests(company_id,employee_id,department_id,kind,from_date,to_date,start_time,end_time,status,created_at) values($1,$2,$3,'overtime','2026-11-02','2026-11-02','18:00','21:00','pending','2026-11-03T09:00:00+09:00') returning id",[company,staff,dept])
  const deniedPreview=await value("insert into public.company_leave_requests(company_id,employee_id,department_id,kind,from_date,to_date,start_time,end_time,status,created_at) values($1,$2,$3,'overtime','2026-11-02','2026-11-02','18:00','21:00','pending','2026-11-03T09:00:00+09:00') returning id",[company,staff,otherDept])
  const deniedType=await value("insert into public.company_leave_requests(company_id,employee_id,department_id,kind,from_date,to_date,start_time,end_time,status,created_at) values($1,$2,$3,'correction','2026-11-02','2026-11-02','09:00','20:00','pending','2026-11-03T09:00:00+09:00') returning id",[company,staff,dept])
  await db.exec(`create or replace function app.is_department_request_approver(uuid,uuid,text) returns boolean language sql as $$select auth.uid()='${manager}'::uuid and $2='${dept}'::uuid and $3='overtime'$$`)
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[manager])
  await db.exec('set role authenticated')
  assert.ok(await value('select public.get_overtime_checkout_preview($1)',[allowedPreview]),'지정 부서·야근 승인자 허용')
  await assert.rejects(()=>db.query('select public.get_overtime_checkout_preview($1)',[deniedPreview]),/권한/,'다른 부서 승인자 차단')
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[outsider])
  await assert.rejects(()=>db.query('select public.get_overtime_checkout_preview($1)',[allowedPreview]),/권한/,'미지정 직원 차단')
  assert.equal(await value("select app.is_department_request_approver($1,$2,'correction')",[company,dept]),false,'다른 신청 유형 차단')
  await db.exec('reset role; create trigger request_guard before insert or update on public.company_leave_requests for each row execute function app.guard_company_leave_request()')
  await assert.rejects(()=>db.query("update public.company_leave_requests set status='approved' where id=$1",[allowedPreview]),/지정 승인자/,'미지정 직원의 승인 차단')
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[manager])
  await assert.rejects(()=>db.query("update public.company_leave_requests set status='approved' where id=$1",[deniedPreview]),/지정 승인자/,'타 부서 승인 차단')
  await assert.rejects(()=>db.query("update public.company_leave_requests set status='approved' where id=$1",[deniedType]),/지정 승인자/,'타 유형 승인 차단')
  await db.query("update public.company_leave_requests set status='approved' where id=$1",[allowedPreview])
  assert.equal(await value('select status from public.company_leave_requests where id=$1',[allowedPreview]),'approved','지정 야근 승인 허용')
  await db.query('delete from public.company_leave_requests where id=$1',[deniedType])
  await db.exec('reset role; create or replace function app.is_department_request_approver(uuid,uuid,text) returns boolean language sql as $$select true$$')
  await db.exec(`reset role; select set_config('request.jwt.claim.sub','${staff}',false)`)
  await db.exec('select app.process_attendance_presence()')
  const night=await db.query("insert into public.company_leave_requests(employee_id,kind,from_date,to_date,start_time,end_time,end_next_day,note,place) values($1,'overtime','2026-11-04','2026-11-04','22:00','00:30',true,'업무','') returning end_next_day,status",[staff])
  assert.equal(night.rows[0].end_next_day,true)
  assert.equal(night.rows[0].status,'pending')
  await assert.rejects(()=>db.query("insert into public.company_leave_requests(employee_id,kind,from_date,to_date,start_time,end_time,end_next_day,note,place) values($1,'overtime','2026-11-05','2026-11-05','10:00','11:00',true,'업무','')",[staff]),/check constraint/)
  const overlap=await value("insert into public.company_leave_requests(employee_id,kind,from_date,to_date,start_time,end_time,end_next_day,note,place) values($1,'correction',((clock_timestamp() at time zone 'Asia/Seoul')::date-1),((clock_timestamp() at time zone 'Asia/Seoul')::date-1),'22:00','10:00',true,'정정','') returning id",[staff])
  await assert.rejects(()=>db.query("update public.company_leave_requests set status='approved' where id=$1",[overlap]),/다음 출근 기록과 겹칩니다/)
  const future=await value("insert into public.company_leave_requests(employee_id,kind,from_date,to_date,start_time,end_time,end_next_day,note,place) values($1,'correction',(clock_timestamp() at time zone 'Asia/Seoul')::date,(clock_timestamp() at time zone 'Asia/Seoul')::date,'23:55','23:50',true,'정정','') returning id",[staff])
  await assert.rejects(()=>db.query("update public.company_leave_requests set status='approved' where id=$1",[future]),/현재 시각보다 늦을 수 없습니다/)
  for (const [employee,reverse] of [['10000000-0000-4000-8000-000000000003',false],['10000000-0000-4000-8000-000000000004',true]]) {
    await db.query("insert into public.profiles values($1,$2,null,'active','test')",[employee,company])
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[employee])
    const makeCorrection = async (days,start,end,next) => value("insert into public.company_leave_requests(employee_id,kind,from_date,to_date,start_time,end_time,end_next_day,note,place) values($1,'correction',(clock_timestamp() at time zone 'Asia/Seoul')::date-$2::integer,(clock_timestamp() at time zone 'Asia/Seoul')::date-$2::integer,$3,$4,$5,'정정','') returning id",[employee,days,start,end,next])
    if (!reverse) {
      const previous=await makeCorrection(2,'22:00','06:00',true)
      await db.query("update public.company_leave_requests set status='approved' where id=$1",[previous])
      const current=await makeCorrection(1,'05:00','07:00',false)
      await assert.rejects(()=>db.query("update public.company_leave_requests set status='approved' where id=$1",[current]),/직전 퇴근 기록과 겹칩니다/)
    } else {
      const current=await makeCorrection(1,'05:00','07:00',false)
      await db.query("update public.company_leave_requests set status='approved' where id=$1",[current])
      const previous=await makeCorrection(2,'22:00','06:00',true)
      await assert.rejects(()=>db.query("update public.company_leave_requests set status='approved' where id=$1",[previous]),/다음 출근 기록과 겹칩니다/)
    }
  }
  console.log('offsite-attendance-db: scheduled clocks, idempotence, correction precedence, isolation, weekend handling and overnight requests passed')
} catch (error) { console.error('offsite-attendance-db:',error); process.exitCode=1 }
finally { await db.close() }
