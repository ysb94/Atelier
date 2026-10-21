import crypto from 'node:crypto'

export const migrationPath = 'supabase/migrations/20261021033319_assigned_permissions.sql'
export const quote = value => `'${String(value).replaceAll("'", "''")}'`
export const identifier = value => `"${String(value).replaceAll('"', '""')}"`
export const digest = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')

// Keep dollar-quoted function bodies intact. This is a SQL boundary scanner, not a SQL rewriter.
export function statements(sql) {
  const result = []
  let start = 0, mode = null, dollar = '', depth = 0
  for (let i = 0; i < sql.length; i++) {
    const pair = sql.slice(i, i + 2)
    if (mode === 'line') { if (sql[i] === '\n') mode = null; continue }
    if (mode === 'block') { if (pair === '/*') { depth++; i++ } else if (pair === '*/') { if (--depth === 0) mode = null; i++ } continue }
    if (mode === 'dollar') { if (sql.startsWith(dollar, i)) { i += dollar.length - 1; mode = null } continue }
    if (mode === 'single' || mode === 'double') {
      const mark = mode === 'single' ? "'" : '"'
      if (sql[i] === mark) { if (sql[i + 1] === mark) i++; else mode = null }
      continue
    }
    if (pair === '--') { mode = 'line'; i++; continue }
    if (pair === '/*') { mode = 'block'; depth = 1; i++; continue }
    if (sql[i] === "'") { mode = 'single'; continue }
    if (sql[i] === '"') { mode = 'double'; continue }
    const tag = sql[i] === '$' && sql.slice(i).match(/^\$(?:[a-zA-Z_][\w]*)?\$/)?.[0]
    if (tag) { mode = 'dollar'; dollar = tag; i += tag.length - 1; continue }
    if (sql[i] === ';') { result.push(sql.slice(start, i + 1)); start = i + 1 }
  }
  if (mode && mode !== 'line') throw new Error('닫히지 않은 SQL 구간입니다.')
  if (sql.slice(start).replace(/--[^\n]*/g, '').trim()) throw new Error('마지막 SQL 문장의 세미콜론이 없습니다.')
  return result
}

export function splitMigration(sql) {
  const seed = sql.indexOf('-- 직책·부서 예외를 일회성 개인 지정으로 이전한다.')
  const activate = sql.indexOf('create or replace function app.is_admin()')
  if (seed < 0 || activate <= seed) throw new Error('마이그레이션의 준비/이관/전환 경계가 바뀌었습니다. 검토가 필요합니다.')
  const expand = sql.slice(0, seed).replace(/-- BEGIN LOCAL REHEARSAL GUARD[\s\S]*?-- END LOCAL REHEARSAL GUARD/, '')
  const backfill = sql.slice(seed, activate)
  const activation = sql.slice(activate)
  const newObjects=new Set([...expand.matchAll(/^create (?:table|function) (\w+\.\w+)/gim)].map(m=>m[1]))
  // Explicit allowlist: preparation must not replace existing functions, change old RLS, or write old rows.
  for (const statement of statements(expand)) {
    const clean = statement.replace(/--[^\n]*/g, '').trim()
    if(!/^(?:create (?:table|index|function|policy)|alter table|revoke|grant|insert into)\b/i.test(clean)) throw new Error('준비 단계에 허용하지 않은 명령이 있습니다.')
    if (/^(?:update|delete|truncate|drop)\b/i.test(clean)) throw new Error('준비 단계에 파괴적 문장이 있습니다.')
    if (/^create or replace|^create trigger|^alter (?!table public\.permission_)/i.test(clean)) throw new Error('준비 단계가 기존 객체를 바꿉니다.')
    if (/^insert into /i.test(clean) && !/^insert into app\.permission_catalog\b/i.test(clean)) throw new Error('준비 단계에 이관 쓰기가 있습니다.')
    if (/^create policy /i.test(clean) && !/ on public\.permission_(?:grants|grant_events)\b/i.test(clean)) throw new Error('준비 단계가 기존 접근 규칙을 바꿉니다.')
    if(/^(?:grant|revoke)\b/i.test(clean)) for(const name of clean.match(/\b(?:app|public)\.\w+/g)??[]) if(!newObjects.has(name)) throw new Error('준비 단계가 기존 객체의 실행 권한을 바꿉니다.')
  }
  return { expand, backfill, activation }
}

