-- 입사일은 승인 때 넣고, 이후 수정은 조직도 담당자만 한다.
-- 기존 직원은 null(없음)로 둔다.

alter table public.profiles
  add column if not exists hire_date date;

alter table public.profiles
  drop constraint if exists profiles_hire_date_range;

alter table public.profiles
  add constraint profiles_hire_date_range
  check (hire_date is null or hire_date >= date '1950-01-01');

create or replace function app.guard_profile_changes()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  actor_is_admin boolean;
  actor_can_approve boolean;
  self_access_request boolean;
begin
  if auth.uid() is null then
    return new;
  end if;

  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active' and p.is_admin = true
  ) into actor_is_admin;

  self_access_request := auth.uid() = old.id
    and old.status in ('pending', 'rejected')
    and new.status = 'pending';

  if new.department_id is distinct from old.department_id
     or new.position is distinct from old.position
     or new.job_grade is distinct from old.job_grade then
    if not app.can_edit_org_assignment()
       and not (
         self_access_request
         and new.company_id = 'e0000000-0000-4000-8000-000000000001'::uuid
         and new.position is not distinct from old.position
         and new.job_grade is not distinct from old.job_grade
         and exists (
           select 1 from public.departments d
           where d.id = new.department_id
             and d.company_id = new.company_id
             and d.is_active = true
         )
       ) then
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

  if new.hire_date is distinct from old.hire_date then
    if not app.can_edit_org_assignment() and not app.can_approve(old.id) then
      raise exception '입사일은 승인 처리 또는 조직도에서만 바꿀 수 있습니다.';
    end if;
    if new.hire_date is not null and (
      new.hire_date < date '1950-01-01'
      or new.hire_date > (timezone('Asia/Seoul', now()))::date
    ) then
      raise exception '입사일은 1950-01-01부터 오늘까지 입력할 수 있습니다.';
    end if;
  end if;

  if actor_is_admin then
    return new;
  end if;

  if auth.uid() = old.id then
    if new.is_admin is distinct from old.is_admin
       or (
         (new.status is distinct from old.status
           or new.approved_by is distinct from old.approved_by
           or new.approved_at is distinct from old.approved_at)
         and not (
           old.status = 'rejected'
           and new.status = 'pending'
           and new.approved_by is null
           and new.approved_at is null
         )
       ) then
      raise exception '본인은 승인 상태나 관리자 권한을 바꿀 수 없습니다.';
    end if;
    if new.position is distinct from old.position
       or new.job_grade is distinct from old.job_grade then
      raise exception '본인은 직책·직급을 바꿀 수 없습니다.';
    end if;
    if new.department_id is distinct from old.department_id
       and not self_access_request then
      raise exception '본인은 소속을 바꿀 수 없습니다.';
    end if;
    if old.status in ('pending', 'rejected')
       and new.company_id is distinct from 'e0000000-0000-4000-8000-000000000001'::uuid then
      raise exception '신청 회사가 올바르지 않습니다.';
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
  department_id uuid,
  hire_date date
)
language sql
stable
security definer
set search_path to ''
as $function$
  select
    p.id,
    p.display_name,
    p.position,
    p.job_grade,
    p.department_id,
    case when app.can_edit_org_assignment() then p.hire_date else null end
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
