import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const root=process.cwd(), dir=path.join(root,'.tmp/product-read-load')
await mkdir(dir,{recursive:true})
await writeFile(path.join(dir,'client.ts'), `
export const calls=[];export let rows=[];export let rpcError=null;
export function setup(next,error=null){rows=next;rpcError=error;calls.length=0}
export function getSupabase(){return {
 rpc:async(name,args)=>{calls.push({rpc:name,args});return {data:{a:3,b:0},error:rpcError}},
 from:table=>{let columns='',filters={},from=0,to=999;const q={
 select(c){columns=c;return q},eq(k,v){filters[k]=v;return q},order(){return q},
 range(a,b){from=a;to=b;return q},
 then(ok,bad){calls.push({table,columns,filters,from,to});let result=rows.filter(r=>r.brand_id===filters.brand_id&&r.set_id===filters.set_id).slice(from,to+1);
 if(!columns.includes('source_product_name'))result=result.map(r=>Object.fromEntries(Object.entries(r).filter(([k])=>columns.includes(k))));
 return Promise.resolve({data:result,error:null,count:3}).then(ok,bad)}
 };return q}
}}
`)
await writeFile(path.join(dir,'entry.ts'), `
export {getWarehouseStockSummary,listWarehouseStockPositions} from '@/lib/supabase/warehouse-stock';
export {summarizeWarehouseStockByStyle} from '@/lib/warehouse/stock';
export {countStylesByBrand} from '@/lib/supabase/styles';
export {createCoalescedReadFetch} from '@/lib/supabase/coalesced-read-fetch';
export * from './client';
`)
const outfile=path.join(dir,'test.mjs')
await build({entryPoints:[path.join(dir,'entry.ts')],outfile,bundle:true,platform:'node',format:'esm',
 alias:{'@/lib/supabase/client':path.join(dir,'client.ts'),'@':path.join(root,'src')},logLevel:'silent'})
const m=await import(pathToFileURL(outfile))
const rows=Array.from({length:2101},(_,i)=>({id:String(i),brand_id:'a',set_id:'set',warehouse_id:'warehouse',location_id:String(i),
 normalized_style_no:`M-${i%7}`,source_product_name:'unused large product text '.repeat(80),source_style_no:'unused',
 received_on:i%3?'2026-10-01':null,received_on_raw:'',is_forced_priority:i%17===0,is_final_location:i%13===0,
 usage_priority:[null,'fifo','first','last','second'][i%5],quantity_status:i%11?'known':'unknown',
 units_per_box:i%19?10:null,remaining_boxes:i%23?2:null,opened_units:i%4,source_row_number:i,
 review_flags:[],warehouse_locations:i%2?[{code:`${i}`,zone:'picking'}]:{code:`${i}`,zone:'box_storage'}}))
m.setup(rows)
const expected=m.summarizeWarehouseStockByStyle(await m.listWarehouseStockPositions('a','set'))
const fullCalls=[...m.calls];m.setup(rows)
assert.deepEqual(await m.getWarehouseStockSummary('a','set'),expected,'same totals/unknown quantities/priority/location across 3 pages')
assert.equal(m.calls.length,3)
assert.ok(m.calls.every(c=>!c.columns.includes('source_product_name')&&c.columns.includes('warehouse_locations!inner')))
assert.ok(m.calls.every((c,i)=>c.from===fullCalls[i].from&&c.to===fullCalls[i].to))
m.setup(rows);assert.equal((await m.getWarehouseStockSummary('other','set')).size,0,'brand scope preserved')
m.setup([]);assert.deepEqual(await m.countStylesByBrand([]),{});assert.equal(m.calls.length,0)
assert.deepEqual(await m.countStylesByBrand(['a','b','a']),{a:3,b:0})
assert.equal(m.calls.length,1);assert.deepEqual(m.calls[0].args.p_brand_ids,['a','b'])
m.setup([],{code:'42501',message:'permission denied'})
await assert.rejects(m.countStylesByBrand(['a']));assert.equal(m.calls.length,1,'permission errors do not fall back')
m.setup([],{code:'PGRST202',message:'missing RPC'});await m.countStylesByBrand(['a'])
assert.equal(m.calls.length,2,'old server retains exact count fallback')

