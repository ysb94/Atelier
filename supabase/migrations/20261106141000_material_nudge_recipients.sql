-- 자재요청 조르기 알림을 받을 재직 직원. 기획 업무 권한만 보고 바꿀 수 있다.
create table public.material_nudge_recipients (
  company_id uuid not null,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (company_id, profile_id),
  constraint material_nudge_recipients_company check (company_id = 'e0000000-0000-4000-8000-000000000001')
);
comment on table public.material_nudge_recipients is '자재요청 조르기 알림을 받을 직원. 이름은 프로필을 따른다.';

alter table public.material_nudge_recipients enable row level security;
create policy material_nudge_recipients_select on public.material_nudge_recipients
  for select to authenticated
  using (company_id = app.permission_company_id() and app.basic_work_allowed('planning'));
revoke all on table public.material_nudge_recipients from public, anon;
grant select on table public.material_nudge_recipients to authenticated;

create function app.save_material_nudge_recipients(p_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.permission_company_id();
  v_count integer;
begin
  if auth.uid() is null or v_company is null or not app.basic_work_allowed('planning') then
    raise exception '자재요청 조르기 대상을 바꿀 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_ids is null then
    raise exception '알림 받을 사람을 확인해 주세요.' using errcode = '22023';
  end if;
  select count(*) into v_count from (select distinct id from unnest(p_ids) id) people;
  if v_count > 10 then
    raise exception '알림 받을 사람은 10명까지 지정할 수 있습니다.' using errcode = '22023';
  end if;
  if v_count <> (
    select count(*) from public.profiles p
    where p.id in (select distinct id from unnest(p_ids) id)
      and p.status = 'active' and p.company_id = v_company
  ) then
    raise exception '재직 중인 직원만 지정할 수 있습니다.' using errcode = '42501';
  end if;
  delete from public.material_nudge_recipients
  where company_id = v_company and not (profile_id in (select distinct id from unnest(p_ids) id));
  insert into public.material_nudge_recipients (company_id, profile_id)
  select v_company, id from (select distinct id from unnest(p_ids) id) people
  on conflict do nothing;
end;
$$;
revoke all on function app.save_material_nudge_recipients(uuid[]) from public, anon, authenticated;

create function public.save_material_nudge_recipients(p_ids uuid[]) returns void
language sql security invoker set search_path = '' as $$
  select app.save_material_nudge_recipients(p_ids)
$$;
revoke all on function public.save_material_nudge_recipients(uuid[]) from public, anon;
grant execute on function public.save_material_nudge_recipients(uuid[]) to authenticated;
