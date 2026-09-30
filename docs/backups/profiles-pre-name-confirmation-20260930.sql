-- 본명 직접 입력·1회 확인을 넣기 직전의 함수·정책 정의.
-- 되돌릴 때는 이 정의를 역방향 마이그레이션으로 적용한다.
-- profiles.name_confirmed_at 컬럼과 이름 형식 제약은 남겨 둬도
-- 이 함수 정의만으로는 확인을 강제하지 않는다.
-- 조회일: 2026-09-30. 대상: Atelier (pmzgdqvtzwfwqmvhzcyo).
-- 기존 프로필 행 스냅샷은 profiles-pre-position-governance-20260930.xlsx를 재사용한다.
-- 이름 값은 이번 변경에서 바꾸지 않으므로 새 개인정보 파일은 만들지 않는다.

create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  insert into public.profiles (id, email, display_name, avatar_url, status)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(coalesce(new.email, ''), '@', 1)
    ),
    new.raw_user_meta_data ->> 'avatar_url',
    'pending'
  )
  on conflict (id) do update
    set email = excluded.email,
        display_name = coalesce(public.profiles.display_name, excluded.display_name),
        avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url);
  return new;
end;
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

drop policy if exists profiles_select_self_or_approver on public.profiles;
create policy profiles_select_self_or_approver on public.profiles for select to authenticated
using ((id = auth.uid()) or app.can_view_members());

drop policy if exists profiles_update_self_or_approver on public.profiles;
create policy profiles_update_self_or_approver on public.profiles for update to authenticated
using ((id = auth.uid()) or app.is_admin() or app.can_approve(id))
with check ((id = auth.uid()) or app.is_admin() or app.can_approve(id));
