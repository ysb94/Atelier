import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { verifyMeetingNoticeContext } from './meeting-notice-context-db.mjs'

// Run after the existing DB scenarios. Their meetings include manual decisions,
// different kinds, historical invites, unpublished rounds, files and shared results.
export async function verifyMeetingListReadOptimization(db, { company, host, member, outsider, admin, alien, actor }) {
  const scalar = async (query, args = []) => Object.values((await db.query(query, args)).rows[0])[0]
  const migration = await readFile('supabase/migrations/20261126010001_optimize_meeting_list_reads.sql', 'utf8')
  const uninvolved = '20000000-0000-4000-8a00-000000000001'
  const inactive = '20000000-0000-4000-8a00-000000000002'
  const users = { host, member, outsider, admin, alien, uninvolved, inactive }
  const list = 'select public.list_company_meetings()'
  await db.exec('reset role')
  const original = await scalar("select pg_get_functiondef('app.meeting_list()'::regprocedure)")
  await db.query(`insert into public.profiles(id, company_id, display_name, status, is_admin)
    values ($1,$3,'무관한 직원','active',false),($2,$3,'미승인 직원','pending',false)`, [uninvolved, inactive, company])
  const extraPeople = (await db.query(`
    insert into public.profiles(id,company_id,display_name,status,is_admin)
    select gen_random_uuid(), $1, '회의 참석자 ' || n, 'active', false
    from generate_series(1, 19) n returning id`, [company])).rows.map(p => p.id).sort()
  const privateSeries = await scalar(`insert into public.meeting_series
    (id,company_id,host_id,created_by,title,status,duration_minutes,phase)
    values(gen_random_uuid(),$1,$2,$3,'비호스트가 준비한 회의','in_progress',30,'preparing')
    returning id`, [company, host, member])
  await db.query(`insert into public.meeting_rounds(id,company_id,series_id,round_no,duration_minutes,content)
    values(gen_random_uuid(),$1,$2,1,30,'준비 중인 본문')`, [company,privateSeries])

  // A small mixed old/new fixture increases the number of rounds in a repeatable
  // way; real bookings, read marks and material paths are never used here.
  const series = await db.query(`
    insert into public.meeting_series(id, company_id, created_by, host_id, title, status, duration_minutes)
    select gen_random_uuid(), $1, $2, $2, '월간 회의 ' || n, 'in_progress', 30
    from generate_series(1, 6) n returning id`, [company, host])
  let mixedRoundId
  for (const row of series.rows) {
    await db.query(`insert into public.meeting_members(company_id, series_id, profile_id)
      select $1, $2, unnest($3::uuid[])`, [company, row.id, [outsider, member]])
    const rounds = await db.query(`
      insert into public.meeting_rounds(id, company_id, series_id, round_no, room_id, starts_at,
        duration_minutes, confirmed_at, content, result)
      select gen_random_uuid(), $1, $2, n, 'room-1',
        '2035-01-03 10:00+09'::timestamptz + n * interval '7 days', 30, now(), '회의 내용', '기존 결과'
      from generate_series(1,4) n returning id, round_no`, [company, row.id])
    for (const round of rounds.rows.filter(r => r.round_no % 2 === 0)) {
      await db.query('insert into app.meeting_round_rosters(round_id,company_id) values($1,$2)', [round.id, company])
      await db.query(`insert into app.meeting_round_people(round_id,profile_id,role)
        values($1,$2,'attendee'),($1,$3,'result')`, [round.id, member, outsider])
      if (!mixedRoundId) {
        mixedRoundId = round.id
        // Distinct physical order, UUID order and invitation order exercise the
        // arrays produced by the legacy aggregation, including mixed roles.
        await db.query(`insert into app.meeting_round_people(round_id,profile_id,role)
          select $1,p.id,case when p.ordinal % 11=0 then 'excluded'
            when p.ordinal % 7=0 then 'result' else 'attendee' end
          from unnest($2::uuid[]) with ordinality p(id,ordinal) order by (p.ordinal * 7) % 19`, [round.id, extraPeople])
        await db.query(`insert into public.meeting_invitations(company_id,round_id,profile_id,schedule_version,status)
          select $1,$2,p.id,1,'available' from unnest($3::uuid[]) with ordinality p(id,ordinal)
          join app.meeting_round_people m on m.round_id=$2 and m.profile_id=p.id and m.role='attendee'
          order by (p.ordinal * 5) % 19`, [company, round.id, extraPeople])
        await db.query(`insert into public.meeting_invitations(company_id,round_id,profile_id,schedule_version,status)
          values ($1,$2,$3,1,'unavailable')`, [company, round.id, member])
        await db.query(`insert into app.meeting_round_decisions(round_id,company_id,schedule_version,actor_id,member_ids,excluded_ids)
          select $1,$2,1,$3,array_agg(profile_id order by profile_id),array[$4::uuid]
          from app.meeting_round_people where round_id=$1 and role='attendee'`, [round.id,company,host,member])
      }
    }
  }
  await db.exec('analyze')
  const roles = Object.entries(users)
  const readState = async () => {
    const output = {}
    for (const [role, user] of roles) {
      await actor(user)
      output[role] = {
        meetings: await scalar(list),
        invitations: await scalar('select public.list_my_meeting_invitations()')
      }
    }
    await db.exec("reset role; select set_config('request.jwt.claim.sub','',false); set role anon")
    await assert.rejects(() => db.query(list), error => error.code === '42501', 'anonymous execution stays denied')
    await db.exec('reset role')
    return output
  }
  const integrity = async () => {
    const tables = (await db.query(`select format('%I.%I',schemaname,tablename) as name from pg_tables
      where (schemaname in ('app','public') and tablename like 'meeting_%')
        or (schemaname='public' and tablename='profiles') or (schemaname='storage' and tablename='objects')
      order by name`)).rows
    const data = {}
    for (const { name } of tables) {
      data[name] = await scalar(`select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by to_jsonb(t)::text),'')) from ${name} t`)
    }
    return {
      data,
      acl: (await db.query(`select oid,proacl,proowner,prosecdef,proconfig,provolatile
        from pg_proc where oid in ('app.meeting_list()'::regprocedure,'public.list_company_meetings()'::regprocedure)
        order by oid`)).rows,
      policies: (await db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows
    }
  }
  const before = await readState()
  assert.equal(before.alien.meetings.length, 0, 'other company is isolated')
  assert.equal(before.inactive.meetings.length, 0, 'inactive staff are isolated')
  assert.ok(before.uninvolved.meetings.some(s => s.rounds.some(r => r.detailAccess === 'none')), 'public metadata without detail access')
  const rowAccess = new Set(before.outsider.meetings.flatMap(s => s.rounds.map(r => r.detailAccess)))
  assert.ok(rowAccess.has('full') && rowAccess.has('result'), 'mixed attendance and result access for one viewer')
  assert.ok(before.host.meetings.some(s => s.rounds.some(r => r.sharedResults.length > 1)), 'previous publications covered')
  const mixedSeries = before.member.meetings.find(s => s.rounds.some(r => r.id === mixedRoundId))
  const mixedRound = mixedSeries.rounds.find(r => r.id === mixedRoundId)
  assert.ok(mixedRound.responses.length > 10 && mixedRound.membership.some(p => p.role === 'excluded'))
  assert.deepEqual(mixedRound.manualConfirmation.excludedIds, [member])
  assert.equal(mixedSeries.rounds.at(-1).responses.find(p => p.profileId === member).status, 'pending', 'next round reinvites member')
  assert.equal(before.member.meetings.find(s => s.id === privateSeries).rounds[0].content, '준비 중인 본문')
  assert.ok(!before.uninvolved.meetings.some(s => s.id === privateSeries))
  const existing = await integrity()
  const benchRoles = ['host', 'member', 'outsider']
  const times = { before: [], after: [] }
  async function measure(label) {
    for (const role of benchRoles) {
      await actor(users[role])
      // Warm the redefined function for each caller before collecting DB execution times.
      await scalar(list)
      for (let i = 0; i < 5; i++) {
        const plan = await scalar('explain (analyze,format json,timing off) ' + list)
        times[label].push(plan[0]['Execution Time'])
      }
    }
    await db.exec('reset role')
  }
  // A-B-B-A with identical fixture, role mix and two warm samples per role.
  await measure('before')
  await db.exec(migration)
  assert.deepEqual(await readState(), before, 'complete ordered response and exact invitation states for each role')
  assert.deepEqual(await integrity(), existing, 'all meeting rows, grants, policies and original function OIDs preserved')
  await measure('after')
  await measure('after')
  await db.exec(original)
  await measure('before')
  await db.exec(migration)
  function summary(samples) {
    const sorted = [...samples].sort((a,b) => a-b)
    const at = fraction => sorted[Math.ceil(fraction * sorted.length) - 1]
    return { samples: sorted.length, medianMs: at(0.5), p95Ms: at(0.95) }
  }
  console.log('meeting-list-read-optimization:', JSON.stringify({
    viewerRolesCompared: roles.map(([role]) => role),
    meetings: before.host.meetings.length,
    rounds: before.host.meetings.reduce((total, s) => total + s.rounds.length, 0),
    before: summary(times.before), after: summary(times.after)
  }))
  await verifyMeetingNoticeContext(db, actor, users)
}
