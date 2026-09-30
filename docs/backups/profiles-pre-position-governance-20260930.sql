-- 직책·소속 변경 권한을 운영지원팀으로 좁히기 직전의 함수·정책 정의.
-- 되돌릴 때는 이 정의를 역방향 마이그레이션으로 적용한다.
-- departments.personnel_scope 컬럼은 남겨 둬도 이 정의의 동작에 영향이 없다.
-- 조회일: 2026-09-30. 대상: Atelier (pmzgdqvtzwfwqmvhzcyo).

create or replace function app.can_approve(target_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select app.is_admin() or app.is_company_manager();
$function$;

create or replace function app.is_company_manager()
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and p.position in ('팀장', '이사')
  );
$function$;

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

  -- 본인 수정: status / is_admin / approved_* 는 못 바꾼다.
  if auth.uid() = old.id then
    if new.status is distinct from old.status
       or new.is_admin is distinct from old.is_admin
       or new.approved_by is distinct from old.approved_by
       or new.approved_at is distinct from old.approved_at then
      raise exception '본인은 승인 상태나 관리자 권한을 바꿀 수 없습니다.';
    end if;
    return new;
  end if;

  -- 승인 가능한 팀장: status / 표시 정보 / 부서 / 직책까지. is_admin은 못 건드린다.
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

drop function if exists app.can_manage_personnel();
drop function if exists app.can_view_members();

drop policy if exists profile_capabilities_delete on public.profile_capabilities;
create policy profile_capabilities_delete on public.profile_capabilities for delete to authenticated
using ((app.is_admin() or app.can_approve(profile_id) or ((profile_id = auth.uid()) and (coalesce(app.profile_status(), 'pending'::text) = 'pending'::text))));

drop policy if exists profile_capabilities_insert on public.profile_capabilities;
create policy profile_capabilities_insert on public.profile_capabilities for insert to authenticated
with check ((app.is_admin() or app.can_approve(profile_id) or ((profile_id = auth.uid()) and (coalesce(app.profile_status(), 'pending'::text) = 'pending'::text))));

drop policy if exists profile_capabilities_select on public.profile_capabilities;
create policy profile_capabilities_select on public.profile_capabilities for select to authenticated
using (((profile_id = auth.uid()) or app.is_admin() or app.can_approve(profile_id)));

drop policy if exists profiles_select_self_or_approver on public.profiles;
create policy profiles_select_self_or_approver on public.profiles for select to authenticated
using (((id = auth.uid()) or app.is_admin() or app.can_approve(id)));

drop policy if exists profiles_update_self_or_approver on public.profiles;
create policy profiles_update_self_or_approver on public.profiles for update to authenticated
using (((id = auth.uid()) or app.is_admin() or app.can_approve(id)))
with check (((id = auth.uid()) or app.is_admin() or app.can_approve(id)));
