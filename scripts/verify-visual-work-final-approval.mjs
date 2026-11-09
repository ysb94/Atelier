import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createWorkTestDb, departments, ids } from './work-request-test-db.mjs'

const db = await createWorkTestDb()
const migration = async name => db.exec(await readFile(`supabase/migrations/${name}.sql`, 'utf8'))
const denied = (operation, code = '42501') => assert.rejects(operation, { code })
const actor = async (id, role = 'authenticated') => {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id])
  await db.exec(`set role ${role}`)
}
async function rpc(name, parameters = []) {
  const placeholders = parameters.map((_, index) => '$' + (index + 1)).join(',')
  return (await db.query(`select public.${name}(${placeholders}) as value`, parameters)).rows[0].value
}
const save = (id, rev, patch) => rpc('save_work_request', [id, rev, patch, crypto.randomUUID()])
const approval = (id, rev, action, value = null, command = crypto.randomUUID()) =>
  rpc('change_visual_work_final_approval', [id, rev, action, value, command])
const read = async id => (await rpc('get_department_work', [id])).requests[0]
const values = title => ({ title, dueDate: '2030-01-01', blocks: [{ id: 'main', type: 'text', text: '원본 업무 내용' }], referenceFiles: [] })
async function createInternal(who, owner) {
  await actor(who)
  const id = crypto.randomUUID()
  const revision = await rpc('begin_department_work', [id, owner])
  return [id, await rpc('save_department_work', [id, revision, { status: 'requested', values: values('자체 업무') }, crypto.randomUUID()])]
}
async function createAtRequesterReview(title) {
  await actor(ids.planner)
  const id = crypto.randomUUID()
  const draft = await rpc('begin_work_request', [id, 'design'])
  let revision = await save(id, draft, { status: 'requested', values: values(title) })
  await actor(ids.manager)
  revision = await save(id, revision, { status: 'accepted', assignee: ids.design })
  await actor(ids.design)
  revision = await save(id, revision, { status: 'completionReview', completionResult: `${title} 완료 결과` })
  await actor(ids.manager)
  return [id, await save(id, revision, { status: 'completionConfirm' })]
}

