import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const db=await PGlite.create()
const company='10000000-0000-4000-8000-000000000001', foreign='10000000-0000-4000-8000-000000000002'
const host='20000000-0000-4000-8000-000000000001', member='20000000-0000-4000-8000-000000000002', outsider='20000000-0000-4000-8000-000000000003', admin='20000000-0000-4000-8000-000000000004', alien='20000000-0000-4000-8000-000000000005'
const id='30000000-0000-4000-8000-000000000001', rid='40000000-0000-4000-8000-000000000001'
const actor=async who=>db.exec(`reset role; select set_config('request.jwt.claim.sub','${who}',false); set role authenticated;`)
const scalar=async(sql,params)=>Object.values((await db.query(sql,params)).rows[0])[0]
async function denied(sql,params,code='42501'){await assert.rejects(()=>db.query(sql,params),error=>error.code===code)}
const original=async()=>scalar(`select md5(jsonb_agg(to_jsonb(p) order by id)::text) from public.profiles p`)
let series={id,title:'실제 저장 검증',host:{id:host},members:[{id:member}],status:'in_progress',durationMinutes:60,rounds:[{id:rid,round:1,roomId:'room-1',startsAt:'2030-01-07T10:00',prepMaterials:[],content:'',result:''}]}
try{
 await db.exec(`create role anon; create role authenticated; create schema auth; create schema app; create schema storage;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public,app,auth,storage to authenticated,anon;
 create table public.companies(id uuid primary key);
 create table public.departments(id uuid primary key,name text);
 create table public.profiles(id uuid primary key,company_id uuid,display_name text,status text,is_admin boolean,department_id uuid,position text);
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
 alter table storage.objects enable row level security; grant select,insert,delete on storage.objects to authenticated;
 create function app.is_admin() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.profiles where id=auth.uid() and status='active' and is_admin) $$;
 insert into public.companies values('${company}'),('${foreign}');
 insert into public.profiles(id,company_id,display_name,status,is_admin,position) values
 ('${host}','${company}','주최자','active',false,'사원'),('${member}','${company}','참석자','active',false,'사원'),
 ('${outsider}','${company}','비참석자','active',false,'팀장'),('${admin}','${company}','기존 회의 운영자','active',true,'사원'),('${alien}','${foreign}','다른 회사','active',true,'사원');`)
 const before=await original()
 const file=(await fs.readdir('supabase/migrations')).find(name=>name.endsWith('_company_meetings.sql'))
 await db.exec(await fs.readFile('supabase/migrations/'+file,'utf8'))
 const cleanup=(await fs.readdir('supabase/migrations')).find(name=>name.endsWith('_meeting_file_cleanup.sql'))
 await db.exec(await fs.readFile('supabase/migrations/'+cleanup,'utf8'))
 const limits=(await fs.readdir('supabase/migrations')).find(name=>name.endsWith('_meeting_booking_limits.sql'))
 await db.exec(await fs.readFile('supabase/migrations/'+limits,'utf8'))
 assert.equal(await original(),before,'기존 사용자·승인·직책은 변경하지 않음')
 await actor(host)
 assert.equal((await scalar('select public.list_meeting_directory()')).length,4)
 let revision=await scalar('select public.save_company_meeting($1,$2)',[series,0])
 assert.equal(revision,1)
 let loaded=await scalar('select public.list_company_meetings()')
 assert.equal(loaded[0].rounds[0].startsAt,'2030-01-07T10:00','한국 시간 보존')
 await actor(member)
 assert.equal((await scalar('select public.list_company_meetings()'))[0].id,id,'다른 참석자 계정에 공유')
 series={...loaded[0],rounds:loaded[0].rounds.map(row=>({...row,content:'참석자 회의록',result:'공유된 결과'}))}
 revision=await scalar('select public.save_company_meeting($1,$2)',[series,revision])
 await denied('select public.save_company_meeting($1,$2)',[series,1],'40001')
 await denied('select public.save_company_meeting($1,$2)',[series,null],'40001')
 await denied('select public.delete_company_meeting($1,$2)',[id,revision])
 const reservation=await scalar('select public.begin_meeting_file($1,$2,$3,$4)',[rid,'회의 자료.txt','text/plain',4])
 await denied('select public.finish_meeting_file($1)',[reservation.id],'P0001')
 await db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',['company-meetings',reservation.path,{size:4}])
 await db.query('select public.finish_meeting_file($1)',[reservation.id])
 await actor(host)
 loaded=await scalar('select public.list_company_meetings()')
 assert.equal(loaded[0].rounds[0].content,'참석자 회의록')
 assert.equal(loaded[0].rounds[0].prepMaterials[0].name,'회의 자료.txt')
 assert.equal(await scalar('select count(*) from storage.objects'),1,'초대한 다른 직원이 파일을 읽을 수 있음')
 await denied('select public.remove_meeting_file($1)',[reservation.id])
 await actor(outsider)
 assert.equal((await scalar('select public.list_company_meetings()')).length,0)
 assert.equal(await scalar('select count(*) from public.meeting_series'),0)
 assert.equal(await scalar('select count(*) from storage.objects'),0,'비참석자 파일 직접 조회 차단')
 const calendar=await scalar("select public.list_meeting_calendar('2030-01-01','2030-01-31')")
 assert.equal(calendar.length,1)
 assert.equal(calendar[0].title,'예약된 회의','제목·참석자·회의록을 유출하지 않는 예약 정보')
 await denied('select public.save_company_meeting($1,$2)',[series,revision])
 const duplicate={...series,id:'30000000-0000-4000-8000-000000000002',host:{id:outsider},members:[{id:host}],rounds:[{...series.rounds[0],id:'40000000-0000-4000-8000-000000000002'}]}
 await denied('select public.save_company_meeting($1,$2)',[duplicate,0],'23P01')
 const late={...duplicate,durationMinutes:180,rounds:[{...duplicate.rounds[0],startsAt:'2030-01-07T23:00',durationMinutes:180}]}
 await denied('select public.save_company_meeting($1,$2)',[late,0],'23514')
 await denied('insert into public.meeting_members(company_id,series_id,profile_id) values($1,$2,$3)',[company,id,outsider])
 await actor(alien)
 assert.equal((await scalar('select public.list_company_meetings()')).length,0)
 assert.equal((await scalar("select public.list_meeting_calendar('2030-01-01','2030-01-31')")).length,0,'타사 관리자도 격리')
 await actor(member)
 await db.query('select public.remove_meeting_file($1)',[reservation.id])
 assert.equal(await scalar('select count(*) from storage.objects'),1,'Storage remove가 필요한 SELECT 권한도 원래 읽던 업로더에게만 제공')
 await denied('select public.finish_meeting_cleanup($1)',[[reservation.path]],'P0001')
 await db.query('delete from storage.objects where name=$1',[reservation.path])
 await db.query('select public.finish_meeting_cleanup($1)',[[reservation.path]])
 assert.equal((await scalar('select public.list_meeting_cleanup_paths()')).length,0)
 assert.equal(await scalar('select count(*) from storage.objects'),0)
 await actor(host)
 await denied('select public.begin_meeting_file($1,$2,$3,$4)',[rid,'실행.exe','application/octet-stream',4],'P0001')
 await denied('select public.begin_meeting_file($1,$2,$3,$4)',[rid,'대용량.txt','text/plain',52428801],'P0001')
 series={...loaded[0],rounds:[...loaded[0].rounds,{id:'40000000-0000-4000-8000-000000000003',round:2,roomId:'',startsAt:'',content:'',result:''}]}
 revision=await scalar('select public.save_company_meeting($1,$2)',[series,revision])
 assert.equal((await scalar('select public.list_company_meetings()'))[0].rounds.length,2,'다음 차 예정 저장')
 series={...series,status:'done'}
 revision=await scalar('select public.save_company_meeting($1,$2)',[series,revision])
 assert.equal((await scalar('select public.list_company_meetings()'))[0].status,'done')
 await actor(admin)
 assert.equal((await scalar('select public.list_company_meetings()')).length,1,'기존 회의 운영 권한 유지')
 await db.query('select public.delete_company_meeting($1,$2)',[id,revision])
 assert.equal((await scalar('select public.list_company_meetings()')).length,0)
 assert.equal((await scalar("select public.list_meeting_calendar('2030-01-01','2030-01-31')")).length,0)
 await db.exec('reset role')
 assert.equal(await original(),before)
 console.log('meetings-db: 저장·재조회·참석자 공유·회의록/회차/파일·동시 수정/중복 예약·비참석/타사 차단·기존 사용자 보존 통과')
}finally{await db.close()}
