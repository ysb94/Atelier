import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
const db=await PGlite.create(),company='e0000000-0000-4000-8000-000000000001',other='e0000000-0000-4000-8000-000000000002',dept='20000000-0000-4000-8000-000000000001',dept2='20000000-0000-4000-8000-000000000002'
const lead='10000000-0000-4000-8000-000000000001',sub='10000000-0000-4000-8000-000000000002',staff='10000000-0000-4000-8000-000000000003',wrongDept='10000000-0000-4000-8000-000000000004',foreign='10000000-0000-4000-8000-000000000005',ops='10000000-0000-4000-8000-000000000006'
const value=async(sql,args)=>Object.values((await db.query(sql,args)).rows[0])[0]
const actor=async id=>db.exec(`reset role;select set_config('request.jwt.claim.sub','${id}',false);set role authenticated`)
const denied=async(sql,args)=>{try{const result=await db.query(sql.startsWith('update ')&&!sql.includes('returning')?sql+' returning id':sql,args);assert.equal(result.rows.length,0,'권한 없는 변경 허용: '+sql)}catch(error){if(error.code==='ERR_ASSERTION')throw error}}
let day=1
async function create(kind='overtime') {const date=`2020-01-${String(day++).padStart(2,'0')}`;return (await db.query(`insert into public.company_leave_requests(employee_id,company_id,kind,from_date,to_date,start_time,end_time,note,place) values(auth.uid(),$1,$2,$3,$3,'18:00','20:00','검증 사유','방문 장소') returning *`,[company,kind,date])).rows[0]}
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create schema app;grant usage on schema public,app,auth to authenticated,anon;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.profiles(id uuid primary key,company_id uuid,department_id uuid,status text,display_name text);
 create table public.departments(id uuid primary key,name text);
 create table public.department_request_approvers(company_id uuid,department_id uuid,request_type text,approver_id uuid,substitute_id uuid);
 create table public.attendance_clock_ins(id uuid,clock_in time);
 create table public.company_leave_requests(id uuid primary key default gen_random_uuid(),company_id uuid,employee_id uuid,employee_name text,department_id uuid,department_name text,kind text,from_date date,to_date date,start_time time,end_time time,note text,place text,status text default 'pending',created_at timestamptz default now(),decision_note text,decided_at timestamptz,decided_by uuid,decided_by_name text);
 create table public.company_leave_files(id uuid primary key default gen_random_uuid(),request_id uuid,ready boolean);
 create function app.can_edit_org_assignment() returns boolean language sql stable as $$select auth.uid()='${ops}'::uuid$$;
 create function app.is_department_request_approver(c uuid,d uuid,k text) returns boolean language sql stable as $$select exists(select 1 from public.department_request_approvers a join public.profiles me on me.id=auth.uid() and me.status='active' and me.company_id=a.company_id where a.company_id=c and a.department_id=d and a.request_type=case when k='overtime' then 'overtime' else 'leave' end and (a.approver_id=me.id or a.substitute_id=me.id))$$;
 create policy leave_transition on public.company_leave_requests for update to authenticated using(false) with check(false);
 alter table public.company_leave_requests enable row level security;
 create policy read_requests on public.company_leave_requests for select to authenticated using(company_id=(select company_id from public.profiles where id=auth.uid()) and (employee_id=auth.uid() or app.is_department_request_approver(company_id,department_id,kind) or app.can_edit_org_assignment()));
 create policy leave_create on public.company_leave_requests for insert to authenticated with check(employee_id=auth.uid() and company_id=(select company_id from public.profiles where id=auth.uid() and status='active') and (status='pending' or (status='approved' and kind in ('annual','half','quarter'))));
 grant select on public.profiles,public.departments,public.department_request_approvers,public.company_leave_files to authenticated;
 grant select,insert,update on public.company_leave_requests to authenticated;
 insert into public.departments values('${dept}','부서 가'),('${dept2}','부서 나');
 insert into public.profiles values('${lead}','${company}','${dept}','active','지정 승인자'),('${sub}','${company}','${dept}','active','대체 승인자'),('${staff}','${company}','${dept}','active','일반 직원'),('${wrongDept}','${company}','${dept2}','active','다른 부서'),('${foreign}','${other}','${dept}','active','다른 회사'),('${ops}','${company}','${dept}','active','운영지원');
 insert into public.department_request_approvers values('${company}','${dept}','leave','${lead}','${sub}'),('${company}','${dept}','overtime','${lead}','${sub}');
 insert into public.attendance_clock_ins values(gen_random_uuid(),'09:00');`)
 const snapshot=await value("select md5(jsonb_build_object('profiles',(select jsonb_agg(p) from public.profiles p),'approvers',(select jsonb_agg(a) from public.department_request_approvers a),'clocks',(select jsonb_agg(c) from public.attendance_clock_ins c))::text)")
 await db.exec(await readFile('supabase/migrations/20261028071856_attendance_self_approval.sql','utf8'))
 await db.exec(await readFile('supabase/migrations/20261028072226_attendance_offsite_insert_policy.sql','utf8'))
 await db.exec('create trigger guard before insert or update on public.company_leave_requests for each row execute function app.guard_company_leave_request()')
 for(const id of [lead,sub])for(const kind of ['overtime','correction']){
  await actor(id);const row=await create(kind);assert.ok((await db.query('select * from public.list_my_approval_requests()')).rows.some(r=>r.id===row.id),'본인 신청 조회')
  const saved=(await db.query("update public.company_leave_requests set status='approved',decided_by=$2,decided_by_name='위조',decided_at='2000-01-01',decision_note='확인' where id=$1 and status='pending' returning *",[row.id,staff])).rows[0]
  assert.equal(saved.decided_by,id);assert.notEqual(saved.decided_by_name,'위조');assert.ok(new Date(saved.decided_at)>new Date('2020-01-01'));assert.equal(saved.decision_note,'확인');assert.equal(saved.employee_id,id)
  assert.equal((await db.query("update public.company_leave_requests set status='approved' where id=$1 and status='pending' returning id",[row.id])).rows.length,0,'중복 요청은 다시 처리하지 않음')
  await denied("update public.company_leave_requests set status='approved' where id=$1",[row.id])
 }
 await actor(staff);const normal=await create();await denied("update public.company_leave_requests set status='approved' where id=$1",[normal.id]);assert.equal((await db.query('select * from public.list_my_approval_requests()')).rows.length,0)
 await actor(wrongDept);assert.equal((await db.query("update public.company_leave_requests set status='approved' where id=$1 returning id",[normal.id])).rows.length,0);const ownOther=await create();await denied("update public.company_leave_requests set status='approved' where id=$1",[ownOther.id])
 await actor(foreign);assert.equal((await db.query("update public.company_leave_requests set status='approved' where id=$1 returning id",[normal.id])).rows.length,0)
 await actor(lead);await db.query("update public.company_leave_requests set status='rejected',decision_note='불가' where id=$1",[normal.id]);const ownReject=await create();await denied("update public.company_leave_requests set status='rejected',decision_note='불가' where id=$1",[ownReject.id])
 await actor(wrongDept)
 for(const kind of ['annual','half','quarter','offsite']){const row=kind==='half'||kind==='quarter'?(await db.query("insert into public.company_leave_requests(employee_id,company_id,kind,from_date,to_date,start_time,end_time,note,place) values(auth.uid(),$1,$2,'2020-02-01','2020-02-01','09:00',$3,'검증','') returning *",[company,kind,kind==='half'?'14:00':'11:00'])).rows[0]:await create(kind);assert.equal(row.status,'approved');assert.equal(row.decided_by,null);assert.equal((await db.query("update public.company_leave_requests set status='cancelled' where id=$1 returning status",[row.id])).rows[0].status,'cancelled')}
 await denied("insert into public.company_leave_requests(employee_id,company_id,kind,from_date,to_date,start_time,end_time,note) values(auth.uid(),$1,'remote','2020-03-01','2020-03-01','09:00','18:00','재택')",[company])
 await actor(staff);const official=await create('official');assert.equal(official.status,'pending');await actor(lead);await denied("update public.company_leave_requests set status='approved' where id=$1",[official.id]);await actor(ops);await denied("update public.company_leave_requests set status='approved' where id=$1",[official.id]);await db.exec('reset role');await db.query('insert into public.company_leave_files(request_id,ready) values($1,true)',[official.id]);await actor(ops);await db.query("update public.company_leave_requests set status='approved' where id=$1",[official.id]);const ownOfficial=await create('official');await denied("update public.company_leave_requests set status='approved' where id=$1",[ownOfficial.id])
 await db.exec('reset role');assert.equal(await value("select md5(jsonb_build_object('profiles',(select jsonb_agg(p) from public.profiles p),'approvers',(select jsonb_agg(a) from public.department_request_approvers a),'clocks',(select jsonb_agg(c) from public.attendance_clock_ins c))::text)"),snapshot)
 console.log('attendance-self-approval-db: 지정/대체 본인 승인·감사값 위조/중복 차단·일반/타부서/타사 차단·휴가/외근 즉시 등록/취소·재택 차단·공가 서류와 본인 제한·기존 사용자/담당자/출퇴근 보존 통과')
}catch(error){console.error(error.message,{code:error.code,position:error.position});process.exitCode=1}finally{await db.close()}
