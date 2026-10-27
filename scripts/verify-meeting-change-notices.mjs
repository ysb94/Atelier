import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

// 실제 마이그레이션과 인증 역할을 메모리 PostgreSQL에서 실행한다. 운영 연결 없음.
const db = await PGlite.create()
const company = '10000000-0000-4000-8000-000000000001'
const foreign = '10000000-0000-4000-8000-000000000002'
const host = '20000000-0000-4000-8000-000000000001'
const member = '20000000-0000-4000-8000-000000000002'
const newcomer = '20000000-0000-4000-8000-000000000003'
const outsider = '20000000-0000-4000-8000-000000000004'
const alien = '20000000-0000-4000-8000-000000000005'
const id = '30000000-0000-4000-8000-000000000001'
const roundId = '40000000-0000-4000-8000-000000000001'
const actor = who => db.exec(`reset role; select set_config('request.jwt.claim.sub','${who}',false); set role authenticated;`)
const scalar = async (sql, params) => Object.values((await db.query(sql, params)).rows[0])[0]
const notices = () => scalar('select public.list_my_meeting_invitations()')
const load = async () => (await scalar('select public.list_company_meetings()')).find(item => item.id === id)
const denied = (sql, params, code = '42501') => assert.rejects(() => db.query(sql, params), error => error.code === code)
const apply = async name => {
  const sql = await fs.readFile(`supabase/migrations/${name}`, 'utf8')
  // Windows checkout의 CRLF에서도 원본 함수의 부분 치환이 정확히 동작해야 한다.
  return db.exec(name.endsWith('_meeting_change_notices.sql') ? sql.replace(/\r?\n/g, '\r\n') : sql)
}
const snapshot = () => scalar(`select jsonb_build_object(
 'profiles',(select jsonb_agg(to_jsonb(p) order by id) from public.profiles p),
 'policies',(select jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname) from pg_policies p),
 'grants',(select jsonb_agg(to_jsonb(p) order by table_schema,table_name,grantee,privilege_type) from information_schema.role_table_grants p where table_schema in ('public','storage')),
 'functions',(select jsonb_agg(jsonb_build_object('name',p.proname,'acl',p.proacl::text,'definition',case when p.proname not in ('meeting_write','meeting_notifications_before_realtime') then pg_get_functiondef(p.oid) end) order by p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app') and p.prokind='f'),
 'invitations',(select jsonb_agg(to_jsonb(i)-'schedule_change' order by id) from public.meeting_invitations i))`)

