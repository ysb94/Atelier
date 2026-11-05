import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

export async function verifyEmployeeAccessReview(db, {company, other, ops, dept, manager, staff, outsider}) {
  const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0]||{})[0]
  const owner=()=>db.exec("reset role;select set_config('request.jwt.claim.sub','',false)")
  const actor=id=>db.exec(`reset role;select set_config('request.jwt.claim.sub','${id}',false);set role authenticated`)
  const review=(id,decision='approve',name='승인 검증',department=null,position=null,grade=null,hire=null)=>scalar('select public.review_employee_access($1,$2,$3,$4,$5,$6,$7)',[decision,id,name,department,position,grade,hire])
  const pending=async({requested=true,companyId=company}={})=>{
    await owner();const id=crypto.randomUUID()
    await db.query("insert into profiles(id,company_id,status,display_name,email,requested_at) values($1,$2,'pending','승인 검증','fixture@example.invalid',case when $3 then now() else null end)",[id,companyId,requested]);return id
  }
  const fingerprint=async()=>{
    const prior=await scalar('select current_user');await db.exec('reset role')
    try{return await scalar("select md5((select coalesce(jsonb_agg(p order by id)::text,'') from profiles p)||(select coalesce(jsonb_agg(c order by id)::text,'') from app.employee_onboardings c)||(select coalesce(jsonb_agg(r order by profile_id)::text,'') from employee_roster r))")}
    finally{if(prior==='authenticated')await db.exec('set role authenticated')}
  }
  await owner()
  await db.exec(`alter table profiles add column is_admin boolean not null default false,add column approved_by uuid,add column approved_at timestamptz,add column name_confirmed_at timestamptz,add column avatar_url text,add column request_note text,add column created_at timestamptz default now(),add column updated_at timestamptz default now();
    alter table departments add column name text,add column personnel_scope text;
    update departments set name=case when id='${ops}' then '운영지원팀' else '검증 부서' end;
    create table personnel_titles(company_id uuid,kind text,name text);
    insert into personnel_titles values('${company}','duty','사원'),('${company}','grade','대리');
    create function app.is_admin() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.profiles where id=auth.uid() and status='active' and is_admin)$$;
    create function app.is_company_manager() returns boolean language sql stable as $$select false$$;
    create function app.can_manage_personnel() returns boolean language sql stable as $$select app.is_admin()$$;
    create function app.can_approve(uuid) returns boolean language sql stable as $$select app.can_manage_personnel()$$;`)
  for(const path of ['20261105041100_operations_access_approval.sql','20261105065548_operations_access_approval_guard_order.sql','20261105070652_operations_access_approval_department_guard.sql']) await db.exec(await readFile('supabase/migrations/'+path,'utf8'))
  await db.exec('create trigger profiles_guard_changes before update on profiles for each row execute function app.guard_profile_changes()')
  const before=await fingerprint(),policies=await scalar('select md5(jsonb_agg(p order by tablename,policyname)::text) from pg_policies p')
  await db.exec(await readFile('supabase/migrations/20261105092213_employee_access_onboarding_review.sql','utf8'))
  assert.equal(await fingerprint(),before,'API 추가 시 기존 원본 미변경')
  assert.equal(await scalar('select md5(jsonb_agg(p order by tablename,policyname)::text) from pg_policies p'),policies,'기존 정책 보존')
  assert.equal(await scalar("select prosecdef from pg_proc where oid='public.review_employee_access(text,uuid,text,uuid,text,text,date)'::regprocedure"),false)
  assert.equal(await scalar("select has_function_privilege('anon','public.review_employee_access(text,uuid,text,uuid,text,text,date)','execute')"),false)
  await actor(manager)
  assert.equal((await scalar('select public.review_employee_access()')).canReview,true,'인사 관리 권한 없는 운영지원 직원 허용')
  assert.equal(await scalar('select app.can_approve(null)'),false)
  const raw=await pending({requested:false})
  assert.equal(await scalar('select count(*) from app.employee_onboardings where profile_id=$1',[raw]),0)
  await actor(manager)
  assert.equal((await review(raw,'approve','승인 검증',dept)).status,'active')
  const listed=await scalar('select list_employee_onboardings()');assert.ok(listed.some(row=>row.profileId===raw&&row.departmentId===dept&&!row.completedAt),'신청일·서류 기록 없는 신청도 승인 후 배치와 무관하게 유지')
  const approval=await scalar('select approved_at::text from profiles where id=$1',[raw])
  await assert.rejects(()=>review(raw));assert.equal(await scalar('select approved_at::text from profiles where id=$1',[raw]),approval,'중복 승인·거절은 기존 승인 이력 미변경')
  await assert.rejects(()=>review(raw,'reject'))
  for(const requested of [true,false]) {
    const id=await pending({requested})
    if(!requested)await db.query('insert into app.employee_onboardings(company_id,profile_id) values($1,$2)',[company,id])
    await actor(manager)
    let record=(await scalar('select list_employee_onboardings()')).find(row=>row.profileId===id)
    let data=await scalar('select get_employee_onboarding($1)',[record.id])
    await scalar("select save_employee_onboarding($1,'company',$2,$3,$4)",[data.id,{wageMode:'manual',periodMode:'manual',departmentId:dept,hireDate:'2023-01-01',workplace:'기존 근무지',annualSalary:'45000000'},data.version,data.rosterStamp])
    const unchanged=await fingerprint()
    await assert.rejects(()=>review(id,'approve','승인 검증',ops,'미등록 직책',null,'2024-02-01'))
    assert.equal(await fingerprint(),unchanged,'준비 정보 저장 후 승인 오류도 회사 정보·버전·계정·명부 전체 롤백')
    await review(id,'approve','승인 검증',ops,'사원','대리','2024-02-01')
    data=await scalar('select get_employee_onboarding($1)',[record.id])
    assert.equal(data.company.departmentId,ops,'예전 회사 입력의 부서로 승인창 선택을 덮어쓰지 않음')
    assert.equal(data.company.hireDate,'2024-02-01')
    assert.equal(data.company.annualSalary,'45000000','기존 급여 입력 보존')
    assert.equal(await scalar('select workplace from employee_roster where profile_id=$1',[id]),'기존 근무지')
    assert.equal(await scalar('select hire_date::text from profiles where id=$1',[id]),'2024-02-01')
  }
  const rejected=await pending();await actor(manager);assert.equal((await review(rejected,'reject')).status,'rejected');await assert.rejects(()=>review(rejected))
  const untouched=await pending();await actor(staff);assert.equal((await scalar('select public.review_employee_access()')).canReview,false);await assert.rejects(()=>review(untouched))
  await actor(outsider);await assert.rejects(()=>review(untouched))
  const foreign=await pending({companyId:other});await actor(manager);await assert.rejects(()=>review(foreign));await assert.rejects(()=>review(manager))
  await assert.rejects(()=>review(untouched,'approve','승인 검증',crypto.randomUUID()))
  await assert.rejects(()=>review(untouched,'approve','승인 검증',dept,null,null,'1949-01-01'))
  await assert.rejects(()=>review(untouched,'approve','승인 검증',dept,null,null,'2999-01-01'))
  await owner();await db.query("update profiles set status='disabled' where id=$1",[manager]);await actor(manager)
  assert.equal((await scalar('select public.review_employee_access()')).canReview,false);await assert.rejects(()=>review(untouched))
  await db.exec('reset role;set role anon');await assert.rejects(()=>scalar('select public.review_employee_access()'))
  console.log('PASS atomic employee access: operations without personnel grants, missing cases, prepared payroll/assignment, rollback, duplicate/stale decisions, self/company/inactive/anon denial; existing policies and records preserved')
}
