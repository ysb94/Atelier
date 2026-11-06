import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { PGlite } from '@electric-sql/pglite'

export const company = 'e0000000-0000-4000-8000-000000000001'
export const china = 'bf926822-910c-422f-9c17-5fd3d8ddb3ba'
const planning = 'ced99f89-ea80-4eeb-8f03-272bf72f5db1'
const id = n => `60000000-0000-4000-8000-${String(n).padStart(12, '0')}`
export const ids = { requester: id(1), colleague: id(2), manager: id(3), worker: id(4), other: id(5), outside: id(6), inactive: id(7), viewer: id(8), brand: id(20), outsideBrand: id(21), request: id(30) }
const filePath = `${ids.requester}/${ids.request}/${id(40)}`
const sql = name => readFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8')

export async function installMaterialTestSchema(db) {
  await db.exec(`
    create schema app; create schema auth; create schema storage;
    create role authenticated; create role anon;
    grant usage on schema app,auth,storage to authenticated;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.profiles(id uuid primary key,company_id uuid,department_id uuid,status text,display_name text);
    create table public.departments(id uuid,company_id uuid,is_active boolean);
    grant select on public.profiles,public.departments to authenticated;
    create table public.brands(id uuid primary key,company_id uuid);
    create table public.department_workforce_policies(company_id uuid,department_id uuid,mode text,contact_ids uuid[]);
    create table public.product_drafts(id uuid primary key,company_id uuid,updated_at timestamptz,status text,
      origin_country text,draft_no text,brand_id uuid,name_ko text,name_en text,image_url text,owner text,
      sample_work_orders jsonb,specs jsonb);
    create table public.draft_colors(id uuid,draft_id uuid,sample_work_order_url text,sample_work_order_shipped boolean,sample_work_order_shipped_at timestamptz);
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(bucket_id text,name text,primary key(bucket_id,name));
    alter table storage.objects enable row level security;
    grant select,insert on storage.objects to authenticated;
    create function app.work_department(text) returns uuid language sql as $$select case $1 when 'china' then '${china}'::uuid else '${planning}'::uuid end$$;
    create function app.permission_company_id() returns uuid language sql stable security definer as $$select company_id from public.profiles where id=auth.uid() and status='active'$$;
    create function app.basic_work_allowed(text) returns boolean language sql stable security definer as $$
      select exists(select from public.profiles p where p.id=auth.uid() and p.status='active'
        and (p.department_id=app.work_department($1) or ($1='planning' and p.id='${ids.other}')))
    $$;
    create function app.work_operator() returns boolean language sql stable as $$select false$$;
    insert into public.departments values ('${china}','${company}',true),('${planning}','${company}',true);
    insert into public.profiles values
      ('${ids.requester}','${company}','${planning}','active','기획 직원'),
      ('${ids.colleague}','${company}','${planning}','active','다른 기획 직원'),
      ('${ids.manager}','${company}','${china}','active','운영 담당자'),
      ('${ids.worker}','${company}','${china}','active','담당 직원'),
      ('${ids.other}','${company}','${china}','active','다른 직원'),
      ('${ids.outside}','${id(90)}','${china}','active','타사 직원'),
      ('${ids.inactive}','${company}','${china}','inactive','비활성 직원'),
      ('${ids.viewer}','${company}',null,'active','수신 직원');
    insert into public.brands values ('${ids.brand}','${company}'),('${ids.outsideBrand}','${id(90)}');
    insert into public.department_workforce_policies values ('${company}','${china}','external',array['${ids.manager}'::uuid]);
  `)
  await db.exec(await sql('20261105065100_china_work_assignees'))
  await db.exec(`insert into public.china_work_assignees(company_id,profile_id,sort_order)
    values ('${company}','${ids.worker}',1),('${company}','${ids.other}',2),('${company}','${ids.inactive}',3)`)
  const legacy = await sql('20261105133000_china_color_work_ship')
  await db.exec(legacy.slice(legacy.indexOf('create or replace function app.china_work_order')))
  for (const name of [
    '20261106120000_china_assigned_work_orders',
    '20261106121000_china_assigned_round_history',
    '20261106130000_china_assignee_receipt',
    '20261106131500_china_assignee_receipt_closed',
    '20261106134500_china_assigned_order_elapsed_days',
  ]) await db.exec(await sql(name))
  await db.exec(await sql('20261106133000_material_request_workflow'))
  await db.exec(await sql('20261106134000_china_material_completion_status'))
  await db.exec(await sql('20261106135000_china_material_satisfaction_privacy'))
  await db.exec(await sql('20261106141000_material_nudge_recipients'))
  await db.exec(await sql('20261106141500_material_nudge_save_execute'))
  await db.exec(await sql('20261106142000_material_nudge_notifications'))
  await db.exec(await sql('20261106143000_material_nudge_recipient_conflicts'))
  await db.exec(await sql('20261106144000_china_assignee_workloads'))
  await db.exec(await sql('20261106153809_material_nudge_detail_access'))
  await db.exec(await sql('20261106163544_material_nudge_recipient_satisfaction'))
  await db.exec(await sql('20261106165117_material_nudge_inbox_confirmation'))
  await db.exec(await sql('20261106171049_china_work_assignee_order'))
}

