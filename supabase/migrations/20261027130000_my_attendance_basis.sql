-- 본인 출근 기준과 남은 연차만 읽는 함수. 테이블과 RLS는 바꾸지 않는다.
create function app.get_my_attendance_basis(p_month date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := auth.uid(); company uuid; department uuid;
begin
  if actor is null then raise exception '로그인이 필요합니다.' using errcode = '42501'; end if;
  if p_month is null or extract(day from p_month) <> 1 then raise exception '조회 월을 확인해 주세요.'; end if;
  select p.company_id, p.department_id into company, department
    from public.profiles p where p.id = actor and p.status = 'active';
  if company is null then raise exception '재직 중인 직원만 조회할 수 있습니다.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'departmentId', department,
    'remainingAnnualLeave', (
      select r.remaining_annual_leave from public.employee_roster r
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
revoke all on function app.get_my_attendance_basis(date) from public, anon, authenticated;
grant execute on function app.get_my_attendance_basis(date) to authenticated;
create function public.get_my_attendance_basis(p_month date)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select app.get_my_attendance_basis(p_month);
$$;
revoke all on function public.get_my_attendance_basis(date) from public, anon, authenticated;
grant execute on function public.get_my_attendance_basis(date) to authenticated;
comment on function public.get_my_attendance_basis(date) is '로그인한 본인의 해당 월 출근 기준과 남은 연차만 반환한다.';
