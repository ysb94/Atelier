import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

export async function verifyLeaveAdvances({db,actor,value,ops,company,foreign,dept}) {
 const migration='supabase/migrations/20261102035701_employee_leave_advances.sql'
 const approver='91000000-0000-4000-8000-000000000001'
 await db.exec(`reset role;alter table employee_roster add column if not exists resigned_on date;
  insert into profiles(id,company_id,department_id,status,display_name,hire_date) values('${approver}','${company}','${dept}','active','승인자','2020-01-01');
  create or replace function app.is_department_request_approver(c uuid,d uuid,k text) returns boolean language sql stable as $$select auth.uid()='${approver}'::uuid and c='${company}'::uuid and d='${dept}'::uuid$$;
  alter policy leave_read on company_leave_requests using(employee_id=auth.uid() or app.is_department_request_approver(company_id,department_id,kind));
  select set_config('test.today','2026-10-29',false);`)
 const hash=()=>value(`select md5(jsonb_build_object('profiles',(select jsonb_agg(p order by id) from profiles p),'roster',(select jsonb_agg(r order by profile_id) from employee_roster r),'requests',(select jsonb_agg(to_jsonb(q)-'advance_requested' order by id) from company_leave_requests q),'entries',(select jsonb_agg(e order by request_id) from app.leave_balance_entries e),'grants',(select jsonb_agg(g order by id) from app.employee_extra_leave g),'usage',(select jsonb_agg(u order by request_id,grant_id,used_on) from app.employee_extra_leave_usage u),'periods',(select jsonb_agg(b order by employee_id,period_key) from app.leave_base_periods b),'policies',(select jsonb_agg(p order by schemaname,tablename,policyname) from pg_policies p),'acl',(select jsonb_agg(jsonb_build_object('rel',relname,'acl',relacl) order by relname) from pg_class where relnamespace='public'::regnamespace and relkind='r'))::text)`)
 const before=await hash()
 await db.exec((await readFile(migration,'utf8')).replaceAll("(now() at time zone 'Asia/Seoul')::date","current_setting('test.today')::date"))
 assert.equal(await hash(),before,'마이그레이션 자체가 기존 원본·권한·배분을 바꾸지 않음')
 const verifyLoadGuard=process.argv.includes('--load-guard')
   ? await (await import('./verify-leave-load-guard-cases.mjs')).prepareLeaveLoadGuard({db,value,company}) : null
 const verifyReadEfficiency=process.argv.includes('--read-efficiency')
   ? await (await import('./verify-leave-read-efficiency-cases.mjs')).prepareLeaveReadEfficiency({db,actor,value,ops,company,foreign,dept}) : null
 let serial=10
 const today=async date=>{await db.exec('reset role');await db.query("select set_config('test.today',$1,false)",[date])}
 async function init(amount=0,hire='2024-11-03') {
  await today('2026-10-29')
  const id=`91000000-0000-4000-8000-${String(serial++).padStart(12,'0')}`
  await db.query("insert into profiles(id,company_id,department_id,status,display_name,hire_date) values($1,$2,$3,'active','선사용 검증',$4)",[id,company,dept,hire])
  await actor(ops);await db.query('select public.save_employee_leave_total($1,$2)',[id,amount]);await db.exec('reset role')
  await db.exec("select set_config('app.roster_import','on',false)");await db.query('update employee_roster set accrued_annual_leave=15 where profile_id=$1',[id]);await db.exec("select set_config('app.roster_import','',false)")
  await db.query("insert into app.employee_leave_accrual select $1,$2,$3,starts_on,ends_on,grant_days,'advance-test',now(),now() from app.employee_leave_cycle($3,'2026-10-29')",[id,company,hire])
  await db.query("select app.refresh_employee_leave($1,'2026-10-29')",[id])
  return id
 }
 const base=async id=>{await db.exec('reset role');return Number(await value('select remaining_annual_leave from employee_roster where profile_id=$1',[id]))}
 const summary=async id=>{await db.exec('reset role');return value('select app.leave_advance_summary($1)',[id])}
 const manage=(id,action,days,note='검증 사유')=>db.query('select public.manage_leave_advance($1,$2,$3,$4)',[id,action,days,note])
 const request=async(id,kind='annual',date='2026-10-30',note='가족 일정')=>{
  await actor(id)
  return (await db.query(`insert into company_leave_requests(employee_id,company_id,kind,from_date,to_date,start_time,end_time,note,place,advance_requested) values($1,$2,$3,$4,$4,'09:00',$5,$6,'',true) returning *`,[id,company,kind,date,kind==='half'?'14:00':kind==='quarter'?'11:00':'18:00',note])).rows[0]
 }
 const decide=async(id,status,by=approver)=>{await actor(by);return db.query('update company_leave_requests set status=$2,decision_note=$3 where id=$1 returning *',[id,status,status==='rejected'?'사유 확인':'확인'])}
 const staff=await init()
 await assert.rejects(()=>request(staff),/한도/)
 await actor(staff);await assert.rejects(()=>manage(staff,'limit',3),/권한/)
 await actor(ops);await assert.rejects(()=>manage(foreign,'limit',3),/직원/)
 await manage(staff,'limit',3)
 await assert.rejects(()=>request(staff,'annual','2026-10-30',''),/사유/)
 let r=await request(staff)
 assert.equal(r.status,'pending');assert.equal(await base(staff),0,'대기 신청은 차감 안 함')
 await assert.rejects(()=>decide(r.id,'approved',staff),/승인자|본인/)
 await decide(r.id,'approved');assert.equal(await base(staff),-1)
 assert.equal(Number((await summary(staff)).outstanding),1)
 await decide(r.id,'cancelled',staff);assert.equal(await base(staff),0)
 assert.equal(Number((await summary(staff)).outstanding),0)
 const h=await request(staff,'half','2026-10-30');await decide(h.id,'approved')
 const q=await request(staff,'quarter','2026-11-02');await decide(q.id,'approved')
 assert.equal(await base(staff),-0.75)
 await actor(ops);await manage(staff,'limit',0.75)
 r=await request(staff,'quarter','2026-11-03')
 await assert.rejects(()=>decide(r.id,'approved'),/한도/)
 await db.exec('reset role');assert.equal(await value('select status from company_leave_requests where id=$1',[r.id]),'pending','한도 경합 실패는 승인 상태도 롤백')
 await decide(r.id,'rejected');assert.equal(await base(staff),-0.75)
 await assert.rejects(()=>request(staff,'annual','2026-11-04'),/현재 연차 기간/)
 await today('2026-11-04');await db.query("select app.refresh_employee_leave($1,'2026-11-04')",[staff])
 assert.equal(await base(staff),15-0.75,'새 발생분에서 선사용만 한 번 정산')
 let s=await summary(staff);assert.equal(Number(s.outstanding),0);assert.equal(Number(s.periods[0].settled),0.75)
 const count=await value("select count(*)::int from app.leave_advance_events where employee_id=$1",[staff])
 await db.query("select app.refresh_employee_leave($1,'2026-11-04')",[staff]);assert.equal(await base(staff),14.25)
 assert.equal(await value("select count(*)::int from app.leave_advance_events where employee_id=$1",[staff]),count,'반복 조회 중복 정산 없음')
 await decide(h.id,'cancelled',staff);assert.equal(await base(staff),14.75,'정산 뒤 취소는 실제 정산분 복구')
 await decide(q.id,'cancelled',staff);assert.equal(await base(staff),15)
 // Imported minus values require explicit classification, never invent past usage.
 const imported=await init(-2)
 s=await summary(imported);assert.equal(Number(s.unclassified),2)
 await actor(ops);await assert.rejects(()=>manage(imported,'import',3),/범위/)
 await manage(imported,'import',2,'엑셀 기준일 확인');assert.equal(await base(imported),-2)
 await actor(ops);await assert.rejects(()=>manage(imported,'import',2),/범위|unique/)
 await today('2026-11-04');await db.query("select app.refresh_employee_leave($1,'2026-11-04')",[imported]);assert.equal(await base(imported),13)
 // First year monthly delta offsets an advance in the existing period.
 const monthly=await init(0,'2026-09-30')
 await actor(ops);await manage(monthly,'limit',2)
 r=await request(monthly,'quarter');await decide(r.id,'approved');assert.equal(await base(monthly),-0.25)
 assert.equal((await summary(monthly)).nextDate,'2026-10-31')
 await today('2026-10-31');await db.query("select app.refresh_employee_leave($1,'2026-10-31')",[monthly]);assert.equal(await base(monthly),0.75)
 assert.equal(Number((await summary(monthly)).outstanding),0)
 assert.equal(await value("select count(*)::int from app.leave_advance_events where employee_id=$1 and kind='monthly_settled'",[monthly]),1)
 // Less new credit than debt: keep the remainder; never reset it to zero.
 const large=await init(-20)
 await actor(ops);await manage(large,'import',10);await manage(large,'import',10,'엑셀 추가 확인')
 await today('2026-11-04');await db.query("select app.refresh_employee_leave($1,'2026-11-04')",[large])
 s=await summary(large);assert.equal(Number(s.outstanding),5);assert.equal(await base(large),0)
 assert.equal(Number(await value("select app.leave_past_shortfall($1,'2026-11-04')",[large])),5)
 await actor(ops);await manage(large,'limit',0,'신규 선사용 중지')
 assert.equal(Number((await summary(large)).outstanding),5,'한도 0도 기존 부채를 지우지 않음')
 // Classifying an old Excel deficit preserves net balance and does not invent leave requests.
 const old=await init(-2)
 await today('2026-11-04');await db.query("select app.refresh_employee_leave($1,'2026-11-04')",[old])
 assert.equal(Number((await summary(old)).unclassified),2)
 const requestCount=await value('select count(*)::int from company_leave_requests where employee_id=$1',[old])
 await actor(ops);await db.query("select public.manage_leave_advance($1,'import',2,'기존 엑셀 기준일 확인','2025-11-04')",[old])
 assert.equal(await base(old),13);assert.equal(Number((await summary(old)).unclassified),0)
 assert.equal(await value('select count(*)::int from company_leave_requests where employee_id=$1',[old]),requestCount)
 await actor(ops);await db.query("select public.manage_leave_advance($1,'import_cancel',0,'분류 정정 검증','2025-11-04')",[old])
 assert.equal(await base(old),15);assert.equal(Number((await summary(old)).unclassified),2)
 assert.equal(Number(await value("select app.leave_past_shortfall($1,'2026-11-04')",[old])),2,'분류 취소는 부족분 자체를 없애지 않음')
 await actor(ops);await db.query("select public.manage_leave_advance($1,'import',2,'다시 확인','2025-11-04')",[old]);assert.equal(await base(old),13)
 // Half a day available, one day leave: borrow only the missing half, not the whole day.
 const mixed=await init(0.5)
 await actor(ops);await manage(mixed,'limit',0.5)
 r=await request(mixed);await decide(r.id,'approved');assert.equal(await base(mixed),-0.5)
 assert.equal(Number((await summary(mixed)).outstanding),0.5)
 await actor(ops);await manage(mixed,'limit',0,'선사용 중지')
 await assert.rejects(()=>request(mixed,'quarter','2026-11-02'),/한도/)
 await decide(r.id,'cancelled',mixed);assert.equal(await base(mixed),0.5)
 // Extra/birthday credits retain their independent dates; never settle base debt with a bonus.
 const bonus=await init(0)
 await actor(ops);await manage(bonus,'limit',2)
 r=await request(bonus,'quarter');await decide(r.id,'approved')
 const grant='92000000-0000-4000-8000-000000000001'
 await actor(ops);await db.query("select public.save_employee_extra_leave($1,$2,0.5,'2026-11-10','추가 휴가 검증',0,false)",[grant,bonus])
 assert.equal(Number((await summary(bonus)).outstanding),0.25,'새 추가분은 기존 배분을 임의로 옮기거나 부채를 상계하지 않음')
 await actor(ops);await db.query("select public.save_employee_extra_leave($1,$2,0.5,'2026-11-10','명시 수정 재계산',1,false)",[grant,bonus])
 s=await summary(bonus);assert.equal(Number(s.outstanding),0)
 await actor(ops);await db.query("select public.save_employee_extra_leave($1,$2,0.5,'2026-11-10','부여 취소 검증',2,true)",[grant,bonus])
 assert.equal(Number((await summary(bonus)).outstanding),0.25,'추가분 취소 재배분도 선사용 한도/원장을 보존')
 // Resignation blocks new requests/management and leaves raw data for review.
 const stopped=await init(-1)
 await actor(ops);await manage(stopped,'import',1);await db.exec('reset role');await db.query('update employee_roster set resigned_on=$2 where profile_id=$1',[stopped,'2026-10-30'])
 await actor(ops);await assert.rejects(()=>manage(stopped,'limit',2),/직원|퇴사/)
 assert.equal((await summary(stopped)).needsReview,true)
 await today('2026-11-04');await actor(imported);const mine=await value('select public.employee_leave_advances(false)');assert.ok(mine.employees.every(e=>e.employeeId===imported))
 await assert.rejects(()=>db.query('select public.employee_leave_advances(true)'),/권한/)
 for(const table of ['leave_advance_authorizations','leave_advance_transfers','leave_advance_limits','leave_advance_events']) await assert.rejects(()=>db.query(`select * from app.${table}`),/permission denied/)
 await db.exec('reset role;set role anon');await assert.rejects(()=>db.query('select public.employee_leave_advances(false)'),/permission denied/)
 if (verifyLoadGuard) await verifyLoadGuard()
 if (verifyReadEfficiency) await verifyReadEfficiency()
 console.log('leave-advance: 기존 원본/ACL/RLS 보존·별도 승인·분할·한도·본인/타사 차단·월 발생·기념일 정산·정산 후 취소·멱등·엑셀 음수 분류·퇴사 보류 통과')
 if (process.argv.includes('--operations-advance')) {
   const { verifyOperationsLeaveAdvances } = await import('./verify-operations-leave-advance-cases.mjs')
   await verifyOperationsLeaveAdvances({ db, actor, value, company, foreign, dept, approver, init, today, base, summary })
 }
}
