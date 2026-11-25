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

async function notices() {
  return (await db.query('select * from public.personal_work_feedback_notices order by round')).rows
}

async function readNotice(id, revision) {
  return (await db.query('select public.read_personal_work_feedback_notice($1,$2) as read_at', [id, revision])).rows[0].read_at
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
    create function app.permission_company_id() returns uuid language sql stable security definer as $$
      select company_id from public.profiles where id = auth.uid() and status = 'active';
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
  for (const migration of ['20260930160000_company_chat.sql', '20261123090000_personal_work_cards.sql', '20261125065330_personal_work_feedback_notifications.sql']) {
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
  await db.query('select public.submit_personal_work_feedback($1,$2,$3,$4,$5)', [assigned, submitCommand, 4, ids.peer, '검토 부탁드립니다.'])
  await action(assigned, 'submit', { revision: 4, reviewer: ids.peer, command: submitCommand })
  assert.equal((await card(assigned)).reviewer_id, ids.owner)
  assert.deepEqual(await notices(), [])
  await assert.rejects(action(assigned, 'approve', { revision: 5 }), { code: '42501' })

  await actor(ids.peer)
  assert.deepEqual(await list(), [])
  assert.deepEqual(await notices(), [])
  assert.equal(await readNotice(submitCommand, 5), null)
  await assert.rejects(action(assigned, 'approve', { revision: 5 }), { code: '42501' })
  for (const id of [ids.outsider, ids.inactive]) {
    await actor(id)
    assert.deepEqual(await list(), [])
    assert.deepEqual(await notices(), [])
    assert.equal(await readNotice(submitCommand, 5), null)
    await assert.rejects(action(assigned, 'approve', { revision: 5 }), { code: '42501' })
  }
  await actor(ids.owner, 'anon')
  await assert.rejects(list(), { code: '42501' })
  await assert.rejects(notices(), { code: '42501' })
  await assert.rejects(readNotice(submitCommand, 5), { code: '42501' })

  await actor(ids.owner)
  const [firstNotice, ...duplicates] = await notices()
  assert.deepEqual(duplicates, [])
  assert.deepEqual([firstNotice.id, firstNotice.card_id, firstNotice.card_revision, firstNotice.round, firstNotice.note],
    [submitCommand, assigned, 5, 1, '검토 부탁드립니다.'])
  assert.equal(firstNotice.read_at, null)
  assert.equal(await readNotice(submitCommand, 4), null)
  const readAt = await readNotice(submitCommand, 5)
  assert.ok(readAt)
  assert.deepEqual(await readNotice(submitCommand, 5), readAt)
  assert.equal((await notices())[0].resolved_at, null)
  await assert.rejects(db.query('update public.personal_work_feedback_notices set read_at = null'), { code: '42501' })
  await assert.rejects(action(assigned, 'revise', { revision: 5 }), { code: '22023' })
  await action(assigned, 'revise', { revision: 5, note: '수정할 내용' })
  assert.deepEqual([(await card(assigned)).status, (await card(assigned)).round], ['todo', 2])
  await actor(ids.worker)
  await action(assigned, 'start', { revision: 6 })
  const nextSubmitCommand = randomUUID()
  await db.query('select public.submit_personal_work_feedback($1,$2,$3)', [assigned, nextSubmitCommand, 7])

  await actor(ids.owner)
  assert.ok((await notices())[0].resolved_at)
  assert.equal((await notices())[1].read_at, null)
  assert.equal(await readNotice(submitCommand, 8), null)
  await action(assigned, 'approve', { revision: 8 })
  const secondNotice = (await notices())[1]
  assert.deepEqual([secondNotice.id, secondNotice.round, secondNotice.card_revision, secondNotice.read_at], [nextSubmitCommand, 2, 8, null])
  assert.ok(secondNotice.resolved_at)
  const completed = await card(assigned)
  assert.equal(completed.status, 'done')
  assert.deepEqual(completed.events.map(event => [event.round, event.kind]), [
    [1, 'started'], [1, 'paused'], [1, 'resumed'], [1, 'submitted'], [1, 'revision_requested'],
    [2, 'started'], [2, 'submitted'], [2, 'approved'],
  ])
  assert.ok(completed.events.every((event, index, history) => index === 0 || Date.parse(event.at) >= Date.parse(history[index - 1].at)))

  const ownFeedbackCard = randomUUID(), ownFeedbackEvent = randomUUID()
  await actor(ids.worker)
  await action(ownFeedbackCard, 'create', { title: '직접 담당자를 고른 업무' })
  await action(ownFeedbackCard, 'start', { revision: 1 })
  for (const reviewer of [ids.outsider, ids.inactive]) {
    await assert.rejects(action(ownFeedbackCard, 'submit', { revision: 2, reviewer }), { code: '42501' })
  }
  await db.query('select public.submit_personal_work_feedback($1,$2,$3,$4)', [ownFeedbackCard, ownFeedbackEvent, 2, ids.peer])
  await actor(ids.peer)
  assert.deepEqual((await notices()).map(notice => notice.id), [ownFeedbackEvent])
  await db.exec('reset role')
  await db.query("update public.profiles set status='inactive' where id=$1", [ids.peer])
  await actor(ids.peer)
  assert.deepEqual(await notices(), [])
  assert.equal(await readNotice(ownFeedbackEvent, 3), null)

  const legacyCard = randomUUID(), legacyCommand = randomUUID()
  await actor(ids.worker)
  await action(legacyCard, 'create', { title: '운영 버전의 기존 업무' })
  await action(legacyCard, 'start', { revision: 1 })
  await action(legacyCard, 'submit', { revision: 2, reviewer: ids.owner, command: legacyCommand })
  await actor(ids.owner)
  assert.equal((await notices()).some(notice => notice.id === legacyCommand), false, 'legacy clients receive only their chat notice')
  assert.equal((await card(legacyCard)).status, 'feedback')

  await db.exec('reset role')
  const messages = (await db.query('select id, author_id, body from public.chat_messages')).rows
  assert.equal(messages.length, 4)
  assert.equal(messages.filter(message => message.author_id === ids.owner).length, 3)
  assert.deepEqual(messages.filter(message => message.author_id === ids.worker).map(message => message.id), [legacyCommand])
  assert.ok(messages.some(message => message.body.includes('수정할 내용')))
  console.log('내 업무 DB 검증 통과: 배정, 차수 전환, 피드백 알림, 권한, 읽음과 처리 상태 분리, 재시도')
} catch (error) {
  console.error(error.message, error.code ?? '', error.where ?? '')
  process.exitCode = 1
} finally {
  await db.close()
}
