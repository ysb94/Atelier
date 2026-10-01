-- 조직도의 부서·직책·직급은 개발자 계정과 운영지원팀 소속만 바꾼다.
-- 다른 관리자는 승인·권한은 그대로 두되 이 두 칸은 바꾸지 못한다.

create or replace function app.can_edit_org_assignment()
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    select 1
    from public.profiles p
    left join public.departments d on d.id = p.department_id
    where p.id = auth.uid()
      and p.status = 'active'
      and (
        lower(p.email) = 'dev@atelier.local'
        or (d.is_active and d.name = '운영지원팀')
      )
  );
$function$;

revoke all on function app.can_edit_org_assignment() from public, anon;
grant execute on function app.can_edit_org_assignment() to authenticated;

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
     or new.position is distinct from old.position then
    if not app.can_edit_org_assignment() then
      raise exception '부서와 직책·직급은 개발자와 운영지원팀만 바꿀 수 있습니다.';
    end if;
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
    if new.position is distinct from old.position then
      raise exception '본인은 직책을 바꿀 수 없습니다.';
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

drop policy if exists profiles_update_self_or_approver on public.profiles;
create policy profiles_update_self_or_approver
on public.profiles
for update
to authenticated
using (
  id = auth.uid()
  or app.is_admin()
  or app.can_approve(id)
  or app.can_edit_org_assignment()
)
with check (
  id = auth.uid()
  or app.is_admin()
  or app.can_approve(id)
  or app.can_edit_org_assignment()
);
