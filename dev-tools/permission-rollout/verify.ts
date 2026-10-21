import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createBots } from './model'
import { hasPermission } from '../../src/lib/company/permissions'
import { statements, splitMigration, stageSql, schemaFingerprintQuery } from './sql.mjs'
import { captureQuery } from './capture-sql.mjs'
import { sandbox, fingerprints } from './sandbox.mjs'
import { rehearse } from './prepare.mjs'

const company='e0000000-0000-4000-8000-000000000001',other='e0000000-0000-4000-8000-000000000002'
const dept='20000000-0000-4000-8000-000000000001',outside='20000000-0000-4000-8000-000000000002'
const manager='10000000-0000-4000-8000-000000000001',pending='10000000-0000-4000-8000-000000000002'
const data={companies:[{id:company,name:'검증 회사'},{id:other,name:'다른 회사'}],departments:[{id:dept,company_id:company,name:'검증 부서',sort_order:1,is_active:true,personnel_scope:null},{id:outside,company_id:other,name:'다른 부서',sort_order:1,is_active:true,personnel_scope:null}],titles:[{id:'30000000-0000-4000-8000-000000000001',company_id:company,kind:'duty',name:'팀장',sort_order:1},{id:'30000000-0000-4000-8000-000000000002',company_id:company,kind:'duty',name:'대표이사',sort_order:2},{id:'30000000-0000-4000-8000-000000000003',company_id:company,kind:'grade',name:'과장',sort_order:1}],profiles:[{id:manager,company_id:company,department_id:dept,email:'dev@atelier.local',display_name:'검증 담당',status:'active',position:'팀장',job_grade:'과장',is_admin:true},{id:pending,company_id:company,department_id:dept,email:'pending@example.invalid',display_name:'검증 대기',status:'pending',position:'팀장',is_admin:false}],capabilities:[],memberships:[],brands:[],partners:[],partnerEditors:[],chatRooms:[],authUserIds:[manager,pending],approvers:[{company_id:company,department_id:dept,request_type:'leave',approver_id:manager,substitute_id:null,updated_by:manager,updated_at:'2026-10-21T00:00:00+00:00'}]}
const bots=createBots(data)
assert.equal(bots.length,4)
assert.ok(bots.every(b=>b.name.includes('[봇]')&&b.id.startsWith('bot:')&&!data.profiles.some(p=>p.id===b.id)))
assert.equal(new Set(bots.map(b=>b.id)).size,bots.length)
assert.equal(bots.filter(b=>b.departmentId===outside).length,1,'다른 회사의 직책을 섞지 않음')
assert.ok(!bots.some(b=>b.position==='과장'),'직급을 직책으로 잘못 생성하지 않음')
assert.deepEqual(createBots(data),bots,'봇 ID는 재생성해도 유지')
for(const bot of bots)for(const grade of ['사원','과장','부장']) {
  const p={...bot,jobGrade:grade}
  assert.equal(hasPermission(p,'org.manage'),false,'높은 직책·직급만으로 자동 권한 금지')
  assert.equal(hasPermission({...p,permissionGrants:[{permission:'org.manage',scopeKind:'company',scopeId:bot.companyId}]},'org.manage'),true,'지정한 기능만 허용')
}
const source=await fs.readFile('supabase/migrations/20261021033319_assigned_permissions.sql','utf8')
const phases=splitMigration(source)
assert.equal(statements("-- 주석 ;\ncreate function app.a() returns text language sql as $body$ select ';' $body$; select '한글;''내용';").length,2)
assert.throws(()=>statements("select '닫히지 않음;"))
assert.throws(()=>splitMigration(source.replace('create table app.permission_catalog','create or replace function app.unsafe() returns void language sql as $$ select 1 $$; create table app.permission_catalog')))
assert.ok(!/create or replace function/i.test(phases.expand))
const capture=captureQuery(source)
assert.ok(capture.includes('read only')&&capture.includes('set local timezone=\'UTC\''))
assert.ok(!/^\s*(insert|update|delete|alter|create|drop|truncate)\s/im.test(capture),'캡처 쿼리는 조회 전용')

