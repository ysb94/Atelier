import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { china, company, createMaterialTestDatabase, ids } from './verify-material-request-workflow.mjs'

const fixtureId = number => `61000000-0000-4000-8000-${String(number).padStart(12, '0')}`
const migration = name => readFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8')
export const draftPriceFixture = {
  id: fixtureId(1), incompleteId: fixtureId(2), black: fixtureId(3), yellow: fixtureId(4),
  updatedAt: '2026-11-06T03:00:00Z',
  photo: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN9sAAAAASUVORK5CYII=',
}

async function originalState(db) {
  const { rows } = await db.query(`select jsonb_build_object(
    'drafts', (select jsonb_agg(to_jsonb(d) order by d.id) from public.product_drafts d),
    'colors', (select jsonb_agg(to_jsonb(c) order by c.id) from public.draft_colors c),
    'profiles', (select jsonb_agg(to_jsonb(p) order by p.id) from public.profiles p),
    'policy', (select jsonb_agg(to_jsonb(p) order by p.tablename, p.policyname) from pg_policies p where p.schemaname='public'),
    'grants', (select jsonb_agg(to_jsonb(t) order by t.table_name, t.grantee, t.privilege_type)
      from information_schema.table_privileges t where t.table_schema='public'),
    'functions', (select jsonb_agg(jsonb_build_array(p.proname, p.proacl, pg_get_functiondef(p.oid)) order by p.oid)
      from pg_proc p where p.oid in ('app.draft_write_allowed(uuid)'::regprocedure, 'app.china_work_screen_role()'::regprocedure))
  ) as snapshot`)
  return rows[0].snapshot
}

