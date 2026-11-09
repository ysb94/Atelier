import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createWorkTestDb, departments, ids } from './work-request-test-db.mjs'

const migrations = [
  '20261102034546_work_request_category_settings',
  '20261102043240_work_request_explicit_managers',
  '20261102093634_department_work_board',
  '20261102114206_work_request_cancellation',
  '20261109052445_visual_work_category_comments',
  '20261109062457_visual_work_final_approval',
  '20261109074836_visual_department_work_role_columns',
  '20261109074511_visual_category_workflow',
]
const db = await createWorkTestDb()
const company = 'e0000000-0000-4000-8000-000000000001'
const supervisor = crypto.randomUUID(), otherSupervisor = crypto.randomUUID()
const middle = ids.design, otherMiddle = crypto.randomUUID()
const worker = crypto.randomUUID(), otherWorker = crypto.randomUUID()
const request = crypto.randomUUID()
const values = {
  title: '분류 독립 검수', dueDate: '2030-01-01',
  blocks: [{ id: 'main-text', type: 'text', text: '배너와 영상' }], referenceFiles: [],
  visualRequest: { categories: [{ id: 'banner', fields: {} }, { id: 'video', fields: {} }] },
}
let revision

async function actor(id) {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id])
  await db.exec('set role authenticated')
}
async function rpc(id, name, args = []) {
  await actor(id)
  const params = args.map((_, index) => '$' + (index + 1)).join(',')
  return (await db.query('select public.' + name + '(' + params + ') as data', args)).rows[0].data
}
async function act(id, category, action, options = {}) {
  revision = await rpc(id, 'change_visual_category_work', [
    request, category, options.revision ?? revision, action, options.person ?? null,
    options.note ?? '', options.url ?? '', options.command ?? crypto.randomUUID(),
  ])
  return revision
}
const detail = async (id = ids.planner) => (await rpc(id, 'get_department_work', [request])).requests[0]
const entries = (id, category) => rpc(id, 'list_visual_workflow_entries', [request, category])
const review = (id, category, target = request) => rpc(id, 'get_visual_workflow_review', [target, category])
const notices = async id => (await rpc(id, 'list_my_visual_workflow_notices')).filter(row => row.requestId === request)
const current = async (id, kind, category = '') => (await notices(id)).find(row => row.current && row.kind === kind && row.categoryId === category)
const rejected = action => assert.rejects(action, { code: '42501' })

