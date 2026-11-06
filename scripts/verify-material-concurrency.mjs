// Two independent connections to a disposable PostgreSQL cluster.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { china, company, ids, installMaterialTestSchema } from './verify-material-request-workflow.mjs'

const bin = process.env.ATELIER_TEST_PG_BIN || 'C:/Program Files/PostgreSQL/18/bin'
const exe = name => path.join(bin, name + (process.platform === 'win32' ? '.exe' : ''))
const cluster = mkdtempSync(path.join(tmpdir(), 'atelier-material-fixture-'))
const dataDir = path.join(cluster, 'data')
const port = await new Promise((resolve, reject) => {
  const server = createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port
    server.close(() => resolve(port))
  })
})
const account = 'material_fixture'
const env = { ...process.env, PGCLIENTENCODING: 'UTF8', PGHOSTADDR: '127.0.0.1' }
const psqlArgs = ['-X', '-h', '127.0.0.1', '-p', String(port), '-U', account, '-d', 'postgres',
  '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-qAt', '-f', '-']
const timeouts = "set statement_timeout='8s'; set idle_in_transaction_session_timeout='12s';"

function command(name, args) {
  const result = spawnSync(exe(name), args, { env, windowsHide: true, stdio: 'ignore' })
  assert.equal(result.status, 0, result.error?.message ?? name + ' failed; see ' + path.join(cluster, 'postgres.log'))
}

function session(label) {
  const child = spawn(exe('psql'), psqlArgs, { env: { ...env, PGAPPNAME: label }, windowsHide: true })
  let stdout = '', stderr = ''
  child.stdout.on('data', data => { stdout += data })
  child.stderr.on('data', data => { stderr += data })
  const done = new Promise(resolve => {
    child.once('error', error => resolve({ code: -1, stdout, stderr: error.message }))
    child.once('close', code => resolve({ code, stdout, stderr }))
  })
  return { stdin: child.stdin, done, output: () => stdout }
}

function submit(sql, label = 'material-review-query') {
  const connection = session(label)
  connection.stdin.end(timeouts + '\n' + sql + '\n')
  return connection.done
}

async function run(sql) {
  const result = await submit(sql)
  assert.equal(result.code, 0, result.stderr)
  return result.stdout.trim().split(/\r?\n/).at(-1)
}

async function waitFor(check, label) {
  const deadline = Date.now() + 2_200
  while (Date.now() < deadline) {
    if (await check()) return
    await delay(30)
  }
  assert.fail('Timed out: ' + label)
}

async function race(firstSql, secondSql, rejectedState) {
  const holder = session('material-review-holder')
  const label = 'material-review-contender'
  let second
  try {
    holder.stdin.write(timeouts + '\nbegin;\n' + firstSql + "\nselect 'READY';\n")
    await waitFor(() => holder.output().includes('READY'), 'first transaction')
    second = submit(secondSql, label)
    await waitFor(async () => (await run(
      "select exists(select from pg_stat_activity where application_name='" + label + "' and wait_event_type='Lock');"
    )) === 't', 'the second transaction waiting for a lock')
  } finally {
    holder.stdin.end('commit;\n')
    const first = await holder.done
    assert.equal(first.code, 0, first.stderr)
  }
  const result = await second
  if (rejectedState) {
    assert.notEqual(result.code, 0)
    assert.match(result.stderr, new RegExp(rejectedState))
  } else assert.equal(result.code, 0, result.stderr)
}

const id = n => '61000000-0000-4000-8000-' + String(n).padStart(12, '0')
const secondManager = id(41)
const as = actor => "select set_config('request.jwt.claim.sub','" + actor + "',false); set role authenticated; "
const uuids = list => "'{" + list.join(',') + "}'::uuid[]"
const save = (actor, desired, expected) => as(actor) + (expected
  ? 'select public.save_material_nudge_recipients_checked(' + uuids(desired) + ',' + uuids(expected) + ');'
  : 'select public.save_material_nudge_recipients(' + uuids(desired) + ');')
const remove = (actor, employee) => as(actor) + "delete from public.china_work_assignees where profile_id='" + employee + "';"
const assign = (request, employee) => as(ids.manager) + "select public.write_material_request('assign','" + request + "',1,1,p_assignee=>'" + employee + "');"
const selected = () => run("select coalesce(string_agg(profile_id::text,',' order by profile_id),'') from public.material_nudge_recipients;")
const reorder = (actor, expected, ordered) => as(actor) + 'select public.save_china_work_assignee_order(' + uuids(expected) + ',' + uuids(ordered) + ');'
const rosterOrder = () => run("select string_agg(profile_id::text,',' order by sort_order,created_at,profile_id) from public.china_work_assignees;")