try {
  for (const name of ['20261102034546_work_request_category_settings', '20261102043240_work_request_explicit_managers',
    '20261102093634_department_work_board', '20261102114206_work_request_cancellation', '20261109052445_visual_work_category_comments']) await migration(name)

  const [existing, existingRev] = await createInternal(ids.design, 'design')
  const before = await read(existing)
  await db.exec('reset role')
  const snapshot = () => db.query(`select
    (select jsonb_agg(to_jsonb(p) order by p.id) from public.profiles p) as profiles,
    (select jsonb_agg(to_jsonb(g) order by g.id) from public.permission_grants g) as grants,
    (select jsonb_agg(to_jsonb(p) order by p.tablename,p.policyname) from pg_policies p) as policies`).then(result => result.rows[0])
  const originalAccess = await snapshot()
  await migration('20261109062457_visual_work_final_approval')
  assert.deepEqual(await snapshot(), originalAccess)
  await actor(ids.design)
  assert.deepEqual(await read(existing), before)
  await rpc('complete_department_work', [existing, existingRev, crypto.randomUUID()])
  assert.equal((await read(existing)).status, 'completed', 'Existing workflow works before any supervisor is set')

  const ordinary = crypto.randomUUID()
  const extraSupervisors = [crypto.randomUUID(), crypto.randomUUID()]
  const supervisors = [ids.manager, ids.design, ...extraSupervisors]
  await db.exec('reset role')
  await db.query(`insert into public.profiles(id,company_id,department_id,display_name,status,is_admin,position)
    select staff.id,p.company_id,$2,'추가 Visual 직원','active',false,'' from public.profiles p
    cross join unnest($1::uuid[]) as staff(id) where p.id=$3`, [[ordinary, ...extraSupervisors], departments.design, ids.design])
  await actor(ids.manager)
  const settings = await rpc('get_work_request_settings', ['design'])
  const configure = (rev, selected) => rpc('save_visual_work_request_settings', [rev, settings.categories, selected])
  await denied(configure(settings.revision, [ids.manager, ids.manager]), '22023')
  await denied(configure(settings.revision, [ids.planner]), '22023')
  const configured = await configure(settings.revision, supervisors)
  await denied(configure(settings.revision, supervisors), '40001')
  await denied(configure(configured, []), '22023')
  let settingsRev = await rpc('save_work_request_settings', ['design', configured, settings.categories])
  assert.deepEqual((await rpc('get_work_request_settings', ['design'])).activeSupervisorIds, supervisors)
  await actor(ids.design)
  await denied(configure(settingsRev, supervisors))
  assert.equal((await rpc('get_work_request_settings', ['design'])).canManage, false, 'Supervisor does not get general management authority')
  assert.equal((await read(existing)).status, 'completed', 'Completed records stay complete')

  const [one, oneRev] = await createAtRequesterReview('배너')
  const [two, twoRev] = await createAtRequesterReview('광고 소재')
  const [extra, extraRev] = await createAtRequesterReview('네 번째 총괄 배정')
  const fourth = extraSupervisors[1]
  let first = await approval(one, oneRev, 'assign', ids.design)
  let second = await approval(two, twoRev, 'assign', ids.manager)
  const extraAssigned = await approval(extra, extraRev, 'assign', fourth)
  await denied(approval(one, oneRev, 'assign', ids.manager), '40001')
  await denied(approval(one, first, 'approve'))
  await actor(ids.planner)
  await denied(save(one, first, { status: 'completed' }))
  const submit = crypto.randomUUID()
  const submitted = await approval(one, first, 'submit', null, submit)
  assert.equal(await approval(one, first, 'submit', null, submit), submitted)
  first = submitted
  second = await approval(two, second, 'submit')
  const extraPending = await approval(extra, extraAssigned, 'submit')
  assert.equal((await read(one)).status, 'completionConfirm')
  assert.ok((await read(one)).visualFinalApproval.requestedAt)
  await denied(save(one, first, { status: 'completed' }))
  await denied(approval(one, first, 'approve'))
  await actor(ordinary)
  await denied(approval(one, first, 'approve'))
  await denied(approval(two, second, 'assign', ids.design))
  await actor(ids.outsider)
  await denied(approval(one, first, 'approve'))
  await actor(ids.manager)
  await denied(approval(one, first, 'approve'))
  await denied(approval(extra, extraPending, 'approve'))
  const list = await rpc('list_department_work', ['design'])
  assert.equal(list.find(row => row.id === one).visualFinalApproval.approverId, ids.design)
  assert.equal(list.find(row => row.id === two).visualFinalApproval.approverId, ids.manager)
  await approval(two, second, 'approve')
  await actor(fourth)
  await denied(approval(one, first, 'approve'))
  await approval(extra, extraPending, 'approve')
  assert.equal((await read(extra)).visualFinalApproval.approvedBy, fourth)
  await actor(ids.design)
  const command = crypto.randomUUID()
  const approved = await approval(one, first, 'approve', null, command)
  assert.equal(await approval(one, first, 'approve', null, command), approved)
  assert.equal((await read(one)).visualFinalApproval.approvedBy, ids.design)
  assert.equal((await read(one)).completionResult, '배너 완료 결과')
  assert.equal((await read(two)).visualFinalApproval.approvedBy, ids.manager)

  const [own, ownRev] = await createInternal(ids.design, 'design')
  await denied(rpc('complete_department_work', [own, ownRev, crypto.randomUUID()]))
  let current = await approval(own, ownRev, 'submit', '자체 업무 완료 결과')
  assert.equal((await read(own)).visualFinalApproval.approverId, null)
  await denied(approval(own, current, 'approve'))
  await denied(approval(own, current, 'assign', ids.manager))
  current = await approval(own, current, 'assign', ids.design)
  current = await approval(own, current, 'return', '파일 확인 후 다시 요청')
  assert.equal((await read(own)).status, 'inProgress')
  assert.equal((await read(own)).visualFinalApproval.returnedReason, '파일 확인 후 다시 요청')
  current = await approval(own, current, 'submit', '수정 결과')
  await actor(ids.manager)
  settingsRev = await configure(settingsRev, [ids.manager])
  await actor(ids.design)
  await denied(approval(own, current, 'approve'))
  await actor(ids.manager)
  await approval(own, current, 'approve')
  assert.equal((await read(own)).visualFinalApproval.approvedBy, ids.manager, 'The remaining active supervisor takes over')

  const [planning, planningRev] = await createInternal(ids.planner, 'planning')
  await rpc('complete_department_work', [planning, planningRev, crypto.randomUUID()])
  assert.equal((await read(planning)).status, 'completed', 'Other departments keep their completion path')
  await actor('', 'anon')
  await denied(approval(one, approved, 'approve'))
  console.log('PASS: Visual final approval with four supervisors, per-work assignment, requester confirmation, blocked bypasses, internal/rework flow, and existing data and access')
} finally {
  await db.close()
}
