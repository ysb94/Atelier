import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createWorkTestDb, ids, departments } from './work-request-test-db.mjs'

const db = await createWorkTestDb()
const company = 'e0000000-0000-4000-8000-000000000001'
const secondDesigner = '11000000-0000-4000-8000-000000000001'
const migration = 'supabase/migrations/20261102034546_work_request_category_settings.sql'
async function actor(id) { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]); await db.exec('set role authenticated') }
async function rpc(name, values = []) { return (await db.query(`select public.${name}(${values.map((_, index) => '$' + (index + 1)).join(',')}) value`, values)).rows[0].value }
async function denied(operation, code) { await assert.rejects(operation, error => !code || error.code === code) }
const values = (categories) => ({ title: '공통 메인과 여러 작업', dueDate: '2030-01-01', blocks: [{ id: 'main', type: 'text', text: '하나의 공통 메인 내용' }], referenceFiles: [], visualRequest: { categories } })
const category = (id, fields = {}) => ({ id, label: '위조한 이름', fields })
async function create(categories, id = crypto.randomUUID()) {
  const revision = await rpc('begin_work_request', [id, 'design'])
  await rpc('save_work_request', [id, revision, { values: values(categories), status: 'requested' }, crypto.randomUUID()])
  return id
}
async function read(id) { return (await rpc('list_work_requests', ['design'])).requests.find(request => request.id === id) }
try {
  await db.query("insert into public.profiles(id,company_id,department_id,display_name,status,is_admin,position) values($1,$2,$3,'두번째 디자이너','active',false,'')", [secondDesigner, company, departments.design])
  const before = (await db.query('select jsonb_agg(to_jsonb(p) order by id) snapshot from public.profiles p')).rows[0].snapshot
  await db.exec(await readFile(migration, 'utf8'))
  assert.deepEqual((await db.query('select jsonb_agg(to_jsonb(p) order by id) snapshot from public.profiles p')).rows[0].snapshot, before, '마이그레이션은 직원 정보를 변경하지 않는다')
  await actor(ids.manager)
  let settings = await rpc('get_work_request_settings', ['design'])
  assert.equal(settings.canManage, true)
  assert.equal(settings.categories.length, 11)
  const categories = settings.categories.map(item => ({ ...item, assigneeId: item.id === 'banner' ? ids.design : item.id === 'advertising' ? secondDesigner : '' }))
  categories.find(item => item.id === 'banner').fields[0].required = true
  let version = await rpc('save_work_request_settings', ['design', settings.revision, categories])
  await denied(rpc('save_work_request_settings', ['design', settings.revision, categories]), '40001')
  await denied(rpc('save_work_request_settings', ['design', version, [...categories, categories[0]]]))
  const cross = structuredClone(categories); cross[0].assigneeId = ids.planner
  await denied(rpc('save_work_request_settings', ['design', version, cross]))
  await actor(ids.ordinary)
  assert.equal((await rpc('get_work_request_settings', ['design'])).canManage, false)
  await denied(rpc('save_work_request_settings', ['design', version, categories]), '42501')
  await denied(db.query("update public.work_request_settings set categories='[]'"), '42501')
  await actor(ids.outsider)
  assert.equal((await rpc('get_work_request_settings', ['design'])).categories.length, 0)
  await denied(rpc('save_work_request_settings', ['design', 0, categories]), '42501')
  await actor(ids.planner)
  await denied(create([category('banner')]))
  await denied(create([category('missing')]))
  await denied(create([category('sns'), category('sns')]))
  const request = await create([category('banner', { 'field-1': '메인 기반 배너' }), category('advertising'), category('sns')])
  const snapshot = await read(request)
  assert.equal(snapshot.status, 'requested', '기존 접수 절차를 자동 수락으로 바꾸지 않는다')
  assert.deepEqual(snapshot.categoryAssignments.map(item => item.assigneeId), [ids.design, secondDesigner, ''])
  assert.deepEqual(new Set(snapshot.collaborators), new Set([ids.design, secondDesigner]))
  assert.equal(snapshot.values.visualRequest.categories[0].label, '배너', '제목은 서버의 설정을 사용한다')
  assert.equal(snapshot.values.visualRequest.categories[0].fieldLabels['field-1'], '배너 용도')
  assert.equal(snapshot.values.blocks[0].text, '하나의 공통 메인 내용')
  const replay = crypto.randomUUID()
  const after = await rpc('save_work_request', [request, snapshot.revision, { values: snapshot.values }, replay])
  assert.equal(await rpc('save_work_request', [request, snapshot.revision, { values: snapshot.values }, replay]), after)
  const invalidEdit = structuredClone(snapshot.values); invalidEdit.visualRequest.categories[0].fields = {}
  await denied(rpc('save_work_request', [request, after, { values: invalidEdit }, crypto.randomUUID()]))
  await denied(rpc('assign_work_request_category', [request, 'sns', ids.design, after]), '42501')
  for (const id of [ids.design, secondDesigner]) { await actor(id); assert.ok(await read(request), '자동 배정된 각 담당자는 공통 요청을 조회한다') }
  await actor(ids.planner2); assert.equal(await read(request), undefined, '같은 부서 동료는 남의 요청을 조회하지 못한다')
  await actor(ids.manager)
  await denied(rpc('assign_work_request_category', [request, 'sns', ids.planner, after]))
  const assigned = await rpc('assign_work_request_category', [request, 'sns', ids.design, after])
  await denied(rpc('assign_work_request_category', [request, 'sns', secondDesigner, after]), '40001')
  assert.equal((await read(request)).categoryAssignments[2].assigneeId, ids.design)
  const changed = structuredClone(categories); changed.find(item => item.id === 'banner').assigneeId = secondDesigner
  version = await rpc('save_work_request_settings', ['design', version, changed])
  assert.equal((await read(request)).categoryAssignments[0].assigneeId, ids.design, '설정 변경은 기존 요청을 재배정하지 않는다')
  const reset = await rpc('assign_work_request_category', [request, 'banner', null, assigned])
  assert.ok(reset > assigned)
  assert.equal((await read(request)).categoryAssignments[0].assigneeId, '')
  const legacyId = crypto.randomUUID()
  await actor(ids.planner)
  const legacyRevision = await rpc('begin_work_request', [legacyId, 'design'])
  const legacyValues = values([]); delete legacyValues.visualRequest
  await rpc('save_work_request', [legacyId, legacyRevision, { values: legacyValues, status: 'requested' }, crypto.randomUUID()])
  assert.equal((await read(legacyId)).values.blocks[0].text, '하나의 공통 메인 내용', '이전 클라이언트의 저장도 유지한다')
  await actor(ids.manager)
  await db.exec('reset role')
  await db.query("update public.profiles set status='pending' where id=$1", [secondDesigner])
  await actor(ids.planner)
  const inactive = await create([category('banner', { 'field-1': '담당자 비활성 확인' })])
  assert.equal((await read(inactive)).categoryAssignments[0].assigneeId, '', '비활성 담당자는 관리자 배정으로 돌아간다')
  console.info('PASS: 설정 CRUD·동시 변경·필수 입력·같은 부서 담당자·자동 배정·미지정 수동 배정·회사 격리·위조·중복 저장·기존 요청과 계정 보존')
} finally { await db.close() }
