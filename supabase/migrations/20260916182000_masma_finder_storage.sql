-- Finder Works 첨부. 경로는 brands/{brand_id}/works/{task_id}/...

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'masma-finder-works',
  'masma-finder-works',
  false,
  10485760,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/pdf',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/csv',
    'text/plain',
    'application/zip',
    'application/octet-stream'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function app.masma_finder_storage_brand_id(object_name text)
returns uuid
language plpgsql
immutable
set search_path to ''
as $$
declare
  v_id text;
begin
  v_id := split_part(object_name, '/', 2);
  if v_id ~* '^[0-9a-f-]{36}$' then
    return v_id::uuid;
  end if;
  return null;
end;
$$;

revoke all on function app.masma_finder_storage_brand_id(text) from public, anon;
grant execute on function app.masma_finder_storage_brand_id(text) to authenticated;

drop policy if exists masma_finder_works_select on storage.objects;
create policy masma_finder_works_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'masma-finder-works'
  and app.can_use_masma_finder(app.masma_finder_storage_brand_id(name))
);

drop policy if exists masma_finder_works_insert on storage.objects;
create policy masma_finder_works_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'masma-finder-works'
  and app.can_use_masma_finder(app.masma_finder_storage_brand_id(name))
);

drop policy if exists masma_finder_works_update on storage.objects;
create policy masma_finder_works_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'masma-finder-works'
  and app.can_use_masma_finder(app.masma_finder_storage_brand_id(name))
)
with check (
  bucket_id = 'masma-finder-works'
  and app.can_use_masma_finder(app.masma_finder_storage_brand_id(name))
);

drop policy if exists masma_finder_works_delete on storage.objects;
create policy masma_finder_works_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'masma-finder-works'
  and app.can_use_masma_finder(app.masma_finder_storage_brand_id(name))
);
