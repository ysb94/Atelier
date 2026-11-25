import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const db = await PGlite.create()
const ids = Object.fromEntries(['company','foreignCompany','admin','staff','employee','successor','other','broken','foreign',
  'department','employeeLogin','secondLogin','adminLogin','staffLogin','operatorLogin','request','pastRequest','ownWork','pastWork']
  .map(key => [key, randomUUID()]))

async function asUser(id, session = ids.adminLogin, role = 'authenticated') {
  await db.exec('reset role')
  await db.query("select set_config('test.actor',$1,false), set_config('test.session',$2,false)", [id, session])
  await db.exec(`set role ${role}`)
}

async function preview(employee = ids.employee) {
  return (await db.query('select public.preview_employee_departure($1) as result', [employee])).rows[0].result
}

async function confirm(version, command, employee = ids.employee, work = ids.successor, approval = ids.successor) {
  return (await db.query("select public.confirm_employee_departure($1, date '2026-11-25', $2, $3, $4, $5) as result",
    [employee, work, approval, version, command])).rows[0].result
}

try {
  await db.exec(`
    create role authenticated;
    create role anon;
    create role service_role;
    create schema auth;
    create schema app;
    grant usage on schema app to authenticated;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.actor',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('session_id',current_setting('test.session',true)) $$;
    create table auth.users(id uuid primary key,banned_until timestamptz);
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id));
    create table auth.refresh_tokens(user_id varchar,session_id uuid references auth.sessions(id) on delete cascade);
    create table auth.mfa_amr_claims(session_id uuid references auth.sessions(id) on delete cascade,authentication_method text);
    create table public.companies(id uuid primary key);
    create table public.departments(id uuid primary key,name text,is_active boolean default true);
    create table public.profiles(id uuid primary key,company_id uuid references public.companies(id),department_id uuid,
      display_name text,position text,status text,is_admin boolean default false,hire_date date);
    create table public.permission_grants(company_id uuid,profile_id uuid,permission text,scope_kind text,scope_id uuid);
    create table public.permission_grant_events(company_id uuid,actor_id uuid,profile_id uuid,permission text,scope_kind text,scope_id uuid,enabled boolean);
    create function app.permission_company_id() returns uuid language sql stable security definer as $$
      select company_id from public.profiles where id=auth.uid() and status='active' $$;
    create function app.permission_allowed(code text) returns boolean language sql stable security definer as $$
      select exists(select 1 from public.permission_grants where company_id=app.permission_company_id() and profile_id=auth.uid() and permission=code) $$;
    create function app.can_manage_personnel() returns boolean language sql stable security definer as $$
      select app.permission_allowed('personnel.manage') or exists(select 1 from public.profiles where id=auth.uid() and status='active' and is_admin) $$;
    create function app.assignment_manager() returns boolean language sql stable security definer as $$
      select app.permission_allowed('permissions.manage') or exists(select 1 from public.profiles where id=auth.uid() and status='active' and is_admin) $$;
    create function app.can_edit_org_assignment() returns boolean language sql stable as $$ select app.permission_allowed('approvers.manage') $$;
    create function app.work_manage_allowed(text) returns boolean language sql stable as $$ select app.permission_allowed('work.manage') $$;
    create function app.is_approved() returns boolean language sql stable as $$ select app.permission_company_id() is not null $$;
    create function app.is_company_manager() returns boolean language sql stable as $$ select false $$;
    create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at:=now();return new;end $$;
    create function app.work_department(code text) returns uuid language sql stable security definer as $$
      select id from public.departments where name=code $$;
    create table public.work_requests(id uuid primary key,company_id uuid,owner text,status text,data jsonb,revision bigint,updated_at timestamptz,requester_id uuid);
    create table public.work_request_time_entries(request_id uuid,profile_id uuid,accumulated_ms bigint,mounted_at timestamptz);
    create table public.work_request_settings(company_id uuid,owner text,supervisor_ids uuid[],categories jsonb,revision bigint,updated_at timestamptz,updated_by uuid);
    create table public.department_request_approvers(company_id uuid,department_id uuid,request_type text,approver_id uuid,
      substitute_id uuid,updated_by uuid,updated_at timestamptz,check (substitute_id is null or (approver_id is not null and approver_id<>substitute_id)));
    create table public.employee_roster(profile_id uuid primary key,company_id uuid,resigned_on date,note text);
    create table public.brand_members(profile_id uuid,brand_id uuid,is_lead boolean);
    create table public.profile_capabilities(profile_id uuid,capability text);
    create table public.access_ip_reviewers(profile_id uuid);
    create table public.impersonation_operators(profile_id uuid);
    create table public.impersonation_events(company_id uuid,operator_id uuid,target_id uuid,started_at timestamptz,ended_at timestamptz);
    create table public.china_work_assignees(company_id uuid,profile_id uuid);
    create table public.department_workforce_policies(company_id uuid,department_id uuid,contact_ids uuid[],version int,updated_by uuid,updated_at timestamptz);
    create publication supabase_realtime;
  `)
  await db.query('insert into public.companies values ($1),($2)', [ids.company, ids.foreignCompany])
  await db.query("insert into public.departments(id,name) values ($1,'design')", [ids.department])
  for (const person of ['admin','staff','employee','successor','other','broken','foreign']) {
    await db.query("insert into public.profiles values ($1,$2,$3,$4,'사원','active',$5,date '2026-03-01')",
      [ids[person], person === 'foreign' ? ids.foreignCompany : ids.company, ids.department, person, person === 'admin'])
    if (person !== 'broken') await db.query('insert into auth.users(id) values($1)', [ids[person]])
  }
  for (const [session, user, method] of [['adminLogin','admin','oauth'],['staffLogin','staff','oauth'],['operatorLogin','admin','otp'],
    ['employeeLogin','employee','oauth'],['secondLogin','employee','oauth']]) {
    await db.query('insert into auth.sessions values($1,$2)', [ids[session], ids[user]])
    await db.query('insert into auth.mfa_amr_claims values($1,$2)', [ids[session], method])
    await db.query('insert into auth.refresh_tokens values($1,$2)', [ids[user], ids[session]])
  }
  for (const [person, codes] of [['admin',['approvers.manage']],['staff',['personnel.manage']],['employee',['data.design','brand.edit']]]) {
    for (const code of codes) await db.query("insert into public.permission_grants values($1,$2,$3,'company',$1)", [ids.company, ids[person], code])
  }
  for (const migration of ['20260930160000_company_chat.sql','20261123090000_personal_work_cards.sql',
    '20261125023152_employee_departure.sql',
    '20261125032510_employee_departure_handover_inbox.sql']) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${migration}`, import.meta.url), 'utf8'))
  }
  function row(...names) { return names.map(name => ids[name]) }
  const requestData = { assignee: ids.employee, collaborators: [ids.employee, ids.successor],
    categoryAssignments: [{ categoryId:'banner', assigneeId:ids.employee }, { categoryId:'done', assigneeId:ids.employee }],
    visualCategoryWorkflow: { approverId:ids.employee, categories:{ banner:{ workerId:ids.employee, state:'working' }, done:{ workerId:ids.employee, state:'confirmed' } } },
    historicalActor: ids.employee }
  for (const [request, status] of [['request','inProgress'],['pastRequest','completed']]) {
    await db.query("insert into public.work_requests values($1,$2,'design',$3,$4::jsonb,1,now(),$5)",
      [ids[request], ids.company, status, JSON.stringify(requestData), ids.employee])
  }
  await db.query("insert into public.work_request_settings values($1,'design',array[$2,$3]::uuid[],'[]',1,now(),$4)", row('company','employee','successor','admin'))
  await db.query("insert into public.work_request_time_entries values($1,$2,60000,now()-interval '1 minute')", row('request','employee'))
  await db.query("insert into public.department_request_approvers values($1,$2,'leave',$3,$4,$5,now())", row('company','department','employee','successor','admin'))
  await db.query("insert into public.employee_roster values($1,$2,null,'명부 원본')", row('employee','company'))
  await db.query('insert into public.brand_members values($1,$2,true)', [ids.employee, randomUUID()])
  await db.query("insert into public.profile_capabilities values($1,'design');", [ids.employee])
  await db.query('insert into public.access_ip_reviewers values($1)', [ids.employee])
  await db.query('insert into public.impersonation_operators values($1)', [ids.employee])
  await db.query('insert into public.impersonation_events values($1,$2,$3,now(),null)', row('company','employee','other'))
  await db.query('insert into public.china_work_assignees values($1,$2)', row('company','employee'))
  await db.query('insert into public.department_workforce_policies values($1,$2,array[$3,$4]::uuid[],1,$5,now())',
    row('company','department','employee','other','admin'))

  await asUser(ids.employee, ids.employeeLogin)
  for (const [work,status] of [['ownWork','start'],['pastWork','complete']]) {
    await db.query("select public.personal_work_action($1,$2,'create',p_title=>'업무 원본')", [ids[work],randomUUID()])
    await db.query("select public.personal_work_action($1,$2,'start',1)", [ids[work],randomUUID()])
    if (status==='complete') await db.query("select public.personal_work_action($1,$2,'complete',2)", [ids[work],randomUUID()])
  }

  await asUser(ids.staff, ids.staffLogin)
  await assert.rejects(preview(), {code:'42501'})
  await asUser(ids.admin, ids.operatorLogin)
  await assert.rejects(preview(), {code:'42501'})
  await asUser(ids.admin, ids.adminLogin, 'anon')
  await assert.rejects(preview(), {code:'42501'})
  await asUser(ids.admin)
  await assert.rejects(preview(ids.admin), {code:'42501'})
  await assert.rejects(preview(ids.foreign), {code:'42501'})
  const broken = await preview(ids.broken)
  await assert.rejects(confirm(broken.version, randomUUID(), ids.broken, null, null), {code:'22023'})
  const initial = await preview()
  assert.deepEqual([initial.personalCount,initial.sentCount,initial.approvalCount], [1,1,1])
  assert.deepEqual(initial.requestGroups, [{count:1,owner:'design',departmentId:ids.department,settingsCount:1}])
  await assert.rejects(confirm('stale', randomUUID()), {code:'40001'})
  await assert.rejects(confirm(initial.version, randomUUID(), ids.employee, ids.foreign), {code:'22023'})
  const command = randomUUID()
  const completed = await confirm(initial.version, command, ids.employee, null, null)
  assert.deepEqual(await confirm(initial.version, command, ids.employee, null, null), completed)
  await assert.rejects(confirm(initial.version, randomUUID()), {code:'40001'})
  const pending = await preview()
  assert.equal(pending.processedAt, completed.processedAt)
  assert.deepEqual([pending.personalCount,pending.sentCount,pending.approvalCount], [1,1,1])
  assert.deepEqual(pending.requestGroups, initial.requestGroups)
  const handoverCommand = randomUUID()
  async function handover(work, approval, version, command, requests = {}) {
    return (await db.query('select public.handover_departed_employee_work($1,$2,$3,$4,$5,$6::jsonb) as result',
      [ids.employee,work,approval,version,command,JSON.stringify(requests)])).rows[0].result
  }
  const approvalSaved = await handover(null, ids.successor, pending.version, handoverCommand)
  assert.deepEqual([approvalSaved.approvalCount,approvalSaved.personalCount], [0,1])
  assert.deepEqual(await handover(null, ids.successor, pending.version, handoverCommand), approvalSaved)
  await assert.rejects(handover(ids.successor, null, approvalSaved.version, randomUUID(), {design:ids.foreign}),{code:'22023'})
  const allSaved = await handover(ids.successor, null, approvalSaved.version, randomUUID(), {design:ids.successor})
  assert.deepEqual([allSaved.personalCount,allSaved.sentCount,allSaved.approvalCount], [0,0,0])
  assert.deepEqual(allSaved.requestGroups, [])

  await db.exec('reset role')
  async function scalar(sql, args = []) { return Object.values((await db.query(sql,args)).rows[0])[0] }
  assert.equal(await scalar('select status from public.profiles where id=$1',[ids.broken]),'active')
  assert.equal(await scalar('select status from public.profiles where id=$1',[ids.employee]),'disabled')
  assert.equal(await scalar('select note from public.employee_roster where profile_id=$1',[ids.employee]),'명부 원본')
  assert.equal(await scalar("select banned_until>now()+interval '90 years' from auth.users where id=$1",[ids.employee]),true)
  assert.equal(await scalar('select count(*)::int from auth.sessions where user_id=$1',[ids.employee]),0)
  assert.equal(await scalar('select count(*)::int from auth.refresh_tokens where user_id=$1',[ids.employee]),0)
  assert.equal(await scalar('select count(*)::int from auth.sessions where user_id=$1',[ids.admin]),2)
  assert.equal(await scalar('select count(*)::int from app.employee_departure_handover_events where employee_id=$1',[ids.employee]),2)
  for (const table of ['permission_grants','brand_members','profile_capabilities','access_ip_reviewers','impersonation_operators','china_work_assignees']) {
    assert.equal(await scalar(`select count(*)::int from public.${table} where profile_id=$1`,[ids.employee]),0,table)
  }
  assert.equal(await scalar('select count(*)::int from public.permission_grant_events where profile_id=$1 and not enabled',[ids.employee]),2)
  assert.equal(await scalar('select count(*)::int from public.permission_grants where profile_id=$1',[ids.successor]),0)
  assert.deepEqual(await scalar('select contact_ids from public.department_workforce_policies'),[ids.other])
  assert.equal(await scalar('select approver_id from public.department_request_approvers'),ids.successor)
  assert.equal(await scalar('select substitute_id from public.department_request_approvers'),null)
  assert.equal(await scalar('select mounted_at from public.work_request_time_entries'),null)
  const transferred = await scalar('select data from public.work_requests where id=$1',[ids.request])
  assert.equal(transferred.assignee,ids.successor)
  assert.deepEqual(transferred.collaborators,[ids.successor])
  assert.equal(transferred.categoryAssignments[0].assigneeId,ids.successor)
  assert.equal(transferred.categoryAssignments[1].assigneeId,ids.employee)
  assert.equal(transferred.visualCategoryWorkflow.categories.banner.workerId,ids.successor)
  assert.equal(transferred.historicalActor,ids.employee)
  assert.deepEqual(await scalar('select data from public.work_requests where id=$1',[ids.pastRequest]),requestData)
  assert.equal(await scalar('select requester_id from public.work_requests where id=$1',[ids.pastRequest]),ids.employee)
  assert.equal(await scalar('select requester_id from public.work_requests where id=$1',[ids.request]),ids.successor)
  assert.equal(await scalar('select assignee_id from app.personal_work_cards where id=$1',[ids.pastWork]),ids.employee)
  await assert.rejects(db.query("update public.profiles set status='active' where id=$1",[ids.employee]),{code:'42501'})

  await asUser(ids.employee, ids.employeeLogin)
  assert.equal(await scalar('select count(*)::int from public.employee_departure_signals'),1)
  assert.deepEqual(await scalar('select public.list_personal_work_cards()'),[])
  await asUser(ids.successor,randomUUID())
  assert.equal(await scalar('select count(*)::int from public.employee_departure_signals'),0)
  const card = (await scalar('select public.list_personal_work_cards()'))[0]
  assert.deepEqual([card.id,card.created_by,card.owner_id,card.assignee_id,card.status,card.events.at(-1).kind],
    [ids.ownWork,ids.employee,ids.successor,ids.successor,'todo','paused'])
  await db.query("select public.personal_work_action($1,$2,'start',$3)",[ids.ownWork,randomUUID(),card.revision])
  await db.query("select public.personal_work_action($1,$2,'complete',$3)",[ids.ownWork,randomUUID(),card.revision+1])

  // This departure belongs to the configured primary approver. Its substitute
  // gets the case, handles one card immediately and recommends the new approver.
  const workFirst = randomUUID(), workSecond = randomUUID()
  await asUser(ids.other,randomUUID())
  for (const id of [workFirst,workSecond]) await db.query("select public.personal_work_action($1,$2,'create',p_title=>'인계 대상 카드')",[id,randomUUID()])
  await db.exec('reset role')
  await db.query('update public.department_request_approvers set approver_id=$1,substitute_id=$2,updated_at=now()',row('other','staff'))
  await asUser(ids.admin)
  await confirm((await preview(ids.other)).version,randomUUID(),ids.other,null,null)
  const listInbox = () => scalar('select public.list_departure_handover_notices()')
  const readPerson = version => scalar('select public.read_departure_handover($1,$2)',[ids.other,version])
  const personDetail = () => scalar('select public.get_departure_handover($1)',[ids.other])
  const savePerson = (revision,choices,command=randomUUID()) => scalar('select public.save_departure_handover($1,$2,$3::jsonb,$4)',
    [ids.other,revision,JSON.stringify(choices),command])

  await asUser(ids.admin,ids.operatorLogin)
  assert.deepEqual(await listInbox(),[])
  await assert.rejects(personDetail(),{code:'42501'})
  await asUser(ids.admin)
  await assert.rejects(personDetail(),{code:'42501'})
  assert.equal(await scalar('select count(*)::int from public.departure_handover_signals'),0)
  await assert.rejects(scalar('select count(*)::int from app.departure_handover_cases'),{code:'42501'})
  await asUser(ids.staff,ids.staffLogin)
  assert.equal(await scalar('select recipient_id from public.departure_handover_signals'),ids.staff)
  const [inbox] = await listInbox()
  assert.deepEqual([inbox.id,inbox.pending,inbox.readAt,inbox.review],[ids.other,3,null,false])
  assert.equal(await readPerson('old-version'),null)
  const firstDetail = await personDetail()
  const readAt = await readPerson(firstDetail.version)
  assert.equal(Math.floor(Date.parse((await listInbox())[0].readAt)/1000),Math.floor(Date.parse(readAt)/1000))
  const approvalKey = `approvals/${ids.department}`
  const selectedKey = `personal/${workFirst}`
  const partial = {[selectedKey]:ids.successor,[approvalKey]:ids.successor}
  await assert.rejects(savePerson('stale',partial),{code:'40001'})
  await assert.rejects(savePerson(firstDetail.revision,{[selectedKey]:ids.foreign}),{code:'22023'})
  const partialCommand = randomUUID()
  assert.deepEqual(await savePerson(firstDetail.revision,partial,partialCommand),{applied:1,recommended:1})
  assert.deepEqual(await savePerson(firstDetail.revision,partial,partialCommand),{duplicate:true})
  assert.equal((await listInbox())[0].pending,2)
  assert.deepEqual((await personDetail()).items.map(i=>i.key).sort(),[approvalKey,`personal/${workSecond}`].sort())

  await asUser(ids.admin)
  assert.deepEqual((await listInbox()).map(i=>[i.id,i.review,i.pending]),[[ids.other,true,1]])
  const recommendation = await personDetail()
  assert.equal(recommendation.items[0].suggestedId,ids.successor)
  assert.deepEqual(await savePerson(recommendation.revision,{[approvalKey]:ids.successor}),{applied:1,recommended:0})
  await asUser(ids.staff,ids.staffLogin)
  const finalItem = await personDetail()
  assert.equal((await listInbox())[0].pending,1)
  await savePerson(finalItem.revision,{[finalItem.items[0].key]:ids.successor})
  assert.deepEqual((await listInbox()).map(i=>[i.id,i.pending]),[[ids.other,0]])
  await db.exec('reset role')
  assert.equal(await scalar('select approver_id from public.department_request_approvers'),ids.successor)
  assert.equal(await scalar('select app.departure_handover_coordinator($1,$2,$3)',[ids.company,ids.department,ids.other]),ids.successor)
  assert.equal(await scalar('select app.departure_handover_coordinator($1,null,$2)',[ids.company,ids.other]),null)
  console.log('직원 퇴사 DB 검증 통과 · 세션·권한 회수, 승인자·대체 승인자, 알림 권한, 부분 인계와 후임 확인, 롤백·재시도')
} catch (error) {
  console.error(error.message,error.code ?? '',error.where ?? '')
  process.exitCode=1
} finally {
  await db.close()
}
