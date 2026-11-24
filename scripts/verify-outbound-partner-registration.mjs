// Isolated PostgreSQL. The registration migration and existing save/name guards run on fixture data.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const id = (n) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0')
const brand = id(1)
const otherBrand = id(2)
const folder = id(3)
const ungrouped = id(12)
const aliasId = id(13)
const legacyShipment = id(14)
const legacyRun = id(15)
const sql = (command, params = []) => db.query(command, params)
const one = async (command, params = []) => (await sql(command, params)).rows[0]
const row = (target) => one('select *, updated_at::text as version from public.code_usage_targets where id = $1', [target])
const units = async (group) => (await sql('select id, site_name from public.code_usage_targets where group_id=$1 order by site_name', [group])).rows

async function register(action, options = {}) {
  const { company = null, site = '', at = null, channel = null, existing = null, version = null, selectedBrand = brand } = options
  const result = await one('select public.register_outbound_partner($1,$2,$3,$4,$5,$6,$7,$8) as id',
    [selectedBrand, action, company, site, at, channel, existing, version])
  return result.id
}

async function signIn(editorBrand) {
  await db.exec('reset role')
  await sql("select set_config('atelier.editor_brand', $1, false)", [editorBrand])
  await db.exec('set role authenticated')
}

try {
  await db.exec("create role authenticated; create role anon; create schema app;")
  await db.exec("create function app.can_edit_brand(b uuid) returns boolean language sql as $$select b::text = current_setting('atelier.editor_brand', true)$$; create function app.basic_work_allowed(text,uuid) returns boolean language sql as $$select false$$;")
  await db.exec(
    "create table public.code_usage_targets(id uuid primary key default gen_random_uuid(), brand_id uuid not null, name text not null, normalized_name text not null, channel_type text not null default 'unset', shipping_method text not null default 'unset', is_one_time boolean default false, active boolean default true, note text default '', folder_id uuid, sort_order integer default 0, group_id uuid, site_name text default '', normalized_site_name text default '', contact_name text default '', contact_phone text default '', contact_email text default '', address text default '', updated_at timestamptz not null default clock_timestamp());" +
    "create table public.code_usage_target_folders(id uuid, brand_id uuid); create table public.outbound_partner_groups(id uuid primary key default gen_random_uuid(), brand_id uuid, name text, normalized_name text, sort_order integer, unique(brand_id,normalized_name));" +
    "create table public.code_usage_target_aliases(id uuid primary key default gen_random_uuid(), brand_id uuid, target_id uuid references public.code_usage_targets(id), alias text, normalized_alias text, note text default '');" +
    "create table public.outbound_shipments(id uuid primary key, usage_target_id uuid references public.code_usage_targets(id), quantity integer, shipped_on date);" +
    "create table public.code_usage_assignments(id uuid primary key, usage_target_id uuid references public.code_usage_targets(id));" +
    "create table public.barcode_data_entry_runs(id uuid primary key, company_key text);" +
    "create function app.fixture_target_timestamp() returns trigger language plpgsql as $$begin new.updated_at := clock_timestamp(); return new; end$$;" +
    "create trigger fixture_target_timestamp before update on public.code_usage_targets for each row execute function app.fixture_target_timestamp();"
  )
  await db.exec("grant usage on schema public, app to authenticated; grant select,insert,update,delete on public.code_usage_targets, public.outbound_partner_groups, public.code_usage_target_aliases to authenticated; grant select on public.code_usage_target_folders,public.outbound_shipments,public.code_usage_assignments,public.barcode_data_entry_runs to authenticated; alter table public.code_usage_targets enable row level security; create policy existing_brand_access on public.code_usage_targets for all to authenticated using (true) with check (app.can_edit_brand(brand_id));")

  const nameGuards = await readFile('supabase/migrations/20261006060652_outbound_partner_atomic_identity.sql', 'utf8')
  await db.exec(nameGuards.slice(0, nameGuards.indexOf('create or replace function public.save_outbound_partner_unit_atomic')))
  const existingFunctions = await readFile('supabase/migrations/20261027044909_department_work_access.sql', 'utf8')
  for (const name of ['save_outbound_partner_with_aliases', 'save_outbound_partner_identity_with_aliases', 'save_outbound_partner_unit_with_aliases', 'save_outbound_partner_unit_atomic']) {
    const begin = existingFunctions.indexOf('CREATE OR REPLACE FUNCTION public.' + name + '(')
    const body = existingFunctions.indexOf('$function$', begin)
    const end = existingFunctions.indexOf('$function$', body + 10)
    assert.ok(begin >= 0 && body > begin && end > body)
    await db.exec(existingFunctions.slice(begin, end + 10) + ';')
  }

  await sql('insert into public.code_usage_target_folders values ($1,$2),($3,$4)', [folder, brand, id(4), otherBrand])
  await sql("insert into public.code_usage_targets(id,brand_id,name,normalized_name,folder_id,channel_type,note) values($1,$2,'기존 출고업체','기존출고업체',$3,'offline','메모 보존')", [ungrouped, brand, folder])
  await sql("insert into public.code_usage_target_aliases(id,brand_id,target_id,alias,normalized_alias,note) values($1,$2,$3,'사방넷 원본','사방넷원본','별칭 메모')", [aliasId,brand,ungrouped])
  await sql("insert into public.outbound_shipments values ($1,$2,32,'2026-11-19')", [legacyShipment,ungrouped])
  await sql("insert into public.code_usage_assignments values ($1,$2)", [id(16),ungrouped])
  await sql("insert into public.barcode_data_entry_runs values ($1,$2)", [legacyRun,'legacy:' + ungrouped])
  const legacyBefore = await row(ungrouped)
  const permissions = await one("select relacl::text, relrowsecurity from pg_class where oid='public.code_usage_targets'::regclass")
  await db.exec(await readFile('supabase/migrations/20261123135313_outbound_partner_registration.sql', 'utf8'))
  assert.deepEqual(await row(ungrouped), legacyBefore)
  assert.deepEqual(await one("select relacl::text, relrowsecurity from pg_class where oid='public.code_usage_targets'::regclass"), permissions)

  await signIn(brand)
  const standalone = await register('new-company', { company: '검수 물류', at: folder, channel: 'offline' })
  const standaloneBefore = await row(standalone)
  assert.deepEqual(await units(standaloneBefore.group_id), [{ id: standalone, site_name: '' }])
  const firstBranch = await register('new-company', { company: '검수 면세점', site: '공항점', at: folder, channel: 'offline' })
  const firstBranchRow = await row(firstBranch)
  assert.deepEqual(await units(firstBranchRow.group_id), [{ id: firstBranch, site_name: '공항점' }])
  assert.equal(firstBranchRow.folder_id,folder)
  assert.equal(firstBranchRow.channel_type,'offline')

  await db.exec('reset role')
  await sql("insert into public.outbound_shipments values ($1,$2,8,'2026-11-20')", [id(18),standalone])
  await signIn(brand)
  const separate = await register('add-site', { existing: standalone, version: standaloneBefore.version, site: '서울점' })
  assert.notEqual(separate, standalone)
  assert.deepEqual(await row(standalone), standaloneBefore)
  assert.equal((await row(separate)).group_id,standaloneBefore.group_id)
  assert.equal((await one('select usage_target_id from public.outbound_shipments where id = $1',[id(18)])).usage_target_id,standalone)
  assert.equal((await one('select count(*)::int as n from public.outbound_shipments where usage_target_id=$1',[separate])).n,0)
  await assert.rejects(register('name-existing', { existing: standalone, version: standaloneBefore.version, site: '다른점' }), /이미 지점명/)
  await assert.rejects(register('add-site', { existing: standalone, version: standaloneBefore.version, site: '서울점' }), (error) => error.code === '23505')
  const more = await register('add-site', { existing: firstBranch, version: firstBranchRow.version, site: '강남점' })
  assert.equal((await row(more)).group_id,firstBranchRow.group_id)
  assert.equal((await row(firstBranch)).site_name,'공항점')

  const kept = await register('name-existing', { existing: ungrouped, version: legacyBefore.version, site: '한남점' })
  const legacyAfter = await row(ungrouped)
  assert.equal(kept,ungrouped)
  assert.deepEqual(await units(legacyAfter.group_id), [{ id: ungrouped, site_name: '한남점' }])
  assert.deepEqual(legacyAfter, {
    ...legacyBefore,
    group_id: legacyAfter.group_id,
    site_name: '한남점',
    normalized_site_name: '한남점',
    updated_at: legacyAfter.updated_at,
    version: legacyAfter.version,
  })
  assert.deepEqual(await one('select id, usage_target_id, quantity, shipped_on::text as shipped_on from public.outbound_shipments where id=$1',[legacyShipment]), { id: legacyShipment, usage_target_id: ungrouped, quantity: 32, shipped_on: '2026-11-19' })
  assert.deepEqual(await one('select id, alias, note from public.code_usage_target_aliases where target_id=$1',[ungrouped]), { id: aliasId, alias: '사방넷 원본', note: '별칭 메모' })
  assert.equal((await one('select usage_target_id from public.code_usage_assignments where id=$1',[id(16)])).usage_target_id,ungrouped)
  assert.equal((await one('select company_key from public.barcode_data_entry_runs where id=$1',[legacyRun])).company_key,'legacy:' + ungrouped)
  await assert.rejects(register('name-existing', { existing: ungrouped, version: legacyBefore.version, site: '다른점' }), (error) => error.code === '40001')

  await assert.rejects(register('new-company', { company: '검수 면세점', site: '다른점' }), (error) => error.code === '23505')
  await assert.rejects(register('new-company', { company: '외부폴더 검수', at: id(4) }), /분류 폴더/)
  assert.equal(await one("select id from public.outbound_partner_groups where name='외부폴더 검수'"),undefined)
  await assert.rejects(register('new-company', { company: '사방넷 원본', site: '지점' }), (error) => error.code === '23505')
  await signIn(otherBrand)
  await assert.rejects(register('add-site', { existing: standalone, version: standaloneBefore.version, site: '권한 불가' }), (error) => error.code === '42501')
  await assert.rejects(register('add-site', { selectedBrand: otherBrand, existing: standalone, version: standaloneBefore.version, site: '다른 브랜드' }), (error) => error.code === '40001')
  await db.exec('reset role; set role anon')
  await assert.rejects(register('new-company', { company: '익명 불가' }), /permission denied for function/)
  console.log('PASS outbound partner registration: new standalone, new first site, same-unit history and aliases, separate unit, existing branch, duplicates, stale version, rollback and permissions')
} finally {
  await db.close()
}
