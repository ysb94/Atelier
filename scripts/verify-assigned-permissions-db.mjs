import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

// 운영 DB에 연결하지 않는다. 개발 의존성 PostgreSQL 런타임으로 권한·RLS를 검증한다.
const modulePath = process.env.ATELIER_PGLITE_MODULE
const { PGlite } = await import(modulePath ? pathToFileURL(modulePath).href : '@electric-sql/pglite')
const db = await PGlite.create()
const company = 'e0000000-0000-4000-8000-000000000001', other = 'e0000000-0000-4000-8000-000000000002'
const admin = '10000000-0000-4000-8000-000000000001', staff = '10000000-0000-4000-8000-000000000002', manager = '10000000-0000-4000-8000-000000000003', outsider = '10000000-0000-4000-8000-000000000004'
const dept = '20000000-0000-4000-8000-000000000001', dept2 = '20000000-0000-4000-8000-000000000002'
const brand = '30000000-0000-4000-8000-000000000001'
const partner = '40000000-0000-4000-8000-000000000001'
const otherPartner = '40000000-0000-4000-8000-000000000002'
const otherBrand = '30000000-0000-4000-8000-000000000002', outOfScopePartner = '40000000-0000-4000-8000-000000000003'
async function actor(id, role = 'authenticated') { await db.exec(`reset role; select set_config('request.jwt.claim.sub','${id}',false); set role ${role};`) }
async function scalar(sql, params) { return Object.values((await db.query(sql,params)).rows[0])[0] }
async function rejected(sql, params, code) { try { await db.query(sql,params); assert.fail('권한 없는 작업이 성공했습니다.') } catch(error) { if (error.code === 'ERR_ASSERTION') throw error; if (code) assert.equal(error.code,code,error.message) } }
try {
  await db.exec(`create role anon; create role authenticated; create schema app; create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  grant usage on schema auth,app,public to authenticated,anon;
  create table public.companies(id uuid primary key);
  create table public.departments(id uuid primary key,company_id uuid,name text,is_active boolean,personnel_scope text);
  create table public.profiles(id uuid primary key,company_id uuid,department_id uuid,email text,display_name text,position text,job_grade text,status text,is_admin boolean,hire_date date,approved_by uuid,approved_at timestamptz,name_confirmed_at timestamptz,avatar_url text,request_note text,requested_at timestamptz);
  create table public.personnel_titles(company_id uuid,kind text,name text);
  create table public.brands(id uuid primary key,company_id uuid,name text);
  create table public.ai_feature_routes(id uuid primary key default gen_random_uuid(),brand_id uuid,feature_key text);
  create table public.profile_capabilities(profile_id uuid,capability text);
  create table public.brand_members(profile_id uuid,brand_id uuid,is_lead boolean);
  create table public.code_usage_targets(id uuid primary key,brand_id uuid,name text);
  create table public.usage_partner_editors(profile_id uuid,brand_id uuid,usage_target_id uuid);
  create table public.chat_rooms(id uuid primary key,company_id uuid,title text);
  create table public.department_request_approvers(company_id uuid,department_id uuid,request_type text,approver_id uuid,substitute_id uuid,updated_by uuid,updated_at timestamptz,primary key(company_id,department_id,request_type));
  create table public.company_notices(id uuid primary key default gen_random_uuid(),company_id uuid,slot text,department_id uuid,title text,body text,starts_on date,ends_on date,published boolean,updated_by uuid,updated_at timestamptz default now());
  create table public.attendance_start_settings(company_id uuid,month date,department_id uuid,employee_id uuid,source text,start_time time,grace_minutes integer,updated_by uuid,updated_at timestamptz default now());
  create unique index attendance_department on public.attendance_start_settings(company_id,department_id,month) where employee_id is null;
  create unique index attendance_employee on public.attendance_start_settings(company_id,employee_id,month) where employee_id is not null;
  create function app.is_chat_room_member(uuid) returns boolean language sql stable as $$ select true $$;
  create function app.usage_partner_can_read(uuid) returns boolean language sql stable as $$ select true $$;
  insert into public.companies values('${company}'),('${other}');
  insert into public.departments values('${dept}','${company}','디자인팀',true,null),('${dept2}','${company}','물류팀',true,null);
  insert into public.profiles(id,company_id,department_id,email,display_name,position,job_grade,status,is_admin) values('${admin}','${company}','${dept}','dev@atelier.local','관리 담당','사원','사원','active',true),('${staff}','${company}','${dept}','staff@invalid','직원','사원','사원','active',false),('${manager}','${company}','${dept}','manager@invalid','이전 팀장','팀장','과장','active',false),('${outsider}','${other}',null,'other@invalid','다른 회사','대표이사','사장','active',true);
  insert into public.personnel_titles values('${company}','duty','사원'),('${company}','duty','팀장'),('${company}','duty','대표이사'),('${company}','grade','사원'),('${company}','grade','과장'),('${company}','grade','사장');
  insert into public.brands values('${brand}','${company}','검증 브랜드'),('${otherBrand}','${company}','다른 브랜드');
  insert into public.code_usage_targets values('${partner}','${brand}','검증 업체'),('${otherPartner}','${brand}','다른 업체'),('${outOfScopePartner}','${otherBrand}','다른 브랜드 업체');
  insert into public.department_request_approvers values('${company}','${dept}','leave','${staff}','${manager}',null,now()),('${other}','${dept2}','leave','${outsider}',null,null,now());
  grant select on public.profiles,public.departments,public.department_request_approvers to authenticated;
  grant delete on public.department_request_approvers to authenticated;
  alter table public.department_request_approvers enable row level security;
  create policy approver_read on public.department_request_approvers for select to authenticated using(company_id=(select company_id from public.profiles where id=auth.uid()));
  create policy approver_write on public.department_request_approvers for all to authenticated using(app.can_edit_org_assignment()) with check(app.can_edit_org_assignment());
  ` .replace('create policy approver_write', () => "create function app.can_edit_org_assignment() returns boolean language sql as $$ select false $$; create policy approver_write"))
  const before = await db.query('select * from public.department_request_approvers order by department_id,request_type')
  const migration = await fs.readFile('supabase/migrations/20261021033319_assigned_permissions.sql','utf8')
  await db.exec(migration)
  await db.exec(`alter table public.profiles enable row level security;
    grant update on public.profiles to authenticated;
    create policy profiles_read on public.profiles for select to authenticated using(id=auth.uid() or app.can_view_members());
    create policy profiles_update on public.profiles for update to authenticated using(true) with check(true);
    create trigger guard_profile_changes before update on public.profiles for each row execute function app.guard_profile_changes();`)
  assert.deepEqual((await db.query('select * from public.department_request_approvers order by department_id,request_type')).rows,before.rows,'기존 승인자·대체 승인자 보존')
  await actor(admin)
  const directory = await scalar('select public.permission_directory()')
  assert.equal(await scalar('select count(*) from public.profiles where id=$1',[outsider]),0,'인사 조회 정책도 다른 회사 프로필 비노출')
  assert.equal((await db.query('delete from public.department_request_approvers where company_id=$1 returning department_id',[other])).rows.length,0,'승인자 관리 권한도 다른 회사 지정 삭제 금지')
  assert.equal(directory.profiles.length,3,'다른 회사 직원 비노출')
  assert.ok(directory.grants.every(g=>g.profileId!==outsider),'다른 회사 지정 비노출')
  const revision = directory.revision
  await rejected('select public.set_permission_grant($1,$2,$3,$4,true,$5)',[admin,'org.manage','company',company,revision],'42501')
  await rejected('select public.set_permission_grant($1,$2,$3,$4,true,$5)',[outsider,'org.manage','company',company,revision])
  await rejected('select public.set_permission_grant($1,$2,$3,$4,true,$5)',[staff,'org.manage','department',dept,revision])
  await rejected('select public.set_permission_grant($1,$2,$3,$4,true,$5)',[staff,'work.manage','company',other,revision],'42501')
  await db.query('select public.set_permission_grant($1,$2,$3,$4,true,$5)',[staff,'work.manage','department',dept,revision])
  await rejected('select public.set_permission_grant($1,$2,$3,$4,true,$5)',[staff,'org.manage','company',company,revision],'40001')
  await actor(staff)
  assert.equal(await scalar("select app.permission_allowed('work.manage','department',$1)",[dept]),true,'사원도 지정한 부서 업무 관리')
  assert.equal(await scalar("select app.permission_allowed('work.manage','department',$1)",[dept2]),false,'다른 부서 차단')
  await rejected('select public.permission_directory()',[],'42501')
  await rejected('delete from public.permission_grants',[],'42501')
  await rejected('insert into public.permission_grants(company_id,profile_id,permission,scope_kind,scope_id) values($1,$2,$3,$4,$5)',[company,staff,'org.manage','company',company],'42501')
  await actor(admin)
  const next = await scalar('select public.permission_directory()')
  await db.query('select public.set_permission_grant($1,$2,$3,$4,false,$5)',[staff,'work.manage','department',dept,next.revision])
  await actor(staff)
  assert.equal(await scalar("select app.any_permission('work.manage')"),false,'권한 해제 즉시 서버 차단')
  await actor(admin)
  await db.query("update public.profiles set position='대표이사',job_grade='사장' where id=$1",[staff])
  await actor(staff)
  assert.equal(await scalar("select app.permission_allowed('org.manage')"),false,'직책 변경으로 권한 생성 금지')
  assert.equal(await scalar("select app.company_review_company_id()"),null,'대표이사도 미지정이면 조회 확대 금지')
  await actor(admin)
  await db.query("update public.profiles set status='disabled' where id=$1",[manager])
  await actor(manager)
  assert.equal(await scalar("select app.any_permission('chat.moderate')"),false,'비활성 계정 차단')
  await actor(outsider)
  assert.equal(await scalar('select count(*) from public.permission_grants where company_id=$1',[company]),0,'다른 회사 RLS 차단')
  await actor(admin)
  assert.equal(await scalar('select count(*) from public.permission_grant_events'),2,'지정·해제 이력 기록')
  // 실제 공지·근태 저장 함수를 호출한다. 화면 버튼만 숨겨서 통과하지 않는다.
  async function assign(profileId,permission,scopeKind,scopeId) {
    await actor(admin)
    const current=await scalar('select public.permission_directory()')
    await db.query('select public.set_permission_grant($1,$2,$3,$4,true,$5)',[profileId,permission,scopeKind,scopeId,current.revision])
  }
  await assign(staff,'notice.department.write','department',dept)
  await actor(staff)
  const notice=await scalar("select public.save_company_notice(null,'department',$1,'제목','내용',null,null,true)",[dept])
  await rejected("select public.save_company_notice(null,'department',$1,'제목','내용',null,null,true)",[dept2],'42501')
  await rejected('select public.delete_company_notice($1)',[notice],'42501')
  await assign(staff,'notice.department.delete','department',dept)
  await actor(staff)
  await db.query('select public.delete_company_notice($1)',[notice])
  await actor(admin)
  // 다른 부서 공지를 허용된 부서로 옮겨 수정하는 우회도 차단한다.
  await db.exec('reset role')
  const foreignNotice=await scalar("insert into public.company_notices(company_id,slot,department_id,title,body,published) values($1,'department',$2,'기존 공지','보존',true) returning id",[company,dept2])
  await actor(staff)
  await rejected("select public.save_company_notice($1,'department',$2,'이동 시도','내용',null,null,true)",[foreignNotice,dept],'42501')
  // 원래 승인자로 지정된 사람에게 이관한 출근시간 권한이 정확한 부서에만 적용된다.
  assert.equal(await scalar("select app.save_attendance_start_settings('2026-10-01','2026-10-01',$1,null,'09:00',5)",[dept]),1)
  await db.query("select app.save_attendance_start_settings('2026-10-01','2026-10-01',$1,$2,'10:00',5)",[dept,staff])
  await db.query("select app.save_attendance_start_settings('2026-10-01','2026-10-01',$1,null,'09:30',5)",[dept])
  await db.exec('reset role')
  assert.equal(await scalar('select start_time::text from public.attendance_start_settings where employee_id=$1',[staff]),'10:00:00','부서 변경이 개인 설정을 덮어쓰지 않음')
  await actor(staff)
  await rejected("select app.save_attendance_start_settings('2026-10-01','2026-10-01',$1,null,'09:00',5)",[dept2])
  await rejected('update public.profiles set is_admin=true where id=$1',[staff])
  assert.equal(await scalar('select app.can_approve($1)',[staff]),false,'본인 승인 금지')
  await actor(admin)
  assert.equal(await scalar('select app.can_approve($1)',[outsider]),false,'다른 회사 직원 승인 금지')
  await db.exec('reset role')
  await db.query("update public.profiles set status='active' where id=$1",[manager])
  await assign(manager,'partner.manage','brand',brand)
  await actor(manager)
  const delegated=await scalar('select public.permission_directory()')
  assert.equal(delegated.canManageAll,false)
  assert.ok(delegated.scopes.every(scope=>scope.kind==='partner'),'업체 관리자는 업체 대상만 조회')
  assert.equal(delegated.scopes.some(scope=>scope.id===outOfScopePartner),false,'지정하지 않은 브랜드 업체 비노출')
  await rejected('select public.set_permission_grant($1,$2,$3,$4,true,$5)',[staff,'org.manage','company',company,delegated.revision],'42501')
  await rejected('select public.set_permission_grant($1,$2,$3,$4,true,$5)',[staff,'partner.edit','partner',outOfScopePartner,delegated.revision],'42501')
  await db.query('select public.set_permission_grant($1,$2,$3,$4,true,$5)',[staff,'partner.edit','partner',partner,delegated.revision])
  await actor(staff)
  assert.equal(await scalar('select app.usage_partner_can_edit($1,$2)',[brand,partner]),true)
  assert.equal(await scalar('select app.usage_partner_can_edit($1,$2)',[brand,otherPartner]),false)
  assert.equal((await scalar('select public.get_usage_partner_access($1,$2)',[brand,partner])).canEdit,true,'실제 업체 API도 새 지정 원본으로 조회')
  await rejected('select public.save_usage_partner_editors($1,$2,$3)',[brand,partner,[staff]],'42501')
  await assign(manager,'personnel.manage','company',company)
  await actor(manager)
  await rejected("update public.profiles set status='disabled' where id=$1",[admin])
  const newcomer='10000000-0000-4000-8000-000000000005'
  await db.exec('reset role')
  await db.query("insert into public.profiles(id,company_id,department_id,display_name,position,job_grade,status,is_admin) values($1,$2,$3,'새 직원','사원','사원','pending',false)",[newcomer,company,dept])
  await actor(admin)
  await db.query("update public.profiles set status='active' where id=$1",[newcomer])
  await actor(newcomer)
  const newGrants=await scalar('select public.list_my_permission_grants()')
  assert.deepEqual(newGrants.map(grant=>grant.permission),['basic.use'],'가입 승인은 기본 이용만 지정하고 업무 편집 권한을 만들지 않음')
  await db.exec('reset role')
  assert.deepEqual((await db.query('select * from public.department_request_approvers order by department_id,request_type')).rows,before.rows,'전체 검증 뒤에도 승인자 원본 유지')
  console.log('assigned-permissions-db: PostgreSQL 이전·승인자 보존·직책 독립·RLS/범위·동시 수정·회수·이력·공지 작성/삭제 분리·출근시간/개인 예외·업체 위임 검증 통과 (운영 DB 연결 없음)')
} catch (error) {
  console.error('assigned-permissions-db 실패:', { message: error.message, code: error.code, detail: error.detail, position: error.position })
  process.exitCode = 1
} finally { await db.close() }
