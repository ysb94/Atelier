import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const db = await PGlite.create()
const id = value => '00000000-0000-4000-8000-' + String(value).padStart(12, '0')
const brand = id(1), otherBrand = id(2), company = id(3)
const atelier = id(10), finder = id(11), style = id(20), box = id(21), position = id(22)
const migration = new URL('../supabase/migrations/20261119045000_warehouse_activity_history.sql', import.meta.url)
const sql = async (query, params) => (await db.query(query, params)).rows
const list = (selectedBrand = brand, qr = null, search = null, beforeAt = null, beforeId = null) => sql(
  'select * from public.list_warehouse_activity($1,$2,$3,$4,$5)', [selectedBrand, qr, search, beforeAt, beforeId],
)
const signIn = actor => sql("select set_config('request.jwt.claim.sub',$1,false)", [actor])
const snapshot = (aa, qr, place, count) => ({
  id: aa, qr, values: ['M1234', '검증 상품', place, '261101', '12', String(count), ''],
})
const sheet = (target, record, actor, action, before, after) => sql(
  `insert into app.warehouse_qr_audit_sheet_exports(id,brand_id,stock_actor_id,stock_request,before_rows,after_rows)
   values($1,$2,$3,$4,$5::jsonb,$6::jsonb) on conflict do nothing`,
  [record, target, actor, { action }, JSON.stringify(before), JSON.stringify(after)],
)

