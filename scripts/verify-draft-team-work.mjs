import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const db = await PGlite.create()
const company = 'e0000000-0000-4000-8000-000000000001'
const department = 'ced99f89-ea80-4eeb-8f03-272bf72f5db1'
const author = crypto.randomUUID()
const reviewer = crypto.randomUUID()
const outsider = crypto.randomUUID()
const operator = 'd0000000-0000-4000-8000-000000000001'
const black = crypto.randomUUID()
const ivory = crypto.randomUUID()
const otherColor = crypto.randomUUID()
const content = JSON.stringify([{ id: black, name: '블랙', orderQty: 12 }, { id: ivory, name: '아이보리', orderQty: 8 }])

async function asUser(id, role = 'authenticated') {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id])
  await db.exec(`set role ${role}`)
}

try {
  for (const file of [
    'supabase/tests/department_work_fixture.sql',
    'supabase/migrations/20261027044909_department_work_access.sql',
    'supabase/migrations/20261122163508_draft_team_work.sql',
  ]) await db.exec(await readFile(file, 'utf8'))
  const otherCompany = crypto.randomUUID()
  await db.query('insert into public.companies(id) values($1),($2)', [company, otherCompany])
  await db.query("insert into public.departments(id,company_id,name,is_active) values($1,$2,'기획팀',true)", [department, company])
  for (const id of [author, reviewer, outsider, operator]) {
    await db.query("insert into public.profiles(id,company_id,department_id,display_name,status,is_admin) values($1,$2,$3,$4,'active',false)",
      [id, id === outsider ? otherCompany : company, id === outsider ? null : department, id])
  }

  await asUser(author)
  const draft = (await db.query("select public.save_product_draft($1,null,null,$2,$3,$4) id", [
    company, { nameKo: '팀별 작업 저장 검증', retailPrice: 30000, discountPrice: 28500 },
    content, JSON.stringify([{ id: crypto.randomUUID(), name: '원래 옵션', price: 1500 }]),
  ])).rows[0].id
  const secondDraft = (await db.query("select public.save_product_draft($1,null,null,$2,$3,'[]') id", [
    company, { nameKo: '다른 기획안' }, JSON.stringify([{ id: otherColor, name: '다른 컬러' }]),
  ])).rows[0].id
  const save = async (section, payload, confirmed, revision = null) => (await db.query(
    'select * from public.save_draft_team_work($1,$2,$3,$4,$5)', [draft, section, JSON.stringify(payload), confirmed, revision],
  )).rows[0]
  const list = async (id = draft) => (await db.query('select * from public.draft_team_work where draft_id=$1 order by section', [id])).rows
  const original = async () => ({
    draft: (await db.query('select * from public.product_drafts where id=$1', [draft])).rows,
    colors: (await db.query('select * from public.draft_colors where draft_id=$1 order by id', [draft])).rows,
    options: (await db.query('select * from public.draft_options where draft_id=$1 order by id', [draft])).rows,
    styles: (await db.query('select count(*)::int from public.styles')).rows,
  })

  const before = await original()
  const amd = { collection: '00007', colors: {
    [black]: { sabangnet: '0004', barcode: '0123456789012' }, [ivory]: { sabangnet: '', barcode: '' },
  } }
  const quantities = { quantities: { [black]: '1200', [ivory]: '0' }, arrival: '2027-01-02' }
  const prices = { retail: '43000', discount: '39500.00', extraDiscount: '', auto: true }
  const options = { type: { id: 'custom-option', label: '기획안 한정 옵션' }, entries: [
    { id: 'item-a', name: '보조품', price: '' }, { id: 'item-b', name: '포장', price: '0' },
  ] }
  const written = await save('amd', amd, false)
  assert.deepEqual(written.payload, amd)
  assert.equal(written.confirmed, false)
  const confirmed = await save('amd', amd, true, written.revision)
  assert.equal(confirmed.confirmed, true)
  assert.notEqual(confirmed.revision, written.revision)
  await assert.rejects(save('amd', { ...amd, collection: '오래된 입력' }, false, written.revision), { code: '40001' })
  await assert.rejects(save('amd', { ...amd, colors: { ...amd.colors, [otherColor]: amd.colors[black] } }, false, confirmed.revision), { code: '22023' })
  await assert.rejects(save('amd', { ...amd, colors: { [black]: amd.colors[black] } }, false, confirmed.revision), { code: '22023' })
  assert.deepEqual(await list(), [confirmed])

  const quantity = await save('md-quantity', quantities, true)
  const price = await save('md-price', prices, true)
  const option = await save('md-options', options, true)
  await assert.rejects(save('md-price', { ...prices, retail: '매출 원장에 반영' }, true, price.revision), { code: '22023' })
  await assert.rejects(save('md-quantity', { ...quantities, quantities: { ...quantities.quantities, [black]: '-5' } }, true, quantity.revision), { code: '22023' })
  await assert.rejects(save('md-options', { ...options, entries: [options.entries[0],options.entries[0]] }, true, option.revision), { code: '22023' })
  assert.deepEqual(await list(), [confirmed, option, price, quantity])
  assert.deepEqual(await list(secondDraft), [])
  assert.deepEqual(await original(), before, 'Team work does not change the draft, real quantities, prices, options or product register')

  await asUser(reviewer)
  assert.deepEqual(await list(), [confirmed, option, price, quantity])
  await assert.rejects(save('md-price', prices, false, price.revision), { code: '42501' })
  await assert.rejects(db.query('update public.draft_team_work set confirmed=false where draft_id=$1', [draft]), { code: '42501' })
  await asUser(outsider)
  assert.deepEqual(await list(), [])
  await assert.rejects(save('amd', amd, true, confirmed.revision), { code: '42501' })
  await asUser('', 'anon')
  await assert.rejects(list(), { code: '42501' })
  await assert.rejects(save('amd', amd, true, confirmed.revision), { code: '42501' })

  await asUser(operator)
  const unconfirmed = await save('md-price', { ...prices, retail: '45000' }, false, price.revision)
  assert.equal(unconfirmed.confirmed, false)
  await asUser(author)
  await db.query('delete from public.draft_colors where id=$1 and draft_id=$2', [ivory, draft])
  await assert.rejects(save('md-quantity', quantities, true, quantity.revision), { code: '22023' })
  const reduced = { ...quantities, quantities: { [black]: quantities.quantities[black] } }
  const legacyQuantity = await save('md-quantity', reduced, true, quantity.revision)
  assert.deepEqual(legacyQuantity.payload, reduced)

  await db.exec('reset role')
  await db.exec('alter table public.product_drafts add unique (company_id,id)')
  for (const file of [
    'supabase/migrations/20261109044448_draft_price_requests.sql',
    'supabase/migrations/20261124135402_draft_folder_opening_date_and_order_confirmation.sql',
  ]) await db.exec(await readFile(file, 'utf8'))
  const brand = crypto.randomUUID()
  const differentBrand = crypto.randomUUID()
  const folder = crypto.randomUUID()
  const otherFolder = crypto.randomUUID()
  const unassigned = crypto.randomUUID()
  await db.query('insert into public.brands(id,company_id) values($1,$3),($2,$3)', [brand, differentBrand, company])
  await db.query("insert into public.seasons(id,brand_id,code) values($1,$4,'DEC'),($2,$5,'OTHER'),($3,$4,'UNASSIGNED')",
    [folder, otherFolder, unassigned, brand, differentBrand])

  const confirmOrder = async revision => (await db.query('select * from public.confirm_draft_order_quantity($1,$2,$3)',
    [draft, JSON.stringify(reduced), revision])).rows[0]
  const writeSpecs = values => db.query("update public.product_drafts set specs=coalesce(specs,'{}'::jsonb) || $2::jsonb where id=$1",
    [draft, JSON.stringify(values)])
  const moveTo = (brandId, folderId) => db.query('update public.product_drafts set brand_id=$2, season_id=$3 where id=$1', [draft, brandId, folderId])
  const setOpening = (id, date, final) => db.query('update public.seasons set opening_date=$2, opening_date_confirmed=$3 where id=$1 returning id', [id, date, final])

  await asUser(author)
  await assert.rejects(confirmOrder(legacyQuantity.revision), { code: 'P0001', message: '상품명을 먼저 확정해 주세요.' })
  await writeSpecs({ nameConfirmed: true })
  await assert.rejects(confirmOrder(legacyQuantity.revision), { code: 'P0001', message: '모든 컬러의 영문·한글명과 이미지 설정을 완료해 주세요.' })
  await writeSpecs({ colorNames: { [black]: { nameEn:'Black', nameKo: '블랙' } }, colorImageChoices: { [black]: 'None' } })
  await assert.rejects(confirmOrder(legacyQuantity.revision), { code: 'P0001', message: '모든 컬러의 단가를 먼저 확정해 주세요.' })
  await writeSpecs({ manualPrice: { destination: '한국', currency:'KRW', vendor: '', savedAt: '2026-11-24T00:00:00Z', amounts: { [black]: 0 } } })
  await assert.rejects(confirmOrder(legacyQuantity.revision), { code: 'P0001', message: '브랜드를 먼저 지정해 주세요.' })
  await moveTo(brand, unassigned)
  await assert.rejects(setOpening(unassigned, '2026-12-01', true), { code: '23514' })
  assert.equal((await setOpening(otherFolder, '2026-12-01', true)).rows.length, 1)
  await moveTo(brand, otherFolder)
  await assert.rejects(confirmOrder(legacyQuantity.revision), /같은 브랜드의 출시 폴더/)
  await moveTo(brand, folder)
  await assert.rejects(setOpening(folder, null, true), { code: '23514' })
  await setOpening(folder, '2026-12-01', false)
  await assert.rejects(confirmOrder(legacyQuantity.revision), /오픈 예정일을 확정/)
  await asUser(outsider)
  await assert.rejects(setOpening(folder, '2026-12-02', true), { code: '42501' })
  await assert.rejects(confirmOrder(legacyQuantity.revision), { code: '42501' })
  await asUser('', 'anon')
  await assert.rejects(confirmOrder(legacyQuantity.revision), { code: '42501' })
  await asUser(author)
  await setOpening(folder, '2026-12-01', true)
  const manualOrder = await confirmOrder(legacyQuantity.revision)
  assert.equal(manualOrder.confirmed, true)
  await assert.rejects(confirmOrder(legacyQuantity.revision), { code: '40001' })
  await db.exec('reset role')
  const quote = (await db.query(`insert into app.draft_price_requests(company_id,draft_id,round,requested_by,requested_at,colors,photos)
    values($1,$2,1,$3,'2026-11-25','[{}]','{}') returning id`, [company, draft, author])).rows[0].id
  await asUser(author)
  await assert.rejects(confirmOrder(manualOrder.revision), /단가를 먼저 확정/)
  await db.exec('reset role')
  await db.query("update app.draft_price_requests set answered_at=now(),answered_by=$2,amounts=$3 where id=$1",
    [quote, author, JSON.stringify({ [black]: 15 })])
  await asUser(author)
  await assert.rejects(confirmOrder(manualOrder.revision), /단가를 먼저 확정/)
  await writeSpecs({ confirmedPriceRequestId: quote })
  assert.equal((await confirmOrder(manualOrder.revision)).confirmed,true)
  await db.query('delete from public.product_drafts where id=$1', [draft])
  await db.exec('reset role')
  assert.deepEqual(await list(), [])
  console.log('Draft AMD/MD: section saves, revisions, role boundaries, color validation and original data preservation passed')
  console.log('Draft order confirmation: name, colors, price, brand, folder, opening date and permissions passed')
} finally {
  await db.close()
}