export async function installDraftPriceFixture(db) {
  const { id, incompleteId, black, yellow, updatedAt, photo } = draftPriceFixture
  await db.exec(`
    alter table public.product_drafts add unique (company_id,id), add column created_by uuid,
      add column target_cost numeric, add column cost_confirmed boolean;
    alter table public.draft_colors add column company_id uuid, add column name text, add column sort_order int;
    create function app.basic_work_allowed(text,uuid) returns boolean language sql stable security definer set search_path='' as $$
      select app.basic_work_allowed($1) and ($2 is null or exists (
        select from public.brands where id=$2 and company_id=app.permission_company_id()))
    $$;
    insert into public.department_workforce_policies (company_id,department_id,mode,contact_ids)
      select company_id,'${china}','external',array[id] from public.profiles where id='${ids.outside}';
    grant select,update on public.product_drafts to authenticated;
    alter table public.product_drafts enable row level security;
    create policy fixture_draft_select on public.product_drafts for select to authenticated using (company_id=app.permission_company_id());
  `)
  const existing = await migration('20261027044909_department_work_access')
  await db.exec(existing.match(/create or replace function app\.draft_write_allowed\([\s\S]+?\$\$;/)[0])
  await db.exec('create policy fixture_draft_update on public.product_drafts for update to authenticated using (app.draft_write_allowed(id))')
  await db.query(`insert into public.product_drafts (id,company_id,updated_at,status,draft_no,brand_id,owner,created_by,specs,target_cost,cost_confirmed)
    values ($1,$2,$3,'open','PL-0007',$4,'기획 직원',$5,$6,122.50,true),
      ($7,$2,$3,'open','PL-0008',null,'기획 직원',$5,'{}',null,false)`, [id, company, updatedAt, ids.brand, ids.requester,
    JSON.stringify({ colorImageChoices: { [black]: 'Image', [yellow]: 'None' }, colorPhotoUrls: { [black]: photo, [yellow]: photo } }), incompleteId])
  await db.query(`insert into public.draft_colors (id,draft_id,company_id,name,sort_order)
    values ($1,$3,$4,'Black',1),($2,$3,$4,'Yellow',2),($5,$6,$4,'Ivory',1)`, [black, yellow, id, company, fixtureId(5), incompleteId])
  const baseline = await originalState(db)
  await db.exec(await migration('20261109044448_draft_price_requests'))
  await db.exec(await migration('20261118053639_china_draft_price_request_history'))
  assert.deepEqual(await originalState(db), baseline, 'Migration preserves existing data, policies and grants')
  return baseline
}

export const draftPriceRpcArgs = {
  list_draft_price_requests: ['p_scope'],
  request_draft_price: ['p_draft', 'p_revision', 'p_previous'],
  reply_draft_price: ['p_request', 'p_amounts'],
  get_draft_price_photo: ['p_request', 'p_color'],
}

export async function callDraftPriceFixture(db, name, input) {
  assert.ok(Object.hasOwn(draftPriceRpcArgs, name))
  const keys = draftPriceRpcArgs[name]
  const values = keys.map(key => key === 'p_amounts' ? JSON.stringify(input[key]) : input[key])
  const { rows } = await db.query(`select public.${name}(${keys.map((_, i) => '$' + (i + 1)).join(',')}) as data`, values)
  return rows[0].data
}

async function verify() {
  const db = await createMaterialTestDatabase()
  try {
    const baseline = await installDraftPriceFixture(db)
    const { id, incompleteId, black, yellow, updatedAt, photo } = draftPriceFixture
    const as = (actor, operation) => db.transaction(async tx => {
      await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [actor])
      await tx.exec(actor ? 'set local role authenticated' : 'set local role anon')
      return operation(tx)
    })
    const call = (actor, name, input) => as(actor, tx => callDraftPriceFixture(tx, name, input))
    const list = (actor, scope) => call(actor, 'list_draft_price_requests', { p_scope: scope })
    const request = (actor, draft = id, previous = null, revision = updatedAt) =>
      call(actor, 'request_draft_price', { p_draft: draft, p_previous: previous, p_revision: revision })
    const reply = (actor, requestId, amounts) => call(actor, 'reply_draft_price', { p_request: requestId, p_amounts: amounts })
    const getPhoto = (actor, requestId, color) => call(actor, 'get_draft_price_photo', { p_request: requestId, p_color: color })
    const amounts = { [black]: 17.5, [yellow]: 0 }

    assert.deepEqual(await list(ids.manager, 'china'), [])
    assert.deepEqual(await list(ids.requester, 'planning'), [])
    await assert.rejects(list('', 'planning'), { code: '42501' })
    await assert.rejects(list(ids.inactive, 'planning'), { code: '42501' })
    await assert.rejects(request(ids.colleague), { code: '42501' })
    await assert.rejects(request(ids.worker), { code: '42501' })
    await assert.rejects(request(ids.requester, incompleteId), { code: '22023' })
    await assert.rejects(request(ids.requester, id, null, '2026-11-01T00:00:00Z'), { code: '40001' })
    const [first, duplicate] = await Promise.all([request(ids.requester), request(ids.requester)])
    assert.equal(duplicate.id, first.id)
    assert.equal(first.round, 1)
    assert.deepEqual(first.colors, [{ id: black, name: 'Black', hasPhoto: true }, { id: yellow, name: 'Yellow', hasPhoto: false }])
    assert.equal(first.answeredAt, null)
    assert.deepEqual(await list(ids.manager, 'china'), [first])
    assert.deepEqual(await list(ids.colleague, 'planning'), [first])
    assert.deepEqual(await list(ids.worker, 'planning'), [])
    assert.deepEqual(await list(ids.viewer, 'planning'), [])
    assert.deepEqual(await list(ids.outside, 'china'), [])
    await assert.rejects(list(ids.worker, 'china'), { code: '42501' })
    await assert.rejects(list(ids.requester, 'china'), { code: '42501' })
    await assert.rejects(list(ids.worker, 'china_history'), { code: '42501' })
    await assert.rejects(list(ids.requester, 'china_history'), { code: '42501' })
    await assert.rejects(as(ids.manager, tx => tx.query('select * from app.draft_price_requests')), { code: '42501' })
    await assert.rejects(as(ids.manager, tx => tx.query('update app.draft_price_requests set amounts=null')), { code: '42501' })
    await assert.rejects(getPhoto(ids.worker, first.id, black), { code: '42501' })
    assert.equal(await getPhoto(ids.outside, first.id, black), null)
    assert.equal(await getPhoto(ids.manager, first.id, black), photo)
    assert.equal(await getPhoto(ids.manager, first.id, yellow), null)
    await assert.rejects(reply(ids.worker, first.id, amounts), { code: '42501' })
    await assert.rejects(reply(ids.outside, first.id, amounts), { code: '42501' })
    await assert.rejects(reply(ids.requester, first.id, amounts), { code: '42501' })
    for (const invalid of [null, { [black]: 12 }, { [black]: 12, invalid: 12 }, { ...amounts, [black]: '12' },
      { ...amounts, [black]: -1 }, { ...amounts, [black]: 12.345 }, { ...amounts, [black]: 100_000_000 }]) {
      await assert.rejects(reply(ids.manager, first.id, invalid), { code: '22023' })
    }
    assert.equal((await list(ids.manager, 'china'))[0].answeredAt, null)
    const sent = await reply(ids.manager, first.id, amounts)
    assert.ok(sent.answeredAt)
    assert.deepEqual(sent.amounts, amounts)
    assert.deepEqual(await reply(ids.manager, first.id, amounts), sent)
    await assert.rejects(reply(ids.manager, first.id, { ...amounts, [black]: 20 }), { code: '40001' })
    await assert.rejects(request(ids.requester), { code: '40001' })
    assert.deepEqual(await list(ids.requester, 'planning'), [sent])

    // A later edit cannot change the request's color names or photo snapshots.
    await db.query("update public.draft_colors set name='Ink' where id=$1", [black])
    await db.query("update public.product_drafts set specs=specs - 'colorPhotoUrls' where id=$1", [id])
    assert.deepEqual(await list(ids.manager, 'china'), [sent])
    assert.equal(await getPhoto(ids.manager, first.id, black), photo)
    await db.query("update public.draft_colors set name='Black' where id=$1", [black])
    await db.query('update public.product_drafts set specs=$2 where id=$1', [id, JSON.stringify(baseline.drafts.find(draft => draft.id === id).specs)])

    const second = await request(ids.requester, id, first.id)
    assert.equal(second.round, 2)
    assert.deepEqual(await list(ids.requester, 'planning'), [sent, second])
    assert.equal((await list(ids.manager, 'china')).filter(row => !row.answeredAt).length, 1)
    const secondReply = await reply(ids.manager, second.id, { ...amounts, [black]: 18 })
    assert.deepEqual(await list(ids.requester, 'planning'), [secondReply])
    assert.deepEqual(await list(ids.manager, 'china'), [secondReply])
    assert.deepEqual(await list(ids.manager, 'china_history'), [sent, secondReply])
    const third = await request(ids.requester, id, second.id)
    assert.equal(third.round, 3)
    assert.equal(third.amounts, null)
    assert.deepEqual(await list(ids.requester, 'planning'), [third, secondReply])
    assert.deepEqual(await list(ids.manager, 'china'), [third, secondReply])
    assert.deepEqual(await list(ids.manager, 'china_history'), [sent, third, secondReply])
    assert.deepEqual(await list(ids.outside, 'china_history'), [])
    assert.equal((await db.query('select count(*)::int as total from app.draft_price_requests')).rows[0].total, 3)
    assert.deepEqual(await originalState(db), baseline, 'Requests and replies preserve existing draft cost, content and access')
    console.log('Draft price SQL: request/reply, China round history, planning latest reply, immutable snapshots, roles and company isolation passed')
    await db.exec('create table public.companies(id uuid primary key); insert into public.companies select distinct company_id from public.profiles')
    await db.exec(await migration('20261124102710_draft_price_destinations'))
    const readDestinations = actor => as(actor, async tx => (await tx.query('select id,name from public.draft_price_destinations')).rows)
    const addDestination = (actor, name) => as(actor, async tx => (await tx.query(
      'insert into public.draft_price_destinations(name,source_draft_id) values ($1,$2) returning id,name', [name, id],
    )).rows[0])
    const vietnam = await addDestination(ids.requester, 'Vietnam')
    assert.deepEqual(await readDestinations(ids.colleague), [vietnam])
    assert.deepEqual(await readDestinations(ids.viewer), [vietnam])
    assert.deepEqual(await readDestinations(ids.outside), [])
    assert.deepEqual(await readDestinations(ids.inactive), [])
    await assert.rejects(readDestinations(''), { code: '42501' })
    await assert.rejects(addDestination(ids.colleague, 'Cambodia'), { code: '42501' })
    await assert.rejects(addDestination(ids.outside, 'Cambodia'), { code: '42501' })
    await assert.rejects(addDestination(ids.requester, 'VIETNAM'), { code: '23505' })
    await assert.rejects(addDestination(ids.requester, 'CHINA (김웅사장님)'), { code: '23514' })
    await db.exec(await migration('20261124102721_manage_draft_price_destinations'))
    const listOptions = actor => as(actor, async tx =>
      (await tx.query('select public.list_draft_price_destinations() as data')).rows[0].data)
    const changeOption = (actor, option, revision, name) => as(actor, async tx =>
      (await tx.query('select public.change_draft_price_destination($1,$2,$3,$4) as data', [id, option, revision, name])).rows[0].data)
    const [existing] = await listOptions(ids.colleague)
    assert.equal(existing.id, vietnam.id)
    const renamed = await changeOption(ids.requester, vietnam.id, existing.revision, 'Hanoi')
    assert.deepEqual(await listOptions(ids.colleague), [renamed])
    await assert.rejects(changeOption(ids.requester, vietnam.id, existing.revision, 'Stale'), { code: '40001' })
    await assert.rejects(changeOption(ids.colleague, vietnam.id, renamed.revision, null), { code: '42501' })
    await assert.rejects(changeOption(ids.outside, vietnam.id, renamed.revision, null), { code: '42501' })
    await assert.rejects(changeOption('', vietnam.id, renamed.revision, null), { code: '42501' })
    const renamedPreset = await changeOption(ids.requester, '중국', null, 'China main factory')
    assert.equal(renamedPreset.preset_key, '중국')
    assert.deepEqual(await readDestinations(ids.colleague), [{ id: vietnam.id, name: 'Hanoi' }])
    const removedPreset = await changeOption(ids.requester, '중국', renamedPreset.revision, null)
    assert.equal(removedPreset.removed, true)
    const restoredPreset = await changeOption(ids.requester, '중국', removedPreset.revision, 'CHINA (김웅사장님)')
    assert.equal(restoredPreset.removed, false)
    assert.equal(restoredPreset.id, renamedPreset.id)
    await changeOption(ids.requester, vietnam.id, renamed.revision, null)
    assert.deepEqual(await listOptions(ids.colleague), [restoredPreset])
    assert.deepEqual(await listOptions(ids.outside), [])
    assert.deepEqual(await readDestinations(ids.colleague), [])
    const addedAgain = await addDestination(ids.requester, 'Hanoi')
    assert.notEqual(addedAgain.id, vietnam.id)
    await db.query('delete from public.product_drafts where id=$1', [id])
    assert.deepEqual(await readDestinations(ids.colleague), [addedAgain])
    console.log('Shared price destinations SQL: company sharing, edit/delete/restore, company and role isolation, stale writes, and persistence after draft deletion passed')
  } finally {
    await db.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await verify()
