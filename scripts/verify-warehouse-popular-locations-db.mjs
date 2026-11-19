import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const db = await PGlite.create()
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const brand = uuid(1)
const otherBrand = uuid(2)
const anotherCompany = uuid(3)
const editor = uuid(10)
const teammate = uuid(11)
const design = uuid(12)
const inactive = uuid(13)
const outsideCompany = uuid(14)
const noBrandRead = uuid(15)
const migration = new URL('../supabase/migrations/20261116062854_warehouse_popular_locations.sql', import.meta.url)

try {
  await db.exec(`
    create schema app;
    create schema auth;
    create role anon;
    create role authenticated;
    grant usage on schema app to authenticated;
    create table public.brands(id uuid primary key, company integer not null);
    insert into public.brands values ('${brand}',1), ('${otherBrand}',1), ('${anotherCompany}',2);
    create table public.permission_fixture(
      id uuid primary key, company integer not null, active boolean not null,
      work text not null, brand_read boolean not null
    );
    insert into public.permission_fixture values
      ('${editor}',1,true,'logistics',true),
      ('${teammate}',1,true,'logistics',true),
      ('${design}',1,true,'design',true),
      ('${inactive}',1,false,'logistics',true),
      ('${outsideCompany}',2,true,'logistics',true),
      ('${noBrandRead}',1,true,'logistics',false);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.actor_id',true),'')::uuid
    $$;
    create function app.basic_work_allowed(text,uuid) returns boolean language sql stable security definer set search_path='' as $$
      select exists (
        select from public.permission_fixture p join public.brands b on p.company=b.company
        where p.id=auth.uid() and p.active and p.work=$1 and b.id=$2
      )
    $$;
    create function app.can_read_brand(uuid) returns boolean language sql stable security definer set search_path='' as $$
      select exists (
        select from public.permission_fixture p join public.brands b on p.company=b.company
        where p.id=auth.uid() and p.active and p.brand_read and b.id=$1
      )
    $$;
  `)
  await db.exec(await readFile(migration, 'utf8'))

  async function signIn(id) {
    await db.query("select set_config('test.actor_id',$1,false)", [id])
    await db.exec('set role authenticated')
  }
  const read = async (id = brand) => (await db.query(
    'select location_codes, revision from public.warehouse_popular_locations where brand_id=$1', [id],
  )).rows
  const insert = async (id, codes) => (await db.query(
    'insert into public.warehouse_popular_locations(brand_id, location_codes) values($1,$2::text[]) returning location_codes, revision', [id, codes],
  )).rows
  const edit = async (revision, codes) => (await db.query(
    'update public.warehouse_popular_locations set location_codes=$1::text[], revision=$2+1 where brand_id=$3 and revision=$2 returning location_codes, revision',
    [codes, revision, brand],
  )).rows

  await signIn(editor)
  assert.deepEqual(await read(), [])
  const firstCodes = ['3-4-4_B2', '3-4-4-B2', '인기상품 01']
  assert.deepEqual(await insert(brand, ['\t3-4-4_B2 ', '', firstCodes[1], firstCodes[0], firstCodes[2]]),
    [{ location_codes: firstCodes, revision: 1 }])
  assert.deepEqual(await read(otherBrand), [])

  await signIn(teammate)
  assert.deepEqual(await read(), [{ location_codes: firstCodes, revision: 1 }])
  await assert.rejects(insert(brand, ['다른 목록']), error => error.code === '23505')
  const changedCodes = [firstCodes[1], '새 자리']
  assert.deepEqual(await edit(1, changedCodes), [{ location_codes: changedCodes, revision: 2 }])
  await signIn(editor)
  assert.deepEqual(await edit(1, ['오래된 화면의 목록']), [], 'stale revision matches no row')
  await assert.rejects(
    db.query("update public.warehouse_popular_locations set location_codes=array['버전 없이 수정'] where brand_id=$1", [brand]),
    error => error.code === '40001',
  )
  await assert.rejects(edit(2, ['x'.repeat(81)]), error => error.code === '22023')
  await assert.rejects(db.query('update public.warehouse_popular_locations set brand_id=$1 where brand_id=$2', [otherBrand, brand]),
    error => error.code === '42501')
  assert.deepEqual(await read(), [{ location_codes: changedCodes, revision: 2 }])

  for (const id of [design, inactive, outsideCompany, noBrandRead]) {
    await signIn(id)
    assert.deepEqual(await read(), [])
    assert.deepEqual(await edit(2, ['권한 없음']), [])
    await assert.rejects(insert(otherBrand, ['권한 없음']), error => error.code === '42501')
  }
  await db.exec('set role anon')
  await assert.rejects(read(), error => error.code === '42501')

  await signIn(teammate)
  assert.deepEqual(await edit(2, []), [{ location_codes: [], revision: 3 }])
  await signIn(editor)
  assert.deepEqual(await read(), [{ location_codes: [], revision: 3 }])
  await assert.rejects(db.query('delete from public.warehouse_popular_locations where brand_id=$1', [brand]),
    error => error.code === '42501')

  await db.exec('reset role')
  const settingsBefore = await read()
  const policiesBefore = (await db.query('select to_jsonb(p) as policy from pg_policies p order by policyname')).rows
  await db.exec(await readFile(new URL('../supabase/migrations/20261119020309_warehouse_popular_product_list.sql', import.meta.url), 'utf8'))
  assert.deepEqual(await read(), settingsBefore)
  assert.deepEqual((await db.query('select to_jsonb(p) as policy from pg_policies p order by policyname')).rows, policiesBefore)
  const readProducts = async () => (await db.query('select location_codes,product_entries,revision from public.warehouse_popular_locations where brand_id=$1',[brand])).rows
  const saveProducts = (revision, products) => db.query('update public.warehouse_popular_locations set product_entries=$1,revision=$2+1 where brand_id=$3 and revision=$2 returning product_entries',[products,revision,brand])
  await signIn(editor)
  assert.deepEqual(await readProducts(), [{ location_codes: [], product_entries: [], revision: 3 }])
  assert.deepEqual((await saveProducts(3,[' M1000 ', '', '후드 Black M', 'M1000'])).rows, [{ product_entries: ['M1000','후드 Black M'] }])
  await signIn(teammate)
  assert.deepEqual((await readProducts())[0].product_entries, ['M1000','후드 Black M'])
  assert.deepEqual((await saveProducts(3,['stale'])).rows, [])
  assert.deepEqual(await edit(4,['3-1-1_A1']), [{ location_codes: ['3-1-1_A1'], revision: 5 }])
  assert.deepEqual((await readProducts())[0].product_entries, ['M1000','후드 Black M'], 'Old location-only clients preserve the product list')
  await assert.rejects(saveProducts(5,null), error => error.code === '22023')
  for (const id of [design, inactive, outsideCompany, noBrandRead]) {
    await signIn(id)
    assert.deepEqual(await readProducts(), [])
    assert.deepEqual((await saveProducts(5,['blocked'])).rows, [])
    await assert.rejects(db.query('insert into public.warehouse_popular_locations(brand_id,product_entries) values($1,$2)',[otherBrand,['blocked']]), error => error.code === '42501')
  }
  await db.exec('set role anon')
  await assert.rejects(readProducts(), error => error.code === '42501')
  await signIn(editor)
  assert.deepEqual((await readProducts())[0], { location_codes: ['3-1-1_A1'], product_entries: ['M1000','후드 Black M'], revision: 5 })
  console.log('warehouse popular locations DB: shared same-brand list, normalization and order, stale edit, permissions and empty list verified')
  console.log('warehouse popular products DB: same-brand sharing, normalized entries, stale saves, previous clients, original locations and permissions verified')
} finally {
  await db.close()
}