try {
  await db.exec(`
    create schema app; create schema auth;
    create role anon; create role authenticated; create role service_role;
    grant usage on schema app,auth to authenticated;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    create table brands(id uuid primary key,company_id uuid);
    create table profiles(id uuid primary key,company_id uuid,display_name text);
    create function app.can_read_brand(uuid) returns boolean language sql stable as $$ select auth.uid() is not null $$;
    create function app.can_read_company(uuid) returns boolean language sql stable as $$
      select exists(select 1 from public.profiles p where p.company_id=$1 and p.id=auth.uid())
    $$;
    create table styles(id uuid primary key,brand_id uuid,style_no text,name text);
    create table warehouse_boxes(id uuid primary key,brand_id uuid,style_id uuid,display_code text);
    create table warehouse_stock_positions(id uuid primary key,brand_id uuid,external_row_id text,box_qr text,
      source_style_no text,source_product_name text);
    create table warehouse_stock_movements(id uuid default gen_random_uuid() primary key,brand_id uuid,action text,
      position_id uuid,box_id uuid,style_id uuid,from_location_code text,to_location_code text,box_count integer,
      unit_count integer,reason text,actor_id uuid,created_at timestamptz default now());
    create table warehouse_box_movements(id uuid default gen_random_uuid() primary key,brand_id uuid,box_id uuid,
      action text,from_location_code text,to_location_code text,from_qty integer,to_qty integer,reason text,
      actor_id uuid,created_at timestamptz default now());
    create table app.warehouse_qr_audit_sheet_exports(id uuid primary key,brand_id uuid,whole_place text,
      before_rows jsonb,after_rows jsonb,stock_actor_id uuid,stock_request jsonb,
      queued_at timestamptz default clock_timestamp(),sheet_synced_at timestamptz);
    create table app.warehouse_stock_condition_exports(brand_id uuid,request_id uuid,external_row_id text,
      before_values jsonb,sheet_values jsonb,saved_at timestamptz default clock_timestamp());
    create table app.finder_warehouse_placement_operations(id uuid,brand_id uuid,request jsonb,plan jsonb,actor_id uuid);
    create table app.finder_unplaced_box_qr_links(id uuid,brand_id uuid);
    create table app.warehouse_qr_audits(id uuid,brand_id uuid,actor_id uuid);
    insert into brands values ('${brand}','${company}'),('${otherBrand}','${id(4)}');
    insert into profiles values ('${atelier}','${company}','아틀리에 직원'),('${finder}','${company}','파인더 직원');
    insert into styles values ('${style}','${brand}','M1234','검증 상품');
    insert into warehouse_boxes values ('${box}','${brand}','${style}','QR-TEST');
    insert into warehouse_stock_positions values ('${position}','${brand}','aa-qr-less',null,'M1234','검증 상품');
    insert into warehouse_box_movements(brand_id,box_id,action,to_location_code,to_qty,actor_id)
      values ('${brand}','${box}','receive','3-1-1',12,'${atelier}');
  `)
  await db.exec(await readFile(migration, 'utf8'))
  await signIn(atelier)
  await db.exec('set role authenticated')
  assert.equal((await list()).length, 0, 'historical aggregate records are not fabricated')
  assert.equal((await list(brand, ' qr-test '))[0].actor_name, '아틀리에 직원')
  await assert.rejects(list(otherBrand), { code: '42501' })
  await assert.rejects(list(brand, null, null, '2026-11-01T00:00:00Z'), { code: '22023' })
  await assert.rejects(sql('select * from app.warehouse_activity'), { code: '42501' })
  await db.exec('reset role; set role anon')
  await assert.rejects(list(), { code: '42501' })
  await db.exec('reset role')

  const withoutQr = snapshot('aa-qr-less', '', '3-1-1', 2)
  await db.exec(`
    begin;
    insert into warehouse_stock_movements(brand_id,action,position_id,style_id,from_location_code,actor_id)
      values ('${brand}','deplete','${position}','${style}','3-1-1','${atelier}');
  `)
  await sheet(brand, id(30), atelier, 'deplete', [withoutQr], [])
  await db.exec('commit')
  const [depletion] = await list()
  assert.deepEqual([depletion.source, depletion.action, depletion.actor_name, depletion.before_rows[0].boxes, depletion.after_rows],
    ['atelier', 'deplete', '아틀리에 직원', '2', []])
  assert.equal((await list()).length, 1)

  const beforeQr = snapshot('aa-box', 'qr-test', '3-1-1', 1)
  const afterQr = snapshot('aa-box', 'QR-TEST', '3-2-1//', 1)
  await signIn(finder)
  await db.exec(`
    begin;
    insert into app.finder_warehouse_placement_operations values ('${id(31)}','${brand}','{"mode":"place"}',
      '{"place":"3-2-1","write":{"source":{"place":"3-1-1"},"place":"3-2-1","reason":"Finder 자리 이동"}}','${finder}');
    insert into warehouse_stock_movements(brand_id,action,style_id,from_location_code,to_location_code,actor_id)
      values ('${brand}','move','${style}','3-1-1','3-2-1','${finder}');
    insert into warehouse_box_movements(brand_id,box_id,action,from_location_code,to_location_code,actor_id)
      values ('${brand}','${box}','move','3-1-1','3-2-1','${finder}');
  `)
  const clearedQr = snapshot('aa-cleared', 'QR-CLEARED', '3-2-1', 1)
  await sheet(brand, id(31), finder, 'finder', [clearedQr, beforeQr], [afterQr])
  await db.exec('commit')
  await sheet(brand, id(31), finder, 'finder', [beforeQr], [afterQr])
  await db.exec(`update app.warehouse_qr_audit_sheet_exports set sheet_synced_at=now() where id='${id(31)}'`)
  assert.equal((await list()).length, 2, 'related stock and box movements and retry display as one work event')
  let result = await list(brand, 'qr-test')
  assert.deepEqual(result.map(event => [event.source, event.action, event.actor_name]), [
    ['finder', 'move', '파인더 직원'], ['warehouse', 'receive', '아틀리에 직원'],
  ])
  assert.equal(result[0].after_rows[0].location, '3-2-1//')
  assert.equal((await list(brand, 'QR-TES')).length, 0, 'QR matches exactly')
  assert.equal((await list(brand, 'QR-CLEARED'))[0].action, 'presumed_deplete',
    'the box cleared during another box move has its own QR status')

  await signIn('')
  await sheet(brand, id(32), finder, 'finder-cargo', [], [snapshot('aa-cargo', '', '3-3-1', 1)])
  await signIn(atelier)
  await db.exec(`
    begin;
    insert into warehouse_stock_movements(brand_id,action,position_id,style_id,to_location_code,actor_id)
      values ('${brand}','adjust','${position}','${style}','3-1-1','${atelier}');
    insert into app.warehouse_stock_condition_exports values ('${brand}','${id(33)}','aa-qr-less',
      '{"number":"M1234","place":"3-1-1","boxes":"1"}','{"number":"M1234","place":"3-1-1","boxes":"3","note":"실수량 확인"}');
    commit;
    insert into warehouse_stock_movements(brand_id,action,actor_id) values ('${brand}','import','${atelier}');
    insert into warehouse_stock_movements(brand_id,action,actor_id) values ('${brand}','restore','${atelier}');
    update profiles set display_name='변경 이름' where id='${finder}';
    begin;
  `)
  await sheet(brand, id(34), atelier, 'receive', [], [withoutQr])
  await db.exec('rollback')
  await sheet(otherBrand, id(35), null, 'receive', [], [withoutQr])
  await db.exec('set role authenticated')
  assert.equal((await list()).length, 4, 'only committed work on the selected brand is visible')
  result = await list(brand, null, '파인더 직원')
  assert.deepEqual(result.map(event => event.action), ['receive', 'move'])
  assert.equal(result[0].after_rows[0].id, 'aa-cargo')
  result = await list(brand, null, '실수량 확인')
  assert.equal(result.length, 1)
  assert.equal(result[0].after_rows[0].boxes, '3')
  const [latest] = await sql('select id,created_at::text as stamp from public.list_warehouse_activity($1) limit 1', [brand])
  assert.equal((await list(brand, null, null, latest.stamp, latest.id)).length, 3)
  console.log('Warehouse activity history DB verification passed')
} catch (error) {
  if (!error.code || error.code.startsWith('ERR_')) throw error
  console.error(error.message, error.code, error.where ?? error.query)
  process.exitCode = 1
} finally {
  await db.close()
}
