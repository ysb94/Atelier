import { PGlite } from '@electric-sql/pglite'
import { fingerprintQueries, restorePolicies, restoreRoutines, identifier } from './sql.mjs'

// Isolated local PostgreSQL/WASM. No Supabase client, URL, credentials, or network connection.
export async function sandbox(snapshot) {
  const db = await PGlite.create()
  try {
    await db.exec(`set timezone='UTC'; create role anon; create role authenticated; create role service_role;
      create schema app; create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create table auth.users(id uuid primary key);
      create table public.companies(id uuid primary key,name text);
      create table public.departments(id uuid primary key,company_id uuid,name text,sort_order integer,is_active boolean,personnel_scope text,created_at timestamptz,updated_at timestamptz);
      create table public.profiles(id uuid primary key,company_id uuid,department_id uuid,email text,display_name text,position text,job_grade text,status text,is_admin boolean,hire_date date,approved_by uuid,approved_at timestamptz,name_confirmed_at timestamptz,avatar_url text,request_note text,requested_at timestamptz,created_at timestamptz,updated_at timestamptz);
      create table public.personnel_titles(id uuid primary key,company_id uuid,kind text,name text,sort_order integer,created_at timestamptz,updated_at timestamptz);
      create table public.brands(id uuid primary key,company_id uuid,name text);
      create table public.ai_feature_routes(id uuid primary key default gen_random_uuid(),brand_id uuid,feature_key text,updated_at timestamptz);
      create table public.profile_capabilities(profile_id uuid,capability text,created_at timestamptz);
      create table public.brand_members(profile_id uuid,brand_id uuid,is_lead boolean,created_at timestamptz,updated_at timestamptz);
      create table public.code_usage_targets(id uuid primary key,brand_id uuid,name text);
      create table public.usage_partner_editors(profile_id uuid,brand_id uuid,usage_target_id uuid);
      create table public.chat_rooms(id uuid primary key,company_id uuid,name text);
      create table public.chat_room_members(room_id uuid,profile_id uuid);
      create table public.department_request_approvers(company_id uuid,department_id uuid,request_type text,approver_id uuid,substitute_id uuid,updated_by uuid,updated_at timestamptz,primary key(company_id,department_id,request_type));
      create table public.company_notices(id uuid primary key default gen_random_uuid(),company_id uuid,slot text,department_id uuid,title text,body text,starts_on date,ends_on date,published boolean,updated_by uuid,updated_at timestamptz default now());
      create table public.attendance_start_settings(company_id uuid,month date,department_id uuid,employee_id uuid,source text,start_time time,grace_minutes integer,updated_by uuid,updated_at timestamptz default now());
      create unique index attendance_department on public.attendance_start_settings(company_id,department_id,month) where employee_id is null;
      create unique index attendance_employee on public.attendance_start_settings(company_id,employee_id,month) where employee_id is not null;
      grant usage on schema auth,app,public to authenticated,anon;
      grant select,insert,update,delete on all tables in schema public to authenticated;
      create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$;
      set check_function_bodies=off;`)
    const mappings = {companies:'companies',profiles:'profiles',departments:'departments',titles:'personnel_titles',capabilities:'profile_capabilities',memberships:'brand_members',brands:'brands',partners:'code_usage_targets',partnerEditors:'usage_partner_editors',approvers:'department_request_approvers',chatRooms:'chat_rooms'}
    for (const [key, table] of Object.entries(mappings)) {
      const columns = new Set((await db.query('select column_name from information_schema.columns where table_schema=$1 and table_name=$2',['public',table])).rows.map(r=>r.column_name))
      for (const row of snapshot.data[key] ?? []) {
        const keys = Object.keys(row).filter(k => columns.has(k))
        await db.query(`insert into public.${identifier(table)}(${keys.map(identifier).join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')})`,keys.map(k=>row[k]))
      }
    }
    for (const id of snapshot.data.authUserIds ?? []) await db.query('insert into auth.users values($1)',[id])
    if (snapshot.routines.length || snapshot.dependencies?.length) await db.exec(restoreRoutines({routines:[...(snapshot.dependencies??[]),...snapshot.routines]}))
    if (snapshot.policies.length) await db.exec(restorePolicies(snapshot))
    for (const t of snapshot.tableSecurity) await db.exec(`alter table ${identifier(t.schema)}.${identifier(t.table)} ${t.rls?'enable':'disable'} row level security; alter table ${identifier(t.schema)}.${identifier(t.table)} ${t.forceRls?'force':'no force'} row level security;`)
    for (const t of snapshot.triggers) await db.exec(t.definition+';')
    await db.exec('set check_function_bodies=on;')
    return db
  } catch (error) { await db.close(); throw error }
}

export async function fingerprints(db) {
  const entries = []
  for (const [key,sql] of Object.entries(fingerprintQueries)) entries.push([key,Object.values((await db.query(sql)).rows[0])[0]])
  return Object.fromEntries(entries)
}

export async function metadata(db, snapshot) {
  const names = [...new Set(snapshot.routines.map(r=>r.schema+'.'+r.name))]
  const routines = (await db.query(`select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) as identity,pg_get_functiondef(p.oid) as definition,p.proacl::text as acl,pg_get_userbyid(p.proowner) as owner from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname||'.'||p.proname=any($1::text[]) order by n.nspname,p.proname,identity`,[names])).rows
  const tables = snapshot.tableSecurity.map(t=>t.schema+'.'+t.table)
  const policies = (await db.query(`select * from pg_policies where schemaname||'.'||tablename=any($1::text[]) order by schemaname,tablename,policyname`,[tables])).rows
  const triggers = (await db.query(`select pg_get_triggerdef(t.oid,true) as definition,t.tgenabled from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname||'.'||c.relname=any($1::text[]) order by t.tgname`,[tables])).rows
  return {routines,policies,triggers}
}
