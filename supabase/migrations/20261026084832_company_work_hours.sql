create table public.company_work_hours (
  company_id uuid primary key references public.companies(id),
  lunch_start time not null default time '12:00',
  lunch_end time not null default time '13:00',
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  constraint company_work_hours_lunch_order check (lunch_end > lunch_start)
);
alter table public.company_work_hours enable row level security;
revoke all on public.company_work_hours from anon, authenticated;
grant select on public.company_work_hours to authenticated;
create policy company_work_hours_read on public.company_work_hours
for select to authenticated
using (
  company_id = (
    select p.company_id from public.profiles p
    where p.id = (select auth.uid()) and p.status = 'active'
  )
);
create function app.save_company_lunch(p_start time, p_end time)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid(); company uuid;
begin
  if actor is null or not app.can_edit_org_assignment() then
    raise exception '운영지원만 점심시간을 저장할 수 있습니다.';
  end if;
  select p.company_id into company from public.profiles p where p.id = actor and p.status = 'active';
  if company is null then raise exception '회사 소속을 확인해 주세요.'; end if;
  if p_start is null or p_end is null or p_end <= p_start then
    raise exception '점심 종료는 시작보다 뒤여야 합니다.';
  end if;
  if extract(second from p_start) <> 0 or extract(second from p_end) <> 0 then
    raise exception '점심시간은 분 단위로 입력해 주세요.';
  end if;
  insert into public.company_work_hours(company_id, lunch_start, lunch_end, updated_by)
  values (company, p_start, p_end, actor)
  on conflict (company_id) do update
  set lunch_start = excluded.lunch_start, lunch_end = excluded.lunch_end,
      updated_by = excluded.updated_by, updated_at = now();
end;
$$;
revoke all on function app.save_company_lunch(time, time) from public, anon, authenticated;
grant execute on function app.save_company_lunch(time, time) to authenticated;
create function public.save_company_lunch(p_start time, p_end time)
returns void language plpgsql security invoker set search_path='' as $$
begin
  perform app.save_company_lunch(p_start, p_end);
end;
$$;
revoke all on function public.save_company_lunch(time, time) from public, anon, authenticated;
grant execute on function public.save_company_lunch(time, time) to authenticated;
