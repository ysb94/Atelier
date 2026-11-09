import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createWorkTestDb, departments, ids } from './work-request-test-db.mjs'

const db = await createWorkTestDb()
const company = 'e0000000-0000-4000-8000-000000000001'
const secondDesigner = '11000000-0000-4000-8000-000000000001'
const request = crypto.randomUUID()
const bucket = 'company-work-requests'

async function actor(id) {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id])
  await db.exec('set role authenticated')
}

async function rpc(name, args) {
  const placeholders = args.map((_, i) => '$' + (i + 1)).join(',')
  return (await db.query('select public.' + name + '(' + placeholders + ') value', args)).rows[0].value
}

const list = category => rpc('list_visual_work_category_comments', [request, category])
const save = (category, id, body, reply = null, files = [], publish = false) =>
  rpc('save_visual_work_category_comment', [request, category, id, body, reply, files, publish])
const denied = (promise, code = '42501') => assert.rejects(promise, error => error.code === code)
const stored = path => db.query('select name from storage.objects where bucket_id=$1 and name=$2', [bucket, path])
const upload = (path, size = 12) => db.query(
  'insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)', [bucket, path, { size }],
)

try {
  await db.query("insert into public.profiles(id,company_id,department_id,display_name,status,is_admin,position) values($1,$2,$3,'두번째 담당자','active',false,'')",
    [secondDesigner, company, departments.design])
  await db.exec(await readFile('supabase/migrations/20261102034546_work_request_category_settings.sql', 'utf8'))
  await actor(ids.manager)
  const settings = await rpc('get_work_request_settings', ['design'])
  await rpc('save_work_request_settings', ['design', settings.revision, settings.categories.map(item => ({
    ...item, assigneeId: item.id === 'banner' ? ids.design : item.id === 'advertising' ? secondDesigner : '',
  }))])

  await actor(ids.planner)
  const revision = await rpc('begin_work_request', [request, 'design'])
  await rpc('save_work_request', [request, revision, { status: 'requested', values: {
    title: '분류별 댓글 검증', dueDate: '2030-01-01', referenceFiles: [],
    blocks: [
      { id: 'common', type: 'text', text: '공통 내용' },
      { id: 'visual-request-section:banner', type: 'text', text: '배너 작업 요청' },
      { id: 'banner-body', type: 'text', text: '배너 내용' },
      { id: 'visual-request-section:advertising', type: 'text', text: '광고 소재 작업 요청' },
    ],
    visualRequest: { categories: ['banner','advertising'].map(id => ({ id, label: id, fields: {} })) },
  } }, crypto.randomUUID()])
  await rpc('send_work_request_message', [request, 'requester', '분류 없는 이전 대화', crypto.randomUUID()])

  const before = await rpc('list_work_requests', ['design'])
  await db.exec('reset role')
  await db.exec(await readFile('supabase/migrations/20261109052445_visual_work_category_comments.sql', 'utf8'))
  await actor(ids.planner)
  assert.deepEqual(await rpc('list_work_requests', ['design']), before, 'the migration preserves request, assignments and legacy messages')
  assert.deepEqual(await list('banner'), { canWrite: true, items: [] })
  assert.deepEqual(await list('advertising'), { canWrite: true, items: [] })
  await denied(list('main'))

  await actor(ids.design)
  await denied(list('advertising'))
  await denied(save('advertising', crypto.randomUUID(), '다른 분류 쓰기'))
  await denied(db.query('select * from app.visual_work_category_comments'))
  const first = crypto.randomUUID()
  assert.deepEqual(await save('banner', first, '배너 댓글'), { published: true, files: [] })
  assert.deepEqual(await save('banner', first, '배너 댓글'), { published: true, files: [] })
  await denied(save('banner', first, '다른 내용'), '40001')
  assert.equal((await list('banner')).items.length, 1, 'retry does not duplicate comments')

  const fileComment = crypto.randomUUID()
  const files = [{ name: '배너 시안.png', type: 'image/png', size: 12 }]
  const draft = await save('banner', fileComment, '배너 답글', first, files)
  assert.equal(draft.published, false)
  const path = draft.files[0].path
  assert.equal(draft.files[0].uploaded, false)
  await denied(save('banner', fileComment, '배너 답글', first, files, true), '22023')
  await denied(upload(path + '-forged'))
  await denied(save('banner', crypto.randomUUID(), '', null, [{ name: '위험.exe', type: 'application/octet-stream', size: 12 }]), '22023')
  assert.equal((await list('banner')).items.length, 1, 'staged uploads do not appear as comments')

  await actor(secondDesigner)
  await denied(upload(path))
  assert.equal((await stored(path)).rows.length, 0)
  await denied(save('advertising', crypto.randomUUID(), '다른 분류에 답글', first), '22023')
  const ad = crypto.randomUUID()
  await save('advertising', ad, '광고 소재 댓글')
  assert.deepEqual((await list('advertising')).items.map(item => item.body), ['광고 소재 댓글'])

  await actor(ids.design)
  await upload(path)
  assert.equal((await save('banner', fileComment, '배너 답글', first, files)).files[0].uploaded, true)
  assert.equal((await save('banner', fileComment, '배너 답글', first, files, true)).published, true)
  assert.equal((await save('banner', fileComment, '배너 답글', first, files)).published, true)
  await denied(save('banner', crypto.randomUUID(), '두 단계 답글', fileComment), '22023')
  const banner = (await list('banner')).items
  assert.equal(banner[1].replyTo, first)
  assert.equal(banner[1].files[0].name, files[0].name)
  assert.equal((await stored(path)).rows.length, 1)
  assert.equal((await db.query('delete from storage.objects where name=$1 returning name',[path])).rows.length, 0,
    'a retry cannot remove a published file')

  await actor(secondDesigner)
  await denied(list('banner'))
  assert.equal((await stored(path)).rows.length, 0, 'old request attachment policies cannot expose a category file')
  for (const id of [ids.ordinary, ids.planner2, ids.outsider]) {
    await actor(id)
    await denied(list('banner'))
    assert.equal((await stored(path)).rows.length, 0)
  }

  await actor(ids.planner)
  assert.deepEqual(await rpc('list_work_requests', ['design']), before, 'category posts are isolated from legacy records and the existing chat API')
  await actor(ids.manager)
  const record = (await rpc('list_work_requests', ['design'])).requests.find(item => item.id === request)
  const assignedRevision = await rpc('assign_work_request_category', [request, 'banner', secondDesigner, record.revision])
  assert.equal((await list('banner')).items.length, 2)
  assert.equal((await list('advertising')).items.length, 1)
  await actor(ids.design)
  await denied(list('banner'))
  assert.equal((await stored(path)).rows.length, 0, 'reassignment revokes the old assignee’s attachment access')
  await actor(secondDesigner)
  assert.equal((await list('banner')).items.length, 2, 'the new assignee inherits the thread')
  assert.equal((await stored(path)).rows.length, 1)

  await actor(ids.planner)
  assert.deepEqual(await rpc('delete_work_request', [request, assignedRevision]), [path])
  await denied(list('banner'))
  const pending = (await rpc('list_work_requests', ['design'])).files.filter(item => item.deleted)
  assert.deepEqual(pending.map(item => item.path), [path], 'older clients can retry the existing deletion flow')
  await rpc('finish_work_request_delete', [request])
  assert.equal((await stored(path)).rows.length, 1)
  await actor(secondDesigner)
  assert.equal((await db.query('delete from storage.objects where name=$1 returning name',[path])).rows.length, 0)
  await actor(ids.planner)
  assert.equal((await db.query('delete from storage.objects where name=$1 returning name',[path])).rows.length, 1)
  await rpc('finish_work_request_delete', [request])
  assert.equal((await rpc('list_work_requests', ['design'])).files.length, 0)

  await db.exec('reset role; set role anon')
  await denied(list('banner'))
  await db.exec('reset role')
  assert.equal((await db.query('select count(*)::int count from app.visual_work_category_comments')).rows[0].count, 0)
  console.info('PASS Visual category comments: role and Storage isolation, replies, upload retry, reassignment, legacy compatibility, deletion cleanup')
} finally {
  await db.close()
}
