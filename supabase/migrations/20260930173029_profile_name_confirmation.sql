-- 본명은 Google 계정 이름을 복사하지 않고 사용자가 직접 입력한다.
-- 기존 활성 직원은 name_confirmed_at이 비어 있으므로 다음 로그인 때 한 번 확인한다.
-- CLI가 만든 시각이 같은 날의 이후 마이그레이션보다 앞섰다.
-- 인사 권한 가드를 덮어쓰지 않도록 파일 시각을 그 뒤로 둔다.

alter table public.profiles
  add column if not exists name_confirmed_at timestamptz;

alter table public.profiles
  drop constraint if exists profiles_display_name_format_check;

alter table public.profiles
  add constraint profiles_display_name_format_check
  check (
    display_name is null
    or (
      char_length(btrim(display_name)) between 2 and 50
      and btrim(display_name) ~ '^[[:alpha:]][[:alpha:][:space:]''’·.\-]*[[:alpha:].]$'
    )
  );

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
    null,
    new.raw_user_meta_data ->> 'avatar_url',
    'pending'
  )
  on conflict (id) do update
    set email = excluded.email,
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

  raise exception '프로필을 수정할 권한이 없습니다.';
end;
$function$;
