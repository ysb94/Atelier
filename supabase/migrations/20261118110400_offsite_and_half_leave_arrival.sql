-- 자동 외근 출근과 승인 오전 반차를 지각 판단에 반영한다.
-- 근무·퇴근 기준, 원본 기록, 기존 사유서는 유지한다.
create or replace function app.attendance_arrival_start_for_date(p_employee uuid, p_date date)
returns time language plpgsql stable security definer set search_path = ''
as $function$
declare
  arrival time := app.attendance_start_for_date(p_employee,p_date);
  company uuid;
  lunch_from time;
  lunch_to time;
  offsite_in time;
  slot record;
begin
  if arrival is null then return null; end if;
  select p.company_id into company from public.profiles p where p.id=p_employee;
  select coalesce(h.lunch_start,time '12:00'),coalesce(h.lunch_end,time '13:00')
    into lunch_from,lunch_to
    from (select 1) seed left join public.company_work_hours h on h.company_id=company;

  for slot in
    with leave_slots as (
      select r.start_time,r.end_time from public.company_leave_requests r where r.company_id=company
        and r.employee_id=p_employee and r.status='approved' and p_date between r.from_date and r.to_date
        and (r.kind='quarter' or (r.kind='half' and r.start_time<lunch_to))
    )
    select x.start_time,x.end_time from (
      select * from leave_slots
      union all select lunch_from,lunch_to where exists(select 1 from leave_slots)
    ) x where x.end_time>x.start_time order by x.start_time,x.end_time
  loop
    if slot.start_time<=arrival and arrival<slot.end_time then arrival := slot.end_time; end if;
  end loop;

  -- 자동 출근기는 신청 시작 시각에만 'offsite'를 저장한다. 이후 승인 정정은 유효 출처를 바꾼다.
  select c.clock_in into offsite_in
    from public.list_effective_attendance_clocks(p_date,p_date,p_employee) c
    where c.clock_in_source='offsite';
  return greatest(arrival,offsite_in);
end;
$function$;
revoke all on function app.attendance_arrival_start_for_date(uuid,date) from public,anon,authenticated;

-- 기존 사유서의 잠금·입력 검증·수정 정책을 보존하며 판정에 사용하는 출근 기록만 통일한다.
do $migration$
declare
  definition text := pg_get_functiondef('app.save_my_late_statement(text,text,text,text)'::regprocedure);
  previous_read constant text := 'select c.clock_in into clock_in from public.attendance_clock_ins c where c.employee_id = actor and c.work_date = today;';
  effective_read constant text := 'select c.clock_in into clock_in from public.list_effective_attendance_clocks(today,today,actor) c;';
begin
  if strpos(definition,effective_read)>0 then return; end if;
  if strpos(definition,previous_read)=0 then
    raise exception 'Unexpected attendance clock lookup in app.save_my_late_statement';
  end if;
  execute replace(definition,previous_read,effective_read);
end;
$migration$;
