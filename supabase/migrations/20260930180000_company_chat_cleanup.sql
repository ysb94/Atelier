-- 채팅 파일 삭제. 일반 삭제는 30일 휴지통이고, 고객 정보 삭제는 바로 지운다.
-- 매일 04:00(한국시간)에 기한이 지난 파일만 정리한다. 입력값은 없다.

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

  update public.chat_attachments
  set status = 'trashed',
      trashed_at = now(),
      trashed_by = auth.uid()
  where message_id = target_message_id
    and status in ('ready', 'uploading');

  update public.chat_messages
  set deleted_at = now(),
      body = ''
  where id = target_message_id;

  perform app.refresh_chat_room_preview(v_room_id);
end;
$function$;

create or replace function public.trash_chat_attachment(target_attachment_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_row public.chat_attachments%rowtype;
begin
  select * into v_row
  from public.chat_attachments
  where id = target_attachment_id
  for update;

  if v_row.id is null then
    raise exception '파일을 찾을 수 없습니다.';
  end if;
  if not app.can_moderate_chat(v_row.room_id, v_row.uploader_id) then
    raise exception '파일을 삭제할 권한이 없습니다.';
  end if;
  if v_row.status not in ('ready', 'uploading') then
    raise exception '휴지통으로 옮길 수 있는 파일이 아닙니다.';
  end if;

  update public.chat_attachments
  set status = 'trashed',
      trashed_at = now(),
      trashed_by = auth.uid()
  where id = v_row.id;

  if v_row.message_id is not null then
    update public.chat_messages
    set body = ''
    where id = v_row.message_id
      and deleted_at is null;
  end if;

  perform app.refresh_chat_room_preview(v_row.room_id);
end;
$function$;

create or replace function public.restore_chat_attachment(target_attachment_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_row public.chat_attachments%rowtype;
begin
  select * into v_row
  from public.chat_attachments
  where id = target_attachment_id
  for update;

  if v_row.id is null then
    raise exception '파일을 찾을 수 없습니다.';
  end if;
  if not app.can_moderate_chat(v_row.room_id, v_row.uploader_id) then
    raise exception '파일을 되돌릴 권한이 없습니다.';
  end if;
  if v_row.status is distinct from 'trashed' or v_row.trashed_at is null then
    raise exception '휴지통에 있는 파일만 되돌릴 수 있습니다.';
  end if;
  if v_row.trashed_at < now() - interval '30 days' then
    raise exception '되돌릴 수 있는 기간이 지났습니다.';
  end if;

  update public.chat_attachments
  set status = 'ready',
      trashed_at = null,
      trashed_by = null
  where id = v_row.id;

  if v_row.message_id is not null then
    update public.chat_messages
    set body = v_row.file_name,
        deleted_at = null
    where id = v_row.message_id;
  end if;

  perform app.refresh_chat_room_preview(v_row.room_id);
end;
$function$;

create or replace function public.purge_chat_attachment(target_attachment_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_row public.chat_attachments%rowtype;
begin
  select * into v_row
  from public.chat_attachments
  where id = target_attachment_id
  for update;

  if v_row.id is null then
    raise exception '파일을 찾을 수 없습니다.';
  end if;
  if not app.can_moderate_chat(v_row.room_id, v_row.uploader_id) then
    raise exception '파일을 삭제할 권한이 없습니다.';
  end if;
  if v_row.status in ('purged', 'cancelled') then
    return;
  end if;

  update public.chat_attachments
  set status = 'purged',
      purged_at = now(),
      purged_by = auth.uid(),
      purge_reason = 'pii'
  where id = v_row.id;

  if v_row.message_id is not null then
    update public.chat_messages
    set body = '',
        deleted_at = coalesce(deleted_at, now())
    where id = v_row.message_id;
  end if;

  perform app.refresh_chat_room_preview(v_row.room_id);
end;
$function$;

create or replace function public.list_chat_attachment_downloads(
  target_attachment_id uuid
)
returns table (
  profile_id uuid,
  display_name text,
  downloaded_at timestamptz
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_room_id uuid;
begin
  select attachment.room_id
  into v_room_id
  from public.chat_attachments attachment
  where attachment.id = target_attachment_id;

  if v_room_id is null or not app.is_chat_room_member(v_room_id) then
    raise exception '이 파일의 받은 사람 목록을 볼 수 없습니다.';
  end if;

  return query
  select
    download.profile_id,
    coalesce(profile.display_name, '이름 없음'),
    download.downloaded_at
  from public.chat_attachment_downloads download
  left join public.profiles profile on profile.id = download.profile_id
  where download.attachment_id = target_attachment_id
  order by download.downloaded_at desc;
end;
$function$;

create or replace function public.cleanup_chat_files()
returns table (
  object_path text
)
language plpgsql
security definer
set search_path to ''
as $function$
begin
  return query
  with due as (
    select
      attachment.id,
      attachment.object_path as original_path,
      attachment.thumb_path
    from public.chat_attachments attachment
    where (
      attachment.status = 'uploading'
      and attachment.created_at < now() - interval '24 hours'
    )
    or (
      attachment.status = 'trashed'
      and attachment.trashed_at < now() - interval '30 days'
    )
    or (
      attachment.status in ('purged', 'cancelled')
      and attachment.updated_at > now() - interval '7 days'
    )
  )
  select due.original_path
  from due
  where due.original_path is not null
  union
  select due.thumb_path
  from due
  where due.thumb_path is not null;

  update public.chat_attachments
  set status = 'cancelled'
  where status = 'uploading'
    and created_at < now() - interval '24 hours';

  update public.chat_attachments
  set status = 'purged',
      purged_at = coalesce(purged_at, now()),
      purge_reason = coalesce(purge_reason, 'expired')
  where status = 'trashed'
    and trashed_at < now() - interval '30 days';
end;
$function$;

revoke all on function public.trash_chat_attachment(uuid) from public, anon;
revoke all on function public.restore_chat_attachment(uuid) from public, anon;
revoke all on function public.purge_chat_attachment(uuid) from public, anon;
revoke all on function public.list_chat_attachment_downloads(uuid) from public, anon;
revoke all on function public.cleanup_chat_files() from public, anon, authenticated;

grant execute on function public.trash_chat_attachment(uuid) to authenticated;
grant execute on function public.restore_chat_attachment(uuid) to authenticated;
grant execute on function public.purge_chat_attachment(uuid) to authenticated;
grant execute on function public.list_chat_attachment_downloads(uuid) to authenticated;
grant execute on function public.cleanup_chat_files() to service_role;
