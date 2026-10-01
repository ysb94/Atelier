-- 회사 공통 직책·직급 목록. 직원 값과 별개로 등록하고, 직원은 이 목록에서 고른다.
-- 직책(duty)은 profiles.position, 직급(grade)은 profiles.job_grade다.

alter table public.profiles
  add column if not exists job_grade text;

create table if not exists public.personnel_titles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  kind text not null,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint personnel_titles_kind_check check (kind in ('duty', 'grade')),
  constraint personnel_titles_name_check check (
    char_length(btrim(name)) between 1 and 30
  ),
  constraint personnel_titles_company_kind_name_key unique (company_id, kind, name)
);

create index if not exists personnel_titles_company_kind_idx
  on public.personnel_titles (company_id, kind, sort_order);

drop trigger if exists personnel_titles_set_updated_at on public.personnel_titles;
create trigger personnel_titles_set_updated_at
before update on public.personnel_titles
for each row execute function public.set_updated_at();

insert into public.personnel_titles (company_id, kind, name, sort_order)
values
  ('e0000000-0000-4000-8000-000000000001', 'duty', '이사', 1),
  ('e0000000-0000-4000-8000-000000000001', 'duty', '팀장', 2),
  ('e0000000-0000-4000-8000-000000000001', 'grade', '과장', 1),
  ('e0000000-0000-4000-8000-000000000001', 'grade', '대리', 2),
  ('e0000000-0000-4000-8000-000000000001', 'grade', '사원', 3)
on conflict (company_id, kind, name) do nothing;

update public.profiles
set job_grade = position,
    position = null
where position in ('사원', '대리', '과장');

alter table public.personnel_titles enable row level security;

grant select, insert, update, delete on public.personnel_titles to authenticated;

drop policy if exists personnel_titles_select_member on public.personnel_titles;
create policy personnel_titles_select_member
on public.personnel_titles
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles me
    where me.id = auth.uid()
      and me.status = 'active'
      and me.company_id = personnel_titles.company_id
  )
);

drop policy if exists personnel_titles_write_editor on public.personnel_titles;
create policy personnel_titles_write_editor
on public.personnel_titles
for all
to authenticated
using (
  app.can_edit_org_assignment()
  and company_id = (
    select me.company_id from public.profiles me where me.id = auth.uid()
  )
)
with check (
  app.can_edit_org_assignment()
  and company_id = (
    select me.company_id from public.profiles me where me.id = auth.uid()
  )
);

