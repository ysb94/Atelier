import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'

const db=await PGlite.create(),company='e0000000-0000-4000-8000-000000000001'
const planning='ced99f89-ea80-4eeb-8f03-272bf72f5db1',china='bf926822-910c-422f-9c17-5fd3d8ddb3ba'
const author='10000000-0000-4000-8000-000000000001',colleague='10000000-0000-4000-8000-000000000002',worker='10000000-0000-4000-8000-000000000006'
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0]
const actor=async id=>db.exec(`reset role;select set_config('request.jwt.claim.sub','${id}',false);set role authenticated`)
try{
 await db.exec(await readFile('supabase/tests/department_work_fixture.sql','utf8'))
 await db.exec(await readFile('supabase/migrations/20261027044909_department_work_access.sql','utf8'))
 await db.query('insert into public.companies(id) values($1)',[company])
 for(const [id,name] of [[planning,'기획팀'],[china,'중국팀']])await db.query('insert into public.departments(id,company_id,name,is_active) values($1,$2,$3,true)',[id,company,name])
 for(const [id,department] of [[author,planning],[colleague,planning],[worker,china]])await db.query("insert into public.profiles(id,company_id,department_id,display_name,status,is_admin,position) values($1,$2,$3,$4,'active',false,'')",[id,company,department,id])
 await actor(author)
 const original={id:'sample-1',round:1,url:'data:text/plain,first',name:'first.pdf',shipped:false,shippedAt:'2026-10-20T01:00:00Z',returnedAt:null,receivedAt:null,passed:false,passedAt:null,failReason:'',assigneeId:null,assigneeName:'',fileCheckedAt:null}
 const draft=await scalar("select public.save_product_draft($1,null,null,$2,'[]','[]')",[company,{nameKo:'샘플 수령 검증',originCountry:'중국',sampleWorkOrders:[original]}])
 const revision=()=>scalar('select updated_at::text from public.product_drafts where id=$1',[draft])
 const orders=()=>scalar('select sample_work_orders from public.product_drafts where id=$1',[draft])
 await actor(worker)
 for(const action of ['assign','check','ship'])await db.query("select public.apply_china_work_order($1,'sample-1','sample',$2,$3,$4)",[draft,action,action==='assign'?worker:null,await revision()])
 const dispatched=(await orders())[0];assert.ok(dispatched.returnedAt)
 await actor(author)
 const receiptAt=new Date().toISOString(),received={...dispatched,receivedAt:receiptAt,originCountry:'중국'}
 await db.query("select public.save_product_draft($1,null,$2,$3,'[]','[]')",[company,draft,{nameKo:'샘플 수령 검증',originCountry:'중국',sampleWorkOrders:[received],expectedUpdatedAt:await revision()}])
 assert.equal((await orders())[0].receivedAt,receiptAt,'기존 저장 함수가 새 수령일을 저장·조회')
 assert.equal((await orders())[0].returnedAt,dispatched.returnedAt,'중국 발송일 보존')
 assert.equal((await orders())[0].passed,false,'수령이 합격 처리가 되지 않음')
 const second={...original,id:'sample-2',round:2,url:'data:text/plain,second',name:'second.pdf',shippedAt:new Date().toISOString(),originCountry:'한국',sampleStage:'final'}
 await db.query("select public.save_product_draft($1,null,$2,$3,'[]','[]')",[company,draft,{nameKo:'샘플 수령 검증',originCountry:'한국',sampleWorkOrders:[received,second],expectedUpdatedAt:await revision()}])
 assert.equal((await orders()).length,2);assert.equal((await orders())[0].receivedAt,receiptAt)
 assert.equal((await orders())[1].originCountry,'한국');assert.equal((await orders())[1].receivedAt,null)
 assert.equal((await orders())[1].sampleStage,'final','새 테이블 없이 기존 저장 함수가 최종 샘플 종류를 보존')
 const after=await orders();await actor(colleague)
 await assert.rejects(()=>db.query("select public.save_product_draft($1,null,$2,$3,'[]','[]')",[company,draft,{nameKo:'위조',sampleWorkOrders:after}]))
 assert.deepEqual(await orders(),after,'다른 직원의 수정 권한을 확대하지 않음')
 console.log('sample-receipt-db: 기존 저장·중국팀 발송 함수의 수령일/차수별 국가 저장·재조회, 발송일·과거 차수 보존, 작성자 권한 유지 통과 (로컬 임시 DB)')
}finally{await db.close()}
