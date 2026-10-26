import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

export async function verifyMeetingParticipation(db, { company, host, member, outsider, alien, actor }) {
  await db.exec('reset role')
  const protectedState = async () => (await db.query(`select md5(coalesce(string_agg(pg_get_functiondef(p.oid),'' order by p.oid),'') || (select coalesce(jsonb_agg(to_jsonb(x) order by tablename,policyname)::text,'') from pg_policies x where schemaname in ('public','storage'))) hash from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('app','public') and p.prokind='f' and p.proname not in ('meeting_member_participation','list_meeting_member_participation')`)).rows[0].hash
  const before = await protectedState()
  const file = (await fs.readdir('supabase/migrations')).find(name => name.endsWith('_meeting_member_participation_titles.sql'))
  await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'))
  assert.equal(await protectedState(), before, '기존 본문/자료/채팅/권한 함수·정책은 변경하지 않음')
  const ids = []
  for (let i = 1; i <= 7; i++) {
    const id = `91000000-0000-4000-8000-${String(i).padStart(12, '0')}`
    ids.push(id)
    const label = ['확정', '확정', '준비', '완료', '삭제', '미확정', '회차삭제'][i - 1]
    await db.query(`insert into public.meeting_series(id,company_id,host_id,title,status,duration_minutes,phase,created_by,deleted_at) values($1,$2,$3,$4,$5,60,$6,$3,$7)`, [id, company, host, `참여현황 · ${label}`, i === 4 ? 'done' : 'in_progress', i === 3 ? 'preparing' : 'published', i === 5 ? '2030-01-01' : null])
    await db.query(`insert into public.meeting_members(company_id,series_id,profile_id) values($1,$2,$3),($1,$2,$4)`, [company, id, host, member])
    await db.query(`insert into public.meeting_rounds(id,company_id,series_id,round_no,duration_minutes,starts_at,room_id,confirmed_at,deleted_at) values(gen_random_uuid(),$1,$2,1,60,'2030-01-07 09:00+09','room-1',$3,$4)`, [company, id, i === 6 ? null : '2030-01-01', i === 7 ? '2030-01-01' : null])
  }
  const titles = async () => (await db.query('select * from public.list_meeting_member_participation()')).rows
  await actor(outsider)
  const rows = await titles()
  for (const id of [host, member]) assert.deepEqual(rows.find(row => row.profile_id === id).titles.filter(title => title.startsWith('참여현황 · ')), ['참여현황 · 확정', '참여현황 · 확정'])
  assert.ok(rows.every(row => Object.keys(row).sort().join(',') === 'profile_id,titles'), '직원 UUID·제목 배열만 반환')
  assert.equal((await db.query('select * from public.meeting_series where id=$1', [ids[0]])).rows.length, 0, '비참석자는 원본 회의 행을 읽지 못함')
  assert.equal((await db.query('select * from public.meeting_rounds where series_id=$1', [ids[0]])).rows.length, 0, '비참석자는 회의 본문/결과를 읽지 못함')
  await assert.rejects(() => db.query('select public.open_meeting_group($1)', [ids[0]]), error => error.code === '42501')
  await actor(alien)
  assert.equal(JSON.stringify(await titles()).includes('참여현황 · '), false, '다른 회사 제목·참석자 미노출')
  await db.exec(`reset role; update public.profiles set status='pending' where id='${outsider}'`)
  await actor(outsider); assert.deepEqual(await titles(), [], '미승인 계정 차단')
  await db.exec(`reset role; update public.profiles set status='active' where id='${outsider}'; select set_config('request.jwt.claim.sub','',false); set role anon;`)
  await assert.rejects(titles, error => error.code === '42501')
  await db.exec('reset role')
  assert.equal(await protectedState(), before)
  console.log('meeting-participation-db: 비참석자 제목 조회·확정/진행만·준비/완료/삭제/미확정 제외·중복 호스트/멤버·동명 회의·회사/익명/미승인 격리·본문/채팅 접근 차단·기존 정책 불변 통과')
}
