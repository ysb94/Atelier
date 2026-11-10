import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// Add the real November workforce guard to the full production function used
// by each existing regression suite. The other function is an unused fixture
// so the same two-function migration can execute without relaxing its checks.
export async function verifyWorkforceGuardAlias(db, actual) {
  const signatures = {
    presence: 'app.advance_attendance_presence(uuid,timestamp with time zone)',
    notice: 'app.dispatch_extra_leave_grant_notice(uuid)',
  }
  const originalMigration = await readFile('supabase/migrations/20261105080213_workforce_management_and_logistics_operations.sql', 'utf8')
  await db.exec(`create function app.workforce_mode(uuid) returns text language sql stable as $$
    select coalesce(nullif(current_setting('test.workforce_mode',true),''),'head-office')$$`)
  if (actual === 'presence') {
    await db.exec(`create function app.dispatch_extra_leave_grant_notice(p_grant uuid) returns integer language plpgsql as $$declare g record; begin return 0; end$$`)
  } else {
    await db.exec(`create function app.advance_attendance_presence(p_clock_id uuid,p_now timestamptz) returns void language plpgsql as $$declare c record; begin return; end$$`)
  }
  const scalar = async (sql, args) => Object.values((await db.query(sql, args)).rows[0])[0]
  for (const signature of Object.values(signatures)) {
    const line = originalMigration.split('\n').find(line => line.includes(`('${signature}',`))
    assert.ok(line, `Original scope guard: ${signature}`)
    const guard = line.slice(line.indexOf(", '") + 3, line.lastIndexOf("')")).replaceAll("''", "'")
    const definition = await scalar('select pg_get_functiondef($1::regprocedure)', [signature])
    await db.exec(definition.replace(/\bbegin\b/i, `begin\n-- workforce management boundary\n${guard}\n`))
  }
  const probe = actual === 'presence'
    ? "select app.advance_attendance_presence('00000000-0000-4000-8000-000000000000',now())"
    : "select app.dispatch_extra_leave_grant_notice('00000000-0000-4000-8000-000000000000')"
  await assert.rejects(() => db.query(probe), /ambiguous|not assigned yet/, 'Original production failure reproduced')
  const snapshot = () => db.query('select oid,proacl,proowner,proconfig,prosecdef from pg_proc where oid in ($1::regprocedure,$2::regprocedure) order by oid', Object.values(signatures))
  const before = (await snapshot()).rows
  const migration = await readFile('supabase/migrations/20261110092909_workforce_guard_alias_fix.sql', 'utf8')
  await db.exec(migration)
  await db.query(probe)
  assert.deepEqual((await snapshot()).rows, before, 'Existing permissions, owner and function settings preserved')
  await db.exec(migration)
  await db.query(probe)
  console.log(`workforce-alias (${actual}): original failure reproduced, fix/idempotency/permissions verified`)
}
