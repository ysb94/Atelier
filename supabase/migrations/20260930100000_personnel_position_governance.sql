-- 가입 직책은 승인자가 정하고, 직책·소속 변경은 운영지원팀과 관리자만 한다.
-- 운영지원팀 안에서 누가 권한을 갖는지는 departments.personnel_scope로 고른다.
-- leaders: 그 부서의 팀장·이사. members: 그 부서 소속 전원. null: 권한 없음.

alter table public.departments
  add column if not exists personnel_scope text;

alter table public.departments
  drop constraint if exists departments_personnel_scope_check;

alter table public.departments
  add constraint departments_personnel_scope_check
  check (personnel_scope in ('leaders', 'members'));

update public.departments
set personnel_scope = 'leaders'
where company_id = 'e0000000-0000-4000-8000-000000000001'
  and name = '운영지원팀'
  and personnel_scope is null;

create or replace function app.can_manage_personnel()
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select
    app.is_admin()
    or exists (
      select 1
      from public.profiles p
      join public.departments d on d.id = p.department_id
      where p.id = auth.uid()
        and p.status = 'active'
        and d.is_active
        and (
          d.personnel_scope = 'members'
          or (
            d.personnel_scope = 'leaders'
            and p.position in ('팀장', '이사')
          )
        )
    );
$function$;

revoke all on function app.can_manage_personnel() from public, anon;
grant execute on function app.can_manage_personnel() to authenticated;

create or replace function app.can_view_members()
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select app.is_admin() or app.is_company_manager() or app.can_manage_personnel();
$function$;

revoke all on function app.can_view_members() from public, anon;
grant execute on function app.can_view_members() to authenticated;

create or replace function app.can_approve(target_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select app.can_manage_personnel();
$function$;

drop policy if exists profiles_select_self_or_approver on public.profiles;
create policy profiles_select_self_or_approver
on public.profiles
for select
to authenticated
using (
  id = auth.uid()
  or app.can_view_members()
);

drop policy if exists profile_capabilities_select on public.profile_capabilities;
create policy profile_capabilities_select
on public.profile_capabilities
for select
to authenticated
using (
  profile_id = auth.uid()
  or app.can_view_members()
);

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
  -- 서비스 역할/트리거 내부는 그대로 통과
  if auth.uid() is null then
    return new;
  end if;

  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active' and p.is_admin = true
  ) into actor_is_admin;

  if actor_is_admin then
    return new;
  end if;

  -- 본인 수정: 승인 상태·관리자 권한·직책은 못 바꾼다.
  -- 소속은 승인 대기 중에만 바꿀 수 있다.
  if auth.uid() = old.id then
    if new.status is distinct from old.status
       or new.is_admin is distinct from old.is_admin
       or new.approved_by is distinct from old.approved_by
       or new.approved_at is distinct from old.approved_at then
      raise exception '본인은 승인 상태나 관리자 권한을 바꿀 수 없습니다.';
    end if;
    if new.position is distinct from old.position then
      raise exception '본인은 직책을 바꿀 수 없습니다.';
    end if;
    if old.status is distinct from 'pending'
       and new.department_id is distinct from old.department_id then
      raise exception '본인은 소속을 바꿀 수 없습니다.';
    end if;
    return new;
  end if;

  -- 인사 담당: 상태·표시 정보·부서·직책까지. is_admin은 못 건드린다.
  select app.can_approve(old.id) into actor_can_approve;
  if actor_can_approve then
    if new.is_admin is distinct from old.is_admin then
      raise exception '관리자 권한은 운영진만 지정할 수 있습니다.';
    end if;
    return new;
  end if;

  raise exception '프로필을 수정할 권한이 없습니다.';
end;
$function$;
