import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const db = await PGlite.create()
const company = 'e0000000-0000-4000-8000-000000000001', other = 'e0000000-0000-4000-8000-000000000002'
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const session = '20000000-0000-4000-8000-000000000001'
const value = async (sql, args) => Object.values((await db.query(sql, args)).rows[0])[0]
const actor = async (who, tokenSession = session) => db.exec(`reset role;select set_config('request.jwt.claims','${JSON.stringify({ sub: who, session_id: tokenSession })}',false);set role authenticated;`)
const denied = async (sql, args) => assert.rejects(() => db.query(sql, args))
try {
  await db.exec(`create role anon;create role authenticated;create schema app;create schema auth;
    grant usage on schema public,app,auth to authenticated,anon;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
    create table auth.sessions(id uuid primary key,user_id uuid);
    create table public.companies(id uuid primary key);
    create table public.departments(id uuid primary key,name text);
    create table public.profiles(id uuid primary key,company_id uuid,status text,display_name text,hire_date date,department_id uuid,manager boolean default false);
    create table public.employee_roster(profile_id uuid primary key,company_id uuid,remaining_annual_leave numeric(7,2),resigned_on date);
    create table public.impersonation_events(id uuid primary key default gen_random_uuid(),target_id uuid,ended_at timestamptz);
    create function app.can_edit_org_assignment() returns boolean language sql stable as $$select coalesce((select manager from public.profiles where id=auth.uid() and status='active'),false)$$;
    grant select on public.profiles to authenticated;
    insert into public.companies values('${company}'),('${other}');
    insert into public.profiles(id,company_id,status,display_name,manager) values('${id(1)}','${company}','active','담당자',true),('${id(20)}','${other}','active','타사 담당자',true);
    insert into public.employee_roster values('${id(1)}','${company}',null,null);`)
  const fingerprint = "select md5(jsonb_build_array((select jsonb_agg(p order by id) from public.profiles p),(select jsonb_agg(r order by profile_id) from public.employee_roster r))::text)"
  const before = await value(fingerprint)
  await db.exec(await readFile('supabase/migrations/20261028120107_leave_usage_notice_delivery.sql', 'utf8'))
  await db.exec(await readFile('supabase/migrations/20261028122339_harden_leave_notice_receipts.sql', 'utf8'))
  assert.equal(await value(fingerprint), before, 'schema install must not alter existing records')
  assert.equal(await value("select app.leave_notice_cycle('2024-02-29','2026-02-28')::text"), '2027-02-28')
  assert.equal(await value("select app.leave_notice_cycle('2024-02-29','2028-02-28')::text"), '2028-02-29')
  assert.equal(await value("select app.leave_notice_cycle('2025-11-03','2026-11-03')::text"), '2027-11-03')
  assert.equal(await value("select app.leave_notice_cycle('2030-01-01','2026-10-28')"), null)
  await db.exec(`insert into app.leave_notice_settings values('${company}',true,now());`)
  // Existing roster writes bind their balance to the current hire cycle without changing it.
  for (const [n, days, balance, status, resigned] of [[2,60,7,'active',null],[3,21,3.5,'active',null],[4,7,1,'active',null],[5,7,0,'active',null],[6,7,-1,'active',null],[7,7,null,'active',null],[8,7,7,'disabled',null],[9,7,7,'active','2020-01-01'],[10,7,7,'active',null]]) {
    await db.query(`insert into public.profiles(id,company_id,status,display_name,hire_date) select $1,$2,$3,'직원 '||$4::text,make_date(extract(year from (now() at time zone 'Asia/Seoul')::date)::int-2,extract(month from (now() at time zone 'Asia/Seoul')::date+$5::int+1)::int,extract(day from (now() at time zone 'Asia/Seoul')::date+$5::int+1)::int)`, [id(n),company,status,n,days])
    await db.query('insert into public.employee_roster values($1,$2,$3,$4)',[id(n),company,balance,resigned])
  }
  await db.exec(`update app.leave_notice_balance_cycles set expires_on=expires_on-365 where employee_id='${id(10)}';
    insert into public.profiles(id,company_id,status,display_name) values('${id(11)}','${company}','active','입사일 없음');
    insert into public.employee_roster values('${id(11)}','${company}',7,null);
    insert into public.profiles(id,company_id,status,display_name,hire_date) select '${id(12)}','${other}','active','다른 회사',hire_date from public.profiles where id='${id(4)}';
    insert into public.employee_roster values('${id(12)}','${other}',7,null);
    insert into auth.sessions values('${session}','${id(3)}');`)
  assert.equal(await value('select app.dispatch_leave_usage_notices()'), 3)
  assert.equal(await value('select app.dispatch_leave_usage_notices()'), 0)
  const records = (await db.query('select * from public.leave_usage_notices order by employee_id')).rows
  assert.deepEqual(records.map(r=>r.phase), ['threeMonths','oneMonth','twoWeeks'])
  assert.equal(records[1].remaining_days, '3.50')
  assert.ok(records[1].body.includes('3.5일'))
  assert.ok(!records[0].body.includes('샘플'))
  assert.ok(records[2].body.includes('7일 남아'), 'catchup uses actual days remaining')
  const notice = records[1]
  await actor(id(3))
  assert.equal(Number(await value('select count(*) from public.leave_usage_notices')),1)
  await denied('select * from app.leave_notice_settings')
  await denied('select app.dispatch_leave_usage_notices()')
  await denied('select public.leave_usage_notice_management()')
  await denied("update public.leave_usage_notices set confirmed_at=now()")
  await denied('delete from public.leave_usage_notices')
  await denied("insert into public.leave_usage_notices(id) values(gen_random_uuid())")
  await denied("select public.record_leave_usage_notice($1,'confirm')",[notice.id])
  await db.query("select public.record_leave_usage_notice(null,'read')")
  let own=(await db.query('select * from public.leave_usage_notices')).rows[0]
  assert.ok(own.read_at); assert.equal(own.viewed_at,null); assert.equal(own.confirmed_at,null)
  // Another tab may record read after this transaction began. view must stay >= read.
  await db.exec(`reset role;begin;update public.leave_usage_notices set read_at=clock_timestamp() where id='${notice.id}';set role authenticated;`)
  await db.query("select public.record_leave_usage_notice($1,'view')",[notice.id])
  await db.exec('commit')
  own=(await db.query('select * from public.leave_usage_notices')).rows[0]
  assert.ok(own.viewed_at); assert.equal(own.confirmed_at,null)
  await denied("select public.record_leave_usage_notice($1,'view')",[records[0].id])
  await db.query("select public.record_leave_usage_notice($1,'confirm')",[notice.id])
  const first=(await db.query('select * from public.leave_usage_notices')).rows[0]
  await db.query("select public.record_leave_usage_notice($1,'confirm')",[notice.id])
  const again=(await db.query('select * from public.leave_usage_notices')).rows[0]
  assert.equal(String(again.confirmed_at),String(first.confirmed_at));assert.equal(again.body,notice.body)
  await actor(id(1));const management=await value('select public.leave_usage_notice_management()')
  assert.equal(management.notices.length,3);assert.equal(management.notices.some(row=>'confirmed_session_id' in row),false)
  assert.equal(Number(await value('select count(*) from public.leave_usage_notices')),0,'manager table RLS remains own-only')
  await denied("select public.record_leave_usage_notice($1,'confirm')",[notice.id])
  await actor(id(20));assert.equal((await value('select public.leave_usage_notice_management()')).notices.length,0)
  await actor(id(3),'30000000-0000-4000-8000-000000000001');await denied("select public.record_leave_usage_notice($1,'confirm')",[notice.id])
  await db.exec(`reset role;insert into public.impersonation_events(target_id) values('${id(3)}')`)
  await actor(id(3));await denied("select public.record_leave_usage_notice($1,'view')",[notice.id]);await denied("select public.record_leave_usage_notice($1,'confirm')",[notice.id])
  await db.exec('reset role;set role anon');await denied('select * from public.leave_usage_notices');await denied("select public.record_leave_usage_notice(null,'read')");await denied('select public.leave_usage_notice_management()')
  await db.exec('reset role');assert.equal(await value("select remaining_annual_leave::text from public.employee_roster where profile_id='"+id(3)+"'"),'3.50')
  console.log('leave-usage-notices-db: cycle/leap/expiry, latest due phase, exclusions, idempotence, original data preservation, read/view/confirm separation, first timestamps, own/company/manager/anonymous isolation, invalid and impersonated session rejection passed')
} finally { await db.close() }