export const fingerprintQueries = {
  profiles: 'select md5(coalesce(jsonb_agg(to_jsonb(p) order by id),\'[]\')::text) from public.profiles p',
  approvers: 'select md5(coalesce(jsonb_agg(to_jsonb(a) order by company_id,department_id,request_type),\'[]\')::text) from public.department_request_approvers a',
  capabilities: 'select md5(coalesce(jsonb_agg(to_jsonb(c) order by profile_id,capability),\'[]\')::text) from public.profile_capabilities c',
  memberships: 'select md5(coalesce(jsonb_agg(to_jsonb(b) order by brand_id,profile_id),\'[]\')::text) from public.brand_members b',
  partnerEditors: 'select md5(coalesce(jsonb_agg(to_jsonb(e) order by brand_id,usage_target_id,profile_id),\'[]\')::text) from public.usage_partner_editors e',
  departments: 'select md5(coalesce(jsonb_agg(to_jsonb(d) order by id),\'[]\')::text) from public.departments d',
  titles: 'select md5(coalesce(jsonb_agg(to_jsonb(t) order by id),\'[]\')::text) from public.personnel_titles t',
  authUserIds: 'select md5(coalesce(jsonb_agg(id order by id),\'[]\')::text) from auth.users',
}

export function schemaFingerprintQuery(snapshot) {
  const names=[...new Set([...snapshot.routines,...(snapshot.dependencies??[])].map(r=>r.schema+'.'+r.name))]
  const tables=snapshot.tableSecurity.map(t=>t.schema+'.'+t.table)
  const named=names.map(quote).join(',')||"''", tabular=tables.map(quote).join(',')||"''"
  return `select md5(jsonb_build_object(
    'routines',(select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'identity',pg_get_function_identity_arguments(p.oid),'definition',pg_get_functiondef(p.oid),'acl',(select jsonb_agg(jsonb_build_object('grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'grantor',pg_get_userbyid(a.grantor),'privilege',a.privilege_type,'grantable',a.is_grantable) order by case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,pg_get_userbyid(a.grantor),a.privilege_type) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a),'owner',pg_get_userbyid(p.proowner)) order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),'[]') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prokind='f' and n.nspname||'.'||p.proname in (${named})),
    'policies',(select coalesce(jsonb_agg(to_jsonb(pol) order by schemaname,tablename,policyname),'[]') from pg_policies pol where schemaname||'.'||tablename in (${tabular})),
    'triggers',(select coalesce(jsonb_agg(jsonb_build_object('definition',pg_get_triggerdef(t.oid,true),'enabled',t.tgenabled) order by n.nspname,c.relname,t.tgname),'[]') from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname||'.'||c.relname in (${tabular})),
    'tables',(select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity) order by n.nspname,c.relname),'[]') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname||'.'||c.relname in (${tabular}))
  )::text) as fingerprint`
}

export function schemaAssertion(snapshot) {
  if(!/^[a-f0-9]{32}$/.test(snapshot.schemaFingerprint??''))throw new Error('서버 함수·접근 규칙 비교 기준이 없습니다.')
  return `do $schema$ begin if (${schemaFingerprintQuery(snapshot)}) is distinct from ${quote(snapshot.schemaFingerprint)} then raise exception '서버 함수·접근 규칙이 기준 이후 바뀌었습니다. 최신 스냅샷과 복구 패키지를 다시 준비하세요.'; end if; end $schema$;`
}

export function protectedAssertion(fingerprints, label = '기존 데이터') {
  return `do $preserve$ begin\n${Object.entries(fingerprintQueries).map(([key, query]) => {
    if (!/^[a-f0-9]{32}$/.test(fingerprints[key] ?? '')) throw new Error(`비교 기준이 없습니다: ${key}`)
    return ` if (${query}) is distinct from ${quote(fingerprints[key])} then raise exception ${quote(`${label}: ${key}가 달라졌습니다. 실행을 중단하고 다시 비교하세요.`)}; end if;`
  }).join('\n')}\nend $preserve$;`
}

export function restorePolicies(snapshot, added = []) {
  const keys = new Map()
  for (const p of snapshot.policies) keys.set(`${p.schemaname}.${p.tablename}.${p.policyname}`, { schema:p.schemaname, table:p.tablename, name:p.policyname })
  for (const p of added) keys.set(`${p.schema}.${p.table}.${p.name}`, p)
  const drops = [...keys.values()].map(p => `drop policy if exists ${identifier(p.name)} on ${identifier(p.schema)}.${identifier(p.table)};`)
  const creates = snapshot.policies.map(p => `create policy ${identifier(p.policyname)} on ${identifier(p.schemaname)}.${identifier(p.tablename)} as ${p.permissive} for ${p.cmd} to ${(Array.isArray(p.roles) ? p.roles : p.roles.slice(1,-1).split(',')).map(r => r.toLowerCase() === 'public' ? 'PUBLIC' : identifier(r)).join(', ')}${p.qual ? ` using (${p.qual})` : ''}${p.with_check ? ` with check (${p.with_check})` : ''};`)
  return [...drops, ...creates].join('\n')
}

