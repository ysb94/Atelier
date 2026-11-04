import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'

// Runs only in the existing synthetic, in-memory PGlite suite. No remote access.
const migration = 'supabase/migrations/20261104061531_leave_read_reconciliation_efficiency.sql'
const names = ['ensure_employee_birthday_leave', 'record_leave_expiry', 'refresh_employee_leave_before_birthday', 'employee_extra_leave_records']
const clock = sql => sql.replaceAll("(now() at time zone 'Asia/Seoul')::date", "current_setting('test.today')::date")

export async function prepareLeaveReadEfficiency({ db, actor, value, ops, company, foreign, dept }) {
  await db.exec('reset role')
  const originals = (await db.query(`select proname,pg_get_functiondef(oid) definition from pg_proc
    where pronamespace='app'::regnamespace and proname=any($1::text[]) order by proname`, [names])).rows
  assert.equal(originals.length, 4)
  const originalSql = originals.map(row => `${row.definition};`).join('\n')
  const optimizedSql = clock(await readFile(migration, 'utf8')).replace(/^begin;\s*/, '').replace(/\s*commit;\s*$/, '')
  const tables = ['public.profiles', 'public.employee_roster', 'public.company_leave_requests', 'app.employee_leave_accrual',
    'app.leave_base_periods', 'app.leave_balance_entries', 'app.employee_extra_leave', 'app.employee_extra_leave_usage',
    'app.leave_lifecycle_events', 'app.leave_advance_limits', 'app.leave_advance_authorizations', 'app.leave_advance_events']
  const snapshot = async () => Object.fromEntries(await Promise.all(tables.map(async table =>
    [table, await value(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from ${table} t`)])))
  const security = () => value(`select jsonb_build_object('functions',(select jsonb_agg(jsonb_build_object(
      'oid',oid,'acl',proacl,'owner',proowner,'security',prosecdef,'config',proconfig,'volatile',provolatile) order by oid)
    from pg_proc where pronamespace in ('public'::regnamespace,'app'::regnamespace)),
    'policies',(select jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname) from pg_policies p),
    'tables',(select jsonb_agg(jsonb_build_object('oid',oid,'acl',relacl,'rls',relrowsecurity,'force',relforcerowsecurity) order by oid)
      from pg_class where relnamespace in ('public'::regnamespace,'app'::regnamespace) and relkind='r'))`)
  const before = await snapshot(), securityBefore = await security()
  await db.exec(optimizedSql)
  assert.deepEqual(await snapshot(), before, 'Migration changes no existing employee, leave, request, allocation or history rows')
  assert.deepEqual(await security(), securityBefore, 'Function OIDs/ACLs/owners/volatility, tables and all policies remain identical')

  return async () => {
    await db.exec('reset role')
    let cases = 0
    const person = '95000000-0000-4000-8000-000000000001'
    const otherPerson = '95000000-0000-4000-8000-000000000002'
    const grant = '96000000-0000-4000-8000-000000000001'
    const request = '97000000-0000-4000-8000-000000000001'
    const today = date => db.query("select set_config('test.today',$1,true)", [date])
    async function seed({ id = person, hire = '2024-11-03', date = '2026-10-29', resident = '900501', balance = 5, accrual = true, status = 'active', resigned = null } = {}) {
      await today(date)
      await db.query("insert into profiles(id,company_id,department_id,status,display_name,hire_date) values($1,$2,$3,'active','LOCAL ONLY',$4)", [id, company, dept, hire])
      await db.exec("select set_config('app.roster_import','on',true)")
      await db.query(`insert into employee_roster(profile_id,company_id,remaining_annual_leave,accrued_annual_leave,resident_id,resigned_on)
        values($1,$2,$3,15,$4,$5)`, [id, company, balance, resident, resigned])
      await db.exec("select set_config('app.roster_import','',true)")
      if (accrual) await db.query(`insert into app.employee_leave_accrual
        select $1,$2,$3,starts_on,ends_on,grant_days,'read-efficiency-fixture',now(),now() from app.employee_leave_cycle($3,$4)`, [id, company, hire, date])
      if (status !== 'active') await db.query('update profiles set status=$2 where id=$1', [id, status])
    }
    // Compare full per-employee state; generated UUIDs/timestamps alone are
    // normalized so grant/event content, allocations and balances still compare.
    async function state(id = person) {
      return value(`select jsonb_build_object(
        'roster',(select to_jsonb(r)-'updated_at' from employee_roster r where profile_id=$1),
        'accrual',(select to_jsonb(a)-'updated_at'-'initialized_at' from app.employee_leave_accrual a where employee_id=$1),
        'periods',(select jsonb_agg(to_jsonb(p) order by period_key) from app.leave_base_periods p where employee_id=$1),
        'grants',(select jsonb_agg(to_jsonb(g)-'id'-'created_at'-'updated_at'-'deleted_at'||jsonb_build_object('deleted',g.deleted_at is not null) order by note,birthday_year)
          from app.employee_extra_leave g where employee_id=$1),
        'events',(select jsonb_agg(jsonb_build_object('source',e.source_kind,'sourceKey',coalesce(g.note,e.source_key),'kind',e.kind,
          'days',e.days,'date',e.effective_on,'actor',e.actor_id,'details',e.details) order by e.source_kind,coalesce(g.note,e.source_key),e.kind,e.days,e.effective_on)
          from app.leave_lifecycle_events e left join app.employee_extra_leave g on e.source_key=g.id::text where e.employee_id=$1),
        'requests',(select jsonb_agg(to_jsonb(r)-'created_at'-'decided_at' order by id) from company_leave_requests r where employee_id=$1),
        'entries',(select jsonb_agg(to_jsonb(e)-'created_at'-'debited_at'-'refunded_at' order by request_id) from app.leave_balance_entries e where employee_id=$1))`, [id])
    }
    async function golden(label, scenario) {
      await db.exec('reset role;begin;savepoint original')
      try {
        await db.exec(originalSql)
        const oldResult = await scenario()
        await db.exec('rollback to original')
        const newResult = await scenario()
        assert.deepEqual(newResult, oldResult, label)
        cases++
      } finally { await db.exec('rollback') }
    }
    for (const [resident, date, status, resigned] of [
      ['901105', '2026-10-28'], ['901105', '2026-10-29'], ['901105', '2026-11-12'], ['901105', '2026-11-13'],
      ['900103', '2026-12-27'], ['901229', '2027-01-03'], ['000229', '2026-02-21'], ['000229', '2028-02-22'],
      [null, '2026-10-29'], ['', '2026-10-29'], ['invalid', '2026-10-29'], ['900431', '2026-10-29'],
      ['901105', '2026-10-29', 'pending'], ['901105', '2026-10-29', 'active', '2026-10-01'],
    ]) {
      await golden(`Birthday eligibility and repeat: ${resident}/${date}/${status}`, async () => {
        await seed({ resident, date, status, resigned, accrual: false })
        await db.query('select app.ensure_employee_birthday_leave($1,$2)', [person, date])
        await db.query('select app.ensure_employee_birthday_leave($1,$2)', [person, date])
        return state()
      })
    }
    await golden('Cancelled birthday remains cancelled; no regrant', async () => {
      await seed({ resident: '901105' })
      await db.query("select app.ensure_employee_birthday_leave($1,'2026-10-29')", [person])
      await db.query('update app.employee_extra_leave set deleted_at=now() where employee_id=$1', [person])
      await db.query("select app.ensure_employee_birthday_leave($1,'2026-10-29')", [person])
      return state()
    })
    for (const [hire, start, end, balance, accrual] of [
      ['2024-11-03', '2026-10-29', '2026-10-29', 5, true],
      ['2024-11-03', '2026-10-29', '2026-11-03', -4.5, true],
      ['2024-11-03', '2026-10-29', '2026-11-04', -4.5, true],
      ['2026-01-31', '2026-02-28', '2026-03-01', 0, true],
      ['2026-01-31', '2026-10-29', '2026-11-01', 8, true],
      ['2024-02-29', '2026-02-28', '2026-03-01', 2, true],
      ['2024-02-29', '2028-02-29', '2028-03-01', 2, true],
      ['2024-12-31', '2026-12-31', '2027-01-01', 2, true],
      ['2024-11-03', '2026-10-29', '2026-11-04', 3, false],
      ['2024-11-03', '2026-10-29', '2026-11-04', null, false],
    ]) {
      await golden(`Full refresh dates/budgets: ${hire}/${start}/${end}/${balance}/${accrual}`, async () => {
        await seed({ hire, date: start, balance, accrual })
        await db.query('select app.refresh_employee_leave($1,$2)', [person, start])
        await today(end)
        await db.query('select app.refresh_employee_leave($1,$2)', [person, end])
        await db.query('select app.refresh_employee_leave($1,$2)', [person, end])
        return { state: await state(), summary: await value('select app.leave_advance_summary($1)', [person]) }
      })
    }
    await golden('Expiry: unused only, partial use, cancellation/recalculation and duplicate', async () => {
      await seed()
      await db.query("insert into app.leave_base_periods values($1,$2,'2025-01-01','2026-01-01',5)", [person, company])
      await db.query(`insert into app.employee_extra_leave(id,employee_id,company_id,days,granted_on,expires_on,note,created_by,updated_by)
        values($1,$2,$3,2,'2026-10-01','2026-10-28','LOCAL TEST',$4,$4)`, [grant, person, company, ops])
      await db.query("select app.record_leave_expiry($1,'2026-10-29')", [person])
      await db.query("select app.record_leave_expiry($1,'2026-10-29')", [person])
      await db.query('update app.employee_extra_leave set days=1 where id=$1', [grant])
      await db.query("select app.record_leave_expiry($1,'2026-10-29')", [person])
      await db.query('update app.employee_extra_leave set deleted_at=now() where id=$1', [grant])
      await db.query("select app.record_leave_expiry($1,'2026-10-29')", [person])
      return state()
    })
    // Actual request writes go through unchanged trigger/FEFO/advance paths.
    await golden('Quarter + half mixed birthday/base; cancel before/after expiry', async () => {
      await seed({ resident: '901105' })
      await actor(person)
      await db.query(`insert into company_leave_requests(id,employee_id,company_id,kind,from_date,to_date,start_time,end_time,note,place)
        values($1,$2,$3,'quarter','2026-10-29','2026-10-29','09:00','11:00','LOCAL TEST','')`, [request, person, company])
      await db.exec('reset role')
      await today('2026-11-13')
      await db.query("select app.refresh_employee_leave($1,'2026-11-13')", [person])
      await actor(person)
      await db.query("update company_leave_requests set status='cancelled' where id=$1", [request])
      await db.exec('reset role')
      return state()
    })
    // Existing fixture state covers cancelled grants, stopped users, zero/negative
    // balances and birthday/advance history. Warm once so IDs/times are stable.
    await actor(ops); await value('select public.employee_extra_leave_records()'); await db.exec('reset role')
    await golden('Management JSON response is byte-for-byte equivalent after normalization-free read', async () => {
      await actor(ops)
      return value('select public.employee_extra_leave_records()')
    })
    for (const id of [person, foreign]) {
      await db.exec('reset role;begin')
      if (id === person) await seed()
      await actor(id)
      await db.exec('savepoint denied')
      await assert.rejects(() => db.query('select public.employee_extra_leave_records()'), /권한/)
      await db.exec('rollback to denied')
      await assert.rejects(() => db.query("select app.ensure_employee_birthday_leave($1,'2026-10-29')", [id]), /permission denied/)
      await db.exec('rollback')
    }
    await db.exec('reset role;set role anon')
    await assert.rejects(() => db.query('select public.employee_extra_leave_records()'), /permission denied/)
    await db.exec('reset role')

    // PGlite is single-connection: inject a second writer's committed result at
    // the lock boundary to verify both functions recheck instead of using stale
    // preflight state. Real two-connection locking is a separate local test.
    await db.exec('begin')
    await seed({ resident: '901105' })
    await seed({ id: otherPerson, resident: '901105' })
    await db.query(`insert into app.employee_extra_leave(id,employee_id,company_id,days,granted_on,expires_on,note,created_by,updated_by)
      values($1,$2,$3,2,'2026-10-01','2026-10-28','LOCK RECHECK',$4,$4)`, [grant, person, company, ops])
    const birthdayOriginal = originals.find(row => row.proname === 'ensure_employee_birthday_leave').definition
      .replaceAll('app.ensure_employee_birthday_leave(', 'app.test_competing_birthday(')
    await db.exec(birthdayOriginal)
    await db.exec(`create function app.test_waited_leave_lock(key bigint) returns void language plpgsql as $$begin
      if current_setting('test.inject',true)='birthday' then
        perform set_config('test.inject','',true);
        perform app.test_competing_birthday('${otherPerson}','2026-10-29');
      elsif current_setting('test.inject',true)='expiry' then
        perform set_config('test.inject','',true);
        insert into app.leave_lifecycle_events(employee_id,company_id,source_kind,source_key,kind,days,effective_on)
          values('${person}','${company}','extra','${grant}','expired',-2,'2026-10-29');
      elsif current_setting('test.inject',true)='inactive' then
        perform set_config('test.inject','',true);update public.profiles set status='pending' where id='${person}';
      end if;
    end$$;`)
    await db.exec(optimizedSql.replaceAll('pg_catalog.pg_advisory_xact_lock(', 'app.test_waited_leave_lock('))
    await db.exec("select set_config('test.inject','birthday',true)")
    await db.query("select app.ensure_employee_birthday_leave($1,'2026-10-29')", [otherPerson])
    assert.equal(await value("select count(*)::int from app.employee_extra_leave where employee_id=$1 and grant_source='birthday'", [otherPerson]), 1)
    assert.equal(await value("select count(*)::int from app.leave_lifecycle_events where employee_id=$1 and kind='granted'", [otherPerson]), 1)
    await db.exec("select set_config('test.inject','inactive',true)")
    await db.query("select app.ensure_employee_birthday_leave($1,'2026-10-29')", [person])
    assert.equal(await value("select count(*)::int from app.employee_extra_leave where employee_id=$1 and grant_source='birthday'", [person]), 0)
    await db.exec("select set_config('test.inject','expiry',true)")
    await db.query("select app.record_leave_expiry($1,'2026-10-29')", [person])
    assert.equal(await value("select count(*)::int from app.leave_lifecycle_events where source_key=$1 and kind='expired'", [grant]), 1)
    await db.exec('rollback')

    await db.exec('begin')
    await seed()
    await db.query("select app.refresh_employee_leave($1,'2026-10-29')", [person])
    await db.exec(`create temporary table read_efficiency_calls(kind text);
      create function app.test_read_lock(key bigint) returns void language plpgsql as $$begin
        insert into pg_temp.read_efficiency_calls values('lock');perform pg_catalog.pg_advisory_xact_lock(key);end$$;
      create function app.test_read_write() returns trigger language plpgsql as $$begin
        insert into pg_temp.read_efficiency_calls values('write');return new;end$$;
      create trigger test_read_write after insert or update or delete on app.leave_base_periods for each row execute function app.test_read_write();
      create trigger test_read_write after insert or update or delete on app.employee_extra_leave for each row execute function app.test_read_write();
      create trigger test_read_write after insert or update or delete on app.leave_lifecycle_events for each row execute function app.test_read_write();`)
    const budget = await value("select pg_get_functiondef('app.fefo_budget(uuid,date,boolean)'::regprocedure)")
    await db.exec(budget.replace(/begin/i, "begin\ninsert into pg_temp.read_efficiency_calls values('budget');"))
    const available = await value("select pg_get_functiondef('app.extra_leave_available(uuid,date)'::regprocedure)")
    await db.exec(available.replace('app.extra_leave_available(', 'app.test_read_available_original('))
    await db.exec(`create or replace function app.extra_leave_available(p_employee uuid,p_today date) returns numeric language plpgsql security definer set search_path='' as $$begin
      insert into pg_temp.read_efficiency_calls values('available');return app.test_read_available_original(p_employee,p_today);end$$;`)
    async function measure(sql, identity, iterations = 15) {
      const out = []
      for (const definition of [originalSql, optimizedSql]) {
        await db.exec(definition.replaceAll('pg_catalog.pg_advisory_xact_lock(', 'app.test_read_lock('))
        await actor(identity)
        for (let n = 0; n < 3; n++) await value(sql)
        await db.exec('reset role;truncate read_efficiency_calls')
        await actor(identity)
        const start = performance.now()
        for (let n = 0; n < iterations; n++) await value(sql)
        const elapsed = performance.now() - start
        await db.exec('reset role')
        out.push({ msPerRead: Number((elapsed / iterations).toFixed(2)), counts: (await db.query('select kind,count(*)::int count from read_efficiency_calls group by kind order by kind')).rows })
      }
      return out
    }
    const own = await measure('select public.employee_leave_advances(false)', person)
    const management = await measure('select public.employee_extra_leave_records()', ops, 5)
    const count = (result, kind) => result.counts.find(row => row.kind === kind)?.count ?? 0
    assert.equal(count(own[1], 'budget') * 2, count(own[0], 'budget'), 'Ordinary employee refresh captures one unchanged budget instead of two')
    assert.ok(count(own[1], 'lock') < count(own[0], 'lock'), 'Ordinary employee no-op reconciliation avoids birthday/expiry locks')
    assert.equal(count(management[1], 'lock'), 0, 'Settled management read locks no employees')
    assert.equal(count(management[1], 'available') * 2, count(management[0], 'available'), 'Management balances calculate once, not twice')
    assert.equal(count(own[1], 'write'), 0); assert.equal(count(management[1], 'write'), 0)
    console.log('leave-read-efficiency benchmark (synthetic local DB; not production latency):', JSON.stringify({ ordinaryEmployee: own, management }))
    await db.exec('rollback')
    console.log(`leave-read-efficiency: ${cases} original/new state comparisons, full advance regression, permission/data/ACL preservation, lock rechecks, no-op writes and ordinary employee measurements passed`)
  }
}
