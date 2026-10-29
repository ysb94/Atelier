import {PGlite} from '@electric-sql/pglite'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
const [beforePath,preparedPrefix]=process.argv.slice(2)
if(!preparedPrefix)throw Error('Usage: node scripts/verify-leave-baseline-import.mjs before.json prepared-prefix')
const before=JSON.parse(await fs.readFile(beforePath,'utf8')),plan=JSON.parse(await fs.readFile(preparedPrefix+'.json','utf8')),sql=await fs.readFile(preparedPrefix+'.sql','utf8')
for(const scenario of ['apply','stale-balance','new-request']){
 const db=await PGlite.create()
 try{
  await db.exec(`create role anon;create role authenticated;create schema app;create schema auth;create schema cron;
   create function auth.uid() returns uuid language sql as $$select null::uuid$$;
   create function app.can_edit_org_assignment() returns boolean language sql as $$select false$$;
   create table companies(id uuid primary key);
   create table profiles(id uuid primary key,company_id uuid,status text,display_name text,hire_date date);
   create table app.leave_balance_entries(request_id uuid primary key,employee_id uuid,company_id uuid,days numeric,refunded_at timestamptz);
   create table cron.job(jobname text primary key,schedule text,command text);
   create function cron.schedule(n text,s text,c text) returns bigint language plpgsql as $$begin insert into cron.job values(n,s,c);return 1;end$$;
   insert into companies values('e0000000-0000-4000-8000-000000000001');`)
  await db.exec(await fs.readFile('supabase/migrations/20261026112500_employee_roster.sql','utf8'))
  await db.exec(await fs.readFile('supabase/migrations/20261026122732_employee_remaining_annual_leave.sql','utf8'))
  await db.exec(await fs.readFile('supabase/migrations/20261029093102_employee_leave_import.sql','utf8'))
  await db.exec(await fs.readFile('supabase/migrations/20261029093112_employee_leave_anniversary_accrual.sql','utf8'))
  await db.exec("select set_config('app.roster_import','on',false)")
  for(const p of before.staff){
   await db.query('insert into profiles values($1,$2,$3,$4,$5)',[p.id,p.company_id,p.status,p.name,p.hire_date])
   if(p.roster_exists)await db.query("insert into employee_roster(profile_id,company_id,remaining_annual_leave,note) values($1,$2,$3,'기존 메모')",[p.id,p.company_id,p.remaining])
  }
  if(scenario==='stale-balance')await db.query('update employee_roster set remaining_annual_leave=999 where profile_id=$1',[plan.matched[0].id])
  if(scenario==='new-request')await db.query('insert into app.leave_balance_entries values(gen_random_uuid(),$1,$2,1,null,null)',[plan.matched[0].id,plan.matched[0].company])
  const fingerprint=async()=>JSON.stringify((await db.query('select id,hire_date,status from profiles order by id')).rows)
  const original=await fingerprint()
  if(scenario!=='apply'){
   await assert.rejects(()=>db.exec(sql),/변경|새 휴가/);await db.exec('rollback');assert.equal(await fingerprint(),original)
   assert.equal((await db.query('select * from app.employee_leave_accrual')).rows.length,0,'충돌 시 부분 적용 없음')
   continue
  }
  await db.exec(sql)
  const rows=(await db.query('select p.id,p.status,p.hire_date::text,r.accrued_annual_leave::float "grant",r.remaining_annual_leave::float remaining,r.note from profiles p left join employee_roster r on r.profile_id=p.id')).rows
  for(const old of before.staff){
   const r=rows.find(p=>p.id===old.id),next=plan.matched.find(p=>p.id===old.id)
   assert.equal(r.status,old.status)
   assert.equal(r.hire_date,next?.hire??old.hire_date)
   assert.equal(r.remaining,next?next.remaining:old.remaining===null?null:Number(old.remaining))
   assert.equal(r.grant,next?.grant??null)
   if(old.roster_exists)assert.equal(r.note,'기존 메모')
  }
  assert.equal((await db.query('select * from app.employee_leave_accrual')).rows.length,25)
  assert.equal((await db.query('select * from app.leave_balance_entries')).rows.length,0,'과거 사용내역 생성 없음')
  await assert.rejects(()=>db.exec(sql),/직원 정보가 변경|이미 초기화/);await db.exec('rollback')
  console.log('baseline-import: 25명 엑셀 발생/잔여 전부 일치, 승인된 입사일 2명만 변경, 기존 상태·명부 보존, 중복 실행 차단')
 }catch(error){console.error('baseline-import failed:',{scenario,message:error.message,code:error.code,position:error.position,where:error.where});process.exitCode=1;break}finally{await db.close()}
}
if(!process.exitCode)console.log('baseline-import: 준비 후 잔여 변경·새 신청 발생 시 전체 등록 중단 검증 통과')