export function restoreRoutines(snapshot) {
  return snapshot.routines.map(r => {
    const signature = `${identifier(r.schema)}.${identifier(r.name)}(${r.identity})`
    // CREATE OR REPLACE retains altered grants: restore EXECUTE ACL explicitly, including PUBLIC.
    return `${r.definition.trim().replace(/;$/, '')};\nalter function ${signature} owner to ${identifier(r.owner)};\nrevoke all on function ${signature} from PUBLIC,anon,authenticated;\n${(r.acl ?? []).filter(a => a.privilege === 'EXECUTE').map(a => `grant execute on function ${signature} to ${a.grantee === 'PUBLIC' ? 'PUBLIC' : identifier(a.grantee)}${a.grantable ? ' with grant option' : ''};`).join('\n')}`
  }).join('\n\n')
}

export function policyTargets(sql) {
  return [...sql.matchAll(/^create policy (\w+) on (\w+)\.(\w+)/gim)].filter(m => !m[3].startsWith('permission_')).map(m => ({ name:m[1], schema:m[2], table:m[3] }))
}

export const disableWriters = `revoke all on function public.set_permission_grant(uuid,text,text,uuid,boolean,text),app.set_permission_grant(uuid,text,text,uuid,boolean,text) from PUBLIC,anon,authenticated;`
export const enableWriters = `grant execute on function public.set_permission_grant(uuid,text,text,uuid,boolean,text),app.set_permission_grant(uuid,text,text,uuid,boolean,text) to authenticated;`

export function stageSql(sql, snapshot) {
  const parts = splitMigration(sql)
  if (snapshot.newPermissionDbPresent) throw new Error('이미 새 권한 저장소가 있는 DB입니다. 이 최초 전환 패키지를 재사용할 수 없습니다.')
  const check = protectedAssertion(snapshot.fingerprints)
  const schemaCheck = schemaAssertion(snapshot)
  const ready = `do $release$ begin if current_setting('atelier.permission_release_ready',true) is distinct from ${quote(digest(sql))} then raise exception '호환 앱·서버·복구 준비 확인이 필요합니다. 전환을 중단합니다.'; end if; end $release$;`
  const locks = 'lock table public.profiles,public.department_request_approvers,public.profile_capabilities,public.brand_members,public.usage_partner_editors,public.departments,public.personnel_titles in share row exclusive mode;'
  const header = `-- 자동 적용 금지. 별도 승인 후에만 실행. 원본 ${digest(sql)} / 기준 ${snapshot.capturedAt}\n`
  const prepare = `${header}begin;\nset local timezone='UTC';\nset local lock_timeout='5s';\n${locks}\n${check}\n${schemaCheck}\n${parts.expand}\nrevoke all on app.permission_catalog from PUBLIC,anon,authenticated;\n${disableWriters}\n${check}\n${schemaCheck}\ncommit;\n`
  const activate = `${header}begin;\nset local timezone='UTC';\nset local lock_timeout='5s';\n${locks}\n${ready}\n${check}\n${schemaCheck}\n${parts.backfill}\n${parts.activation}\n${enableWriters}\n${check}\ncommit;\n`
  const rollback = `${header}-- 업무 데이터를 과거로 되돌리지 않고 함수·접근 규칙만 복구합니다.\nbegin;\nset local timezone='UTC';\nset local lock_timeout='5s';\n${locks}\n${disableWriters}\ndrop trigger if exists provision_basic_permission on public.profiles;\nset local check_function_bodies=off;\n${restoreRoutines(snapshot)}\n${restorePolicies(snapshot,policyTargets(parts.activation))}\n${snapshot.tableSecurity.map(t=>`alter table ${identifier(t.schema)}.${identifier(t.table)} ${t.rls?'enable':'disable'} row level security;\nalter table ${identifier(t.schema)}.${identifier(t.table)} ${t.forceRls?'force':'no force'} row level security;`).join('\n')}\n-- 새 원본과 변경 이력은 조사·재전환을 위해 보존하며, 공개 진입점은 잠급니다.\nrevoke all on function public.list_my_permission_grants(),public.permission_directory(),public.set_permission_grant(uuid,text,text,uuid,boolean,text),public.list_company_attendance_exempt() from PUBLIC,anon,authenticated;\ncommit;\n`
  return { ...parts, prepare, activate, rollback, preflight:`begin read only;\nset local timezone='UTC';\n${check}\n${schemaCheck}\ncommit;\n` }
}
