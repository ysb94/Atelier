// Disposable, loopback-only PostgreSQL cluster; never connects to an existing DB.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'

const bin = process.env.ATELIER_TEST_PG_BIN || 'C:/Program Files/PostgreSQL/18/bin'
const exe = name => path.join(bin, `${name}${process.platform === 'win32' ? '.exe' : ''}`)
for (const name of ['initdb', 'pg_ctl', 'psql']) assert.ok(existsSync(exe(name)), `Missing ${exe(name)}`)
const fixtureDir = path.resolve(tmpdir(), `atelier-leave-read-fixture-${randomUUID()}`)
const dataDir = path.join(fixtureDir, 'data')
mkdirSync(fixtureDir, { recursive: true })
writeFileSync(path.join(fixtureDir, 'owner'), 'atelier-leave-read-concurrency\n')
const port = await new Promise((resolve, reject) => {
  const server = createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => { const value = server.address().port; server.close(() => resolve(value)) })
})
const env = { ...process.env, PGCLIENTENCODING: 'UTF8' }
const args = ['-X', '-h', '127.0.0.1', '-p', String(port), '-U', 'leave_fixture', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-q', '-A', '-t', '-f', '-']
const employee = '10000000-0000-4000-8000-000000000001'
const company = 'e0000000-0000-4000-8000-000000000001'
const grant = '20000000-0000-4000-8000-000000000001'
const lock = `select pg_advisory_xact_lock(hashtextextended('${employee}',0))`
const birthday = `select app.ensure_employee_birthday_leave('${employee}','2026-10-29')`
const expiry = `select app.record_leave_expiry('${employee}','2026-10-29')`
const timeout = "set statement_timeout='8s';set idle_in_transaction_session_timeout='20s';"
let started = false
function command(name, commandArgs) {
  const p = spawnSync(exe(name), commandArgs, { encoding: 'utf8', env, windowsHide: true, maxBuffer: 4 * 1024 * 1024, ...(name === 'pg_ctl' ? { stdio: 'ignore' } : {}) })
  assert.equal(p.status, 0, `${name}: ${p.error?.message || p.stderr || p.stdout}`)
  return p.stdout?.trim() || ''
}
function raw(sql) { return spawnSync(exe('psql'), args, { encoding: 'utf8', input: timeout + sql, env, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }) }
function run(sql) {
  const p = raw(sql)
  assert.equal(p.status, 0, p.error?.message || p.stderr)
  return p.stdout.trim().split(/\r?\n/).at(-1) || ''
}
function pending(sql) {
  const child = spawn(exe('psql'), args, { env, windowsHide: true })
  let stdout = '', stderr = ''
  child.stdout.on('data', data => { stdout += data }); child.stderr.on('data', data => { stderr += data })
  const done = new Promise((resolve, reject) => {
    child.once('error', reject); child.once('exit', code => resolve({ code, stdout, stderr }))
  })
  child.stdin.end(timeout + sql)
  return done
}
async function held(sql, verify, commit = false) {
  const holder = spawn(exe('psql'), args, { env, windowsHide: true })
  let stdout = '', stderr = ''
  const done = new Promise((resolve, reject) => { holder.once('error', reject); holder.once('exit', code => resolve({ code, stderr })) })
  holder.stderr.on('data', data => { stderr += data })
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Holder not ready: ${stderr}`)), 5000)
    holder.stdout.on('data', data => { stdout += data; if (stdout.includes('LOCK_READY')) { clearTimeout(timer); resolve() } })
    holder.once('error', error => { clearTimeout(timer); reject(error) })
  })
  holder.stdin.write(`${timeout}begin;${sql};select 'LOCK_READY';\n`)
  try { await ready; await verify(holder) }
  finally { holder.stdin.end(commit ? 'commit;\n' : 'rollback;\n'); const result = await done; assert.equal(result.code, 0, result.stderr) }
}
async function waitForLocks(count) {
  for (let n = 0; n < 30; n++) {
    if (Number(run("select count(*) from pg_stat_activity where wait_event_type='Lock' and wait_event='advisory'")) === count) return
    await new Promise(resolve => setTimeout(resolve, 30))
  }
  assert.fail(`${count} callers did not wait for the employee lock`)
}
const source = file => readFileSync(file, 'utf8')
const extract = (text, name) => {
  const sql = text.match(new RegExp(`create(?: or replace)? function app\\.${name}\\([\\s\\S]*?end \\$\\$;`, 'i'))?.[0]
  assert.ok(sql, `Missing ${name}`)
  return sql.replace(/^create function/i, 'create or replace function')
}
const migration = source('supabase/migrations/20261104061531_leave_read_reconciliation_efficiency.sql')
const originalBirthday = extract(source('supabase/migrations/20261029113532_employee_birthday_leave.sql'), 'ensure_employee_birthday_leave')
const originalExpiry = extract(source('supabase/migrations/20261029110752_leave_fefo_expiry_history.sql'), 'record_leave_expiry')
const optimizedBirthday = extract(migration, 'ensure_employee_birthday_leave')
const optimizedExpiry = extract(migration, 'record_leave_expiry')
function reset() {
  run(`truncate app.employee_extra_leave,app.leave_lifecycle_events,app.leave_base_periods,app.leave_balance_entries,app.employee_extra_leave_usage;
    update public.profiles set status='active';update public.employee_roster set resident_id='901105',resigned_on=null;`)
}
function seedExpired() {
  run(`insert into app.employee_extra_leave(id,employee_id,company_id,days,granted_on,expires_on,note,grant_source)
    values('${grant}','${employee}','${company}',2,'2026-10-01','2026-10-28','LOCAL ONLY','manual')`)
}
try {
  command('initdb', ['-D', dataDir, '-U', 'leave_fixture', '--encoding=UTF8', '--locale=C', '--auth-local=trust', '--auth-host=trust'])
  command('pg_ctl', ['-D', dataDir, '-l', path.join(fixtureDir, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -c shared_buffers=32MB -c max_connections=12`, '-w', 'start'])
  started = true
  assert.equal(path.resolve(run('show data_directory;')).toLowerCase(), dataDir.toLowerCase(), 'Unexpected cluster; refusing writes')
  run(`create schema app;create schema auth;create function auth.uid() returns uuid language sql as $$select null::uuid$$;
    create table profiles(id uuid primary key,company_id uuid,status text);
    create table employee_roster(profile_id uuid primary key,company_id uuid,resident_id text,resigned_on date);
    create table app.employee_extra_leave(id uuid primary key,employee_id uuid,company_id uuid,days numeric,granted_on date,expires_on date,note text,created_by uuid,updated_by uuid,grant_source text,birthday_year int,deleted_at timestamptz);
    create unique index birthday_once on app.employee_extra_leave(employee_id,birthday_year) where grant_source='birthday';
    create table app.leave_lifecycle_events(id uuid default gen_random_uuid(),employee_id uuid,company_id uuid,source_kind text,source_key text,kind text,days numeric,effective_on date,actor_id uuid,details jsonb);
    create table app.leave_base_periods(employee_id uuid,company_id uuid,period_key text,ends_on date,opening_days numeric);
    create table app.leave_balance_entries(employee_id uuid,allocations jsonb,refunded_at timestamptz);
    create table app.employee_extra_leave_usage(grant_id uuid,days numeric,refunded_at timestamptz);
    insert into profiles values('${employee}','${company}','active');insert into employee_roster values('${employee}','${company}','901105',null);`)
  run(extract(source('supabase/migrations/20261029113532_employee_birthday_leave.sql'), 'birthday_in_year') + optimizedBirthday + optimizedExpiry)
  reset()
  let requests
  await held(lock, async () => { requests = [pending(birthday), pending(birthday)]; await waitForLocks(2) })
  for (const result of await Promise.all(requests)) assert.equal(result.code, 0, result.stderr)
  assert.equal(Number(run('select count(*) from app.employee_extra_leave')), 1)
  assert.equal(Number(run("select count(*) from app.leave_lifecycle_events where kind='granted'")), 1)
  console.log('PASS: simultaneous birthday requests produce one grant and one event')

  // A different transaction changes eligibility while the caller is waiting.
  reset()
  let waiting
  await held(`${lock};update profiles set status='pending' where id='${employee}'`, async () => { waiting = pending(birthday); await waitForLocks(1) }, true)
  assert.equal((await waiting).code, 0)
  assert.equal(Number(run('select count(*) from app.employee_extra_leave')), 0)
  console.log('PASS: birthday eligibility is reread after lock wait')

  reset(); seedExpired()
  await held(lock, async () => { requests = [pending(expiry), pending(expiry)]; await waitForLocks(2) })
  for (const result of await Promise.all(requests)) assert.equal(result.code, 0, result.stderr)
  assert.equal(Number(run("select count(*) from app.leave_lifecycle_events where kind='expired'")), 1)
  assert.equal(Number(run('select sum(days) from app.leave_lifecycle_events')), -2)
  console.log('PASS: simultaneous expiry reconciliation produces one delta')

  reset(); seedExpired()
  await held(`${lock};update app.employee_extra_leave set days=1 where id='${grant}'`, async () => { waiting = pending(expiry); await waitForLocks(1) }, true)
  assert.equal((await waiting).code, 0)
  assert.equal(Number(run('select sum(days) from app.leave_lifecycle_events')), -1, 'Expiry must use new, not pre-lock remaining credit')
  console.log('PASS: expiry recalculates the remaining credit after lock wait')

  // Baseline no-op reads wait for an unrelated transaction's employee lock.
  // Optimized reads complete with the same values while the holder remains open.
  reset(); run(birthday); seedExpired(); run(expiry)
  for (const [label, original, optimized, query] of [
    ['birthday', originalBirthday, optimizedBirthday, birthday], ['expiry', originalExpiry, optimizedExpiry, expiry],
  ]) {
    await held(lock, async () => {
      run(original)
      const blocked = raw(`set statement_timeout='350ms';${query}`)
      assert.notEqual(blocked.status, 0); assert.match(blocked.stderr, /57014/)
      run(optimized)
      const finished = raw(`set statement_timeout='350ms';${query}`)
      assert.equal(finished.status, 0, finished.stderr)
    })
    console.log(`PASS: settled ${label} read returns immediately under an employee lock; baseline times out`)
  }
  assert.equal(Number(run('select count(*) from app.employee_extra_leave')), 2)
  assert.equal(Number(run('select count(*) from app.leave_lifecycle_events')), 2)

  // Cross-employee lock order regression. Use the actual two management getter
  // definitions. The fixture refresh keeps their real per-employee lock order;
  // monetary/summary calculations are covered by the full PGlite regression.
  const peer = '10000000-0000-4000-8000-000000000002'
  run(`alter table profiles add column hire_date date default '2024-01-01',add column display_name text default 'LOCAL ONLY';
    alter table app.employee_extra_leave add column created_at timestamptz default now(),add column version integer default 1;
    alter table app.leave_lifecycle_events add column created_at timestamptz default now();
    create table app.employee_leave_accrual(employee_id uuid,hire_date date);
    create table app.leave_advance_events(id uuid,employee_id uuid,company_id uuid,kind text,days numeric,source_key text,target_key text,request_id uuid,note text,actor_id uuid,created_at timestamptz);
    create or replace function auth.uid() returns uuid language sql as $$select '${employee}'::uuid$$;
    create function app.can_edit_org_assignment() returns boolean language sql as $$select true$$;
    create function app.basic_work_allowed(text) returns boolean language sql as $$select false$$;
    create function app.extra_leave_available(uuid,date) returns numeric language sql as $$select 0::numeric$$;
    create function app.leave_past_shortfall(uuid,date) returns numeric language sql as $$select 0::numeric$$;
    create function app.leave_advance_summary(uuid) returns jsonb language sql as $$select jsonb_build_object('employeeId',$1)$$;
    create function app.refresh_employee_leave(p_employee uuid,p_today date) returns void language plpgsql security definer set search_path='' as $$begin
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_employee::text,0));
      perform app.ensure_employee_birthday_leave(p_employee,p_today);
      perform app.record_leave_expiry(p_employee,p_today);
    end$$;
    insert into profiles(id,company_id,status) values('${peer}','${company}','active');
    insert into employee_roster values('${peer}','${company}','901105',null);
    insert into app.employee_leave_accrual select id,hire_date from profiles;`)
  const fixedGetter = extract(migration, 'employee_extra_leave_records')
    .replaceAll("(now() at time zone 'Asia/Seoul')::date", "date '2026-10-29'")
  // Deliberately recreate the rejected two-loop version as a regression control.
  const unsafeGetter = fixedGetter.replace('   perform app.record_leave_expiry(employee.id,today);',
    " end loop;\n for employee in select p.id from public.profiles p where p.company_id=company and p.status='active' order by p.id loop\n   perform app.record_leave_expiry(employee.id,today);")
  assert.notEqual(unsafeGetter, fixedGetter)
  run(extract(source('supabase/migrations/20261102035701_employee_leave_advances.sql'), 'employee_leave_advances')
    .replaceAll("(now() at time zone 'Asia/Seoul')::date", "date '2026-10-29'"))
  for (const [label, definition] of [['unsafe', unsafeGetter], ['fixed', fixedGetter]]) {
    reset(); seedExpired()
    run(`update employee_roster set resident_id='900501' where profile_id='${employee}';` + definition)
    let getter, holderFailure = null
    try {
      // A is the first employee locked by the other manager's refresh. Resume
      // that connection through its real ordered manager loop after the getter
      // is waiting. The broken getter already owns B; the fixed one does not.
      await held(lock, async holder => {
        getter = pending('select app.employee_extra_leave_records();')
        await waitForLocks(1)
        assert.equal(Number(run("select count(*) from pg_locks where locktype='advisory' and granted")), label === 'unsafe' ? 2 : 1)
        holder.stdin.write('select app.employee_leave_advances(true);\n')
      }, true)
    } catch (error) { holderFailure = error }
    assert.ok(getter, 'Management getter was started')
    const getterResult = await getter
    if (label === 'unsafe') {
      assert.match(`${holderFailure?.message ?? ''}\n${getterResult.stderr}`, /40P01/, 'Two-loop regression must reproduce an actual deadlock')
      console.log('PASS: rejected two-loop getter reproduces cross-employee deadlock against management advance refresh')
    } else {
      assert.equal(holderFailure, null, holderFailure?.message)
      assert.equal(getterResult.code, 0, getterResult.stderr)
      assert.equal(Number(run(`select count(*) from app.employee_extra_leave where employee_id='${peer}' and grant_source='birthday'`)), 1)
      assert.equal(Number(run("select count(*) from app.leave_lifecycle_events where kind='granted'")), 1)
      assert.equal(Number(run("select count(*) from app.leave_lifecycle_events where kind='expired'")), 1)
      assert.equal(Number(run("select sum(days) from app.leave_lifecycle_events where kind='expired'")), -2)
      console.log('PASS: one UUID-ordered loop completes both management calls with exactly one birthday grant and expiry delta')
    }
  }
  console.log(`leave-read-concurrency: eight real PostgreSQL checks passed (${run('show server_version;')}); only disposable local data used`)
} finally {
  if (started) command('pg_ctl', ['-D', dataDir, '-m', 'fast', '-w', 'stop'])
}
