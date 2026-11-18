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
  '20261118104500_sent_visual_request_content_edits',
]
const db = await createWorkTestDb()
const company = 'e0000000-0000-4000-8000-000000000001'
const supervisor = crypto.randomUUID()
const middle = ids.design
const videoMiddle = crypto.randomUUID()
const worker = crypto.randomUUID()
const videoWorker = crypto.randomUUID()
const request = crypto.randomUUID()

async function rpc(id, name, args = []) {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id])
  await db.exec('set role authenticated')
  const params = args.map((_, index) => '$' + (index + 1)).join(',')
  return (await db.query('select public.' + name + '(' + params + ') as data', args)).rows[0].data
}

const text = (id, content) => ({ id, type: 'text', text: content })
const initial = {
  title: '가방 팝업', dueDate: '2030-01-01', referenceFiles: [],
  blocks: [text('main','메인'), text('visual-request-section:banner','배너'), text('banner','배너 본문'),
    text('visual-request-section:video','영상'), text('video','영상 본문')],
  visualRequest: { categories: [{ id: 'banner', fields: {} }, { id: 'video', fields: {} }] },
}
const contentNotices = async (actor, version) => (await rpc(actor, 'list_my_visual_workflow_notices'))
  .filter(row => row.requestId === request && row.kind === 'content_updated' && (version === undefined || row.version === version))
const detail = async () => (await rpc(ids.planner, 'get_department_work', [request])).requests[0]
const save = (actor, revision, values, command = crypto.randomUUID()) => rpc(actor, 'save_work_request', [request, revision, { values }, command])

try {
  for (const name of migrations) await db.exec(await readFile(`supabase/migrations/${name}.sql`, 'utf8'))
  for (const id of [supervisor, videoMiddle, worker, videoWorker]) {
    await db.query("insert into public.profiles(id,company_id,department_id,display_name,status,is_admin,position) values($1,$2,$3,'검증 직원','active',false,'')", [id, company, departments.design])
  }
  const settings = await rpc(ids.manager, 'get_work_request_settings', ['design'])
  const categories = settings.categories.map(category => ({ ...category,
    assigneeId: category.id === 'banner' ? middle : category.id === 'video' ? videoMiddle : '',
  }))
  await rpc(ids.manager, 'save_visual_work_request_settings', [settings.revision, categories, [supervisor]])

  let revision = await rpc(ids.planner, 'begin_work_request', [request, 'design'])
  revision = await rpc(ids.planner, 'publish_visual_category_work', [request, revision, { values: initial, status: 'requested' }, crypto.randomUUID()])
  assert.deepEqual(await contentNotices(supervisor), [])
  const pendingBefore = await detail()
  const pendingEdit = { ...pendingBefore.values, title: '가방 팝업 요청' }
  revision = await save(ids.planner, revision, pendingEdit)
  for (const actor of [supervisor, middle, videoMiddle]) {
    assert.deepEqual((await contentNotices(actor, revision)).map(row => row.categoryId), [''])
  }
  const workflow = (actor, category, action, person = null) => rpc(actor, 'change_visual_category_work', [request, category, revision, action, person, '', '', crypto.randomUUID()])
  revision = await workflow(supervisor, '', 'receipt')
  revision = await workflow(middle, 'banner', 'assign_worker', worker)
  revision = await workflow(videoMiddle, 'video', 'assign_worker', videoWorker)
  const before = await detail()

  const mainEdit = { ...before.values, blocks: before.values.blocks.map(block => block.id === 'main' ? { ...block, text: '메인 수정' } : block) }
  const command = crypto.randomUUID()
  const mainRevision = await save(ids.planner, revision, mainEdit, command)
  assert.equal(await save(ids.planner, revision, mainEdit, command), mainRevision)
  for (const actor of [supervisor, middle, videoMiddle, worker, videoWorker]) {
    const rows = await contentNotices(actor, mainRevision)
    assert.equal(rows.length, 1, `메인 수정 알림 수 ${actor}`)
    assert.equal(rows[0].categoryId, '')
    assert.equal(rows[0].readAt, null)
  }
  assert.deepEqual(await contentNotices(ids.outsider), [])
  assert.deepEqual(await contentNotices(ids.planner), [])
  await assert.rejects(() => save(worker, mainRevision, mainEdit), { code: '42501' })
  await assert.rejects(() => save(ids.planner, revision, mainEdit), { code: '40001' })
  await assert.rejects(() => rpc(ids.planner, 'save_work_request', [request, mainRevision, { values: mainEdit, assignee: ids.planner }, crypto.randomUUID()]), { code: '42501' })

  const bannerEdit = { ...mainEdit, blocks: mainEdit.blocks.map(block => block.id === 'banner' ? { ...block, text: '배너 본문 수정' } : block) }
  const bannerRevision = await save(ids.planner, mainRevision, bannerEdit)
  for (const actor of [supervisor, middle, worker]) {
    const rows = await contentNotices(actor, bannerRevision)
    assert.deepEqual(rows.map(row => row.categoryId), ['banner'])
  }
  for (const actor of [videoMiddle, videoWorker]) assert.deepEqual(await contentNotices(actor, bannerRevision), [])
  const [bannerNotice] = await contentNotices(worker, bannerRevision)
  await rpc(worker, 'read_my_visual_workflow_notices', [request, 'video', bannerRevision, [bannerNotice.id]])
  await rpc(worker, 'read_my_visual_workflow_notices', [request, 'banner', mainRevision, [bannerNotice.id]])
  assert.equal((await contentNotices(worker, bannerRevision))[0].readAt, null)
  await rpc(worker, 'read_my_visual_workflow_notices', [request, 'banner', bannerRevision, [bannerNotice.id]])
  assert.ok((await contentNotices(worker, bannerRevision))[0].readAt)
  assert.equal((await contentNotices(middle, bannerRevision))[0].readAt, null)

  const after = await detail()
  assert.deepEqual(after.visualCategoryWorkflow, before.visualCategoryWorkflow)
  assert.deepEqual(after.categoryAssignments, before.categoryAssignments)
  assert.equal(after.status, before.status)
  assert.equal(after.values.blocks.find(block => block.id === 'banner').text, '배너 본문 수정')
  await assert.rejects(() => save(ids.planner, bannerRevision, { ...bannerEdit, blocks: bannerEdit.blocks.slice(0, 3),
    visualRequest: { categories: bannerEdit.visualRequest.categories.filter(item => item.id === 'banner') },
  }), { code: '22023' })
  const reserved = await rpc(ids.planner, 'begin_work_request_file', [request, '새 참고자료.txt', 'text/plain', 3])
  assert.ok(reserved.path.endsWith(reserved.id))
  const unchanged = await save(ids.planner, bannerRevision, bannerEdit)
  assert.deepEqual(await contentNotices(supervisor, unchanged), [])
  console.log('sent Visual request edits: sender, scope, files, revisions, notifications and read state passed')
} finally {
  await db.close()
}
