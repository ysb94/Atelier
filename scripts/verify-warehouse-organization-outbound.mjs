import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import {
  parseWarehouseOrganizationOutbound,
  previousWarehouseOutboundMonth,
  warehouseOutboundMonthDays,
  warehouseOutboundBoxQuantities,
  warehouseOutboundPickingBoxes,
  warehouseOutboundStyleNumbers,
  warehouseOutboundDailyBoxes,
  warehousePopularOutboundProducts,
} from '../src/features/logistics/warehouse-organization-outbound.ts'

assert.equal(previousWarehouseOutboundMonth(new Date('2026-12-31T15:00:00Z')), '2026-12')
assert.equal(previousWarehouseOutboundMonth(new Date('2026-11-17T01:00:00Z')), '2026-10')
assert.equal(warehouseOutboundMonthDays('2026-10'), 31)
assert.equal(warehouseOutboundMonthDays('2026-11'), 30)
assert.equal(warehouseOutboundMonthDays('2026-02'), 28)
assert.equal(warehouseOutboundMonthDays('2028-02'), 29)
assert.equal(warehouseOutboundMonthDays('2100-02'), 28)
assert.equal(warehouseOutboundMonthDays('2026-13'), null)
assert.equal(warehouseOutboundMonthDays(''), null)
const styleNumbers = warehouseOutboundStyleNumbers([
  { styleId: 'a', styleNo: ' M0010 ', name: ' 가방 블랙 ' },
  { styleId: 'b', styleNo: 'M0011', name: '가방 베이지' },
  { styleId: 'c', styleNo: 'M0012', name: '중복 상품' },
  { styleId: 'd', styleNo: 'M0013', name: '중복 상품' },
  { styleId: 'e', styleNo: '', name: '번호 없음' },
])
assert.equal(styleNumbers.get('가방 블랙'), 'M0010')
assert.equal(styleNumbers.get('가방 베이지'), 'M0011')
assert.equal(styleNumbers.get('중복 상품'), null)
assert.equal(styleNumbers.get('번호 없음'), null)
assert.equal(styleNumbers.has('없는 상품'), false)
const boxQuantities = warehouseOutboundBoxQuantities([
  { styleName: '가방', zone: 'picking', unitsPerBox: 8 },
  { styleName: '가방', zone: 'box_storage', unitsPerBox: 16 },
  { styleName: '가방', zone: 'box_storage', unitsPerBox: 8 },
  { styleName: '가방', zone: 'temporary', unitsPerBox: 100 },
  { styleName: ' 다른 상품 ', zone: 'box_storage', unitsPerBox: 20 },
  { styleName: '수량 없음', zone: 'box_storage', unitsPerBox: null },
  { styleName: '0 수량', zone: 'box_storage', unitsPerBox: 0 },
])
assert.equal(boxQuantities.get('가방'), 16)
assert.equal(boxQuantities.get('다른 상품'), 20)
assert.equal(boxQuantities.has('수량 없음'), false)
assert.equal(boxQuantities.has('0 수량'), false)
function fifoPosition(overrides = {}) {
  return { styleName: '가방', zone: 'picking', locationCode: '3-2-4_C1', remainingBoxes: 2,
    unitsPerBox: 8, openedUnits: 0, quantityStatus: 'known', receivedOn: '2026-11-01',
    receivedOnRaw: '261101', sourceRowNumber: 1, ...overrides }
}
const pickingBoxes = warehouseOutboundPickingBoxes([
  fifoPosition({ styleName: ' 가방 ' }),
  fifoPosition({ remainingBoxes: 3 }),
  fifoPosition({ locationCode: '3-2-5_C1', remainingBoxes: 1 }),
  fifoPosition({ zone: 'box_storage', locationCode: '#-7-1', remainingBoxes: 100 }),
  fifoPosition({ zone: 'temporary', locationCode: '임시', remainingBoxes: 50 }),
  fifoPosition({ styleName: '빈 상품', remainingBoxes: 0 }),
  fifoPosition({ styleName: '미확인', remainingBoxes: null }),
  fifoPosition({ styleName: '미확인', remainingBoxes: 4 }),
  fifoPosition({ styleName: '뒤늦게 미확인', remainingBoxes: 4 }),
  fifoPosition({ styleName: '뒤늦게 미확인', remainingBoxes: null }),
  fifoPosition({ styleName: '박스창고만', zone: 'box_storage', locationCode: '#-1-1', remainingBoxes: 10 }),
])
assert.deepEqual(pickingBoxes.get('가방'), [
  { locationCode: '3-2-4_C1', boxes: 5 }, { locationCode: '3-2-5_C1', boxes: 1 },
], 'Same receipt date uses picking first, matching room-list positions')
assert.equal(pickingBoxes.has('빈 상품'), false)
assert.equal(pickingBoxes.get('미확인')[0].boxes, null)
assert.equal(pickingBoxes.get('뒤늦게 미확인')[0].boxes, null)
assert.deepEqual(pickingBoxes.get('박스창고만'), [])
const fifoExample = [
  fifoPosition({ locationCode: '3-1-1_C1', remainingBoxes: 2 }),
  fifoPosition({ locationCode: '3-1-2_C1', remainingBoxes: 3, receivedOn: '2026-11-02' }),
  fifoPosition({ zone: 'box_storage', locationCode: '#-1-1', remainingBoxes: 2, receivedOn: '2026-11-03' }),
  fifoPosition({ locationCode: '3-1-3_C1', remainingBoxes: 5, receivedOn: '2026-11-04' }),
]
assert.deepEqual(warehouseOutboundPickingBoxes([...fifoExample].reverse()).get('가방'), [
  { locationCode: '3-1-1_C1', boxes: 2 }, { locationCode: '3-1-2_C1', boxes: 3 },
], 'Only the initial picking segment contributes, regardless of source row order')
assert.deepEqual(warehouseOutboundPickingBoxes([
  ...fifoExample.slice(1), fifoPosition({ zone: 'box_storage', locationCode: '#-1-2' }),
]).get('가방'), [], 'Box storage at position 1 means zero picking boxes')
assert.deepEqual(warehouseOutboundPickingBoxes([
  ...fifoExample, fifoPosition({ locationCode: '3-1-1_C1', remainingBoxes: 99, receivedOn: '2026-11-05' }),
]).get('가방'), warehouseOutboundPickingBoxes(fifoExample).get('가방'), 'A later receipt at an earlier picking location cannot cross the box-storage boundary')
assert.deepEqual(warehouseOutboundPickingBoxes([
  fifoPosition({ zone: 'box_storage', locationCode: '(빈 자리)', receivedOn: '2026-01-01' }),
  fifoPosition({ zone: 'box_storage', remainingBoxes: 0, receivedOn: '2026-01-01' }),
  ...fifoExample,
]).get('가방'), warehouseOutboundPickingBoxes(fifoExample).get('가방'), 'Empty locations and depleted stock do not block FIFO')
assert.deepEqual(warehouseOutboundPickingBoxes([
  ...fifoExample, fifoPosition({ zone: 'box_storage', locationCode: '#-1-2', receivedOnRaw: '000000' }),
]).get('가방'), [], 'Forced priority marker uses the existing room-list priority')
assert.equal(warehouseOutboundDailyBoxes(2976, 31, 16), 6)
assert.equal(warehouseOutboundDailyBoxes(2976, 31, undefined), null)
assert.equal(warehouseOutboundDailyBoxes(2976, null, 16), null)
assert.equal(warehouseOutboundDailyBoxes(2976, 31, 0), null)
const popularItems = Array.from({ length: 25 }, (_, index) => ({ productName: `상품 ${index}`, quantity: index * 310 }))
const popularBoxes = new Map(popularItems.map(item => [item.productName, 10]))
const ranked = warehousePopularOutboundProducts(popularItems, '2026-10', popularBoxes)
assert.equal(ranked.length, 20)
assert.equal(ranked[0].productName, '상품 24')
assert.equal(ranked.at(-1).productName, '상품 5')
assert.equal(ranked[0].dailyBoxes, 24)
assert.equal(popularItems[0].productName, '상품 0', 'Ranking must not reorder the saved data')
assert.deepEqual(warehousePopularOutboundProducts(popularItems, '', popularBoxes), [])
assert.deepEqual(warehousePopularOutboundProducts(popularItems, '2026-10', new Map()), [])
const popularSamples = [
  { productName: '수량 많음', quantity: 3100 }, { productName: '박스 많음', quantity: 620 },
  { productName: '동점', quantity: 620 }, { productName: '박스 수량 없음', quantity: 99999 },
]
const popularSampleBoxes = new Map([['수량 많음', 100], ['박스 많음', 10], ['동점', 10]])
assert.deepEqual(warehousePopularOutboundProducts(popularSamples, '2026-10', popularSampleBoxes).map(item => item.productName), ['박스 많음', '동점', '수량 많음'])
assert.equal(warehousePopularOutboundProducts([{ productName: '윤년', quantity: 290 }], '2028-02', new Map([['윤년', 10]]))[0].dailyBoxes, 1)
assert.deepEqual(parseWarehouseOrganizationOutbound('상품명\t출고 수량\r\n"가방 A"\t2,977\r\n가방 B\t0\r\n'), {
  items: [{ productName: '가방 A', quantity: 2977 }, { productName: '가방 B', quantity: 0 }],
})
for (const invalid of ['가방\t-1', '가방\t1.5', '가방\t1,2', '가방\t', '가방\t2\t3', '가방 2']) {
  assert.ok(parseWarehouseOrganizationOutbound(invalid).error)
}

