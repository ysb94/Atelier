// Runs real migrations in a disposable loopback PostgreSQL cluster.
// ATELIER_TEST_PG_BIN and ATELIER_FINDER_ROOT override the local defaults.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const tempRoot = path.resolve(tmpdir())
const fixture = path.join(tempRoot, 'atelier-warehouse-guard-' + randomUUID())
const data = path.join(fixture, 'data')
const bin = process.env.ATELIER_TEST_PG_BIN || 'C:/Program Files/PostgreSQL/18/bin'
const finder = process.env.ATELIER_FINDER_ROOT || '../masmafinder'
const exe = name => path.join(bin, name + (process.platform === 'win32' ? '.exe' : ''))
const read = file => readFileSync(file, 'utf8')
const atelierSql = name => read('supabase/migrations/' + name + '.sql')
const finderSql = name => read(path.join(finder, 'supabase/migrations', name + '.sql'))
const guard = atelierSql('20261114134631_warehouse_snapshot_finder_sheet_export_guard')
const cargo = finderSql('20261113050206_finder_cargo_receiving')
const cargoSnapshot = cargo.slice(cargo.indexOf('create or replace function public.replace_warehouse_inventory_snapshot_with_box_qr('))
assert.ok(cargoSnapshot.startsWith('create or replace function'))

const brand = 'b0000000-0000-4000-8000-000000000001'
const other = 'b0000000-0000-4000-8000-000000000002'
const actor = 'a0000000-0000-4000-8000-000000000001'
const warehouse = 'a0000000-0000-4000-8000-000000000002'
const company = 'a0000000-0000-4000-8000-000000000003'
const style = 'a0000000-0000-4000-8000-000000000004'
const quote = value => "'" + String(value).replaceAll("'", "''") + "'"
const json = value => quote(JSON.stringify(value)) + '::jsonb'
const asService = "set request.jwt.claims = '{\"role\":\"service_role\"}'; " +
  "set request.headers = '{\"x-finder-write-key\":\"test-fixture\"}'; set test.finder_key = 'ok'; set role service_role;"
const asReader = `set request.jwt.claim.sub = '${actor}'; set role authenticated;`

const port = await new Promise((resolve, reject) => {
  const server = createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port
    server.close(() => resolve(port))
  })
})
const env = { ...process.env, PGCLIENTENCODING: 'UTF8' }
const args = ['-X', '-h', '127.0.0.1', '-p', String(port), '-U', 'warehouse_guard_fixture',
  '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-q', '-A', '-t', '-f', '-']
const timeout = "set statement_timeout='12s'; set idle_in_transaction_session_timeout='20s';"
function command(name, args, options = {}) {
  const p = spawnSync(exe(name), args, { env, windowsHide: true, encoding: 'utf8', ...options })
  assert.equal(p.status, 0, p.error?.message || p.stderr || name)
}
function query(sql, code) {
  const p = spawnSync(exe('psql'), args, {
    env, windowsHide: true, encoding: 'utf8', input: timeout + sql, maxBuffer: 4 * 1024 * 1024,
  })
  if (code) {
    assert.notEqual(p.status, 0, `Expected ${code}`)
    assert.match(p.stderr, new RegExp(`\\b${code}:`))
  } else {
    assert.equal(p.status, 0, p.error?.message || p.stderr)
  }
  return p.stdout.trim().split(/\r?\n/).at(-1)
}
function session(sql, applicationName, hold = false) {
  const child = spawn(exe('psql'), args, { env: { ...env, PGAPPNAME: applicationName }, windowsHide: true })
  let stdout = '', stderr = ''
  child.stdout.setEncoding('utf8').on('data', s => { stdout += s })
  child.stderr.setEncoding('utf8').on('data', s => { stderr += s })
  const done = new Promise(resolve => {
    child.once('error', error => resolve({ code: -1, stderr: error.message }))
    child.once('close', code => resolve({ code, stdout, stderr }))
  })
  if (hold) child.stdin.write(timeout + 'begin; ' + sql + "; select 'HOLD_READY';\n")
  else child.stdin.end(timeout + sql)
  return { child, done, output: () => stdout, errors: () => stderr }
}
async function waitFor(check, message) {
  for (let attempts = 0; attempts < 50; attempts++) {
    if (check()) return
    await delay(30)
  }
  assert.fail(message)
}
async function race(holderSql, waiterSql, waiterError) {
  const holder = session(holderSql, 'warehouse_guard_holder', true)
  let waiter
  try {
    await waitFor(() => holder.output().includes('HOLD_READY'), 'Holder failed: ' + holder.errors())
    waiter = session(waiterSql, 'warehouse_guard_waiter')
    await waitFor(() => query(`select wait_event from pg_stat_activity
      where application_name='warehouse_guard_waiter';`) === 'advisory', 'Expected both writes to take the same advisory lock')
  } finally {
    holder.child.stdin.end('commit;\n')
    const result = await holder.done
    assert.equal(result.code, 0, result.stderr)
  }
  const result = await waiter.done
  if (waiterError) {
    assert.notEqual(result.code, 0)
    assert.match(result.stderr, new RegExp(`\\b${waiterError}:`))
  } else {
    assert.equal(result.code, 0, result.stderr)
  }
}

const inbound = (n, place) => `select public.run_finder_single_inbound_db_first('${brand}','${actor}',${json({
  mode: 'place', place, qr: 'GUARD-QR-' + n, number: 'M1234', receivedOn: '2026-11-13', quantity: 12,
  backgroundJobId: 'c0000000-0000-4000-8000-' + String(n).padStart(12, '0') + ':0',
})})`
const sheet = (rows, ts, target = brand) =>
  `select (public.replace_warehouse_inventory_snapshot_with_box_qr('${target}','fixture sheet',${json(rows)},${ts})).id;`
const row = (external_row_id, box_qr = '', location_code = '2-1-9') => ({
  external_row_id, box_qr, location_code, zone: 'box_storage', style_id: style, source_style_no: 'M1234',
  normalized_style_no: 'M1234', source_product_name: 'Test style', received_on: '2026-11-13',
  received_on_raw: '261113', units_per_box: 12, remaining_boxes: 1, units_per_box_raw: '12',
  remaining_boxes_raw: '1', source_row_number: 3,
})
const fixtureRow = row('fixture-sheet')

function activeId(target = brand) {
  return query(`select id from warehouse_inventory_sets where brand_id='${target}' and kind='sandbox' and status='active';`)
}
function readNewBox(receipt, setId, qr, place) {
  // Same active set, brand filter and inner location relation used by WarehouseInventoryPanel.
  assert.equal(query(asReader + `select p.box_qr from warehouse_stock_positions p
    join warehouse_locations l on l.id=p.location_id
    join warehouse_inventory_sets s on s.id=p.set_id
    where s.brand_id='${brand}' and s.kind='sandbox' and s.status='active' and s.id='${setId}'
    and p.brand_id=s.brand_id and p.external_row_id='${receipt.docId}'
    and l.zone='box_storage' and l.code='${place}' and p.units_per_box=12 and p.remaining_boxes=1;`), qr)
  // WarehouseFinderPage makes this same RPC call for SKU and location searches.
  for (const [mode, term] of [['mnumber', 'M1234'], ['warehouse', place]]) {
    assert.equal(query(asReader + `select external_row_id from public.search_warehouse_finder_rows(
      '${brand}', '${mode}', '${term}', 100) where external_row_id='${receipt.docId}'
      and set_id='${setId}' and location_code='${place}' and units_per_box=12 and remaining_boxes=1;`), receipt.docId)
  }
}

