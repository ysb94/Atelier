import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

// 검증 전용: verify-meetings-db.mjs에서 만든 인메모리 PGlite만 받는다.
// 서버 연결, Supabase SDK, 환경변수, 네트워크를 사용하지 않는다.
export async function verifyScheduleTodos(db,{company,foreign,host,member,outsider,alien,actor}) {
  assert.ok(db instanceof PGlite,'실제 DB 연결에서는 실행할 수 없는 PGlite 전용 검증')
  const scalar=async(sql,args)=>Object.values((await db.query(sql,args)).rows[0])[0]
  const denied=async(sql,args,code='42501')=>assert.rejects(()=>db.query(sql,args),error=>error.code===code)
  await db.exec('reset role')
  const before=await scalar('select md5(jsonb_agg(to_jsonb(p) order by id)::text) from public.profiles p')
  const policies=await scalar("select md5(jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname)::text) from pg_policies p")
  const availabilityAcl=await scalar("select proacl::text from pg_proc where oid='app.meeting_availability(uuid,date,uuid[],uuid)'::regprocedure")
  const migration=(await fs.readdir('supabase/migrations')).find(name=>name.endsWith('_personal_schedule_todo_availability.sql'))
  await db.exec(await fs.readFile('supabase/migrations/'+migration,'utf8'))
  assert.equal(await scalar("select proacl::text from pg_proc where oid='app.meeting_availability(uuid,date,uuid[],uuid)'::regprocedure"),availabilityAcl,'기존 일정 조회 함수의 실행 권한 유지')
  assert.equal(await scalar("select md5(jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname)::text) from pg_policies p where tablename<>'personal_schedule_todos'"),policies)
  const series='91111111-0000-4000-8000-000000000001'
  await db.query("insert into public.meeting_series(id,company_id,host_id,created_by,title,status,duration_minutes,phase) values($1,$2,$3,$3,'개인 일정 검증','in_progress',60,'preparing')",[series,company,host])
  await actor(member)
  await db.query("insert into public.personal_schedule_todos(company_id,owner_id,client_id,date,title,start_time,end_time,important) values($1,$2,'legacy-1','2030-01-08','PRIVATE 상세 제목','10:15','11:45',true)",[company,member])
  await db.query("insert into public.personal_schedule_todos(company_id,owner_id,client_id,date,title) values($1,$2,'normal','2030-01-08','시간 미지정')",[company,member])
  assert.equal(await scalar('select count(*) from public.personal_schedule_todos'),2)
  await denied("insert into public.personal_schedule_todos(company_id,owner_id,client_id,date,title,important) values($1,$2,'invalid','2030-01-08','중요',true)",[company,member],'23514')
  for(const end of ['10:15','09:00','11:00:01']) await denied("insert into public.personal_schedule_todos(company_id,owner_id,client_id,date,title,start_time,end_time,important) values($1,$2,'invalid','2030-01-08','시간','10:15',$3,true)",[company,member,end],'23514')
  await denied("insert into public.personal_schedule_todos(company_id,owner_id,client_id,date,title) values($1,$2,'spoof','2030-01-08','타인')",[company,host])
  await denied("insert into public.personal_schedule_todos(company_id,owner_id,client_id,date,title) values($1,$2,'spoof','2030-01-08','타사')",[foreign,member])
  await denied("update public.personal_schedule_todos set client_id='changed' where client_id='legacy-1'")
  await actor(host)
  assert.equal(await scalar('select count(*) from public.personal_schedule_todos'),0,'호스트도 타인 원본을 읽지 못함')
  const busy=async()=> (await scalar('select public.list_meeting_availability_with_todos($1,$2,$3,null)',[series,'2030-01-08',[member]])).filter(row=>row.kind==='personal')
  const summary=await busy()
  assert.equal((await scalar('select public.list_meeting_availability($1,$2,$3,null)',[series,'2030-01-08',[member]])).some(row=>row.kind==='personal'),false,'구버전 운영 조회의 반환값 유지')
  assert.equal(summary.length,1);assert.equal(summary[0].start,'10:15');assert.equal(summary[0].end,'11:45')
  assert.ok(!JSON.stringify(summary).includes('PRIVATE'),'작업 제목 비공개')
  assert.deepEqual(Object.keys(summary[0]).sort(),['end','id','kind','personId','start','status'].sort())
  await denied('select public.list_meeting_availability_with_todos($1,$2,$3,null)',[series,'2030-01-08',[alien]])
  await actor(outsider);await denied('select public.list_meeting_availability_with_todos($1,$2,$3,null)',[series,'2030-01-08',[member]])
  await actor(alien);assert.equal(await scalar('select count(*) from public.personal_schedule_todos'),0)
  await actor(member);await db.exec("update public.personal_schedule_todos set done=true where client_id='legacy-1'")
  await actor(host);assert.equal((await busy()).length,0,'완료 시 점유 해제')
  await actor(member);await db.exec("update public.personal_schedule_todos set done=false,important=false where client_id='legacy-1'")
  await actor(host);assert.equal((await busy()).length,0,'중요 해제 시 점유 해제')
  await actor(member);await db.exec("update public.personal_schedule_todos set important=true,deleted_at=now() where client_id='legacy-1'")
  await db.query("insert into public.personal_schedule_todos(company_id,owner_id,client_id,date,title) values($1,$2,'legacy-1','2030-01-08','오래된 브라우저 제목') on conflict(owner_id,client_id) do nothing",[company,member])
  assert.equal(await scalar("select title from public.personal_schedule_todos where client_id='legacy-1'"),'PRIVATE 상세 제목')
  await actor(host);assert.equal((await busy()).length,0,'삭제 후 옛 브라우저 재이전도 점유를 복구하지 않음')
  await db.exec('reset role;set role anon');await denied('select * from public.personal_schedule_todos')
  await db.exec('reset role')
  assert.equal(await scalar('select md5(jsonb_agg(to_jsonb(p) order by id)::text) from public.profiles p'),before)
  console.log('schedule-todos-pglite: 시간, 본인/회사/호스트 경계, 제목 비공개, 완료·중요 해제·삭제, 기존 사용자·정책 보존 통과')
}
