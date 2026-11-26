import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

export async function verifyMeetingAutoCompletion(db, { company, foreign, host, member, alien, actor }) {
  const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0]
  await db.exec('reset role')
  const original = await scalar('select jsonb_agg(to_jsonb(s) order by id) from public.meeting_series s')
  // PGlite에서는 pg_cron 등록만 모사하고 실제 예약 명령과 함수 본문을 검사한다.
  await db.exec(`create schema cron;
    create table cron.job(jobname text primary key, schedule text, command text);
    create function cron.schedule(text,text,text) returns bigint language plpgsql as $$
    begin insert into cron.job values($1,$2,$3); return 1; end $$;`)
  await db.exec(await readFile('supabase/migrations/20261126113556_auto_complete_one_off_meetings.sql', 'utf8'))
  assert.deepEqual(await scalar('select jsonb_agg(to_jsonb(s) order by id) from public.meeting_series s'), original,
    '설치만으로 기존 회의를 수정하지 않음')
  assert.deepEqual((await db.query('select * from cron.job')).rows, [{
    jobname: 'atelier-one-off-meeting-completion', schedule: '* * * * *',
    command: 'select app.complete_expired_one_off_meetings();',
  }])
  for (const role of ['anon', 'authenticated']) {
    assert.equal(await scalar("select has_function_privilege($1,'app.complete_expired_one_off_meetings()','execute')", [role]), false)
  }
  assert.equal(await scalar("select prosecdef from pg_proc where oid='app.complete_expired_one_off_meetings()'::regprocedure"), false,
    '예약 작업 실행자의 기존 권한을 사용')
  for (const person of [host, member, alien]) {
    await actor(person)
    await assert.rejects(() => db.query('select app.complete_expired_one_off_meetings()'), error => error.code === '42501')
  }
  await db.exec('reset role; begin;')
  try {
    // 정확한 24시간/1마이크로초 경계 검증을 위해 이 격리 트랜잭션에서만 예약 시간 제약을 푼다.
    await db.exec("alter table public.meeting_rounds drop constraint meeting_rounds_booking_hours; set local timezone='Pacific/Honolulu';")
    const fixture = async (label, options = {}) => {
      const { kind = 'one_off', status = 'in_progress', phase = 'published', deleted = false,
        companyId = company, person = host, round = true, confirmed = true, unscheduled = false,
        roundDeleted = false, endOffset = '-25 hours', duration = 60 } = options
      const id = await scalar(`insert into public.meeting_series
        (id,company_id,host_id,created_by,title,kind,status,phase,duration_minutes,revision,deleted_at)
        values(gen_random_uuid(),$1,$2,$2,$3,$4,$5,$6,180,7,case when $7 then now() end) returning id`,
      [companyId, person, label, kind, status, phase, deleted])
      if (round) await db.query(`insert into public.meeting_rounds
        (id,company_id,series_id,round_no,room_id,starts_at,duration_minutes,confirmed_at,deleted_at,content,result)
        values(gen_random_uuid(),$1,$2,1,case when $3 then null else 'room-1' end,
          case when $3 then null else now()+$4::interval-make_interval(mins=>$5) end,
          $5,case when $6 then now() end,case when $7 then now() end,'회의 내용 보존','결과 초안 보존')`,
      [companyId, id, unscheduled, endOffset, duration, confirmed, roundDeleted])
      return id
    }
    const due = [await fixture('기존 미완료'), await fixture('정확히 24시간', { endOffset: '-24 hours', duration: 30 }),
      await fixture('다른 회사도 해당 회사 기준 처리', { companyId: foreign, person: alien })]
    const unchanged = []
    for (const [label, options] of [
      ['24시간 직전', { endOffset: '-24 hours 0.000001 seconds', duration: 30 }],
      ['시작 후 24시간이지만 종료 후 24시간 전', { endOffset: '-23 hours' }],
      ['회의 진행 중', { endOffset: '30 minutes' }], ['미래 회의', { endOffset: '1 day' }],
      ['준비 중', { phase: 'preparing' }], ['일정 미확정', { confirmed: false }],
      ['일정 미정', { unscheduled: true }], ['회차 없음', { round: false }],
      ['삭제된 회의', { deleted: true }], ['삭제된 회차만 있음', { roundDeleted: true }],
      ['이미 완료', { status: 'done' }], ['프로젝트', { kind: 'project' }],
      ['루틴', { kind: 'routine' }], ['미팅', { kind: 'meeting' }], ['면접', { kind: 'interview' }],
    ]) unchanged.push(await fixture(label, options))
    // 잘못 남은 추가 회차라도 미래 일정·미정 일정이 있으면 완료하지 않는다.
    for (const pending of [false, true]) {
      const id = await fixture('추가 유효 회차 보류')
      unchanged.push(id)
      await db.query(`insert into public.meeting_rounds
        (id,company_id,series_id,round_no,room_id,starts_at,duration_minutes,confirmed_at)
        values(gen_random_uuid(),$1,$2,2,case when $3 then null else 'room-1' end,
          case when $3 then null else now()+interval '1 day' end,60,case when not $3 then now() end)`,
      [company, id, pending])
    }
    const originalRows = await scalar('select jsonb_agg(to_jsonb(s) order by id) from public.meeting_series s where id=any($1::uuid[])', [unchanged])
    const related = async () => scalar(`select jsonb_build_object(
      'rounds',(select jsonb_agg(to_jsonb(r) order by id) from public.meeting_rounds r),
      'members',(select jsonb_agg(to_jsonb(m) order by series_id,profile_id) from public.meeting_members m),
      'invitations',(select jsonb_agg(to_jsonb(i) order by id) from public.meeting_invitations i),
      'files',(select jsonb_agg(to_jsonb(f) order by id) from public.meeting_files f),
      'notices',(select jsonb_agg(to_jsonb(n) order by id) from public.meeting_round_notices n))`)
    const beforeRelated = await related()
    assert.equal(await scalar('select app.complete_expired_one_off_meetings()'), due.length)
    const completed = (await db.query('select status,revision from public.meeting_series where id=any($1::uuid[])', [due])).rows
    assert.deepEqual(completed, due.map(() => ({ status: 'done', revision: 8 })), '경계 포함, 회차별 소요 시간 기준 완료 및 버전 증가')
    assert.deepEqual(await scalar('select jsonb_agg(to_jsonb(s) order by id) from public.meeting_series s where id=any($1::uuid[])', [unchanged]), originalRows)
    assert.deepEqual(await related(), beforeRelated, '회의록·결과·응답·읽음·자료 보존')
    assert.equal(await scalar('select app.complete_expired_one_off_meetings()'), 0, '재실행해도 버전을 다시 올리지 않음')
    await actor(host)
    const visible = await scalar('select public.list_company_meetings()')
    assert.equal(visible.find(s => s.id === due[0]).status, 'done', '기존 My home 목록에서 완료 상태 조회')
    assert.equal(visible.some(s => s.id === due[2]), false, '다른 회사의 목록 노출 차단 유지')
    await db.exec('reset role')
  } finally {
    await db.exec('rollback')
  }
  console.log('meeting-auto-completion: 종료 후 24시간 경계·유형·확정/삭제·회사 격리·권한·기록 보존·중복 실행 통과')
}
