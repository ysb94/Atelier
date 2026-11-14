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
const asService = "set request.jwt.claims = '{\"role\":\"service_role\"}'; set test.finder_key = 'ok'; set role service_role;"
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
    create table public.cargo_inbound_lines(brand_id uuid not null, id uuid not null, primary key(brand_id,id));
  `)
  for (const name of ['20260826095007_warehouse_practice', '20260909150000_warehouse_sheet_sync',
    '20260909150100_warehouse_sheet_sync_rpc', '20260909150200_warehouse_sheet_sync_service_role_grants',
    '20260909150300_warehouse_sheet_sync_replace_definer', '20260916140000_warehouse_finder_search',
    '20260916161000_warehouse_finder_location_product_kinds', '20260916183000_masma_finder_warehouse_access',
    '20260918184500_warehouse_boxes_individual', '20260921120000_warehouse_box_completion_lifecycle']) query(atelierSql(name))
  query(finderSql('20261112044306_finder_inbound_sheet').split('create function app.has_masma_finder_sheet_write_key')[0])
  query(finderSql('20261112061241_store_finder_box_qr_on_warehouse_stock'))
  for (const name of ['20261112081615_warehouse_sheet_snapshot_box_qr', '20261112101125_finder_warehouse_placement',
    '20261112125446_finder_picking_product_clear']) query(atelierSql(name))
  query(finderSql('20261112135007_finder_warehouse_background'))
  query(cargo.split('-- Only the scheduled cargo worklist')[0] + cargoSnapshot)
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
} finally {
  if (started) command('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop'], { stdio: 'ignore' })
  assert.equal(path.dirname(fixture), tempRoot)
  assert.match(path.basename(fixture), /^atelier-warehouse-guard-[0-9a-f-]{36}$/)
  if (existsSync(fixture)) rmSync(fixture, { recursive: true, force: true })
}