let requests=0,fail=false
const fetcher=async()=>{requests++;await new Promise(r=>setTimeout(r,10));if(fail)throw Error('offline');return new Response('[1]',{headers:{'content-type':'application/json'}})}
const fetch=m.createCoalescedReadFetch('https://fixture.local',fetcher)
const url='https://fixture.local/rest/v1/rpc/list_my_home_work_notifications'
const options={method:'POST',body:'{}',headers:{Authorization:'Bearer ordinary-employee'}}
assert.deepEqual(await Promise.all(Array.from({length:12},async(_,i)=> (await fetch(url,{...options,headers:{...options.headers,'x-client-info':`atelier diagnostic/flow-${i}/notification/list_work_notices/db_request`}})).json())),Array.from({length:12},()=>[1]))
assert.equal(requests,1,'12 ordinary employee overlapping reads send one request')
await fetch(url,options);assert.equal(requests,2,'completed results are not cached')
await Promise.all([fetch(url,options),fetch(url,{...options,headers:{Authorization:'Bearer other-employee'}})])
assert.equal(requests,4,'account tokens never share results')
const old=fetch(url,options);await fetch('https://fixture.local/rest/v1/rpc/read_notice',{method:'POST'});await fetch(url,options);await old
assert.equal(requests,7,'writes invalidate pending reads')
await Promise.all([fetch(url,{...options,signal:new AbortController().signal}),fetch(url,{...options,signal:new AbortController().signal})]);assert.equal(requests,9)
fail=true;const failed=await Promise.allSettled([fetch(url,options),fetch(url,options)]);assert.ok(failed.every(r=>r.status==='rejected'))
fail=false;await fetch(url,options);assert.equal(requests,11,'failures released, next retry is fresh')

const db=new PGlite()
try {
await db.exec(`create role authenticated;create role anon;create schema auth;create schema app;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table public.styles(id uuid,brand_id uuid);alter table public.styles enable row level security;
create table public.profiles(id uuid,status text,is_admin boolean);
create function app.can_read_brand(uuid) returns boolean language sql stable security definer as $$select exists(select 1 from public.profiles where id=auth.uid() and status='active')$$;
create function app.can_edit_brand(uuid) returns boolean language sql stable as $$select false$$;
create policy styles_all_member on public.styles for all using(app.can_read_brand(brand_id)) with check(app.can_edit_brand(brand_id));
grant usage on schema auth,app to authenticated,anon;grant select on public.styles to authenticated,anon;
insert into public.profiles values('11111111-1111-4111-8111-111111111111','active',false),('22222222-2222-4222-8222-222222222222','pending',false);
insert into public.styles values('33333333-3333-4333-8333-333333333333','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),('44444444-4444-4444-8444-444444444444','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');`)
const policies=await db.query('select * from pg_policies')
await db.exec(await readFile('supabase/migrations/20261104074533_grouped_brand_style_counts.sql','utf8'))
assert.deepEqual(await db.query('select * from pg_policies'),policies,'policies unchanged')
for(const uid of ['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222']) {
 await db.exec(`set role authenticated;set request.jwt.claim.sub='${uid}'`)
 const old=(await db.query('select count(*)::int n from public.styles')).rows[0].n
 const next=(await db.query("select public.count_brand_styles(array['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']::uuid[]) result")).rows[0].result
 assert.equal(next['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],old);assert.equal(next['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'],0)
 await db.exec('reset role')
}
await db.exec('set role anon')
await assert.rejects(db.query('select public.count_brand_styles(array[]::uuid[])'),e=>e.code==='42501')
await db.exec('reset role')
assert.equal((await db.query('select count(*)::int n from public.styles')).rows[0].n,2)
await db.exec(`insert into public.styles select md5(i::text)::uuid,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid from generate_series(1,2000)i;
create or replace function app.can_read_brand(uuid) returns boolean language plpgsql stable security definer as $$begin raise notice 'brand_read_guard';return exists(select 1 from public.profiles where id=auth.uid() and status='active');end$$;
set role authenticated;set request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';`)
const notices=[]
const before=(await db.query('select count(*)::int n from public.styles',[],{onNotice:n=>notices.push(n.message)})).rows[0].n
const oldChecks=notices.length;notices.length=0
const after=(await db.query("select public.count_brand_styles(array['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']::uuid[]) result",[],{onNotice:n=>notices.push(n.message)})).rows[0].result
assert.equal(before,2002);assert.equal(after['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],before)
assert.equal(notices.length,2);assert.ok(oldChecks>=2002,'old permission evaluates per SKU, new per requested brand')
console.log(JSON.stringify({fixturePermissionChecks:{old:oldChecks,next:notices.length},skuCountPreserved:before}))
} finally {await db.close()}
console.log(JSON.stringify({result:'PASS',warehousePages:3,stockSummaryParity:true,ordinaryEmployeeCoalesced:12,transportRequests:1,accountIsolation:true,writeInvalidation:true,sqlCountRlsParity:true,anonDenied:true,sharedDbApplied:false}))
