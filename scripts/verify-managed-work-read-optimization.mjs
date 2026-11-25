import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

// Private in-memory PostgreSQL. Use the repository's actual SQL for both
// readers under test, the effective-clock lookup, and the staff-scope helper.
const db = await PGlite.create()
const migration = (name) => readFile(new URL('../supabase/migrations/' + name + '.sql', import.meta.url), 'utf8')
const id = n => '90000000-0000-4000-8000-' + String(n).padStart(12, '0')
const reader = 'select public.list_my_managed_work_notifications()'
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0]
async function actor(n) {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id(n)])
  await db.exec('set role authenticated')
}
function functionDdl(source, name) {
  const marker = new RegExp('create (?:or replace )?function ' + name.replace('.', '\\.') + '\\(', 'i')
  const start = source.search(marker)
  assert.notEqual(start, -1, name)
  const end = source.indexOf('$$;', source.indexOf('$$', start) + 2)
  assert.notEqual(end, -1, name)
  return source.slice(start, end + 3)
}

async function bootstrap() {
  await db.exec(await readFile(new URL('./fixtures/managed-work-read-optimization.sql', import.meta.url), 'utf8'))
  const queue = await migration('20261102081715_my_home_notification_queue')
  const scope = await migration('20261105123000_department_workforce_management')
  const clocks = await migration('20261102063022_offsite_attendance_automation')
  const approvals = await migration('20261112042007_operations_leave_advance_approval')
  const departments = await migration('20261008074142_department_request_approvers')
  await db.exec(departments.slice(0, departments.indexOf('-- The private trigger')))
  await db.exec(functionDdl(departments, 'app.is_department_request_approver'))
  await db.exec(`insert into department_request_approvers(company_id,department_id,request_type,approver_id,substitute_id)
    select company_id,id,kind,fixture_id(2),fixture_id(25) from departments cross join (values ('leave'),('overtime')) as kinds(kind)`)
  await db.exec(functionDdl(clocks, 'public.list_effective_attendance_clocks'))
  await db.exec(functionDdl(approvals, 'public.list_my_approval_requests'))
  await db.exec(queue.slice(0, queue.indexOf('-- Both changing a schedule')))
  await db.exec(functionDdl(queue, 'public.list_my_home_work_notifications')
    .replace('public.list_my_home_work_notifications()', 'app.list_my_home_work_notifications_before_offsite()'))
  for (const name of ['app.department_workforce_mode','app.workforce_mode','app.hr_notice_target_in_scope',
    'app.list_my_managed_work_notifications','public.list_my_managed_work_notifications']) await db.exec(functionDdl(scope, name))
  // Additional source families are represented by already-delivered event
  // payloads. Their dispatch/write logic is outside both changed SQL functions.
  await db.exec(`create or replace function public.list_my_home_work_notifications() returns jsonb language sql stable security invoker set search_path='' as $$
    select app.list_my_home_work_notifications_before_offsite() ||
      coalesce((select jsonb_agg(payload order by ordinal) from public.fixture_deliveries where recipient=auth.uid()),'[]'::jsonb)
    $$;
    revoke all on function public.list_my_home_work_notifications(),public.read_my_home_work_notification(text),
      app.workforce_mode(uuid),app.department_workforce_mode(uuid,uuid),
      app.hr_notice_target_in_scope(uuid,text),app.list_my_home_work_notifications_before_offsite(),
      app.list_my_managed_work_notifications(),public.list_my_managed_work_notifications() from public,anon,authenticated;
    grant execute on function public.list_my_home_work_notifications(),public.read_my_home_work_notification(text),
      app.hr_notice_target_in_scope(uuid,text),app.list_my_home_work_notifications_before_offsite(),
      app.list_my_managed_work_notifications(),public.list_my_managed_work_notifications() to authenticated;
    update company_leave_requests set status='approved' where kind='overtime' and (right(id::text,2)::int % 4=0);
    insert into my_home_notification_reads(reader_id,event_key,read_at)
      select '${id(2)}','request-approval:'||id,'2026-11-25 09:00Z' from company_leave_requests where status='pending' and right(id::text,2)::int % 5=0;
    analyze;`)
}

async function fingerprint() {
  await db.exec('reset role')
  const hashes = {}
  for (const table of ['companies','departments','profiles','company_leave_requests','attendance_clock_ins','attendance_exemptions',
    'my_home_notification_reads','my_home_request_events','fixture_deliveries','department_workforce_policies','department_request_approvers','app.holiday_work_days']) {
    hashes[table] = await scalar(`select md5(coalesce(jsonb_agg(t order by to_jsonb(t)::text)::text,'')) from ${table} t`)
  }
  hashes.roles = await scalar(`select md5(jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname)::text) from pg_policies p`)
  hashes.privileges = await scalar(`select md5(jsonb_agg(jsonb_build_array(oid,proowner,proacl,prosecdef,provolatile,proconfig) order by oid)::text)
    from pg_proc where pronamespace in ('app'::regnamespace,'public'::regnamespace)`)
  hashes.tables = await scalar(`select md5(jsonb_agg(jsonb_build_array(oid,relowner,relacl,relrowsecurity,relforcerowsecurity) order by oid)::text)
    from pg_class where relkind in ('r','p') and relnamespace in ('app'::regnamespace,'public'::regnamespace)`)
  return hashes
}