const legacy=(name:string,body:string)=>({schema:'app',name,identity:'',owner:'postgres',acl:[{grantee:'postgres',privilege:'EXECUTE',grantable:false},{grantee:'authenticated',privilege:'EXECUTE',grantable:false}],definition:`create or replace function app.${name}() returns boolean language sql stable security definer set search_path='' as $$ ${body} $$`})
const snapshot:any={project:'pmzgdqvtzwfwqmvhzcyo',capturedAt:'2026-10-21T00:00:00Z',data,newPermissionDbPresent:false,fingerprints:{},schemaFingerprint:'',routines:[legacy('is_admin',"select exists(select 1 from public.profiles where id=auth.uid() and status='active' and is_admin)"),legacy('can_edit_org_assignment','select app.is_admin()')],dependencies:[{schema:'app',name:'is_chat_room_member',identity:'target_room_id uuid',owner:'postgres',acl:[{grantee:'postgres',privilege:'EXECUTE',grantable:false},{grantee:'authenticated',privilege:'EXECUTE',grantable:false}],definition:'create function app.is_chat_room_member(target_room_id uuid) returns boolean language sql stable as $$ select false $$'}],policies:[{schemaname:'public',tablename:'profiles',policyname:'legacy_profile_read',permissive:'PERMISSIVE',roles:['authenticated'],cmd:'SELECT',qual:'id=auth.uid()',with_check:null}],triggers:[],tableSecurity:[{schema:'public',table:'profiles',rls:true,forceRls:false},{schema:'public',table:'departments',rls:false,forceRls:false},{schema:'public',table:'brands',rls:false,forceRls:false},{schema:'public',table:'ai_feature_routes',rls:false,forceRls:false},{schema:'public',table:'company_notices',rls:false,forceRls:false},{schema:'public',table:'department_request_approvers',rls:false,forceRls:false}],columns:[{table:'chat_rooms',name:'name'}]}
snapshot.dependencies.push({schema:'app',name:'usage_partner_can_read',identity:'target_brand uuid',owner:'postgres',acl:[{grantee:'postgres',privilege:'EXECUTE',grantable:false},{grantee:'authenticated',privilege:'EXECUTE',grantable:false}],definition:'create function app.usage_partner_can_read(target_brand uuid) returns boolean language sql stable as $$ select true $$'})
const db=await sandbox(snapshot)
try{
  snapshot.fingerprints=await fingerprints(db)
  snapshot.schemaFingerprint=(await db.query(schemaFingerprintQuery(snapshot))).rows[0].fingerprint
  await assert.rejects(db.exec(source),/권한 전환은 아직 승인되지 않았습니다/,'통합 SQL 직접 실행은 기본 차단')
  const stages=stageSql(source,snapshot)
  await db.query("update public.profiles set status='rejected' where id=$1",[pending])
  await assert.rejects(db.exec(stages.prepare),/profiles가 달라졌습니다/,'승인 상태가 기준 이후 바뀌면 진행하지 않음')
  await db.exec('rollback;')
  assert.equal((await db.query("select to_regclass('public.permission_grants') as id")).rows[0].id,null)
  await db.query("update public.profiles set status='pending' where id=$1",[pending])
  await db.exec("create or replace function app.is_admin() returns boolean language sql stable security definer set search_path='' as $$ select false $$;")
  await assert.rejects(db.exec(stages.prepare),/서버 함수·접근 규칙이 기준 이후 바뀌었습니다/,'서버 규칙이 바뀌면 이전 복구 정의로 덮어쓰지 않음')
  await db.exec('rollback;')
}finally{await db.close()}
const result=await rehearse(snapshot,source)
assert.equal(result.checks.length,7)
assert.ok(result.seeded.some(g=>g.profile_id===manager&&g.permission==='meeting.manage'),'기존 관리자 회의 운영 권한 보존')
assert.ok(!result.seeded.some(g=>g.profile_id===pending),'대기 계정 자동 승인·권한 이관 금지')
assert.ok(!result.seeded.some(g=>String(g.profile_id).startsWith('bot:')))
for(const statement of statements(result.stages.rollback))assert.ok(!/^\s*(insert|update|delete|truncate)\s/i.test(statement.replace(/--[^\n]*/g,'')),'복구는 업무·사용자 행을 덮어쓰지 않음')
console.log('permission-rollout: 준비/전환/복구 7개 리허설 · 직접 실행 차단 · 승인 상태 변경 시 중단 · 봇 전 조합/회사 격리 · 관리자 회의 권한 보존 통과 (운영 연결 없음)')
