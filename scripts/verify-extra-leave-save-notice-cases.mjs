import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { verifyWorkforceGuardAlias } from './verify-workforce-guard-alias.mjs'

export async function verifyExtraLeaveSaveNotice({ db, value, actor, company, ops }) {
  const employee = '10000000-0000-4000-8000-000000000099'
  const grant = crypto.randomUUID()
  await db.exec("reset role;select set_config('test.today','2026-11-10',false)")
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [ops])
  await db.exec(`create table if not exists app.leave_notice_settings(company_id uuid primary key,enabled boolean);
    insert into app.leave_notice_settings values('${company}',true) on conflict(company_id) do update set enabled=true;
    insert into profiles(id,company_id,status,display_name,hire_date) values('${employee}','${company}','active','저장 알림 검증','2024-11-01');
    insert into employee_roster(profile_id,company_id,remaining_annual_leave) values('${employee}','${company}',5);`)
  const noticeSql = (await readFile('supabase/migrations/20261029120358_extra_leave_usage_notices.sql', 'utf8'))
    .split('create function app.dispatch_extra_leave_usage_notices()')[0]
  await db.exec(noticeSql.replaceAll("(now() at time zone 'Asia/Seoul')::date", "current_setting('test.today')::date") + '\ncommit;')
  await verifyWorkforceGuardAlias(db, 'notice')
  const save = (days, version, remove = false) => db.query(
    'select public.save_employee_extra_leave($1,$2,$3,$4,$5,$6,$7)',
    [grant, employee, days, '2027-04-30', '저장 및 알림 회귀 검증', version, remove])
  const count = async table => { await db.exec('reset role'); return Number(await value(`select count(*) from ${table} where ${table.endsWith('events') ? 'source_key=$1' : 'grant_id=$1'}`, [grant])) }
  await actor(ops); await save(2, 0)
  assert.equal(await count('public.extra_leave_usage_notices'), 1, '저장과 등록 알림이 함께 완료')
  await actor(ops); await save(2, 0)
  assert.equal(await count('public.extra_leave_usage_notices'), 1, '같은 저장 재시도 알림 중복 없음')
  await actor(ops); await save(3, 1)
  assert.equal(await count('public.extra_leave_usage_notices'), 2, '수정 알림 생성')
  assert.equal(Number(await value('select count(*) from public.extra_leave_usage_notices where grant_id=$1 and invalidated_at is null', [grant])), 1, '현재 안내만 활성')
  await actor(employee); await assert.rejects(() => save(99, 2), /권한/)
  await actor(ops); await save(3, 2, true)
  assert.equal(await count('app.leave_lifecycle_events'), 3, '등록·수정·취소 이력 보존')
  assert.equal(Number(await value('select count(*) from public.extra_leave_usage_notices where grant_id=$1 and invalidated_at is null', [grant])), 0, '취소 후 기존 알림 비활성화')
  assert.equal(Number(await value('select remaining_annual_leave from employee_roster where profile_id=$1', [employee])), 5, '기본 연차 유지')
  console.log('extra-leave-save-notice: 실제 저장 RPC→이력→알림, 중복 재시도·수정·부여 취소·권한·기본 연차 보존 통과')
}
