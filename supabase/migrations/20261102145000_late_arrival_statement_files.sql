-- 지각 사유서 상세 사유에 지연 증명 등 서류를 첨부한다.
-- 사유서 본문 권한은 바꾸지 않고, 완료된 첨부만 같은 범위에서 받게 한다.

create table public.late_arrival_statement_files (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  statement_id uuid not null references public.late_arrival_statements(id) on delete cascade,
  file_name text not null check (char_length(btrim(file_name)) between 1 and 200),
  mime_type text not null default '',
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 20971520),
  storage_path text not null unique,
  uploaded_by uuid not null references public.profiles(id),
  ready boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.late_arrival_statement_files is '지각 사유서 상세 사유에 첨부한 서류. 저장이 끝난 파일만 사유서와 같은 범위에서 본다.';

create index late_arrival_statement_files_statement on public.late_arrival_statement_files(statement_id);
alter table public.late_arrival_statement_files enable row level security;
revoke all on public.late_arrival_statement_files from public, anon, authenticated;
grant select on public.late_arrival_statement_files to authenticated;

create function app.can_read_late_statement(p_statement uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.late_arrival_statements s
    where s.id = p_statement
      and (
        s.employee_id = (select auth.uid())
        or (
          s.company_id = (select company_id from public.profiles where id = (select auth.uid()) and status = 'active')
          and (
            (select app.can_edit_org_assignment())
            or s.company_id = (select app.company_review_company_id())
          )
        )
      )
  );
$$;

revoke all on function app.can_read_late_statement(uuid) from public, anon;
grant execute on function app.can_read_late_statement(uuid) to authenticated;

create policy late_statement_files_read on public.late_arrival_statement_files
for select to authenticated
using (
  (ready or uploaded_by = (select auth.uid()))
  and app.can_read_late_statement(statement_id)
);

insert into storage.buckets(id, name, public, file_size_limit)
values ('company-late-statements', 'company-late-statements', false, 20971520)
on conflict (id) do nothing;

create function app.late_statement_file_access(p_path text, p_action text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.late_arrival_statement_files f
    join public.late_arrival_statements s on s.id = f.statement_id
    where f.storage_path = p_path
      and case p_action
        when 'read' then f.ready and app.can_read_late_statement(s.id)
        when 'insert' then not f.ready
          and f.uploaded_by = (select auth.uid())
          and s.employee_id = (select auth.uid())
          and s.work_date = (pg_catalog.clock_timestamp() at time zone 'Asia/Seoul')::date
        when 'delete' then f.uploaded_by = (select auth.uid())
          and s.employee_id = (select auth.uid())
          and s.work_date = (pg_catalog.clock_timestamp() at time zone 'Asia/Seoul')::date
        else false
      end
  );
$$;

revoke all on function app.late_statement_file_access(text, text) from public, anon;
grant execute on function app.late_statement_file_access(text, text) to authenticated;

create policy late_statement_file_storage_read on storage.objects
for select to authenticated
using (bucket_id = 'company-late-statements' and app.late_statement_file_access(name, 'read'));

create policy late_statement_file_storage_insert on storage.objects
for insert to authenticated
with check (bucket_id = 'company-late-statements' and app.late_statement_file_access(name, 'insert'));

create policy late_statement_file_storage_delete on storage.objects
for delete to authenticated
using (bucket_id = 'company-late-statements' and app.late_statement_file_access(name, 'delete'));

