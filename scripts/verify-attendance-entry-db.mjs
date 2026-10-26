import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

// 실제 Supabase가 아닌 메모리 PostgreSQL에서 배포한 SQL을 검증한다.
const db = await PGlite.create()
try {
  await db.exec(`create role anon; create role authenticated;
    create schema auth; create schema app;
    grant usage on schema public,auth,app to anon,authenticated;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table public.profiles(id uuid primary key,email text,company_id uuid,department_id uuid,status text);
    create table public.attendance_clock_ins(id uuid primary key default gen_random_uuid(),company_id uuid,employee_id uuid,work_date date,clock_in time,clock_out_at timestamptz,created_at timestamptz default now(),unique(employee_id,work_date));
    create table public.attendance_start_settings(id uuid primary key,company_id uuid,month date,department_id uuid,employee_id uuid,source text,start_time time,updated_at timestamptz);
    create table public.company_work_hours(company_id uuid primary key,lunch_start time,lunch_end time);
    create table public.company_leave_requests(id uuid primary key,company_id uuid,employee_id uuid,kind text,from_date date,to_date date,start_time time,end_time time,status text,created_at timestamptz);
    insert into public.profiles values('10000000-0000-4000-8000-000000000001','dev@atelier.local','e0000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','active');`)
  await db.exec(await readFile('supabase/migrations/20261026103425_attendance_previous_checkout.sql','utf8'))
  const result = await db.exec(await readFile('supabase/tests/attendance_previous_checkout.sql','utf8'))
  assert.equal(result.at(-1).rows[0].verification,'attendance_previous_checkout_db_tests_passed')
  assert.equal((await db.query('select count(*) n from public.attendance_clock_ins')).rows[0].n,0,'시험 후 출퇴근 행이 남지 않음')
  console.log('attendance-entry-db: 실제 마이그레이션 적용·본인 조회·개인 우선/부서 보완·익명/타인/날짜/범위 거부·정정 중복 제외·새벽 퇴근·멱등 저장·사용자/기존 기록 보존 통과 (로컬 메모리 PostgreSQL)')
} finally { await db.close() }
