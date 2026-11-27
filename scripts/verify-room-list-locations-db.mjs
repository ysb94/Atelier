import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { indexRoomListLocations, indexRoomListStyleNumbers, roomListProductName } from '../src/features/logistics/room-list-locations.ts'

const db = await PGlite.create()
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0')
const [brand, otherBrand, set, inactiveSet, otherSet, warehouse, picking, box, sku, sku2] =
  Array.from({ length: 10 }, (_, index) => id(index + 1))
const lookup = async (names, offset = 0, brandId = brand, setId = set) =>
  (await db.query('select * from public.list_room_list_stock_positions($1,$2,$3,$4)', [brandId, setId, names, offset])).rows
const specialName = '가방 (A,"B"), %_'
const longName = '한'.repeat(3000)
try {
  await db.exec(`
    create schema app;
    create role anon; create role authenticated; create role service_role;
    grant usage on schema app to authenticated;
    create sequence app.brand_check_calls;
    grant usage, select on app.brand_check_calls to authenticated;
    create function app.can_read_brand(uuid) returns boolean language plpgsql stable
      as $$ begin
        perform nextval('app.brand_check_calls');
        return $1 = '${brand}'::uuid;
      end $$;
    create table warehouse_inventory_sets (id uuid primary key, brand_id uuid, kind text, status text);
    create table warehouse_locations (id uuid primary key, zone text, code text, visible boolean default true);
    create table warehouse_stock_positions (
      id uuid primary key, brand_id uuid, set_id uuid, warehouse_id uuid, location_id uuid, style_id uuid,
      source_product_name text, normalized_style_no text, source_style_no text, received_on date,
      received_on_raw text, quantity_status text, units_per_box integer, remaining_boxes integer,
      opened_units integer, source_row_number integer, created_at timestamptz, note text
    );
    create index warehouse_stock_positions_finder_name_idx
      on warehouse_stock_positions (brand_id, set_id, source_product_name text_pattern_ops);
    grant select on warehouse_inventory_sets, warehouse_locations, warehouse_stock_positions to authenticated;
    alter table warehouse_inventory_sets enable row level security;
    alter table warehouse_locations enable row level security;
    alter table warehouse_stock_positions enable row level security;
    create policy set_read on warehouse_inventory_sets to authenticated using (app.can_read_brand(brand_id));
    create policy location_read on warehouse_locations to authenticated using (visible);
    create policy position_read on warehouse_stock_positions to authenticated using (app.can_read_brand(brand_id));
    insert into warehouse_inventory_sets values
      ('${set}','${brand}','sandbox','active'), ('${inactiveSet}','${brand}','sandbox','archived'),
      ('${otherSet}','${otherBrand}','sandbox','active');
    insert into warehouse_locations values
      ('${picking}','picking','2-1-1',true), ('${box}','box_storage','3-2-2',true),
      ('${id(11)}','box_storage','4-1-1',false);
  `)
  await db.exec(await readFile(new URL('../supabase/migrations/20261127033501_room_list_stock_positions.sql', import.meta.url), 'utf8'))

  const insert = (name, brandId, setId, count, location = box, style = sku, number = 'M1001') => db.query(`
    insert into warehouse_stock_positions
    select gen_random_uuid(), $1, $2, '${warehouse}', $3, $4, $5, $6, $6,
      date '2026-11-01', '2026-11-01', 'known', 50, 1, 0, 10, timestamp with time zone '2026-11-01 00:00+00',
      repeat('메모',100)
    from generate_series(1,$7)
  `, [brandId, setId, location, style, name, number, count])
  await insert('\u00a0' + specialName.normalize('NFD') + '\ufeff', brand, set, 260)
  await insert(specialName, brand, set, 1, picking)
  await insert(specialName, brand, set, 1, box, sku2, 'M1002')
  await insert(specialName, brand, set, 1, id(11))
  await insert(specialName, brand, inactiveSet, 1)
  await insert(specialName, otherBrand, otherSet, 1)
  await insert(specialName + ' 추가', brand, set, 1100)
  await insert(longName, brand, set, 1)

  await db.exec('analyze warehouse_stock_positions; set role authenticated')
  const priorPages = [
    ...await lookup([specialName]),
    ...await lookup([specialName], 250),
  ]
  const checkCount = async () => Number((await db.query('select last_value from app.brand_check_calls')).rows[0].last_value)
  const checksForRareName = async () => {
    const start = await checkCount()
    assert.equal((await lookup([longName])).length, 1)
    return await checkCount() - start
  }
  const priorChecks = await checksForRareName()
  await db.exec('reset role')
  await db.exec(await readFile(new URL('../supabase/migrations/20261127044112_room_list_indexed_source_names.sql', import.meta.url), 'utf8'))

  const importedName = '검증 가방'
  const paddedName = '\u3000' + importedName.normalize('NFD') + '\u205f'
  await insert(paddedName, brand, set, 1)
  await db.exec('set role anon')
  await assert.rejects(lookup([specialName]), { code: '42501' })
  await db.exec('reset role; set role authenticated')
  await assert.rejects(lookup([specialName], 0, otherBrand, otherSet), { code: '42501' })
  await assert.rejects(lookup([specialName], 0, brand, inactiveSet), { code: 'P0002' })
  await assert.rejects(lookup(Array.from({ length: 101 }, (_, index) => `상품 ${index}`)), { code: '22023' })
  assert.deepEqual(await lookup([]), [])
  assert.deepEqual(await lookup(['가방']), [])
  const indexedChecks = await checksForRareName()
  assert.ok(indexedChecks < priorChecks / 2, `unrelated stock still triggers brand checks: ${indexedChecks} vs ${priorChecks}`)
  const page1 = await lookup([specialName, specialName.normalize('NFD')])
  const page2 = await lookup([specialName], 250)
  assert.equal(page1.length, 250)
  assert.equal(page2.length, 12)
  const rows = [...page1, ...page2]
  assert.deepEqual(rows, priorPages, 'the migration preserves every field and the order across pages')
  assert.equal(new Set(rows.map(row => row.id)).size, 262, 'stable paging even when source row numbers tie')
  assert.ok(rows.every(row => roomListProductName(row.source_product_name) === specialName))

  const old = (await db.query(`select p.*, l.zone, l.code as location_code
    from warehouse_stock_positions p join warehouse_locations l on l.id=p.location_id
    where p.brand_id=$1 and p.set_id=$2 order by p.source_row_number,p.id`, [brand, set])).rows
  assert.deepEqual(rows.map(row => row.id), old.filter(row => roomListProductName(row.source_product_name) === specialName).map(row => row.id))
  const adapt = row => ({
    brandId: brand, warehouseId: row.warehouse_id, locationCode: row.location_code, zone: row.zone,
    styleId: row.style_id, styleNo: row.normalized_style_no, styleName: row.source_product_name,
    sourceStyleNo: row.source_style_no, receivedOn: row.received_on?.toISOString().slice(0, 10) ?? null,
    receivedOnRaw: row.received_on_raw,
    sourceRowNumber: row.source_row_number, createdAt: String(row.created_at),
    quantityStatus: row.quantity_status, unitsPerBox: row.units_per_box,
    remainingBoxes: row.remaining_boxes, openedUnits: row.opened_units,
  })
  assert.deepEqual(indexRoomListLocations(rows.map(adapt)).locations.get(specialName),
    indexRoomListLocations(old.map(adapt)).locations.get(specialName))
  assert.equal(indexRoomListStyleNumbers([], rows.map(adapt)).get(specialName), undefined,
    'a conflicting second SKU suppresses the M-number')

  const imported = await lookup([importedName])
  assert.equal(imported.length, 1)
  assert.equal(imported[0].source_product_name, paddedName)
  const renamed = importedName + ' 추가'
  await db.exec('reset role')
  await db.query('update warehouse_stock_positions set source_product_name=$1 where id=$2', [renamed, imported[0].id])
  await db.exec('set role authenticated')
  assert.deepEqual(await lookup([importedName]), [], 'a longer name must not match its former name')
  assert.deepEqual((await lookup([renamed])).map(row => row.id), [imported[0].id])

  await db.exec('reset role')
  await db.query('update warehouse_stock_positions set source_product_name=$1 where id=$2', [paddedName, imported[0].id])
  await db.exec('set role authenticated')
  assert.deepEqual(await lookup([renamed]), [])
  assert.deepEqual(await lookup([importedName, paddedName]), imported, 'an edited raw variant is returned exactly once')

  await db.exec('reset role')
  await db.query('delete from warehouse_stock_positions where id=$1', [imported[0].id])
  await db.exec('set role authenticated')
  assert.deepEqual(await lookup([importedName]), [], 'deleted stock must disappear from the lookup')

  const bytes = data => Buffer.byteLength(JSON.stringify(data))
  assert.ok(bytes(rows) < bytes(old))
  console.log(`Room list DB: exact normalized matches, stable pagination, brand isolation and position parity. Rare-name brand checks ${priorChecks} → ${indexedChecks}. Fixture rows ${old.length} → ${rows.length}, bytes ${bytes(old)} → ${bytes(rows)}.`)
} finally {
  await db.close()
}
