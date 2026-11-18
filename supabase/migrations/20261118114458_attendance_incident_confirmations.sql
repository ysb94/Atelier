create table app.attendance_incident_confirmations (
  company_id uuid not null references public.companies(id),
  work_date date not null,
  employee_id uuid not null references public.profiles(id),
  kind text not null check (kind in ('late','absent')),
  confirmed_by uuid not null references public.profiles(id),
  confirmed_at timestamptz not null default clock_timestamp(),
  primary key (company_id,work_date,employee_id,kind)
);
alter table app.attendance_incident_confirmations enable row level security;
revoke all on table app.attendance_incident_confirmations from public,anon,authenticated;

create function app.list_attendance_incident_confirmations(p_from date,p_to date)
returns table(employee_id uuid,work_date date,kind text,confirmed_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
declare
  company uuid := app.permission_company_id();
begin
  if company is null or auth.uid() is null then
    raise exception '근태 확인 기록을 조회할 수 없습니다.' using errcode='42501';
  end if;
  if not (coalesce(app.permission_allowed('org.manage','company',company),false)
    or coalesce(app.company_review_company_id()=company,false)) then
    return;
  end if;
  if p_from is null or p_to is null or p_to<p_from or p_to-p_from>31 then
    raise exception '근태 확인 조회 기간을 확인해 주세요.' using errcode='22023';
  end if;
  return query
    select c.employee_id,c.work_date,c.kind,c.confirmed_at
    from app.attendance_incident_confirmations c
    where c.company_id=company and c.work_date between p_from and p_to;
end;
$$;

create function app.confirm_attendance_incident(p_employee uuid,p_date date,p_kind text)
returns void language plpgsql security definer set search_path='' as $$
declare
  company uuid := app.permission_company_id();
  actor uuid := auth.uid();
begin
  if company is null or actor is null or not coalesce(app.permission_allowed('org.manage','company',company),false) then
    raise exception '운영지원만 근태를 확인 처리할 수 있습니다.' using errcode='42501';
  end if;
  if p_date is null or p_date<date '2026-11-02' or p_date>(clock_timestamp() at time zone 'Asia/Seoul')::date
    or p_kind is null or p_kind not in ('late','absent') then
    raise exception '근태 확인 날짜와 구분을 확인해 주세요.' using errcode='22023';
  end if;
  if not exists(select 1 from public.profiles p where p.id=p_employee and p.company_id=company and p.status='active')
    or app.workforce_mode(p_employee) is distinct from 'head-office' then
    raise exception '본사 근태 관리 대상 직원만 확인할 수 있습니다.' using errcode='42501';
  end if;
  insert into app.attendance_incident_confirmations (company_id,work_date,employee_id,kind,confirmed_by)
  values (company,p_date,p_employee,p_kind,actor)
  on conflict (company_id,work_date,employee_id,kind) do nothing;
end;
$$;

create function public.list_attendance_incident_confirmations(p_from date,p_to date)
returns table(employee_id uuid,work_date date,kind text,confirmed_at timestamptz)
language sql stable security invoker set search_path='' as $$
  select * from app.list_attendance_incident_confirmations(p_from,p_to)
$$;
create function public.confirm_attendance_incident(p_employee uuid,p_date date,p_kind text)
returns void language sql security invoker set search_path='' as $$
  select app.confirm_attendance_incident(p_employee,p_date,p_kind)
$$;
revoke all on function app.list_attendance_incident_confirmations(date,date),public.list_attendance_incident_confirmations(date,date),
  app.confirm_attendance_incident(uuid,date,text),public.confirm_attendance_incident(uuid,date,text) from public,anon,authenticated;
grant execute on function app.list_attendance_incident_confirmations(date,date),public.list_attendance_incident_confirmations(date,date),
  app.confirm_attendance_incident(uuid,date,text),public.confirm_attendance_incident(uuid,date,text) to authenticated;
