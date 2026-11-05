-- 중국팀 작업지시서 담당자 탭. 재직 중인 중국팀 직원만 추가하고, 순번만 바꾼다.
create table public.china_work_assignees (
  company_id uuid not null,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  primary key (company_id, profile_id),
  constraint china_work_assignees_company check (company_id = 'e0000000-0000-4000-8000-000000000001')
);
comment on table public.china_work_assignees is '중국팀 작업지시서에 표시할 담당자. 이름은 프로필을 따른다.';
create index china_work_assignees_order_idx on public.china_work_assignees (company_id, sort_order, created_at);

create function app.guard_china_work_assignee() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.company_id is distinct from old.company_id or new.profile_id is distinct from old.profile_id or new.created_at is distinct from old.created_at) then
    raise exception '담당자 순번만 바꿀 수 있습니다.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_china_work_assignee() from public, anon, authenticated;
create trigger china_work_assignees_guard before update on public.china_work_assignees
  for each row execute function app.guard_china_work_assignee();

alter table public.china_work_assignees enable row level security;
create policy china_work_assignees_select on public.china_work_assignees
  for select to authenticated using (app.basic_work_allowed('china'));
create policy china_work_assignees_insert on public.china_work_assignees
  for insert to authenticated with check (
    app.basic_work_allowed('china')
    and exists (
      select 1 from public.profiles p
      where p.id = profile_id and p.status = 'active' and p.company_id = company_id
        and p.department_id = app.work_department('china')
        and exists (select 1 from public.departments d where d.id = p.department_id and d.company_id = p.company_id and d.is_active)
    )
  );
create policy china_work_assignees_update on public.china_work_assignees
  for update to authenticated
  using (app.basic_work_allowed('china'))
  with check (app.basic_work_allowed('china') and company_id = 'e0000000-0000-4000-8000-000000000001');
create policy china_work_assignees_delete on public.china_work_assignees
  for delete to authenticated using (app.basic_work_allowed('china'));
revoke all on table public.china_work_assignees from public, anon;
grant select, insert, update, delete on table public.china_work_assignees to authenticated;
