-- Masma Finder 전용 승인. Atelier profiles.status / can_read_brand는 넓히지 않는다.

create table if not exists public.masma_finder_users (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id),
  auth_user_id uuid unique references auth.users (id) on delete set null,
  email_normalized text not null,
  legacy_firebase_uid text,
  display_name text not null default '',
  photo_url text,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'revoked')),
  is_admin boolean not null default false,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, email_normalized)
);

create unique index if not exists masma_finder_users_legacy_uidx
  on public.masma_finder_users (brand_id, legacy_firebase_uid)
  where legacy_firebase_uid is not null;

create table if not exists public.masma_finder_access_audit (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id),
  finder_user_id uuid not null references public.masma_finder_users (id) on delete cascade,
  actor_finder_user_id uuid references public.masma_finder_users (id),
  action text not null,
  from_status text,
  to_status text,
  from_is_admin boolean,
  to_is_admin boolean,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists masma_finder_access_audit_user_idx
  on public.masma_finder_access_audit (brand_id, finder_user_id, created_at desc);

alter table public.masma_finder_users enable row level security;
alter table public.masma_finder_access_audit enable row level security;

grant select on public.masma_finder_users to authenticated;
grant select on public.masma_finder_access_audit to authenticated;

create or replace function app.current_masma_finder_user_id(target_brand_id uuid)
returns uuid
language sql
stable
security definer
set search_path to ''
as $$
  select u.id
  from public.masma_finder_users u
  where u.brand_id = target_brand_id
    and u.auth_user_id = auth.uid()
  limit 1;
$$;

