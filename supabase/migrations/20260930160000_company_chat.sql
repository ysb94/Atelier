-- 사내 채팅은 회사 소유다. brand_id를 두지 않는다.
-- 기획안에 이은 두 번째 회사 소유 예외이고, 방 멤버만 대화와 파일을 본다.
-- 글 메시지는 클라이언트가 직접 넣고, 방 생성·초대·삭제·읽음은 RPC로만 한다.

create or replace function app.chat_company_id()
returns uuid
language sql
stable
security definer
set search_path to ''
as $function$
  select p.company_id
  from public.profiles p
  where p.id = auth.uid()
    and p.status = 'active';
$function$;

create or replace function app.chat_actor_name()
returns text
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(nullif(btrim(p.display_name), ''), '이름 없음')
  from public.profiles p
  where p.id = auth.uid();
$function$;

revoke all on function app.chat_company_id() from public, anon, authenticated;
revoke all on function app.chat_actor_name() from public, anon, authenticated;

create table public.chat_rooms (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null,
  name text not null default '',
  direct_key text,
  created_by uuid references public.profiles(id) on delete set null,
  last_message_at timestamptz,
  last_message_preview text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chat_rooms_kind_check check (kind in ('direct', 'group')),
  constraint chat_rooms_company_direct_key unique (company_id, direct_key),
  constraint chat_rooms_shape_check check (
    (
      kind = 'direct'
      and direct_key is not null
      and name = ''
    )
    or (
      kind = 'group'
      and direct_key is null
      and char_length(btrim(name)) between 1 and 80
    )
  )
);

comment on table public.chat_rooms is
  '회사 소유 채팅방. 브랜드로 나누지 않고, 1:1 방은 direct_key로 한 번만 만든다.';

create index chat_rooms_company_last_idx
  on public.chat_rooms (company_id, last_message_at desc);

create trigger chat_rooms_set_updated_at
before update on public.chat_rooms
for each row execute function public.set_updated_at();

create table public.chat_room_members (
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  primary key (room_id, profile_id)
);

comment on table public.chat_room_members is
  '채팅방 멤버. last_read_at 이후 다른 사람의 메시지가 안 읽은 수다.';

create index chat_room_members_profile_idx
  on public.chat_room_members (profile_id);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  author_name text not null default '',
  kind text not null,
  body text not null default '',
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint chat_messages_kind_check check (kind in ('text', 'file', 'system')),
  constraint chat_messages_body_len_check check (char_length(body) <= 4000)
);

comment on table public.chat_messages is
  '채팅 메시지. id는 화면에서 만들어 재전송과 실시간 중복을 구분한다.';

create index chat_messages_room_created_idx
  on public.chat_messages (room_id, created_at desc);

create index chat_messages_author_idx
  on public.chat_messages (author_id);

create index chat_messages_company_idx
  on public.chat_messages (company_id);

create index chat_rooms_created_by_idx
  on public.chat_rooms (created_by);

