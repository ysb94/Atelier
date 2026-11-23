import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'

const db = await PGlite.create()
const ids = Object.fromEntries(['owner', 'worker', 'peer', 'otherDept', 'outsider', 'inactive', 'company', 'otherCompany',
  'department', 'otherDepartment'].map(key => [key, randomUUID()]))

async function actor(id, role = 'authenticated') {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id])
  await db.exec(role === 'anon' ? 'set role anon' : 'set role authenticated')
}

async function action(id, actionName, fields = {}) {
  const { command = randomUUID(), revision = null, title = null, description = null,
    assignee = null, reviewer = null, note = null } = fields
  await db.query('select public.personal_work_action($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [id, command, actionName, revision, title, description, assignee, reviewer, note])
}

async function list() {
  return (await db.query('select public.list_personal_work_cards() as cards')).rows[0].cards
}

async function card(id) {
  return (await list()).find(item => item.id === id)
}

try {
  await db.exec(`
    create role authenticated;
    create role anon;
    create role service_role;
    create schema app;
    create schema auth;
    grant usage on schema app to authenticated;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    create table public.companies (id uuid primary key);
    create table public.departments (id uuid primary key, name text);
    create table public.profiles (id uuid primary key, company_id uuid references public.companies(id),
      department_id uuid references public.departments(id), display_name text, position text, status text);
    create function app.is_approved() returns boolean language sql stable security definer as $$
      select exists(select 1 from public.profiles where id = auth.uid() and status = 'active');
    $$;
    create function app.is_company_manager() returns boolean language sql stable as $$ select false; $$;
    create function public.set_updated_at() returns trigger language plpgsql as $$
      begin new.updated_at := now(); return new; end;
    $$;
    create publication supabase_realtime;
  `)
  for (const id of [ids.company, ids.otherCompany]) await db.query('insert into public.companies values ($1)', [id])
  for (const id of [ids.department, ids.otherDepartment]) await db.query("insert into public.departments values ($1, '테스트')", [id])
  for (const name of ['owner', 'worker', 'peer', 'otherDept', 'outsider', 'inactive']) {
    await db.query("insert into public.profiles values ($1,$2,$3,$4,'사원',$5)", [ids[name],
      name === 'outsider' ? ids.otherCompany : ids.company,
      name === 'otherDept' ? ids.otherDepartment : ids.department, name, name === 'inactive' ? 'inactive' : 'active'])
  }
  for (const migration of ['20260930160000_company_chat.sql', '20261123090000_personal_work_cards.sql']) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${migration}`, import.meta.url), 'utf8'))
  }

  const assigned = randomUUID(), personal = randomUUID(), createCommand = randomUUID()
  await actor(ids.owner)
  const { rows } = await db.query('select public.list_personal_work_members() as members')
  assert.deepEqual(rows[0].members.map(member => member.id).sort(), [ids.peer, ids.worker].sort())
  for (const assignee of [ids.otherDept, ids.outsider, ids.inactive]) {
    await assert.rejects(action(randomUUID(), 'create', { title: '금지 배정', assignee }), { code: '42501' })
  }
  await assert.rejects(db.query('select * from app.personal_work_cards'), { code: '42501' })
  await action(assigned, 'create', { title: '부서 업무', assignee: ids.worker, command: createCommand })
  await action(assigned, 'create', { title: '부서 업무', assignee: ids.worker, command: createCommand })
  assert.equal((await card(assigned)).reviewer_id, ids.owner)
  await action(personal, 'create', { title: '내 업무' })
  await action(personal, 'start', { revision: 1 })
  await action(personal, 'complete', { revision: 2 })
  assert.equal((await card(personal)).status, 'done')
  const rolledBack = randomUUID()
  await assert.rejects(action(rolledBack, 'create', { title: '채팅 저장에 실패한 업무', assignee: ids.worker, command: createCommand }), { code: '23505' })
  assert.equal(await card(rolledBack), undefined)

  await actor(ids.worker)
  await assert.rejects(action(assigned, 'delete', { revision: 1 }), { code: '42501' })
  await action(assigned, 'start', { revision: 1 })
  await action(assigned, 'pause', { revision: 2 })
  await action(assigned, 'start', { revision: 3 })
  assert.equal((await card(assigned)).round, 1)
  assert.deepEqual((await card(assigned)).events.map(event => event.kind), ['started', 'paused', 'resumed'])
  await assert.rejects(action(assigned, 'pause', { revision: 2 }), { code: '40001' })
  await assert.rejects(action(assigned, 'complete', { revision: 4 }), { code: '42501' })
  const submitCommand = randomUUID()
  await action(assigned, 'submit', { revision: 4, reviewer: ids.peer, command: submitCommand })
  await action(assigned, 'submit', { revision: 4, reviewer: ids.peer, command: submitCommand })
  assert.equal((await card(assigned)).reviewer_id, ids.owner)
  await assert.rejects(action(assigned, 'approve', { revision: 5 }), { code: '42501' })

  await actor(ids.peer)
  assert.deepEqual(await list(), [])
  await assert.rejects(action(assigned, 'approve', { revision: 5 }), { code: '42501' })
  for (const id of [ids.outsider, ids.inactive]) {
    await actor(id)
    assert.deepEqual(await list(), [])
    await assert.rejects(action(assigned, 'approve', { revision: 5 }), { code: '42501' })
  }
  await actor(ids.owner, 'anon')
  await assert.rejects(list(), { code: '42501' })

  await actor(ids.owner)
  await assert.rejects(action(assigned, 'revise', { revision: 5 }), { code: '22023' })
  await action(assigned, 'revise', { revision: 5, note: '수정할 내용' })
  assert.deepEqual([(await card(assigned)).status, (await card(assigned)).round], ['todo', 2])
  await actor(ids.worker)
  await action(assigned, 'start', { revision: 6 })
  await action(assigned, 'submit', { revision: 7 })

  await actor(ids.owner)
  await action(assigned, 'approve', { revision: 8 })
  const completed = await card(assigned)
  assert.equal(completed.status, 'done')
  assert.deepEqual(completed.events.map(event => [event.round, event.kind]), [
    [1, 'started'], [1, 'paused'], [1, 'resumed'], [1, 'submitted'], [1, 'revision_requested'],
    [2, 'started'], [2, 'submitted'], [2, 'approved'],
  ])
  assert.ok(completed.events.every((event, index, history) => index === 0 || Date.parse(event.at) >= Date.parse(history[index - 1].at)))

  await db.exec('reset role')
  const messages = (await db.query('select author_id, body from public.chat_messages')).rows
  assert.equal(messages.length, 5)
  assert.equal(messages.filter(message => message.author_id === ids.owner).length, 3)
  assert.equal(messages.filter(message => message.author_id === ids.worker).length, 2)
  assert.ok(messages.some(message => message.body.includes('수정할 내용')))
  console.log('내 업무 DB 검증 통과: 같은 부서 배정, 차수 전환, 권한, 재시도, 사내 채팅')
} catch (error) {
  console.error(error.message, error.code ?? '', error.where ?? '')
  process.exitCode = 1
} finally {
  await db.close()
}