export async function createMaterialTestDatabase() {
  const db = new PGlite()
  try {
    await installMaterialTestSchema(db)
    return db
  } catch (error) {
    await db.close()
    throw error
  }
}

async function verify() {
  const db = await createMaterialTestDatabase()
  const { request, requester, colleague, manager, worker, other, inactive, outside, brand, outsideBrand } = ids
  const actAs = async (uid, role='authenticated') => {
    await db.exec('reset role')
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid])
    await db.exec(`set role ${role}`)
  }
  const read = async (scope, key=null, round=null) => (await db.query('select public.read_material_requests($1,$2,$3) as data',[scope,key,round])).rows[0].data
  const write = (action, revision=null, options={}) => db.query('select public.write_material_request($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [action,request,revision,options.round??null,options.title??null,options.brand??null,
      options.blocks ? JSON.stringify(options.blocks):null,options.stage??null,options.assignee??null,options.score??null])
  const text = { id: 'text', type: 'text', text: '원단' }
  const file = { id: 'file', type: 'image', name: 'swatch.png', path: filePath, caption: '', widthPercent: 100, offsetY: 0, wrap: 'none' }
  const draft = { title:'1차 원단',brand,blocks:[text,file],stage:'ready' }
  const fileCount = async () => (await db.query("select count(*)::int n from storage.objects where name=$1",[filePath])).rows[0].n
  const workload = async profileId => {
    const { rows: [{ screen }] } = await db.query('select public.get_my_china_work_orders() as screen')
    return screen.workloads.find(item => item.profileId === profileId)
  }
  const removeAssignee = profileId => db.query('delete from public.china_work_assignees where profile_id=$1 returning profile_id', [profileId])
  const assertNoScores = rows => {
    assert.ok(rows.length > 0)
    assert.ok(rows.every(row=>row.rounds.every(round=>!Object.hasOwn(round,'satisfaction'))))
  }
  try {
    await actAs('', 'anon')
    await assert.rejects(read('planning'), { code: '42501' })
    await actAs(requester)
    await assert.rejects(db.query('select * from app.material_requests'), { code: '42501' })
    await assert.rejects(write('save',null,draft), { code: '22023' }) // file not uploaded
    await db.query("insert into storage.objects values ('material-request-files',$1)",[filePath])
    assert.equal(await fileCount(),0)
    await assert.rejects(write('save',null,{...draft,blocks:[text,{...file,caption:{malformed:true}}]}), { code: '22023' })
    await assert.rejects(write('save',null,{...draft,brand:outsideBrand}), { code: '42501' })
    await write('save',null,{...draft,stage:'writing'})
    assert.equal(await fileCount(),1)
    await assert.rejects(write('send',1), { code: '22023' })
    await actAs(colleague)
    assert.deepEqual(await read('planning'),[])
    await assert.rejects(read('planning',request), { code:'42501' })
    await actAs(requester)
    await write('save',1,draft)
    await actAs(colleague)
    const [planned] = await read('planning')
    assert.equal(planned.title,draft.title)
    assert.deepEqual(planned.blocks,[])
    assert.equal(await fileCount(),0)
    await assert.rejects(write('send',2), { code:'42501' })
    await actAs(manager)
    assert.deepEqual(await read('china'),[])
    await actAs(requester)
    await write('send',2)
    await assert.rejects(write('send',2), { code:'40001' })
    await assert.rejects(write('receive',3,{round:1}), { code:'22023' })
    await assert.rejects(write('delete',3), { code:'22023' })
    await actAs(manager)
    assert.equal((await read('china'))[0].rounds[0].content,undefined)
    assert.equal((await read('china',request,1))[0].rounds[0].content.blocks[1].path,filePath)
    await assert.rejects(write('assign',3,{round:1,assignee:worker}), { code:'22023' })
    await write('review',3,{round:1})
    await assert.rejects(write('assign',4,{round:1,assignee:inactive}), { code:'42501' })
    await write('assign',4,{round:1,assignee:worker})
    assert.equal((await workload(worker)).materialOpen,1)
    await assert.rejects(removeAssignee(worker), { code:'23503', message:/진행 중 1건/ })
    await actAs(other)
    await assert.rejects(removeAssignee(worker), { code:'42501' })
    assert.deepEqual(await read('china'),[])
    assert.equal(await fileCount(),0)
    await assert.rejects(read('china',request,1), { code:'42501' })
    await assert.rejects(write('confirm',5,{round:1}), { code:'42501' })
    await actAs(inactive)
    await assert.rejects(read('china'), { code:'42501' })
    await actAs(outside)
    assert.deepEqual(await read('china'),[])
    assert.equal(await fileCount(),0)
    await actAs(worker)
    assert.equal(await fileCount(),1)
    assert.equal((await read('china',request,1))[0].rounds[0].assigneeRead,false)
    await assert.rejects(write('ship',5,{round:1}), { code:'22023' })
    await write('confirm',5,{round:1})
    await actAs(manager)
    await write('assign',6,{round:1,assignee:other})
    await actAs(worker)
    assert.equal(await fileCount(),0)
    await assert.rejects(write('ship',7,{round:1}), { code:'42501' })
    await actAs(other)
    await assert.rejects(write('ship',7,{round:1}), { code:'22023' })
    await write('confirm',7,{round:1})
    await write('ship',8,{round:1})
    await actAs(requester)
    assert.ok((await read('planning'))[0].rounds[0].shippedAt)
    await write('receive',9,{round:1})
    await write('rate',10,{round:1,score:8})
    assert.equal((await read('planning',request))[0].rounds[0].satisfaction,8)
    await actAs(other)
    assert.deepEqual((await read('china'))[0].rounds.map(r=>r.number),[1])
    assertNoScores(await read('china'))
    assertNoScores(await read('china',request,1))
    await actAs(requester)
    await write('save',11,{...draft,title:'2차 원단',blocks:[text]})
    await write('send',12)
    await actAs(other)
    assertNoScores(await read('planning')) // A China employee with extra planning access still cannot read scores.
    await actAs(colleague)
    assert.equal((await read('planning'))[0].rounds[0].satisfaction,8)
    await actAs(manager)
    assertNoScores(await read('china'))
    assertNoScores(await read('china',request,1))
    await write('review',13,{round:2})
    await write('assign',14,{round:2,assignee:worker})
    await actAs(worker)
    assert.deepEqual((await read('china'))[0].rounds.map(r=>r.number),[2])
    await assert.rejects(read('china',request,1), { code:'42501' })
    await write('confirm',15,{round:2})
    await write('ship',16,{round:2})
    await actAs(manager)
    assert.equal((await workload(worker)).materialOpen,0)
    assert.equal((await workload(worker)).materialResting,1)
    await assert.rejects(removeAssignee(worker), { code:'23503', message:/완료 대기 1건/ })
    await actAs(requester)
    await write('receive',17,{round:2})
    await write('rate',18,{round:2,score:10})
    const [completed] = await read('planning',request)
    assert.equal(completed.status,'완료')
    assert.deepEqual(completed.rounds.map(r=>[r.number,r.content.title,r.satisfaction]),[[1,'1차 원단',8],[2,'2차 원단',10]])
    await actAs(worker)
    assert.deepEqual(await read('china'),[])
    assert.equal((await read('china',request,2))[0].rounds[0].number,2)
    assertNoScores(await read('china',request,2))
    await actAs(other)
    assert.deepEqual(await read('china'),[]) // Last round was completed by another worker.
    assert.equal(await fileCount(),1)
    await actAs(manager)
    const [history] = await read('china')
    assert.equal(history.status,'완료')
    assert.deepEqual(history.rounds.map(round => round.assigneeId),[other,worker])
    assertNoScores(await read('china'))
    assert.equal((await workload(worker)).materialResting,0)
    assert.equal((await workload(other)).materialResting,0)
    assert.equal((await removeAssignee(worker)).rowCount,1)
    assert.deepEqual((await read('china'))[0].rounds.map(round => round.assigneeId),[other,worker])

    const requestForNudge = id(31)
    const unsharedRequest = id(32)
    const nudgeFilePath = `${requester}/${requestForNudge}/${id(41)}`
    const unsharedFilePath = `${requester}/${unsharedRequest}/${id(42)}`
    const listNudges = async () => (await db.query('select * from public.list_my_material_nudges()')).rows
    const nudgeWorkspace = async (scope, target=null, round=null) => (await db.query(
      'select public.material_nudge_workspace($1,$2,$3) as view', [scope,target,round],
    )).rows[0].view
    const fileVisible = async path => (await db.query('select name from storage.objects where name=$1', [path])).rowCount === 1
    const saveRecipients = recipients => db.query('select public.save_material_nudge_recipients($1::uuid[])', [recipients])
    const saveChecked = (recipients, expected) => db.query('select public.save_material_nudge_recipients_checked($1::uuid[],$2::uuid[])', [recipients,expected])
    const sendNudge = async (requestId, revision, recipients, eventId) => (await db.query(
      'select public.send_material_nudge($1,$2,$3::uuid[],$4) count', [requestId, revision, recipients, eventId]
    )).rows[0].count
    const readNudge = noticeId => db.query('select public.read_material_nudge($1)', [noticeId])
    const confirmNudge = async (requestId, noticeIds) => (await db.query(
      'select public.confirm_material_nudge_request($1,$2::uuid[]) pending', [requestId,noticeIds],
    )).rows[0].pending
    await actAs(requester)
    await db.query("insert into storage.objects values ('material-request-files',$1),('material-request-files',$2)", [nudgeFilePath,unsharedFilePath])
    await db.query("select public.write_material_request('save',$1,null,null,'원단 조르기 검수',$2,$3,'ready',null,null)",
      [requestForNudge, brand, JSON.stringify([text,{...file,path:nudgeFilePath}])])
    await db.query("select public.write_material_request('save',$1,null,null,'공유하지 않은 초안',$2,$3,'ready',null,null)",
      [unsharedRequest, brand, JSON.stringify([text,{...file,path:unsharedFilePath}])])
    await saveRecipients([worker, manager])
    await actAs(worker)
    assert.deepEqual(await nudgeWorkspace('inbox'), {can_view:true,notices:[]})
    assert.deepEqual(await nudgeWorkspace('list'), [])
    await assert.rejects(nudgeWorkspace('request',requestForNudge), {code:'42501'})
    assert.equal(await fileVisible(nudgeFilePath), false)
    await actAs(requester)
    await assert.rejects(saveChecked([colleague], []), { code:'40001' })
    await saveChecked([manager, worker], []) // Repeating the saved result is safe after an ambiguous response.
    await assert.rejects(sendNudge(requestForNudge, 0, [worker, manager], id(51)), { code: '40001' })
    await assert.rejects(sendNudge(requestForNudge, 1, [outside, manager], id(51)), { code: '40001' })
    await assert.rejects(sendNudge(request, completed.revision, [worker, manager], id(51)), { code: '40001' })
    await actAs(colleague)
    await assert.rejects(sendNudge(requestForNudge, 1, [worker, manager], id(51)), { code: '42501' })
    await actAs(requester)
    assert.equal(await sendNudge(requestForNudge, 1, [worker, manager], id(51)), 2)
    assert.equal(await sendNudge(requestForNudge, 1, [manager, worker], id(51)), 2)
    assert.deepEqual(await listNudges(), [])
    await actAs(worker)
    await assert.rejects(saveChecked([worker], [manager, worker]), { code:'42501' })
    const [notice, duplicate] = await listNudges()
    assert.equal(duplicate, undefined)
    assert.equal(notice.body, '「원단 조르기 검수」 자재요청의 진행 상황을 확인해 주세요.')
    assert.equal(notice.read_at, null)
    const inbox = await nudgeWorkspace('inbox')
    assert.equal(inbox.can_view, true)
    assert.deepEqual(inbox.notices.map(row=>[row.id,row.can_open]), [[notice.id,true]])
    const shared = await nudgeWorkspace('list')
    assert.deepEqual(shared.map(row=>row.id), [requestForNudge])
    assert.deepEqual(shared[0].blocks, [], 'list contains no body or attachment paths')
    const opened = await nudgeWorkspace('notice',notice.id)
    assert.equal(opened.request.id, requestForNudge)
    assert.deepEqual(opened.request.blocks, [text,{...file,path:nudgeFilePath}])
    assert.equal(opened.read_at, null, 'retrieving a detail does not mark it read')
    assert.equal(await fileVisible(nudgeFilePath), true)
    assert.equal(await fileVisible(unsharedFilePath), false)
    await assert.rejects(nudgeWorkspace('request',unsharedRequest), {code:'42501'})
    await assert.rejects(read('planning',requestForNudge), {code:'42501'})
    await assert.rejects(db.query("select public.write_material_request('delete',$1,1)", [requestForNudge]), {code:'42501'})
    await assert.rejects(sendNudge(requestForNudge, 1, [worker, manager], id(52)), { code: '42501' })
    await actAs(manager)
    const [managerNotice] = await listNudges()
    await assert.rejects(nudgeWorkspace('notice',notice.id), {code:'42501'})
    await readNudge(notice.id)
    assert.equal((await listNudges()).length, 1)
    await actAs(worker)
    await assert.rejects(nudgeWorkspace('notice',managerNotice.id), {code:'42501'})
    assert.equal((await listNudges())[0].read_at, null)
    await readNudge(notice.id)
    const firstRead = (await listNudges())[0].read_at
    assert.ok(firstRead)
    assert.ok((await nudgeWorkspace('notice',notice.id)).read_at)
    assert.equal((await nudgeWorkspace('list')).length, 1, 'reading does not confirm a received request')
    const openedIds = (await nudgeWorkspace('request',requestForNudge)).pending_notice_ids
    assert.deepEqual(openedIds, [notice.id])
    await assert.rejects(confirmNudge(requestForNudge, [notice.id,managerNotice.id]), {code:'42501'})
    await assert.rejects(confirmNudge(unsharedRequest, openedIds), {code:'42501'})
    assert.deepEqual((await nudgeWorkspace('request',requestForNudge)).pending_notice_ids, openedIds)
    await actAs(requester)
    assert.equal(await sendNudge(requestForNudge, 1, [worker, manager], id(53)), 2)
    await actAs(worker)
    assert.equal(await confirmNudge(requestForNudge, openedIds), true, 'a newly arrived alert stays pending')
    assert.equal(await confirmNudge(requestForNudge, openedIds), true, 'retry does not acknowledge a newer alert')
    const [newer] = await listNudges()
    assert.notEqual(newer.id, notice.id)
    assert.equal(newer.read_at, null)
    assert.deepEqual((await nudgeWorkspace('request',requestForNudge)).pending_notice_ids, [newer.id])
    assert.equal(await confirmNudge(requestForNudge, [newer.id]), false)
    assert.equal(await confirmNudge(requestForNudge, [newer.id]), false, 'confirmation is idempotent')
    assert.deepEqual(await nudgeWorkspace('list'), [])
    assert.deepEqual((await nudgeWorkspace('request',requestForNudge)).pending_notice_ids, [])
    const nudgeHistory = await listNudges()
    assert.equal(nudgeHistory.length, 2)
    assert.ok(nudgeHistory.find(row=>row.id===newer.id).read_at)
    assert.deepEqual(nudgeHistory.find(row=>row.id===notice.id).read_at, firstRead)
    assert.equal((await nudgeWorkspace('notice',notice.id)).request.id, requestForNudge)
    assert.equal(await fileVisible(nudgeFilePath), true)
    await actAs(manager)
    assert.equal((await nudgeWorkspace('list')).length, 1, 'one recipient does not clear another recipient’s list')
    await actAs(colleague)
    assert.deepEqual(await nudgeWorkspace('inbox'), {can_view:false,notices:[]})
    await assert.rejects(nudgeWorkspace('notice',notice.id), {code:'42501'})
    await assert.rejects(confirmNudge(requestForNudge, openedIds), {code:'42501'})
    assert.equal(await fileVisible(nudgeFilePath), false)
    await actAs(requester)
    await saveChecked([manager], [worker, manager])
    await actAs(worker)
    const revoked = await nudgeWorkspace('inbox')
    assert.equal(revoked.can_view, false)
    assert.equal(revoked.notices[0].can_open, false, 'previous alert remains as history without a live link')
    await assert.rejects(nudgeWorkspace('list'), {code:'42501'})
    await assert.rejects(nudgeWorkspace('notice',notice.id), {code:'42501'})
    await assert.rejects(confirmNudge(requestForNudge, openedIds), {code:'42501'})
    assert.equal(await fileVisible(nudgeFilePath), false)
    await actAs(outside)
    assert.deepEqual(await listNudges(), [])
    await assert.rejects(nudgeWorkspace('request',requestForNudge), {code:'42501'})
    await assert.rejects(confirmNudge(requestForNudge, openedIds), {code:'42501'})

    // These alerts were delivered while the now-completed request was still open.
    const viewerNotice = id(61)
    const chinaNotice = id(62)
    await actAs(requester)
    await saveChecked([ids.viewer, other, manager], [manager])
    await db.exec('reset role')
    await db.query(`insert into app.material_nudge_notices(id,request_id,event_id,company_id,sender_id,recipient_id,sender_name,body)
      values ($1,$2,$3,$4,$5,$6,'기획 직원','이전 조르기 알림'),($7,$2,$3,$4,$5,$8,'기획 직원','이전 조르기 알림')`,
      [viewerNotice,request,id(63),company,requester,ids.viewer,chinaNotice,other])
    await actAs(ids.viewer)
    const rated = (await nudgeWorkspace('notice',viewerNotice)).request
    assert.deepEqual(rated.rounds.map(round=>[round.number,round.satisfaction]), [[1,8],[2,10]])
    assert.equal(rated.rounds[1].content.title,'2차 원단')
    assertNoScores(await nudgeWorkspace('list'))
    const ratedReceived = await nudgeWorkspace('request',request)
    assert.deepEqual(ratedReceived.request.rounds, rated.rounds)
    assert.deepEqual(ratedReceived.pending_notice_ids, [viewerNotice])
    await assert.rejects(nudgeWorkspace('notice',chinaNotice), {code:'42501'})
    await assert.rejects(write('rate',completed.revision,{round:2,score:9}), {code:'42501'})
    await actAs(other) // China department with extra planning access.
    assertNoScores([(await nudgeWorkspace('notice',chinaNotice)).request])
    assertNoScores([(await nudgeWorkspace('request',request)).request])
    assertNoScores([(await nudgeWorkspace('request',request,1)).request])

    await actAs('', 'anon')
    await assert.rejects(listNudges(), { code: '42501' })
    await assert.rejects(nudgeWorkspace('inbox'), { code: '42501' })
    await assert.rejects(confirmNudge(requestForNudge, openedIds), { code: '42501' })
    console.log('Material request SQL: roles, private files, revision guard, assignment, confirmation, shipment, receipt and follow-up passed')
    console.log('Material nudge SQL: matching preview, retry, recipient-only inbox and read authorization passed')
    console.log('Material safeguards SQL: open/waiting deletion blocks, history and checked settings passed')
    console.log('Material nudge detail SQL: designated and actual recipient, private attachments, read state, revocation, and cross-company access passed')
    console.log('Material nudge scores: notification and received detail, China exclusion, and read-only access passed')
    console.log('Material nudge confirmation: recipient scope, read vs. confirmed, stale snapshot, retry and retained history passed')
  } finally { await db.close() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await verify()
