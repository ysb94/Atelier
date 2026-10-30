import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const db = await PGlite.create()
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0')
const brand = id(1), otherBrand = id(2), company = id(3), otherCompany = id(4), warehouse = id(11), otherWarehouse = id(12), active = id(21), archived = id(22), otherSet = id(23)
const migration = await fs.readFile(new URL('../supabase/migrations/20261030092330_warehouse_slot_reclassify.sql', import.meta.url), 'utf8')
try {
  await db.exec(`
    create schema auth; create schema app; create role anon; create role authenticated;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function app.can_edit_brand(uuid) returns boolean language sql stable as $$ select $1::text = current_setting('test.allowed_brand',true) $$;
    create function app.basic_work_allowed(text,uuid) returns boolean language sql stable as $$ select false $$;
    create table brands(id uuid primary key, company_id uuid not null);
    create table warehouses(id uuid primary key, company_id uuid not null);
    create table warehouse_inventory_sets(id uuid primary key, brand_id uuid not null references brands, warehouse_id uuid not null references warehouses, kind text not null, status text not null, updated_at timestamptz default now());
    create table warehouse_locations(id uuid primary key default gen_random_uuid(), company_id uuid not null, warehouse_id uuid not null references warehouses, code text not null, zone text not null check(zone in ('picking','box_storage')), unique(warehouse_id,zone,code));
    create table warehouse_registered_slots(warehouse_id uuid references warehouses,code text not null check(length(btrim(code))>0),zone text not null check(zone in ('picking','box_storage')),primary key(warehouse_id,code));
    create table warehouse_stock_positions(id uuid primary key,brand_id uuid not null references brands,set_id uuid not null references warehouse_inventory_sets,warehouse_id uuid not null references warehouses,location_id uuid not null references warehouse_locations,style_id uuid not null,units_per_box int,remaining_boxes int,opened_units int,source_row_number int,note text);
    insert into brands values ('${brand}','${company}'),('${otherBrand}','${otherCompany}');
    insert into warehouses values ('${warehouse}','${company}'),('${otherWarehouse}','${otherCompany}');
    insert into warehouse_inventory_sets(id,brand_id,warehouse_id,kind,status) values ('${active}','${brand}','${warehouse}','sandbox','active'),('${archived}','${brand}','${warehouse}','sandbox','archived'),('${otherSet}','${otherBrand}','${otherWarehouse}','sandbox','active');
    insert into warehouse_locations values
      ('${id(101)}','${company}','${warehouse}','3-1-1_C1','box_storage'),
      ('${id(102)}','${company}','${warehouse}','3-1-1_C1','picking'),
      ('${id(103)}','${company}','${warehouse}','3-1-1-C-1','picking'),
      ('${id(104)}','${company}','${warehouse}','3-1-1','picking'),
      ('${id(105)}','${company}','${warehouse}','임시 자리 7','box_storage'),
      ('${id(106)}','${otherCompany}','${otherWarehouse}','3-1-1_C1','box_storage');
    insert into warehouse_registered_slots values ('${warehouse}','3-1-1-C-1','picking'),('${warehouse}','2-1-1','box_storage'),('${otherWarehouse}','other-slot','picking');
    insert into warehouse_stock_positions values
      ('${id(201)}','${brand}','${active}','${warehouse}','${id(101)}','${id(301)}',10,2,0,1,'original-1'),
      ('${id(202)}','${brand}','${active}','${warehouse}','${id(103)}','${id(302)}',20,3,2,2,'original-2'),
      ('${id(203)}','${brand}','${active}','${warehouse}','${id(104)}','${id(303)}',30,4,0,3,'original-3'),
      ('${id(204)}','${brand}','${active}','${warehouse}','${id(105)}','${id(304)}',null,null,0,4,'unknown-qty'),
      ('${id(205)}','${brand}','${archived}','${warehouse}','${id(101)}','${id(301)}',10,5,0,5,'archived'),
      ('${id(206)}','${otherBrand}','${otherSet}','${otherWarehouse}','${id(106)}','${id(301)}',10,6,0,6,'other-brand');
    alter table brands enable row level security; alter table warehouses enable row level security;
    alter table warehouse_inventory_sets enable row level security; alter table warehouse_locations enable row level security;
    alter table warehouse_registered_slots enable row level security; alter table warehouse_stock_positions enable row level security;
    create policy brand_access on brands to authenticated using(app.can_edit_brand(id));
    create policy warehouse_access on warehouses to authenticated using(exists(select 1 from brands b where b.company_id=warehouses.company_id and app.can_edit_brand(b.id)));
    create policy sets_access on warehouse_inventory_sets to authenticated using(app.can_edit_brand(brand_id)) with check(app.can_edit_brand(brand_id));
    create policy locations_access on warehouse_locations to authenticated using(exists(select 1 from brands b where b.company_id=warehouse_locations.company_id and app.can_edit_brand(b.id))) with check(exists(select 1 from brands b where b.company_id=warehouse_locations.company_id and app.can_edit_brand(b.id)));
    create policy slots_access on warehouse_registered_slots to authenticated using(exists(select 1 from warehouses w where w.id=warehouse_id)) with check(exists(select 1 from warehouses w where w.id=warehouse_id));
    create policy stock_read on warehouse_stock_positions for select to authenticated using(app.can_edit_brand(brand_id));
    create policy stock_update on warehouse_stock_positions for update to authenticated using(app.can_edit_brand(brand_id) and coalesce(current_setting('test.deny_stock',true),'') <> 'on') with check(app.can_edit_brand(brand_id));
    grant usage on schema public,auth,app to authenticated;
    grant select on brands,warehouses to authenticated;
    grant select,insert,update,delete on warehouse_registered_slots,warehouse_locations,warehouse_stock_positions,warehouse_inventory_sets to authenticated;
    select set_config('request.jwt.claim.sub','${id(401)}',false),set_config('test.allowed_brand','${brand}',false);
  `)
  await db.exec(migration)
  const { rows: security } = await db.query("select prosecdef,has_function_privilege('anon',oid,'execute') as anon,has_function_privilege('authenticated',oid,'execute') as signed_in from pg_proc where oid='public.save_warehouse_registered_slots(uuid,uuid,text,text[])'::regprocedure")
  assert.deepEqual(security[0], { prosecdef: false, anon: false, signed_in: true })
  async function snapshot() {
    await db.exec('reset role')
    const result = (await db.query("select jsonb_build_object('stock',(select jsonb_agg(to_jsonb(p) order by id) from warehouse_stock_positions p),'slots',(select jsonb_agg(to_jsonb(r) order by warehouse_id,code) from warehouse_registered_slots r),'locations',(select jsonb_agg(to_jsonb(l) order by id) from warehouse_locations l)) as data")).rows[0].data
    await db.exec('set role authenticated')
    return result
  }
  async function save(codes, zone = 'picking', selectedBrand = brand, selectedWarehouse = warehouse) {
    return (await db.query('select public.save_warehouse_registered_slots($1,$2,$3,$4::text[]) as result', [selectedBrand, selectedWarehouse, zone, codes])).rows[0].result
  }
  const before = await snapshot()
  const first = await save(['3-1-1_C1', ' 임시 자리 7 ', '3-1-1_C1'])
  assert.deepEqual(first, { registered_count: 2, reclassified_count: 4 })
  const after = await snapshot()
  assert.deepEqual(after.stock.map(({ location_id: _location, ...row }) => row), before.stock.map(({ location_id: _location, ...row }) => row), 'all row IDs, products, quantities, notes and archived records are unchanged')
  assert.deepEqual(after.stock.filter((row) => row.set_id !== active), before.stock.filter((row) => row.set_id !== active), 'other brands and archived snapshots retain their location IDs')
  assert.deepEqual(after.locations.filter((row) => before.locations.some((old) => old.id === row.id)), before.locations, 'original location rows are immutable, including duplicate codes in two zones')
  assert.ok(after.slots.some((row) => row.warehouse_id === otherWarehouse && row.code === 'other-slot'))
  assert.ok(after.slots.some((row) => row.warehouse_id === warehouse && row.code === '2-1-1' && row.zone === 'box_storage'))
  const zones = (await db.query('select l.code,l.zone from warehouse_stock_positions p join warehouse_locations l on l.id=p.location_id where p.set_id=$1 order by p.source_row_number', [active])).rows
  assert.deepEqual(zones, [{ code: '3-1-1_C1', zone: 'picking' }, { code: '3-1-1-C-1', zone: 'box_storage' }, { code: '3-1-1', zone: 'box_storage' }, { code: '임시 자리 7', zone: 'picking' }])
  assert.equal((await save(['3-1-1_C1', '임시 자리 7'])).reclassified_count, 0, 'repeated saves are idempotent')
  assert.equal((await save(['3-1-1_C1', '3-1-1-C-1', '임시 자리 7'])).reclassified_count, 1)
  assert.equal((await save([])).reclassified_count, 3, 'removing all registrations reclassifies current picking rows to box storage')
  const empty = await snapshot()
  await assert.rejects(save(['no-access'], 'picking', otherBrand, otherWarehouse), /권한/)
  await assert.rejects(save(['wrong-warehouse'], 'picking', brand, otherWarehouse), /브랜드와 창고/)
  await assert.rejects(save(['invalid'], 'invalid-zone'), /구역/)
  await assert.rejects(save(null), /자리 목록/)
  await db.query("select set_config('request.jwt.claim.sub','',false)")
  await assert.rejects(save(['anonymous']), /로그인/)
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id(401)])
  assert.deepEqual(await snapshot(), empty, 'permission and input failures change no data')
  await db.query("select set_config('test.deny_stock','on',false)")
  await assert.rejects(save(['3-1-1_C1']), /재고 분류 권한/)
  await db.query("select set_config('test.deny_stock','',false)")
  assert.deepEqual(await snapshot(), empty, 'silent RLS update denial rolls back the slot registration too')
  await db.exec(`reset role;
    insert into warehouse_locations values ('${id(150)}','${company}','${warehouse}','rollback-slot','box_storage');
    insert into warehouse_stock_positions values ('${id(250)}','${brand}','${active}','${warehouse}','${id(150)}','${id(301)}',10,7,0,7,'rollback-test');
    create function fail_slot_reclassify_test() returns trigger language plpgsql as $$ begin raise exception 'forced rollback test'; end $$;
    create trigger fail_slot_reclassify before update on warehouse_stock_positions for each row execute function fail_slot_reclassify_test();
    set role authenticated;`)
  const beforeFailure = await snapshot()
  await assert.rejects(save(['rollback-slot']), /forced rollback test/)
  assert.deepEqual(await snapshot(), beforeFailure, 'a failure during stock updates rolls back registration and newly inserted locations atomically')
  console.log('warehouse slot DB verify: exact formats, immediate stock classification, immutable quantities/IDs, archived and other-brand isolation, idempotency, permission checks and atomic rollback: OK')
} finally { await db.close() }
