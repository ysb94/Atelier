import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// Runs inside the existing in-memory PostgreSQL leave suite. No remote connection.
export async function prepareLeaveLoadGuard({db,value,company}) {
  await db.exec('reset role')
  const signature="'app.fefo_budget(uuid,date,boolean)'::regprocedure,'app.leave_advance_summary(uuid)'::regprocedure"
  const acl=()=>value(`select jsonb_agg(jsonb_build_object('oid',oid,'acl',proacl,'security',prosecdef,'config',proconfig) order by oid) from pg_proc where oid in (${signature})`)
  const originals=await db.query(`select proname,pg_get_functiondef(oid) definition from pg_proc where oid in (${signature})`)
  for (const row of originals.rows) {
    const definition=row.proname==='fefo_budget'
      ? (await readFile('supabase/migrations/20261029110752_leave_fefo_expiry_history.sql','utf8')).match(/create function app\.fefo_budget\([\s\S]*?end \$\$;/)[0]
      : row.definition
    await db.exec(definition.replaceAll(`app.${row.proname}(`,`app.test_original_${row.proname}(`)
      .replaceAll(`${row.proname}.period_key`,`test_original_${row.proname}.period_key`))
  }
  const snapshot=()=>value(`select jsonb_build_object('roster',(select jsonb_agg(to_jsonb(r) order by profile_id) from employee_roster r),
    'requests',(select jsonb_agg(to_jsonb(r) order by id) from company_leave_requests r),
    'periods',(select jsonb_agg(to_jsonb(r) order by employee_id,period_key) from app.leave_base_periods r),
    'grants',(select jsonb_agg(to_jsonb(r) order by id) from app.employee_extra_leave r),
    'allocations',(select jsonb_agg(to_jsonb(r) order by request_id) from app.leave_balance_entries r),
    'policies',(select jsonb_agg(to_jsonb(r) order by schemaname,tablename,policyname) from pg_policies r))`)
  const before=await snapshot(), aclBefore=await acl()
  await db.exec((await readFile('supabase/migrations/20261102102010_leave_refresh_load_guard.sql','utf8'))
    .replaceAll("(now() at time zone 'Asia/Seoul')::date","current_setting('test.today')::date"))
  assert.deepEqual(await snapshot(),before,'추가 보완 적용은 기존 직원·잔여·신청·배분·RLS를 변경하지 않음')
  assert.deepEqual(await acl(),aclBefore,'비공개 함수 OID·ACL·보안 속성 보존')
  return async () => {
    await db.exec('reset role')
    const all=await db.query(`select id,app.test_original_leave_advance_summary(id) old,app.leave_advance_summary(id) current from profiles order by id`)
    for (const row of all.rows) assert.deepEqual(row.current,row.old,`실제 회귀 시나리오 후 선사용 요약 일치: ${row.id}`)
    // The temporary employee is rolled back after date-boundary equivalence checks.
    await db.exec('begin')
    const person='94000000-0000-4000-8000-000000000001'
    await db.query("insert into profiles(id,company_id,status,display_name,hire_date) values($1,$2,'active','LOCAL ONLY','2026-01-31')",[person,company])
    await db.query("insert into app.employee_leave_accrual(employee_id,company_id,hire_date,cycle_start,cycle_end,calculated_grant,source_key) values($1,$2,'2026-01-31','2026-01-31','2027-01-31',0,'local-load-guard')",[person,company])
    const hires=['2020-02-29','2024-02-29','2025-01-31','2025-02-28','2025-12-31','2026-01-01','2026-01-31','2026-02-28','2026-03-30','2026-04-30','2026-09-30','2026-10-31']
    const dates=['2026-01-01','2026-01-31','2026-02-01','2026-02-28','2026-03-01','2026-03-31','2026-04-01','2026-10-29','2026-10-31','2026-11-01','2026-12-31','2027-01-01','2028-02-29']
    let cases=0
    for(const hire of hires) for(const date of dates) {
      if(date<hire) continue
      await db.query("select set_config('test.today',$1,true)",[date])
      await db.query(`update app.employee_leave_accrual a set hire_date=$2,cycle_start=c.starts_on,cycle_end=c.ends_on,calculated_grant=c.grant_days
        from app.employee_leave_cycle($2,$3) c where a.employee_id=$1`,[person,hire,date])
      for(const stale of [false,true]) {
        if(stale) await db.query('update app.employee_leave_accrual set calculated_grant=greatest(calculated_grant-1,0) where employee_id=$1',[person])
        const pair=(await db.query('select app.test_original_leave_advance_summary($1) old,app.leave_advance_summary($1) current',[person])).rows[0]
        assert.deepEqual(pair.current,pair.old,`다음 발생일/전체 요약 ${hire} / ${date} / 지연 ${stale}`)
        cases++
      }
    }
    await db.exec('rollback')
    // Counting writes (rather than timing) proves no-op captures avoid UPDATE.
    await db.exec(`create temporary table load_guard_writes(n int);
      create function app.test_count_budget_writes() returns trigger language plpgsql as $$begin insert into pg_temp.load_guard_writes values(1);return new;end$$;
      create trigger test_count_budget_writes after update on app.leave_base_periods for each row execute function app.test_count_budget_writes();`)
    const employees=await db.query(`select r.profile_id,a.cycle_start from employee_roster r left join app.employee_leave_accrual a on a.employee_id=r.profile_id where r.remaining_annual_leave is not null order by a.cycle_start nulls first,r.profile_id limit 8`)
    for(const row of employees.rows) {
      const date=row.cycle_start ?? await value("select current_setting('test.today')")
      const original=(await db.query('select period_key,ends_on::text,available from app.test_original_fefo_budget($1,$2,true)',[row.profile_id,date])).rows
      await db.exec('truncate load_guard_writes')
      for(let n=0;n<3;n++) assert.deepEqual((await db.query('select period_key,ends_on::text,available from app.fefo_budget($1,$2,true)',[row.profile_id,date])).rows,original)
      assert.equal(await value('select count(*)::int from load_guard_writes'),0,'동일 기준 캡처 3회에서 UPDATE 없음')
    }
    await db.exec('drop trigger test_count_budget_writes on app.leave_base_periods;drop function app.test_count_budget_writes();drop table load_guard_writes')
    console.log(`leave-load-guard: 기존 전체 연차 회귀 + ${cases}개 월말/윤년/초기화/지연 날짜 요약 일치, 반복 캡처 무쓰기, 원본·ACL·RLS 보존 통과`)
  }
}
