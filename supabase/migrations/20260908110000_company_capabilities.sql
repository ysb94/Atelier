-- E&J 회사 소속·업무 역량. 브랜드 멤버십은 입장 조건에서 뺀다.

alter table public.profiles
  add column if not exists company_id uuid references public.companies(id);

update public.profiles
set company_id = 'e0000000-0000-4000-8000-000000000001'
where company_id is null;

create table if not exists public.profile_capabilities (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  capability text not null
    check (capability in ('planning', 'design', 'md', 'logistics', 'data')),
  created_at timestamptz not null default now(),
  primary key (profile_id, capability)
);

alter table public.profile_capabilities enable row level security;

grant select, insert, delete, update on public.profile_capabilities to authenticated;

drop policy if exists profile_capabilities_select on public.profile_capabilities;
create policy profile_capabilities_select
on public.profile_capabilities
for select
to authenticated
using (
  profile_id = auth.uid()
  or app.is_admin()
  or app.can_approve(profile_id)
);

drop policy if exists profile_capabilities_insert on public.profile_capabilities;
create policy profile_capabilities_insert
on public.profile_capabilities
for insert
to authenticated
with check (
  app.is_admin()
  or app.can_approve(profile_id)
  or (
    profile_id = auth.uid()
    and coalesce(app.profile_status(), 'pending') = 'pending'
  )
);

drop policy if exists profile_capabilities_delete on public.profile_capabilities;
create policy profile_capabilities_delete
on public.profile_capabilities
for delete
to authenticated
using (
  app.is_admin()
  or app.can_approve(profile_id)
  or (
    profile_id = auth.uid()
    and coalesce(app.profile_status(), 'pending') = 'pending'
  )
);

create or replace function app.has_capability(target_capability text)
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
      from public.profile_capabilities pc
      join public.profiles p on p.id = pc.profile_id
      where pc.profile_id = auth.uid()
        and pc.capability = target_capability
        and p.status = 'active'
    );
$function$;

create or replace function app.has_any_capability()
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
      from public.profile_capabilities pc
      join public.profiles p on p.id = pc.profile_id
      where pc.profile_id = auth.uid()
        and p.status = 'active'
    );
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

create or replace function app.can_read_brand(target_brand_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select app.is_admin() or app.is_approved();
$function$;

create or replace function app.can_edit_brand(target_brand_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select app.is_admin() or (app.is_approved() and app.has_any_capability());
$function$;

create or replace function app.can_approve(target_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select app.is_admin() or app.is_company_manager();
$function$;

insert into public.profile_capabilities (profile_id, capability)
select p.id, inferred.capability
from public.profiles p
left join public.departments d on d.id = p.department_id
cross join lateral (
  select case
    when d.name ilike '%기획%' then 'planning'
    when d.name ilike '%visual%'
      or d.name ilike '%디자인%'
      or d.name ilike '%비주얼%' then 'design'
    when d.name ilike '%md%' then 'md'
    when d.name ilike '%물류%' then 'logistics'
    when d.name ilike '%데이터%' then 'data'
    else null
  end as capability
) inferred
where p.status = 'active'
  and inferred.capability is not null
on conflict do nothing;
