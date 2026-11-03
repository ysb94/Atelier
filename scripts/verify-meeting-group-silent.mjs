import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

// 실제 서버에 연결하지 않고 기존 채팅 함수·집계와 새 회의 함수를 함께 실행한다.
const db = await PGlite.create()
const company = '10000000-0000-4000-8000-000000000001', foreign = '10000000-0000-4000-8000-000000000002'
const host = '20000000-0000-4000-8000-000000000001', member = '20000000-0000-4000-8000-000000000002'
const outsider = '20000000-0000-4000-8000-000000000003', alien = '20000000-0000-4000-8000-000000000004'
const oldSeries = '30000000-0000-4000-8000-000000000001', newSeries = '30000000-0000-4000-8000-000000000002'
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0] || {})[0]
const actor = async id => db.query("select set_config('request.jwt.claim.sub',$1,false)", [id])
const open = id => scalar('select app.meeting_open_group($1)', [id])
const rooms = () => db.query('select * from public.list_my_chat_rooms()').then(r => r.rows)
const migration = 'supabase/migrations/20261103105254_meeting_group_silent_creation.sql'
const original = await readFile('supabase/migrations/20260930160000_company_chat.sql', 'utf8')
const list = await readFile('supabase/migrations/20260930190000_company_chat_room_list.sql', 'utf8')
function definition(source, name) {
  const start = source.search(new RegExp(`create(?: or replace)? function ${name.replaceAll('.', '\\.')}\\(`, 'i'))
  assert.ok(start >= 0, name)
  const text = source.slice(start), marker = text.match(/as (\$\w*\$)/i)
  assert.ok(marker, name)
  return text.slice(0, text.indexOf(marker[1], marker.index + marker[0].length) + marker[1].length) + ';'
}
try {
  await db.exec(`create schema app; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table profiles(id uuid primary key,company_id uuid,status text,display_name text,position text);
    insert into profiles values('${host}','${company}','active','주최자','사원'),('${member}','${company}','active','참석자','사원'),('${outsider}','${company}','active','비참석자','팀장'),('${alien}','${foreign}','active','타사','사원');
    create function app.is_approved() returns boolean language sql stable as $$select exists(select 1 from public.profiles where id=auth.uid() and status='active')$$;
    create table chat_rooms(id uuid primary key default gen_random_uuid(),company_id uuid not null,kind text,name text,created_by uuid,last_message_at timestamptz,last_message_preview text default '',created_at timestamptz default now());
    create table chat_room_members(room_id uuid references chat_rooms,profile_id uuid references profiles,joined_at timestamptz default now(),last_read_at timestamptz,primary key(room_id,profile_id));
    create table chat_messages(id uuid primary key default gen_random_uuid(),room_id uuid references chat_rooms,company_id uuid,author_id uuid,author_name text,kind text,body text,created_at timestamptz default clock_timestamp(),deleted_at timestamptz);
    create table chat_attachments(message_id uuid,mime_type text,status text);
    create table meeting_series(id uuid primary key,company_id uuid,host_id uuid,title text,phase text);
    create table meeting_members(series_id uuid references meeting_series,profile_id uuid references profiles);
    create table meeting_chat_rooms(series_id uuid primary key references meeting_series,room_id uuid references chat_rooms);
    create function app.meeting_can_read(p_series uuid) returns boolean language sql stable as $$select exists(select 1 from public.meeting_series s join public.profiles p on p.company_id=s.company_id where s.id=p_series and p.id=auth.uid() and p.status='active')$$;
    create function app.is_chat_room_member(p_room uuid) returns boolean language sql stable as $$select app.is_approved() and exists(select 1 from public.chat_room_members where room_id=p_room and profile_id=auth.uid())$$;
    insert into meeting_series values('${oldSeries}','${company}','${host}','기존 회의','published'),('${newSeries}','${company}','${host}','새 회의','published');
    insert into meeting_members values('${oldSeries}','${member}'),('${newSeries}','${member}');`)
  for (const name of ['app.chat_company_id','app.chat_actor_name','app.assert_chat_member_profiles','app.prepare_chat_message','app.insert_chat_system_message','public.create_group_chat']) await db.exec(definition(original, name))
  await db.exec(definition(list, 'app.touch_chat_room_on_message'))
  await db.exec(definition(list, 'public.list_my_chat_rooms'))
  await db.exec(`create trigger prepare before insert on chat_messages for each row execute function app.prepare_chat_message(); create trigger touch after insert on chat_messages for each row execute function app.touch_chat_room_on_message();`)
  await db.exec(definition(await readFile('supabase/migrations/20261021073414_meeting_invitations.sql','utf8'), 'app.meeting_open_group'))
  await actor(host); const oldRoom = await open(oldSeries)
  await actor(member); assert.equal((await rooms()).find(r => r.room_id === oldRoom).unread_count, 1, '현재 생성 알림 원인 재현')
  const preserved = await scalar('select jsonb_agg(to_jsonb(m) order by id)::text from chat_messages m')
  const profiles = await scalar('select jsonb_agg(to_jsonb(p) order by id)::text from profiles p')
  const commonBefore = await scalar("select pg_get_functiondef('public.create_group_chat(text,uuid[])'::regprocedure)")
  await db.exec(await readFile(migration, 'utf8'))
  assert.equal(await scalar('select jsonb_agg(to_jsonb(m) order by id)::text from chat_messages m'), preserved, '기존 대화 보존')
  assert.equal(await scalar("select pg_get_functiondef('public.create_group_chat(text,uuid[])'::regprocedure)"), commonBefore, '일반 단체방 함수 유지')
  await actor(host); const room = await open(newSeries)
  assert.equal(await scalar('select count(*) from chat_messages where room_id=$1', [room]), 0)
  assert.equal((await rooms()).find(r => r.room_id === room).unread_count, 0)
  await actor(member); assert.equal(await open(newSeries), room, '멤버가 열어도 같은 방')
  assert.equal((await rooms()).find(r => r.room_id === room).unread_count, 0, '방 생성만 하면 수신자 알림 없음')
  assert.equal((await rooms()).find(r => r.room_id === room).last_message_at, null)
  await actor(host)
  await db.query("insert into chat_messages(room_id,kind,body) values($1,'text','실제 대화')", [room])
  assert.equal((await rooms()).find(r => r.room_id === room).unread_count, 0, '보낸 본인 알림 없음')
  await actor(member)
  assert.equal((await rooms()).find(r => r.room_id === room).unread_count, 1, '실제 대화부터 알림')
  assert.equal((await rooms()).find(r => r.room_id === room).last_message_preview, '실제 대화')
  assert.equal(await open(newSeries), room)
  assert.equal((await rooms()).find(r => r.room_id === room).unread_count, 1, '다시 열기로 읽음 위조 금지')
  assert.equal(await scalar('select last_read_at from chat_room_members where room_id=$1 and profile_id=$2',[room,member]), null)
  await db.query('update chat_room_members set last_read_at=clock_timestamp() where room_id=$1 and profile_id=$2',[room,member])
  assert.equal((await rooms()).find(r => r.room_id === room).unread_count, 0)
  await actor(host); await db.query("insert into chat_messages(room_id,kind,body) values($1,'file','자료.pdf')",[room])
  await actor(member); assert.equal((await rooms()).find(r => r.room_id === room).unread_count, 1, '파일 전송 알림 유지')
  await actor(outsider); await assert.rejects(() => open(newSeries), e => e.code === '42501')
  await actor(alien); await assert.rejects(() => open(newSeries), e => e.code === '42501')
  await actor(host)
  await db.exec(`update meeting_series set phase='draft' where id='${newSeries}'`)
  await assert.rejects(() => open(newSeries), e => e.code === '42501')
  await db.exec(`update meeting_series set phase='published' where id='${newSeries}';update profiles set status='pending' where id='${member}'`)
  await assert.rejects(() => open(newSeries), /활성 직원/)
  await db.exec(`update profiles set status='active' where id='${member}';update profiles set company_id='${foreign}' where id='${member}'`)
  await assert.rejects(() => open(newSeries), /같은 회사/)
  await db.exec(`update profiles set company_id='${company}' where id='${member}'`)
  assert.equal(await scalar('select jsonb_agg(to_jsonb(p) order by id)::text from profiles p'), profiles)
  const regular = await scalar("select public.create_group_chat('일반 방',$1)", [[member]])
  await actor(member); assert.equal((await rooms()).find(r => r.room_id === regular).unread_count, 1, '일반 단체방 생성은 기존 동작')
  await actor(host)
  await db.exec(`insert into profiles(id,company_id,status,display_name) select gen_random_uuid(),'${company}','active','검증 직원' from generate_series(1,101);
    insert into meeting_members select '${newSeries}',id from profiles where display_name='검증 직원';
    delete from meeting_chat_rooms where series_id='${newSeries}';`)
  const count = await scalar('select count(*) from chat_rooms')
  await assert.rejects(() => open(newSeries), /100명/)
  assert.equal(await scalar('select count(*) from chat_rooms'), count, '인원 초과 시 방 생성 없음')
  console.log('PASS existing notification reproduced; silent meeting group; shared room reuse; text/file unread and read state; original messages/general groups preserved; outsider/company/pending/draft/size checks')
} finally { await db.close() }
