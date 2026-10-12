create function app.can_set_department_attendance(p_company uuid, p_department uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.department_request_approvers a
    join public.profiles me on me.id = auth.uid() and me.status = 'active' and me.company_id = a.company_id
    where a.company_id = p_company and a.department_id = p_department
      and (a.approver_id = me.id or a.substitute_id = me.id)
  );
$$;
revoke all on function app.can_set_department_attendance(uuid, uuid) from public, anon, authenticated;
grant execute on function app.can_set_department_attendance(uuid, uuid) to authenticated;

create function app.can_read_attendance_start(p_company uuid, p_department uuid, p_employee uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from public.profiles me
    where me.id = auth.uid() and me.status = 'active' and me.company_id = p_company
  ) and (
    (p_employee is null and app.can_set_department_attendance(p_company, p_department))
    or exists (
      select 1 from public.profiles emp
      where p_employee is not null and emp.id = p_employee and emp.status = 'active' and emp.company_id = p_company
        and app.can_set_department_attendance(emp.company_id, emp.department_id)
    )
  );
$$;
revoke all on function app.can_read_attendance_start(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function app.can_read_attendance_start(uuid, uuid, uuid) to authenticated;

alter policy attendance_start_read on public.attendance_start_settings
using (
  (((select app.can_edit_org_assignment())
    and company_id = (select company_id from public.profiles where id = (select auth.uid()) and status = 'active'))
   or company_id = (select app.company_review_company_id()))
  or app.can_read_attendance_start(company_id, department_id, employee_id)
);

create or replace function app.save_attendance_start_settings(p_month date, p_until date, p_department_id uuid, p_employee_id uuid, p_start time, p_grace integer)
returns integer language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); company uuid; target_department uuid; target_month date; inherited_time time; inherited_grace integer; count_months integer:=0;
begin
  if actor is null then raise exception '운영지원팀만 출근시간을 저장할 수 있습니다.'; end if;
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
  if not app.can_edit_org_assignment() and (p_employee_id is null or not app.can_set_department_attendance(company, target_department)) then
    raise exception '운영지원팀만 출근시간을 저장할 수 있습니다.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(company::text||':attendance-start',0));
  for target_month in select d::date from pg_catalog.generate_series(p_month::timestamp,p_until::timestamp,interval '1 month') d loop
    if p_employee_id is null then
      insert into public.attendance_start_settings(company_id,month,department_id,source,start_time,grace_minutes,updated_by)
      values(company,target_month,target_department,'department',p_start,p_grace,actor)
      on conflict(company_id,department_id,month) where employee_id is null do update
      set start_time=excluded.start_time,grace_minutes=excluded.grace_minutes,updated_by=actor,updated_at=now();
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