try {
  for (const migration of migrations) await db.exec(await readFile('supabase/migrations/' + migration + '.sql', 'utf8'))
  for (const [id, name] of [[supervisor, '총괄'], [otherSupervisor, '다른 총괄'], [otherMiddle, '영상 중간'], [worker, '배너 작업자'], [otherWorker, '영상 작업자']]) {
    await db.query("insert into public.profiles(id,company_id,department_id,display_name,status,is_admin,position) values($1,$2,$3,$4,'active',false,'')", [id, company, departments.design, name])
  }
  const settings = await rpc(ids.manager, 'get_work_request_settings', ['design'])
  assert.equal(settings.categoryWorkflowAvailable, true)
  const categories = settings.categories.map(category => ({ ...category, assigneeId: category.id === 'banner' ? middle : category.id === 'video' ? otherMiddle : '' }))
  await rpc(ids.manager, 'save_visual_work_request_settings', [settings.revision, categories, [supervisor, otherSupervisor]])

  const legacy = crypto.randomUUID()
  const legacyDraft = await rpc(ids.planner, 'begin_work_request', [legacy, 'design'])
  const publishedLegacy = await rpc(ids.planner, 'save_work_request', [legacy, legacyDraft, { values, status: 'requested' }, crypto.randomUUID()])
  const legacyRevision = await rpc(ids.manager, 'change_visual_work_final_approval', [legacy, publishedLegacy, 'assign', supervisor, crypto.randomUUID()])
  assert.equal((await rpc(ids.planner, 'get_department_work', [legacy])).requests[0].visualCategoryWorkflow, undefined)

  const accepted = crypto.randomUUID()
  const acceptedDraft = await rpc(ids.planner, 'begin_work_request', [accepted, 'design'])
  const requestedRevision = await rpc(ids.planner, 'save_work_request', [accepted, acceptedDraft, { values, status: 'requested' }, crypto.randomUUID()])
  const acceptedRevision = await rpc(ids.manager, 'save_work_request', [accepted, requestedRevision, {
    status: 'accepted', assignee: middle, confirmedDueDate: values.dueDate, managerPriority: 'normal',
  }, crypto.randomUUID()])
  await db.exec('reset role')
  const rawRequest = async id => (await db.query('select to_jsonb(w) as data from public.work_requests w where w.id=$1', [id])).rows[0].data
  const legacyBefore = await rawRequest(legacy)
  const acceptedBefore = await rawRequest(accepted)
  const functionAccess = async () => (await db.query(`select oid,proowner,proacl,prosecdef,proconfig
    from pg_proc where oid in (
      'app.list_department_work(text)'::regprocedure, 'app.get_department_work(uuid)'::regprocedure,
      'app.change_visual_category_work(uuid,text,bigint,text,uuid,text,text,uuid)'::regprocedure
    ) order by oid`)).rows
  const accessBefore = await functionAccess()
  await db.exec(await readFile('supabase/pending/visual_supervisor_receipt_queue.sql', 'utf8'))
  assert.deepEqual(await rawRequest(legacy), legacyBefore)
  assert.deepEqual(await rawRequest(accepted), acceptedBefore)
  assert.deepEqual(await functionAccess(), accessBefore)
  const pendingLegacy = (await rpc(supervisor, 'list_department_work', ['design'])).find(row => row.id === legacy)
  assert.equal(pendingLegacy.visualReceiptPending, true)
  assert.ok(!pendingLegacy.assigneeIds.includes(supervisor))
  assert.deepEqual(pendingLegacy.visualMiddleManagerIds, [middle, otherMiddle])
  const legacyDetail = (await rpc(supervisor, 'get_department_work', [legacy])).requests[0]
  assert.deepEqual(Object.keys(legacyDetail.visualCategoryWorkflow.categories).sort(), ['banner', 'video'])
  assert.equal(legacyDetail.visualCategoryWorkflow.legacyReceiptPending, true)
  assert.equal(legacyDetail.visualCategoryWorkflow.approverId, supervisor)
  assert.equal(legacyDetail.visualCategoryWorkflow.receivedAt, undefined)
  await rejected(() => rpc(supervisor, 'list_visual_work_category_comments', [legacy, 'banner']))
  assert.equal((await rpc(supervisor, 'get_department_work', [accepted])).requests[0].visualCategoryWorkflow, undefined)
  const legacyAction = (id, action, { target = legacy, category = '', revision = legacyRevision, person = null } = {}) =>
    rpc(id, 'change_visual_category_work', [target, category, revision, action, person, '', '', crypto.randomUUID()])
  await rejected(() => legacyAction(supervisor, 'receipt', { target: accepted, revision: acceptedRevision }))
  await rejected(() => legacyAction(otherSupervisor, 'receipt'))
  await rejected(() => legacyAction(ids.outsider, 'receipt'))
  await rejected(() => legacyAction(middle, 'receipt'))
  await rejected(() => legacyAction(middle, 'assign_worker', { category: 'banner', person: worker }))
  await legacyAction(supervisor, 'receipt')
  const receivedLegacy = (await rpc(middle, 'get_department_work', [legacy])).requests[0]
  assert.equal(receivedLegacy.status, 'inProgress')
  assert.equal(receivedLegacy.visualCategoryWorkflow.approverId, supervisor)
  assert.ok(receivedLegacy.visualCategoryWorkflow.receivedAt)
  assert.equal(receivedLegacy.visualCategoryWorkflow.legacyReceiptPending, undefined)
  assert.deepEqual((await rpc(supervisor, 'list_visual_work_category_comments', [legacy, 'banner'])).items, [])
  assert.deepEqual(receivedLegacy.categoryAssignments, legacyBefore.data.categoryAssignments)
  assert.deepEqual(receivedLegacy.values, legacyBefore.data.values)
  assert.deepEqual(receivedLegacy.visualFinalApproval, legacyBefore.data.visualFinalApproval)
  assert.equal((await rpc(supervisor, 'list_department_work', ['design'])).find(row => row.id === legacy).visualReceiptPending, null)
  assert.equal((await rpc(middle, 'list_my_visual_workflow_notices')).filter(row =>
    row.requestId === legacy && row.categoryId === 'banner' && row.kind === 'assignment' && row.current).length, 1)

  const legacyAssigned = await legacyAction(middle, 'assign_worker', { category: 'banner', revision: receivedLegacy.revision, person: worker })
  const legacySubmitted = await rpc(worker, 'change_visual_category_work', [
    legacy, 'banner', legacyAssigned, 'submit', null, '이전 시안', '', crypto.randomUUID(),
  ])
  await rpc(middle, 'change_visual_category_work', [
    legacy, 'banner', legacySubmitted, 'middle_return', null, '이전 중간 수정', '', crypto.randomUUID(),
  ])
  await db.exec('reset role')
  await db.query("update public.work_requests set data=jsonb_set(data,'{visualCategoryWorkflow,categories,banner,feedbackCycles}', '[{\"middle\":1}]') where id=$1", [legacy])
  const historical = await rawRequest(legacy)
  const oldNotices = (await db.query('select * from public.visual_workflow_notices where request_id=$1 order by id', [legacy])).rows
  await db.exec('begin')
  await db.exec(await readFile('supabase/migrations/20261109192913_visual_assignment_history_visibility.sql', 'utf8'))
  await db.exec('commit')
  delete historical.data.visualCategoryWorkflow.categories.banner.feedback
  delete historical.data.visualCategoryWorkflow.categories.banner.feedbackCycles
  assert.deepEqual(await rawRequest(legacy), historical)
  assert.deepEqual((await db.query('select * from public.visual_workflow_notices where request_id=$1 order by id', [legacy])).rows, oldNotices)
  const oldReview = await review(middle, 'banner', legacy)
  assert.deepEqual(oldReview.assignments.map(row => row.middle), [1])
  assert.equal(oldReview.entries.length, 2)
  assert.deepEqual((await review(worker, 'banner', legacy)).entries.map(row => row.note), ['이전 중간 수정', '이전 시안'])
  assert.equal((await review(ids.planner, 'banner', legacy)).result, null)

  const draft = await rpc(ids.planner, 'begin_work_request', [request, 'design'])
  const publishCommand = crypto.randomUUID()
  const publishArgs = [request, draft, { values, status: 'requested' }, publishCommand]
  revision = await rpc(ids.planner, 'publish_visual_category_work', publishArgs)
  assert.equal(await rpc(ids.planner, 'publish_visual_category_work', publishArgs), revision)
  assert.equal((await detail()).status, 'requested')
  assert.equal((await rpc(supervisor, 'list_department_work', ['design'])).find(row => row.id === request).visualReceiptPending, true)
  assert.ok(await current(middle, 'registered', 'banner'))
  assert.ok(await current(otherMiddle, 'registered', 'video'))
  assert.ok(await current(otherSupervisor, 'receipt'))
  const receipt = await current(supervisor, 'receipt')
  assert.ok(receipt)

  await rpc(otherWorker, 'read_my_visual_workflow_notices', [request, 'banner', revision, [receipt.id]])
  await rpc(supervisor, 'read_my_visual_workflow_notices', [request, 'banner', revision - 1, [receipt.id]])
  assert.equal((await current(supervisor, 'receipt')).readAt, null)
  await rpc(supervisor, 'read_my_visual_workflow_notices', [request, 'banner', revision, [receipt.id]])
  assert.ok((await current(supervisor, 'receipt')).readAt)
  const onlyBanner = { ...values, visualRequest: { categories: values.visualRequest.categories.slice(0, 1) } }
  revision = await rpc(ids.planner, 'save_work_request', [request, revision, { values: onlyBanner }, crypto.randomUUID()])
  assert.deepEqual(Object.keys((await detail()).visualCategoryWorkflow.categories), ['banner'])
  assert.equal(await current(otherMiddle, 'registered', 'video'), undefined)
  revision = await rpc(ids.planner, 'save_work_request', [request, revision, { values }, crypto.randomUUID()])
  assert.ok(await current(otherMiddle, 'registered', 'video'))
  await rejected(() => act(middle, 'banner', 'assign_worker', { person: worker }))
  await rejected(() => rpc(ids.manager, 'save_work_request', [request, revision, { status: 'reviewing' }, crypto.randomUUID()]))
  await rejected(() => act(ids.outsider, '', 'receipt'))
  await act(supervisor, '', 'receipt')
  await rejected(() => act(otherSupervisor, '', 'receipt'))
  assert.equal(await current(otherSupervisor, 'receipt'), undefined)
  assert.ok(await current(middle, 'assignment', 'banner'))
  assert.ok(await current(otherMiddle, 'assignment', 'video'))
  await rejected(() => act(otherMiddle, 'banner', 'assign_worker', { person: worker }))
  await assert.rejects(() => act(middle, 'banner', 'assign_worker', { person: ids.md }), { code: '22023' })
  const preAssignment = revision
  const assignmentCommand = crypto.randomUUID()
  await act(middle, 'banner', 'assign_worker', { person: worker, command: assignmentCommand })
  const assignedRevision = revision
  assert.equal(await act(middle, 'banner', 'assign_worker', { person: worker, command: assignmentCommand, revision: preAssignment }), assignedRevision)
  await assert.rejects(() => act(otherMiddle, 'video', 'assign_worker', { person: otherWorker, revision: preAssignment }), { code: '40001' })
  await act(otherMiddle, 'video', 'assign_worker', { person: otherWorker })
  assert.equal((await detail(worker)).visualCategoryWorkflow.categories.banner.workerId, worker)
  const board = (await rpc(worker, 'list_department_work', ['design'])).find(row => row.id === request)
  assert.ok(board.assigneeIds.includes(worker) && board.assigneeIds.includes(otherWorker))
  assert.ok(await current(worker, 'working', 'banner'))
  await rejected(() => rpc(worker, 'list_visual_work_category_comments', [request, 'video']))
  await rejected(() => rpc(worker, 'list_visual_work_category_comments', [request, 'banner']))
  await rejected(() => rpc(ids.planner, 'list_visual_work_category_comments', [request, 'banner']))
  assert.deepEqual((await rpc(middle, 'list_visual_work_category_comments', [request, 'banner'])).items, [])
  assert.deepEqual((await review(worker, 'banner')).assignments, [{ middle: 0 }])
  assert.deepEqual((await review(middle, 'banner')).assignments.map(row => [row.workerName, row.middle]), [['배너 작업자', 0]])

  await rejected(() => act(otherWorker, 'banner', 'submit', { note: '권한 없음' }))
  await act(worker, 'banner', 'submit', { note: '초안', url: 'https://example.com/banner-draft' })
  assert.deepEqual(await entries(ids.planner, 'banner'), [])
  await rejected(() => entries(otherWorker, 'banner'))
  await act(middle, 'banner', 'middle_return', { note: '색상 수정' })
  assert.equal((await entries(worker, 'banner'))[0].action, 'middle_return')
  await act(worker, 'banner', 'submit', { note: '두 번째 시안' })
  await act(middle, 'banner', 'middle_approve')
  await rejected(() => act(otherSupervisor, 'banner', 'supervisor_approve'))
  assert.equal((await rpc(supervisor, 'list_department_work', ['design'])).find(row => row.id === request).visualCategoryReview.pending, true)
  await act(supervisor, 'banner', 'supervisor_return', { note: '총괄 검수 수정' })
  assert.equal((await entries(worker, 'banner')).some(row => row.action === 'supervisor_return'), false)
  const beforeForward = revision
  const forwardCommand = crypto.randomUUID()
  await act(middle, 'banner', 'middle_forward', { note: '총괄 의견 전달', command: forwardCommand })
  const forwarded = revision
  assert.equal(await act(middle, 'banner', 'middle_forward', { note: '총괄 의견 전달', command: forwardCommand, revision: beforeForward }), forwarded)
  const middleHistory = await entries(middle, 'banner')
  assert.equal(middleHistory.find(row => row.action === 'supervisor_return').roundId, middleHistory.find(row => row.action === 'middle_forward').roundId)
  assert.deepEqual((await review(middle, 'banner')).assignments.map(row => [row.workerName, row.middle, row.supervisor]), [
    ['배너 작업자', 1, 1], ['배너 작업자', 0, 1],
  ])
  assert.deepEqual((await review(worker, 'banner')).entries.map(row => row.note), ['총괄 의견 전달'])
  assert.equal((await review(worker, 'banner')).handoff.note, '두 번째 시안')
  assert.equal((await detail()).visualCategoryWorkflow.categories.banner.feedback, undefined)
  await actor(ids.planner)
  const rawWorkerRequest = (await db.query('select data from public.work_requests where id=$1', [request])).rows[0].data
  assert.equal(rawWorkerRequest.visualCategoryWorkflow.categories.banner.feedback, undefined)
  assert.equal(rawWorkerRequest.visualCategoryWorkflow.categories.banner.feedbackCycles, undefined)
  await assert.rejects(() => db.query('select * from app.visual_workflow_feedback'), { code: '42501' })

  await act(worker, 'banner', 'submit', { note: '배너 완성본' })
  await act(middle, 'banner', 'middle_approve')
  await act(supervisor, 'banner', 'supervisor_approve')
  const firstResult = await current(ids.planner, 'requester_review', 'banner')
  assert.ok(firstResult?.personal)
  assert.equal((await entries(ids.planner, 'banner'))[0].note, '배너 완성본')
  assert.equal((await detail()).visualCategoryWorkflow.categories.video.state, 'working')
  await rpc(ids.planner, 'read_my_visual_workflow_notices', [request, 'video', revision, [firstResult.id]])
  assert.equal((await current(ids.planner, 'requester_review', 'banner')).readAt, null)
  await rpc(ids.planner, 'read_my_visual_workflow_notices', [request, 'banner', revision, [firstResult.id]])
  assert.ok((await current(ids.planner, 'requester_review', 'banner')).readAt)
  await act(ids.planner, 'banner', 'requester_return', { note: '요청자 변경 요청' })
  assert.ok(await current(supervisor, 'supervisor_revision', 'banner'))
  await act(supervisor, 'banner', 'supervisor_forward', { note: '중간 관리자에게 전달' })
  await act(middle, 'banner', 'middle_forward', { person: otherWorker, note: '새 요청을 반영해 주세요' })
  await rejected(() => review(worker, 'banner'))
  const newWorkerReview = await review(otherWorker, 'banner')
  assert.equal(newWorkerReview.handoff.note, '배너 완성본')
  assert.deepEqual(newWorkerReview.assignments, [{ middle: 0 }])
  assert.deepEqual(newWorkerReview.entries.map(row => row.note), ['새 요청을 반영해 주세요'])
  await act(otherWorker, 'banner', 'submit', { note: '새 작업자 초안' })
  await act(middle, 'banner', 'middle_return', { note: '초안 수정' })
  await act(middle, 'banner', 'assign_worker', { person: worker, note: '초안에서 제목만 정리해 주세요' })
  await rejected(() => review(otherWorker, 'banner'))
  assert.equal((await review(worker, 'banner')).handoff.note, '새 작업자 초안')
  assert.deepEqual((await review(worker, 'banner')).entries.map(row => row.note), ['초안에서 제목만 정리해 주세요'])
  const fullReview = await review(supervisor, 'banner')
  assert.deepEqual(fullReview.assignments.map(row => [row.workerName, row.middle, row.supervisor, row.requester]), [
    ['배너 작업자', 1, 1, undefined], ['배너 작업자', 0, 1, 1],
    ['영상 작업자', 1, 1, undefined], ['배너 작업자', 0, undefined, undefined],
  ])
  assert.ok(fullReview.entries.some(row => row.note === '요청자 변경 요청'))
  await act(worker, 'banner', 'submit', { note: '배너 확정본' })
  assert.equal((await review(ids.planner, 'banner')).result.note, '배너 완성본')
  await act(middle, 'banner', 'middle_approve')
  await act(supervisor, 'banner', 'supervisor_approve')
  const requesterReview = await review(ids.planner, 'banner')
  assert.equal(requesterReview.result.note, '배너 확정본')
  assert.deepEqual(requesterReview.entries, [])
  assert.deepEqual(requesterReview.assignments, [])
  assert.deepEqual((await entries(ids.planner, 'banner')).map(row => row.note), ['배너 확정본'])
  const nextResult = await current(ids.planner, 'requester_review', 'banner')
  assert.ok(nextResult && nextResult.id !== firstResult.id)
  await rpc(ids.planner, 'read_my_visual_workflow_notices', [request, 'banner', firstResult.version, [nextResult.id]])
  assert.equal((await current(ids.planner, 'requester_review', 'banner')).readAt, null)
  await act(ids.planner, 'banner', 'requester_confirm')
  assert.equal(await current(ids.planner, 'requester_review', 'banner'), undefined)
  assert.equal((await detail()).status, 'inProgress')
  assert.equal((await detail()).visualCategoryWorkflow.categories.banner.feedback, undefined)

  await act(otherWorker, 'video', 'submit', { url: 'https://example.com/video' })
  await act(otherMiddle, 'video', 'middle_approve')
  await act(supervisor, 'video', 'supervisor_approve')
  assert.equal((await detail()).status, 'completionConfirm')
  await rejected(() => rpc(ids.planner, 'save_work_request', [request, revision, { status: 'completed' }, crypto.randomUUID()]))
  await act(ids.planner, 'video', 'requester_confirm')
  const complete = await detail()
  assert.equal(complete.status, 'completed')
  assert.ok(complete.completedAt)
  assert.ok(Object.values(complete.visualCategoryWorkflow.categories).every(category => category.state === 'confirmed'))
  assert.equal((await notices(ids.planner)).some(row => row.current), false)
  await actor(ids.outsider)
  assert.equal((await db.query('select id from public.visual_workflow_notices')).rows.length, 0)
  await db.exec('reset role; set role anon')
  await assert.rejects(() => db.query('select public.get_visual_workflow_review($1,$2)', [request, 'banner']), { code: '42501' })
  await assert.rejects(() => db.query('select public.list_my_visual_workflow_notices()'), { code: '42501' })
  console.log('PASS Visual workflow: legacy preservation, same and changed worker assignments, private counters, role-scoped feedback, notice/read versions, idempotency and overall completion')
} catch (error) {
  console.error({ message: error.message, code: error.code, detail: error.detail, where: error.where, stack: error.stack?.split('\n').slice(0, 7).join('\n') })
  process.exitCode = 1
} finally {
  await db.close()
}
