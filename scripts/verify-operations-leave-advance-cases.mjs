import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

export async function verifyOperationsLeaveAdvances({ db, actor, value, company, foreign, dept, approver, init, today, base, summary }) {
  const opsDepartment = '2e49ef43-75b9-4c89-b42d-9fd50ad9087b'
  const reviewer = '91000000-0000-4000-8000-000000000002'
  const otherReviewer = '91000000-0000-4000-8000-000000000003'
  const excludedDepartment = '91000000-0000-4000-8000-000000000004'
  const annual = await init(1)
  const monthly = await init(0, '2026-09-30')
  const employeeReviewer = await init(0)
  await db.exec(`
    alter table departments add column company_id uuid, add column is_active boolean not null default true;
    update departments set company_id='${company}';
    insert into departments(id,name,company_id) values
      ('${opsDepartment}','운영지원','${company}'),('${excludedDepartment}','본사 관리 제외','${company}');
    insert into profiles(id,company_id,department_id,status,display_name) values
      ('${reviewer}','${company}','${opsDepartment}','active','운영지원 검토자'),
      ('${otherReviewer}','${company}','${opsDepartment}','active','운영지원 동료');
    update profiles set department_id='${opsDepartment}' where id='${employeeReviewer}';
    create function app.workforce_mode(p_employee uuid) returns text language sql stable as $$
      select case when department_id='${excludedDepartment}' then 'external' else 'head-office' end from public.profiles where id=p_employee
    $$;
    create table public.attendance_exemptions(profile_id uuid);
    grant select on public.attendance_exemptions to authenticated;
    create function public.list_effective_attendance_clocks(date,date,uuid)
    returns table(employee_id uuid, work_date date, clock_in time, clock_out_at timestamptz, auto_closed_at timestamptz)
    language sql stable as $$select null::uuid, null::date, null::time, null::timestamptz, null::timestamptz where false$$;
  `)
  const operationsAccess = await readFile('supabase/migrations/20261105041100_operations_access_approval.sql', 'utf8')
  await db.exec(operationsAccess.split('create or replace function app.operations_may_decide_access')[0])
  await db.exec(await readFile('supabase/migrations/20261102081715_my_home_notification_queue.sql', 'utf8'))
  const snapshot = () => value(`select md5(jsonb_build_object(
    'roster',(select jsonb_agg(r order by profile_id) from public.employee_roster r),
    'requests',(select jsonb_agg(r order by id) from public.company_leave_requests r),
    'advance',(select jsonb_agg(a order by id) from app.leave_advance_authorizations a),
    'reads',(select jsonb_agg(h order by reader_id,event_key) from public.my_home_notification_reads h),
    'policies',(select jsonb_agg(p order by schemaname,tablename,policyname) from pg_policies p where p.policyname not in ('leave_advance_operations_read','leave_advance_operations_decide')),
    'grants',(select jsonb_agg(c.relacl order by c.relname) from pg_class c where c.relnamespace in ('public'::regnamespace,'app'::regnamespace) and c.relkind='r')
  )::text)`)
  const before = await snapshot()
  const migration = await readFile('supabase/migrations/20261112024148_operations_leave_advance_approval.sql', 'utf8')
  await db.exec(migration.replace(/\r?\n/g, '\r\n'))
  assert.equal(await snapshot(), before, '기존 데이터·RLS·테이블 권한 보존')

  const notices = () => value('select public.list_my_home_work_notifications()')
  async function submit(employee, { from = '2026-10-29', to = from, kind = 'annual', advance = true, reason = '가족 일정' } = {}) {
    await actor(employee)
    return (await db.query(`insert into public.company_leave_requests(employee_id,company_id,kind,from_date,to_date,start_time,end_time,note,place,advance_requested)
      values($1,$2,$3,$4,$5,'09:00',$6,$7,'',$8) returning *`,
    [employee, company, kind, from, to, kind === 'half' ? '14:00' : '18:00', reason, advance])).rows[0]
  }
  async function decide(by, id, status = 'approved', note = '사유 확인') {
    await actor(by)
    return (await db.query('update public.company_leave_requests set status=$2,decision_note=$3 where id=$1 returning *',[id,status,note])).rows
  }
  assert.equal((await summary(annual)).limit, 0, '사전 한도 없음')
  await assert.rejects(() => submit(annual, { reason: '' }), /사유/)
  const request = await submit(annual, { to: '2026-11-02' })
  const key = `request-approval:${request.id}`
  assert.equal(request.status, 'pending')
  assert.equal(await base(annual), 1, '승인 대기 중 차감 없음')
  await actor(approver)
  assert.ok(!(await notices()).some(item => item.event_key === key))
  assert.equal(await value('select count(*)::int from public.list_my_approval_requests() where id=$1',[request.id]), 0)
  await assert.rejects(() => decide(approver, request.id), /운영지원/)
  assert.equal((await decide(foreign, request.id)).length, 0)
  await assert.rejects(() => decide(annual, request.id), /본인|운영지원/)

  await actor(reviewer)
  assert.equal(await value('select app.can_edit_org_assignment()'), false, '운영지원 소속 검토자는 조직 편집 권한 없음')
  assert.equal(await value('select note from public.company_leave_requests where id=$1',[request.id]), '가족 일정')
  assert.equal(await value('select count(*)::int from public.company_leave_requests where employee_id=$1 and not advance_requested',[annual]), 0)
  const notice = (await notices()).find(item => item.event_key === key)
  assert.equal(notice?.tab, 'operations-leave')
  assert.equal(notice?.action_needed, true)
  assert.equal(notice?.read_at, null)
  await db.query('select public.read_my_home_work_notification($1)',[key])
  assert.ok((await notices()).find(item => item.event_key === key)?.read_at)
  assert.equal((await notices()).find(item => item.event_key === key)?.action_needed, true)

  assert.equal((await decide(reviewer, request.id))[0]?.status, 'approved')
  assert.equal((await notices()).find(item => item.event_key === key)?.action_needed, false)
  assert.equal((await decide(otherReviewer, request.id)).length, 0)
  assert.ok(!(await notices()).some(item => item.event_key === key))
  await actor(annual)
  const employeeNotices = await notices()
  assert.equal(employeeNotices.filter(item => item.event_type === 'result' && item.entity_id === request.id && item.status === 'approved').length, 1)
  const personal = await value('select public.employee_leave_advances(false)')
  assert.equal(personal.approvalMode, 'operations')
  assert.deepEqual(personal.employees.map(employee => employee.employeeId), [annual])
  assert.equal(await base(annual), -2, '1일 잔여에서 3일 승인 시 실제 부족분 2일')
  assert.equal(Number((await summary(annual)).outstanding), 2)
  await today('2026-11-04')
  await db.query("select app.refresh_employee_leave($1,'2026-11-04')",[annual])
  assert.equal(await base(annual), 13, '다음 기념일 기본 연차에서 2일 정산')
  assert.equal(Number((await summary(annual)).outstanding), 0)
  const direct = await submit(annual, { from: '2026-11-04', advance: false })
  assert.equal(direct.status, 'approved', '일반 연차 즉시 등록')
  assert.equal(await base(annual), 12)
  await actor(reviewer)
  assert.equal(await value('select count(*)::int from public.company_leave_requests where id=$1',[direct.id]), 0, '선사용 권한으로 일반 신청을 열 수 없음')

  await today('2026-10-29')
  const fullDay = await submit(monthly)
  const halfDay = await submit(monthly, { from: '2026-10-30', kind: 'half' })
  await decide(reviewer, fullDay.id)
  await decide(reviewer, halfDay.id)
  assert.equal(await base(monthly), -1.5)
  await today('2026-10-31')
  await db.query("select app.refresh_employee_leave($1,'2026-10-31')",[monthly])
  assert.equal(await base(monthly), -0.5)
  assert.equal(Number((await summary(monthly)).outstanding), 0.5)
  await today('2026-12-01')
  await db.query("select app.refresh_employee_leave($1,'2026-12-01')",[monthly])
  assert.equal(await base(monthly), 0.5)
  assert.equal(Number((await summary(monthly)).outstanding), 0)
  const installments = await value("select array_agg(days::float8 order by created_at,id) from app.leave_advance_events where employee_id=$1 and kind='monthly_settled'",[monthly])
  assert.deepEqual(installments, [1, 0.5])

  await today('2026-10-29')
  const ownRequest = await submit(employeeReviewer)
  assert.ok(!(await notices()).some(item => item.event_key === `request-approval:${ownRequest.id}`))
  await assert.rejects(() => decide(employeeReviewer, ownRequest.id), /본인|운영지원/)
  await assert.rejects(() => decide(reviewer, ownRequest.id, 'rejected', ''), /반려 사유/)
  await db.exec('reset role')
  await db.query('update profiles set department_id=$1 where id=$2',[excludedDepartment,employeeReviewer])
  assert.equal((await decide(reviewer, ownRequest.id)).length, 0, '본사 관리에서 제외한 직원의 신청은 운영지원 승인 범위 밖')
  await db.exec('reset role')
  await db.query('update profiles set department_id=$1 where id=$2',[dept,employeeReviewer])
  assert.equal((await decide(reviewer, ownRequest.id, 'rejected'))[0]?.status, 'rejected')
  assert.equal(await base(employeeReviewer), 0)
  console.log('operations-leave-advance: 무한도 신청·운영지원 권한·알림/읽음·중복 방지·기념일과 월 발생 정산·즉시 일반 등록·기존 데이터/권한 보존 통과')
}
