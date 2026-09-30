-- 채팅 목록: 나를 뺀 멤버, 마지막 메시지 종류, 이미지 여부.
-- 파일 미리보기는 접두어 없이 파일 이름만 남긴다.

drop function public.list_my_chat_rooms();

create function public.list_my_chat_rooms()
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
  member_count integer,
  members jsonb,
  last_message_kind text,
  last_attachment_mime text
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
    ),
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'profile_id', member_row.profile_id,
            'display_name', member_row.display_name
          )
          order by member_row.joined_at, member_row.profile_id
        )
        from (
          select
            p.id as profile_id,
            coalesce(nullif(btrim(p.display_name), ''), '이름 없음') as display_name,
            other_member.joined_at
          from public.chat_room_members other_member
          join public.profiles p on p.id = other_member.profile_id
          where other_member.room_id = r.id
            and other_member.profile_id <> auth.uid()
        ) member_row
      ),
      '[]'::jsonb
    ),
    last_msg.kind,
    last_msg.mime_type
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
  left join lateral (
    select msg.kind, att.mime_type
    from public.chat_messages msg
    left join public.chat_attachments att
      on att.message_id = msg.id
     and att.status = 'ready'
    where msg.room_id = r.id
      and msg.deleted_at is null
    order by msg.created_at desc
    limit 1
  ) last_msg on true
  where me.profile_id = auth.uid()
    and app.is_approved()
  order by r.last_message_at desc nulls last, r.created_at desc;
$function$;

revoke all on function public.list_my_chat_rooms() from public, anon;
grant execute on function public.list_my_chat_rooms() to authenticated;

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
    when new.kind = 'file' and btrim(coalesce(new.body, '')) = '' then '삭제된 파일'
    when new.kind = 'file' then left(new.body, 120)
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
    when v_kind = 'file' and btrim(coalesce(v_body, '')) = '' then '삭제된 파일'
    when v_kind = 'file' then left(coalesce(v_body, ''), 120)
    else left(coalesce(v_body, ''), 120)
  end;

  update public.chat_rooms
  set last_message_preview = v_preview,
      last_message_at = coalesce(v_at, last_message_at)
  where id = target_room_id;
end;
$function$;

do $refresh$
declare
  v_room uuid;
begin
  for v_room in select id from public.chat_rooms
  loop
    perform app.refresh_chat_room_preview(v_room);
  end loop;
end;
$refresh$;