let started = false
mkdirSync(fixture)
try {
  command('initdb', ['-D', data, '-U', 'warehouse_guard_fixture', '--encoding=UTF8', '--locale=C',
    '--auth-local=trust', '--auth-host=trust'])
  command('pg_ctl', ['-D', data, '-l', path.join(fixture, 'postgres.log'), '-o',
    `-h 127.0.0.1 -p ${port} -c shared_buffers=32MB -c max_connections=12`, '-w', 'start'], { stdio: 'ignore' })
  started = true
  assert.equal(path.resolve(query('show data_directory;')).toLowerCase(), data.toLowerCase())
  query(`
    create role anon; create role authenticated; create role service_role;
    create schema app; create schema auth;
    create schema storage;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(), bucket_id text, name text, unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated;
    grant select, insert on storage.objects to authenticated;
    grant usage on schema app, auth to authenticated;
    create function auth.role() returns text language sql stable as $$
      select current_setting('request.jwt.claims', true)::jsonb->>'role' $$;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
    create function app.can_read_brand(uuid) returns boolean language sql stable as $$
      select auth.uid()='${actor}' and $1='${brand}' $$;
    create function app.can_edit_brand(uuid) returns boolean language sql stable as $$
      select app.can_read_brand($1) and current_setting('test.warehouse_editor', true) = 'on' $$;
    create function app.basic_work_allowed(text,uuid) returns boolean language sql stable as $$ select false $$;
    create function app.can_access_warehouse_finder(uuid) returns boolean language sql as $$ select app.can_read_brand($1) $$;
    create function app.has_masma_finder_sheet_write_key() returns boolean language sql stable as $$
      select current_setting('test.finder_key', true)='ok' $$;
    create function public.set_updated_at() returns trigger language plpgsql as $$
      begin new.updated_at := now(); return new; end $$;
    create table public.companies(id uuid primary key);
    create table public.brands(id uuid primary key, company_id uuid not null references public.companies, slug text not null);
    grant select on public.brands to authenticated;
    create table public.styles(id uuid primary key, brand_id uuid not null references public.brands, style_no text not null,
      name text not null, unique(brand_id,id));
    create table public.masma_finder_users(brand_id uuid not null, auth_user_id uuid not null,
      status text not null, is_admin boolean not null, can_use_test boolean not null);
    create function app.can_use_masma_finder_feature(uuid,text) returns boolean language sql security definer as $$
      select exists (select 1 from public.masma_finder_users u where u.brand_id=$1 and u.auth_user_id=auth.uid()
        and u.status='active' and (u.can_use_test or u.is_admin) and $2='test') $$;
    create function app.can_use_masma_finder(uuid) returns boolean language sql as $$
      select app.can_use_masma_finder_feature($1,'test') $$;
    create table public.cargo_inbound_lines(brand_id uuid not null, id uuid not null, primary key(brand_id,id));
  `)
  for (const name of ['20260826095007_warehouse_practice', '20260909150000_warehouse_sheet_sync',
    '20260909150100_warehouse_sheet_sync_rpc', '20260909150200_warehouse_sheet_sync_service_role_grants',
    '20260909150300_warehouse_sheet_sync_replace_definer', '20260916140000_warehouse_finder_search',
    '20260916161000_warehouse_finder_location_product_kinds', '20260916183000_masma_finder_warehouse_access',
    '20260918184500_warehouse_boxes_individual', '20260921120000_warehouse_box_completion_lifecycle']) query(atelierSql(name))
  const legacyInbound = finderSql('20261112044306_finder_inbound_sheet')
  query(legacyInbound.split('create function app.has_masma_finder_sheet_write_key')[0] + legacyInbound.slice(
    legacyInbound.indexOf('create function app.prepare_masma_finder_inbound_sheet('),
  ))
  query(finderSql('20261112061241_store_finder_box_qr_on_warehouse_stock'))
  for (const name of ['20261112081615_warehouse_sheet_snapshot_box_qr', '20261112101125_finder_warehouse_placement',
    '20261112125446_finder_picking_product_clear']) query(atelierSql(name))
  query(finderSql('20261112135007_finder_warehouse_background'))
  query(cargo.split('-- Only the scheduled cargo worklist')[0] +
    cargo.slice(cargo.indexOf('create function public.run_finder_cargo_background(')))
  query(guard, '42P01')
  query(finderSql('20261113114409_finder_single_inbound_db_first'))
  query(guard)
  for (const name of ['20261114171142_warehouse_stock_condition_links', '20261114173500_expand_warehouse_stock_conditions',
    '20261114174048_warehouse_stock_condition_writeback']) query(atelierSql(name))
  query(`
    insert into public.companies values ('${company}');
    insert into public.brands values ('${brand}','${company}','masmarulez'),('${other}','${company}','other');
    insert into public.styles values ('${style}','${brand}','M1234','Test style');
    insert into public.masma_finder_users values ('${brand}','${actor}','active',false,true);
    insert into public.warehouses(id,company_id,name) values ('${warehouse}','${company}','Fixture');
    insert into public.warehouse_inventory_sets(brand_id,warehouse_id,source_file_name)
      values ('${brand}','${warehouse}','before guard');
    insert into public.warehouse_registered_slots(warehouse_id,code,zone)
      values ('${warehouse}','2-1-1','box_storage'),('${warehouse}','2-1-2','box_storage'),('${warehouse}','2-1-3','box_storage');
  `)

  const oldId = activeId()
  const saved = JSON.parse(query(asService + inbound(1, '2-1-1') + ';'))
  assert.equal(saved.status, 'saved')
  readNewBox(saved, oldId, 'GUARD-QR-1', '2-1-1')
  query(asService + sheet([fixtureRow], 'clock_timestamp()'), 'PWS01')
  assert.equal(activeId(), oldId)
  assert.ok(query(asService + sheet([row('other-brand', '', '3-1-1')].map(({style_id: _, ...value}) => value), 'clock_timestamp()', other)))
  query(asService + `select public.replace_warehouse_inventory_snapshot('${brand}','blocked',${json([fixtureRow])});`, '42501')
  query(asService + `select public.replace_warehouse_inventory_snapshot_with_box_qr('${brand}','blocked',${json([fixtureRow])});`, '42501')
  query(asReader + sheet([fixtureRow], 'clock_timestamp()'), '42501')
  query(asService + sheet([fixtureRow], 'null'), '22023')
  console.log('PASS: pending export blocked, old set preserved, brand isolated, legacy overloads blocked, both read paths show committed QR stock')

  const staleAt = quote(query('select clock_timestamp();')) + '::timestamptz'
  const entry = JSON.parse(query(asService + `select public.run_finder_warehouse_sheet_export('${brand}','claim','{}');`))
  assert.equal(entry.sheetRowId, saved.docId)
  query(asService + sheet([fixtureRow], 'clock_timestamp()'), 'PWS01')
  const confirm = { ...entry, rowNumber: 4 }
  query(asService + `select public.run_finder_warehouse_sheet_export('${brand}','confirm',${json({
    ...confirm, values: { ...entry.values, quantity: 13 },
  })});`, '22023')
  query(asService + `select public.run_finder_warehouse_sheet_export('${brand}','confirm',${json(confirm)});`)
  query(asService + sheet([fixtureRow], staleAt), 'PWS02')
  const confirmedAt = quote(query(`select sheet_synced_at from app.finder_warehouse_sheet_exports where brand_id='${brand}';`))
  query(asService + sheet([fixtureRow], confirmedAt), 'PWS02')
  assert.equal(activeId(), oldId)
  const refreshedRows = [fixtureRow, { ...row(saved.docId, 'GUARD-QR-1', '2-1-1'), source_row_number: 4 }]
  const freshId = query(asService + sheet(refreshedRows, 'clock_timestamp()'))
  assert.equal(activeId(), freshId)
  assert.notEqual(freshId, oldId)
  readNewBox(saved, freshId, 'GUARD-QR-1', '2-1-1')
  query(asService + sheet([fixtureRow], 'clock_timestamp()'), 'PWS03')
  assert.equal(activeId(), freshId)
  readNewBox(saved, freshId, 'GUARD-QR-1', '2-1-1')
  console.log('PASS: a newer snapshot missing a confirmed, active AA row is rejected and the active box stays visible')
  console.log('PASS: processing export blocked, changed sheet data cannot confirm, stale/equal timestamps blocked, freshly read sheet succeeds and keeps QR')

  query(`insert into public.cargo_inbound_lines values ('${brand}','${style}');
    insert into public.cargo_inbound_receipts(receipt_id,brand_id,cargo_inbound_line_id,receiving_mode,
      actual_box_count,actual_qty,created_by,received_at,received_location_id,received_location_code,sheet_rows)
    select gen_random_uuid(),'${brand}','${style}','location_only',1,12,'${actor}',clock_timestamp(),p.location_id,'2-1-1','[{}]'
    from public.warehouse_stock_positions p where p.set_id='${freshId}' and p.box_qr='GUARD-QR-1';`)
  query(asService + sheet(refreshedRows, staleAt), 'PWS02')
  const beforeCargo = "(select received_at from public.cargo_inbound_receipts limit 1)"
  const cargoAt = quote(query(`select ${beforeCargo};`))
  query(asService + sheet(refreshedRows, cargoAt), 'P0001')
  console.log('PASS: existing cargo location receipt still rejects older sheet reads')

  // Hold replacement open after its check/write. Inbound must wait and publish into the newer set.
  await race(asService + sheet(refreshedRows, 'clock_timestamp()'), asService + inbound(2, '2-1-2') + ';')
  const nextId = activeId()
  assert.notEqual(nextId, freshId)
  assert.equal(query(`select p.box_qr from warehouse_stock_positions p where p.set_id='${nextId}' and p.box_qr='GUARD-QR-2';`), 'GUARD-QR-2')

  // Reverse order: replacement waits, then sees the export that the first transaction committed.
  await race(asService + inbound(3, '2-1-3'), asService + sheet(refreshedRows, 'clock_timestamp()'), 'PWS01')
  assert.equal(activeId(), nextId)
  assert.equal(query(`select count(*) from warehouse_stock_positions p where p.set_id='${nextId}' and p.box_qr like 'GUARD-QR-%';`), '3')
  console.log('PASS: two PostgreSQL sessions serialize intake and replacement in both orders')

  const confirmedRows = []
  for (const [number, rowNumber] of [[2, 5], [3, 6]]) {
    const next = JSON.parse(query(asService + `select public.run_finder_warehouse_sheet_export('${brand}','claim','{}');`))
    assert.equal(next.values.boxQr, `GUARD-QR-${number}`)
    query(asService + `select public.run_finder_warehouse_sheet_export('${brand}','confirm',${json({ ...next, rowNumber })});`)
    confirmedRows.push({ ...row(next.sheetRowId, next.values.boxQr, next.values.place), source_row_number: rowNumber })
  }

  const asEditor = asReader + "set test.warehouse_editor = 'on';"
  assert.equal(query(asEditor + `select (public.complete_warehouse_box_outbound('${brand}','${saved.boxId}','fixture outbound')).completion_kind;`), 'box_outbound')
  const depletedId = query(`select id from warehouse_stock_positions where set_id='${nextId}' and box_qr='GUARD-QR-2';`)
  assert.equal(query(asEditor + `select public.apply_warehouse_stock_action('${brand}','deplete',${json({ position_id: depletedId })})->>'remaining_boxes';`), '0')

  query(asService + sheet([fixtureRow], 'clock_timestamp()'), 'PWS03')
  assert.equal(activeId(), nextId)
  const retained = confirmedRows[1]
  const afterRemoval = query(asService + sheet([fixtureRow, retained], 'clock_timestamp()'))
  assert.notEqual(afterRemoval, nextId)
  assert.equal(activeId(), afterRemoval)
  assert.equal(query(`select count(*) from warehouse_stock_positions where set_id='${afterRemoval}' and box_qr in ('GUARD-QR-1','GUARD-QR-2');`), '0')
  readNewBox({ docId: retained.external_row_id }, afterRemoval, 'GUARD-QR-3', '2-1-3')
  console.log('PASS: completed box outbound and depleted stock may be omitted, while another active box is still protected')

  const stockId = () => query(`select id from warehouse_stock_positions where set_id='${activeId()}' and external_row_id='${retained.external_row_id}';`)
  const changeSql = (condition, expected, n) => {
    const id = `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`
    return `select public.save_warehouse_stock_condition('${brand}','${id}','${stockId()}','${condition}','${expected}');`
  }
  const queued = () => JSON.parse(query(asService + `select public.list_warehouse_stock_condition_exports('${brand}');`))
  const confirmCondition = (entry, product_name = entry.values.productName) => query(asService +
    `select public.confirm_warehouse_stock_condition_exports('${brand}',${json([{
      request_id: entry.requestId, row_id: entry.rowId, number: entry.values.number, product_name,
    }])});`)
  const finderCount = (mode, term) => query(asReader + `select count(*) from public.search_warehouse_finder_rows(
    '${brand}','${mode}','${term}',100) where external_row_id='${retained.external_row_id}';`)

  query(asReader + changeSql('defective', 'normal', 30), '42501')
  query(asEditor + changeSql('defective', 'normal', 30))
  query(asEditor + changeSql('defective', 'normal', 30))
  assert.equal(finderCount('mnumber', 'M1234'), '0')
  assert.equal(finderCount('product', 'Test style_(불량)'), '1')
  const conditionStaleAt = quote(query('select clock_timestamp();'))
  query(asService + sheet([fixtureRow, retained], 'clock_timestamp()'), 'PWS04')
  const defective = queued()
  assert.equal(defective.rowId, retained.external_row_id)
  assert.equal(defective.values.number, '')
  assert.equal(defective.values.productName, 'Test style_(불량)')
  assert.equal(confirmCondition(defective, 'Test style'), '0')
  assert.equal(confirmCondition(defective), '1')
  query(asService + sheet([fixtureRow, retained], conditionStaleAt), 'PWS05')
  query(asService + sheet([fixtureRow, retained], 'clock_timestamp()'), 'PWS06')
  query(asService + sheet([fixtureRow], 'clock_timestamp()'), 'PWS06')
  const defectRow = { ...retained, style_id: null, source_style_no: '', normalized_style_no: '',
    source_product_name: defective.values.productName }
  query(asService + sheet([fixtureRow, defectRow], 'clock_timestamp()'))
  assert.equal(finderCount('mnumber', 'M1234'), '0')
  assert.equal(finderCount('product', 'Test style_(불량)'), '1')
  query(asEditor + changeSql('normal', 'defective', 31))
  const normal = queued()
  assert.equal(normal.rowId, defective.rowId)
  assert.equal(normal.values.number, 'M1234')
  assert.equal(normal.values.productName, 'Test style')
  assert.equal(confirmCondition(normal), '1')
  query(asService + sheet([fixtureRow, retained], 'clock_timestamp()'))
  assert.equal(finderCount('mnumber', 'M1234'), '1')
  assert.equal(finderCount('product', 'Test style_(불량)'), '0')

  const receive = `select public.save_warehouse_stock_condition('${brand}',
    'c0000000-0000-4000-8000-000000000032',null,'needs_repair',null,${json({
      style_id: style, location_code: '2-1-3', received_on: '2026-11-13',
      received_on_raw: '261113', units_per_box: 10, remaining_boxes: 2,
    })});`
  query(asEditor + receive)
  query(asEditor + receive)
  const received = queued()
  assert.equal(received.before, null)
  assert.equal(received.values.productName, 'Test style_(수선 필요)')
  assert.equal(query(`select count(*) from warehouse_stock_positions where set_id='${activeId()}'
    and external_row_id='${received.rowId}' and style_id is null and remaining_boxes=2;`), '1')
  console.log('PASS: condition changes, pending/stale snapshots, Finder SKU and status search, restoration, and idempotent intake')

  // Export the preceding fixture intake before starting a complete slot audit.
  assert.equal(confirmCondition(received), '1')
  const receivedRow = { ...row(received.rowId, '', received.values.place), style_id: null,
    source_style_no: '', normalized_style_no: '', source_product_name: received.values.productName,
    units_per_box: 10, remaining_boxes: 2, source_row_number: 7 }
  query(asService + sheet([fixtureRow, retained, receivedRow], 'clock_timestamp()'))
  query(atelierSql('20261115134809_warehouse_qr_reconciliation'))
  query(atelierSql('20261115140806_warehouse_qr_audit_sheet_export'))
  const sheetJob = () => JSON.parse(query(asService + `select public.list_warehouse_qr_audit_sheet_exports('${brand}');`))
  const confirmAuditSheet = (job, rows = job.after.map(({ opened: _opened, ...stock }) => stock)
    .sort((a, b) => a.id.localeCompare(b.id))) => query(asService +
      `select public.confirm_warehouse_qr_audit_sheet_export('${brand}','${job.id}',${json(rows)});`)
  const backgroundMove = (action, request) => `select public.run_finder_warehouse_background(
    '${brand}','${actor}','${action}',${json(request)});`

  const auditId = 'c0000000-0000-4000-8000-000000000070'
  const auditSql = (action, request) => `select public.finder_warehouse_qr_audit(
    '${brand}','${action}',${json({ id: auditId, place: '2-1-3', ...request })});`
  const reviewSql = (action, request = {}) => `select public.review_warehouse_qr_audit('${brand}','${action}',${json(request)});`
  const before = JSON.parse(query(asReader + auditSql('place')))
  const source = before.rows.find(p => p.box_qr === 'GUARD-QR-3')
  const photo = `${brand}/${actor}/${auditId}/c0000000-0000-4000-8000-000000000071.jpg`
  query(asReader + `insert into storage.objects(bucket_id,name) values ('warehouse-qr-audit','${photo}');`)
  query(asReader + `insert into storage.objects(bucket_id,name) values ('warehouse-qr-audit','${photo.replace(actor, other)}');`, '42501')
  assert.equal(query(asEditor + 'select count(*) from storage.objects;'), '0')
  const draft = { baseline: before.baseline, entries: [
    { qr: 'GUARD-QR-3', source_id: source.id, units: 8, opened: true },
    { qr: 'AUDIT-PHOTO', photo_path: photo },
  ] }
  const plan = JSON.parse(query(asReader + auditSql('preview', draft)))
  assert.equal(plan.boxes.length, 2)
  assert.equal(plan.boxes[1].name, null)
  query(asReader + auditSql('confirm', { ...draft, token: 'incorrect' }), '40001')
  assert.equal(finderCount('mnumber', 'M1234'), '1')
  query(asReader + auditSql('preview', { ...draft, entries: [draft.entries[0], draft.entries[0]] }), 'P0001')
  const commit = auditSql('confirm', { ...draft, token: plan.token })
  assert.equal(JSON.parse(query(asReader + commit)).sheetPending, true)
  query(asReader + commit)
  assert.equal(JSON.parse(query(asReader + auditSql('preview', draft))).complete, true)
  const inventory = () => JSON.parse(query(`select jsonb_agg(jsonb_build_object('qr',p.box_qr,'name',p.source_product_name,
    'sku',p.normalized_style_no,'opened',p.opened_units) order by p.box_qr)
    from warehouse_stock_positions p where p.set_id='${activeId()}' and p.box_qr in ('GUARD-QR-3','AUDIT-PHOTO');`))
  assert.deepEqual(inventory(), [
    { qr: 'AUDIT-PHOTO', name: '상품 확인 대기', sku: '', opened: 0 },
    { qr: 'GUARD-QR-3', name: 'Test style', sku: 'M1234', opened: 8 },
  ])
  assert.equal(query(`select current_qty from warehouse_boxes where display_code='GUARD-QR-3';`), '8')
  assert.equal(query(asReader + 'select count(*) from storage.objects;'), '0')
  assert.equal(query(asEditor + 'select count(*) from storage.objects;'), '1')
  query(asReader + reviewSql('list'), '42501')
  const review = JSON.parse(query(asEditor + reviewSql('list')))
  assert.equal(review.pending, 1)
  assert.equal(review.items[0].photo_path, photo)
  assert.equal(review.items[0].candidates.length, before.rows.length)
  const oldSheet = [fixtureRow, retained, receivedRow]
  query(asService + sheet(oldSheet, 'clock_timestamp()'), 'PWS07')
  query(asService + inbound(90, '2-1-3') + ';', 'PQA01')
  const legacyRegistration = { p_location_code: '2-1-3', p_zone: 'box_storage', p_style_no: 'M1234',
    p_received_on: '2026-11-13', p_qty: 12, p_note: '' }
  query(asService + backgroundMove('prepare-inbound', {
    p_display_code: 'GUARD-LEGACY-QR', p_registration: legacyRegistration,
  }), 'PQA01')
  query(asService + backgroundMove('prepare', { mode: 'place', place: '2-1-1', qr: 'GUARD-QR-3',
    backgroundJobId: 'c0000000-0000-4000-8000-000000000093:0' }), 'PQA01')
  query(asEditor + reviewSql('link', { rowId: review.items[0].external_row_id, candidateId: source.id, units: 12 }), 'PQA01')
  const auditSheet = sheetJob()
  assert.equal(auditSheet.place, '2-1-3')
  assert.equal(auditSheet.before.length, 2)
  assert.equal(auditSheet.after.find(p => p.qr === 'GUARD-QR-3').values[6], '개봉 잔량 8개')
  assert.equal(confirmAuditSheet(auditSheet, []), 'f')
  const staleAuditAt = quote(query('select clock_timestamp();'))
  assert.equal(confirmAuditSheet(auditSheet), 't')
  query(asService + sheet(oldSheet, staleAuditAt), 'PWS07')
  const refreshedSheet = [fixtureRow, ...auditSheet.after.map(({ id, qr, values }) => {
    const [sku, name, place, date, units, boxes, note] = values
    return { ...row(id, qr, place), source_style_no: sku, normalized_style_no: sku, style_id: sku ? style : null,
      source_product_name: name, received_on: date ? '2026-11-13' : null, received_on_raw: date,
      units_per_box: units ? Number(units) : null, units_per_box_raw: units,
      remaining_boxes: Number(boxes), remaining_boxes_raw: boxes, note }
  })]
  query(asService + sheet(refreshedSheet, 'clock_timestamp()'))
  assert.equal(inventory()[1].opened, 8)
  query(asEditor + reviewSql('link', { rowId: review.items[0].external_row_id, candidateId: source.id, units: 12 }))
  assert.equal(JSON.parse(query(asEditor + reviewSql('list'))).pending, 0)
  const reviewExport = sheetJob()
  assert.equal(reviewExport.place, null)
  assert.equal(reviewExport.before[0].id, reviewExport.after[0].id)
  assert.equal(reviewExport.after[0].values[0], 'M1234')
  assert.equal(confirmAuditSheet(reviewExport), 't')
  query(asService + sheet(oldSheet, 'clock_timestamp()'))
  assert.deepEqual(inventory(), [
    { qr: 'AUDIT-PHOTO', name: 'Test style', sku: 'M1234', opened: 0 },
    { qr: 'GUARD-QR-3', name: 'Test style', sku: 'M1234', opened: 8 },
  ])
  assert.equal(query(`select count(*) from warehouse_stock_positions where set_id='${activeId()}' and external_row_id='${received.rowId}';`), '0')
  const auditedPosition = query(`select id from warehouse_stock_positions where set_id='${activeId()}' and box_qr='AUDIT-PHOTO';`)
  const changeAuditCondition = (n, next, previous) => `select public.save_warehouse_stock_condition(
    '${brand}','c0000000-0000-4000-8000-0000000000${n}','${auditedPosition}','${next}','${previous}')->>'sheetPending';`
  assert.equal(query(asEditor + changeAuditCondition(72, 'defective', 'normal')), 'true')
  assert.equal(inventory()[0].sku, '')
  assert.equal(confirmCondition(queued()), '1')
  assert.equal(query(asEditor + changeAuditCondition(73, 'normal', 'defective')), 'true')
  assert.equal(confirmCondition(queued()), '1')
  assert.equal(inventory()[0].sku, 'M1234')

  for (const [n, place] of [[93, '2-1-1'], [94, '2-1-3']]) {
    const request = { mode: 'place', place, qr: 'GUARD-QR-3', backgroundJobId: `c0000000-0000-4000-8000-0000000000${n}:0` }
    const planned = JSON.parse(query(asService + backgroundMove('prepare', request)))
    assert.equal(planned.plan.write.auditOpened, true)
    assert.equal(planned.plan.write.quantity, 8)
    assert.equal(planned.plan.write.position.units_per_box, 12)
    assert.equal(planned.plan.write.docId, auditSheet.after.find(p => p.qr === 'GUARD-QR-3').id)
    query(asService + backgroundMove('finish', { operationId: planned.operationId, rowNumber: 9 }))
    assert.equal(query(`select l.code || ':' || p.opened_units || ':' || p.remaining_boxes
      from warehouse_stock_positions p join warehouse_locations l on l.id=p.location_id
      where p.set_id='${activeId()}' and p.box_qr='GUARD-QR-3';`), place + ':8:0')
  }

  const movedId = 'c0000000-0000-4000-8000-000000000074'
  const movedPhoto = `${brand}/${actor}/${movedId}/c0000000-0000-4000-8000-000000000075.jpg`
  query(asReader + `insert into storage.objects(bucket_id,name) values ('warehouse-qr-audit','${movedPhoto}');`)
  const movedAt = JSON.parse(query(asReader + auditSql('place', { id: movedId, place: '2-1-2' })))
  const moveDraft = { id: movedId, place: movedAt.place, baseline: movedAt.baseline,
    entries: [{ qr: 'AUDIT-PHOTO', photo_path: movedPhoto }] }
  const movePreview = JSON.parse(query(asReader + auditSql('preview', moveDraft)))
  assert.equal(movePreview.boxes[0].fromPlace, '2-1-3')
  query(asReader + auditSql('confirm', { ...moveDraft, token: movePreview.token }))
  const movedExport = sheetJob()
  assert.equal(movedExport.before[0].values[2], '2-1-3')
  assert.equal(movedExport.after[0].values[2], '2-1-2')
  assert.equal(confirmAuditSheet(movedExport), 't')
  const spare = JSON.parse(query(asReader + auditSql('place')))
  const emptyDraft = { id: 'c0000000-0000-4000-8000-000000000076', baseline: spare.baseline, entries: [] }
  const emptyPreview = JSON.parse(query(asReader + auditSql('preview', emptyDraft)))
  assert.equal(emptyPreview.before.length, 1)
  query(asReader + auditSql('confirm', { ...emptyDraft, token: emptyPreview.token }))
  const emptyExport = sheetJob()
  assert.equal(emptyExport.place, '2-1-3')
  assert.equal(emptyExport.after.length, 0)
  assert.equal(confirmAuditSheet(emptyExport), 't')
  query(asService + sheet(oldSheet, 'clock_timestamp()'))
  assert.equal(query(`select count(*) from warehouse_stock_positions p join warehouse_locations l on l.id=p.location_id
    where p.set_id='${activeId()}' and l.code='2-1-3';`), '0')
  assert.equal(query(`select count(*) from warehouse_stock_positions p join warehouse_locations l on l.id=p.location_id
    where p.set_id='${activeId()}' and l.code='2-1-2' and p.box_qr='AUDIT-PHOTO';`), '1')
  assert.equal(query(`select (location_id is null and completed_at is null)::text from warehouse_boxes
    where display_code='GUARD-QR-3';`), 'true')
  const reopenedInbound = JSON.parse(query(asService + inbound(90, '2-1-3') + ';'))
  assert.equal(reopenedInbound.status, 'saved')
  assert.equal(query(`select count(*) from warehouse_stock_positions where set_id='${activeId()}' and box_qr='GUARD-QR-90';`), '1')
  const regularRequest = { mode: 'place', place: '2-1-1', qr: 'GUARD-REGULAR-QR',
    number: 'M1234', receivedOn: '2026-11-13', quantity: 12,
    backgroundJobId: 'c0000000-0000-4000-8000-000000000091:0' }
  const regularInbound = JSON.parse(query(asService + backgroundMove('prepare', regularRequest)))
  assert.equal(regularInbound.status, 'prepared')
  query(asService + backgroundMove('finish', { operationId: regularInbound.operationId, rowNumber: 11 }))
  const regularMove = JSON.parse(query(asService + backgroundMove('prepare', {
    mode: 'place', place: '2-1-2', qr: regularRequest.qr, backgroundJobId: 'c0000000-0000-4000-8000-000000000092:0',
  })))
  assert.equal(regularMove.plan.write.docId, regularInbound.plan.write.docId)
  query(asService + backgroundMove('finish', { operationId: regularMove.operationId, rowNumber: 11 }))
  assert.equal(query(`select l.code || ':' || p.units_per_box || ':' || p.remaining_boxes
    from warehouse_stock_positions p join warehouse_locations l on l.id=p.location_id
    where p.set_id='${activeId()}' and p.box_qr='GUARD-REGULAR-QR';`), '2-1-2:12:1')
  console.log('PASS: slot audit sheet confirmation, private photo review, opened QR movement, and existing intake')

  const conditionAcl = () => query(`select proacl::text from pg_proc
    where oid='public.save_warehouse_stock_condition(uuid,uuid,uuid,text,text,jsonb)'::regprocedure;`)
  const originalAcl = conditionAcl()
  const currentSetId = activeId()
  const existingStock = () => query(`select md5(string_agg(to_jsonb(p)::text, ',' order by p.id))
    from warehouse_stock_positions p where set_id='${currentSetId}'
    and coalesce(external_row_id,'') not like 'at_manual_%';`)
  const originalStockHash = existingStock()
  query(atelierSql('20261116042928_warehouse_manual_product_receive'))
  assert.equal(conditionAcl(), originalAcl)
  assert.equal(existingStock(), originalStockHash)

  const eventName = '캐논 콜라보 토트백'
  const manualReceive = (request, place, zone, name = eventName) => `select public.save_warehouse_stock_condition(
    '${brand}','c0000000-0000-4000-8000-000000000${request}',null,'normal',null,${json({
      style_id: null, source_style_no: 'M1234', source_product_name: name,
      location_code: place, zone, received_on: '2026-11-16', received_on_raw: '261116',
      units_per_box: 20, remaining_boxes: 2,
    })})->>'sheetPending';`
  query(asReader + manualReceive(101, '3-1-1', 'box_storage'), '42501')
  query(asEditor + manualReceive(101, '3-1-1', 'box_storage', '  '), '22023')
  query(asEditor + manualReceive(101, '2-1-2', 'picking'), '22023')
  const staleConditionSnapshot = quote(query('select clock_timestamp();'))
  for (const [request, place, zone] of [[101, '3-1-1', 'box_storage'], [102, 'P-7-1', 'picking']]) {
    const save = asEditor + manualReceive(request, place, zone, ` ${eventName} `)
    assert.equal(query(save), 'true')
    assert.equal(query(save), 'true')
    const exportRow = queued()
    assert.equal(exportRow.before, null)
    assert.equal(exportRow.values.number, '')
    assert.equal(exportRow.values.productName, eventName)
    assert.equal(exportRow.values.place, place)
    assert.match(exportRow.rowId, /^at_manual_[0-9a-f]{32}$/)
    assert.equal(query(asReader + `select count(*) from warehouse_stock_positions p
      join warehouse_locations l on l.id=p.location_id
      where p.set_id='${currentSetId}' and p.external_row_id='${exportRow.rowId}'
        and l.zone='${zone}' and l.code='${place}' and p.style_id is null and p.source_style_no=''
        and p.normalized_style_no='' and p.remaining_boxes=2 and p.units_per_box=20;`), '1')
    assert.equal(query(asReader + `select count(*) from public.search_warehouse_finder_rows(
      '${brand}','product',${quote(eventName)},100) where external_row_id='${exportRow.rowId}';`), '1')
    query(asService + sheet(oldSheet, 'clock_timestamp()'), 'PWS04')
    assert.equal(confirmCondition(exportRow), '1')
    assert.equal(query(save), 'false')
  }
  query(asEditor + manualReceive(103, 'P-7-1', 'box_storage'), '22023')
  query(asService + sheet(oldSheet, staleConditionSnapshot), 'PWS05')
  query(asService + sheet(oldSheet, 'clock_timestamp()'), 'PWS06')
  assert.equal(activeId(), currentSetId)
  assert.equal(existingStock(), originalStockHash)
  assert.equal(query(`select zone from warehouse_registered_slots where warehouse_id='${warehouse}' and code='P-7-1';`), 'picking')
  assert.equal(query(asEditor + `begin;
    select public.save_warehouse_stock_condition('${brand}',
      'c0000000-0000-4000-8000-000000000104',null,'normal',null,${json({
        style_id: style, location_code: 'P-7-1', zone: 'picking', received_on_raw: '261116',
        units_per_box: 10, remaining_boxes: 1,
      })});
    select source_style_no from public.warehouse_stock_positions
    where set_id='${currentSetId}' and external_row_id='at_c0000000000040008000000000000104';
    rollback;`), 'M1234')
  console.log('PASS: manual products in both zones, current ACL and original stock preserved, one row per request, pending/stale/missing sheet protection')

  query(atelierSql('20261116045654_warehouse_stock_row_correction'))
  const event = JSON.parse(query(`select to_jsonb(p) from warehouse_stock_positions p
    where p.set_id='${currentSetId}' and p.external_row_id like 'at_manual_%101';`))
  const correct = (suffix, row, changes) => `select public.correct_warehouse_stock_row('${brand}',
    'c0000000-0000-4000-8000-000000000${suffix}','${row.id}',${quote(row.updated_at)},${json(changes)})->>'saved';`
  query(asReader + correct(105, event, { productName: 'Denied' }), '42501')
  query(asEditor + correct(105, event, { boxQr: 'REPLACED' }), '22023')
  const correction = { productName: eventName + ' 수정', place: 'P-7-1', zone: 'picking', note: '라벨 정정' }
  assert.equal(query(asEditor + correct(105, event, correction)), 'true')
  assert.equal(query(asEditor + correct(105, event, correction)), 'true')
  query(asEditor + correct(106, event, { note: 'Stale' }), '40001')
  const edited = queued()
  assert.equal(edited.rowId, event.external_row_id)
  assert.equal(edited.before.productName, eventName)
  assert.equal(edited.values.number, '')
  assert.equal(edited.values.place, 'P-7-1')
  assert.equal(edited.values.boxes, edited.before.boxes)
  assert.equal(confirmCondition(edited), '1')
  const qr = JSON.parse(query(`select to_jsonb(p) from warehouse_stock_positions p
    where p.set_id='${currentSetId}' and p.box_qr='GUARD-REGULAR-QR';`))
  assert.equal(query(asEditor + correct(107, qr, {
    receivedOn: '261116', date: '2026-11-16', priority: 'fifo', units: '15', note: 'QR 라벨 수정',
  })), 'true')
  const qrCorrection = queued()
  assert.equal(qrCorrection.rowId, qr.external_row_id)
  assert.equal(qrCorrection.values.boxQr, qr.box_qr)
  assert.equal(qrCorrection.values.number, 'M1234')
  assert.equal(query(`select current_qty from public.warehouse_boxes where display_code='GUARD-REGULAR-QR';`), '15')
  assert.equal(confirmCondition(qrCorrection), '1')
  const updatedQr = JSON.parse(query(`select to_jsonb(p) from warehouse_stock_positions p where id='${qr.id}';`))
  assert.equal(query(asEditor + correct(108, updatedQr, { condition: 'needs_inspection' })), 'true')
  const qrCondition = queued()
  assert.equal(qrCondition.values.number, '')
  assert.equal(qrCondition.values.productName, 'Test style_(검수 필요)')
  assert.equal(qrCondition.values.boxQr, qr.box_qr)
  assert.equal(query(`select box_qr from warehouse_stock_positions where id='${qr.id}';`), qr.box_qr)
  assert.equal(confirmCondition(qrCondition), '1')
  console.log('PASS: correction retains QR and row identity, rejects stale or unauthorized edits, and uses the same sheet queue')

  const pendingFinder = JSON.parse(query(asService + `select public.run_finder_warehouse_sheet_export('${brand}','claim','{}');`))
  query(asService + `select public.run_finder_warehouse_sheet_export('${brand}','confirm',${json({ ...pendingFinder, rowNumber: 29 })});`)
  query(atelierSql('20261116055823_warehouse_stock_work_sheet_export'))
  const readPosition = (aa) => JSON.parse(query(`select to_jsonb(p) || jsonb_build_object('place',l.code)
    from warehouse_stock_positions p join warehouse_locations l on l.id=p.location_id
    where p.set_id='${activeId()}' and p.external_row_id=${quote(aa)};`))
  const work = (suffix, position, action, payload) => `select public.save_warehouse_stock_work(
    '${brand}','c0000000-0000-4000-8000-000000000${suffix}','${position.id}',${quote(position.updated_at)},
    '${action}',${json(payload)})->>'sheetPending';`
  const acceptWork = (job) => confirmAuditSheet(job, job.after.map(({ id, qr, values }) => ({ id, qr, values }))
    .sort((a, b) => a.id.localeCompare(b.id)))
  const fromAa = 'fixture-sheet'
  query(`update public.warehouse_stock_positions set remaining_boxes=7,remaining_boxes_raw='7'
    where set_id='${activeId()}' and external_row_id='${fromAa}';`)
  const aggregate = readPosition(fromAa)
  const split = work(109, aggregate, 'move', { to_location_code: 'P-7-1', box_count: 2 })
  query(asReader + split, '42501')
  query(asEditor + work(109, aggregate, 'move', { to_location_code: 'UNREGISTERED', box_count: 2 }), '22023')
  assert.equal(query(asEditor + split), 'true')
  assert.equal(query(asEditor + split), 'true')
  const splitExport = sheetJob()
  assert.equal(splitExport.kind, 'stock')
  const splitRow = splitExport.after.find(row => row.id !== fromAa)
  assert.match(splitRow.id, /^at_move_[0-9a-f]{32}$/)
  assert.deepEqual(splitRow.values.slice(0, 6), ['M1234', 'Test style', 'P-7-1', '261113', '12', '2'])
  assert.equal(readPosition(fromAa).remaining_boxes, 5)
  assert.equal(readPosition(splitRow.id).remaining_boxes, 2)
  assert.equal(query(`select count(*) from warehouse_stock_movements where position_id='${readPosition(splitRow.id).id}'
    and action='move';`), '1')
  query(asService + sheet(oldSheet, 'clock_timestamp()'), 'PWS07')
  query(asEditor + work(110, aggregate, 'move', { to_location_code: 'P-7-1', box_count: 1 }), '40001')
  assert.equal(confirmAuditSheet(splitExport, []), 'f')
  const beforeSheetWrite = quote(query('select clock_timestamp();'))
  assert.equal(acceptWork(splitExport), 't')
  assert.equal(query(asEditor + split), 'false')
  query(asService + sheet(oldSheet, beforeSheetWrite), 'PWS07')
  const refreshed = () => JSON.parse(query(`select jsonb_agg(to_jsonb(p) || jsonb_build_object(
    'location_code',l.code,'zone',l.zone,'note',concat_ws(' · ',case when p.opened_units>0
      then '개봉 잔량 '||p.opened_units||'개' end,nullif(p.note,''))))
    from warehouse_stock_positions p join warehouse_locations l on l.id=p.location_id
    where p.set_id='${activeId()}' and app.warehouse_qr_audit_is_active(p);`))
  query(asService + sheet(refreshed(), 'clock_timestamp()'))
  assert.equal(readPosition(fromAa).remaining_boxes, 5)
  assert.equal(readPosition(splitRow.id).place, 'P-7-1')

  const wholeMove = work(110, readPosition(splitRow.id), 'move', { to_location_code: '2-1-1', box_count: 2 })
  assert.equal(query(asEditor + wholeMove), 'true')
  const wholeExport = sheetJob()
  assert.deepEqual(wholeExport.after[0].values.map((value, index) => value !== wholeExport.before[0].values[index]), [
    false, false, true, false, false, false, false,
  ])
  assert.equal(wholeExport.after[0].id, splitRow.id)
  assert.equal(acceptWork(wholeExport), 't')
  assert.equal(query(asEditor + work(111, readPosition(splitRow.id), 'adjust', {
    units_per_box: 10, remaining_boxes: 3, opened_units: 2,
  })), 'true')
  const adjustExport = sheetJob()
  assert.deepEqual(adjustExport.after[0].values.slice(4), ['10', '3', '개봉 잔량 2개'])
  assert.equal(acceptWork(adjustExport), 't')
  query(asService + sheet(refreshed(), 'clock_timestamp()'))
  assert.equal(readPosition(splitRow.id).opened_units, 2)
  assert.equal(readPosition(splitRow.id).note, '')
  assert.equal(readPosition(splitRow.id).remaining_boxes, 3)
  const consumed = readPosition(splitRow.id)
  assert.equal(query(asEditor + work(112, consumed, 'deplete', {})), 'true')
  const depleteExport = sheetJob()
  assert.equal(depleteExport.before[0].id, splitRow.id)
  assert.deepEqual(depleteExport.after, [])
  assert.equal(query(asReader + `select count(*) from public.search_warehouse_finder_rows(
    '${brand}','warehouse','2-1-1',100) where external_row_id='${splitRow.id}';`), '0')
  assert.equal(acceptWork(depleteExport), 't')
  query(asService + sheet(refreshed(), 'clock_timestamp()'))
  assert.equal(query(`select count(*) from warehouse_stock_movements where position_id='${consumed.id}' and action='deplete';`), '1')
  assert.equal(query(`select count(*) from warehouse_stock_positions where set_id='${activeId()}'
    and external_row_id='${splitRow.id}';`), '0')
  const qrMoveRow = readPosition(qr.external_row_id)
  assert.equal(query(asEditor + work(113, qrMoveRow, 'move', { to_location_code: '2-1-1', box_count: 1 })), 'true')
  const qrMove = sheetJob()
  assert.equal(qrMove.before[0].id, qrMove.after[0].id)
  assert.equal(qrMove.before[0].qr, qrMove.after[0].qr)
  assert.equal(query(`select l.code from warehouse_boxes b join warehouse_locations l on l.id=b.location_id
    where b.display_code='GUARD-REGULAR-QR';`), '2-1-1')
  assert.equal(acceptWork(qrMove), 't')
  assert.equal(query(asEditor + work(114, readPosition(qr.external_row_id), 'deplete', {})), 'true')
  assert.equal(acceptWork(sheetJob()), 't')
  query(asService + sheet(refreshed(), 'clock_timestamp()'))
  assert.equal(query(`select (current_qty = 0 and completed_at is not null and completion_kind='depleted')::text
    from warehouse_boxes where display_code='GUARD-REGULAR-QR';`), 'true')
  assert.equal(query(asEditor + work(115, readPosition(event.external_row_id), 'move', {
    to_location_code: '2-1-3', box_count: 1,
  })), 'true')
  const partialManual = sheetJob()
  const manualNew = partialManual.after.find(row => row.id !== event.external_row_id)
  assert.match(manualNew.id, /^at_manual_[0-9a-f]{32}$/)
  assert.equal(manualNew.values[0], '')
  assert.equal(acceptWork(partialManual), 't')
  const zeroCount = readPosition(fromAa)
  assert.equal(query(asEditor + work(116, zeroCount, 'adjust', {
    units_per_box: 12, remaining_boxes: 0, opened_units: 0,
  })), 'true')
  const zeroExport = sheetJob()
  assert.equal(zeroExport.after[0].id, fromAa)
  assert.equal(zeroExport.after[0].values[5], '0')
  assert.equal(acceptWork(zeroExport), 't')
  query(asService + sheet([...refreshed(), { ...fixtureRow, remaining_boxes: 0, remaining_boxes_raw: '0' }], 'clock_timestamp()'))
  assert.equal(readPosition(fromAa).remaining_boxes, 0)
  console.log('PASS: stock work split and full moves, quantity adjust, depletion, idempotency and snapshot protection')

  query(atelierSql('20261116082935_verify_warehouse_stock_sheet_writeback'))
  const checkedRequest = 'c0000000-0000-4000-8000-000000000199'
  const checkedRow = 'verified-correction'
  const checkedValues = { number: 'M1234', productName: 'Test style', place: '2-1-1',
    receivedOn: '260826', units: '1000', boxes: '5', note: '메모', boxQr: 'QA-CONFIRM', openedUnits: 3 }
  query(`insert into app.warehouse_stock_condition_exports
    (brand_id,request_id,external_row_id,before_values,sheet_values,restore_values)
    values ('${brand}','${checkedRequest}', '${checkedRow}',
      ${json({ ...checkedValues, receivedOn: '260713' })},${json(checkedValues)},'{}');`)
  const confirmChecked = observed_values => query(asService + `select public.confirm_warehouse_stock_condition_exports(
    '${brand}',${json([{ request_id: checkedRequest, row_id: checkedRow,
      number: checkedValues.number, product_name: checkedValues.productName, observed_values }])});`)
  assert.equal(confirmChecked(undefined), '0')
  for (const [field, wrong] of Object.entries({
    place: '2-1-2', receivedOn: '260713', units: '100', boxes: '4', note: '다른 메모', boxQr: '',
  })) {
    assert.equal(confirmChecked({ ...checkedValues, [field]: wrong }), '0', field)
  }
  assert.equal(confirmChecked({ ...checkedValues, units: '1,000', note: '개봉 잔량 3개 · 메모' }), '1')
  assert.equal(confirmChecked(checkedValues), '0')
  console.log('PASS: row correction requires actual B:H and S read-back before sheet confirmation')

  // The shared database received the outbound wrapper before the unplaced QR wrapper.
  query(atelierSql('20261116073801_finder_confirm_box_outbound'))
  query(atelierSql('20261116065754_finder_unplaced_box_qr_links'))
  const unplaced = (qr, number, name) => `select public.finder_link_unplaced_box_qr('${brand}',
    ${quote(qr)},${number ? quote(number) : 'null'},${name ? quote(name) : 'null'});`
  const beforeLink = () => query(`select jsonb_build_array(
    (select count(*) from public.warehouse_stock_positions), (select count(*) from public.warehouse_boxes),
    (select count(*) from app.warehouse_qr_audit_sheet_exports), (select count(*) from app.finder_warehouse_sheet_exports),
    (select count(*) from public.warehouse_stock_movements));`)
  const countsBeforeLink = beforeLink()
  const link = unplaced(' no-place-qr ', 'm1234')
  query('set role anon;' + link, '42501')
  const savedLink = JSON.parse(query(asReader + link))
  assert.deepEqual(savedLink, { qr: 'NO-PLACE-QR', number: 'M1234', productName: 'Test style' })
  assert.deepEqual(JSON.parse(query(asReader + link)), savedLink)
  assert.deepEqual(JSON.parse(query(asReader + unplaced('NO-M-LABEL', null, '테이프'))),
    { qr: 'NO-M-LABEL', number: null, productName: '테이프' })
  query(asReader + unplaced('NO-PLACE-QR', null, '다른 상품'), '22023')
  query(asReader + unplaced('2-1-1', 'M1234'), '22023')
  query(asReader + unplaced('AUDIT-PHOTO', 'M1234'), '22023')
  query(asReader + `select * from app.finder_unplaced_box_qr_links;`, '42501')
  query(`insert into public.cargo_inbound_receipts(receipt_id,brand_id,cargo_inbound_line_id,receiving_mode,
    box_qr,actual_box_count,actual_qty,created_by)
    values (gen_random_uuid(),'${brand}','${style}','box_qr','NO-PLACE-QR',1,12,'${actor}');`, '22023')
  assert.equal(beforeLink(), countsBeforeLink)

  const lookup = (qr, place = '2-1-1') => JSON.parse(query(asReader + "set test.finder_key='ok';" +
    `select public.finder_warehouse_placement('${brand}','read',${json({ qr, place })});`))
  assert.deepEqual(lookup('NO-PLACE-QR').qrLink, { number: 'M1234', productName: 'Test style' })
  assert.equal(lookup('NO-PLACE-QR', '2-1-3').box, null)
  const intake = { mode: 'place', place: '2-1-1', qr: 'NO-PLACE-QR', number: 'M1234', quantity: 12,
    receivedOn: '2026-11-13', backgroundJobId: 'c0000000-0000-4000-8000-000000000129:0' }
  const intakePlan = JSON.parse(query(asService + backgroundMove('prepare', intake)))
  assert.equal(intakePlan.status, 'prepared')
  assert.equal(query(`select (placed_at is null)::text from app.finder_unplaced_box_qr_links where box_qr='NO-PLACE-QR';`), 'true')
  query(asService + backgroundMove('finish', { operationId: intakePlan.operationId, rowNumber: 32 }))
  assert.equal(lookup('NO-PLACE-QR').box.state, 'active')
  assert.equal(lookup('NO-PLACE-QR').qrLink, undefined)
  assert.equal(query(`select (placed_at is not null)::text from app.finder_unplaced_box_qr_links where box_qr='NO-PLACE-QR';`), 'true')
  console.log('PASS: unplaced QR registration writes no stock or sheet work, read prefills intake, real placement consumes link')

  const photoCounts = beforeLink()
  const reviewPhoto = `${brand}/${actor}/c0000000-0000-4000-8000-000000000130/c0000000-0000-4000-8000-000000000131.jpg`
  const photoLink = (path) => `select public.finder_link_unplaced_box_qr('${brand}','PHOTO-UNPLACED',null,null,${quote(path)});`
  query(asReader + photoLink(reviewPhoto), '22023')
  query(asReader + `insert into storage.objects(bucket_id,name) values ('warehouse-qr-audit',${quote(reviewPhoto)});`)
  assert.equal(JSON.parse(query(asReader + photoLink(reviewPhoto))).pendingReview, true)
  assert.equal(JSON.parse(query(asReader + photoLink(reviewPhoto))).pendingReview, true)
  assert.deepEqual(lookup('PHOTO-UNPLACED').qrLink, { pendingReview: true })
  query(asService + backgroundMove('prepare', { ...intake, qr: 'PHOTO-UNPLACED', backgroundJobId: 'c0000000-0000-4000-8000-000000000131:0' }), '22023')
  const unplacedQueue = () => JSON.parse(query(asEditor + reviewSql('list', { includeUnplaced: true })))
  assert.ok(!JSON.parse(query(asEditor + reviewSql('list'))).items.some(item => item.box_qr === 'PHOTO-UNPLACED'))
  const photoItem = unplacedQueue().items.find(item => item.box_qr === 'PHOTO-UNPLACED')
  assert.equal(photoItem.unplaced, true)
  assert.equal(photoItem.place, null)
  assert.equal(photoItem.photo_path, reviewPhoto)
  assert.equal(query(asReader + `select count(*) from storage.objects where name=${quote(reviewPhoto)};`), '0')
  assert.equal(query(asEditor + `select count(*) from storage.objects where name=${quote(reviewPhoto)};`), '1')
  const resolvePhoto = reviewSql('link_unplaced', { rowId: photoItem.external_row_id, name: '테이프' })
  query(asReader + resolvePhoto, '42501')
  assert.deepEqual(JSON.parse(query(asEditor + resolvePhoto)), { number: null, productName: '테이프' })
  assert.ok(!unplacedQueue().items.some(item => item.box_qr === 'PHOTO-UNPLACED'))
  assert.deepEqual(lookup('PHOTO-UNPLACED').qrLink, { number: null, productName: '테이프' })
  assert.equal(beforeLink(), photoCounts)

  const receiveNamedQr = `select public.finder_place_named_qr('${brand}', 'PHOTO-UNPLACED', '2-1-1', '2026-11-13', 24);`
  assert.equal(JSON.parse(query(asReader + receiveNamedQr)).sheetPending, true)
  assert.equal(JSON.parse(query(asReader + receiveNamedQr)).sheetPending, true)
  const namedExport = sheetJob()
  assert.equal(namedExport.kind, 'stock')
  assert.equal(namedExport.after.length, 1)
  assert.equal(namedExport.after[0].qr, 'PHOTO-UNPLACED')
  const namedAa = namedExport.after[0].id
  assert.deepEqual(namedExport.after[0].values.slice(0, 6), ['', '테이프', '2-1-1', '261113', '24', '1'])
  assert.equal(readPosition(namedAa).box_qr, 'PHOTO-UNPLACED')
  query(asService + sheet(refreshed(), 'clock_timestamp()'), 'PWS07')
  assert.equal(acceptWork(namedExport), 't')
  query(asService + sheet(refreshed(), 'clock_timestamp()'))
  assert.equal(readPosition(namedAa).box_qr, 'PHOTO-UNPLACED')
  assert.equal(lookup('PHOTO-UNPLACED').qrLink, undefined)
  console.log('PASS: private unplaced review photo, product-only review, actual name-only intake, sheet confirmation and snapshot')

  query(atelierSql('20261116094915_atelier_stock_sheet_writeback'))
  const claimJobs = () => JSON.parse(query(asService + `select public.claim_atelier_stock_sheet_jobs('${brand}');`))
  assert.deepEqual(claimJobs(), { enabled: false, jobs: [] })
  const chainAa = 'atelier-sequential'
  const repairAa = 'legacy-sent-partial-proof'
  const startRows = [...refreshed(), ...[chainAa, repairAa].map((aa, index) => ({
    ...row(aa, '', '2-1-1'), source_row_number: 61 + index, remaining_boxes: 2, remaining_boxes_raw: '2',
  }))]
  query(asService + sheet(startRows, 'clock_timestamp()'))
  assert.equal(query(asEditor + correct(200, readPosition(repairAa), { boxes: '3' })), 'true')
  // Emulate a B/C-only acknowledgement from the old worker before the strict check was installed.
  query(`update app.warehouse_stock_condition_exports set sheet_synced_at=clock_timestamp()
    where brand_id='${brand}' and external_row_id='${repairAa}';`)
  assert.equal(query(asEditor + work(201, readPosition(repairAa), 'move', { to_location_code: '2-1-3', box_count: 3 })), 'true')
  const activate = `select public.activate_atelier_stock_sheet_writeback('${brand}');`
  query(asReader + activate, '42501')
  assert.equal(query(asService + activate), '1')
  const legacyObserved = { id: repairAa, qr: '', values: ['M1234', 'Test style', '2-1-1', '261113', '12', '2', ''] }
  const reconcile = (observed, version = readPosition(repairAa).updated_at) =>
    `select public.reconcile_atelier_stock_sheet_baseline('${brand}','${repairAa}',${quote(version)},${json(observed)});`
  query(asService + reconcile({ ...legacyObserved, values: [...legacyObserved.values.slice(0, 6), 'wrong'] }), '22023')
  query(asService + reconcile(legacyObserved, '2026-01-01'), '40001')
  assert.match(query(asService + reconcile(legacyObserved)), /^\d+$/)
  assert.equal(query(asService + activate), '0')
  const receiptRows = job => job.after.map(({ id, qr, values }) => ({ id, qr, values }))
  const absentIds = job => job.ids.filter(aa => !job.after.some(projection => projection.id === aa))
  const confirmJob = (job, observed = receiptRows(job), absent = absentIds(job), lease = job.lease) => query(asService +
    `select public.finish_atelier_stock_sheet_job('${brand}','${job.id}','${lease}',${json(observed)},array[${absent.map(quote).join(',')}]::text[]);`)
  const syncedJobs = claimJobs()
  assert.equal(syncedJobs.enabled, true)
  assert.equal(syncedJobs.jobs.length, 1)
  const repairJob = syncedJobs.jobs[0]
  assert.deepEqual(receiptRows({ after: repairJob.before }), [legacyObserved])
  assert.deepEqual(repairJob.after[0].values.slice(2, 6), ['2-1-3', '261113', '12', '3'])
  assert.equal(query(asService + `select count(*) from public.list_warehouse_qr_audit_sheet_exports('${brand}');`), '0')
  assert.equal(confirmAuditSheet(repairJob, receiptRows(repairJob)), 'f')
  assert.equal(confirmJob(repairJob, [legacyObserved]), 'f')
  assert.equal(confirmJob(repairJob), 't')
  console.log('PASS: only pending Atelier work adopted; stale legacy claim rebased from observed AA and current stock')

  const initialChain = readPosition(chainAa)
  assert.equal(query(asEditor + correct(202, initialChain, { boxes: '3' })), 'true')
  assert.equal(query(asEditor + work(203, readPosition(chainAa), 'move', { to_location_code: '2-1-3', box_count: 3 })), 'true')
  assert.equal(query(asEditor + correct(204, readPosition(chainAa), { note: '최종 메모' })), 'true')
  assert.equal(readPosition(chainAa).remaining_boxes, 3)
  assert.equal(readPosition(chainAa).place, '2-1-3')
  assert.equal(query(`select count(*) from public.warehouse_stock_movements where position_id='${initialChain.id}'`), '3')
  const [firstVersion] = claimJobs().jobs
  assert.deepEqual(firstVersion.before[0].values.slice(2), ['2-1-1', '261113', '12', '2', ''])
  assert.deepEqual(firstVersion.after[0].values.slice(2), ['2-1-3', '261113', '12', '3', '최종 메모'])
  assert.equal(query(asService + `select count(*) from public.list_warehouse_stock_condition_exports('${brand}');`), '0')
  query(asService + backgroundMove('prepare', {
    mode: 'place', place: '2-1-3', qr: 'NO-FINDER-DURING-ATELIER', number: 'M1234', quantity: 12,
    receivedOn: '2026-11-13', backgroundJobId: 'c0000000-0000-4000-8000-000000000299:0',
  }), 'PQA01')
  const newer = readPosition(chainAa)
  const adjust = work(205, newer, 'adjust', { units_per_box: 12, remaining_boxes: 4, opened_units: 2 })
  await race(asEditor + adjust, asEditor + correct(206, newer, { note: '동시 수정' }), '40001')
  assert.deepEqual(claimJobs().jobs, [])
  const staleSnapshotAt = quote(query('select clock_timestamp();'))
  assert.equal(confirmJob(firstVersion, firstVersion.after.map(({ id, qr }) => ({ id, qr }))), 'f')
  assert.equal(confirmJob(firstVersion), 't')
  assert.equal(confirmJob(firstVersion), 't')
  const [secondVersion] = claimJobs().jobs
  assert.equal(secondVersion.before[0].values[5], '3')
  assert.equal(secondVersion.after[0].values[5], '4')
  assert.equal(confirmJob(secondVersion, receiptRows(secondVersion), [], firstVersion.lease), 'f')
  query(asService + sheet(startRows, staleSnapshotAt))
  assert.equal(readPosition(chainAa).remaining_boxes, 4)
  assert.equal(readPosition(chainAa).opened_units, 2)
  assert.equal(readPosition(chainAa).place, '2-1-3')
  assert.equal(readPosition(chainAa).note, '최종 메모')
  assert.equal(confirmJob(secondVersion), 't')
  query(asService + sheet(startRows, staleSnapshotAt))
  assert.equal(readPosition(chainAa).remaining_boxes, 4)
  assert.equal(readPosition(chainAa).place, '2-1-3')
  console.log('PASS: consecutive no-QR correction and move, three history records, true stale-write guard, versioned acknowledgement and stale snapshot overlay')

  const emptyPicking = 'P-8-1'
  query(`insert into public.warehouse_registered_slots (warehouse_id,code,zone)
    values ('${warehouse}','${emptyPicking}','picking');`)
  assert.equal(query(asEditor + work(207, readPosition(chainAa), 'move', { to_location_code: emptyPicking, box_count: 1 })), 'true')
  const splitAa = 'at_move_c0000000000040008000000000000207'
  assert.equal(readPosition(splitAa).place, emptyPicking)
  query(asEditor + manualReceive(208, emptyPicking, 'picking'), '23505')
  assert.equal(query(asEditor + manualReceive(208, '2-1-1', 'box_storage')), 'true')
  assert.equal(query(asEditor + manualReceive(208, '2-1-1', 'box_storage')), 'true')
  const newAa = 'at_manual_c0000000000040008000000000000208'
  assert.equal(query(asEditor + correct(209, readPosition(newAa), { note: '수동 입고 수정' })), 'true')
  const [splitVersion, intakeVersion] = claimJobs().jobs
  assert.deepEqual(splitVersion.ids, [splitAa, chainAa])
  assert.deepEqual(splitVersion.picking, [emptyPicking])
  assert.deepEqual(splitVersion.after.map(r => [r.values[2], r.values[5]]), [[emptyPicking, '1'], ['2-1-3', '3']])
  assert.deepEqual(intakeVersion.ids, [newAa])
  assert.equal(intakeVersion.after[0].values[6], '수동 입고 수정')
  query(asService + sheet([...refreshed(),
    { ...row('unexpected-sheet-occupant', '', emptyPicking), zone: 'picking', source_row_number: 65 },
    { ...row('other-sheet-arrival', '', '2-1-1'), source_row_number: 66 },
  ], 'clock_timestamp()'))
  assert.equal(readPosition(splitAa).place, emptyPicking)
  assert.equal(readPosition('other-sheet-arrival').place, '2-1-1')
  assert.equal(query(`select count(*) from public.warehouse_stock_positions where set_id='${activeId()}'
    and external_row_id='unexpected-sheet-occupant';`), '0')
  const failed = [{ id: chainAa, field: '박스 수', expected: '4', actual: '9', target: '3' }]
  assert.equal(query(asService + `select public.fail_atelier_stock_sheet_job('${brand}','${splitVersion.id}',
    '${splitVersion.lease}','SHEET_STOCK_CHANGED',${json(failed)});`), 't')
  const conflictsQuery = `select public.list_atelier_stock_sheet_conflicts('${brand}');`
  query(asReader + conflictsQuery, '42501')
  assert.deepEqual(JSON.parse(query(asEditor + conflictsQuery))[0].failure.differences, failed)
  assert.equal(confirmJob(intakeVersion), 't')
  query(`update app.atelier_stock_sheet_jobs set available_at=clock_timestamp() where id='${splitVersion.id}';`)
  const [retry] = claimJobs().jobs
  assert.equal(retry.id, splitVersion.id)
  assert.notEqual(retry.lease, splitVersion.lease)
  assert.equal(confirmJob(splitVersion), 'f')
  assert.equal(confirmJob(retry), 't')
  assert.deepEqual(JSON.parse(query(asEditor + conflictsQuery)), [])

  // One picking position transferred between different AA rows shares one atomic job.
  assert.equal(query(asEditor + work(210, readPosition(splitAa), 'move', { to_location_code: '2-1-1', box_count: 1 })), 'true')
  assert.equal(query(asEditor + work(211, readPosition(newAa), 'move', { to_location_code: emptyPicking, box_count: 2 })), 'true')
  const [handover] = claimJobs().jobs
  assert.deepEqual(handover.ids, [newAa, splitAa])
  assert.equal(confirmJob(handover), 't')

  const beforeDeplete = refreshed()
  const removed = readPosition(splitAa)
  assert.equal(query(asEditor + work(212, removed, 'deplete', { reason: '실수량 0 확인' })), 'true')
  assert.equal(query(`select reason from warehouse_stock_movements where position_id='${removed.id}' and action='deplete';`), '실수량 0 확인')
  const [removalVersion] = claimJobs().jobs
  assert.deepEqual(removalVersion.after, [])
  assert.equal(confirmJob(removalVersion, [], []), 'f')
  const removalSnapshotAt = quote(query('select clock_timestamp();'))
  query(asService + sheet(beforeDeplete, removalSnapshotAt))
  assert.equal(query(`select count(*) from public.warehouse_stock_positions where set_id='${activeId()}' and external_row_id='${splitAa}';`), '0')
  assert.equal(confirmJob(removalVersion), 't')
  const releaseMarkers = `select public.release_atelier_stock_sheet_removal_markers('${brand}','${removalVersion.id}');`
  assert.deepEqual(claimJobs().cleanup, [{ id: removalVersion.id, ids: [splitAa] }])
  assert.equal(query(asService + releaseMarkers), 't')
  assert.deepEqual(claimJobs().cleanup, [])
  query(asService + sheet(beforeDeplete, removalSnapshotAt))
  assert.equal(query(`select count(*) from public.warehouse_stock_positions where set_id='${activeId()}' and external_row_id='${splitAa}';`), '0')
  console.log('PASS: split moves, per-group conflicts, independent intake and retry, picking handover, depletion proof, audit reason and tombstone')
  // Legacy sheet storage can be empty after an accidental full move to picking.
  const moveFunction = "'public.save_warehouse_stock_work(uuid,uuid,uuid,timestamptz,text,jsonb)'::regprocedure"
  const moveAcl = query(`select proacl::text from pg_proc where oid=${moveFunction};`)
  const finderGuard = query(`select md5(pg_get_functiondef('app.assert_warehouse_qr_audit_sheet_ready(uuid,text,text,text)'::regprocedure));`)
  const knownLocationsMigration = atelierSql('20261116112508_warehouse_stock_move_existing_locations')
  query(knownLocationsMigration)
  query(knownLocationsMigration)
  query(atelierSql('20261117022050_warehouse_stock_sheet_repair_history'))
  assert.equal(query(`select proacl::text from pg_proc where oid=${moveFunction};`), moveAcl)
  assert.equal(query(`select md5(pg_get_functiondef('app.assert_warehouse_qr_audit_sheet_ready(uuid,text,text,text)'::regprocedure));`), finderGuard)
  query(`insert into warehouse_registered_slots(warehouse_id,code,zone) values
    ('${warehouse}','P-9-1','picking'), ('${warehouse}','P-9-2','picking');
    insert into warehouse_locations(company_id,warehouse_id,code,zone) values
    ('${company}','${warehouse}','%-6-9','box_storage'),
    ('${company}','${warehouse}','LEGACY-FULL','box_storage'),
    ('${company}','${warehouse}','LEGACY-PICKING','picking'),
    ('${company}','${warehouse}','LEGACY-DUP','box_storage'),
    ('${company}','${warehouse}','legacy-dup','box_storage'),
    ('${company}','${warehouse}','P-9-2','box_storage');
    insert into warehouses(id,company_id,name)
    values ('a0000000-0000-4000-8000-000000000099','${company}','Other warehouse');
    insert into warehouse_locations(company_id,warehouse_id,code,zone)
    values ('${company}','a0000000-0000-4000-8000-000000000099','OTHER-ONLY','box_storage');`)
  const legacySourceAa = 'legacy-move-source'
  query(asService + sheet([...refreshed(), {
    ...row(legacySourceAa, '', 'P-9-1'), zone: 'picking', remaining_boxes: 9,
    remaining_boxes_raw: '9', source_row_number: 70,
  }], 'clock_timestamp()'))
  const legacySource = readPosition(legacySourceAa)
  const restoreEight = work(220, legacySource, 'move', { to_location_code: '  %-6-9  ', box_count: 8 })
  query(asReader + restoreEight, '42501')
  for (const place of ['NEW-UNKNOWN', 'OTHER-ONLY', 'LEGACY-PICKING', 'LEGACY-DUP', '%-6-%']) {
    query(asEditor + work(220, legacySource, 'move', { to_location_code: place, box_count: 8 }), '22023')
  }
  query(asEditor + restoreEight.replace(brand, other), '42501')
  assert.equal(readPosition(legacySourceAa).remaining_boxes, 9)
  assert.equal(query(`select count(*) from app.warehouse_qr_audit_sheet_exports where id='c0000000-0000-4000-8000-000000000220';`), '0')
  assert.equal(query(asEditor + restoreEight), 'true')
  assert.equal(query(asEditor + restoreEight), 'true')
  query(asEditor + work(221, legacySource, 'move', { to_location_code: '%-6-9', box_count: 8 }), '40001')
  const returnedAa = 'at_move_c0000000000040008000000000000220'
  const returned = readPosition(returnedAa)
  assert.equal(readPosition(legacySourceAa).remaining_boxes, 1)
  assert.equal(returned.remaining_boxes, 8)
  assert.equal(returned.place, '%-6-9')
  assert.equal(returned.received_on, legacySource.received_on)
  assert.equal(returned.units_per_box, legacySource.units_per_box)
  assert.equal(returned.box_qr, null)
  assert.equal(query(`select count(*) from warehouse_stock_movements where position_id='${returned.id}';`), '1')
  const [returnedJob] = claimJobs().jobs
  assert.equal(returnedJob.after.length, 2)
  assert.deepEqual(returnedJob.after.map(r => [r.values[2], r.values[5]]).sort(),
    [['%-6-9', '8'], ['P-9-1', '1']])
  const activity = `select public.list_atelier_stock_sheet_activity('${brand}');`
  const drift = [{ id: legacySourceAa, field: '박스 수', expected: '9', actual: '7', target: '1' }]
  const recordRepair = (differences = drift, lease = returnedJob.lease, target = brand) =>
    `select public.record_atelier_stock_sheet_repair('${target}','${returnedJob.id}','${lease}',${json(differences)});`
  query(asReader + activity, '42501')
  query(asEditor + recordRepair(), '42501')
  assert.equal(query(asService + recordRepair(drift, returnedJob.lease, other)), 'f')
  assert.equal(query(asService + recordRepair(drift, 'c0000000-0000-4000-8000-000000000499')), 'f')
  assert.equal(query(asService + recordRepair([{ ...drift[0], id: 'different-aa' }])), 'f')
  assert.equal(query(asService + recordRepair([{ ...drift[0], field: 'AA' }])), 'f')
  assert.equal(query(asService + recordRepair()), 't')
  assert.deepEqual(JSON.parse(query(asEditor + activity)), { conflicts: [], repairs: [] })
  assert.equal(confirmJob(returnedJob, [{ id: legacySourceAa, qr: '', values: [] }]), 'f')
  assert.deepEqual(JSON.parse(query(asEditor + activity)), { conflicts: [], repairs: [] })
  assert.equal(confirmJob(returnedJob), 't')
  assert.equal(query(asService + recordRepair()), 'f')
  const verifiedActivity = JSON.parse(query(asEditor + activity))
  assert.deepEqual(verifiedActivity.conflicts, [])
  assert.equal(verifiedActivity.repairs[0].id, returnedJob.id)
  assert.deepEqual(verifiedActivity.repairs[0].repair_differences, drift)
  assert.ok(verifiedActivity.repairs[0].repair_observed_at <= verifiedActivity.repairs[0].completed_at)
  // The registered picking classification wins over an older storage location.
  assert.equal(query(asEditor + work(222, returned, 'move', { to_location_code: 'P-9-2', box_count: 1 })), 'true')
  const pickingAa = 'at_move_c0000000000040008000000000000222'
  assert.equal(query(`select l.zone from warehouse_locations l where l.id='${readPosition(pickingAa).location_id}';`), 'picking')
  query(asEditor + work(223, readPosition(returnedAa), 'move', { to_location_code: 'P-9-2', box_count: 1 }), '23505')
  assert.equal(query(asEditor + work(224, readPosition(pickingAa), 'move', { to_location_code: ' legacy-full ', box_count: 1 })), 'true')
  assert.equal(readPosition(pickingAa).place, 'LEGACY-FULL')
  assert.equal(readPosition(returnedAa).remaining_boxes, 7)
  const [latestLegacyJob] = claimJobs().jobs
  assert.equal(confirmJob(latestLegacyJob), 't')
  assert.equal(claimJobs().jobs.length, 0)
  console.log('PASS: known sheet storage full/split moves, 9 to 1+8, stable AA and date, retry, scope, permission, picking classification and occupancy')

  for (const name of ['20261117050000_finder_photo_qr_intake',
    '20261117063000_finder_warehouse_db_first', '20261117064000_finder_db_first_clear_source_link',
    '20261117065100_finder_db_first_invoker_entrypoints', '20261117065602_finder_single_inbound_slot_confirmation']) query(atelierSql(name))
  query(`insert into app.finder_warehouse_db_settings (brand_id) values ('${brand}');`)
  const qrPicking = 'P-10-1'
  const photoPicking = 'P-10-2'
  const namedPicking = 'P-10-3'
  query(`insert into public.warehouse_registered_slots (warehouse_id,code,zone)
    values ('${warehouse}','${qrPicking}','picking'), ('${warehouse}','${photoPicking}','picking'),
      ('${warehouse}','${namedPicking}','picking');`)
  const pickingRow = (aa, place, index, named = false) => ({
    ...row(aa, '', place), zone: 'picking', source_row_number: index,
    ...(named ? { style_id: null, source_style_no: '', normalized_style_no: '', source_product_name: '테이프' } : {}),
  })
  query(asService + sheet([...refreshed(), pickingRow('slot-old-a', qrPicking, 300),
    pickingRow('slot-old-b', qrPicking, 301, true), pickingRow('slot-photo-old', photoPicking, 302),
    pickingRow('slot-named-old', namedPicking, 303)], 'clock_timestamp()'))
  const readSlot = place => lookup(undefined, place)
  const oldSlot = readSlot(qrPicking)
  assert.equal(oldSlot.groups.length, 2)
  assert.match(oldSlot.slotToken, /^[a-f0-9]{32}$/)
  assert.ok(oldSlot.groups.every(group => group.token !== oldSlot.slotToken))

  const regularIntake = { ...intake, place: qrPicking, qr: 'SLOT-NEW-QR', backgroundJobId: 'c0000000-0000-4000-8000-000000000500:0' }
  const saveRegular = token => JSON.parse(query(asService + backgroundMove('prepare', { ...regularIntake, token })))
  assert.equal(saveRegular(undefined).status, 'occupied')
  assert.equal(saveRegular(oldSlot.groups[0].token).status, 'occupied')
  assert.equal(readSlot(qrPicking).slotToken, oldSlot.slotToken)
  const regularSaved = saveRegular(oldSlot.slotToken)
  assert.equal(regularSaved.status, 'saved')
  assert.equal(regularSaved.clearedRows, 2)
  assert.equal(lookup('SLOT-NEW-QR', qrPicking).box.place, qrPicking)
  assert.deepEqual(saveRegular(oldSlot.slotToken), regularSaved)

  const pickingPhotoPath = `${brand}/${actor}/c0000000-0000-4000-8000-000000000509/c0000000-0000-4000-8000-000000000508.jpg`
  query(asReader + `insert into storage.objects(bucket_id,name) values ('warehouse-qr-audit',${quote(pickingPhotoPath)});`)
  assert.equal(JSON.parse(query(asReader + `select public.finder_link_box_qr_photo(
    '${brand}', 'SLOT-PHOTO-NEW', ${quote(pickingPhotoPath)}, null, null, null, false);`)).pendingReview, true)
  const savePhoto = token => `select public.finder_place_photo_qr(
    '${brand}', 'SLOT-PHOTO-NEW', '${photoPicking}', ${token ? quote(token) : 'null'});`
  const slotBeforeChange = readSlot(photoPicking).slotToken
  query('set role anon;' + savePhoto(slotBeforeChange), '42501')
  query(asReader + `select public.finder_place_photo_qr('${brand}', 'SLOT-PHOTO-NEW', '${photoPicking}');`, '23505')
  query(`update public.warehouse_stock_positions set remaining_boxes=3, remaining_boxes_raw='3'
    where set_id='${activeId()}' and external_row_id='slot-photo-old';`)
  const refreshedCheck = JSON.parse(query(asReader + savePhoto(slotBeforeChange)))
  assert.equal(refreshedCheck.status, 'occupied')
  assert.notEqual(refreshedCheck.token, slotBeforeChange)
  assert.equal(readPosition('slot-photo-old').remaining_boxes, 3)
  assert.equal(lookup('SLOT-PHOTO-NEW', photoPicking).qrLink.pendingReview, true)
  assert.deepEqual(JSON.parse(query(asReader + savePhoto(refreshedCheck.token))), { pendingReview: true, alreadyPlaced: false })
  assert.deepEqual(JSON.parse(query(asReader + savePhoto(refreshedCheck.token))), { pendingReview: true, alreadyPlaced: true })
  assert.equal(lookup('SLOT-PHOTO-NEW', photoPicking).box.place, photoPicking)

  query(asReader + unplaced('SLOT-NAMED-NEW', null, '테이프'))
  const saveNamed = token => JSON.parse(query(asReader + `select public.finder_place_named_qr(
    '${brand}', 'SLOT-NAMED-NEW', '${namedPicking}', '2026-11-13', 24, ${token ? quote(token) : 'null'});`))
  assert.equal(saveNamed(null).status, 'occupied')
  const namedSlotToken = readSlot(namedPicking).slotToken
  assert.equal(saveNamed(namedSlotToken).sheetPending, true)
  assert.equal(saveNamed(namedSlotToken).sheetPending, true)

  const jobs = claimJobs().jobs
  assert.deepEqual(jobs.find(job => job.after.some(entry => entry.qr === 'SLOT-NEW-QR')).before.map(entry => entry.id).sort(),
    ['slot-old-a', 'slot-old-b'])
  assert.deepEqual(jobs.find(job => job.after.some(entry => entry.qr === 'SLOT-PHOTO-NEW')).before.map(entry => entry.id),
    ['slot-photo-old'])
  assert.deepEqual(jobs.find(job => job.after.some(entry => entry.qr === 'SLOT-NAMED-NEW')).before.map(entry => entry.id),
    ['slot-named-old'])
  console.log('PASS: a single picking slot confirmation replaces multiple groups, stale confirmation preserves changed stock, photo QR retry is idempotent and old AA rows are exported')
} finally {
  if (started) command('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop'], { stdio: 'ignore' })
  assert.equal(path.dirname(fixture), tempRoot)
  assert.match(path.basename(fixture), /^atelier-warehouse-guard-[0-9a-f-]{36}$/)
  if (existsSync(fixture)) rmSync(fixture, { recursive: true, force: true })
}
