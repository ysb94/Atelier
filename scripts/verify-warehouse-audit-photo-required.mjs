import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const db = await PGlite.create()
const id = n => 'a0000000-0000-4000-8000-' + String(n).padStart(12, '0')
const [brand, actor, warehouse, set, location, style, auditId] = [1, 2, 3, 4, 5, 6, 7].map(id)
const migration = name => readFile(new URL('../supabase/migrations/' + name + '.sql', import.meta.url), 'utf8')
const call = async (action, fields = {}) => (await db.query(
  'select app.finder_warehouse_qr_audit_db($1,$2,$3) as response',
  [brand, action, { id: auditId, place: '2-4-1', ...fields }],
)).rows[0].response
const photo = `${brand}/${actor}/${auditId}/${id(8)}.jpg`

try {
  await db.exec(`
    create schema app; create schema auth; create schema storage;
    create role anon; create role authenticated;
    create function auth.uid() returns uuid language sql stable as $$ select '${actor}'::uuid $$;
    create function app.can_use_masma_finder_feature(uuid,text) returns boolean language sql stable as $$
      select $1='${brand}'::uuid and $2='test' $$;
    create table brands(id uuid primary key, slug text);
    create table warehouse_inventory_sets(id uuid primary key, warehouse_id uuid, brand_id uuid, kind text, status text, row_count bigint, updated_at timestamptz);
    create table warehouse_locations(id uuid primary key, warehouse_id uuid, code text, zone text);
    create table warehouse_registered_slots(warehouse_id uuid, code text, zone text);
    create table warehouse_stock_positions(id uuid primary key default gen_random_uuid(), brand_id uuid, set_id uuid, warehouse_id uuid, location_id uuid,
      style_id uuid, source_style_no text, normalized_style_no text, source_product_name text, received_on date, received_on_raw text,
      usage_priority text, is_final_location boolean, is_forced_priority boolean, quantity_status text, units_per_box integer,
      remaining_boxes integer, opened_units integer, units_per_box_raw text, remaining_boxes_raw text, review_flags text[],
      source_row_number integer, note text, external_row_id text, box_qr text);
    create table warehouse_boxes(brand_id uuid, display_code text, location_id uuid, style_id uuid, received_on date, initial_qty integer,
      current_qty integer, source_position_id uuid, note text, usage_priority text, created_by uuid, presumed_depleted_at timestamptz,
      updated_at timestamptz, archived_at timestamptz, completed_at timestamptz, unique(brand_id,display_code));
    create table warehouse_stock_condition_links(brand_id uuid, external_row_id text, source_product_name text, reference_style_id uuid, condition text,
      primary key(brand_id,external_row_id));
    create table warehouse_stock_movements(brand_id uuid, set_id uuid, action text, from_location_code text, to_location_code text, box_count integer,
      reason text, actor_id uuid);
    create table storage.objects(bucket_id text, name text);
    create table app.finder_warehouse_placement_operations(brand_id uuid, finished_at timestamptz, cancelled_at timestamptz);
    create table app.finder_warehouse_sheet_exports(brand_id uuid, sheet_synced_at timestamptz);
    create table app.warehouse_stock_condition_exports(brand_id uuid, sheet_synced_at timestamptz);
    create table app.finder_warehouse_presumed_boxes(brand_id uuid, box_qr text, snapshot jsonb, primary key(brand_id,box_qr));
    create table app.warehouse_qr_audit_writes(brand_id uuid, transaction_id xid8);
    create function app.ensure_warehouse_box_location(uuid,text,text) returns uuid language sql as $$
      select id from public.warehouse_locations where code=$2 and zone=$3 $$;
    insert into brands values ('${brand}','masmarulez');
    insert into warehouse_inventory_sets values ('${set}','${warehouse}','${brand}','sandbox','active',3,now());
    insert into warehouse_locations values ('${location}','${warehouse}','2-4-1','box_storage');
    insert into warehouse_registered_slots values ('${warehouse}','2-4-1','box_storage');
  `)
  const baseline = await migration('20261115134809_warehouse_qr_reconciliation')
  await db.exec(baseline.slice(0, baseline.indexOf('alter table app.warehouse_qr_audits')))
  for (const name of ['can_upload_warehouse_qr_audit_photo', 'sync_warehouse_qr_audit_box', 'finder_warehouse_qr_audit']) {
    const fn = baseline.match(new RegExp('create function app\\.' + name + '\\([\\s\\S]*?\\n\\$\\$;'))
    assert(fn, name)
    await db.exec(fn[0])
  }
  await db.exec('alter function app.finder_warehouse_qr_audit(uuid,text,jsonb) rename to finder_warehouse_qr_audit_db')
  async function seed(n, product, sku, units, status) {
    await db.query(`insert into warehouse_stock_positions(id,brand_id,set_id,warehouse_id,location_id,style_id,source_product_name,
      units_per_box,quantity_status,remaining_boxes,opened_units,external_row_id,box_qr)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,1,0,$10,$11)`, [id(n),brand,set,warehouse,location,sku,product,units,status,'old-'+n,'QR-'+n])
  }
  await seed(10,'M0144',null,14,'known')
  await seed(11,'피코 미니 토트백',style,null,'unknown')
  await seed(12,'수선품',null,20,'known')
  await seed(13,'정상 재고',style,80,'known')
  await db.query('insert into warehouse_stock_condition_links values($1,$2,$3,$4,$5)', [brand,'old-12','수선품',style,'repair'])
  const original = await call('place')
  await db.exec(await migration('20261124094309_warehouse_audit_require_verified_source'))
  const current = await call('place')
  assert.equal(current.baseline, original.baseline)
  assert.equal(current.rows.find(row => row.id === id(12)).condition_style_id, style)
  const known = (n, units) => ({ qr: 'QR-'+n, source_id: id(n), units })
  const request = entries => ({ baseline: current.baseline, entries })
  const review = (n, path) => ({ qr: 'QR-'+n, photo_path: path })
  for (const bad of [known(10,14), known(11,10), known(13,null)]) {
    for (const action of ['preview','confirm']) await assert.rejects(call(action,request([bad])), { code: '22023' })
  }
  const secondPhoto = photo.replace(id(8),id(9))
  const entries = [{...review(10,photo), review_source_id:id(10)}, {...review(11,secondPhoto), review_source_id:id(11)},
    known(12,20),known(13,80)]
  await assert.rejects(call('preview',request(entries)), /사진을 올려주세요/)
  await db.query("insert into storage.objects values ('warehouse-qr-audit',$1),('warehouse-qr-audit',$2)", [photo,secondPhoto])
  await assert.rejects(call('preview',request([{...entries[0],units:14}])), { code: '22023' })
  await assert.rejects(call('preview',request([{...entries[0],review_source_id:id(11)}])), { code: '22023' })
  const foreignPhoto = photo.replace(actor,id(99))
  await db.query("insert into storage.objects values ('warehouse-qr-audit',$1)",[foreignPhoto])
  await assert.rejects(call('preview',request([{...entries[0],photo_path:foreignPhoto}])), /사진을 올려주세요/)
  await assert.rejects(call('preview',request([entries[0],entries[0]])), /두 번/)
  await assert.rejects(call('preview',request([{...entries[0],qr:''}])), /박스 QR/)
  assert.deepEqual((await call('place')).rows, current.rows)
  const {token} = await call('preview',request(entries))
  assert.equal((await call('confirm',{...request(entries),token})).boxes,4)
  assert.equal((await call('confirm',request([known(10,14)]))).complete,true)
  const stock = (await call('place')).rows
  assert.equal(stock.length,4)
  assert.equal(stock.find(r=>r.box_qr==='QR-13').units_per_box,80)
  assert.equal(stock.find(r=>r.box_qr==='QR-12').condition_style_id,style)
  assert.equal(stock.find(r=>r.box_qr==='QR-10').units_per_box,14)
  assert.equal(stock.find(r=>r.box_qr==='QR-10').style_id,null)
  assert.equal(stock.find(r=>r.box_qr==='QR-11').style_id,style)
  assert.equal(stock.find(r=>r.box_qr==='QR-11').units_per_box,null)
  const photos = (await db.query('select box_qr from app.warehouse_qr_audit_boxes where photo_path is not null and reviewed_at is null order by box_qr')).rows
  assert.deepEqual(photos.map(r=>r.box_qr),['QR-10','QR-11'])
  const audit = (await db.query('select before_rows from app.warehouse_qr_audits')).rows
  assert.equal(audit.length,1)
  assert.deepEqual(audit[0].before_rows,original.rows)
  console.log('PASS: checked real QR audit preview, confirmation, condition SKU, photo ownership, untouched stock on rejection and historical replay.')
} finally {
  await db.close()
}
