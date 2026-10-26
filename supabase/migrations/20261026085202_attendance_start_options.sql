create table public.attendance_start_options (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  start_time time not null,
  created_at timestamptz not null default now(),
  unique (company_id, start_time)
);
alter table public.attendance_start_options enable row level security;
revoke all on public.attendance_start_options from anon, authenticated;
grant select on public.attendance_start_options to authenticated;
create policy attendance_start_options_read on public.attendance_start_options
for select to authenticated
using (
  company_id = (
    select p.company_id from public.profiles p
    where p.id = (select auth.uid()) and p.status = 'active'
  )
);
insert into public.attendance_start_options (company_id, start_time)
select c.id, t.start_time
from public.companies c
cross join (values (time '09:00'), (time '10:00')) as t(start_time);
create function app.add_attendance_start_option(p_start time)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid(); company uuid;
begin
  if actor is null or not app.can_edit_org_assignment() then
    raise exception '운영지원만 출근시간 목록을 바꿀 수 있습니다.';
  end if;
  select p.company_id into company from public.profiles p where p.id = actor and p.status = 'active';
  if company is null then raise exception '회사 소속을 확인해 주세요.'; end if;
  if p_start is null or extract(second from p_start) <> 0 then
    raise exception '출근시간은 분 단위로 입력해 주세요.';
  end if;
  insert into public.attendance_start_options (company_id, start_time)
  values (company, p_start)
  on conflict (company_id, start_time) do nothing;
end;
$$;
create function app.remove_attendance_start_option(p_start time)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid(); company uuid;
begin
  if actor is null or not app.can_edit_org_assignment() then
    raise exception '운영지원만 출근시간 목록을 바꿀 수 있습니다.';
  end if;
  select p.company_id into company from public.profiles p where p.id = actor and p.status = 'active';
  if company is null then raise exception '회사 소속을 확인해 주세요.'; end if;
  delete from public.attendance_start_options where company_id = company and start_time = p_start;
end;
$$;
revoke all on function app.add_attendance_start_option(time) from public, anon, authenticated;
revoke all on function app.remove_attendance_start_option(time) from public, anon, authenticated;
grant execute on function app.add_attendance_start_option(time) to authenticated;
grant execute on function app.remove_attendance_start_option(time) to authenticated;
create function public.add_attendance_start_option(p_start time)
returns void language plpgsql security invoker set search_path='' as $$
begin perform app.add_attendance_start_option(p_start); end; $$;
create function public.remove_attendance_start_option(p_start time)
returns void language plpgsql security invoker set search_path='' as $$
begin perform app.remove_attendance_start_option(p_start); end; $$;
revoke all on function public.add_attendance_start_option(time) from public, anon, authenticated;
revoke all on function public.remove_attendance_start_option(time) from public, anon, authenticated;
grant execute on function public.add_attendance_start_option(time) to authenticated;
grant execute on function public.remove_attendance_start_option(time) to authenticated;
