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
  const checkedOrder = await confirmOrder(manualOrder.revision)
  assert.equal(checkedOrder.confirmed,true)

  await db.exec('reset role')
  await db.exec('alter table public.styles add unique (brand_id,style_no)')
  await db.query("update public.brands set slug='masmarulez' where id=$1", [brand])
  await db.exec(await readFile('supabase/migrations/20261125054155_brand_style_number_issuance.sql', 'utf8'))
  await assert.rejects(db.query("update public.brands set style_number_prefix='M' where id=$1", [differentBrand]), { code: '23505' })
  await assert.rejects(db.query("update public.brands set style_number_prefix='V1' where id=$1", [differentBrand]), { code: '23514' })
  const addExistingStyle = number => db.query("insert into public.styles(brand_id,season_id,style_no,name) values($1,$2,$3,'기존 상품')",
    [brand, folder, number])
  await addExistingStyle('M0001')
  await addExistingStyle('M0003')
  const preview = async id => (await db.query('select public.draft_order_style_number_preview($1) as data', [id])).rows[0].data
  const issue = async (id, payload, revision, numbers) => (await db.query(
    'select * from public.confirm_draft_order_quantity($1,$2,$3,$4)', [id, JSON.stringify(payload), revision, JSON.stringify(numbers)],
  )).rows[0]
  await asUser(author)
  const firstPreview = await preview(draft)
  assert.deepEqual(firstPreview, { prefix: 'M', numbers: { [black]: 'M0002' } })
  assert.deepEqual((await list()).find(row => row.section === 'md-quantity').issued_style_numbers, {})
  await asUser(outsider)
  await assert.rejects(preview(draft), { code: '42501' })
  await asUser('', 'anon')
  await assert.rejects(preview(draft), { code: '42501' })
  await db.exec('reset role')
  await addExistingStyle('M0002')
  await asUser(author)
  await assert.rejects(issue(draft, reduced, checkedOrder.revision, firstPreview.numbers), /품번 후보가 변경됐습니다/)
  assert.equal((await list()).find(row => row.section === 'md-quantity').revision, checkedOrder.revision, 'A stale preview rolls back confirmation')
  const current = await preview(draft)
  const issued = await issue(draft, reduced, checkedOrder.revision, current.numbers)
  const blackSku = issued.issued_style_numbers[black]
  assert.equal(blackSku.number, 'M0004')
  const sku = (await db.query('select style_no,name,planned_qty,brand_id from public.styles where id=$1', [blackSku.style_id])).rows[0]
  assert.deepEqual(sku, { style_no:'M0004', name:'팀별 작업 저장 검증 블랙', planned_qty:1200, brand_id:brand })
  await assert.rejects(issue(draft, reduced, checkedOrder.revision, current.numbers), { code: '40001' })
  await assert.rejects(moveTo(differentBrand, otherFolder), /품번이 등록된 기획안은 브랜드를 변경할 수 없습니다/)

  await db.exec('reset role')
  await db.query("update public.brands set style_number_prefix='MM' where id=$1", [brand])
  await asUser(author)
  const reissued = await issue(draft, reduced, issued.revision, (await preview(draft)).numbers)
  assert.deepEqual(reissued.issued_style_numbers, issued.issued_style_numbers, 'Reconfirming preserves the issued number after a prefix change')
  assert.equal((await db.query('select count(*)::int as count from public.styles where brand_id=$1', [brand])).rows[0].count, 4)
  const secondQuantity = { quantities: { [otherColor]: '8' }, arrival: '2027-01-02' }
  await db.query('update public.product_drafts set brand_id=$2,season_id=$3,specs=$4 where id=$1', [secondDraft, differentBrand, otherFolder, {
    nameConfirmed:true, colorNames:{ [otherColor]: { nameEn:'Blue', nameKo:'다른 컬러' } }, colorImageChoices:{[otherColor]:'None'},
    manualPrice:{destination:'한국', currency:'KRW', vendor:'', savedAt:'2026-11-24T00:00:00Z', amounts:{[otherColor]:10}},
  }])
  assert.deepEqual(await preview(secondDraft), { prefix:null, numbers:{} })
  await assert.rejects(issue(secondDraft, secondQuantity, null, {}), /품번 접두어를 설정해 주세요/)
  assert.deepEqual(await list(secondDraft), [])
  await db.exec('reset role')
  await db.query("update public.brands set style_number_prefix='V' where id=$1", [differentBrand])
  await asUser(author)
  const otherNumbers = await preview(secondDraft)
  assert.deepEqual(otherNumbers, { prefix:'V', numbers:{[otherColor]:'V0001'} })
  const otherIssued = await issue(secondDraft, secondQuantity, null, otherNumbers.numbers)
  assert.equal(otherIssued.issued_style_numbers[otherColor].number, 'V0001')
  await db.exec('reset role')
  await db.query(`insert into public.styles(brand_id,season_id,style_no,name)
    select $1,$2,'V' || lpad(number::text,4,'0'),'기존 상품' from generate_series(2,9999) number`, [differentBrand, otherFolder])
  await asUser(author)
  const unissuedDraft = (await db.query("select public.save_product_draft($1,$2,null,$3,$4,'[]') id", [company,
    differentBrand, { nameKo:'네 자리 품번 소진' }, JSON.stringify([{ id:crypto.randomUUID(), name:'별도 컬러' }]),
  ])).rows[0].id
  assert.deepEqual(await preview(unissuedDraft), { prefix:'V', numbers:{} }, 'No fifth digit is issued after 9999')
  const legacySaved = await confirmOrder(reissued.revision)
  assert.deepEqual(legacySaved.issued_style_numbers, issued.issued_style_numbers, 'Legacy confirmation preserves assigned numbers')
  await db.query('delete from public.product_drafts where id=$1', [draft])
  await db.exec('reset role')
  assert.deepEqual(await list(), [])
  await db.exec(`
    create or replace function app.permission_company_id() returns uuid
      language sql stable security definer set search_path='' as
      $$ select company_id from public.profiles where id=auth.uid() and status='active' $$;
    grant execute on function app.permission_company_id() to authenticated;
    create publication supabase_realtime;
  `)
  const extraFolder = crypto.randomUUID()
  await db.query("insert into public.seasons(id,brand_id,code) values($1,$2,'JAN')", [extraFolder, brand])
  const beforeFolders = (await db.query('select * from public.seasons order by id')).rows
  const beforeDrafts = (await db.query('select * from public.product_drafts order by id')).rows
  await db.exec(await readFile('supabase/migrations/20261125082958_draft_folder_order.sql', 'utf8'))
  const viewer = crypto.randomUUID()
  await db.query("insert into public.profiles(id,company_id,display_name,status,is_admin) values($1,$2,'조회 직원','active',false)", [viewer, company])
  const saveOrder = async (ids, revision = null, brandId = brand) => (await db.query(
    'select public.save_draft_folder_order($1,$2::uuid[],$3) as order', [brandId, ids, revision],
  )).rows[0].order
  const listOrders = async () => (await db.query('select * from public.draft_folder_orders')).rows
  await asUser(author)
  await assert.rejects(saveOrder([folder, unassigned]), { code: '40001' })
  await assert.rejects(saveOrder([folder, otherFolder]), { code: '40001' })
  await assert.rejects(saveOrder([folder, folder]), { code: '40001' })
  const firstOrder = await saveOrder([extraFolder, folder])
  assert.deepEqual(firstOrder.folder_ids, [extraFolder, folder])
  await asUser(reviewer)
  assert.deepEqual(await listOrders(), [firstOrder], 'A separate account reads the brand order')
  await assert.rejects(saveOrder([folder, extraFolder]), { code: '40001' })
  await assert.rejects(db.query('update public.draft_folder_orders set folder_ids=$1 where brand_id=$2', [[folder, extraFolder], brand]), { code: '42501' })
  const nextOrder = await saveOrder([folder, extraFolder], firstOrder.revision)
  assert.notEqual(nextOrder.revision, firstOrder.revision)
  await asUser(author)
  await assert.rejects(saveOrder([extraFolder, folder], firstOrder.revision), { code: '40001' })
  assert.deepEqual(await listOrders(), [nextOrder])
  await asUser(viewer)
  assert.deepEqual(await listOrders(), [nextOrder])
  await assert.rejects(saveOrder([extraFolder, folder], nextOrder.revision), { code: '42501' })
  await asUser(outsider)
  assert.deepEqual(await listOrders(), [])
  await assert.rejects(saveOrder([folder, extraFolder], nextOrder.revision), { code: '42501' })
  await asUser('', 'anon')
  await assert.rejects(listOrders(), { code: '42501' })
  await assert.rejects(saveOrder([folder, extraFolder], nextOrder.revision), { code: '42501' })
  await db.exec('reset role')
  assert.deepEqual((await db.query('select * from public.seasons order by id')).rows, beforeFolders)
  assert.deepEqual((await db.query('select * from public.product_drafts order by id')).rows, beforeDrafts)
  assert.equal((await db.query("select count(*)::int as count from pg_publication_tables where pubname='supabase_realtime' and tablename='draft_folder_orders'")).rows[0].count, 1)
  console.log('Draft AMD/MD: section saves, revisions, role boundaries, color validation and original data preservation passed')
  console.log('Draft order confirmation: name, colors, price, brand, folder, opening date and permissions passed')
  console.log('Brand SKU issuance: prefix settings, atomic registration, stale previews and repeat confirmation passed')
  console.log('Draft folder order: shared read, scoped writes, stale revisions, folder validation, Realtime publication and original data preservation passed')

  await db.exec(await readFile('supabase/migrations/20261126075355_draft_folder_row_order.sql', 'utf8'))
  await asUser(author)
  const createFolderDraft = async (brandId, folderId, name) => {
    const { rows } = await db.query("select public.save_product_draft($1,$2,null,$3,'[]','[]') as id",
      [company, brandId, { nameKo: name }])
    await db.query('update public.product_drafts set season_id=$2 where id=$1', [rows[0].id, folderId])
    return rows[0].id
  }
  const first = await createFolderDraft(brand, folder, '첫 번째')
  const last = await createFolderDraft(brand, folder, '두 번째')
  const separate = await createFolderDraft(differentBrand, otherFolder, '다른 폴더')
  const draftSnapshot = (await db.query('select * from public.product_drafts order by id')).rows
  const saveRows = async (ids, revision = null, folderId = folder) => (await db.query(
    'select public.save_draft_folder_row_order($1,$2::uuid[],$3) as result', [folderId, ids, revision],
  )).rows[0].result
  const listRowOrders = async () => (await db.query('select * from public.draft_folder_row_orders')).rows
  await assert.rejects(saveRows([first, first]), { code: '40001' })
  await assert.rejects(saveRows([first, separate]), { code: '40001' })
  await assert.rejects(saveRows([first, last], null, unassigned), { code: '42501' })
  const initialRows = await saveRows([last, first])
  assert.deepEqual(initialRows.draft_ids, [last, first])
  await asUser(reviewer)
  assert.deepEqual(await listRowOrders(), [initialRows])
  await assert.rejects(saveRows([first, last]), { code: '40001' })
  const movedRows = await saveRows([first, last], initialRows.revision)
  assert.deepEqual(movedRows.draft_ids, [first, last])
  await assert.rejects(saveRows([last, first], initialRows.revision), { code: '40001' })
  assert.deepEqual((await db.query('select * from public.product_drafts order by id')).rows, draftSnapshot)
  await asUser(viewer)
  assert.deepEqual(await listRowOrders(), [movedRows])
  await assert.rejects(saveRows([last, first], movedRows.revision), { code: '42501' })
  await assert.rejects(db.query('update public.draft_folder_row_orders set draft_ids=$1 where season_id=$2', [[last, first], folder]), { code: '42501' })
  await asUser(outsider)
  assert.deepEqual(await listRowOrders(), [])
  await assert.rejects(saveRows([last, first], movedRows.revision), { code: '42501' })
  await asUser('', 'anon')
  await assert.rejects(listRowOrders(), { code: '42501' })
  await assert.rejects(saveRows([last, first], movedRows.revision), { code: '42501' })
  await asUser(author)
  const added = await createFolderDraft(brand, folder, '나중에 추가')
  await assert.rejects(saveRows([last, first], movedRows.revision), { code: '40001' })
  const withAdded = await saveRows([last, first, added], movedRows.revision)
  await db.query('update public.product_drafts set season_id=null where id=$1', [last])
  await assert.rejects(saveRows([last, first, added], withAdded.revision), { code: '40001' })
  assert.deepEqual((await saveRows([added, first], withAdded.revision)).draft_ids, [added, first])
  assert.equal((await db.query("select count(*)::int as count from pg_publication_tables where pubname='supabase_realtime' and tablename='draft_folder_row_orders'")).rows[0].count, 1)
  console.log('Draft folder row order: shared reads, scoped writes, stale views, changed membership and preserved draft content passed')
} finally {
  await db.close()
}
