import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const db = await PGlite.create()
const company = 'e0000000-0000-4000-8000-000000000001'
const planning = 'ced99f89-ea80-4eeb-8f03-272bf72f5db1'
const author = crypto.randomUUID()
const outsider = crypto.randomUUID()
const brand = crypto.randomUUID()
const otherBrand = crypto.randomUUID()
const online = crypto.randomUUID()
const offline = crypto.randomUUID()
const sabangnet = crypto.randomUUID()
const offlineSabangnet = crypto.randomUUID()
const subfolder = crypto.randomUUID()
const active = crypto.randomUUID()
const removed = crypto.randomUUID()
const unrelated = crypto.randomUUID()
const misplaced = crypto.randomUUID()
const crossBrand = crypto.randomUUID()
const migration = 'supabase/migrations/20261123081348_draft_sabangnet_partners.sql'

async function role(id) {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id])
  await db.exec('set role authenticated')
}

try {
  for (const file of [
    'supabase/tests/department_work_fixture.sql',
    'supabase/migrations/20261027044909_department_work_access.sql',
    'supabase/migrations/20261118062623_draft_information_temporary.sql',
    'supabase/migrations/20261118071459_save_draft_colors.sql',
    'supabase/migrations/20261122161836_draft_visual_html.sql',
    'supabase/migrations/20261122163508_draft_team_work.sql',
    'supabase/migrations/20261123053353_draft_visual_assignments_and_status.sql',
    'supabase/migrations/20261123062029_draft_shared_color_photos.sql',
  ]) await db.exec(await readFile(file, 'utf8'))
  const otherCompany = crypto.randomUUID()
  await db.query('insert into public.companies(id) values ($1), ($2)', [company, otherCompany])
  await db.query("insert into public.departments(id,company_id,name,is_active) values ($1,$2,'기획팀',true)", [planning, company])
  await db.query(`insert into public.profiles(id,company_id,department_id,display_name,status,is_admin)
    values ($1,$2,$3,'기획','active',false), ($4,$5,null,'외부','active',false)`, [author, company, planning, outsider, otherCompany])
  await db.query('insert into public.brands(id,company_id,slug) values ($1,$3,$4), ($2,$3,$5)',
    [brand, otherBrand, company, 'test', 'other'])
  for (const [id, parent, name] of [
    [online, null, '온라인'], [offline, null, '오프라인'], [sabangnet, online, '사방넷'],
    [offlineSabangnet, offline, '사방넷'], [subfolder, sabangnet, '하위'],
  ]) {
    await db.query('insert into public.code_usage_target_folders(id,brand_id,parent_id,name,normalized_name) values ($1,$2,$3,$4,$4)',
      [id, brand, parent, name])
  }
  for (const [id, brandId, folder, name, enabled] of [
    [active, brand, subfolder, '연결 업체', true], [removed, brand, sabangnet, '휴업 업체', false],
    [unrelated, brand, online, '일반 온라인 업체', true], [misplaced, brand, offlineSabangnet, '오프라인 업체', true],
    [crossBrand, otherBrand, sabangnet, '다른 브랜드 업체', true],
  ]) {
    await db.query('insert into public.code_usage_targets(id,brand_id,folder_id,name,active) values ($1,$2,$3,$4,$5)',
      [id, brandId, folder, name, enabled])
  }

  await role(author)
  const saveDraft = async (id, openTypeDetail, specs = {}) => (await db.query(
    "select public.save_product_draft($1,$2,$3,$4,'[]','[]') id",
    [company, brand, id, { nameKo: '사방넷 업체 검증', openTypeDetail, specs }],
  )).rows[0].id
  const draft = await saveDraft(null, '오프라인')
  const channel = async () => (await db.query(
    'select open_type_detail, specs from public.product_drafts where id = $1', [draft],
  )).rows[0]
  const html = async (key, payload, revision = null) => (await db.query(
    'select * from public.save_draft_visual_content($1,$2,null)',
    [draft, JSON.stringify([{ kind: 'vendor-html', entry_key: key, payload, revision }])],
  )).rows[0]
  const md = async (partnerId, revision = null, extra = {}) => (await db.query(
    "select * from public.save_draft_team_work($1,'md-listing',$2,true,$3)",
    [draft, { registerType: 'register-single', registerLabel: '단품 등록', openType: 'open-early', openLabel: '선발매', partnerId,
      partner: '임시 표기', from: '2026-11-25', to: '2026-11-26', assignee: '', ...extra }, revision],
  )).rows[0]
  const legacy = await html('무신사', { top: '<p>기존</p>', bottom: '' })

  await db.exec('reset role')
  const functions = ['public.save_draft_team_work(uuid,text,jsonb,boolean,uuid)', 'public.save_draft_visual_content(uuid,jsonb,uuid)']
  const permissions = async () => (await db.query(
    'select p.oid::regprocedure::text, p.proacl::text from pg_proc p where p.oid in ($1::regprocedure, $2::regprocedure) order by 1',
    functions,
  )).rows
  const existingPermissions = await permissions()
  await db.exec(await readFile(migration, 'utf8'))
  assert.deepEqual(await permissions(), existingPermissions)
  await role(author)
  assert.equal((await channel()).open_type_detail, '오프라인')
  const legacyAfter = (await db.query("select * from public.draft_visual_content where draft_id = $1 and entry_key = '무신사'", [draft])).rows[0]
  assert.deepEqual(legacyAfter, legacy)
  await assert.rejects(md(active, null, { from: '2026-11-28' }), { code: '22023' })
  for (const target of [removed, unrelated, misplaced, crossBrand]) {
    await assert.rejects(saveDraft(draft, '임시 표기', { openChannelTargetId: target }), { code: '22023' })
    await assert.rejects(md(target), { code: '22023' })
    await assert.rejects(html(target, { top: '<p>새 업체</p>', bottom: '' }), { code: '22023' })
  }
  await saveDraft(draft, '임시 표기', { openChannelTargetId: active })
  assert.equal((await channel()).open_type_detail, '연결 업체')
  await saveDraft(draft, '연결 업체')
  assert.equal((await channel()).specs.openChannelTargetId, active)
  const savedMd = await md(active)
  const template = await html(active, { top: '<p>Top</p>', bottom: '<p>Bottom</p>' })
  assert.equal(savedMd.payload.partner, '연결 업체')
  assert.equal(template.payload.vendorName, '연결 업체')
  await assert.rejects(md(active), { code: '40001' })

  await db.exec('reset role')
  await db.query("update public.code_usage_targets set active = false, name = '이름 변경' where id = $1", [active])
  await role(author)
  await saveDraft(draft, '연결 업체', { openChannelTargetId: active })
  assert.equal((await channel()).specs.openChannelTargetId, active)
  assert.equal((await md(active, savedMd.revision)).payload.partner, '연결 업체')
  assert.equal((await html(active, { top: '', bottom: '<p>수정</p>' }, template.revision)).payload.vendorName, '연결 업체')
  await html('무신사', { top: '<p>기존도 수정</p>', bottom: '' }, legacy.revision)

  await role(outsider)
  assert.deepEqual((await db.query('select * from public.draft_team_work where draft_id = $1', [draft])).rows, [])
  await assert.rejects(md(active), { code: '42501' })
  await assert.rejects(html(active, { top: '', bottom: '' }), { code: '42501' })
  console.log('Draft Sabangnet partners: source scope, old data, persistent identifiers, revisions and permission boundaries passed')
} finally {
  await db.close()
}