create or replace function public.rename_personnel_title(
  title_id uuid,
  new_name text
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  title public.personnel_titles;
  trimmed text := btrim(new_name);
begin
  if not app.can_edit_org_assignment() then
    raise exception '직책·직급은 개발자와 운영지원팀만 바꿀 수 있습니다.';
  end if;
  if trimmed = '' or char_length(trimmed) > 30 then
    raise exception '이름은 1자 이상 30자 이하로 입력하세요.';
  end if;

  select * into title
  from public.personnel_titles
  where id = title_id;
  if not found then
    raise exception '목록에서 찾을 수 없습니다.';
  end if;
  if title.name = trimmed then
    return;
  end if;

  update public.personnel_titles
  set name = trimmed
  where id = title_id;

  if title.kind = 'duty' then
    update public.profiles
    set position = trimmed
    where company_id = title.company_id
      and position = title.name;
  else
    update public.profiles
    set job_grade = trimmed
    where company_id = title.company_id
      and job_grade = title.name;
  end if;
end;
$function$;

create or replace function public.delete_personnel_title(title_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  title public.personnel_titles;
begin
  if not app.can_edit_org_assignment() then
    raise exception '직책·직급은 개발자와 운영지원팀만 바꿀 수 있습니다.';
  end if;

  select * into title
  from public.personnel_titles
  where id = title_id;
  if not found then
    raise exception '목록에서 찾을 수 없습니다.';
  end if;

  if title.kind = 'duty' and exists (
    select 1 from public.profiles p
    where p.company_id = title.company_id
      and p.position = title.name
  ) then
    raise exception '이 직책을 쓰는 직원이 있어 지울 수 없습니다.';
  end if;
  if title.kind = 'grade' and exists (
    select 1 from public.profiles p
    where p.company_id = title.company_id
      and p.job_grade = title.name
  ) then
    raise exception '이 직급을 쓰는 직원이 있어 지울 수 없습니다.';
  end if;

  delete from public.personnel_titles where id = title_id;
end;
$function$;

revoke all on function public.rename_personnel_title(uuid, text) from public, anon;
revoke all on function public.delete_personnel_title(uuid) from public, anon;
grant execute on function public.rename_personnel_title(uuid, text) to authenticated;
grant execute on function public.delete_personnel_title(uuid) to authenticated;

create or replace function app.guard_profile_changes()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  actor_is_admin boolean;
  actor_can_approve boolean;
begin
  if auth.uid() is null then
    return new;
  end if;

  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active' and p.is_admin = true
  ) into actor_is_admin;

  if new.department_id is distinct from old.department_id
     or new.position is distinct from old.position
     or new.job_grade is distinct from old.job_grade then
    if not app.can_edit_org_assignment() then
      raise exception '부서와 직책·직급은 개발자와 운영지원팀만 바꿀 수 있습니다.';
    end if;
  end if;

  if new.position is not null and not exists (
    select 1 from public.personnel_titles t
    where t.company_id = new.company_id
      and t.kind = 'duty'
      and t.name = new.position
  ) then
    raise exception '등록된 직책이 아닙니다.';
  end if;
  if new.job_grade is not null and not exists (
    select 1 from public.personnel_titles t
    where t.company_id = new.company_id
      and t.kind = 'grade'
      and t.name = new.job_grade
  ) then
    raise exception '등록된 직급이 아닙니다.';
  end if;

  if actor_is_admin then
    return new;
  end if;

  if auth.uid() = old.id then
    if new.status is distinct from old.status
       or new.is_admin is distinct from old.is_admin
       or new.approved_by is distinct from old.approved_by
       or new.approved_at is distinct from old.approved_at then
      raise exception '본인은 승인 상태나 관리자 권한을 바꿀 수 없습니다.';
    end if;
    if new.position is distinct from old.position
       or new.job_grade is distinct from old.job_grade then
      raise exception '본인은 직책·직급을 바꿀 수 없습니다.';
    end if;
    if old.status is distinct from 'pending'
       and new.department_id is distinct from old.department_id then
      raise exception '본인은 소속을 바꿀 수 없습니다.';
    end if;
    if old.name_confirmed_at is not null
       and new.name_confirmed_at is null then
      raise exception '본명 확인을 해제할 수 없습니다.';
    end if;
    if old.status = 'active' and old.name_confirmed_at is null then
      if new.display_name is distinct from old.display_name
         or new.name_confirmed_at is distinct from old.name_confirmed_at then
        if new.name_confirmed_at is null or new.display_name is null then
          raise exception '본명과 확인을 함께 저장해야 합니다.';
        end if;
      end if;
    elsif old.status = 'active' then
      if new.display_name is distinct from old.display_name
         or new.name_confirmed_at is distinct from old.name_confirmed_at then
        raise exception '본인은 확인한 본명을 바꿀 수 없습니다.';
      end if;
    end if;
    return new;
  end if;

  select app.can_approve(old.id) into actor_can_approve;
  if actor_can_approve then
    if new.is_admin is distinct from old.is_admin then
      raise exception '관리자 권한은 운영진만 지정할 수 있습니다.';
    end if;
    if old.name_confirmed_at is not null
       and new.name_confirmed_at is null then
      raise exception '본명 확인을 해제할 수 없습니다.';
    end if;
    return new;
  end if;

  if app.can_edit_org_assignment() then
    if new.status is distinct from old.status
       or new.is_admin is distinct from old.is_admin
       or new.approved_by is distinct from old.approved_by
       or new.approved_at is distinct from old.approved_at
       or new.display_name is distinct from old.display_name
       or new.name_confirmed_at is distinct from old.name_confirmed_at
       or new.email is distinct from old.email
       or new.company_id is distinct from old.company_id
       or new.avatar_url is distinct from old.avatar_url
       or new.request_note is distinct from old.request_note
       or new.requested_at is distinct from old.requested_at then
      raise exception '운영지원팀은 부서와 직책·직급만 바꿀 수 있습니다.';
    end if;
    return new;
  end if;

  raise exception '프로필을 수정할 권한이 없습니다.';
end;
$function$;

drop function if exists public.list_org_chart_members();

create function public.list_org_chart_members()
returns table (
  id uuid,
  display_name text,
  "position" text,
  job_grade text,
  department_id uuid
)
language sql
stable
security definer
set search_path to ''
as $function$
  select p.id, p.display_name, p.position, p.job_grade, p.department_id
  from public.profiles p
  where p.status = 'active'
    and exists (
      select 1
      from public.profiles me
      where me.id = auth.uid()
        and me.status = 'active'
    )
  order by p.display_name nulls last;
$function$;

revoke all on function public.list_org_chart_members() from public, anon;
grant execute on function public.list_org_chart_members() to authenticated;