const checkouts = rows => rows.filter(item => item.event_type === 'checkout').map(item => item.from_date)
const aggregate = rows => ({
  unread: rows.filter(r => r.current !== false && r.read_at == null).length,
  pending: new Set(rows.filter(r => r.current !== false && r.action_needed).map(r => r.action_key ?? 'request:'+r.entity_id)).size,
})
async function scenarios() {
  const result = {}
  await db.exec('reset role; savepoint transitions')
  for (const n of [1, 2, 3, 4, 5, 6, 25]) {
    await actor(n)
    const rows = await scalar(reader)
    result['account'+n] = rows
    result['badges'+n] = aggregate(rows)
  }
  assert.equal(result.account5.length, 0, 'unrelated company')
  assert.equal(result.account6.length, 0, 'unrelated peer')
  assert.ok(result.account1.some(r => r.event_type==='result'))
  assert.ok(result.account2.some(r => r.read_at && r.action_needed))
  assert.ok(result.account25.some(r => r.event_type==='approval' && r.action_needed), 'substitute approver')
  assert.ok(result.account2.some(r => r.event_key==='holiday-visible'))
  assert.ok(!result.account2.some(r => ['external','logistics'].includes(r.event_key)))
  assert.equal(result.account2.filter(r => r.event_key.startsWith('holiday-version-')).length,12)
  assert.ok(result.account2.some(r => r.event_key==='legacy-null'))
  assert.ok(result.account2.some(r => r.event_key==='legacy-invalid'))
  assert.equal(checkouts(result.account3).length, 0, 'logistics checkout hidden')
  assert.equal(checkouts(result.account4).length, 0, 'external checkout hidden')
  await actor(7)
  for (const deniedRole of ['authenticated','anon']) {
    await db.exec('reset role;set role '+deniedRole+';savepoint denied')
    await assert.rejects(() => db.query(reader), error => error.code === '42501')
    await db.exec('rollback to denied;release denied')
  }

  await actor(1)
  const date = n => scalar('select (fixture_today()-$1::integer)::text',[n])
  const expected = [await date(1),await date(4)].sort()
  assert.deepEqual(checkouts(result.account1).sort(), expected, 'open last raw day and earlier auto-closed day; offsite overtime closes third day')
  const item = result.account1.find(r=>r.event_type==='checkout')
  await db.query('select public.read_my_home_work_notification($1)',[item.event_key])
  assert.ok((await scalar(reader)).find(r=>r.event_key===item.event_key)?.read_at)
  // The business read was performed through the authenticating RPC. Freeze
  // only its generated timestamp so the two independent executions compare.
  await db.exec(`reset role;update my_home_notification_reads set read_at='2026-11-25 12:00Z'
    where reader_id=fixture_id(1) and event_key like 'checkout:%'`)
  await actor(1); result.afterRead=await scalar(reader)
  assert.equal(aggregate(result.afterRead).pending, result.badges1.pending)
  assert.equal(aggregate(result.afterRead).unread, result.badges1.unread-1)
  await db.exec(`reset role;
    delete from attendance_clock_ins where employee_id=fixture_id(1) and work_date=fixture_today()-1;
    update attendance_clock_ins set clock_out_at=null where employee_id=fixture_id(1) and work_date=fixture_today()-2;
    insert into company_leave_requests(id,company_id,employee_id,department_id,kind,status,from_date,to_date)
      select fixture_id(501),company_id,id,department_id,'correction','approved',fixture_today()-1,fixture_today()-1 from profiles where id=fixture_id(1)`)
  await actor(1);result.syntheticPrior=await scalar(reader)
  assert.deepEqual(checkouts(result.syntheticPrior), [await date(4)], 'synthetic approved clock is newest prior day')
  await db.exec("reset role;update company_leave_requests set status='rejected' where id=fixture_id(501)")
  await actor(1);result.rejectedPrior=await scalar(reader)
  assert.deepEqual(checkouts(result.rejectedPrior).sort(), [await date(2),await date(4)].sort())
  await db.exec(`reset role;update company_leave_requests set status='pending',from_date=fixture_today()-4 where id=fixture_id(501)`)
  await actor(1);result.pendingCorrection=await scalar(reader)
  assert.deepEqual(checkouts(result.pendingCorrection), [await date(2)], 'pending correction hides old checkout')
  await db.exec('reset role;insert into attendance_exemptions values(fixture_id(1))')
  await actor(1);result.exempt=await scalar(reader)
  assert.equal(checkouts(result.exempt).length, 0)

  await db.exec(`reset role;delete from attendance_exemptions where profile_id=fixture_id(1);
    update attendance_clock_ins set clock_out_at=null,auto_closed_at=now(),clock_in_source='offsite',
      clock_out_source=null,offsite_returned_at=((fixture_today()-3)+time '14:00') at time zone 'Asia/Seoul'
      where employee_id=fixture_id(1) and work_date=fixture_today()-3`)
  await actor(1);result.officeReturn=await scalar(reader)
  assert.ok(checkouts(result.officeReturn).includes(await date(3)),'office return does not close the workday')
  await db.exec(`reset role;insert into company_leave_requests(id,company_id,employee_id,department_id,kind,status,from_date,to_date,end_time,decided_at)
    select fixture_id(502),company_id,id,department_id,'correction','approved',fixture_today()-3,fixture_today()-3,'13:00',
      ((fixture_today()-3)+time '13:00') at time zone 'Asia/Seoul' from profiles where id=fixture_id(1)`)
  const finalTime = () => scalar(`select (clock_out_at at time zone 'Asia/Seoul')::time::text
    from public.list_effective_attendance_clocks(fixture_today()-3,fixture_today()-3,fixture_id(1))`)
  await actor(1);result.correctionBeforeReturn=await scalar(reader)
  assert.equal(await finalTime(),null,'older correction stays superseded by office return')
  assert.ok(!checkouts(result.correctionBeforeReturn).includes(await date(3)))
  await db.exec(`reset role;update attendance_clock_ins set clock_out_source='manual',
    clock_out_at=((fixture_today()-3)+time '18:00') at time zone 'Asia/Seoul' where employee_id=fixture_id(1) and work_date=fixture_today()-3`)
  await actor(1);assert.equal(await finalTime(),'18:00:00')
  await db.exec(`reset role;update company_leave_requests set end_time='18:30',
    decided_at=((fixture_today()-3)+time '19:00') at time zone 'Asia/Seoul' where id=fixture_id(502)`)
  await actor(1);assert.equal(await finalTime(),'18:30:00')
  result.correctionAfterReturn=await scalar(reader)
  assert.ok(!checkouts(result.correctionAfterReturn).includes(await date(3)))

  // The approval source also returns a former decider's own decisions.
  // The managed list must still require current primary/substitute authority.
  await db.exec(`reset role;
    update company_leave_requests set decided_by=fixture_id(25) where id=fixture_id(1012);
    insert into my_home_notification_reads(reader_id,event_key,read_at)
      values(fixture_id(25),'request-approval:'||fixture_id(1012),'2026-11-25 15:00Z');
    update department_request_approvers set substitute_id=null`)
  await actor(25);result.formerApprover=await scalar(reader)
  assert.ok(await scalar('select exists(select 1 from public.list_my_approval_requests() where id=fixture_id(1012))'))
  assert.equal(result.formerApprover.filter(r => r.event_type==='approval').length,0)
  await db.exec('reset role;rollback to transitions;release transitions')
  return result
}

