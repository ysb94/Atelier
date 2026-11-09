import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const company = 'e0000000-0000-4000-8000-000000000001'
const china = 'bf926822-910c-422f-9c17-5fd3d8ddb3ba'
const id = n => `60000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const sql = (name) => readFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8')
const revision = '2026-11-05T00:00:00Z'
const assignedAt = '2026-11-04T00:00:00Z'
const order = (key, assignee, shippedAt = '2026-11-03T00:00:00Z', originCountry = '중국') => ({
  id: key, name: 'fixture.xlsx', url: 'https://fixture.invalid/file', round: 1, assigneeId: assignee, shippedAt, originCountry,
})
const asActor = async (actor, role = 'authenticated') => {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor])
  await db.exec(`set role ${role}`)
}
const read = async () => (await db.query('select public.get_my_china_work_orders() as value')).rows[0].value
const file = async (key) => (await db.query("select public.get_my_china_work_order_file($1,$2,'sample') as value", [id(11), key])).rows[0].value
const act = (draftId, key, action, kind = 'sample', rev = revision) =>
  db.query('select app.china_work_order($1,$2,$3,$4,null,$5)', [draftId, key, kind, action, rev])
try {
  await db.exec(`
    create schema app; create schema auth; create role authenticated; create role anon;
    grant usage on schema app to authenticated;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.profiles(id uuid primary key, company_id uuid, department_id uuid, status text, display_name text);
    create table public.department_workforce_policies(company_id uuid,department_id uuid,mode text,contact_ids uuid[]);
    create table public.product_drafts(id uuid primary key,company_id uuid,updated_at timestamptz,status text,
      origin_country text,draft_no text,brand_id uuid,name_ko text,name_en text,image_url text,owner text,
      sample_work_orders jsonb,specs jsonb);
    create table public.draft_colors(id uuid,draft_id uuid,sample_work_order_url text,sample_work_order_shipped boolean,sample_work_order_shipped_at timestamptz);
    create function app.work_department(text) returns uuid language sql as $$select '${china}'::uuid$$;
    create function app.permission_company_id() returns uuid language sql stable as $$select company_id from public.profiles where id=auth.uid() and status='active'$$;
    create function app.basic_work_allowed(text) returns boolean language sql stable as $$select app.permission_company_id()='${company}'::uuid$$;
    create function app.work_operator() returns boolean language sql stable as $$select false$$;
    insert into public.profiles values ('${id(1)}','${company}','${china}','active','worker A'),
      ('${id(2)}','${company}','${china}','active','worker B'),
      ('${id(3)}','${company}','${china}','active','manager'),
      ('${id(4)}','${company}',null,'active','other department');
    insert into public.department_workforce_policies values ('${company}','${china}','external',array['${id(3)}'::uuid]);
  `)
  const legacy = await sql('20261105133000_china_color_work_ship')
  await db.exec(legacy.slice(legacy.indexOf('create or replace function app.china_work_order')))
  await db.exec(await sql('20261106120000_china_assigned_work_orders'))
  await db.exec(await sql('20261106121000_china_assigned_round_history'))
  await db.exec(await sql('20261106130000_china_assignee_receipt'))
  await db.exec(await sql('20261106131500_china_assignee_receipt_closed'))
  await db.exec(await sql('20261106134500_china_assigned_order_elapsed_days'))
  const received = { receivedAt: '2026-11-04T00:00:00Z' }
  for (const [draftId, actor, rounds, colors] of [
    [id(11), id(1), [
      order('mine', id(1)), order('other', id(2)), order('future', id(1), revision),
      order('korea', id(1), assignedAt, '한국'),
      { ...order('final-received', id(1), assignedAt, '한국'), ...received, sampleStage: 'final' },
      { ...order('other-received', id(2), assignedAt, '한국'), ...received },
      { ...order('future-received', id(1), revision, '한국'), ...received },
    ], [
      order('color', id(1), ''),
      { ...order('color-received', id(1), assignedAt, '한국'), ...received },
    ]],
    [id(12), id(2), [order('theirs', id(2))], []],
  ]) {
    await db.query("insert into public.product_drafts values ($1,$2,$3,'open','중국','PL-fixture',null,'fixture','',null,'', $4,$5)",
      [draftId, company, revision, JSON.stringify(rounds), JSON.stringify({ chinaWorkAssignment: { assigneeId: actor, assignedAt }, colorSampleRequestedAt: assignedAt, colorSampleRounds: colors })])
  }
  await asActor(id(1))
  const before = await read()
  assert.equal(before.role, 'worker')
  assert.deepEqual(before.orders.map(row => row.orderId).sort(), ['color', 'color-received', 'final-received', 'mine'])
  assert.ok(before.orders.filter(row => row.orderId.endsWith('-received')).every(row => row.closed && row.receivedAt))
  assert.equal(Object.hasOwn(before.orders[0], 'url'), false)
  assert.equal(before.orders.find(row => row.orderId === 'mine').shippedAt,'2026-11-03T00:00:00Z')
  assert.equal(before.orders.find(row => row.orderId === 'color').shippedAt,assignedAt)
  assert.equal(before.orders.find(row => row.orderId === 'final-received').shippedAt,assignedAt)
  assert.match(await file('mine'), /^https:/)
  assert.match(await file('final-received'), /^https:/)
  await assert.rejects(act(id(11), 'final-received', 'ship'), { code: '42501' })
  await assert.rejects(act(id(11), 'color-received', 'ship', 'color'), { code: '42501' })
  for (const key of ['other', 'future', 'korea', 'other-received', 'future-received']) {
    assert.equal(await file(key), null)
    await assert.rejects(act(id(11), key, 'ship'), { code: '42501' })
  }
  await assert.rejects(act(id(12), 'theirs', 'ship'), { code: '42501' })
  await assert.rejects(act(id(11), 'mine', 'handoff'), { code: '42501' })
  await act(id(11), 'final-received', 'check')
  const receivedFile = (await read()).orders.find(row => row.orderId === 'final-received')
  assert.equal(typeof receivedFile.assigneeCheckedAt, 'string')
  await act(id(11), 'mine', 'check', 'sample', receivedFile.revision)
  const marked = (await read()).orders.find(row => row.orderId === 'mine')
  assert.equal(typeof marked.assigneeCheckedAt, 'string')
  assert.equal(marked.fileCheckedAt ?? null, null)
  await act(id(11), 'mine', 'ship', 'sample', marked.revision)
  const after = await read()
  const shipped = after.orders.find(row => row.orderId === 'mine')
  assert.ok(shipped.closed && shipped.returnedAt && !shipped.receivedAt)
  await assert.rejects(act(id(11), 'mine', 'ship', 'sample', shipped.revision), { code: '42501' })
  await act(id(11), 'color', 'ship', 'color', shipped.revision)
  assert.ok((await read()).orders.every(row => row.closed))
  await asActor(id(2))
  assert.deepEqual((await read()).orders.map(row => row.orderId), ['theirs'])
  await asActor(id(3))
  const manager = await read()
  assert.equal(manager.role, 'manager')
  assert.deepEqual(manager.orders, [])
  await act(id(12), 'theirs', 'ship')
  assert.notEqual((await read()).revision, manager.revision)
  await asActor(id(4))
  assert.deepEqual(await read(), { role: 'denied', orders: [] })
  await asActor('', 'anon')
  await assert.rejects(read(), { code: '42501' })
  console.log('China work: scoped reads and files, role restrictions, sample and color dispatch, duplicate guard, manager compatibility passed.')
} finally {
  await db.close()
}
