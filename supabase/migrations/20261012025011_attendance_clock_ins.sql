create table public.attendance_clock_ins (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  employee_id uuid not null references public.profiles(id),
  work_date date not null,
  clock_in time not null,
  created_at timestamptz not null default now(),
  unique (employee_id, work_date)
);
create index attendance_clock_ins_employee_date on public.attendance_clock_ins(employee_id, work_date);
create index attendance_clock_ins_company_date on public.attendance_clock_ins(company_id, work_date);
alter table public.attendance_clock_ins enable row level security;
revoke all on public.attendance_clock_ins from public, anon, authenticated;
grant select on public.attendance_clock_ins to authenticated;
create policy attendance_clock_read on public.attendance_clock_ins for select to authenticated
using (
  employee_id = (select auth.uid())
  or (
    company_id = (select company_id from public.profiles where id = (select auth.uid()) and status = 'active')
    and ((select app.can_edit_org_assignment()) or company_id = (select app.company_review_company_id()))
  )
);

create function app.clock_in_today()
returns time language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid(); company uuid; today date := (pg_catalog.clock_timestamp() at time zone 'Asia/Seoul')::date; stamp time := pg_catalog.date_trunc('minute', pg_catalog.clock_timestamp() at time zone 'Asia/Seoul')::time; existing time;
begin
  if actor is null then raise exception '로그인이 필요합니다.'; end if;
  select company_id into company from public.profiles where id = actor and status = 'active';
  if company is null then raise exception '재직 중인 직원만 출근할 수 있습니다.'; end if;
  insert into public.attendance_clock_ins(company_id, employee_id, work_date, clock_in)
  values (company, actor, today, stamp)
  on conflict (employee_id, work_date) do nothing;
  select clock_in into existing from public.attendance_clock_ins where employee_id = actor and work_date = today;
  return existing;
end;
$$;
revoke all on function app.clock_in_today() from public, anon, authenticated;
grant execute on function app.clock_in_today() to authenticated;
create function public.clock_in_today()
returns time language sql security invoker set search_path='' as $$
  select app.clock_in_today();
$$;
revoke all on function public.clock_in_today() from public, anon;
grant execute on function public.clock_in_today() to authenticated;