async function measure(n, count) {
  await actor(n)
  for (let i=0;i<4;i++) await scalar(reader)
  const measurements=[]
  for (let i=0;i<count;i++) {
    const plan=await scalar('explain (analyze,format json,timing off) '+reader)
    measurements.push(plan[0]['Execution Time'])
  }
  await db.exec('reset role')
  return measurements
}
function distribution(values) {
  const sorted=values.toSorted((a,b)=>a-b)
  const quantile = q => Number(sorted[Math.ceil(q*sorted.length)-1].toFixed(2))
  return {samples:sorted.length,medianMs:quantile(.5),p95Ms:quantile(.95)}
}
try {
  await bootstrap()
  // A single transaction freezes now() for all real source queries.
  await db.exec('begin')
  const original=await fingerprint()
  const before=await scenarios()
  const sql=await migration('20261126010000_optimize_managed_work_notification_reads')
  const initial=[await measure(1,20),await measure(2,20)]
  await db.exec('savepoint optimization')
  await db.exec(sql)
  assert.deepEqual(await fingerprint(),original,'records, read receipts, grants, owners, RLS policies and caller modes')
  assert.deepEqual(await scenarios(),before,'all ordered JSON, state transitions and summaries')
  const after=[await measure(1,40),await measure(2,40)]
  await db.exec('rollback to optimization')
  const final=[await measure(1,20),await measure(2,20)]
  for (const [i,role] of ['employee','approver'].entries()) {
    const account=i+1
    console.info(JSON.stringify({role,rows:before['account'+account].length, ...before['badges'+account],
      before:distribution(initial[i].concat(final[i])),after:distribution(after[i])}))
  }
  await db.exec('rollback')
  console.info('PASS • managed work notifications: result versions, staff scope, badges, read/write isolation, corrected and historical checkouts')
} finally {
  await db.close()
}