create or replace function app.is_chat_room_member(target_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select
    app.is_approved()
    and target_room_id is not null
    and exists (
      select 1
      from public.chat_room_members m
      where m.room_id = target_room_id
        and m.profile_id = auth.uid()
    );
$function$;

revoke all on function app.is_chat_room_member(uuid) from public, anon;
grant execute on function app.is_chat_room_member(uuid) to authenticated;

create or replace function app.can_moderate_chat(
  target_room_id uuid,
  target_author_id uuid
)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select
    app.is_chat_room_member(target_room_id)
    and (
      target_author_id = auth.uid()
      or app.is_company_manager()
    );
$function$;

revoke all on function app.can_moderate_chat(uuid, uuid) from public, anon, authenticated;

create or replace function app.assert_chat_member_profiles(target_ids uuid[])
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_company_id uuid;
  v_expected integer;
  v_found integer;
begin
  if not app.is_approved() then
    raise exception '승인된 직원만 채팅을 사용할 수 있습니다.';
  end if;

  v_company_id := app.chat_company_id();
  if v_company_id is null then
    raise exception '회사 정보를 찾을 수 없습니다.';
  end if;

  select count(*)::integer
  into v_expected
  from (select distinct unnest(coalesce(target_ids, '{}'::uuid[]))) ids;

  select count(*)::integer
  into v_found
  from public.profiles p
  where p.id = any(coalesce(target_ids, '{}'::uuid[]))
    and p.status = 'active'
    and p.company_id = v_company_id;

  if v_found <> v_expected then
    raise exception '같은 회사의 활성 직원만 대화에 포함할 수 있습니다.';
  end if;
end;
$function$;

revoke all on function app.assert_chat_member_profiles(uuid[]) from public, anon, authenticated;

create or replace function app.prepare_chat_message()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_company_id uuid;
  v_name text;
begin
  if auth.uid() is null or not app.is_chat_room_member(new.room_id) then
    raise exception '이 채팅방의 멤버가 아닙니다.';
  end if;

  select r.company_id
  into v_company_id
  from public.chat_rooms r
  where r.id = new.room_id;

  if v_company_id is null then
    raise exception '채팅방을 찾을 수 없습니다.';
  end if;

  v_name := coalesce(app.chat_actor_name(), '이름 없음');
  new.company_id := v_company_id;
  new.author_id := auth.uid();
  new.author_name := v_name;
  new.deleted_at := null;
  if new.kind is null or btrim(new.kind) = '' then
    new.kind := 'text';
  end if;

  if new.kind = 'text' then
    new.body := btrim(new.body);
    if new.body = '' then
      raise exception '메시지를 입력하세요.';
    end if;
  elsif new.kind = 'system' then
    new.body := btrim(new.body);
    if new.body = '' then
      raise exception '시스템 메시지 내용이 없습니다.';
    end if;
  end if;

  if char_length(new.body) > 4000 then
    raise exception '메시지는 4,000자까지 보낼 수 있습니다.';
  end if;

  if new.id is null then
    new.id := gen_random_uuid();
  end if;

  return new;
end;
$function$;

revoke all on function app.prepare_chat_message() from public, anon, authenticated;

create trigger chat_messages_prepare
before insert on public.chat_messages
for each row execute function app.prepare_chat_message();

create or replace function app.refresh_chat_room_preview(target_room_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_at timestamptz;
  v_kind text;
  v_body text;
  v_preview text;
begin
  select msg.created_at, msg.kind, msg.body
  into v_at, v_kind, v_body
  from public.chat_messages msg
  where msg.room_id = target_room_id
    and msg.deleted_at is null
  order by msg.created_at desc
  limit 1;

  v_preview := case
    when v_at is null then ''
    when v_kind = 'file' then '파일'
    else left(coalesce(v_body, ''), 120)
  end;

  update public.chat_rooms
  set last_message_preview = v_preview,
      last_message_at = coalesce(v_at, last_message_at)
  where id = target_room_id;
end;
$function$;

revoke all on function app.refresh_chat_room_preview(uuid) from public, anon, authenticated;

create or replace function app.touch_chat_room_on_message()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_preview text;
begin
  v_preview := case
    when new.kind = 'file' then '파일'
    else left(new.body, 120)
  end;

  update public.chat_rooms
  set last_message_at = new.created_at,
      last_message_preview = v_preview
  where id = new.room_id
    and (last_message_at is null or last_message_at <= new.created_at);

  return new;
end;
$function$;

revoke all on function app.touch_chat_room_on_message() from public, anon, authenticated;

create trigger chat_messages_touch_room
after insert on public.chat_messages
for each row execute function app.touch_chat_room_on_message();

create or replace function app.insert_chat_system_message(
  target_room_id uuid,
  target_body text
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  insert into public.chat_messages (room_id, kind, body)
  values (target_room_id, 'system', target_body);
end;
$function$;

revoke all on function app.insert_chat_system_message(uuid, text) from public, anon, authenticated;

alter table public.chat_rooms enable row level security;
alter table public.chat_room_members enable row level security;
alter table public.chat_messages enable row level security;

create policy chat_rooms_select
on public.chat_rooms
for select
to authenticated
using (app.is_chat_room_member(id));

create policy chat_room_members_select
on public.chat_room_members
for select
to authenticated
using (app.is_chat_room_member(room_id));

create policy chat_messages_select
on public.chat_messages
for select
to authenticated
using (app.is_chat_room_member(room_id));

create policy chat_messages_insert
on public.chat_messages
for insert
to authenticated
with check (
  kind = 'text'
  and deleted_at is null
  and author_id = auth.uid()
  and app.is_chat_room_member(room_id)
);

revoke all on table public.chat_rooms from public, anon, authenticated;
revoke all on table public.chat_room_members from public, anon, authenticated;
revoke all on table public.chat_messages from public, anon, authenticated;

grant select on table public.chat_rooms to authenticated;
grant select on table public.chat_room_members to authenticated;
grant select, insert on table public.chat_messages to authenticated;

grant select, insert, update, delete on table public.chat_rooms to service_role;
grant select, insert, update, delete on table public.chat_room_members to service_role;
grant select, insert, update, delete on table public.chat_messages to service_role;

alter table public.chat_rooms replica identity full;
alter table public.chat_room_members replica identity full;
alter table public.chat_messages replica identity full;

create or replace function public.list_chat_directory()
returns table (
  profile_id uuid,
  display_name text,
  department_name text,
  "position" text
)
language sql
stable
security definer
set search_path to ''
as $function$
  select
    p.id,
    coalesce(nullif(btrim(p.display_name), ''), '이름 없음'),
    d.name,
    p.position
  from public.profiles p
  left join public.departments d on d.id = p.department_id
  where app.is_approved()
    and p.status = 'active'
    and p.company_id = app.chat_company_id()
    and p.id <> auth.uid()
  order by 2;
$function$;

create or replace function public.list_my_chat_rooms()
returns table (
  room_id uuid,
  kind text,
  name text,
  last_message_at timestamptz,
  last_message_preview text,
  unread_count integer,
  peer_profile_id uuid,
  peer_display_name text,
  peer_position text,
  member_count integer
)
language sql
stable
security definer
set search_path to ''
as $function$
  select
    r.id,
    r.kind,
    r.name,
    r.last_message_at,
    r.last_message_preview,
    (
      select count(*)::integer
      from public.chat_messages msg
      where msg.room_id = r.id
        and msg.deleted_at is null
        and msg.author_id is distinct from auth.uid()
        and msg.created_at > coalesce(me.last_read_at, '-infinity'::timestamptz)
    ),
    peer.profile_id,
    peer.display_name,
    peer.position,
    (
      select count(*)::integer
      from public.chat_room_members all_members
      where all_members.room_id = r.id
    )
  from public.chat_room_members me
  join public.chat_rooms r on r.id = me.room_id
  left join lateral (
    select
      p.id as profile_id,
      coalesce(nullif(btrim(p.display_name), ''), '이름 없음') as display_name,
      p.position
    from public.chat_room_members other_member
    join public.profiles p on p.id = other_member.profile_id
    where other_member.room_id = r.id
      and other_member.profile_id <> auth.uid()
      and r.kind = 'direct'
    order by other_member.joined_at
    limit 1
  ) peer on true
  where me.profile_id = auth.uid()
    and app.is_approved()
  order by r.last_message_at desc nulls last, r.created_at desc;
$function$;

create or replace function public.list_chat_room_members(target_room_id uuid)
returns table (
  profile_id uuid,
  display_name text,
  department_name text,
  "position" text,
  joined_at timestamptz
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if not app.is_chat_room_member(target_room_id) then
    raise exception '이 채팅방의 멤버가 아닙니다.';
  end if;

  return query
  select
    p.id,
    coalesce(nullif(btrim(p.display_name), ''), '이름 없음'),
    d.name,
    p.position,
    m.joined_at
  from public.chat_room_members m
  join public.profiles p on p.id = m.profile_id
  left join public.departments d on d.id = p.department_id
  where m.room_id = target_room_id
  order by m.joined_at, 2;
end;
$function$;

create or replace function public.open_direct_chat(other_profile_id uuid)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_company_id uuid;
  v_key text;
  v_room_id uuid;
begin
  if other_profile_id is null or other_profile_id = auth.uid() then
    raise exception '대화 상대를 선택하세요.';
  end if;

  perform app.assert_chat_member_profiles(array[other_profile_id]);
  v_company_id := app.chat_company_id();
  v_key := least(auth.uid(), other_profile_id)::text
    || ':'
    || greatest(auth.uid(), other_profile_id)::text;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_company_id::text || ':' || v_key));

  insert into public.chat_rooms (company_id, kind, name, direct_key, created_by)
  values (v_company_id, 'direct', '', v_key, auth.uid())
  on conflict on constraint chat_rooms_company_direct_key do nothing;

  select r.id
  into v_room_id
  from public.chat_rooms r
  where r.company_id = v_company_id
    and r.direct_key = v_key;

  insert into public.chat_room_members (room_id, profile_id)
  values (v_room_id, auth.uid()), (v_room_id, other_profile_id)
  on conflict (room_id, profile_id) do nothing;

  return v_room_id;
end;
$function$;

create or replace function public.create_group_chat(
  room_name text,
  member_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_company_id uuid;
  v_name text;
  v_ids uuid[];
  v_room_id uuid;
begin
  if not app.is_approved() then
    raise exception '승인된 직원만 채팅을 사용할 수 있습니다.';
  end if;

  v_name := btrim(coalesce(room_name, ''));
  if char_length(v_name) < 1 or char_length(v_name) > 80 then
    raise exception '방 이름은 1자에서 80자까지 입력하세요.';
  end if;

  select coalesce(array_agg(distinct member_id), '{}'::uuid[])
  into v_ids
  from unnest(coalesce(member_ids, '{}'::uuid[])) member_id
  where member_id is not null
    and member_id <> auth.uid();

  if cardinality(v_ids) > 100 then
    raise exception '한 방에 초대할 수 있는 사람은 100명까지입니다.';
  end if;

  perform app.assert_chat_member_profiles(v_ids);
  v_company_id := app.chat_company_id();

  insert into public.chat_rooms (company_id, kind, name, created_by)
  values (v_company_id, 'group', v_name, auth.uid())
  returning id into v_room_id;

  insert into public.chat_room_members (room_id, profile_id)
  values (v_room_id, auth.uid());

  insert into public.chat_room_members (room_id, profile_id)
  select v_room_id, member_id
  from unnest(v_ids) member_id;

  perform app.insert_chat_system_message(
    v_room_id,
    app.chat_actor_name() || ' 님이 채팅방을 만들었습니다.'
  );

  return v_room_id;
end;
$function$;

create or replace function public.add_chat_room_members(
  target_room_id uuid,
  member_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_kind text;
  v_ids uuid[];
  v_names text;
begin
  if not app.is_chat_room_member(target_room_id) then
    raise exception '이 채팅방의 멤버가 아닙니다.';
  end if;

  select r.kind
  into v_kind
  from public.chat_rooms r
  where r.id = target_room_id;

  if v_kind is distinct from 'group' then
    raise exception '1:1 대화에는 사람을 추가할 수 없습니다.';
  end if;

  select coalesce(array_agg(distinct member_id), '{}'::uuid[])
  into v_ids
  from unnest(coalesce(member_ids, '{}'::uuid[])) member_id
  where member_id is not null
    and member_id <> auth.uid()
    and not exists (
      select 1
      from public.chat_room_members existing
      where existing.room_id = target_room_id
        and existing.profile_id = member_id
    );

  if cardinality(v_ids) = 0 then
    return;
  end if;

  if (
    select count(*)
    from public.chat_room_members existing
    where existing.room_id = target_room_id
  ) + cardinality(v_ids) > 101 then
    raise exception '한 방에 초대할 수 있는 사람은 100명까지입니다.';
  end if;

  perform app.assert_chat_member_profiles(v_ids);

  insert into public.chat_room_members (room_id, profile_id)
  select target_room_id, member_id
  from unnest(v_ids) member_id;

  select string_agg(
    coalesce(nullif(btrim(p.display_name), ''), '이름 없음'),
    ', ' order by coalesce(nullif(btrim(p.display_name), ''), '이름 없음')
  )
  into v_names
  from public.profiles p
  where p.id = any(v_ids);

  perform app.insert_chat_system_message(
    target_room_id,
    app.chat_actor_name() || ' 님이 ' || coalesce(v_names, '동료') || ' 님을 초대했습니다.'
  );
end;
$function$;

create or replace function public.rename_chat_room(
  target_room_id uuid,
  room_name text
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_kind text;
  v_name text;
begin
  if not app.is_chat_room_member(target_room_id) then
    raise exception '이 채팅방의 멤버가 아닙니다.';
  end if;

  select r.kind
  into v_kind
  from public.chat_rooms r
  where r.id = target_room_id;

  if v_kind is distinct from 'group' then
    raise exception '1:1 대화의 이름은 바꿀 수 없습니다.';
  end if;

  v_name := btrim(coalesce(room_name, ''));
  if char_length(v_name) < 1 or char_length(v_name) > 80 then
    raise exception '방 이름은 1자에서 80자까지 입력하세요.';
  end if;

  update public.chat_rooms
  set name = v_name
  where id = target_room_id
    and name is distinct from v_name;

  if not found then
    return;
  end if;

  perform app.insert_chat_system_message(
    target_room_id,
    app.chat_actor_name() || ' 님이 방 이름을 "' || v_name || '"으로 바꿨습니다.'
  );
end;
$function$;

create or replace function public.leave_chat_room(target_room_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_kind text;
begin
  if not app.is_chat_room_member(target_room_id) then
    raise exception '이 채팅방의 멤버가 아닙니다.';
  end if;

  select r.kind
  into v_kind
  from public.chat_rooms r
  where r.id = target_room_id;

  if v_kind is distinct from 'group' then
    raise exception '1:1 대화에서는 나갈 수 없습니다.';
  end if;

  perform app.insert_chat_system_message(
    target_room_id,
    app.chat_actor_name() || ' 님이 나갔습니다.'
  );

  delete from public.chat_room_members
  where room_id = target_room_id
    and profile_id = auth.uid();
end;
$function$;

create or replace function public.mark_chat_room_read(target_room_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if not app.is_chat_room_member(target_room_id) then
    raise exception '이 채팅방의 멤버가 아닙니다.';
  end if;

  update public.chat_room_members
  set last_read_at = now()
  where room_id = target_room_id
    and profile_id = auth.uid();
end;
$function$;

create or replace function public.delete_chat_message(target_message_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_room_id uuid;
  v_author_id uuid;
  v_deleted_at timestamptz;
begin
  select msg.room_id, msg.author_id, msg.deleted_at
  into v_room_id, v_author_id, v_deleted_at
  from public.chat_messages msg
  where msg.id = target_message_id;

  if v_room_id is null then
    raise exception '메시지를 찾을 수 없습니다.';
  end if;

  if not app.can_moderate_chat(v_room_id, v_author_id) then
    raise exception '메시지를 삭제할 권한이 없습니다.';
  end if;

  if v_deleted_at is not null then
    return;
  end if;

  update public.chat_messages
  set deleted_at = now(),
      body = ''
  where id = target_message_id;

  perform app.refresh_chat_room_preview(v_room_id);
end;
$function$;

revoke all on function public.list_chat_directory() from public, anon;
revoke all on function public.list_my_chat_rooms() from public, anon;
revoke all on function public.list_chat_room_members(uuid) from public, anon;
revoke all on function public.open_direct_chat(uuid) from public, anon;
revoke all on function public.create_group_chat(text, uuid[]) from public, anon;
revoke all on function public.add_chat_room_members(uuid, uuid[]) from public, anon;
revoke all on function public.rename_chat_room(uuid, text) from public, anon;
revoke all on function public.leave_chat_room(uuid) from public, anon;
revoke all on function public.mark_chat_room_read(uuid) from public, anon;
revoke all on function public.delete_chat_message(uuid) from public, anon;

grant execute on function public.list_chat_directory() to authenticated;
grant execute on function public.list_my_chat_rooms() to authenticated;
grant execute on function public.list_chat_room_members(uuid) to authenticated;
grant execute on function public.open_direct_chat(uuid) to authenticated;
grant execute on function public.create_group_chat(text, uuid[]) to authenticated;
grant execute on function public.add_chat_room_members(uuid, uuid[]) to authenticated;
grant execute on function public.rename_chat_room(uuid, text) to authenticated;
grant execute on function public.leave_chat_room(uuid) to authenticated;
grant execute on function public.mark_chat_room_read(uuid) to authenticated;
grant execute on function public.delete_chat_message(uuid) to authenticated;

do $publication$
begin
  begin
    alter publication supabase_realtime add table public.chat_messages;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.chat_room_members;
  exception when duplicate_object then null;
  end;
end;
$publication$;
