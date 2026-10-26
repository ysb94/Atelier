-- 공가는 사유와 서류를 첨부해 신청하고, 운영지원이 서류를 확인한 뒤 처리한다.
-- 재택은 새 신청 메뉴에서 빼되 기존 기록은 유지한다.

alter table public.company_leave_requests drop constraint company_leave_requests_kind_check;
alter table public.company_leave_requests add constraint company_leave_requests_kind_check
  check (kind in ('annual','half','quarter','overtime','offsite','remote','correction','official'));
alter table public.company_leave_requests drop constraint company_leave_requests_span_check;
alter table public.company_leave_requests add constraint company_leave_requests_span_check
  check (kind in ('annual','official') or (end_time > start_time and (from_date = to_date or kind in ('offsite','remote'))));
alter table public.company_leave_requests add constraint official_reason_required
  check (kind <> 'official' or length(btrim(note)) > 0);

create table public.company_leave_files (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  request_id uuid not null references public.company_leave_requests(id),
  file_name text not null check (length(btrim(file_name)) between 1 and 200),
  mime_type text not null default '',
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 20971520),
  storage_path text not null unique,
  uploaded_by uuid not null references public.profiles(id),
  ready boolean not null default false,
  created_at timestamptz not null default now()
);
create index company_leave_files_request on public.company_leave_files(request_id);
alter table public.company_leave_files enable row level security;
revoke all on public.company_leave_files from public, anon, authenticated;
grant select on public.company_leave_files to authenticated;
create policy leave_files_read on public.company_leave_files for select to authenticated
using (company_id = (select company_id from public.profiles where id = (select auth.uid()) and status = 'active')
  and ready and (uploaded_by = (select auth.uid()) or app.can_edit_org_assignment()));

insert into storage.buckets(id, name, public, file_size_limit)
values ('company-leave-files', 'company-leave-files', false, 20971520);

create or replace function app.leave_file_access(p_path text, p_action text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.company_leave_files f
    join public.company_leave_requests r on r.id = f.request_id
    where f.storage_path = p_path
      and f.company_id = (select company_id from public.profiles where id = auth.uid() and status = 'active')
      and case p_action
        when 'read' then f.ready and (f.uploaded_by = auth.uid() or app.can_edit_org_assignment())
        when 'insert' then not f.ready and f.uploaded_by = auth.uid() and r.employee_id = auth.uid() and r.kind = 'official' and r.status = 'pending'
        else false
      end
  );
$$;
revoke all on function app.leave_file_access(text, text) from public, anon;
grant execute on function app.leave_file_access(text, text) to authenticated;

create policy leave_file_storage_read on storage.objects for select to authenticated
using (bucket_id = 'company-leave-files' and app.leave_file_access(name, 'read'));
create policy leave_file_storage_insert on storage.objects for insert to authenticated
with check (bucket_id = 'company-leave-files' and app.leave_file_access(name, 'insert'));

create or replace function app.begin_leave_file(p_request uuid, p_name text, p_type text, p_size bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); request public.company_leave_requests; file_id uuid := gen_random_uuid(); path text;
begin
  if actor is null or p_size < 1 or p_size > 20971520 or length(btrim(p_name)) not between 1 and 200
    or p_name ~* '\.(exe|dll|bat|cmd|ps1|msi|com|scr|vbs|js|jar|sh)$' then
    raise exception '20MB 이하의 실행 파일이 아닌 서류만 올려 주세요.';
  end if;
  select * into request from public.company_leave_requests where id = p_request and employee_id = actor and kind = 'official' and status = 'pending';
  if not found then raise exception '본인의 대기 중인 공가 신청만 서류를 첨부할 수 있습니다.' using errcode = '42501'; end if;
  if exists(select 1 from public.company_leave_files where request_id = p_request and ready) then raise exception '공가 서류는 하나만 첨부할 수 있습니다.'; end if;
  path := request.company_id::text || '/' || request.id::text || '/' || file_id::text;
  insert into public.company_leave_files(id, company_id, request_id, file_name, mime_type, size_bytes, storage_path, uploaded_by)
  values(file_id, request.company_id, request.id, btrim(p_name), left(coalesce(p_type, ''), 200), p_size, path, actor);
  return jsonb_build_object('id', file_id, 'path', path);
end $$;

create or replace function app.finish_leave_file(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare file public.company_leave_files;
begin
  select * into file from public.company_leave_files where id = p_id and uploaded_by = auth.uid() and not ready;
  if not found then raise exception '첨부할 공가 서류를 찾지 못했습니다.' using errcode = '42501'; end if;
  if not exists(select 1 from storage.objects where bucket_id = 'company-leave-files' and name = file.storage_path) then
    raise exception '서류 파일이 저장소에 없습니다.';
  end if;
  update public.company_leave_files set ready = true where id = file.id;
end $$;

create or replace function app.remove_unfinished_leave_file(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.company_leave_files where id = p_id and uploaded_by = auth.uid() and not ready;
end $$;

revoke all on function app.begin_leave_file(uuid, text, text, bigint), app.finish_leave_file(uuid), app.remove_unfinished_leave_file(uuid) from public, anon;
grant execute on function app.begin_leave_file(uuid, text, text, bigint), app.finish_leave_file(uuid), app.remove_unfinished_leave_file(uuid) to authenticated;
create or replace function public.begin_leave_file(p_request uuid, p_name text, p_type text, p_size bigint) returns jsonb
language sql security invoker set search_path = '' as $$ select app.begin_leave_file(p_request, p_name, p_type, p_size); $$;
create or replace function public.finish_leave_file(p_id uuid) returns void
language sql security invoker set search_path = '' as $$ select app.finish_leave_file(p_id); $$;
create or replace function public.remove_unfinished_leave_file(p_id uuid) returns void
language sql security invoker set search_path = '' as $$ select app.remove_unfinished_leave_file(p_id); $$;
revoke all on function public.begin_leave_file(uuid, text, text, bigint), public.finish_leave_file(uuid), public.remove_unfinished_leave_file(uuid) from public, anon;
grant execute on function public.begin_leave_file(uuid, text, text, bigint), public.finish_leave_file(uuid), public.remove_unfinished_leave_file(uuid) to authenticated;
