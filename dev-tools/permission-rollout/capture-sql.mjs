import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrationPath, fingerprintQueries, quote, schemaFingerprintQuery } from './sql.mjs'

/** Generates a read-only MCP query; never opens a connection or executes SQL. */
export function captureQuery(sql) {
  const names=[...new Set([...sql.matchAll(/^create (?:or replace )?function (\w+\.\w+)/gim)].map(m=>m[1]))]
  const tables=[...new Set([...sql.matchAll(/^(?:create policy \w+ on|drop policy(?: if exists)? \w+ on|alter table) (\w+)\.(\w+)/gim)].map(m=>m[1]+'.'+m[2]))]
  const routineFields=`jsonb_build_object('schema',n.nspname,'name',p.proname,'identity',pg_get_function_identity_arguments(p.oid),'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',(select jsonb_agg(jsonb_build_object('grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable)) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a))`
  const schemaQuery=schemaFingerprintQuery({routines:[{schema:'__capture',name:'routines'}],tableSecurity:tables.map(t=>({schema:t.split('.')[0],table:t.split('.')[1]}))}).replace("'__capture.routines'",'select key from routine_keys')
  const data={
    companies:"select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by id),'[]') from public.companies",
    profiles:"select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') from public.profiles p",
    departments:"select coalesce(jsonb_agg(to_jsonb(d) order by id),'[]') from public.departments d",
    titles:"select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.personnel_titles t",
    capabilities:"select coalesce(jsonb_agg(to_jsonb(c) order by profile_id,capability),'[]') from public.profile_capabilities c",
    memberships:"select coalesce(jsonb_agg(to_jsonb(b) order by brand_id,profile_id),'[]') from public.brand_members b",
    brands:"select coalesce(jsonb_agg(jsonb_build_object('id',id,'company_id',company_id,'name',name) order by id),'[]') from public.brands",
    partners:"select coalesce(jsonb_agg(jsonb_build_object('id',id,'brand_id',brand_id,'name',name) order by id),'[]') from public.code_usage_targets",
    partnerEditors:"select coalesce(jsonb_agg(to_jsonb(e) order by brand_id,usage_target_id,profile_id),'[]') from public.usage_partner_editors e",
    approvers:"select coalesce(jsonb_agg(to_jsonb(a) order by company_id,department_id,request_type),'[]') from public.department_request_approvers a",
    chatRooms:"select coalesce(jsonb_agg(jsonb_build_object('id',id,'company_id',company_id,'name',name) order by id),'[]') from public.chat_rooms",
    authUserIds:"select coalesce(jsonb_agg(id order by id),'[]') from auth.users",
  }
  return String.raw`-- MCP execute_sql용 읽기 전용 캡처. 결과 snapshot만 로컬 .tmp/permission-rollout/source.json에 저장한다.
begin transaction isolation level repeatable read read only;
set local timezone='UTC';
with recursive target_names as (select unnest(array[${names.map(quote).join(',')}]) as key),
target_tables as (select unnest(array[${tables.map(quote).join(',')}]) as key),
old_policies as (select * from pg_policies where schemaname||'.'||tablename in(select key from target_tables)),
seeds as (
 select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prokind='f' and n.nspname||'.'||p.proname in(select key from target_names)
 union select t.tgfoid from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname||'.'||c.relname in(select key from target_tables)
 union select p.oid from old_policies pol cross join lateral regexp_matches(coalesce(pol.qual,'')||' '||coalesce(pol.with_check,''),'(app|public)\.([a-z_][a-z0-9_]*)\s*\(','g') m join pg_namespace n on n.nspname=m[1] join pg_proc p on p.pronamespace=n.oid and p.proname=m[2] and p.prokind='f'
), walk(oid) as (
 select oid from seeds
 union select p.oid from walk w cross join lateral regexp_matches(pg_get_functiondef(w.oid),'(app|public)\.([a-z_][a-z0-9_]*)\s*\(','g') m join pg_namespace n on n.nspname=m[1] join pg_proc p on p.pronamespace=n.oid and p.proname=m[2] and p.prokind='f'
), routine_keys as (select distinct n.nspname||'.'||p.proname as key from walk w join pg_proc p on p.oid=w.oid join pg_namespace n on n.oid=p.pronamespace)
select jsonb_build_object(
 'project','pmzgdqvtzwfwqmvhzcyo','formatVersion',1,'capturedAt',now(),
 'newPermissionDbPresent',to_regclass('public.permission_grants') is not null,
 'fingerprints',jsonb_build_object(${Object.entries(fingerprintQueries).map(([key,q])=>`${quote(key)},(${q})`).join(',\n ')}),
 'schemaFingerprint',(${schemaQuery}),
 'data',jsonb_build_object(${Object.entries(data).map(([key,q])=>`${quote(key)},(${q})`).join(',\n ')}),
 'routines',(select coalesce(jsonb_agg(${routineFields} order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),'[]') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prokind='f' and n.nspname||'.'||p.proname in(select key from target_names)),
 'dependencies',(select coalesce(jsonb_agg(${routineFields} order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),'[]') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prokind='f' and n.nspname||'.'||p.proname in(select key from routine_keys) and n.nspname||'.'||p.proname not in(select key from target_names)),
 'policies',(select coalesce(jsonb_agg(to_jsonb(pol) order by schemaname,tablename,policyname),'[]') from old_policies pol),
 'triggers',(select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid,true)) order by n.nspname,c.relname,t.tgname),'[]') from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname||'.'||c.relname in(select key from target_tables)),
 'tableSecurity',(select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity) order by n.nspname,c.relname),'[]') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname||'.'||c.relname in(select key from target_tables)),
 'columns',(select coalesce(jsonb_agg(jsonb_build_object('table',table_name,'name',column_name,'type',data_type) order by table_name,ordinal_position),'[]') from information_schema.columns where table_schema='public' and table_name in ('profiles','departments','personnel_titles','chat_rooms','department_request_approvers'))
) as snapshot;
commit;
`
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const root=path.resolve(import.meta.dirname,'../..')
  const output=path.join(root,'.tmp/permission-rollout/capture-readonly.sql')
  await fs.mkdir(path.dirname(output),{recursive:true})
  await fs.writeFile(output,captureQuery(await fs.readFile(path.join(root,migrationPath),'utf8')))
  console.log(`읽기 전용 쿼리만 생성했습니다. DB 연결/실행 없음: ${output}`)
}
