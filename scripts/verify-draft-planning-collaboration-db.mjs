import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createWorkTestDb, departments, ids } from './work-request-test-db.mjs'

const company = 'e0000000-0000-4000-8000-000000000001'
const brand = 'b0000000-0000-4000-8000-000000000001'
const db = await createWorkTestDb()
const migration = async name => (await readFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8')).replaceAll('\r\n', '\n')
const scalar = async (query, args = []) => Object.values((await db.query(query, args)).rows[0])[0]
const actor = async id => {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id])
  await db.exec('set role authenticated')
}
const saveDraft = (id, payload) => scalar("select public.save_product_draft($1,$2,$3,$4,'[]','[]')", [company, brand, id, payload])

try {
  await db.exec(`
    create table public.department_workforce_policies(company_id uuid, department_id uuid, mode text, contact_ids uuid[]);
    alter table public.seasons add unique (brand_id, id);
    alter table public.product_drafts add foreign key (brand_id, season_id) references public.seasons(brand_id, id);
  `)
  const chinaWorkOrders = await migration('20261105133000_china_color_work_ship')
  await db.exec(chinaWorkOrders.slice(chinaWorkOrders.indexOf('create or replace function app.china_work_order')))
  for (const name of [
    '20261106120000_china_assigned_work_orders',
    '20261106121000_china_assigned_round_history',
    '20261106130000_china_assignee_receipt',
    '20261106131500_china_assignee_receipt_closed',
    '20261106134500_china_assigned_order_elapsed_days',
    '20261124121357_require_china_work_order_receipt_before_shipping',
    '20261125100000_sample_work_order_packs',
    '20261125100001_sample_work_order_attachment_capacity',
  ]) await db.exec(await migration(name))

  const folder = crypto.randomUUID()
  const otherBrand = crypto.randomUUID()
  const otherFolder = crypto.randomUUID()
  await db.query('insert into public.brands(id,company_id) values($1,$2)', [otherBrand, company])
  await db.query('insert into public.seasons(id,brand_id) values($1,$2),($3,$4)', [folder, brand, otherFolder, otherBrand])
  await db.query("insert into public.department_workforce_policies values($1,$2,'external',array[$3::uuid])", [company, departments.china, ids.china])
  await db.query('update public.profiles set department_id=$1 where id=$2', [departments.planning, ids.outsider])
  await db.query("insert into public.profile_capabilities(profile_id,capability) values($1,'planning')", [ids.md])
  await actor(ids.planner)
  const draft = await saveDraft(null, { owner:'원 작성자', nameKo:'협업 기획안', originCountry:'중국' })
  await actor(ids.planner2)
  assert.equal(await scalar('select app.draft_write_allowed($1)', [draft]), false)
  await assert.rejects(db.query("select public.open_sample_work_order_pack($1,'first')", [draft]), {code:'42501'})

  await db.exec('reset role')
  await db.exec(await migration('20261126081745_draft_planning_collaboration'))
  await actor(ids.planner2)
  assert.equal((await scalar('select public.get_my_basic_work_access()')).planningDepartmentMember, true)
  assert.equal(await scalar('update public.product_drafts set season_id=$2 where id=$1 returning season_id', [draft, folder]), folder)
  await assert.rejects(db.query('update public.product_drafts set season_id=$2 where id=$1', [draft, otherFolder]), {code:'23503'})
  await assert.rejects(db.query('update public.product_drafts set created_by=$2 where id=$1', [draft, ids.planner2]), {code:'42501'})

  const pack = await scalar("select public.open_sample_work_order_pack($1,'first')", [draft])
  const path = pack.id + '/' + crypto.randomUUID()
  const files = [{path, name:'작업지시서.pdf', size:42, sha256:'a'.repeat(64)}]
  await db.query("insert into storage.objects(bucket_id,name,metadata) values('sample-work-orders',$1,$2)", [path, {size:42}])
  const registered = await scalar("select public.save_sample_work_order_pack($1,$2,$3,'')", [pack.id, pack.revision, JSON.stringify(files)])
  const sampleWorkOrders = [{ id:'order-1', url:`atelier-sample-pack:${pack.id}:${registered.revision}`, name:'작업지시서.pdf', originCountry:'중국' }]
  const expectedUpdatedAt = await scalar('select updated_at::text from public.product_drafts where id=$1', [draft])
  await saveDraft(draft, { owner:'원 작성자', nameKo:'동료가 편집', originCountry:'중국', seasonId:folder, sampleWorkOrders, expectedUpdatedAt })
  assert.deepEqual((await db.query('select created_by,owner,name_ko,season_id from public.product_drafts where id=$1', [draft])).rows,
    [{created_by:ids.planner, owner:'원 작성자', name_ko:'동료가 편집', season_id:folder}])
  assert.equal((await db.query('delete from public.product_drafts where id=$1 returning id', [draft])).rows.length, 0)
  await assert.rejects(saveDraft(draft, { nameKo:'오래된 수정', expectedUpdatedAt }), {code:'40001'})

  await actor(ids.china)
  const published = await scalar('select public.get_sample_work_order_pack($1,null,null)', [pack.id])
  assert.equal(published.published, true)
  assert.deepEqual(published.files, files)
  assert.equal(await scalar('select count(*)::int from storage.objects where name=$1', [path]), 1)

  await db.exec('reset role')
  await db.query("update public.profiles set department_id=$1,status='pending' where id=$2", [departments.planning, ids.ordinary])
  for (const id of [ids.md, ids.china, ids.outsider, ids.ordinary]) {
    await actor(id)
    assert.equal((await scalar('select public.get_my_basic_work_access()')).planningDepartmentMember, false)
    assert.equal(await scalar('select app.draft_write_allowed($1)', [draft]), false)
    assert.equal((await db.query('update public.product_drafts set season_id=null where id=$1 returning id', [draft])).rows.length, 0)
    await assert.rejects(db.query("select public.open_sample_work_order_pack($1,'next')", [draft]), {code:'42501'})
  }
  await db.exec('reset role')
  await db.query('update public.departments set is_active=false where id=$1', [departments.planning])
  await actor(ids.planner2)
  assert.equal(await scalar('select app.draft_write_allowed($1)', [draft]), false)
  await actor(ids.ceo)
  assert.equal(await scalar('select app.draft_owner_access($1)', [draft]), true)
  await actor(ids.planner)
  assert.equal(await scalar('delete from public.product_drafts where id=$1 returning id', [draft]), draft)
  await db.exec('reset role;set role anon')
  await assert.rejects(db.query('select public.get_my_basic_work_access()'), {code:'42501'})
  console.log('Draft collaboration DB: coworker folder move, work order upload and publication, China receipt visibility, revision checks, owner-only deletion and permission boundaries passed.')
} catch (error) {
  console.error('Draft collaboration DB:', {message:error.message, code:error.code, where:error.where})
  process.exitCode = 1
} finally {
  await db.close()
}
