-- 채팅 파일은 회사 경로에 둔다. 브랜드 폴더를 쓰지 않는다.
-- 한 파일은 50MB까지다. 유료 전환 때 이 한도와 src/lib/chat/file-rules.ts 의
-- CHAT_FILE_MAX_BYTES 를 함께 100MB로 올린다.
-- 실행 파일은 화면과 여기서 같이 막는다. 목록이 다르면 서버 목록이 우선이다.

create table public.chat_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid references public.chat_messages(id) on delete cascade,
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  uploader_id uuid references public.profiles(id) on delete set null,
  file_name text not null,
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null,
  object_path text not null,
  thumb_path text,
  has_macro boolean not null default false,
  status text not null default 'uploading',
  trashed_at timestamptz,
  trashed_by uuid references public.profiles(id) on delete set null,
  purged_at timestamptz,
  purged_by uuid references public.profiles(id) on delete set null,
  purge_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chat_attachments_message_key unique (message_id),
  constraint chat_attachments_object_path_key unique (object_path),
  constraint chat_attachments_status_check check (
    status in ('uploading', 'ready', 'trashed', 'purged', 'cancelled')
  ),
  constraint chat_attachments_size_check check (
    size_bytes > 0 and size_bytes <= 52428800
  ),
  constraint chat_attachments_file_name_check check (
    char_length(btrim(file_name)) between 1 and 180
  )
);

comment on table public.chat_attachments is
  '회사 채팅 파일. 경로는 companies/{회사}/chat/{방}/{파일}/ 이고 원래 이름은 file_name에 둔다.';

create index chat_attachments_room_idx
  on public.chat_attachments (room_id, created_at desc);

create index chat_attachments_status_idx
  on public.chat_attachments (status, created_at);

create index chat_attachments_company_idx
  on public.chat_attachments (company_id);

create index chat_attachments_uploader_idx
  on public.chat_attachments (uploader_id);

create index chat_attachments_trashed_by_idx
  on public.chat_attachments (trashed_by);

create index chat_attachments_purged_by_idx
  on public.chat_attachments (purged_by);

create trigger chat_attachments_set_updated_at
before update on public.chat_attachments
for each row execute function public.set_updated_at();

create table public.chat_attachment_downloads (
  id uuid primary key default gen_random_uuid(),
  attachment_id uuid not null references public.chat_attachments(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  downloaded_at timestamptz not null default now()
);

comment on table public.chat_attachment_downloads is
  '채팅 파일을 내려받은 기록. 이메일 대신 프로필 id만 남긴다.';

create index chat_attachment_downloads_attachment_idx
  on public.chat_attachment_downloads (attachment_id, downloaded_at desc);

create index chat_attachment_downloads_profile_idx
  on public.chat_attachment_downloads (profile_id);

alter table public.chat_attachments enable row level security;
alter table public.chat_attachment_downloads enable row level security;

create policy chat_attachments_select
on public.chat_attachments
for select
to authenticated
using (app.is_chat_room_member(room_id));

revoke all on table public.chat_attachments from public, anon, authenticated;
revoke all on table public.chat_attachment_downloads from public, anon, authenticated;
grant select on table public.chat_attachments to authenticated;
grant select, insert, update, delete on table public.chat_attachments to service_role;
grant select, insert, update, delete on table public.chat_attachment_downloads to service_role;

alter table public.chat_attachments replica identity full;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('company-chat', 'company-chat', false, 52428800, null)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists company_chat_select on storage.objects;
create policy company_chat_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'company-chat'
  and exists (
    select 1
    from public.chat_attachments attachment
    where (
      name = attachment.object_path
      or name = attachment.thumb_path
    )
    and (
      (
        attachment.status = 'ready'
        and app.is_chat_room_member(attachment.room_id)
      )
      or (
        attachment.status = 'uploading'
        and attachment.uploader_id = auth.uid()
      )
    )
  )
);

drop policy if exists company_chat_insert on storage.objects;
create policy company_chat_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'company-chat'
  and exists (
    select 1
    from public.chat_attachments attachment
    where attachment.status = 'uploading'
      and attachment.uploader_id = auth.uid()
      and (
        name = attachment.object_path
        or name = attachment.thumb_path
      )
  )
);

