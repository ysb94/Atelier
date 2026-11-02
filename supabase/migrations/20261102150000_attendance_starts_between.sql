-- 지각 누적은 본인 또는 사유서를 볼 수 있는 사람이, 해당 직원의 월별 출근 기준만 받아 계산한다.
-- 출근 기록과 기존 기준 저장은 바꾸지 않는다.

create function app.attendance_starts_between(p_employee uuid, p_from date, p_to date)
returns table(month date, start_time time)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  me public.profiles%rowtype;
  person public.profiles%rowtype;
begin
  if actor is null then raise exception '로그인이 필요합니다.'; end if;
  if p_employee is null or p_from is null or p_to is null or p_to < p_from or p_to > p_from + 366 then
    raise exception '조회 기간을 확인해 주세요.';
  end if;
  select * into me from public.profiles where id = actor and status = 'active';
  if me.id is null then raise exception '재직 중인 직원만 조회할 수 있습니다.' using errcode = '42501'; end if;
  select * into person from public.profiles where id = p_employee and company_id = me.company_id;
  if person.id is null then raise exception '직원을 찾지 못했습니다.' using errcode = '42501'; end if;
  if person.id <> actor
    and not ((select app.can_edit_org_assignment()) or person.company_id = (select app.company_review_company_id())) then
    raise exception '이 직원의 출근 기준을 볼 수 없습니다.' using errcode = '42501';
  end if;
  return query
  select m.month::date, (
    select s.start_time
    from public.attendance_start_settings s
    where s.company_id = person.company_id
      and s.month = m.month::date
      and (s.employee_id = person.id or (s.employee_id is null and s.department_id = person.department_id))
    order by (s.employee_id = person.id) desc nulls last, s.updated_at desc, s.id
    limit 1
  )
  from generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month') as m(month);
end;
$$;

revoke all on function app.attendance_starts_between(uuid, date, date) from public, anon;
grant execute on function app.attendance_starts_between(uuid, date, date) to authenticated;

create function public.attendance_starts_between(p_employee uuid, p_from date, p_to date)
returns table(month date, start_time time)
language sql
stable
security invoker
set search_path = ''
as $$
  select starts.month, starts.start_time from app.attendance_starts_between(p_employee, p_from, p_to) as starts;
$$;

revoke all on function public.attendance_starts_between(uuid, date, date) from public, anon;
grant execute on function public.attendance_starts_between(uuid, date, date) to authenticated;
