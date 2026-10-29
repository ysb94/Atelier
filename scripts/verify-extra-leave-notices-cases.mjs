import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

export async function verifyExtraLeaveNotices({db,value,actor,company,other,id}) {
  const employee=id(30), manager=id(1), peer=id(31), foreign=id(32), session='30000000-0000-4000-8000-000000000030'
  await db.exec(`reset role;select set_config('test.today','2026-10-29',false);
    create table company_leave_requests(id uuid primary key default gen_random_uuid());
    create table app.leave_lifecycle_events(id uuid primary key default gen_random_uuid(),source_kind text,source_key text,kind text);
    insert into profiles(id,company_id,status,display_name,hire_date) values('${employee}','${company}','active','알림 직원','2024-08-01'),('${peer}','${company}','active','다른 직원','2024-08-01'),('${foreign}','${other}','active','타사 직원','2024-08-01');
    insert into employee_roster values('${employee}','${company}',5,null),('${peer}','${company}',5,null),('${foreign}','${other}',5,null);
    insert into auth.sessions values('${session}','${employee}');`)
  const schema=(await readFile('supabase/migrations/20261029103912_employee_additional_leave.sql','utf8')).split('create function app.extra_leave_available')[0]
  await db.exec(schema+'commit;')
  await db.exec("alter table app.employee_extra_leave add column grant_source text default 'manual';alter table app.employee_extra_leave add column birthday_year integer")
  const hash=()=>value("select md5(jsonb_build_array((select jsonb_agg(p order by id) from profiles p),(select jsonb_agg(r order by profile_id) from employee_roster r),(select jsonb_agg(n order by id) from leave_usage_notices n))::text)")
  const before=await hash()
  const migration=await readFile('supabase/migrations/20261029120358_extra_leave_usage_notices.sql','utf8')
  await db.exec(migration.replaceAll("(now() at time zone 'Asia/Seoul')::date","current_setting('test.today')::date").replaceAll('clock_timestamp()',"(current_setting('test.today')::date::timestamp at time zone 'Asia/Seoul')"))
  assert.equal(await hash(),before,'기존 직원·잔여·기본 안내·확인 이력 보존')
  const today=async day=>{await db.exec('reset role');await db.query("select set_config('test.today',$1,false)",[day])}
  const grant=async(days,expiry,source='manual',who=employee,created='2026-10-29')=>{
    await db.exec('reset role');const key=crypto.randomUUID()
    await db.query(`insert into app.employee_extra_leave(id,employee_id,company_id,days,expires_on,note,granted_on,created_by,updated_by,created_at,updated_at,grant_source)
      values($1,$2,$3,$4,$5,'사유 테스트',$6,$7,$7,$6::date::timestamp at time zone 'Asia/Seoul',$6::date::timestamp at time zone 'Asia/Seoul',$8)`,[key,who,who===foreign?other:company,days,expiry,created,manager,source])
    await db.query("insert into app.leave_lifecycle_events(source_kind,source_key,kind) values('extra',$1,'granted')",[key])
    return key
  }
  const notices=async key=>{await db.exec('reset role');return(await db.query('select * from extra_leave_usage_notices where grant_id=$1 order by issued_at,phase',[key])).rows}
  const dispatch=async key=>{await db.exec('reset role');return value('select app.dispatch_extra_leave_grant_notice($1)',[key])}
  const normal=await grant(2,'2027-04-30'), birthday=await grant(0.5,'2026-11-12','birthday')
  let first=(await notices(normal))[0];assert.equal(first.phase,'registered');assert.equal(Number(first.remaining_days),2);assert.ok(first.body.includes('사유 테스트'));assert.ok(first.body.includes('2027-04-30'))
  assert.equal(await dispatch(normal),0,'연속 실행 등록 중복 없음');assert.equal((await notices(birthday)).length,1)
  await today('2026-11-05');await dispatch(birthday);assert.deepEqual((await notices(birthday)).map(n=>n.phase),['registered','oneWeek'],'생일은 등록과 1주일 전만')
  await today('2027-01-30');await dispatch(normal);await today('2027-03-30');await dispatch(normal);await today('2027-04-16');await dispatch(normal)
  assert.deepEqual((await notices(normal)).map(n=>n.phase),['registered','threeMonths','oneMonth','twoWeeks'])
  await dispatch(normal);assert.equal((await notices(normal)).length,4)
  const short=await grant(1,'2027-05-06','manual',employee,'2027-04-16');await dispatch(short);assert.equal((await notices(short)).length,1,'20일 기한 등록 시 지난 두 단계 몰아보내지 않음')
  await today('2027-04-22');await dispatch(short);assert.equal((await notices(short)).at(-1).phase,'twoWeeks')
  await today('2026-10-29')
  const used=await grant(0.5,'2026-11-12','birthday');const request=crypto.randomUUID()
  await db.query('insert into company_leave_requests values($1)',[request]);await db.query("insert into app.employee_extra_leave_usage values($1,$2,'2026-11-10',0.5,null)",[request,used])
  await today('2026-11-05');await dispatch(used);assert.equal((await notices(used)).length,1,'전부 예약된 생일 반차는 만료 안내 안 함')
  await db.query('update app.employee_extra_leave_usage set days=0.25 where grant_id=$1',[used]);await dispatch(used)
  const partial=(await notices(used)).at(-1);assert.equal(Number(partial.remaining_days),0.25);assert.equal(Number(partial.reserved_days),0.25,'신청 가능과 예약을 구분')
  await actor(employee,session);const own=await value('select public.list_my_extra_leave_notices()');assert.ok(own.some(n=>n.id===partial.id));assert.ok(!own.some(n=>'confirmed_session_id' in n))
  await assert.rejects(()=>db.query("select public.record_extra_leave_notice($1,'confirm')",[partial.id]),/먼저 열람/)
  await db.query("select public.record_extra_leave_notice($1,'view')",[partial.id]);await db.query("select public.record_extra_leave_notice($1,'confirm')",[partial.id])
  let confirmed=(await notices(used)).find(n=>n.id===partial.id);assert.ok(confirmed.confirmed_at)
  await actor(employee,session);await db.query("select public.record_extra_leave_notice($1,'confirm')",[partial.id])
  assert.equal(String((await notices(used)).find(n=>n.id===partial.id).confirmed_at),String(confirmed.confirmed_at),'최초 본인 확인 시각 유지')
  await actor(manager);const management=await value('select public.leave_notice_management_v2()');assert.ok(management.extraNotices.some(n=>n.id===partial.id&&n.confirmed_at));assert.ok(management.extraGrants.some(g=>g.id===used&&Number(g.reserved)===0.25));assert.ok(!management.extraNotices.some(n=>'confirmed_session_id' in n))
  for(const who of [peer,foreign,manager]) {await actor(who);await assert.rejects(()=>db.query("select public.record_extra_leave_notice($1,'view')",[partial.id]),/본인 안내문/)}
  await actor(peer);await assert.rejects(()=>db.query('select public.leave_notice_management_v2()'),/권한/)
  await actor(id(20));assert.equal((await value('select public.leave_notice_management_v2()')).extraNotices.length,0)
  await actor(employee,crypto.randomUUID());await assert.rejects(()=>db.query("select public.record_extra_leave_notice($1,'confirm')",[partial.id]),/세션/)
  await db.exec('reset role');await db.query('insert into impersonation_events(target_id) values($1)',[employee]);await actor(employee,session);await assert.rejects(()=>db.query("select public.record_extra_leave_notice($1,'confirm')",[partial.id]),/계정 전환/)
  await db.exec('reset role');await db.query('delete from impersonation_events where target_id=$1',[employee])
  await db.query("update app.employee_extra_leave set version=2,note='변경 사유',updated_at='2026-11-05T00:00:00+09' where id=$1",[used])
  await db.query("insert into app.leave_lifecycle_events(source_kind,source_key,kind) values('extra',$1,'edited')",[used])
  assert.equal((await notices(used)).filter(n=>!n.invalidated_at).length,1,'수정 후 이전 단계는 보존하되 비활성화')
  assert.ok((await notices(used)).find(n=>n.id===partial.id).confirmed_at,'이전 확인 이력 보존')
  await actor(employee,session);assert.ok(!(await value('select public.list_my_extra_leave_notices()')).some(n=>n.id===partial.id))
  await db.exec('reset role');await db.query("update app.employee_extra_leave set version=3,deleted_at=now() where id=$1",[used]);await db.query("insert into app.leave_lifecycle_events(source_kind,source_key,kind) values('extra',$1,'revoked')",[used])
  assert.equal((await notices(used)).filter(n=>!n.invalidated_at).length,0,'취소 후 알림 중단')
  await today('2027-05-07');await dispatch(short);await actor(employee,session);assert.ok(!(await value('select public.list_my_extra_leave_notices()')).some(n=>n.grant_id===short),'만료 안내를 현재 미확인으로 반복하지 않음')
  await db.exec('reset role;set role anon');await assert.rejects(()=>db.query('select * from extra_leave_usage_notices'))
  await actor(employee,session);await assert.rejects(()=>db.query("update extra_leave_usage_notices set confirmed_at=now()"));await assert.rejects(()=>db.query('select app.dispatch_extra_leave_usage_notices()'))
  await db.exec('reset role');assert.equal(await hash(),before,'알림 작업은 기존 직원·연차·기본 알림을 바꾸지 않음')
  console.log('extra-leave-notices: 등록/3개월/1개월/2주·생일1주·중복/단기·현재잔여/예약·수정/취소/만료·본인확인/권한/세션·기존 이력 보존 통과')
}