-- 이어 올리기가 끝나는 동안만 수정된다. ready 이후에는 행 상태가 바뀌어 막힌다.
drop policy if exists company_chat_update on storage.objects;
create policy company_chat_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'company-chat'
  and exists (
    select 1
    from public.chat_attachments attachment
    where attachment.status = 'uploading'
      and attachment.uploader_id = auth.uid()
      and (
        name = attachment.object_path
        or name = attachment.thumb_path
      )
  )
)
with check (
  bucket_id = 'company-chat'
  and exists (
    select 1
    from public.chat_attachments attachment
    where attachment.status = 'uploading'
      and attachment.uploader_id = auth.uid()
      and (
        name = attachment.object_path
        or name = attachment.thumb_path
      )
  )
);

drop policy if exists company_chat_delete on storage.objects;
create policy company_chat_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'company-chat'
  and exists (
    select 1
    from public.chat_attachments attachment
    where attachment.status in ('purged', 'cancelled')
      and (
        attachment.uploader_id = auth.uid()
        or attachment.purged_by = auth.uid()
      )
      and (
        name = attachment.object_path
        or name = attachment.thumb_path
      )
  )
);

create or replace function app.chat_file_extension(file_name text)
returns text
language sql
immutable
set search_path to ''
as $function$
  select case
    when coalesce(file_name, '') !~ '\.' then ''
    else lower(regexp_replace(file_name, '^.*\.', ''))
  end;
$function$;

revoke all on function app.chat_file_extension(text) from public, anon, authenticated;

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
    when v_kind = 'file' then left('파일: ' || coalesce(v_body, ''), 120)
    else left(coalesce(v_body, ''), 120)
  end;

  update public.chat_rooms
  set last_message_preview = v_preview,
      last_message_at = coalesce(v_at, last_message_at)
  where id = target_room_id;
end;
$function$;

create or replace function public.begin_chat_attachment(
  target_room_id uuid,
  file_name text,
  mime_type text,
  size_bytes bigint
)
returns table (
  attachment_id uuid,
  object_path text,
  thumb_path text
)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_company_id uuid;
  v_name text;
  v_ext text;
  v_storage_ext text;
  v_id uuid;
  v_object text;
  v_thumb text;
  v_macro boolean;
  v_blocked text[] := array[
    'exe', 'msi', 'bat', 'cmd', 'ps1', 'vbs', 'js', 'scr',
    'com', 'cpl', 'msc', 'jar', 'dll', 'hta', 'wsf', 'gadget',
    'pif', 'lnk', 'reg'
  ];
  v_macro_ext text[] := array[
    'xls', 'xlsm', 'xlsb', 'xltm', 'xlam',
    'docm', 'dotm', 'pptm', 'potm', 'ppam'
  ];
begin
  if not app.is_chat_room_member(target_room_id) then
    raise exception '이 채팅방의 멤버가 아닙니다.';
  end if;

  v_name := btrim(coalesce(file_name, ''));
  if char_length(v_name) < 1 or char_length(v_name) > 180 then
    raise exception '파일 이름은 1자에서 180자까지입니다.';
  end if;
  if size_bytes is null or size_bytes <= 0 or size_bytes > 52428800 then
    raise exception '파일은 1바이트에서 50MB까지 올릴 수 있습니다.';
  end if;

  v_ext := app.chat_file_extension(v_name);
  if v_ext = any(v_blocked) then
    raise exception '실행 파일은 올릴 수 없습니다.';
  end if;

  select r.company_id into v_company_id
  from public.chat_rooms r
  where r.id = target_room_id;

  v_storage_ext := case
    when v_ext ~ '^[a-z0-9]{1,8}$' then v_ext
    else 'bin'
  end;
  v_macro := v_ext = any(v_macro_ext);
  v_id := gen_random_uuid();
  v_object := 'companies/' || v_company_id::text || '/chat/' || target_room_id::text
    || '/' || v_id::text || '/original.' || v_storage_ext;
  v_thumb := 'companies/' || v_company_id::text || '/chat/' || target_room_id::text
    || '/' || v_id::text || '/thumb.jpg';

  insert into public.chat_attachments (
    id, room_id, company_id, uploader_id, file_name, mime_type,
    size_bytes, object_path, thumb_path, has_macro, status
  )
  values (
    v_id, target_room_id, v_company_id, auth.uid(), v_name,
    coalesce(nullif(btrim(mime_type), ''), 'application/octet-stream'),
    size_bytes, v_object, v_thumb, v_macro, 'uploading'
  );

  attachment_id := v_id;
  object_path := v_object;
  thumb_path := v_thumb;
  return next;
