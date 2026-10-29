create or replace function app.get_my_attendance_basis(p_month date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := auth.uid(); company uuid; department uuid; today date := (now() at time zone 'Asia/Seoul')::date;
begin
  if actor is null then raise exception '로그인이 필요합니다.' using errcode = '42501'; end if;
  if p_month is null or extract(day from p_month) <> 1 then raise exception '조회 월을 확인해 주세요.'; end if;
  select p.company_id, p.department_id into company, department
    from public.profiles p where p.id = actor and p.status = 'active';
  if company is null then raise exception '재직 중인 직원만 조회할 수 있습니다.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'departmentId', department,
    'baseAnnualLeave', (
      select r.remaining_annual_leave from public.employee_roster r
      where r.profile_id = actor and r.company_id = company
    ),
    'additionalAnnualLeave', app.extra_leave_available(actor, today),
    'remainingAnnualLeave', (
      select r.remaining_annual_leave + app.extra_leave_available(actor, today) - app.leave_past_shortfall(actor, today) from public.employee_roster r
      where r.profile_id = actor and r.company_id = company
    ),
    'settings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'month', s.month,
        'departmentId', s.department_id,
        'employeeId', s.employee_id,
        'source', s.source,
        'start', s.start_time,
        'grace', s.grace_minutes
      ) order by s.employee_id nulls last, s.id)
      from public.attendance_start_settings s
      where s.company_id = company and s.month = p_month
        and (s.employee_id = actor or (s.employee_id is null and s.department_id = department))
    ), '[]'::jsonb)
  );
end;
$$;
