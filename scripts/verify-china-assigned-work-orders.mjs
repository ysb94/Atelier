import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const company = 'e0000000-0000-4000-8000-000000000001'
const china = 'bf926822-910c-422f-9c17-5fd3d8ddb3ba'
const id = n => `60000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const sql = async (name) => (await readFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8')).replace(/\r\n/g, '\n')
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
const act = (draftId, key, action, kind = 'sample', rev = revision, assignee = null) =>
  db.query('select app.china_work_order($1,$2,$3,$4,$5,$6)', [draftId, key, kind, action, assignee, rev])
try {
  await db.exec(`
    create schema app; create schema auth; create schema storage; create role authenticated; create role anon;
    grant usage on schema app to authenticated;
    grant usage on schema storage to authenticated;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
    create table storage.objects(bucket_id text,name text,metadata jsonb,primary key(bucket_id,name));
    alter table storage.objects enable row level security;
    grant select,insert on storage.objects to authenticated;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.profiles(id uuid primary key, company_id uuid, department_id uuid, status text, display_name text);
    create table public.department_workforce_policies(company_id uuid,department_id uuid,mode text,contact_ids uuid[]);
    create table public.product_drafts(id uuid primary key,company_id uuid,updated_at timestamptz,status text,
      origin_country text,draft_no text,brand_id uuid,name_ko text,name_en text,image_url text,owner text,
      sample_work_orders jsonb,specs jsonb);
    create table public.draft_colors(id uuid,draft_id uuid,sample_work_order_url text,sample_work_order_shipped boolean,sample_work_order_shipped_at timestamptz);
    grant select,update on public.product_drafts to authenticated;
    create function app.work_department(text) returns uuid language sql as $$select '${china}'::uuid$$;
    create function app.permission_company_id() returns uuid language sql stable as $$select company_id from public.profiles where id=auth.uid() and status='active'$$;
    create function app.basic_work_allowed(text) returns boolean language sql stable as $$select app.permission_company_id()='${company}'::uuid$$;
    create function app.work_operator() returns boolean language sql stable as $$select false$$;
    create function app.basic_work_allowed(text,uuid) returns boolean language sql stable as
      $$select $1='planning' and auth.uid()='60000000-0000-4000-8000-000000000004'::uuid$$;
    create function app.draft_write_allowed(uuid) returns boolean language sql stable as
      $$select $1='60000000-0000-4000-8000-000000000013'::uuid and auth.uid()='60000000-0000-4000-8000-000000000004'::uuid$$;
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
  await db.exec(await sql('20261124121357_require_china_work_order_receipt_before_shipping'))
  await db.exec(await sql('20261125100000_sample_work_order_packs'))
  await db.exec(await sql('20261125100001_sample_work_order_attachment_capacity'))
  assert.deepEqual((await db.query("select public,file_size_limit::text from storage.buckets where id='sample-work-orders'")).rows,
    [{ public:false,file_size_limit:'10000000000' }])
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
    [id(12), id(2), [order('theirs', id(2)), { ...order('completed', id(2)), ...received, assigneeCheckedAt: assignedAt }], [order('their-color', id(2), '')]],
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
  await assert.rejects(act(id(11), 'mine', 'ship'), { code: '55000' })
  await assert.rejects(act(id(11), 'color', 'ship', 'color'), { code: '55000' })
  assert.deepEqual(await read(), before, 'Blocked shipping leaves receipt, shipment and revision unchanged')
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
  await assert.rejects(act(id(11), 'color', 'ship', 'color', shipped.revision), { code: '55000' })
  await act(id(11), 'color', 'check', 'color', shipped.revision)
  const checkedColor = (await read()).orders.find(row => row.orderId === 'color')
  assert.ok(checkedColor.assigneeCheckedAt)
  await act(id(11), 'color', 'ship', 'color', checkedColor.revision)
  assert.ok((await read()).orders.every(row => row.closed))
  await asActor(id(2))
  assert.deepEqual((await read()).orders.map(row => row.orderId).sort(), ['completed', 'their-color', 'theirs'])
  await asActor(id(3))
  const manager = await read()
  assert.equal(manager.role, 'manager')
  assert.deepEqual(manager.orders, [])
  await assert.rejects(act(id(12), 'theirs', 'ship'), { code: '55000' })
  await assert.rejects(act(id(12), 'their-color', 'ship', 'color'), { code: '55000' })
  await assert.rejects(act(id(12), 'theirs', null), /지원하지 않는 지시서 작업/)
  await act(id(12), 'theirs', 'check')
  const managerChecked = (await read()).revision
  await assert.rejects(act(id(12), 'theirs', 'ship', 'sample', managerChecked), { code: '55000' })
  await asActor(id(2))
  await act(id(12), 'theirs', 'check', 'sample', managerChecked)
  const initialReceipt = (await read()).orders.find(row => row.orderId === 'theirs')
  await act(id(12), 'their-color', 'check', 'color', initialReceipt.revision)
  const lastReceipt = (await read()).orders.find(row => row.orderId === 'their-color')
  await asActor(id(3))
  await act(id(12), 'theirs', 'handoff', 'sample', lastReceipt.revision, id(1))
  await asActor(id(1))
  const reassigned = (await read()).orders.filter(row => row.draftId === id(12))
  assert.equal(reassigned.find(row => row.orderId === 'theirs').assigneeCheckedAt, null)
  assert.equal(reassigned.find(row => row.orderId === 'their-color').assigneeCheckedAt, null)
  assert.equal(reassigned.find(row => row.orderId === 'completed').assigneeCheckedAt, assignedAt)
  const newRevision = reassigned[0].revision
  await assert.rejects(act(id(12), 'theirs', 'ship', 'sample', newRevision), { code: '55000' })
  await act(id(12), 'theirs', 'check', 'sample', newRevision)
  const newReceipt = (await read()).orders.find(row => row.orderId === 'theirs')
  await asActor(id(3))
  await act(id(12), 'theirs', 'ship', 'sample', newReceipt.revision)
  assert.notEqual((await read()).revision, manager.revision)
  await asActor(id(4))
  assert.deepEqual(await read(), { role: 'denied', orders: [] })

  await db.exec('reset role')
  await db.query("insert into public.product_drafts values ($1,$2,clock_timestamp(),'open','중국','PL-pack',null,'fixture','',null,'','[]','{}')",[id(13),company])
  const packCall=async (name,args)=>{
    const query='select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') as result'
    return (await db.query(query,args)).rows[0].result
  }
  const getPack=packId=>packCall('get_sample_work_order_pack',[packId,null,null])
  const openPack=slot=>packCall('open_sample_work_order_pack',[id(13),slot])
  const savePack=(pack,files,notes='지퍼 길이 확인')=>packCall('save_sample_work_order_pack',[pack.id,pack.revision,JSON.stringify(files),notes])
  const receivePack=(pack,stamp)=>packCall('receive_sample_work_order_pack',[pack.id,stamp])
  const readStamp=async ()=>(await db.query('select updated_at::text as stamp from public.product_drafts where id=$1',[id(13)])).rows[0].stamp
  const upload=async (pack,key,name,size=42)=>{
    const path=pack.id+'/'+id(key)
    await db.query("insert into storage.objects values('sample-work-orders',$1,$2)",[path,JSON.stringify({size})])
    return {path,name,size,sha256:'0'.repeat(64)}
  }
  const publish=async (pack)=>{
    const rounds=[{...order('packed',null),url:'atelier-sample-pack:'+pack.id+':'+pack.revision}]
    await db.query('update public.product_drafts set sample_work_orders=$2,updated_at=clock_timestamp() where id=$1',[id(13),JSON.stringify(rounds)])
  }

  const firstPack=await openPack('first')
  assert.equal((await openPack('first')).id,firstPack.id)
  const sheet=await upload(firstPack,31,'치수.xlsx')
  const saved=await savePack(firstPack,[sheet])
  await assert.rejects(savePack(firstPack,[sheet]),{code:'40001'})
  await assert.rejects(publish(firstPack),{code:'22023'})
  assert.equal((await getPack(saved.id)).files.length,1)
  const image=await upload(saved,32,'참고.jpg')
  const finalPack=await savePack(saved,[sheet,image])
  const largePack=await openPack('next')
  const art=await upload(largePack,50,'시안.ai',10_000_000_000)
  const artOnly=await savePack(largePack,[art])
  const manyFiles=await Promise.all(Array.from({length:11},(_,index)=>upload(largePack,51+index,`참고 ${index}.pdf`)))
  await assert.rejects(savePack(artOnly,[art,...manyFiles]),{code:'22023'})
  await assert.rejects(savePack(artOnly,[{...art,size:art.size-1}]),{code:'22023'})
  await assert.rejects(savePack(artOnly,[{...art,path:art.path+'-missing'}]),{code:'22023'})
  await assert.rejects(savePack(artOnly,[manyFiles[0],manyFiles[0]]),{code:'22023'})
  assert.equal((await savePack(artOnly,manyFiles)).files.length,11)
  await asActor(id(3))
  await assert.rejects(getPack(finalPack.id),{code:'42501'})
  assert.equal((await db.query('select * from storage.objects where name=$1',[sheet.path])).rows.length,0)
  await asActor(id(4))
  await publish(finalPack)
  assert.equal((await getPack(finalPack.id)).published,true)
  await asActor(id(3))
  assert.equal((await getPack(finalPack.id)).files.length,2)
  let packRevision=await readStamp()
  await assert.rejects(act(id(13),'packed','handoff','sample',packRevision,id(1)),{code:'55000'})
  await assert.rejects(act(id(13),'packed','check','sample',packRevision),{code:'55000'})
  await receivePack(finalPack,packRevision)
  packRevision=await readStamp()
  await act(id(13),'packed','handoff','sample',packRevision,id(1))
  await asActor(id(2))
  await assert.rejects(getPack(finalPack.id),{code:'42501'})
  await asActor(id(1))
  const pending=(await read()).orders.find(item=>item.draftId===id(13))
  assert.equal(pending.packId,finalPack.id)
  assert.equal(pending.managerChecked,true)
  assert.equal(pending.assigneeCheckedAt,null)
  await assert.rejects(act(id(13),'packed','ship','sample',pending.revision),{code:'55000'})
  await receivePack(finalPack,pending.revision)
  assert.ok((await read()).orders.find(item=>item.draftId===id(13)).assigneeCheckedAt)

  await asActor(id(4))
  const edit=await openPack('edit:packed')
  const revisionPack=await savePack(edit,[sheet],'치수표 수정')
  await db.query("update public.product_drafts set sample_work_orders=jsonb_set(sample_work_orders,'{0,url}',to_jsonb($2::text)),updated_at=clock_timestamp() where id=$1",
    [id(13),'atelier-sample-pack:'+revisionPack.id+':'+revisionPack.revision])
  await asActor(id(1))
  await assert.rejects(getPack(finalPack.id),{code:'42501'})
  assert.equal((await db.query('select * from storage.objects where name=$1',[sheet.path])).rows.length,1)
  const changed=(await read()).orders.find(item=>item.draftId===id(13))
  assert.equal(changed.packId,revisionPack.id)
  assert.equal(changed.assigneeCheckedAt,null)
  assert.equal(changed.managerChecked,false)
  await receivePack(revisionPack,changed.revision)
  await assert.rejects(act(id(13),'packed','ship','sample',await readStamp()),{code:'55000'})
  await asActor(id(3))
  await receivePack(revisionPack,await readStamp())
  await asActor(id(1))
  await act(id(13),'packed','ship','sample',await readStamp())
  assert.ok((await read()).orders.find(item=>item.draftId===id(13)).returnedAt)

  await asActor('', 'anon')
  await assert.rejects(read(), { code: '42501' })
  await assert.rejects(getPack(finalPack.id),{code:'42501'})
  console.log('China work: scoped reads and files, role restrictions, sample and color dispatch, duplicate guard, manager compatibility passed.')
} finally {
  await db.close()
}
