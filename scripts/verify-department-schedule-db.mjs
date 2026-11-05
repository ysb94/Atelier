import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
const db = new PGlite(), id = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0]
const actor = async who => db.exec(`reset role;set request.jwt.claim.sub='${who || ''}';set role authenticated`)
const list = async (from = '2026-11-01', to = '2026-11-30') => (await db.query('select * from list_my_department_absences($1,$2)', [from, to])).rows
try {
  await db.exec(`create role anon;create role authenticated;create schema app;create schema auth;
    grant usage on schema app,auth,public to authenticated,anon;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table profiles(id uuid primary key,company_id uuid,department_id uuid,status text,display_name text);
    create table departments(id uuid primary key,company_id uuid,is_active boolean);
    insert into departments values('${id(20)}','${id(30)}',true),('${id(21)}','${id(30)}',true),('${id(22)}','${id(31)}',true);
    insert into profiles values
     ('${id(1)}','${id(30)}','${id(20)}','active','조회 직원'),('${id(2)}','${id(30)}','${id(20)}','active','동료'),
     ('${id(3)}','${id(30)}','${id(21)}','active','타부서'),('${id(4)}','${id(31)}','${id(20)}','active','타사'),
     ('${id(5)}','${id(30)}','${id(20)}','pending','승인 대기'),('${id(6)}','${id(30)}',null,'active','미배치');
    create table company_leave_requests(id uuid primary key,employee_id uuid,company_id uuid,department_id uuid,kind text,status text,from_date date,to_date date,start_time time,end_time time,end_next_day boolean default false,offsite_continuous boolean default false,note text default '비공개 사유',place text default '비공개 장소',attachments jsonb default '["private"]');
    grant select on profiles,company_leave_requests to authenticated;
    alter table company_leave_requests enable row level security;
    create policy original_read on company_leave_requests for select to authenticated using(employee_id=auth.uid());
    create table approvers(id uuid primary key,employee_id uuid);insert into approvers values('${id(90)}','${id(3)}');`)
  let n = 100
  const insert = async (employee, kind, status = 'approved', extras = {}) => {
    const request = id(n++), values = { from: '2026-11-05', to: '2026-11-05', start: '09:00', end: '18:00', next: false, continuous: false, company: id(30), ...extras }
    await db.query('insert into company_leave_requests(id,employee_id,company_id,department_id,kind,status,from_date,to_date,start_time,end_time,end_next_day,offsite_continuous) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [request, employee, values.company, id(21), kind, status, values.from, values.to, values.start, values.end, values.next, values.continuous])
    return request
  }
  const expected = []
  for (const kind of ['annual', 'half', 'quarter', 'offsite', 'official']) expected.push(await insert(id(2), kind))
  expected.push(await insert(id(2), 'offsite', 'approved', { from: '2026-10-31', to: '2026-10-31', start: '22:00', end: '02:00', next: true }))
  for (const status of ['pending', 'cancelled', 'rejected']) await insert(id(2), 'annual', status)
  for (const kind of ['overtime', 'correction', 'remote']) await insert(id(2), kind)
  for (const employee of [id(1), id(3), id(4), id(5)]) await insert(employee, 'annual')
  await insert(id(2), 'annual', 'approved', { company: id(31) })
  await insert(id(2), 'annual', 'approved', { from: '2026-12-01', to: '2026-12-02' })
  const fingerprint = () => scalar(`select md5(jsonb_build_object('profiles',(select jsonb_agg(t order by id) from profiles t),'requests',(select jsonb_agg(t order by id) from company_leave_requests t),'approvers',(select jsonb_agg(t order by id) from approvers t),'policies',(select jsonb_agg(t order by schemaname,tablename,policyname) from pg_policies t),'grants',(select jsonb_agg(t order by table_name,grantee,privilege_type) from information_schema.table_privileges t where table_schema='public'))::text)`)
  const before = await fingerprint()
  await db.exec(await readFile('supabase/migrations/20261105054259_department_absence_schedule.sql', 'utf8'))
  assert.equal(await fingerprint(), before, 'migration leaves existing records/policies/table grants intact')
  await actor(id(1)); const rows = await list()
  assert.deepEqual(rows.map(r => r.request_id).sort(), expected.sort())
  assert.equal(rows.every(r => r.display_name === '동료'), true)
  assert.deepEqual(Object.keys(rows[0]).sort(), ['request_id', 'employee_id', 'display_name', 'kind', 'from_date', 'to_date', 'start_time', 'end_time', 'end_next_day', 'offsite_continuous'].sort())
  assert.equal(await scalar('select count(*) from company_leave_requests'), 1, 'raw detail RLS not widened')
  await assert.rejects(db.query('update company_leave_requests set note=$1', ['tamper']), e => e.code === '42501')
  for (const [from, to] of [[null, '2026-11-30'], ['2026-11-10', '2026-11-01'], ['2026-01-01', '2026-12-31']]) await assert.rejects(list(from, to), e => e.code === '22023')
  await actor(id(5)); await assert.rejects(list(), e => e.code === '42501')
  await actor(null); await assert.rejects(list(), e => e.code === '42501')
  await actor(id(6)); assert.deepEqual(await list(), [])
  await actor(id(4)); assert.deepEqual(await list(), [], 'foreign-company department mismatch returns none')
  await db.exec('reset role;set role anon'); await assert.rejects(list(), e => e.code === '42501')
  // Current department determines sharing, not the saved request department snapshot.
  await db.exec(`reset role;update profiles set department_id='${id(21)}' where id='${id(2)}'`)
  await actor(id(1)); assert.deepEqual(await list(), [])
  await db.exec(`reset role;update profiles set department_id='${id(21)}' where id='${id(1)}'`)
  await actor(id(1)); assert.equal((await list()).length, expected.length + 1)
  await db.exec(`reset role;update departments set is_active=false where id='${id(21)}'`)
  await actor(id(1)); assert.deepEqual(await list(), [])
  console.log('PASS department schedule SQL: same active department/company, confirmed kinds/window, current placement, private-field projection, no edit/raw-detail escalation; originals preserved')
} finally { await db.close() }
