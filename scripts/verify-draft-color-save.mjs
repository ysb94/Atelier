import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const db = await PGlite.create()
const company = 'e0000000-0000-4000-8000-000000000001'
const planning = 'ced99f89-ea80-4eeb-8f03-272bf72f5db1'
const author = crypto.randomUUID()
const other = crypto.randomUUID()
const black = crypto.randomUUID()
const white = crypto.randomUUID()
const photo = 'data:image/webp;base64,eA=='
const sample = 'data:application/pdf;base64,' + 'a'.repeat(3_400_000)
const scalar = async (sql, values) => Object.values((await db.query(sql, values)).rows[0])[0]
const actor = async id => {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id])
  await db.exec('set role authenticated')
}

try {
  for (const path of [
    'supabase/tests/department_work_fixture.sql',
    'supabase/migrations/20261027044909_department_work_access.sql',
    'supabase/migrations/20261118071459_save_draft_colors.sql',
  ]) await db.exec(await readFile(path, 'utf8'))
  const colorAssigneeMigration = await readFile('supabase/migrations/20261106130000_china_assignee_receipt.sql', 'utf8')
  const keepAssignee = colorAssigneeMigration.match(/create or replace function app\.keep_color_sample_assignee\(\)[\s\S]+?end \$\$;/)?.[0]
  assert.ok(keepAssignee)
  await db.exec(keepAssignee)
  await db.exec(`create trigger keep_color_sample_assignee before update on public.product_drafts
    for each row execute function app.keep_color_sample_assignee()`)
  await db.query('insert into public.companies(id) values($1)', [company])
  await db.query("insert into public.departments(id,company_id,name,is_active) values($1,$2,'기획팀',true)", [planning, company])
  for (const id of [author, other]) {
    await db.query("insert into public.profiles(id,company_id,department_id,display_name,status,is_admin,position) values($1,$2,$3,$4,'active',false,'')",
      [id, company, planning, id])
  }
  await actor(author)
  const original = {
    colorSampleRounds: [{ id: 'sample-1', url: sample, assigneeId: other }],
    colorSpecs: { [black]: { fabric: '면' } },
    colorImageChoices: { [black]: 'Image' },
    colorPhotoUrls: { [black]: photo },
  }
  const draft = await scalar("select public.save_product_draft($1,null,null,$2,$3,'[]')", [
    company, { nameKo: '컬러 확인', imageUrl: photo, sampleWorkOrderUrl: sample, specs: original },
    JSON.stringify([{ id: black, name: '검정', orderQty: 3, sampleWorkOrderUrl: sample }]),
  ])
  const revision = () => scalar('select updated_at::text from public.product_drafts where id=$1', [draft])
  const save = (stamp, colors) => scalar('select public.save_draft_colors($1,$2,$3)::text',
    [draft, stamp, JSON.stringify(colors)])
  const read = async () => (await db.query(
    'select id,name,sort_order,order_qty,length(sample_work_order_url) as order_size,xmin::text as version from public.draft_colors where draft_id=$1 order by sort_order',
    [draft])).rows
  const parent = () => scalar(`select jsonb_build_object('image',image_url,'sample',md5(sample_work_order_url),
    'orders',md5(sample_work_orders::text),'specs',specs) from public.product_drafts where id=$1`, [draft])
  const before = await parent()
  const [existing] = await read()
  const stamp = await revision()
  assert.equal(existing.order_size, sample.length)
  await actor(other)
  await assert.rejects(save(stamp, [{ id: white, name: '흰색', imageChoice: 'None' }]), { code: '42501' })
  await actor(author)
  await assert.rejects(save(stamp, [{ id: white, name: '흰색', imageChoice: 'Image' }]), { code: '22023' })
  assert.deepEqual(await read(), [existing])
  assert.equal(await save(stamp, [{ id: black, name: '검정' }, { id: white, name: '흰색', imageChoice: 'None' }]), await revision())
  const [stillExisting, added] = await read()
  assert.deepEqual(stillExisting, existing, 'Untouched color row is not rewritten')
  assert.equal(added.name, '흰색')
  assert.equal(added.sort_order, 2)
  assert.deepEqual(await parent(), { ...before, specs: {
    ...before.specs, colorImageChoices: { [black]: 'Image', [white]: 'None' },
  } })
  await assert.rejects(save(stamp, [{ id: black, name: '검정' }]), { code: '40001' })
  await save(await revision(), [{ id: white, name: '아이보리', imageChoice: 'Image', photoUrl: photo }])
  assert.deepEqual((await read()).map(({ id, name, sort_order }) => ({ id, name, sort_order })),
    [{ id: white, name: '아이보리', sort_order: 1 }])
  assert.deepEqual(await parent(), { ...before, specs: {
    ...before.specs, colorImageChoices: { [white]: 'Image' }, colorPhotoUrls: { [white]: photo },
  } })
  await db.exec('reset role')
  await db.exec(await readFile('supabase/migrations/20261124130417_draft_bilingual_color_names.sql', 'utf8'))
  await actor(author)
  const saveNames = (stamp, colors) => scalar('select public.save_draft_colors_with_names($1,$2,$3)::text',
    [draft, stamp, JSON.stringify(colors)])
  const namesStamp = await revision()
  const bilingual = [{ id: white, nameEn: ' Ivory ', nameKo: ' 아이보리 ' }, { id: black, nameEn: 'Black', nameKo: '' }]
  await actor(other)
  await assert.rejects(saveNames(namesStamp, bilingual), { code: '42501' })
  await actor(author)
  await assert.rejects(saveNames(namesStamp, [{ id: white, nameEn: ' ', nameKo: '' }]), { code: '22023' })
  const namesBefore = await parent()
  assert.equal(await saveNames(namesStamp, bilingual), await revision())
  assert.deepEqual((await read()).map(row => [row.id, row.name]), [[white, '아이보리'], [black, 'Black']])
  const colorNames = { [white]: { nameEn: 'Ivory', nameKo: '아이보리' }, [black]: { nameEn: 'Black', nameKo: '' } }
  assert.deepEqual(await parent(), { ...namesBefore, specs: { ...namesBefore.specs, colorNames } })
  await assert.rejects(saveNames(namesStamp, bilingual), { code: '40001' })

  const fullSave = async colors => scalar('select public.save_product_draft($1,null,$2,$3,$4,\'[]\')', [
    company, draft, { nameKo: '기획안 전체 저장', expectedUpdatedAt: await revision(), specs: namesBefore.specs }, JSON.stringify(colors),
  ])
  await fullSave([{ id: white, name: '아이보리' }, { id: black, name: 'Black' }])
  assert.deepEqual((await parent()).specs.colorNames, colorNames, 'An older full save preserves names it does not send')
  await fullSave([{ id: white, name: '아이보리' }])
  assert.deepEqual((await parent()).specs.colorNames, { [white]: colorNames[white] }, 'Removing a color prunes only its names')
  await db.exec('reset role')
  const rpcPrivileges = async () => (await db.query(`
    select proname, proacl::text as grants, proowner, prosecdef from pg_proc
    where oid in (
      'public.save_draft_colors(uuid,timestamptz,jsonb)'::regprocedure,
      'public.save_draft_colors_with_names(uuid,timestamptz,jsonb)'::regprocedure
    ) order by proname`
  )).rows
  const originalPrivileges = await rpcPrivileges()
  await db.exec(await readFile('supabase/migrations/20261126083207_draft_color_capacity.sql', 'utf8'))
  assert.deepEqual(await rpcPrivileges(), originalPrivileges)
  await actor(author)
  const colorsAtLimit = [
    { id: white, ...colorNames[white] },
    ...Array.from({length:99}, (_, index) => ({
      id:crypto.randomUUID(), nameEn:`Color ${index + 2}`, nameKo:`컬러 ${index + 2}`,
    })),
  ]
  const infoBefore = await parent()
  await saveNames(await revision(), colorsAtLimit.slice(0, 60))
  assert.deepEqual((await read()).map(row => row.id), colorsAtLimit.slice(0, 60).map(row => row.id))
  await saveNames(await revision(), colorsAtLimit)
  const atLimit = await read()
  assert.deepEqual(atLimit.map(row => row.id), colorsAtLimit.map(row => row.id))
  assert.equal(atLimit.at(-1).sort_order, 100)
  assert.deepEqual(await parent(), {
    ...infoBefore,
    specs: {
      ...infoBefore.specs,
      colorNames:Object.fromEntries(colorsAtLimit.map(({id, nameEn, nameKo}) => [id, {nameEn, nameKo}])),
    },
  })
  const capacityRevision = await revision()
  const tooMany = [...colorsAtLimit, {id:crypto.randomUUID(),nameEn:'Over limit',nameKo:''}]
  await assert.rejects(saveNames(capacityRevision, tooMany), {code:'22023', message:/100컬러/})
  await assert.rejects(save(capacityRevision, tooMany.map(color => ({id:color.id,name:color.nameEn}))), {code:'22023', message:/100컬러/})
  assert.deepEqual(await read(), atLimit)
  assert.equal(await revision(), capacityRevision)
  console.log('Draft colors SQL: add, reorder, delete, photo changes, revision conflicts and attachment preservation passed')
  console.log('Draft bilingual color names SQL: partial draft names, atomic save, permission checks and legacy preservation passed')
  console.log('Draft color capacity SQL: 60 and 100 rows saved with names and ordering, 101 rejected without writes, existing files and RPC grants preserved')
} finally {
  await db.close()
}
