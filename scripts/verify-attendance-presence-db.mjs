import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const db=await PGlite.create()
const company='e0000000-0000-4000-8000-000000000001', department='20000000-0000-4000-8000-000000000001'
const staff='10000000-0000-4000-8000-000000000001', peer='10000000-0000-4000-8000-000000000002'
const value=async(sql,args)=>Object.values((await db.query(sql,args)).rows[0])[0]
const admin=()=>db.exec('reset role')
const actor=async id=>db.exec(`reset role;select set_config('request.jwt.claim.sub','${id??''}',false);set role authenticated`)
const at=async(clock,time)=>new Date(await value("select (work_date+$2::time) at time zone 'Asia/Seoul' from attendance_clock_ins where id=$1",[clock,time]))
const advance=(clock,time)=>db.query('select app.advance_attendance_presence($1,$2)',[clock,time.toISOString()])
async function fixture(current=false,configured=true) {
  await admin()
  await db.exec(`delete from app.attendance_presence_checks;delete from app.attendance_presence_sessions;delete from attendance_clock_ins;
    delete from company_leave_requests;delete from attendance_start_settings;delete from attendance_exemptions;update profiles set status='active';`)
  const date=await value(`select ((clock_timestamp() at time zone 'Asia/Seoul')::date${current?'':'-1'})::text`)
  if(configured)await db.query(`insert into attendance_start_settings values(gen_random_uuid(),$1,date_trunc('month',$2::date)::date,$3,null,'09:00',now())`,[company,date,department])
  const id=await value("insert into attendance_clock_ins(company_id,employee_id,work_date,clock_in) values($1,$2,$3,'09:00') returning id",[company,staff,date])
  return {id,date}
}
async function deliverAt(clock,time) {
  await advance(clock,time)
  const check=(await db.query("select * from app.attendance_presence_checks where clock_id=$1 and outcome='awaiting_delivery'",[clock])).rows[0]
  assert.ok(check,'확인 요청 생성')
  await db.query("update app.attendance_presence_checks set outcome='waiting',delivered_at=$2,deadline_at=$2::timestamptz+interval '5 minutes' where id=$1",[check.id,time.toISOString()])
  return check.id
}
try {
  await db.exec(`create role anon;create role authenticated;create schema app;create schema auth;create schema cron;
    grant usage on schema public,app,auth to authenticated,anon;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table cron.job(jobname text,schedule text,command text);
    create function cron.schedule(text,text,text) returns bigint language sql as $$insert into cron.job values($1,$2,$3);select 1::bigint$$;
    create table profiles(id uuid primary key,company_id uuid,department_id uuid,status text);
    create table attendance_clock_ins(id uuid primary key default gen_random_uuid(),company_id uuid,employee_id uuid,work_date date,clock_in time,clock_out_at timestamptz,created_at timestamptz default now(),unique(employee_id,work_date));
    create table attendance_start_settings(id uuid primary key,company_id uuid,month date,department_id uuid,employee_id uuid,start_time time,updated_at timestamptz);
    create table company_work_hours(company_id uuid primary key,lunch_start time,lunch_end time);
    create table attendance_exemptions(profile_id uuid primary key);
    create table company_leave_requests(id uuid primary key default gen_random_uuid(),company_id uuid,employee_id uuid,kind text,from_date date,to_date date,start_time time,end_time time,status text,created_at timestamptz default now());
    alter table attendance_clock_ins enable row level security;
    create policy own_clock_read on attendance_clock_ins for select to authenticated using(employee_id=auth.uid());
    grant select on attendance_clock_ins to authenticated;
    insert into profiles values('${staff}','${company}','${department}','active'),('${peer}','e0000000-0000-4000-8000-000000000002','${department}','active');
    insert into company_work_hours values('${company}','12:00','13:00');`)
  const clockSql=await readFile('supabase/migrations/20261012034832_attendance_clock_out.sql','utf8')
  const clockFunction=clockSql.match(/create (?:or replace )?function app\.clock_out_today\(\)[\s\S]*?\$\$\s*;/i)
  assert.ok(clockFunction,'실제 퇴근 함수 사용')
  await db.exec(clockFunction[0])
  await db.exec(await readFile('supabase/migrations/20261026103425_attendance_previous_checkout.sql','utf8'))
  const original=await value('select md5(jsonb_agg(p order by id)::text) from profiles p')
  await db.exec(await readFile('supabase/migrations/20261029130013_attendance_presence_confirmation.sql','utf8'))
  assert.equal(await value('select md5(jsonb_agg(p order by id)::text) from profiles p'),original)
  assert.equal(Number(await value("select count(*) from cron.job where jobname='atelier-attendance-presence' and schedule='* * * * *'")),1)

  let f=await fixture();let first=await at(f.id,'18:10')
  assert.equal(new Date(await value('select app.attendance_presence_end($1)',[f.id])).getTime(),(await at(f.id,'18:00')).getTime())
  await advance(f.id,new Date(first.getTime()-1));assert.equal(Number(await value('select count(*) from app.attendance_presence_checks')),0)
  await advance(f.id,first);await advance(f.id,first);assert.equal(Number(await value('select count(*) from app.attendance_presence_checks')),1,'여러 창에서도 한 요청')
  await advance(f.id,new Date(first.getTime()+5*60000));assert.equal(await value('select outcome from app.attendance_presence_checks'),'delivery_unconfirmed');assert.equal(await value('select missed_count from app.attendance_presence_sessions'),0,'미전달은 무응답으로 간주하지 않음')
  f=await fixture();first=await at(f.id,'18:10')
  for(let i=0;i<5;i++) {
    const due=new Date(first.getTime()+i*30*60000);await deliverAt(f.id,due)
    await advance(f.id,new Date(due.getTime()+5*60000-1));assert.equal(await value('select missed_count from app.attendance_presence_sessions'),i,'5분 전에는 무응답 아님')
    await advance(f.id,new Date(due.getTime()+5*60000));assert.equal(await value('select missed_count from app.attendance_presence_sessions'),i+1)
  }
  const closed=(await db.query('select * from attendance_clock_ins where id=$1',[f.id])).rows[0]
  assert.equal(closed.clock_out_at,null,'자동 종료를 실제 퇴근시간으로 만들지 않음')
  assert.equal(new Date(closed.auto_closed_at).getTime(),(await at(f.id,'20:15')).getTime())
  await advance(f.id,await at(f.id,'23:00'));assert.equal(Number(await value('select count(*) from app.attendance_presence_checks')),5,'중복 종료·확인 생성 없음')
  // Existing next-attendance flow records the real time, preserving the automatic-close audit.
  const today=await value("select (clock_timestamp() at time zone 'Asia/Seoul')::date::text")
  await db.query("insert into attendance_clock_ins(company_id,employee_id,work_date,clock_in) values($1,$2,$3,'09:00')",[company,staff,today])
  await actor(staff)
  const result=await value('select public.confirm_previous_clock_out($1,$2)',[f.date,(await at(f.id,'18:23')).toISOString()])
  assert.equal(result.outcome,'recorded');assert.ok(result.clock_out_reported_at)
  await admin();assert.ok(await value('select auto_closed_at from attendance_clock_ins where id=$1',[f.id]),'자동 종료 이력 유지')

  f=await fixture(false,false);await advance(f.id,await at(f.id,'23:00'));assert.equal(Number(await value('select count(*) from app.attendance_presence_sessions')),0,'기준 미설정 제외')
  f=await fixture();await db.query('insert into attendance_exemptions values($1)',[staff]);await advance(f.id,await at(f.id,'23:00'));assert.equal(Number(await value('select count(*) from app.attendance_presence_sessions')),0,'출퇴근 제외자 제외')
  f=await fixture();await db.query("insert into company_leave_requests(company_id,employee_id,kind,from_date,to_date,status) values($1,$2,'annual',$3,$3,'approved')",[company,staff,f.date]);assert.equal(await value('select app.attendance_presence_end($1)',[f.id]),null,'종일 휴가 제외')
  f=await fixture();await db.query("insert into company_leave_requests(company_id,employee_id,kind,from_date,to_date,start_time,end_time,status) values($1,$2,'half',$3,$3,'14:00','18:00','approved')",[company,staff,f.date]);assert.equal(new Date(await value('select app.attendance_presence_end($1)',[f.id])).getTime(),(await at(f.id,'14:00')).getTime())
  await db.query("insert into company_leave_requests(company_id,employee_id,kind,from_date,to_date,start_time,end_time,status) values($1,$2,'overtime',$3,$3,'18:00','21:00','approved')",[company,staff,f.date]);assert.equal(new Date(await value('select app.attendance_presence_end($1)',[f.id])).getTime(),(await at(f.id,'21:00')).getTime())

  f=await fixture();first=await at(f.id,'18:10');await deliverAt(f.id,first);await db.query('update attendance_clock_ins set clock_out_at=$2 where id=$1',[f.id,(await at(f.id,'18:12')).toISOString()]);await advance(f.id,await at(f.id,'18:15'));assert.equal(await value('select missed_count from app.attendance_presence_sessions'),0,'수동 퇴근 후 무응답 증가 안 함');assert.equal(await value('select outcome from app.attendance_presence_checks'),'cancelled')
  await db.query('update attendance_clock_ins set clock_out_at=null where id=$1',[f.id]);await advance(f.id,await at(f.id,'18:20'));assert.equal(await value('select closed_at from app.attendance_presence_sessions'),null,'수동 퇴근 취소 후 재개')

  f=await fixture(true);await advance(f.id,await at(f.id,'09:00'))
  await db.query("update app.attendance_presence_sessions set next_prompt_at=clock_timestamp()-interval '1 second',missed_count=4 where clock_id=$1",[f.id])
  await actor(staff);const poll=await value("select public.my_attendance_presence()")
  assert.equal(poll.state,'awaiting_delivery')
  const presented=await value("select public.my_attendance_presence('present',$1)",[poll.check.id]);assert.equal(presented.state,'waiting')
  const duplicate=await value("select public.my_attendance_presence('present',$1)",[poll.check.id]);assert.equal(duplicate.check.deadlineAt,presented.check.deadlineAt,'다른 창이 응답 시간을 연장하지 못함')
  await assert.rejects(()=>db.query('select app.advance_attendance_presence($1,now())',[f.id]),/permission denied/)
  await assert.rejects(()=>db.query('select * from app.attendance_presence_checks'),/permission denied/)
  await actor(peer);await assert.rejects(()=>db.query("select public.my_attendance_presence('continue',$1)",[poll.check.id]),/이미 처리|확인|근무/)
  await actor(staff);const yes=await value("select public.my_attendance_presence('continue',$1)",[poll.check.id]);assert.equal(yes.missedCount,0);assert.ok(yes.lastConfirmedAt)
  await assert.rejects(()=>db.query("select public.my_attendance_presence('continue',$1)",[poll.check.id]),/이미 처리/)
  await admin();await db.query("update app.attendance_presence_sessions set next_prompt_at=clock_timestamp()-interval '1 second' where clock_id=$1",[f.id])
  await actor(staff);const again=await value('select public.my_attendance_presence()');await value("select public.my_attendance_presence('present',$1)",[again.check.id]);const out=await value("select public.my_attendance_presence('clock_out',$1)",[again.check.id]);assert.equal(out.state,'clocked_out')
  await actor(null);await assert.rejects(()=>db.query('select public.my_attendance_presence()'),/로그인/)
  console.log('attendance-presence-db: 예정 퇴근·10분 유예·30분 재확인·5분 응답·전달 구분·연속 5회 종료·중복/권한 차단·응답 초기화·수동 퇴근·다음 출근 실제 시각 입력·자동 종료 원본 분리 통과')
} catch(error) { console.error('attendance-presence-db 실패:',error.message,{code:error.code,query:error.query});process.exitCode=1 }
finally { await db.close() }