end;
$function$;

create or replace function public.complete_chat_attachment(
  target_attachment_id uuid,
  has_thumb boolean
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_row public.chat_attachments%rowtype;
  v_message_id uuid;
begin
  select * into v_row
  from public.chat_attachments
  where id = target_attachment_id
  for update;

  if v_row.id is null then
    raise exception '파일을 찾을 수 없습니다.';
  end if;
  if v_row.uploader_id is distinct from auth.uid() or v_row.status is distinct from 'uploading' then
    raise exception '이 파일 올리기를 마칠 수 없습니다.';
  end if;

  insert into public.chat_messages (room_id, kind, body)
  values (v_row.room_id, 'file', v_row.file_name)
  returning id into v_message_id;

  update public.chat_attachments
  set message_id = v_message_id,
      status = 'ready',
      thumb_path = case when coalesce(has_thumb, false) then thumb_path else null end
  where id = v_row.id;

  return v_message_id;
end;
$function$;

create or replace function public.cancel_chat_attachment(target_attachment_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  update public.chat_attachments
  set status = 'cancelled'
  where id = target_attachment_id
    and uploader_id = auth.uid()
    and status = 'uploading';

  if not found then
    raise exception '이 파일 올리기를 취소할 수 없습니다.';
  end if;
end;
$function$;

create or replace function public.record_chat_attachment_download(
  target_attachment_id uuid
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_room_id uuid;
  v_status text;
begin
  select room_id, status
  into v_room_id, v_status
  from public.chat_attachments
  where id = target_attachment_id;

  if v_room_id is null or v_status is distinct from 'ready' then
    raise exception '받을 수 있는 파일이 아닙니다.';
  end if;
  if not app.is_chat_room_member(v_room_id) then
    raise exception '이 채팅방의 멤버가 아닙니다.';
  end if;

  insert into public.chat_attachment_downloads (attachment_id, profile_id)
  values (target_attachment_id, auth.uid());
end;
$function$;

create or replace function public.chat_storage_usage()
returns table (
  used_bytes bigint,
  file_count integer
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if not app.is_admin() then
    raise exception '채팅 파일 사용량은 관리자만 볼 수 있습니다.';
  end if;

  return query
  select
    coalesce(sum(attachment.size_bytes), 0)::bigint,
    count(*)::integer
  from public.chat_attachments attachment
  where attachment.status in ('uploading', 'ready', 'trashed');
end;
$function$;

revoke all on function public.begin_chat_attachment(uuid, text, text, bigint) from public, anon;
revoke all on function public.complete_chat_attachment(uuid, boolean) from public, anon;
revoke all on function public.cancel_chat_attachment(uuid) from public, anon;
revoke all on function public.record_chat_attachment_download(uuid) from public, anon;
revoke all on function public.chat_storage_usage() from public, anon;

grant execute on function public.begin_chat_attachment(uuid, text, text, bigint) to authenticated;
grant execute on function public.complete_chat_attachment(uuid, boolean) to authenticated;
grant execute on function public.cancel_chat_attachment(uuid) to authenticated;
grant execute on function public.record_chat_attachment_download(uuid) to authenticated;
grant execute on function public.chat_storage_usage() to authenticated;

do $publication$
begin
  begin
    alter publication supabase_realtime add table public.chat_attachments;
  exception when duplicate_object then null;
  end;
end;
$publication$;
