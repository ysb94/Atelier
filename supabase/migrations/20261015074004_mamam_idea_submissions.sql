-- Temporary Mamam idea contest storage.
-- The public site may submit without signing in, but it cannot read, update,
-- or delete submissions or uploaded images.

create schema if not exists mamam_private;
revoke all on schema mamam_private from public;

create table public.mamam_idea_submissions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  submitter_name text not null,
  department text not null,
  description text not null,
  image_paths text[] not null default array[]::text[],
  status text not null default 'uploading',
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  constraint mamam_idea_submissions_name_check
    check (char_length(btrim(submitter_name)) between 1 and 40),
  constraint mamam_idea_submissions_department_check
    check (char_length(btrim(department)) between 1 and 40),
  constraint mamam_idea_submissions_description_check
    check (char_length(btrim(description)) between 5 and 4000),
  constraint mamam_idea_submissions_image_count_check
    check (cardinality(image_paths) <= 5),
  constraint mamam_idea_submissions_status_check
    check (status in ('uploading', 'submitted')),
  constraint mamam_idea_submissions_completion_check
    check (
      (status = 'uploading' and submitted_at is null)
      or (status = 'submitted' and submitted_at is not null)
    )
);

comment on table public.mamam_idea_submissions is
  'Temporary Mamam idea contest submissions. Remove with the dedicated Mamam site and image bucket after export.';
comment on column public.mamam_idea_submissions.image_paths is
  'Private storage object paths in the mamam-idea-images bucket.';

create index mamam_idea_submissions_company_created_idx
  on public.mamam_idea_submissions (company_id, created_at desc)
  where status = 'submitted';

alter table public.mamam_idea_submissions enable row level security;
revoke all on table public.mamam_idea_submissions from public, anon, authenticated;
grant all on table public.mamam_idea_submissions to service_role;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'mamam-idea-images',
  'mamam-idea-images',
  false,
  2097152,
  array['image/jpeg']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function mamam_private.begin_idea_submission(
  p_name text,
  p_department text,
  p_description text,
  p_website text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_company_id uuid;
  v_submission_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_department text := btrim(coalesce(p_department, ''));
  v_description text := btrim(coalesce(p_description, ''));
begin
  if nullif(btrim(coalesce(p_website, '')), '') is not null then
    raise exception using
      errcode = '22023',
      message = '요청을 처리할 수 없습니다.';
  end if;

  if char_length(v_name) not between 1 and 40 then
    raise exception using errcode = '22023', message = '이름은 1~40자로 입력해 주세요.';
  end if;
  if char_length(v_department) not between 1 and 40 then
    raise exception using errcode = '22023', message = '부서는 1~40자로 입력해 주세요.';
  end if;
  if char_length(v_description) not between 5 and 4000 then
    raise exception using errcode = '22023', message = '설명은 5~4000자로 입력해 주세요.';
  end if;

  select b.company_id
  into v_company_id
  from public.brands b
  where b.slug = 'masmarulez';

  if v_company_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'Mamam 접수 회사를 찾을 수 없습니다.';
  end if;

  insert into public.mamam_idea_submissions (
    company_id,
    submitter_name,
    department,
    description
  )
  values (
    v_company_id,
    v_name,
    v_department,
    v_description
  )
  returning id into v_submission_id;

  return v_submission_id;
end;
$function$;

create or replace function mamam_private.can_upload_idea_image(
  p_object_name text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    p_object_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]jpg$'
    and exists (
      select 1
      from public.mamam_idea_submissions submission
      where submission.id::text = split_part(p_object_name, '/', 1)
        and submission.status = 'uploading'
        and submission.created_at >= now() - interval '1 hour'
    );
$function$;

create or replace function mamam_private.complete_idea_submission(
  p_submission_id uuid,
  p_image_paths text[] default array[]::text[]
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_paths text[] := coalesce(p_image_paths, array[]::text[]);
  v_path text;
  v_expected_prefix text := p_submission_id::text || '/';
  v_path_count integer := cardinality(v_paths);
  v_distinct_count integer;
  v_uploaded_count integer;
begin
  if not exists (
    select 1
    from public.mamam_idea_submissions submission
    where submission.id = p_submission_id
      and submission.status = 'uploading'
      and submission.created_at >= now() - interval '1 hour'
  ) then
    raise exception using
      errcode = 'P0001',
      message = '완료할 수 있는 접수 건을 찾을 수 없습니다.';
  end if;

  if v_path_count > 5 then
    raise exception using errcode = '22023', message = '이미지는 최대 5장입니다.';
  end if;

  select count(*)
  into v_distinct_count
  from (select distinct path from unnest(v_paths) as path) unique_paths;

  if v_distinct_count <> v_path_count then
    raise exception using errcode = '22023', message = '중복된 이미지 경로가 있습니다.';
  end if;

  foreach v_path in array v_paths loop
    if v_path !~ (
      '^'
      || replace(v_expected_prefix, '-', '[-]')
      || '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]jpg$'
    ) then
      raise exception using errcode = '22023', message = '잘못된 이미지 경로입니다.';
    end if;
  end loop;

  select count(*)
  into v_uploaded_count
  from storage.objects object
  where object.bucket_id = 'mamam-idea-images'
    and object.name = any(v_paths);

  if v_uploaded_count <> v_path_count then
    raise exception using errcode = '22023', message = '업로드되지 않은 이미지가 있습니다.';
  end if;

  update public.mamam_idea_submissions
  set
    image_paths = v_paths,
    status = 'submitted',
    submitted_at = now()
  where id = p_submission_id
    and status = 'uploading';

  if not found then
    raise exception using errcode = 'P0001', message = '이미 완료된 접수입니다.';
  end if;

  return p_submission_id;
end;
$function$;

revoke all on function mamam_private.begin_idea_submission(text, text, text, text)
  from public, anon, authenticated;
revoke all on function mamam_private.can_upload_idea_image(text)
  from public, anon, authenticated;
revoke all on function mamam_private.complete_idea_submission(uuid, text[])
  from public, anon, authenticated;
grant usage on schema mamam_private to anon, service_role;
grant execute on function mamam_private.begin_idea_submission(text, text, text, text)
  to anon, service_role;
grant execute on function mamam_private.can_upload_idea_image(text)
  to anon, service_role;
grant execute on function mamam_private.complete_idea_submission(uuid, text[])
  to anon, service_role;

create or replace function public.begin_mamam_idea_submission(
  p_name text,
  p_department text,
  p_description text,
  p_website text default null
)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $function$
  select mamam_private.begin_idea_submission(
    p_name,
    p_department,
    p_description,
    p_website
  );
$function$;

create or replace function public.complete_mamam_idea_submission(
  p_submission_id uuid,
  p_image_paths text[] default array[]::text[]
)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $function$
  select mamam_private.complete_idea_submission(
    p_submission_id,
    p_image_paths
  );
$function$;

revoke all on function public.begin_mamam_idea_submission(text, text, text, text)
  from public, authenticated;
revoke all on function public.complete_mamam_idea_submission(uuid, text[])
  from public, authenticated;
grant execute on function public.begin_mamam_idea_submission(text, text, text, text)
  to anon, service_role;
grant execute on function public.complete_mamam_idea_submission(uuid, text[])
  to anon, service_role;

drop policy if exists mamam_idea_images_insert on storage.objects;
create policy mamam_idea_images_insert
on storage.objects
for insert
to anon
with check (
  bucket_id = 'mamam-idea-images'
  and mamam_private.can_upload_idea_image(name)
);
