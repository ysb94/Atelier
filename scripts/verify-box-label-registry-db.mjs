import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const db = await PGlite.create()
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0')
const brand = id(1), otherBrand = id(2), company = id(3), user = id(4), secondUser = id(5)
try {
  await db.exec(`
    create schema auth; create schema app; create role anon; create role authenticated;
    grant usage on schema auth, app to authenticated;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function app.can_read_brand(uuid) returns boolean language sql stable as $$ select true $$;
    create function app.can_edit_brand(uuid) returns boolean language sql stable as $$ select current_setting('test.can_edit',true) = 'true' $$;
    create function app.basic_work_allowed(text,uuid) returns boolean language sql stable as $$ select false $$;
    create table public.brands(id uuid primary key, company_id uuid not null);
    create table public.profiles(id uuid primary key, company_id uuid not null, status text not null);
    insert into public.brands values ('${brand}','${company}'), ('${otherBrand}','${id(6)}');
    insert into public.profiles values ('${user}','${company}','active'), ('${secondUser}','${company}','active'), ('${id(7)}','${company}','inactive');
  `)
  await db.exec(await fs.readFile(new URL('../supabase/migrations/20261110062508_warehouse_box_label_registry.sql', import.meta.url), 'utf8'))
  await db.exec(await fs.readFile(new URL('../supabase/migrations/20261110062749_warehouse_box_label_lookup_index.sql', import.meta.url), 'utf8'))
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${user}',false); select set_config('test.can_edit','true',false);`)
  async function issue(request, count = 100, codes = null, targetBrand = brand) {
    return (await db.query('select public.issue_warehouse_box_labels($1,$2,$3,$4::text[]) as result', [targetBrand, id(request), count, codes])).rows[0].result
  }
  const snapshot = async () => (await db.query('select (select count(*)::int from warehouse_box_labels) as labels, (select count(*)::int from warehouse_box_label_batches) as batches')).rows[0]
  await db.query('select setseed(0.5)')
  const first = await issue(100)
  assert.equal(first.codes.length, 100)
  const date = (await db.query("select to_char(statement_timestamp() at time zone 'Asia/Seoul', 'YYMMDD') as day")).rows[0].day
  assert.ok(first.codes.every(code => new RegExp(`^ENJ-${date}-[0-9]{10}$`).test(code)))
  assert.deepEqual(await issue(100), first, 'same request is idempotent, including order and timestamp')
  await assert.rejects(issue(100, 99), /다른 내용/)
  await db.query('select setseed(0.5)')
  await db.query('select random() from generate_series(1,90)')
  const second = await issue(101)
  assert.equal(new Set([...first.codes, ...second.codes]).size, 200, 'forced random collision is retried')
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [secondUser])
  const third = await issue(102)
  assert.equal(new Set([...first.codes, ...second.codes, ...third.codes]).size, 300, 'another employee shares the same registry')
  const retry = await Promise.all([issue(103, 20), issue(103, 20)])
  assert.deepEqual(retry[0], retry[1], 'queued duplicate requests return the same batch')
  const imported = await issue(104, 2, ['ENJ-261110-0000000123', 'ENJ-261110-A4UHCY5N'])
  assert.deepEqual(imported.codes, ['ENJ-261110-0000000123', 'ENJ-261110-A4UHCY5N'])
  const before = await snapshot()
  await assert.rejects(issue(105, 2, ['NEVER-PARTIALLY-SAVED', imported.codes[0]]), /이미 등록/)
  assert.deepEqual(await snapshot(), before, 'collision rolls back the entire batch')
  await assert.rejects(issue(106, 2, ['DUP', 'DUP']), /중복/)
  await assert.rejects(issue(107, 1, ['A\nB']), /32자/)
  await assert.rejects(issue(108, 201), /1~200/)
  await assert.rejects(issue(109, 0), /1~200/)
  await assert.rejects(issue(110, 1, null, otherBrand), /권한/)
  await assert.rejects(db.query('delete from public.warehouse_box_labels'), /permission denied/)
  await assert.rejects(db.query("update public.warehouse_box_labels set code='MUTATED'"), /permission denied/)
  await assert.rejects(db.query('insert into public.warehouse_box_labels(code,batch_id,brand_id,ordinal) values ($1,$2,$3,1)', ['DIRECT', first.id, brand]), /permission denied/)
  await db.query("select set_config('test.can_edit','false',false)")
  await assert.rejects(issue(111, 1), /권한/)
  assert.deepEqual(await snapshot(), before, 'read-only employees may reprint saved labels')
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id(7)])
  assert.deepEqual(await snapshot(), { labels: 0, batches: 0 }, 'inactive employee cannot read ledger')
  await assert.rejects(issue(112, 1), /권한/)
  await db.exec(`reset role; insert into public.profiles values ('${id(8)}','${id(6)}','active'); set role authenticated; select set_config('request.jwt.claim.sub','${id(8)}',false);`)
  assert.deepEqual(await snapshot(), { labels: 0, batches: 0 }, 'other company cannot read ledger')
  await db.query("select set_config('request.jwt.claim.sub','',false)")
  assert.deepEqual(await snapshot(), { labels: 0, batches: 0 })
  await assert.rejects(issue(113, 1), /권한/)
  await db.exec('reset role; set role anon;')
  await assert.rejects(issue(114, 1), /permission denied/)
  console.log('PASS box label registry: atomic issuance/import, unique codes, idempotency, KST date, immutable records, company isolation and permissions')
} finally { await db.close() }
