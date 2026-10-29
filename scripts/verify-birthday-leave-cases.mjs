import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

export async function verifyBirthdayLeave({db,actor,value,create,ops,company,foreign}) {
  await db.exec("reset role;select set_config('test.today','2026-10-29',false);alter table employee_roster add column resident_id text")
  const fingerprint=()=>value("select md5(jsonb_build_object('profiles',(select jsonb_agg(p order by id) from profiles p),'roster',(select jsonb_agg(r order by profile_id) from employee_roster r),'requests',(select jsonb_agg(r order by id) from company_leave_requests r),'grants',(select jsonb_agg(to_jsonb(g)-'grant_source'-'birthday_year' order by id) from app.employee_extra_leave g),'usage',(select jsonb_agg(u order by request_id,grant_id,used_on) from app.employee_extra_leave_usage u),'ledger',(select jsonb_agg(e order by request_id) from app.leave_balance_entries e),'events',(select jsonb_agg(e order by id) from app.leave_lifecycle_events e),'policies',(select jsonb_agg(p order by schemaname,tablename,policyname) from pg_policies p))::text)")
  const before=await fingerprint()
  await db.exec((await readFile('supabase/migrations/20261029113532_employee_birthday_leave.sql','utf8')).replaceAll("(now() at time zone 'Asia/Seoul')::date", "current_setting('test.today')::date"))
  assert.equal(await fingerprint(),before,'적용 자체는 기존 명부·신청·부여·사용·음수·이력·정책을 바꾸지 않음')
  const today=async date=>{await db.exec('reset role');await db.query("select set_config('test.today',$1,false)",[date])}
  const ensure=async(id,date='2026-10-29')=>{await db.exec('reset role');await db.query('select app.ensure_employee_birthday_leave($1,$2)',[id,date])}
  const rows=async id=>{await db.exec('reset role');return (await db.query("select id,days,granted_on::text,expires_on::text,birthday_year,created_by,updated_by,version,note,deleted_at from app.employee_extra_leave where employee_id=$1 and grant_source='birthday' order by birthday_year",[id])).rows}
  const available=async(id,date)=>{await db.exec('reset role');return Number(await value('select app.extra_leave_available($1,$2)',[id,date]))}
  let sequence=100
  async function init(resident='901105',amount=5,hire='2024-09-01') {
    const id=`80000000-0000-4000-8000-${String(sequence++).padStart(12,'0')}`
    await today('2026-10-29')
    await db.query("insert into profiles(id,company_id,status,display_name,hire_date) values($1,$2,'active','생일 검증',$3)",[id,company,hire])
    await actor(ops);await db.query('select public.save_employee_leave_total($1,$2)',[id,amount]);await db.exec('reset role')
    await db.exec("select set_config('app.roster_import','on',false)")
    await db.query('update employee_roster set resident_id=$2,accrued_annual_leave=15 where profile_id=$1',[id,resident])
    await db.exec("select set_config('app.roster_import','',false)")
    await db.query("insert into app.employee_leave_accrual select $1,$2,$3,starts_on,ends_on,grant_days,'birthday-fixture',now(),now() from app.employee_leave_cycle($3,'2026-10-29')",[id,company,hire])
    return id
  }
  const staff=await init()
  await ensure(staff,'2026-10-28');assert.equal((await rows(staff)).length,0,'시작 전에는 부여 안 함')
  await ensure(staff);await ensure(staff)
  let [grant]=await rows(staff)
  assert.equal((await rows(staff)).length,1,'반복 실행 1건')
  assert.equal(grant.granted_on,'2026-10-29');assert.equal(grant.expires_on,'2026-11-12');assert.equal(Number(grant.days),0.5)
  assert.equal(grant.created_by,null,'자동 부여를 직원 행위로 위조하지 않음')
  assert.equal(await value("select count(*)::int from app.leave_lifecycle_events where source_key=$1 and kind='granted'",[grant.id]),1)
  await assert.rejects(()=>db.query("insert into app.employee_extra_leave select gen_random_uuid(),employee_id,company_id,days,expires_on,note,granted_on,created_at,created_by,updated_at,updated_by,version,deleted_at,grant_source,birthday_year from app.employee_extra_leave where id=$1",[grant.id]),/unique constraint/,'동시 생성 마지막 방어는 DB 고유키')
  await actor(staff);const q1=await create('quarter','2026-10-29','2026-10-29',staff)
  assert.equal(await available(staff,'2026-10-29'),0.25,'반반차 0.25 사용')
  await actor(staff);const q2=await create('quarter','2026-10-30','2026-10-30',staff)
  assert.equal(await available(staff,'2026-10-29'),0,'두 번 나눠 사용')
  assert.equal(Number(await value('select remaining_annual_leave from employee_roster where profile_id=$1',[staff])),5,'먼저 만료되는 생일분부터 차감')
  await actor(staff);await db.query("update company_leave_requests set status='cancelled' where id=$1",[q1.id])
  assert.equal(await available(staff,'2026-10-29'),0.25,'본인 취소 시 생일분 복원')
  await today('2026-11-13');await db.query("select app.refresh_employee_leave($1,'2026-11-13')",[staff]);await db.query("select app.refresh_employee_leave($1,'2026-11-13')",[staff])
  assert.equal(await available(staff,'2026-11-13'),0)
  assert.equal(Number(await value("select sum(days) from app.leave_lifecycle_events where source_key=$1 and kind in ('expired','expiry_adjustment')",[grant.id])),-0.25,'미사용분만 만료')
  assert.equal(await value("select count(*)::int from app.leave_lifecycle_events where source_key=$1 and kind='expired'",[grant.id]),1,'만료 중복 없음')
  await actor(staff);await db.query("update company_leave_requests set status='cancelled' where id=$1",[q2.id])
  assert.equal(await available(staff,'2026-11-13'),0,'만료 후 취소해도 가용량 부활 안 함')
  const mix=await init();await actor(mix);await create('annual','2026-11-02','2026-11-02',mix)
  assert.equal((await rows(mix)).length,1,'신청 경로에서 자동 부여 누락 보완')
  assert.equal(Number(await value('select remaining_annual_leave from employee_roster where profile_id=$1',[mix])),4.5,'연차 1일 = 생일 .5 + 기본 .5')
  const limits=await init();await ensure(limits)
  assert.equal(await available(limits,'2026-10-28'),0);assert.equal(await available(limits,'2026-11-12'),0.5);assert.equal(await available(limits,'2026-11-13'),0)
  await actor(limits);await create('half','2026-11-13','2026-11-13',limits)
  assert.equal(await available(limits,'2026-10-29'),0.5,'실제 휴가일이 범위 밖이면 생일분 사용 안 함')
  await actor(limits);await create('half','2026-11-12','2026-11-12',limits)
  assert.equal(await available(limits,'2026-10-29'),0,'마지막 날 포함')
  const revoke=await init();await ensure(revoke);[grant]=await rows(revoke)
  await actor(revoke);const used=await create('half','2026-11-02','2026-11-02',revoke)
  await actor(ops);await db.query('select public.save_employee_extra_leave($1,$2,$3,$4,$5,$6,true)',[grant.id,revoke,0.5,grant.expires_on,'중복 복지 취소',1])
  await ensure(revoke);assert.equal((await rows(revoke)).length,1);assert.ok((await rows(revoke))[0].deleted_at,'취소한 자동분 재생성 금지')
  assert.equal(Number(await value('select remaining_annual_leave from employee_roster where profile_id=$1',[revoke])),4.5,'부여 취소 시 기존 사용을 기본으로 재배분')
  assert.equal(await value('select status from company_leave_requests where id=$1',[used.id]),'approved','신청 원본 보존')
  for(const resident of [null,'','생일 미확인','901331','900431','900000']) {
    const id=await init(resident);await ensure(id);assert.equal((await rows(id)).length,0,'미등록·잘못된 날짜는 제외')
  }
  const inactive=await init();await db.query("update profiles set status='pending' where id=$1",[inactive]);await ensure(inactive);assert.equal((await rows(inactive)).length,0)
  const retired=await init();await db.exec("select set_config('app.roster_import','on',false)");await db.query("update employee_roster set resigned_on='2026-10-01' where profile_id=$1",[retired]);await db.exec("select set_config('app.roster_import','',false)");await ensure(retired);assert.equal((await rows(retired)).length,0)
  const missed=await init();await ensure(missed,'2026-11-13');assert.equal((await rows(missed)).length,0,'기간 지난 생일 소급 부여 안 함');await ensure(missed,'2026-11-06');assert.equal((await rows(missed)).length,1,'유효 기간 내 누락 보완')
  const newYear=await init('900103');await ensure(newYear,'2026-12-27');const [ny]=await rows(newYear)
  assert.equal(ny.birthday_year,2027);assert.equal(ny.granted_on,'2026-12-27');assert.equal(ny.expires_on,'2027-01-10');await ensure(newYear,'2027-01-02');assert.equal((await rows(newYear)).length,1)
  await ensure(newYear,'2027-12-27');assert.equal((await rows(newYear)).length,2,'다음 생일 연도에는 새 부여')
  const yearEnd=await init('901229');await ensure(yearEnd,'2027-01-03');assert.equal((await rows(yearEnd))[0].birthday_year,2026,'전년도 생일 기간이 새해에 걸치는 경우')
  assert.equal(await value("select app.birthday_in_year('000229',2026)::text"),'2026-02-28')
  assert.equal(await value("select app.birthday_in_year('000229',2028)::text"),'2028-02-29')
  const own=await init();await ensure(own);await actor(own);assert.equal(Number((await value("select app.get_my_attendance_basis('2026-10-01')")).remainingAnnualLeave),5.5,'본인 근태 조회에서 자동분 합산')
  const cron=await init();await db.query('select app.refresh_company_leave_balances()');assert.equal((await rows(cron)).length,1,'기존 일일 작업에서 자동 생성')
  const manager=await init();await actor(ops);const records=await value('select public.employee_extra_leave_records()')
  assert.ok(records.entries.some(e=>e.employeeId===manager && e.note.includes('생일 반차') && Number(e.days)===0.5),'관리 화면에 기존 추가 이력으로 표시')
  assert.ok(records.events.some(e=>e.employeeId===manager && e.note.includes('자동 부여') && !e.actorName),'자동 이력 표시')
  await actor(manager);await assert.rejects(()=>db.query('select public.employee_extra_leave_records()'),/권한/)
  for(const id of [manager,foreign]) {await actor(id);await assert.rejects(()=>db.query("select app.ensure_employee_birthday_leave($1,'2026-10-29')",[manager]),/permission denied/)}
  await db.exec('reset role;set role anon');await assert.rejects(()=>db.query("select app.birthday_in_year('901105',2026)"),/permission denied/)
  await db.exec('reset role');assert.equal(await value("select has_table_privilege('authenticated','app.employee_extra_leave','insert')"),false)
  console.log('birthday-leave: 기존 데이터 보존, 생일 ±7일·연도 경계·윤년·누락 제외·.25 분할/.5 혼합·실제 휴가일·만료/취소/중복 방지·일일 작업/본인/관리 조회·권한 검증 통과')
}