create function app.begin_late_statement_file(p_statement uuid, p_name text, p_type text, p_size bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  statement public.late_arrival_statements%rowtype;
  file_id uuid := gen_random_uuid();
  path text;
  ready_count bigint;
begin
  if actor is null
    or p_size < 1
    or p_size > 20971520
    or char_length(btrim(coalesce(p_name, ''))) not between 1 and 200
    or p_name ~* '\.(exe|dll|bat|cmd|ps1|msi|com|scr|vbs|js|jar|sh)$' then
    raise exception '20MB 이하의 실행 파일이 아닌 서류만 올려 주세요.';
  end if;
  select * into statement
  from public.late_arrival_statements
  where id = p_statement and employee_id = actor
  for update;
  if statement.id is null then
    raise exception '본인의 지각 사유서에만 첨부할 수 있습니다.' using errcode = '42501';
  end if;
  if statement.work_date <> (pg_catalog.clock_timestamp() at time zone 'Asia/Seoul')::date then
    raise exception '오늘 사유서에만 첨부할 수 있습니다.';
  end if;
  delete from public.late_arrival_statement_files
  where statement_id = statement.id and uploaded_by = actor and not ready;
  select count(*) into ready_count
  from public.late_arrival_statement_files
  where statement_id = statement.id and ready;
  if ready_count >= 5 then
    raise exception '첨부파일은 5개까지 올릴 수 있습니다.';
  end if;
  path := 'companies/' || statement.company_id::text || '/late-statements/' || statement.id::text || '/' || file_id::text;
  insert into public.late_arrival_statement_files(
    id, company_id, statement_id, file_name, mime_type, size_bytes, storage_path, uploaded_by
  ) values (
    file_id, statement.company_id, statement.id, btrim(p_name), left(coalesce(p_type, ''), 200), p_size, path, actor
  );
  return jsonb_build_object('id', file_id, 'path', path);
end;
$$;

create function app.finish_late_statement_file(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  file public.late_arrival_statement_files%rowtype;
begin
  select * into file
  from public.late_arrival_statement_files
  where id = p_id and uploaded_by = auth.uid() and not ready;
  if file.id is null then
    raise exception '첨부할 서류를 찾지 못했습니다.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'company-late-statements'
      and name = file.storage_path
      and coalesce((metadata->>'size')::bigint, 0) = file.size_bytes
  ) then
    raise exception '첨부파일이 저장소에 없습니다.';
  end if;
  update public.late_arrival_statement_files set ready = true where id = file.id;
end;
$$;

create function app.remove_my_late_statement_file(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  file public.late_arrival_statement_files%rowtype;
  statement public.late_arrival_statements%rowtype;
begin
  select * into file from public.late_arrival_statement_files where id = p_id and uploaded_by = actor;
  if file.id is null then
    raise exception '첨부파일을 찾지 못했습니다.' using errcode = '42501';
  end if;
  select * into statement from public.late_arrival_statements where id = file.statement_id and employee_id = actor;
  if statement.id is null
    or statement.work_date <> (pg_catalog.clock_timestamp() at time zone 'Asia/Seoul')::date then
    raise exception '오늘 사유서의 첨부만 뺄 수 있습니다.' using errcode = '42501';
  end if;
  delete from public.late_arrival_statement_files where id = file.id;
  return file.storage_path;
end;
$$;

revoke all on function app.begin_late_statement_file(uuid, text, text, bigint) from public, anon;
revoke all on function app.finish_late_statement_file(uuid) from public, anon;
revoke all on function app.remove_my_late_statement_file(uuid) from public, anon;
grant execute on function app.begin_late_statement_file(uuid, text, text, bigint) to authenticated;
grant execute on function app.finish_late_statement_file(uuid) to authenticated;
grant execute on function app.remove_my_late_statement_file(uuid) to authenticated;

create function public.begin_late_statement_file(p_statement uuid, p_name text, p_type text, p_size bigint)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app.begin_late_statement_file(p_statement, p_name, p_type, p_size);
$$;

create function public.finish_late_statement_file(p_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  select app.finish_late_statement_file(p_id);
$$;

create function public.remove_my_late_statement_file(p_id uuid)
returns text
language sql
security invoker
set search_path = ''
as $$
  select app.remove_my_late_statement_file(p_id);
$$;

revoke all on function public.begin_late_statement_file(uuid, text, text, bigint) from public, anon;
revoke all on function public.finish_late_statement_file(uuid) from public, anon;
revoke all on function public.remove_my_late_statement_file(uuid) from public, anon;
grant execute on function public.begin_late_statement_file(uuid, text, text, bigint) to authenticated;
grant execute on function public.finish_late_statement_file(uuid) to authenticated;
grant execute on function public.remove_my_late_statement_file(uuid) to authenticated;
