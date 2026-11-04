import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
import {build} from 'esbuild'
import {pathToFileURL} from 'node:url'
import path from 'node:path'
const target=path.resolve('node_modules/.tmp/onboarding-payroll.mjs')
await build({entryPoints:['src/features/org/company-information-values.ts'],bundle:true,outfile:target,platform:'node',format:'esm'})
const {calculateCompanyWage,calculateCompanyPeriods,CALCULATED_WAGE_KEYS,CALCULATED_PERIOD_KEYS}=await import(pathToFileURL(target).href)
const db=await PGlite.create(),company='e0000000-0000-4000-8000-000000000001',other='e0000000-0000-4000-8000-000000000002',ops='2e49ef43-75b9-4c89-b42d-9fd50ad9087b',dept='10000000-0000-4000-8000-000000000009'
const dev='d0000000-0000-4000-8000-000000000001',manager='10000000-0000-4000-8000-000000000001',staff='10000000-0000-4000-8000-000000000002',coworker='10000000-0000-4000-8000-000000000003',outsider='10000000-0000-4000-8000-000000000004',pending='10000000-0000-4000-8000-000000000005'
const delegate='a5afdd00-4a61-44dc-a1a3-082fa8a1345d',ceo='56074867-fdc2-4ce5-8e97-cea431decc36'
const actor=async id=>db.exec(`reset role;select set_config('request.jwt.claim.sub','${id}',false);set role authenticated`)
const val=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0]||{})[0]
const denied=async(sql,args=[])=>assert.rejects(()=>db.query(sql,args))
const get=async id=>val('select get_employee_onboarding($1)',[id])
const save=async(c,section,data)=>val('select save_employee_onboarding($1,$2,$3,$4,$5)',[c.id,section,data,c.version,c.rosterStamp])
try {
await db.exec(`create role anon;create role authenticated;create schema app;create schema auth;create schema storage;grant usage on schema public,app,auth,storage to authenticated;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table companies(id uuid primary key);insert into companies values('${company}'),('${other}');
 create table departments(id uuid primary key,company_id uuid,is_active boolean default true);insert into departments values('${ops}','${company}',true),('${dept}','${company}',true);
 create table profiles(id uuid primary key,company_id uuid,status text,department_id uuid,display_name text,email text,position text,job_grade text,hire_date date,requested_at timestamptz);
 insert into profiles(id,company_id,status,department_id,display_name,email,requested_at) values
 ('${dev}','${company}','active','${dept}','검증 개발자','dev@example.invalid',null),('${manager}','${company}','active','${ops}','검증 관리자','ops@example.invalid',null),
 ('${staff}','${company}','active',null,'검증 직원','staff@example.invalid',now()),('${coworker}','${company}','active','${dept}','검증 동료','peer@example.invalid',null),
 ('${outsider}','${other}','active','${dept}','검증 타사','other@example.invalid',null),('${pending}','${company}','pending',null,'검증 대기','pending@example.invalid',now());
 grant select,update on profiles to authenticated;
 create function app.can_edit_org_assignment() returns boolean language sql stable as $$select exists(select 1 from public.profiles where id=auth.uid() and status='active' and (department_id='${ops}' or id='${dev}'))$$;
 create function app.basic_work_allowed(text) returns boolean language sql stable as $$select app.can_edit_org_assignment()$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,metadata jsonb);alter table storage.objects enable row level security;grant select,insert on storage.objects to authenticated;`)
await db.exec(await readFile('supabase/migrations/20261026112500_employee_roster.sql','utf8'))
await db.exec(`alter table employee_roster add column fixed_overtime_plan text not null default '',add column remaining_annual_leave numeric;
 select set_config('app.roster_import','on',false);insert into employee_roster(profile_id,company_id,phone,note,remaining_annual_leave) values('${staff}','${company}','010-0000-0000','원본 보존',7.5);select set_config('app.roster_import','',false);`)
const before=await val("select md5((select jsonb_agg(p)::text from profiles p)||(select jsonb_agg(r)::text from employee_roster r))")
const policies=await val("select md5(jsonb_agg(p)::text) from pg_policies p where tablename='employee_roster'")
await db.exec(await readFile('supabase/migrations/20261103102140_employee_onboarding.sql','utf8'))
assert.equal(await val("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname like '%employee_onboarding%' and prosecdef"),0)
assert.equal(await val("select public from storage.buckets where id='employee-onboarding'"),false)
assert.equal(await val("select md5((select jsonb_agg(p)::text from profiles p)||(select jsonb_agg(r)::text from employee_roster r))"),before)
assert.equal(await val("select md5(jsonb_agg(p)::text) from pg_policies p where tablename='employee_roster'"),policies)
await actor(manager)
const list=await val('select list_employee_onboardings()');assert.equal(list.length,2)
await db.exec('reset role')
for(const id of [delegate,ceo]){await db.query("insert into profiles(id,company_id,status,department_id) values($1,$2,'active',$3)",[id,company,dept]);await actor(id);assert.equal((await val('select list_employee_onboardings()')).length,2);assert.ok((await get(list[0].id)).company);await db.exec('reset role')}
await actor(manager)
let c=await get(list.find(p=>p.profileId===staff).id)
// 아무 정보·서류가 없어도 지정 관리자가 완료/되돌리기 할 수 있으며 원본은 보존한다.
const blankBefore={personal:c.personal,company:c.company,files:c.files,submittedAt:c.submittedAt}
c=await val('select set_employee_onboarding_complete($1,true,$2)',[c.id,c.version]);assert.ok(c.completedAt)
assert.deepEqual({personal:c.personal,company:c.company,files:c.files,submittedAt:c.submittedAt},blankBefore)
await actor(staff);assert.ok((await val('select get_my_employee_onboarding_status()')).completedAt)
await actor(manager);c=await val('select set_employee_onboarding_complete($1,false,$2)',[c.id,c.version]);assert.equal(c.completedAt,null)
const wage={wageMode:'excel',periodMode:'auto',hireDate:'2026-10-21',documentDate:'2026-11-03',contractTerm:'fixed',contractMonths:'3',wageTerm:'until-change',probationApply:'yes',probationMonths:'3',payBasis:'월급x12개월',workDays:'주5일(월~금)',workStart:'09:00',workEnd:'18:00',breakStart:'13:00',breakEnd:'14:00',workHours:'09:00 ~ 18:00',breakTime:'13:00 ~ 14:00',fixedOvertimePlan:'유형 1',annualSalary:'50400000',mealAllowance:'200000',departmentId:dept,position:'',jobGrade:'사원',basePay:'999999999'}
await db.exec('reset role')
for(const annualSalary of ['30000000','35999999','36000000','36300000','36300012','50400000','77000000']){
 const input={...wage,annualSalary},js=calculateCompanyWage(calculateCompanyPeriods(input)).value,sql=await val('select app.onboarding_company_calculate($1)',[input])
 for(const key of [...CALCULATED_WAGE_KEYS,...CALCULATED_PERIOD_KEYS,'fixedOvertimePlan'])assert.equal(sql[key],js[key],`${annualSalary}:${key}`)
}
await actor(manager)
c=await save(c,'company',wage);assert.equal(c.company.basePay,'3433278');assert.equal(c.company.overtimeAllowance,'566722');assert.equal(c.company.fixedOvertimePlan,'유형 2');assert.equal(c.company.contractEnd,'2027-01-20')
await denied('select save_employee_onboarding($1,$2,$3,$4,$5)',[c.id,'company',wage,null,c.rosterStamp])
let approval=await get(list.find(p=>p.profileId===pending).id);approval=await save(approval,'company',wage)
await db.query("update profiles set status='active' where id=$1",[pending])
assert.equal((await get(approval.id)).company.annualSalary,'50400000')
await db.exec('reset role');assert.equal(await val('select annual_salary from employee_roster where profile_id=$1',[pending]),'50400000');await db.exec('set role authenticated')
const rosterVersion=await val("select updated_at::text from employee_roster where profile_id=$1",[staff])
await actor(staff);c=await get(c.id);assert.equal(c.company,null,'employee must not receive company pay/contract data')
const personal={englishName:'TEST STAFF',residentFront:'940102',residentBack:'1000000',phone:'010-1234-5678',address:'검증 주소',addressDetail:'101호',gmail:'test.staff',naverEmail:'test.staff',bank:'검증은행',accountHolder:'검증 직원',accountNumber:'123-456'}
c=await save(c,'draft',personal);await db.exec('reset role');assert.equal(await val("select updated_at::text from employee_roster where profile_id=$1",[staff]),rosterVersion);await db.exec('set role authenticated')
await denied('select save_employee_onboarding($1,$2,$3,$4,$5)',[c.id,'company',wage,c.version,c.rosterStamp])
await denied('select save_employee_onboarding($1,$2,$3,$4,$5)',[c.id,'submit',personal,c.version,c.rosterStamp])
async function upload(c,kind,name='proof.pdf',mime='application/pdf',size=100){const f=await val('select begin_employee_onboarding_file($1,$2,$3,$4,$5)',[c.id,kind,name,mime,size]);await db.exec('reset role');await db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',['employee-onboarding',f.path,{size,mimetype:mime}]);await db.exec('set role authenticated');return {f,record:await val('select finish_employee_onboarding_file($1)',[f.id])}}
for(const kind of ['identity','bank','education','residentRegister','businessCertificate'])c=(await upload(c,kind)).record
await denied('select begin_employee_onboarding_file($1,$2,$3,$4,$5)',[c.id,'contract','proof.pdf','application/pdf',100])
await denied('select begin_employee_onboarding_file($1,$2,$3,$4,$5)',[c.id,'identity','proof.pdf','application/pdf',10485761])
await denied('select begin_employee_onboarding_file($1,$2,$3,$4,$5)',[c.id,'identity','proof.exe','application/pdf',100])
c=await save(c,'submit',personal);assert.ok(c.submittedAt);assert.equal(c.personal.address,'검증 주소 101호');assert.equal(c.personal.addressDetail,'')
await denied('select save_employee_onboarding($1,$2,$3,$4,$5)',[c.id,'draft',personal,c.version-1,c.rosterStamp])
const ownerFiles=c.files;assert.equal(ownerFiles.length,5)
await actor(coworker);await denied('select get_employee_onboarding($1)',[c.id]);await denied('select list_employee_onboardings()');await denied('select get_employee_onboarding_file_path($1)',[ownerFiles[0].id]);await denied('select * from app.employee_onboardings');assert.equal((await db.query('select phone from employee_roster')).rows.length,0)
await actor(outsider);await denied('select get_employee_onboarding($1)',[c.id]);await denied('select begin_employee_onboarding_file($1,$2,$3,$4,$5)',[c.id,'identity','proof.pdf','application/pdf',100])
await db.exec('reset role');await db.query("update profiles set status='pending' where id=$1",[pending]);await actor(pending);await denied('select get_employee_onboarding($1)',[list.find(p=>p.profileId===pending).id])
await actor(manager);c=await get(c.id)
for(const kind of ['contract','privacyConsent','biometricConsent'])c=(await upload(c,kind)).record
assert.equal(c.files.length,8)
// Failed/incomplete replacement must preserve the old version; stale concurrent finalization fails.
const old=c.files.find(f=>f.kind==='identity').id
const a=await val('select begin_employee_onboarding_file($1,$2,$3,$4,$5)',[c.id,'identity','proof.pdf','application/pdf',100])
await denied('select finish_employee_onboarding_file($1)',[a.id]);assert.equal((await get(c.id)).files.find(f=>f.kind==='identity').id,old)
c=(await upload(c,'identity')).record
await db.exec('reset role');await db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',['employee-onboarding',a.path,{size:100,mimetype:'application/pdf'}]);await db.exec('set role authenticated');await denied('select finish_employee_onboarding_file($1)',[a.id])
c=await val('select set_employee_onboarding_complete($1,true,$2)',[c.id,c.version]);assert.ok(c.completedAt)
await denied('select save_employee_onboarding($1,$2,$3,$4,$5)',[c.id,'company',wage,c.version,c.rosterStamp])
c=await val('select set_employee_onboarding_complete($1,false,$2)',[c.id,c.version]);assert.equal(c.completedAt,null)
// Existing colleague is not enrolled; new requests are. Department assignment does not remove an open case.
await db.exec('reset role');assert.equal(await val('select count(*) from app.employee_onboardings where profile_id=$1',[coworker]),0)
assert.equal(await val('select note from employee_roster where profile_id=$1',[staff]),'원본 보존');assert.equal(Number(await val('select remaining_annual_leave from employee_roster where profile_id=$1',[staff])),7.5)
await actor(dev);const testId=await val('select start_employee_onboarding_test()');const devBefore=await val('select md5(row(p.*)::text) from profiles p where id=$1',[dev]);let test=await get(testId)
test=await save(test,'draft',personal);test=await save(test,'company',wage);assert.equal(await val('select md5(row(p.*)::text) from profiles p where id=$1',[dev]),devBefore)
assert.equal((await get(testId)).personal.residentFront,'940102');assert.equal(await val('select count(*) from employee_roster where profile_id=$1',[dev]),0)
await actor(manager);await denied('select get_employee_onboarding($1)',[testId])
await db.exec('reset role;set role anon');await denied('select list_employee_onboardings()');await denied('select get_employee_onboarding(null)')
console.log('PASS onboarding migration preservation, self/ops/company/anon access, draft/submit, payroll, files/failure/concurrency, completion/reopen, test isolation and no broad roster grants')
}catch(error){console.error(error.stack,{code:error.code});process.exitCode=1}finally{await db.close()}
