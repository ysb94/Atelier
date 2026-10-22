import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { createAccessIpHandler, gatewayIp, recordingOrigin } from '../supabase/functions/access-ip-record/handler.ts'

const owner = '10000000-0000-4000-8000-000000000001', staff = '10000000-0000-4000-8000-000000000002'
const company = 'e0000000-0000-4000-8000-000000000001', session = '20000000-0000-4000-8000-000000000001'
const db = await PGlite.create()
const migration = await readFile('supabase/migrations/20261022094409_access_ip_records.sql', 'utf8')
async function actor(id, role = 'authenticated') { await db.exec(`reset role; select set_config('request.jwt.claim.sub','${id}',false); set role ${role}`) }
async function count(table) { return Number((await db.query(`select count(*) n from public.${table}`)).rows[0].n) }
async function denied(sql) { await assert.rejects(db.exec(sql), /permission denied|row-level security/) }
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema app;
    grant usage on schema public,auth,app to anon,authenticated,service_role;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table auth.users(id uuid primary key);
    create table public.companies(id uuid primary key);
    create table public.profiles(id uuid primary key,email text,status text);
    insert into auth.users values('${owner}'),('${staff}');
    insert into public.companies values('${company}');
    insert into public.profiles values('${owner}','dev@atelier.local','active'),('${staff}','staff@example.invalid','active');`)
  await db.exec(migration)
  await actor(owner)
  assert.equal(await count('access_ip_reviewers'), 1)
  await denied(`insert into public.access_ip_reviewers(profile_id) values('${staff}')`)
  await denied(`insert into public.access_ip_events(user_id,person_name,event_kind,event_key,ip_source) values('${owner}','가짜','login','${session}','unavailable')`)
  await db.exec(`insert into public.office_ip_reviews(ip_address,status,note,reviewed_by,reviewed_at) values('203.0.113.9','company','사무실 직접 확인','${staff}','2000-01-01')`)
  const review = (await db.query('select * from public.office_ip_reviews')).rows[0]
  assert.equal(review.reviewed_by, owner, '확인자는 서버의 로그인 UUID')
  assert.ok(new Date(review.reviewed_at).getFullYear() > 2000, '확인 시각은 서버 시각')
  await db.exec(`update public.office_ip_reviews set status='unconfirmed',note='재확인 필요'`)
  await actor(staff)
  assert.equal(await count('access_ip_reviewers'), 0)
  assert.equal(await count('office_ip_reviews'), 0)
  await denied(`insert into public.office_ip_reviews(ip_address,status,reviewed_by) values('203.0.113.8','company','${staff}')`)
  assert.equal((await db.query(`update public.office_ip_reviews set status='company' returning *`)).rows.length, 0)
  await actor('', 'anon')
  await denied('select * from public.access_ip_events')

  let saveFails = false
  const handler = createAccessIpHandler({
    authenticate: async token => token === 'valid' ? { id: staff, sessionId: session, companyId: company, name: '검증 직원' } : null,
    save: async event => {
      if (saveFails) throw new Error('검증용 기록 오류')
      await actor('', 'service_role')
      await db.query(`insert into public.access_ip_events(user_id,company_id,person_name,event_kind,event_key,ip_address,ip_source)
        values($1,$2,$3,$4,$5,$6,$7) on conflict(user_id,event_kind,event_key) do nothing`,
        [event.user_id,event.company_id,event.person_name,event.event_kind,event.event_key,event.ip_address,event.ip_source])
    },
  })
  function request(body, extras = {}, token = 'valid', origin = 'https://test.atelier-6yy.pages.dev') {
    return handler(new Request('https://example.invalid/access-ip-record', { method: 'POST',
      headers: { origin, authorization: `Bearer ${token}`, 'cf-connecting-ip': '203.0.113.9', ...extras }, body: JSON.stringify(body) }))
  }
  assert.equal((await request({ kind: 'login', user_id: owner, ip_address: '1.1.1.1' })).status, 200)
  assert.equal((await request({ kind: 'login' })).status, 200)
  assert.equal(await count('access_ip_events'), 1, '같은 세션 재전송 중복 제거')
  let row = (await db.query('select * from public.access_ip_events')).rows[0]
  assert.equal(row.user_id, staff, '본문의 다른 사용자 UUID를 무시')
  assert.equal(row.ip_address, '203.0.113.9', '본문의 IP를 무시')
  const requestId = '30000000-0000-4000-8000-000000000001'
  await Promise.all([request({ kind: 'clock_in_request', requestId }), request({ kind: 'clock_in_request', requestId })])
  assert.equal(await count('access_ip_events'), 2, '동일 요청의 동시 재전송 중복 제거')
  await request({ kind: 'clock_in_request', requestId: '30000000-0000-4000-8000-000000000002' }, { 'cf-connecting-ip': '', 'x-forwarded-for': '1.1.1.1' })
  row = (await db.query("select * from public.access_ip_events where ip_source='unavailable'")).rows[0]
  assert.equal(row.ip_address, null, '신뢰 헤더가 없으면 XFF로 채우지 않음')
  assert.equal((await request({ kind: 'login' }, {}, 'invalid')).status, 401)
  assert.equal((await request({ kind: 'login' }, {}, 'valid', 'https://atelier-6yy.pages.dev')).status, 403, 'main 수집 비활성')
  assert.equal((await request({ kind: 'clock_in_request' })).status, 400)
  assert.equal((await request({ kind: 'unknown' })).status, 400)
  saveFails = true
  assert.equal((await request({ kind: 'login' })).status, 500, '저장 실패를 성공으로 보고하지 않음')
  await actor(staff)
  assert.equal(await count('access_ip_events'), 0, '기록을 남긴 직원도 전체 기록 조회 불가')
  await actor(owner)
  assert.equal(await count('access_ip_events'), 3)
  await db.exec('reset role')
  assert.deepEqual((await db.query('select status from public.profiles order by id')).rows.map(row => row.status), ['active', 'active'], '기존 승인 상태 유지')
  for (const ip of ['203.0.113.9', '2001:db8::1', '::ffff:192.0.2.4']) assert.ok(gatewayIp(new Headers({ 'cf-connecting-ip': ip })))
  for (const ip of ['999.1.1.1', '1.2.3.4, 5.6.7.8', 'garbage', '::1%eth0']) assert.equal(gatewayIp(new Headers({ 'cf-connecting-ip': ip })), null)
  assert.equal(recordingOrigin('https://test.atelier-6yy.pages.dev.attacker.invalid'), false)
  console.log('access-ip: 실제 PostgreSQL RLS·1인 조회/편집·직원/익명 차단·서버 확인자/시각·세션/요청 중복 제거·헤더/본문 검증·실패 응답·승인 상태 보존 통과 (운영 DB 연결 없음)')
} finally { await db.close() }
