-- Storage remove는 SELECT와 DELETE가 모두 필요하다. 이미 읽을 수 있던 정리 담당자만 허용한다.
alter table public.meeting_files add column purged_at timestamptz;
create index meeting_files_cleanup_idx on public.meeting_files(company_id,uploaded_by) where deleted_at is not null and purged_at is null;
create or replace function app.meeting_file_access(p_path text,p_action text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.meeting_files f join public.meeting_rounds r on r.id=f.round_id
    join public.meeting_series s on s.id=r.series_id
    where f.storage_path=p_path and f.company_id=app.meeting_company_id() and case p_action
      when 'read' then f.ready and f.deleted_at is null and r.deleted_at is null and app.meeting_can_read(s.id)
      when 'insert' then not f.ready and f.deleted_at is null and f.uploaded_by=auth.uid() and r.deleted_at is null and app.meeting_can_read(s.id)
      when 'delete' then f.deleted_at is not null and (
        (f.uploaded_by=auth.uid() and app.meeting_can_read(s.id)) or s.host_id=auth.uid() or app.is_admin())
      else false end);
$$;
create policy meeting_storage_cleanup on storage.objects for select to authenticated
using(bucket_id='company-meetings' and app.meeting_file_access(name,'delete'));

create function app.meeting_cleanup_paths() returns text[]
language sql stable security definer set search_path='' as $$
  select coalesce(array_agg(storage_path),'{}'::text[]) from (
    select f.storage_path from public.meeting_files f where f.company_id=app.meeting_company_id()
      and f.deleted_at is not null and f.purged_at is null and app.meeting_file_access(f.storage_path,'delete')
      order by f.deleted_at,f.id limit 100
  ) pending;
$$;
create function app.meeting_finish_cleanup(p_paths text[]) returns void
language plpgsql security definer set search_path='' as $$
begin
  if cardinality(p_paths)>100 then raise exception '파일 정리 범위를 초과했습니다.'; end if;
  if exists(select 1 from unnest(p_paths) p where not app.meeting_file_access(p,'delete')) then
    raise exception '파일 정리 권한이 없습니다.' using errcode='42501'; end if;
  if exists(select 1 from storage.objects o where o.bucket_id='company-meetings' and o.name=any(p_paths)) then
    raise exception '파일이 저장소에 남아 있습니다. 다시 정리해 주세요.';
  end if;
  update public.meeting_files set purged_at=coalesce(purged_at,now()) where storage_path=any(p_paths);
end $$;
create function public.list_meeting_cleanup_paths() returns text[] language sql stable security invoker set search_path='' as $$ select app.meeting_cleanup_paths(); $$;
create function public.finish_meeting_cleanup(p_paths text[]) returns void language sql security invoker set search_path='' as $$ select app.meeting_finish_cleanup(p_paths); $$;
revoke all on function app.meeting_cleanup_paths(),app.meeting_finish_cleanup(text[]),public.list_meeting_cleanup_paths(),public.finish_meeting_cleanup(text[]) from public,anon;
grant execute on function app.meeting_cleanup_paths(),app.meeting_finish_cleanup(text[]),public.list_meeting_cleanup_paths(),public.finish_meeting_cleanup(text[]) to authenticated;
notify pgrst,'reload schema';
