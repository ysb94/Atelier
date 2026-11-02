import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createWorkTestDb, ids, departments } from './work-request-test-db.mjs'

const db = await createWorkTestDb()
const company = 'e0000000-0000-4000-8000-000000000001'
const migration = 'supabase/migrations/20261102043240_work_request_explicit_managers.sql'
const owners = ['planning', 'design', 'md', 'logistics']
async function actor(id) { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]); await db.exec('set role authenticated') }
async function scalar(sql, args = []) { return Object.values((await db.query(sql, args)).rows[0])[0] }
async function denied(sql, args) { await assert.rejects(() => db.query(sql, args), error => error.code === '42501') }
async function snapshot() {
  return scalar(`select jsonb_build_object(
   'profiles',(select md5(jsonb_agg(to_jsonb(p) order by id)::text) from public.profiles p),
   'grants',(select md5(jsonb_agg(to_jsonb(g) order by id)::text) from public.permission_grants g),
   'otherFunctions',(select md5(string_agg(pg_get_functiondef(p.oid),'|' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('app','public') and p.proname not in ('work_manage_allowed','list_work_requests')))`)
}
try {
  await db.exec(await readFile('supabase/migrations/20261102034546_work_request_category_settings.sql', 'utf8'))
  await db.query("update public.profiles set position='팀장',is_admin=true where id=$1", [ids.design])
  await db.query("update public.profiles set position='이사' where id=$1", [ids.logistics])
  const before = await snapshot()
  await db.exec(await readFile(migration, 'utf8'))
  assert.deepEqual(await snapshot(), before, '직원·기존 지정·다른 서버 함수는 변경하지 않는다')
  for (const id of [ids.design, ids.logistics, ids.ordinary]) {
    await actor(id)
    for (const owner of owners) assert.equal(await scalar('select app.work_manage_allowed($1)', [owner]), false, '팀장·이사·일반 관리자는 자동 업무 관리자 아님')
    assert.deepEqual((await scalar('select public.get_my_basic_work_access()')).manageOwners, [])
  }
  for (const id of [ids.developer, ids.delegate, ids.ceo]) {
    await actor(id)
    for (const owner of owners) assert.equal(await scalar('select app.work_manage_allowed($1)', [owner]), true, '예외 세 계정은 전체 업무 관리자')
    assert.equal((await scalar("select public.get_work_request_settings('design')")).canManage, true)
    assert.deepEqual(new Set((await scalar('select public.get_my_basic_work_access()')).manageOwners), new Set(owners))
    assert.equal(await scalar("select app.work_manage_allowed('invalid')"), false)
  }
  await actor(ids.manager)
  assert.equal(await scalar("select app.work_manage_allowed('design')"), true)
  assert.equal(await scalar("select app.work_manage_allowed('md')"), false, '부서 지정 범위 유지')
  await actor(ids.planner)
  const request = crypto.randomUUID()
  let revision = await scalar("select public.begin_work_request($1,'design')", [request])
  revision = await scalar('select public.save_work_request($1,$2,$3,$4)', [request, revision, { status: 'requested', values: { title: '관리 권한 검증', dueDate: '2030-01-01', blocks: [{ id: 'body', type: 'text', text: '공통 본문' }], referenceFiles: [], visualRequest: { categories: [{ id: 'sns', fields: {} }] } } }, crypto.randomUUID()])
  for (const id of [ids.design, ids.logistics, ids.outsider]) {
    await actor(id)
    assert.equal((await scalar("select public.list_work_requests('design')"))?.requests.length ?? 0, 0)
    await denied('select public.save_work_request($1,$2,$3,$4)', [request, revision, { status: 'reviewing' }, crypto.randomUUID()])
    await denied("select public.assign_work_request_category($1,'sns',$2,$3)", [request, ids.design, revision])
  }
  await actor(ids.developer)
  revision = await scalar('select public.save_work_request($1,$2,$3,$4)', [request, revision, { status: 'reviewing' }, crypto.randomUUID()])
  revision = await scalar("select public.assign_work_request_category($1,'sns',$2,$3)", [request, ids.design, revision])
  await actor(ids.ceo)
  revision = await scalar('select public.save_work_request($1,$2,$3,$4)', [request, revision, { status: 'accepted', assignee: ids.design, collaborators: [] }, crypto.randomUUID()])
  assert.ok(revision > 1)
  await db.exec('reset role')
  await db.query("delete from public.permission_grants where profile_id=$1", [ids.manager])
  await actor(ids.manager)
  assert.equal(await scalar("select app.work_manage_allowed('design')"), false, '해제 즉시 관리 권한 제거')
  await denied('select public.save_work_request($1,$2,$3,$4)', [request, revision, { managerPriority: 'urgent' }, crypto.randomUUID()])
  await db.exec('reset role')
  await db.query("insert into public.permission_grants(id,profile_id,company_id,permission,scope_kind,scope_id) values(gen_random_uuid(),$1,$2,'work.manage','company',$2)", [ids.ordinary, company])
  await actor(ids.ordinary)
  for (const owner of owners) assert.equal(await scalar('select app.work_manage_allowed($1)', [owner]), true, '회사 범위 지정은 전체 부서 관리')
  await db.exec('reset role')
  await db.query("delete from public.permission_grants where permission='work.manage'")
  await db.query("update public.profiles set status='pending' where id=any($1::uuid[])", [[ids.developer, ids.delegate, ids.ceo]])
  await actor(ids.planner)
  assert.equal((await scalar("select public.list_work_requests('design')")).managerAvailable, false, '지정 없는 팀장·이사는 관리자 존재 판정에서도 제외')
  await actor(ids.developer)
  assert.equal(await scalar("select app.work_manage_allowed('design')"), false, '미승인 운영 계정 차단')
  await db.exec('reset role')
  await db.query("update public.profiles set status='active',company_id='e0000000-0000-4000-8000-000000000002' where id=$1", [ids.developer])
  await actor(ids.developer)
  assert.equal(await scalar("select app.work_manage_allowed('design')"), false, '다른 회사 계정 차단')
  console.info('PASS: 직책·관리자 여부 자동 권한 제거, 부서/회사 지정·해제, 예외 3계정 전체 접수·배정·조회·설정, 직접 요청 차단, 기존 사용자·지정·다른 함수 보존')
} finally { await db.close() }
