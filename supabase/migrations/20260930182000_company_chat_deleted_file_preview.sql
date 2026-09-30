-- 휴지통에 들어간 파일은 방 목록에 파일 이름 대신 삭제된 파일로 남긴다.

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
    when new.kind = 'file' then left('파일: ' || new.body, 120)
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
    when v_kind = 'file' then left('파일: ' || coalesce(v_body, ''), 120)
    else left(coalesce(v_body, ''), 120)
  end;

  update public.chat_rooms
  set last_message_preview = v_preview,
      last_message_at = coalesce(v_at, last_message_at)
  where id = target_room_id;
end;
$function$;
