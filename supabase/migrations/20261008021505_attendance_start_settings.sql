create table public.attendance_start_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  month date not null check (extract(day from month)=1),
  department_id uuid references public.departments(id),
  employee_id uuid references public.profiles(id),
  source text not null check (source in ('department','individual')),
  start_time time,
  grace_minutes integer not null default 5 check (grace_minutes between 0 and 60),
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  check (employee_id is not null or (department_id is not null and source='department' and start_time is not null)),
  check (source <> 'individual' or (employee_id is not null and start_time is not null))
);
create unique index attendance_start_department_month on public.attendance_start_settings(company_id,department_id,month) where employee_id is null;
create unique index attendance_start_employee_month on public.attendance_start_settings(company_id,employee_id,month) where employee_id is not null;
create index attendance_start_department on public.attendance_start_settings(department_id);
create index attendance_start_employee on public.attendance_start_settings(employee_id);
create index attendance_start_editor on public.attendance_start_settings(updated_by);
alter table public.attendance_start_settings enable row level security;
revoke all on public.attendance_start_settings from anon, authenticated;
grant select on public.attendance_start_settings to authenticated;
create policy attendance_start_read on public.attendance_start_settings for select to authenticated
using ((select app.can_edit_org_assignment()) and company_id=(select company_id from public.profiles where id=(select auth.uid()) and status='active'));

-- Protected private write function: narrow company/target checks before any privileged lookup/write.
create function app.save_attendance_start_settings(p_month date, p_until date, p_department_id uuid, p_employee_id uuid, p_start time, p_grace integer)
returns integer language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); company uuid; target_department uuid; target_month date; inherited_time time; inherited_grace integer; count_months integer:=0;
begin
  if actor is null or not app.can_edit_org_assignment() then raise exception '운영지원팀만 출근시간을 저장할 수 있습니다.'; end if;
  select company_id into company from public.profiles where id=actor and status='active';
  if company is null then raise exception '회사 소속을 확인해 주세요.'; end if;
  if p_month is null or p_until is null or extract(day from p_month)<>1 or extract(day from p_until)<>1
    or p_until<p_month or extract(year from p_until)<>extract(year from p_month)
    or p_grace is null or p_grace<0 or p_grace>60 then raise exception '적용 월과 초과 기준을 확인해 주세요.'; end if;
  if p_start is not null and extract(second from p_start)<>0 then raise exception '출근시간은 분 단위로 입력해 주세요.'; end if;
  if p_employee_id is not null then
    select department_id into target_department from public.profiles where id=p_employee_id and company_id=company and status='active';
    if not found then raise exception '같은 회사의 재직 직원만 설정할 수 있습니다.'; end if;
  else
    if p_start is null or not exists(select 1 from public.departments where id=p_department_id and company_id=company and is_active) then raise exception '부서와 출근시간을 확인해 주세요.'; end if;
    target_department:=p_department_id;
  end if;
  -- Serialize edits to preserve individual exceptions during department batch saves.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(company::text||':attendance-start',0));
  for target_month in select d::date from pg_catalog.generate_series(p_month::timestamp,p_until::timestamp,interval '1 month') d loop
    if p_employee_id is null then
      insert into public.attendance_start_settings(company_id,month,department_id,source,start_time,grace_minutes,updated_by)
      values(company,target_month,target_department,'department',p_start,p_grace,actor)
      on conflict(company_id,department_id,month) where employee_id is null do update
      set start_time=excluded.start_time,grace_minutes=excluded.grace_minutes,updated_by=actor,updated_at=now();
      -- Materialize employee defaults so later department moves do not rewrite saved history.
      insert into public.attendance_start_settings(company_id,month,department_id,employee_id,source,start_time,grace_minutes,updated_by)
      select company,target_month,target_department,p.id,'department',p_start,p_grace,actor from public.profiles p
      where p.company_id=company and p.department_id=target_department and p.status='active'
      on conflict(company_id,employee_id,month) where employee_id is not null do update
      set department_id=excluded.department_id,start_time=excluded.start_time,grace_minutes=excluded.grace_minutes,updated_by=actor,updated_at=now()
      where attendance_start_settings.source='department';
    else
      inherited_time:=null; inherited_grace:=5;
      if p_start is null then
        select start_time,grace_minutes into inherited_time,inherited_grace from public.attendance_start_settings
        where company_id=company and department_id=target_department and month=target_month and employee_id is null;
      end if;
      insert into public.attendance_start_settings(company_id,month,department_id,employee_id,source,start_time,grace_minutes,updated_by)
      values(company,target_month,target_department,p_employee_id,case when p_start is null then 'department' else 'individual' end,
        coalesce(p_start,inherited_time),case when p_start is null then coalesce(inherited_grace,5) else p_grace end,actor)
      on conflict(company_id,employee_id,month) where employee_id is not null do update
      set department_id=excluded.department_id,source=excluded.source,start_time=excluded.start_time,grace_minutes=excluded.grace_minutes,updated_by=actor,updated_at=now();
    end if;
    count_months:=count_months+1;
  end loop;
  return count_months;
end;
$$;
revoke all on function app.save_attendance_start_settings(date,date,uuid,uuid,time,integer) from public,anon,authenticated;
grant execute on function app.save_attendance_start_settings(date,date,uuid,uuid,time,integer) to authenticated;
create function public.save_attendance_start_settings(p_month date,p_until date,p_department_id uuid,p_employee_id uuid,p_start time,p_grace integer)
returns integer language sql security invoker set search_path='' as $$
  select app.save_attendance_start_settings(p_month,p_until,p_department_id,p_employee_id,p_start,p_grace);
$$;
revoke all on function public.save_attendance_start_settings(date,date,uuid,uuid,time,integer) from public,anon,authenticated;
grant execute on function public.save_attendance_start_settings(date,date,uuid,uuid,time,integer) to authenticated;