let started = false
try {
  command('initdb', ['-D', dataDir, '-U', account, '--encoding=UTF8', '--locale=C', '--auth-local=trust', '--auth-host=trust'])
  command('pg_ctl', ['-D', dataDir, '-l', path.join(cluster, 'postgres.log'), '-o',
    '-h 127.0.0.1 -p ' + port + ' -c shared_buffers=32MB -c max_connections=12', '-w', 'start'])
  started = true
  await installMaterialTestSchema({ exec: run })
  const people = Array.from({ length: 20 }, (_, n) => id(n + 1))
  await run("insert into public.profiles(id,company_id,status) select n,'" + company + "','active' from unnest(" + uuids(people) + ') n;')
  const [firstTen, nextTen] = [people.slice(0, 10), people.slice(10)]
  await race(save(ids.requester, firstTen, []), save(ids.colleague, nextTen, []), '40001')
  assert.equal(await selected(), firstTen.join(','))
  await run(save(ids.colleague, nextTen, firstTen))
  assert.equal(await selected(), nextTen.join(','))
  await race(save(ids.requester, firstTen, nextTen), save(ids.colleague, nextTen))
  assert.equal(await selected(), nextTen.join(','))
  console.log('PASS: checked saves reject stale settings, and legacy saves serialize without merging recipients.')

  await run("insert into public.profiles values ('" + secondManager + "','" + company + "','" + china + "','active','Second manager');"
    + "update public.department_workforce_policies set contact_ids=array_append(contact_ids,'" + secondManager + "') where department_id='" + china + "';")
  const initialOrder = [ids.worker, ids.other, ids.inactive]
  const newOrder = [ids.inactive, ids.worker, ids.other]
  const conflictingOrder = [ids.other, ids.inactive, ids.worker]
  await race(reorder(ids.manager, initialOrder, newOrder), reorder(secondManager, initialOrder, conflictingOrder), '40001')
  await run(reorder(ids.manager, initialOrder, newOrder)) // A repeated request after a lost response is safe.
  assert.equal(await rosterOrder(), newOrder.join(','))
  assert.match((await submit(reorder(ids.worker, newOrder, initialOrder))).stderr, /42501/)
  assert.match((await submit(reorder(ids.manager, newOrder, [ids.worker, ids.worker, ids.other]))).stderr, /22023/)
  assert.equal(await run(as(ids.worker) + 'with changed as (update public.china_work_assignees set sort_order=999 returning 1) select count(*) from changed;'), '0')
  const addToRoster = actor => as(actor) + "insert into public.china_work_assignees(company_id,profile_id,sort_order) values ('" + company + "','" + secondManager + "',4);"
  assert.match((await submit(addToRoster(ids.worker))).stderr, /42501/)
  await run(addToRoster(ids.manager))
  await run(remove(ids.manager, secondManager))
  await run(reorder(ids.manager, newOrder, initialOrder))
  assert.equal(await rosterOrder(), initialOrder.join(','))
  console.log('PASS: manager roster order is atomic, stale changes conflict, and workers cannot add or reorder directly.')
  for (const request of [id(31), id(32)]) {
    await run("insert into app.material_requests(id,company_id,owner_id,title,status) values ('" + request + "','" + company + "','" + ids.requester + "','Fixture','requested');"
      + "insert into app.material_request_rounds(request_id,round_no,title,blocks,reviewed_at) values ('" + request + "',1,'Fixture','[]',now());")
  }
  await race(assign(id(31), ids.worker), remove(secondManager, ids.worker), '23503')
  await race(remove(secondManager, ids.other), assign(id(32), ids.other), '40001')
  assert.equal(await run("select assignee_id from app.material_request_rounds where request_id='" + id(31) + "';"), ids.worker)
  assert.equal(await run("select assignee_id is null from app.material_request_rounds where request_id='" + id(32) + "';"), 't')
  console.log('PASS: concurrent material assignment and roster removal are safe in both commit orders.')

  const order = { id: 'sample', url: 'https://fixture.invalid/sample', name: 'sample', originCountry: '중국' }
  const revision = '2026-11-06T00:00:00Z'
  await run("insert into public.china_work_assignees(company_id,profile_id,sort_order) values ('" + company + "','" + ids.other + "',2);"
    + "insert into public.product_drafts(id,company_id,status,origin_country,updated_at,sample_work_orders,specs) values ('"
    + id(33) + "','" + company + "','open','중국','" + revision + "','" + JSON.stringify([order]) + "','{}');")
  const sampleAssign = as(ids.manager) + "select app.china_work_order('" + id(33) + "','sample','sample','assign','" + ids.other + "','" + revision + "');"
  await race(sampleAssign, remove(secondManager, ids.other), '23503')
  assert.equal(await run("select sample_open from app.china_assignee_workloads('" + company + "','" + ids.other + "');"), '1')
  await run("update public.product_drafts set sample_work_orders=jsonb_set(sample_work_orders,'{0,shipped}','true') where id='" + id(33) + "';")
  assert.equal(await run("select sample_resting from app.china_assignee_workloads('" + company + "','" + ids.other + "');"), '1')
  const waiting = await submit(remove(secondManager, ids.other))
  assert.match(waiting.stderr, /23503/)
  await run("update public.product_drafts set status='confirmed' where id='" + id(33) + "';")
  await run(remove(secondManager, ids.other))
  assert.equal(await run("select sample_work_orders->0->>'assigneeId' from public.product_drafts where id='" + id(33) + "';"), ids.other)
  console.log('PASS: sample assignment/removal serialize; shipment remains pending and completion preserves assignee history.')
} finally {
  if (started) command('pg_ctl', ['-D', dataDir, '-m', 'fast', '-w', 'stop'])
}
