import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import {
  parseWarehouseOrganizationOutbound,
  previousWarehouseOutboundMonth,
} from '../src/features/logistics/warehouse-organization-outbound.ts'

assert.equal(previousWarehouseOutboundMonth(new Date('2026-12-31T15:00:00Z')), '2026-12')
assert.equal(previousWarehouseOutboundMonth(new Date('2026-11-17T01:00:00Z')), '2026-10')
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
