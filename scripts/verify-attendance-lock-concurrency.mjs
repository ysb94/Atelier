// Real two-connection PostgreSQL verification. Never connects to an existing DB.
// Requires PostgreSQL binaries (ATELIER_TEST_PG_BIN overrides the Windows default).
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
// PostgreSQL on Windows writes non-ASCII data paths in the OS code page. Keep only
// disposable database files in the system temporary directory; sources stay here.
const fixtureDir = path.resolve(tmpdir(), `atelier-attendance-lock-fixture-${randomUUID()}`)
const dataDir = path.join(fixtureDir, 'data')
mkdirSync(fixtureDir, { recursive: true })
writeFileSync(path.join(fixtureDir, 'owner'), 'atelier-attendance-lock-concurrency\n')
const port = await new Promise((resolve, reject) => {
  const server = createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => { const value = server.address().port; server.close(() => resolve(value)) })
})
const env = { ...process.env, PGCLIENTENCODING: 'UTF8' }
// A marked, newly created cluster and a loopback-only random port prevent accidental live writes.
const args = ['-X', '-h', '127.0.0.1', '-p', String(port), '-U', 'attendance_fixture', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-q', '-A', '-t', '-f', '-']
const staff = '10000000-0000-4000-8000-000000000001', peer = '10000000-0000-4000-8000-000000000002'
const company = 'e0000000-0000-4000-8000-000000000001', department = '20000000-0000-4000-8000-000000000001'
const today = "(clock_timestamp() at time zone 'Asia/Seoul')::date"
const auth = `select set_config('request.jwt.claim.sub','${staff}',false); set role authenticated;`
const migration = 'supabase/migrations/20261102101948_attendance_lock_contention_guard.sql'
const sqlFile = file => readFileSync(file, 'utf8')
const timeout = "set statement_timeout='8s'; set idle_in_transaction_session_timeout='20s';"
let started = false
function command(name, commandArgs) {
  // On Windows, the server can inherit pg_ctl's pipes; don't wait for its stdout EOF.
  const p = spawnSync(exe(name), commandArgs, { encoding: 'utf8', env, windowsHide: true, maxBuffer: 8 * 1024 * 1024, ...(name === 'pg_ctl' ? { stdio: 'ignore' } : {}) })
  assert.equal(p.status, 0, `${name}: ${p.error?.message || p.stderr || p.stdout}`)
  return p.stdout?.trim() || ''
}
function raw(sql) {
  return spawnSync(exe('psql'), args, { encoding: 'utf8', input: timeout + sql, env, windowsHide: true, maxBuffer: 8 * 1024 * 1024 })
}
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
    child.once('error', reject)
    child.once('exit', code => resolve({ code, stdout, stderr }))
  })
  child.stdin.end(timeout + sql)
  return done
}
async function held(sql, verify) {
  const holder = spawn(exe('psql'), args, { env, windowsHide: true })
  let stdout = '', stderr = ''
  const done = new Promise((resolve, reject) => { holder.once('error', reject); holder.once('exit', code => resolve({ code, stderr })) })
  holder.stderr.on('data', data => { stderr += data })
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Holder did not acquire lock: ${stderr}`)), 5000)
    holder.stdout.on('data', data => { stdout += data; if (stdout.includes('LOCK_READY')) { clearTimeout(timer); resolve() } })
    holder.once('error', error => { clearTimeout(timer); reject(error) })
  })
  holder.stdin.write(`${timeout}begin; ${sql}; select 'LOCK_READY';\n`)
  try { await ready; await verify() }
  finally { holder.stdin.end('rollback;\n'); const result = await done; assert.equal(result.code, 0, result.stderr) }
}
const employeeLock = `select pg_advisory_xact_lock(hashtextextended('${staff}',0))`
function reset() {
  run('truncate app.attendance_presence_checks,app.attendance_presence_sessions,app.offsite_attendance_events,app.offsite_attendance_days,public.attendance_clock_ins,public.company_leave_requests cascade;')
}
function seedPresence(date = `${today}-1`) {
  reset()
  run(`insert into public.attendance_clock_ins(company_id,employee_id,work_date,clock_in)
    values('${company}','${staff}',${date},'00:00'),('${company}','${peer}',${date},'00:00');
    select app.advance_attendance_presence(id,((work_date+time '08:09') at time zone 'Asia/Seoul')) from public.attendance_clock_ins;
    update app.attendance_presence_sessions set next_prompt_at=clock_timestamp()-interval '1 minute';`)
}
function checkCount(employee) { return Number(run(`select count(*) from app.attendance_presence_checks q join public.attendance_clock_ins c on c.id=q.clock_id where c.employee_id='${employee}'`)) }
function businessHash() {
  return run("select md5(jsonb_build_object('clocks',(select jsonb_agg(c order by id) from public.attendance_clock_ins c),'sessions',(select jsonb_agg(s order by clock_id) from app.attendance_presence_sessions s),'checks',(select jsonb_agg(q order by id) from app.attendance_presence_checks q),'days',(select jsonb_agg(d order by employee_id,work_date) from app.offsite_attendance_days d),'events',(select jsonb_agg(e order by id) from app.offsite_attendance_events e))::text)")
}
function lockFailure(sql, friendly = true) {
  const before = businessHash(), at = Date.now(), p = raw(auth + sql)
  assert.notEqual(p.status, 0, 'Contended user action must not report success')
  assert.match(p.stderr, /55P03/, p.stderr)
  if (friendly) assert.match(p.stderr, /다른 근태 처리가 진행 중/, p.stderr)
  assert.ok(Date.now() - at < 5500, 'User request must have a bounded wait')
  assert.equal(businessHash(), before, 'Failed user action changed attendance data')
}

try {
  command('initdb', ['-D', dataDir, '-U', 'attendance_fixture', '--encoding=UTF8', '--locale=C', '--auth-local=trust', '--auth-host=trust'])
  command('pg_ctl', ['-D', dataDir, '-l', path.join(fixtureDir, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -c shared_buffers=32MB -c max_connections=12`, '-w', 'start'])
  started = true
  assert.equal(path.resolve(run('show data_directory;')).toLowerCase(), dataDir.toLowerCase(), 'Refusing to modify an unexpected database directory')
  let fixture = sqlFile('scripts/verify-offsite-attendance-db.mjs').match(/await db\.exec\(`([\s\S]*?)`\)/)?.[1]
  assert.ok(fixture, 'Reusable isolated fixture not found')
  fixture = fixture.replaceAll('${staff}', staff).replaceAll('${peer}', peer).replaceAll('${company}', company)
    .replace('clock_out_reported_at timestamptz,auto_closed_at timestamptz,work_confirmed_at timestamptz,', '')
    .replace(/create function app\.attendance_presence_end\(uuid\)[\s\S]*?\$\$;/, '')
    .replace(/create function app\.process_attendance_presence\(\)[\s\S]*?\$\$;/, '')
  run(fixture + `create schema cron;
    create table cron.job(jobname text,schedule text,command text);
    create function cron.schedule(text,text,text) returns bigint language sql as $$insert into cron.job values($1,$2,$3);select 1::bigint$$;
    create table public.attendance_start_settings(id uuid primary key,company_id uuid,month date,department_id uuid,employee_id uuid,start_time time,updated_at timestamptz);
    create table public.company_work_hours(company_id uuid primary key,lunch_start time,lunch_end time);
    update public.profiles set department_id='${department}';
    insert into public.company_work_hours values('${company}','12:00','13:00');
    insert into public.attendance_start_settings values(gen_random_uuid(),'${company}',date_trunc('month',${today})::date,'${department}',null,'00:00',now());
    insert into public.attendance_start_settings values(gen_random_uuid(),'${company}',date_trunc('month',${today}-1)::date,'${department}',null,'00:00',now()) on conflict do nothing;
    insert into app.leave_balance_calendar_years values(extract(year from ${today})::integer) on conflict do nothing;`)
  const clockOut = sqlFile('supabase/migrations/20261012034832_attendance_clock_out.sql').match(/create function app\.clock_out_today\(\)[\s\S]*?\$\$\s*;/i)?.[0]
  assert.ok(clockOut)
  run(clockOut)
  for (const file of ['20261026103425_attendance_previous_checkout.sql', '20261029130013_attendance_presence_confirmation.sql', '20261012081000_undo_clock_out_today.sql', '20261102063022_offsite_attendance_automation.sql']) run(sqlFile(`supabase/migrations/${file}`))
  const baseline = run('select md5(jsonb_agg(p order by id)::text) from public.profiles p')
  run(sqlFile(migration))
  assert.equal(run('select md5(jsonb_agg(p order by id)::text) from public.profiles p'), baseline)
  run(`update app.offsite_attendance_config set activated_at=((${today}-2)::timestamp at time zone 'Asia/Seoul')`)

  // One employee's lease must not block the rest of the company or lose deferred work.
  reset()
  run(`insert into public.company_leave_requests(company_id,employee_id,kind,from_date,to_date,start_time,end_time,status,created_at)
    select '${company}',id,'offsite',${today}-1,${today}-1,'00:00','23:59','approved',((${today}-2)::timestamp at time zone 'Asia/Seoul') from public.profiles;`)
  await held(employeeLock, async () => {
    const at = Date.now(); run('select app.process_attendance_presence();')
    assert.ok(Date.now() - at < 1500, 'Scheduled worker waited for a busy employee')
    assert.equal(Number(run(`select count(*) from public.attendance_clock_ins where employee_id='${staff}'`)), 0)
    assert.equal(Number(run(`select count(*) from app.offsite_attendance_events where employee_id='${peer}' and action='auto_out'`)), 1)
  })
  run('select app.process_attendance_presence(); select app.process_attendance_presence();')
  assert.equal(Number(run("select count(*) from app.offsite_attendance_events where action='auto_out'")), 2)
  console.log('PASS: busy offsite employee deferred, peer processed, next run catches up once')

  seedPresence()
  await held(employeeLock, async () => { run('select app.process_attendance_presence();'); assert.equal(checkCount(staff), 0); assert.equal(checkCount(peer), 1) })
  run('select app.process_attendance_presence(); select app.process_attendance_presence();')
  assert.equal(checkCount(staff), 1); assert.equal(checkCount(peer), 1)
  console.log('PASS: presence worker skips employee lock and retries without duplicate prompts')

  seedPresence()
  await held(`select id from public.attendance_clock_ins where employee_id='${staff}' for update`, async () => {
    const at = Date.now(); run('select app.process_attendance_presence();')
    assert.ok(Date.now() - at < 1500, 'Row-only contention blocked the batch')
    assert.equal(checkCount(staff), 0); assert.equal(checkCount(peer), 1)
    assert.equal(run(`select pg_try_advisory_xact_lock(hashtextextended('${staff}',0))`), 't', 'Failed row subtransaction leaked the employee lock')
  })
  run('select app.process_attendance_presence();'); assert.equal(checkCount(staff), 1)
  console.log('PASS: row-only lock has bounded wait, releases lease, and later catches up')

  for (const action of ['poll', 'present', 'continue', 'clock_out']) {
    seedPresence(today)
    const poll = JSON.parse(run(auth + 'select public.my_attendance_presence();'))
    assert.ok(poll.check?.id)
    if (['continue', 'clock_out'].includes(action)) run(auth + `select public.my_attendance_presence('present','${poll.check.id}');`)
    await held(employeeLock, () => lockFailure(`select public.my_attendance_presence('${action}','${poll.check.id}');`))
    console.log(`PASS: contended ${action} returns explicit failure with no partial writes`)
  }
  seedPresence(today)
  let simultaneous
  await held(employeeLock, async () => {
    simultaneous = [pending(auth + 'select public.my_attendance_presence();'), pending(auth + 'select public.my_attendance_presence();')]
    for (let i = 0; i < 10; i++) {
      if (Number(run("select count(*) from pg_stat_activity where wait_event_type='Lock' and wait_event='advisory'")) === 2) break
      await new Promise(resolve => setTimeout(resolve, 30))
    }
    assert.equal(Number(run("select count(*) from pg_stat_activity where wait_event_type='Lock' and wait_event='advisory'")), 2)
  })
  for (const result of await Promise.all(simultaneous)) assert.equal(result.code, 0, result.stderr)
  assert.equal(checkCount(staff), 1, 'Concurrent polls created duplicate presence prompts')
  console.log('PASS: two simultaneous poll requests serialize and create one prompt')

  for (const action of ['clock_in_today', 'clock_out_today', 'undo_clock_out_today']) {
    seedPresence(today)
    if (action === 'undo_clock_out_today') run(auth + 'select app.clock_out_today();')
    await held(employeeLock, () => lockFailure(`select app.${action}();`, false))
    console.log(`PASS: contended ${action} has a bounded failure without attendance changes`)
  }
  seedPresence(today)
  run(`insert into public.attendance_clock_ins(company_id,employee_id,work_date,clock_in) values('${company}','${staff}',${today}-1,'00:00')`)
  await held(employeeLock, () => lockFailure(`select public.confirm_previous_clock_out(${today}-1,((${today}-1+time '18:00') at time zone 'Asia/Seoul'));`, false))
  console.log('PASS: contended previous checkout fails without overwriting either workday')

  reset()
  run(`insert into public.attendance_clock_ins(company_id,employee_id,work_date,clock_in) values('${company}','${staff}',${today},'00:00');
    insert into public.company_leave_requests(company_id,employee_id,kind,from_date,to_date,start_time,end_time,status,created_at)
    values('${company}','${staff}','offsite',${today},${today},'00:00','23:59','approved',((${today}-1)::timestamp at time zone 'Asia/Seoul'));`)
  assert.equal(JSON.parse(run(auth + 'select public.my_offsite_attendance();')).state, 'offsite')
  await held(employeeLock, () => lockFailure('select public.return_from_offsite();'))
  assert.equal(JSON.parse(run(auth + 'select public.return_from_offsite();')).state, 'returned')
  assert.equal(Number(run("select count(*) from app.offsite_attendance_events where action='return'")), 1)
  console.log('PASS: contended return does not claim success; retry records one return')
  console.log(`Real PostgreSQL attendance concurrency checks passed (${run('show server_version;')}).`)
} finally {
  if (started) command('pg_ctl', ['-D', dataDir, '-m', 'fast', '-w', 'stop'])
}
