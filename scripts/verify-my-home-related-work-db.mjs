import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createWorkTestDb, ids, departments } from './work-request-test-db.mjs'

const db = await createWorkTestDb()
const company = 'e0000000-0000-4000-8000-000000000001'
const migration = '20261126115127_my_home_related_work'
async function actor(id, role = 'authenticated') {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id])
  await db.exec('set role ' + role)
}
async function list(id, view = 'feedback', cursor = null) {
  await actor(id)
  return (await db.query('select public.list_my_home_related_work($1,$2,$3) as data', [view, cursor?.at ?? null, cursor?.key ?? null])).rows[0].data
}
async function work({ title, status = 'inProgress', requester = ids.planner, owner = 'planning', data = {}, kind = 'request', otherCompany = false }) {
  await db.exec('reset role')
  const id = crypto.randomUUID()
  await db.query('insert into public.work_requests(id,company_id,owner,requester_id,status,data,kind) values($1,$2,$3,$4,$5,$6,$7)',
    [id, otherCompany ? 'e0000000-0000-4000-8000-000000000002' : company, owner, requester, status,
      { values: { title, blocks: [{ text: '본문은 요약에 노출하지 않음' }] }, assignee: ids.planner2, collaborators: [], ...data }, kind])
  return id
}
async function personal({ owner = ids.planner, worker = ids.planner2, reviewer = ids.planner, status = 'feedback', handover = null, deleted = false } = {}) {
  await db.exec('reset role')
  const id = crypto.randomUUID()
  await db.query(`insert into app.personal_work_cards(id,company_id,created_by,assignee_id,reviewer_id,title,description,status,
    round,revision,created_at,updated_at,create_command,last_command,last_actor,handover_owner_id,deleted_at)
    values($1,$2,$3,$4,$5,'개인 업무','비공개 본문',$6,1,4,now(),now(),gen_random_uuid(),gen_random_uuid(),$3,$7,$8)`,
    [id, company, owner, worker, reviewer, status, handover, deleted ? new Date() : null])
  return id
}
try {
  await db.query("insert into public.companies(id) values('e0000000-0000-4000-8000-000000000002')")
  for (const name of ['20261102034546_work_request_category_settings', '20261102043240_work_request_explicit_managers',
    '20261102093634_department_work_board', '20261102114206_work_request_cancellation',
    '20261109052445_visual_work_category_comments', '20261109062457_visual_work_final_approval',
    '20261109074511_visual_category_workflow', '20261109192913_visual_assignment_history_visibility',
    '20261123090000_personal_work_cards', '20261125065330_personal_work_feedback_notifications']) {
    await db.exec(await readFile(`supabase/migrations/${name}.sql`, 'utf8'))
  }
  // Current production schema adds this through employee departure; no departure writes are exercised here.
  await db.exec('alter table app.personal_work_cards add column handover_owner_id uuid references public.profiles(id)')
  const originalFunctions = (await db.query("select oid,proowner,proacl,proconfig,prosrc from pg_proc where pronamespace='app'::regnamespace order by oid")).rows
  await db.exec(await readFile(`supabase/migrations/${migration}.sql`, 'utf8'))
  const access = (await db.query(`select n.nspname,p.prosecdef,p.proconfig,
    has_function_privilege('anon',p.oid,'execute') as anon,has_function_privilege('authenticated',p.oid,'execute') as authenticated
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname='list_my_home_related_work' order by n.nspname`)).rows
  assert.deepEqual(access.map(row => [row.nspname, row.prosecdef, row.anon, row.authenticated]),
    [['app', true, false, true], ['public', false, false, true]])
  assert.ok(access.every(row => row.proconfig.includes('search_path=""')))
  assert.deepEqual((await db.query("select oid,proowner,proacl,proconfig,prosrc from pg_proc where oid=any($1::oid[]) order by oid", [originalFunctions.map(row => row.oid)])).rows, originalFunctions)
  const own = await personal({ worker: ids.planner, reviewer: null, status: 'doing' })
  const colleagueOwn = await personal({ owner: ids.planner2, reviewer: ids.planner })
  const requested = await personal()
  const done = await personal({ status: 'done' })
  const inherited = await personal({ owner: ids.md, handover: ids.planner })
  const handedAway = await personal({ handover: ids.md, reviewer: ids.md })
  const removed = await personal({ deleted: true })
  const notice = crypto.randomUUID()
  await db.query(`insert into public.personal_work_feedback_notices(id,company_id,recipient_id,card_id,card_revision,round,title,requester_name,created_at)
    values($1,$2,$3,$4,4,1,'개인 업무','요청자',now())`, [notice, company, ids.planner, requested])

  const titles = page => page.items.map(row => row.title)
  const keys = page => page.items.map(row => row.id)
  let feedback = await list(ids.planner)
  assert.ok(keys(feedback).includes(requested))
  assert.ok(keys(feedback).includes(colleagueOwn), 'a colleague can request feedback on their own card')
  assert.ok(!keys(feedback).includes(done))
  assert.ok(!keys(feedback).includes(removed))
  assert.equal(feedback.items.find(row => row.id === requested).noticeId, notice)
  assert.ok(!JSON.stringify(feedback).includes('비공개 본문'))
  await actor(ids.planner)
  assert.equal((await db.query('select read_at from public.personal_work_feedback_notices where id=$1', [notice])).rows[0].read_at, null, 'listing never marks read')
  await db.query('select public.read_personal_work_feedback_notice($1,4)', [notice])
  assert.ok(keys(await list(ids.planner)).includes(requested), 'read feedback stays pending')
  assert.equal((await db.query('select public.read_personal_work_feedback_notice($1,3) as read', [notice])).rows[0].read, null, 'old revision cannot read a newer submission')

  let issued = await list(ids.planner, 'issued')
  for (const id of [requested, done, inherited]) assert.ok(keys(issued).includes(id))
  for (const id of [own, handedAway, removed]) assert.ok(!keys(issued).includes(id))
  const statuses = ['requested', 'inProgress', 'completionReview', 'completionConfirm', 'completed', 'cancelled', 'rejected']
  for (const status of statuses) await work({ title: '상태 ' + status, status, data: { assignedBy: ids.planner, assignee: ids.planner2 } })
  await work({ title: '초안 제외', status: 'draft' })
  await work({ title: '삭제 제외', data: { deleted: true } })
  await work({ title: '혼자 하는 자체 업무 제외', kind: 'internal', data: { assignee: ids.planner, assignedBy: ids.planner } })
  await work({ title: '직접 배정', requester: ids.planner2, data: { assignedBy: ids.planner } })
  const foreignWork = await work({ title: '다른 회사 제외', requester: ids.outsider, otherCompany: true, data: { assignedBy: ids.planner } })
  await work({ title: '이름만 같은 직원 제외', requester: ids.planner2 })
  issued = await list(ids.planner, 'issued')
  for (const status of statuses) assert.ok(titles(issued).includes('상태 ' + status))
  assert.ok(titles(issued).includes('직접 배정'))
  assert.equal(issued.items.filter(row => row.title === '상태 completionReview').length, 1, 'requester and assigner overlap once')
  for (const title of ['초안 제외', '삭제 제외', '혼자 하는 자체 업무 제외', '다른 회사 제외', '이름만 같은 직원 제외']) assert.ok(!titles(issued).includes(title))
  feedback = await list(ids.planner)
  assert.ok(titles(feedback).includes('상태 completionConfirm'))
  assert.ok(!titles(feedback).includes('상태 completionReview'), 'department reader is not a reviewer')
  await db.exec('reset role')
  await db.query("insert into public.permission_grants(id,profile_id,company_id,permission,scope_kind,scope_id) values(gen_random_uuid(),$1,$2,'work.manage','department',$3)", [ids.planner, company, departments.planning])
  assert.ok(titles(await list(ids.planner)).includes('상태 completionReview'))

  // Two simultaneous Visual categories form one work row, with current authorized targets.
  const visual = await work({ title: '두 분류 검토', owner: 'design', requester: ids.md, data: {
    categoryAssignments: ['banner', 'video'].map(categoryId => ({ categoryId, label: categoryId, assigneeId: ids.manager, assignedBy: ids.design })),
    visualCategoryWorkflow: { receivedAt: new Date().toISOString(), categories: {
      banner: { state: 'middle_review', version: 5, workerId: ids.design },
      video: { state: 'middle_review', version: 6, workerId: ids.design },
    } },
  } })
  const visualRows = (await list(ids.manager)).items.filter(row => row.id === visual)
  assert.equal(visualRows.length, 1)
  assert.equal(visualRows[0].targets.length, 2)
  assert.ok(!keys(await list(ids.design)).includes(visual), 'worker has no pending manager review')
  assert.ok(keys(await list(ids.design, 'issued')).includes(visual), 'category assigner is an issuer')
  const workerAssigned = await work({ title: 'Visual 작업자 직접 지정', owner: 'design', requester: ids.md, data: {
    categoryAssignments: [{ categoryId: 'banner', label: '배너', assigneeId: ids.manager, assignedBy: ids.md }],
    visualCategoryWorkflow: { receivedAt: new Date().toISOString(), categories: {
      banner: { state: 'working', version: 1, workerId: ids.design },
    } },
  } })
  await db.query(`insert into app.visual_workflow_entries(id,request_id,category_id,actor_id,action,note,created_at)
    values(gen_random_uuid(),$1,'banner',$2,'assign_worker','',now())`, [workerAssigned, ids.manager])
  assert.ok(keys(await list(ids.manager, 'issued')).includes(workerAssigned), 'actual worker-assignment actor is an issuer')
  assert.ok(!keys(await list(ids.design, 'issued')).includes(workerAssigned), 'assigned worker is not an issuer')
  await db.exec('reset role')
  await db.query("update public.work_requests set data=jsonb_set(data,'{visualCategoryWorkflow,categories,banner,state}','\"requester_review\"') where id=$1", [visual])
  assert.equal((await list(ids.md)).items.find(row => row.id === visual).targets[0].kind, 'requester_review')
  assert.equal((await list(ids.manager)).items.find(row => row.id === visual).targets.length, 1)
  await db.exec('reset role')
  await db.query("update public.work_requests set status='cancelled' where id=$1", [visual])
  assert.ok(!keys(await list(ids.manager)).includes(visual), 'closed Visual feedback disappears')
  assert.ok(keys(await list(ids.md, 'issued')).includes(visual), 'closed issued work remains')
  await db.exec('reset role')
  await db.query("update public.work_request_settings set supervisor_ids=$1 where owner='design'", [[ids.design]])
  const final = await work({ title: '지정 총괄 승인', owner: 'design', status: 'completionConfirm', data: {
    visualFinalApproval: { approverId: ids.design, requestedAt: new Date().toISOString() },
  } })
  assert.ok(keys(await list(ids.design)).includes(final))
  assert.ok(!keys(await list(ids.manager)).includes(final), 'generic manager is not a designated final approver')
  assert.ok(!keys(await list(ids.planner)).includes(final), 'requester waits for final approval')
  await db.exec('reset role')
  await db.query("update app.personal_work_cards set status='doing',revision=5 where id=$1", [requested])
  assert.ok(!keys(await list(ids.planner)).includes(requested), 'processed personal feedback leaves the pending queue')

  // Equal timestamps must not skip or repeat across 20-row cursor boundaries.
  for (let i = 0; i < 45; i++) await work({ title: '페이지 ' + i })
  const collected = []
  let cursor = null, expectedTotal
  do {
    const page = await list(ids.planner, 'issued', cursor)
    assert.ok(page.items.length <= 20)
    expectedTotal = page.total
    collected.push(...page.items)
    cursor = page.nextCursor
  } while (cursor)
  assert.equal(collected.length, expectedTotal)
  assert.equal(new Set(collected.map(row => row.key)).size, expectedTotal)
  for (const row of collected) for (const secret of ['description', 'messages', 'files', 'events', 'blocks']) assert.equal(secret in row, false)
  await actor(ids.planner)
  await assert.rejects(db.query("select public.list_my_home_related_work('unknown')"), { code: '22023' })
  await assert.rejects(db.query("select public.list_my_home_related_work('issued',now(),null)"), { code: '22023' })
  assert.deepEqual(keys(await list(ids.outsider, 'issued')), [foreignWork], 'another company sees only its own records')
  await db.exec('reset role')
  await db.query("update public.profiles set status='inactive' where id=$1", [ids.planner])
  await assert.rejects(list(ids.planner), { code: '42501' })
  await actor(ids.planner2, 'anon')
  await assert.rejects(db.query("select public.list_my_home_related_work('issued')"), { code: '42501' })
  await actor('')
  await assert.rejects(db.query("select public.list_my_home_related_work('issued')"), { code: '42501' })
  console.log('My home related work DB: scopes, dedup, status/history, review targets, handover, read versions, cursor pagination and access passed')
} finally {
  await db.close()
}