const samplePath = process.argv[2]
const sampleText = samplePath
  ? await readFile(samplePath, 'utf8')
  : Array.from({ length: 1010 }, (_, index) => `가방 ${index}\t${index % 5 === 0 ? 0 : index}`).join('\n')
const parsed = parseWarehouseOrganizationOutbound(sampleText)
assert.ok(parsed.items, parsed.error)
const payload = JSON.stringify(parsed.items)
const brand = '00000000-0000-4000-8000-000000000001'
const otherBrand = '00000000-0000-4000-8000-000000000002'
const table = 'public.warehouse_organization_outbound_months'
const db = await PGlite.create()
try {
  await db.exec(`
    create schema app;
    create role authenticated;
    create role anon;
    create table public.brands (id uuid primary key);
    create function app.basic_work_allowed(text, uuid) returns boolean language sql stable
      as $$ select $1 = 'logistics' and current_setting('test.work_domain', true) = 'logistics' $$;
    create function app.can_read_brand(uuid) returns boolean language sql stable
      as $$ select $1::text = current_setting('test.brand_id', true) $$;
    grant usage on schema app to authenticated;
  `)
  await db.query('insert into public.brands (id) values ($1), ($2)', [brand, otherBrand])
  const migration = new URL('../supabase/migrations/20261117022915_warehouse_organization_outbound_months.sql', import.meta.url)
  await db.exec(await readFile(migration, 'utf8'))

  const insert = (brandId, month, items = payload) => db.query(
    `insert into ${table} (brand_id, outbound_month, items) values ($1, $2, $3::jsonb) returning items, revision`,
    [brandId, month, items],
  )
  const read = () => db.query(`select outbound_month::text as month, items, revision from ${table} order by outbound_month`)
  const update = (expectedRevision, items) => db.query(
    `update ${table} set items = $1::jsonb, revision = $2::integer + 1
      where brand_id = $3 and outbound_month = '2026-10-01' and revision = $2 returning revision`,
    [items, expectedRevision, brand],
  )
  const setContext = (brandId, workDomain = 'logistics') => db.query(
    "select set_config('test.brand_id', $1, false), set_config('test.work_domain', $2, false)", [brandId, workDomain],
  )

  await db.exec('set role authenticated')
  await setContext(brand)
  const inserted = (await insert(brand, '2026-10-01')).rows[0]
  assert.equal(inserted.revision, 1)
  assert.deepEqual(inserted.items, parsed.items)
  await assert.rejects(() => insert(brand, '2026-10-01'), { code: '23505' })
  const otherMonthPayload = JSON.stringify([{ productName: '이전 달', quantity: 3 }])
  await insert(brand, '2026-09-01', otherMonthPayload)
  const saved = (await read()).rows
  assert.deepEqual(saved[1].items, parsed.items)
  assert.deepEqual(saved.map(row => row.month), ['2026-09-01', '2026-10-01'])

  await assert.rejects(() => insert(brand, '2026-11-02'), { code: '23514' })
  await assert.rejects(() => insert(brand, 'infinity'), { code: '23514' })
  for (const invalid of [null, {}, [], [{ productName: '', quantity: 1 }], [{ productName: '가방', quantity: 0.5 }]]) {
    await assert.rejects(() => insert(brand, '2026-11-01', JSON.stringify(invalid)), { code: '22023' })
  }
  await assert.rejects(() => insert(otherBrand, '2026-10-01'), { code: '42501' })
  await setContext(otherBrand)
  assert.deepEqual((await read()).rows, [])
  await setContext(brand, 'planning')
  assert.deepEqual((await read()).rows, [])
  await assert.rejects(() => insert(brand, '2026-11-01'), { code: '42501' })
  await setContext(brand)

  const replacement = JSON.stringify([{ productName: '가방', quantity: 0 }])
  assert.deepEqual((await update(1, replacement)).rows, [{ revision: 2 }])
  assert.deepEqual((await update(1, payload)).rows, [])
  assert.deepEqual((await read()).rows, [
    saved[0],
    { month: '2026-10-01', items: JSON.parse(replacement), revision: 2 },
  ])
  await db.exec('reset role; set role anon')
  await assert.rejects(read, { code: '42501' })
  const total = parsed.items.reduce((sum, row) => sum + row.quantity, 0)
  const zero = parsed.items.filter(row => row.quantity === 0).length
  console.log(`warehouse outbound paste/save/read: ok (${parsed.items.length} rows, ${total} units, ${zero} zero-quantity rows)`)
} finally {
  await db.close()
}