try {
  await db.exec(`create role anon; create role authenticated; create schema auth; create schema app; create schema storage;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,app,auth,storage to authenticated,anon;
    create table public.companies(id uuid primary key);
    create table public.departments(id uuid primary key,name text);
    create table public.profiles(id uuid primary key,company_id uuid,display_name text,status text,is_admin boolean,department_id uuid,position text);
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
    alter table storage.objects enable row level security; grant select,insert,delete on storage.objects to authenticated;
    create function app.is_admin() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.profiles where id=auth.uid() and status='active' and is_admin)$$;
    insert into public.companies values('${company}'),('${foreign}');
    insert into public.profiles(id,company_id,display_name,status,is_admin) values
      ('${host}','${company}','호스트','active',false),('${member}','${company}','멤버','active',false),
      ('${newcomer}','${company}','신규 멤버','active',false),('${outsider}','${company}','비참석자','active',true),
      ('${alien}','${foreign}','다른 회사','active',true);`)
  for (const file of ['20261021064611_company_meetings.sql', '20261021065519_meeting_file_cleanup.sql', '20261021070128_meeting_booking_limits.sql']) await apply(file)
  await db.exec(`create table public.chat_rooms(id uuid primary key default gen_random_uuid(),company_id uuid,name text,kind text,created_by uuid);
    create table public.chat_room_members(room_id uuid,profile_id uuid,primary key(room_id,profile_id));
    create function app.assert_chat_member_profiles(ids uuid[]) returns void language plpgsql as $$begin return; end$$;
    create function public.create_group_chat(room_name text,member_ids uuid[]) returns uuid language sql as $$select gen_random_uuid()$$;
    create table public.company_leave_requests(id uuid,company_id uuid,employee_id uuid,kind text,status text,from_date date,to_date date,start_time time,end_time time,note text,place text);`)
  for (const file of ['20261021073414_meeting_invitations.sql', '20261021100736_meeting_live_availability.sql', '20261026084832_company_work_hours.sql', '20261026114655_meeting_host_lunch_rules.sql']) await apply(file)
  let series = { id, title: '변경 알림 검증', host: { id: host }, members: [{ id: member }], status: 'in_progress', durationMinutes: 60,
    rounds: [{ id: roundId, round: 1, roomId: '', startsAt: '', content: '', result: '' }] }
  await actor(host)
  let revision = await scalar('select public.save_company_meeting($1,0)', [series])
  await actor(member)
  assert.deepEqual(await notices(), [], '준비 중에는 멤버 알림 없음')
  await actor(host)
  series.rounds[0] = { ...series.rounds[0], startsAt: '2030-01-08T10:00', roomId: 'room-1' }
  revision = await scalar('select public.confirm_company_meeting($1,$2,$3)', [series, revision, roundId])
  await actor(member)
  const legacy = (await notices())[0]
  await db.query('select public.respond_to_meeting($1,1,$2)', [roundId, 'available'])
  await db.exec('reset role')
  const before = await snapshot()
  await apply('20261027074713_meeting_change_notices.sql')
  assert.deepEqual(await snapshot(), before, '기존 사용자·초대·응답·읽음·RLS·권한·다른 함수 보존')
  await actor(member)
  assert.equal((await notices())[0].body, legacy.body, '기존 초대에 변경 전 값을 지어내지 않음')

  const confirm = async patch => {
    await actor(host)
    const current = await load()
    const next = { ...current, ...patch, rounds: current.rounds.map(round => round.id === roundId ? { ...round, ...patch.round } : round) }
    delete next.round
    await scalar('select public.confirm_company_meeting($1,$2,$3)', [next, current.revision, roundId])
    await actor(member)
    return (await notices())[0]
  }
  let changed = await confirm({ round: { startsAt: '2030-01-09T14:00', roomId: 'room-2', durationMinutes: 90 } })
  assert.equal(changed.title, '변경 알림 검증 · 회의 정보 변경')
  assert.equal(changed.body, ['회의 정보가 변경되었습니다.', '일정: 2030-01-08 10:00 → 2030-01-09 14:00',
    '회의실: 대회의실 → 소회의실', '소요 시간: 60분 → 90분', '참석 가능·불가로 다시 답해 주세요.'].join('\n'))
  const comparisonFixture = structuredClone(changed)
  assert.equal(changed.readAt, null, '변경 알림 미읽음 초기화')
  assert.equal((await load()).rounds[0].responses[0].status, 'pending', '기존 참석 응답 초기화')
  await denied('select public.respond_to_meeting($1,1,$2)', [roundId, 'available'], '40001')
  await db.query('select public.respond_to_meeting($1,2,$2)', [roundId, 'unavailable'])
  await actor(host)
  assert.ok((await notices()).some(item => item.title.endsWith('참석 불가 발생')), '호스트 응답 알림 유지')
  changed = await confirm({ round: { roomId: 'room-1' } })
  assert.match(changed.body, /일정: 2030-01-09 14:00 \(변경 없음\)/)
  assert.match(changed.body, /회의실: 소회의실 → 대회의실/)
  assert.match(changed.body, /소요 시간: 90분 \(변경 없음\)/)
  const same = await confirm({})
  assert.equal(same.createdAt, changed.createdAt, '변경 없는 재확정은 알림 재발송 없음')
  assert.equal(same.body, changed.body, '변경 없는 재확정은 직전 비교를 덮어쓰지 않음')
  changed = await confirm({ round: { durationMinutes: 30 } })
  assert.match(changed.body, /소요 시간: 90분 → 30분/, '연속 변경은 바로 전 일정과 비교')
  assert.match(changed.body, /회의실: 대회의실 \(변경 없음\)/)

  await confirm({ members: [{ id: member }, { id: newcomer }] })
  assert.match((await notices())[0].body, /멤버 구성이 변경되었습니다/)
  await actor(newcomer)
  assert.equal((await notices())[0].title, '변경 알림 검증 · 참석 요청', '새 멤버에게는 최초 초대')
  await actor(host)
  const current = await load()
  current.rounds[0].content = '회의 안내만 수정'
  await scalar('select public.save_company_meeting($1,$2)', [current, current.revision])
  await actor(member)
  assert.match((await notices())[0].body, /멤버 구성이 변경되었습니다/, '본문 저장은 재확정 비교를 보존')
  await denied('select public.confirm_company_meeting($1,$2,$3)', [current, current.revision, roundId])
  for (const who of [outsider, alien]) {
    await actor(who)
    assert.deepEqual(await notices(), [], '비참석자·다른 회사에 변경 알림 비노출')
    assert.equal((await scalar('select count(*) from public.meeting_invitations')), who === outsider ? 2 : 0,
      '기존 같은 회사 운영자의 조회 권한은 유지하고 다른 회사는 격리')
  }
  await db.exec('reset role; set role anon')
  await denied('select public.list_my_meeting_invitations()')
  await db.exec('reset role')
  // 브라우저 검증은 이 실제 SQL 출력값을 그대로 표시한다.
  await actor(member)
  const fixture = [comparisonFixture]
  if (process.argv.includes('--fixture')) {
    await fs.mkdir('node_modules/.cache/meeting-change-notices', { recursive: true })
    await fs.writeFile('node_modules/.cache/meeting-change-notices/notices.json', JSON.stringify(fixture))
  }
  console.log('meeting-change-notices: 기존 데이터·권한 보존, 최초/변경 초대, 전후 일정·회의실·시간, 연속 변경, 멤버 추가, 응답 초기화, 중복 방지, 수신자 격리 통과')
} finally {
  await db.close()
}
