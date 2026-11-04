import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// Called after the real anniversary / FEFO / birthday / advance migrations and
// their tests. This verifies the new ledger against the actual leave grant and
// consumption functions, rather than replacing either with a test stub.
export async function verifyHolidayLeaveIntegration({db,actor,value,create,ops,company,dept,peer}) {
  const employee=crypto.randomUUID()
  await db.exec(`reset role;select set_config('test.today','2026-11-04',false);select set_config('request.jwt.claim.sub','${ops}',false);
    insert into public.profiles values('${employee}','${company}','${dept}','active','휴일 보상 검증','2020-01-01');
    insert into public.employee_roster(profile_id,company_id,remaining_annual_leave) values('${employee}','${company}',7);
    alter table public.company_leave_requests add column end_next_day boolean default false,add column offsite_continuous boolean default false;
    create table public.attendance_clock_ins(id uuid primary key,company_id uuid,employee_id uuid,work_date date,clock_in time,clock_out_at timestamptz);
    create table public.offsite_settlements(id uuid primary key,request_id uuid,minutes_by_date jsonb);
    create table public.overtime_actual_reports(request_id uuid,start_at timestamptz,end_at timestamptz,break_minutes integer);
    create table public.my_home_notification_reads(reader_id uuid,event_key text,read_at timestamptz,primary key(reader_id,event_key));
    create function public.list_my_home_work_notifications() returns jsonb language sql security invoker set search_path='' as $$select '[]'::jsonb$$;
    create function app.meeting_company_id() returns uuid language sql stable security definer set search_path='' as $$select company_id from public.profiles where id=auth.uid() and status='active'$$;
    create or replace function app.is_department_request_approver(c uuid,d uuid,k text) returns boolean language sql stable as $$select auth.uid()='${peer}'::uuid$$;
  `)
  await db.exec(await readFile('supabase/migrations/20261104081247_holiday_work_settlement.sql','utf8'))
  const call=(action,payload)=>value('select public.holiday_work($1,$2)',[action,payload])
  await actor(employee)
  const {id}=await call('submit',{date:'2026-10-10',location:'office',version:0,note:'실제 근무',intervals:[{start:540,end:660}]})
  await actor(peer);await call('review',{id,version:1,decision:'approve',note:'확인'})
  await actor(ops);await call('policy',{ref:'격리 검증의 실제 함수 연결',date:'2026-10-01',confirmed:true})
  await call('settle',{id:crypto.randomUUID(),ids:[id],versions:{[id]:2},mode:'leave',days:0.25,expires:'2026-11-30',note:'보상 반반차 지급'})
  await db.exec('reset role')
  const grant=await value('select grant_id from app.holiday_work_settlements where employee_id=$1',[employee])
  assert.equal(Number(await value('select days from app.employee_extra_leave where id=$1',[grant])),0.25)
  assert.equal(Number(await value('select remaining_annual_leave from public.employee_roster where profile_id=$1',[employee])),7)
  await actor(employee);const leave=await create('quarter','2026-11-06','2026-11-06',employee)
  await db.exec('reset role')
  assert.equal(Number(await value('select sum(days) from app.employee_extra_leave_usage where grant_id=$1 and refunded_at is null',[grant])),0.25,'real FEFO consumption uses funded compensation leave')
  assert.equal(Number(await value('select remaining_annual_leave from public.employee_roster where profile_id=$1',[employee])),7,'base annual leave unaffected')
  await actor(employee);await db.query("update public.company_leave_requests set status='cancelled' where id=$1",[leave.id])
  await db.exec('reset role')
  assert.equal(Number(await value('select count(*) from app.employee_extra_leave_usage where grant_id=$1 and refunded_at is null',[grant])),0,'normal cancellation restores compensation leave usage')
  assert.equal(Number(await value('select remaining_annual_leave from public.employee_roster where profile_id=$1',[employee])),7)
  console.log('holiday-work real leave integration: grant/lifecycle, FEFO quarter-day consumption and cancellation passed with original base balance preserved')
}