create or replace function app.can_use_masma_finder(target_brand_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select
    app.is_admin()
    or exists (
      select 1
      from public.masma_finder_users u
      where u.brand_id = target_brand_id
        and u.auth_user_id = auth.uid()
        and u.status = 'active'
    );
$$;

create or replace function app.is_masma_finder_admin(target_brand_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select
    app.is_admin()
    or exists (
      select 1
      from public.masma_finder_users u
      where u.brand_id = target_brand_id
        and u.auth_user_id = auth.uid()
        and u.status = 'active'
        and u.is_admin = true
    );
$$;

create or replace function app.can_access_warehouse_finder(target_brand_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select app.can_read_brand(target_brand_id)
    or app.can_use_masma_finder(target_brand_id);
$$;

create or replace function app.assert_masma_finder_admin(target_brand_id uuid)
returns void
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  if target_brand_id is null then
    raise exception '브랜드를 지정하세요.';
  end if;
  if not app.is_masma_finder_admin(target_brand_id) then
    raise exception 'Finder 관리자 권한이 없습니다.';
  end if;
end;
$$;

drop policy if exists masma_finder_users_select on public.masma_finder_users;
create policy masma_finder_users_select
on public.masma_finder_users
for select
to authenticated
using (
  auth_user_id = auth.uid()
  or app.is_masma_finder_admin(brand_id)
);

drop policy if exists masma_finder_access_audit_select on public.masma_finder_access_audit;
create policy masma_finder_access_audit_select
on public.masma_finder_access_audit
for select
to authenticated
using (app.is_masma_finder_admin(brand_id));

create or replace function public.claim_masma_finder_session(p_brand_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_uid uuid := auth.uid();
  v_norm text;
  v_name text;
  v_avatar text;
  v_row public.masma_finder_users%rowtype;
begin
  if v_uid is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if p_brand_id is null then
    raise exception '브랜드를 지정하세요.';
  end if;

  select
    lower(btrim(coalesce(users.email, ''))),
    coalesce(
      users.raw_user_meta_data ->> 'full_name',
      users.raw_user_meta_data ->> 'name',
      split_part(coalesce(users.email, ''), '@', 1)
    ),
    users.raw_user_meta_data ->> 'avatar_url'
  into v_norm, v_name, v_avatar
  from auth.users as users
  where users.id = v_uid;

  if v_norm is null or v_norm = '' then
    raise exception '이메일 없는 계정은 Finder를 사용할 수 없습니다.';
  end if;

  update public.masma_finder_users
  set auth_user_id = null
  where auth_user_id = v_uid
    and email_normalized <> v_norm;

  select *
  into v_row
  from public.masma_finder_users
  where brand_id = p_brand_id
    and email_normalized = v_norm
  for update;

  if found then
    update public.masma_finder_users
    set
      auth_user_id = v_uid,
      display_name = case
        when btrim(display_name) = '' then v_name
        else display_name
      end,
      photo_url = coalesce(photo_url, v_avatar),
      last_login_at = now(),
      updated_at = now()
    where id = v_row.id
    returning * into v_row;
  else
    insert into public.masma_finder_users (
      brand_id,
      auth_user_id,
      email_normalized,
      display_name,
      photo_url,
      status
    ) values (
      p_brand_id,
      v_uid,
      v_norm,
      v_name,
      v_avatar,
      'pending'
    )
    returning * into v_row;
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'brandId', v_row.brand_id,
    'email', v_row.email_normalized,
    'displayName', v_row.display_name,
    'photoUrl', v_row.photo_url,
    'status', v_row.status,
    'isAdmin', v_row.is_admin,
    'legacyFirebaseUid', v_row.legacy_firebase_uid
  );
end;
$$;

create or replace function public.list_masma_finder_users(p_brand_id uuid)
returns table (
  id uuid,
  email text,
  display_name text,
  status text,
  is_admin boolean,
  last_login_at timestamptz,
  created_at timestamptz,
  legacy_firebase_uid text
)
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  perform app.assert_masma_finder_admin(p_brand_id);
  return query
  select
    users.id,
    users.email_normalized,
    users.display_name,
    users.status,
    users.is_admin,
    users.last_login_at,
    users.created_at,
    users.legacy_firebase_uid
  from public.masma_finder_users as users
  where users.brand_id = p_brand_id
  order by users.email_normalized;
end;
$$;

create or replace function public.set_masma_finder_user_status(
  p_brand_id uuid,
  p_user_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_actor uuid;
  v_from public.masma_finder_users%rowtype;
  v_to public.masma_finder_users%rowtype;
begin
  perform app.assert_masma_finder_admin(p_brand_id);
  if p_status not in ('pending', 'active', 'revoked') then
    raise exception '지원하지 않는 상태입니다.';
  end if;

  v_actor := app.current_masma_finder_user_id(p_brand_id);

  select * into v_from
  from public.masma_finder_users
  where id = p_user_id
    and brand_id = p_brand_id
  for update;
  if not found then
    raise exception '사용자를 찾을 수 없습니다.';
  end if;

  update public.masma_finder_users
  set
    status = p_status,
    updated_at = now()
  where id = p_user_id
  returning * into v_to;

  insert into public.masma_finder_access_audit (
    brand_id,
    finder_user_id,
    actor_finder_user_id,
    action,
    from_status,
    to_status,
    from_is_admin,
    to_is_admin
  ) values (
    p_brand_id,
    p_user_id,
    v_actor,
    'set_status',
    v_from.status,
    v_to.status,
    v_from.is_admin,
    v_to.is_admin
  );

  return jsonb_build_object(
    'id', v_to.id,
    'status', v_to.status,
    'isAdmin', v_to.is_admin
  );
end;
$$;

revoke all on function app.current_masma_finder_user_id(uuid) from public, anon;
revoke all on function app.can_use_masma_finder(uuid) from public, anon;
revoke all on function app.is_masma_finder_admin(uuid) from public, anon;
revoke all on function app.can_access_warehouse_finder(uuid) from public, anon;
revoke all on function app.assert_masma_finder_admin(uuid) from public, anon;
revoke all on function public.claim_masma_finder_session(uuid) from public, anon;
revoke all on function public.list_masma_finder_users(uuid) from public, anon;
revoke all on function public.set_masma_finder_user_status(uuid, uuid, text) from public, anon;

grant execute on function app.current_masma_finder_user_id(uuid) to authenticated;
grant execute on function app.can_use_masma_finder(uuid) to authenticated;
grant execute on function app.is_masma_finder_admin(uuid) to authenticated;
grant execute on function app.can_access_warehouse_finder(uuid) to authenticated;
grant execute on function public.claim_masma_finder_session(uuid) to authenticated;
grant execute on function public.list_masma_finder_users(uuid) to authenticated;
grant execute on function public.set_masma_finder_user_status(uuid, uuid, text) to authenticated;
