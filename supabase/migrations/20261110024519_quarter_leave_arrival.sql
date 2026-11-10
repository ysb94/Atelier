-- 승인 반반차를 지각 기준에만 반영한다. 원본 출퇴근·월별 근무 기준은 변경하지 않는다.
create or replace function app.attendance_arrival_start_for_date(p_employee uuid, p_date date)
returns time language plpgsql stable security definer set search_path = ''
as $function$
declare
  arrival time := app.attendance_start_for_date(p_employee,p_date);
  company uuid;
  slot record;
begin
  if arrival is null then return null; end if;
  select p.company_id into company from public.profiles p where p.id=p_employee;
  if not exists(select 1 from public.company_leave_requests r where r.company_id=company
    and r.employee_id=p_employee and r.kind='quarter' and r.status='approved'
    and p_date between r.from_date and r.to_date) then return arrival; end if;
  for slot in
    select x.start_time,x.end_time from (
      select r.start_time,r.end_time from public.company_leave_requests r where r.company_id=company
        and r.employee_id=p_employee and r.kind='quarter' and r.status='approved'
        and p_date between r.from_date and r.to_date
      union all
      select coalesce(h.lunch_start,time '12:00'),coalesce(h.lunch_end,time '13:00')
        from (select 1) seed left join public.company_work_hours h on h.company_id=company
    ) x where x.end_time>x.start_time order by x.start_time,x.end_time
  loop
    if slot.start_time<=arrival and arrival<slot.end_time then arrival := slot.end_time; end if;
  end loop;
  return arrival;
end;
$function$;
revoke all on function app.attendance_arrival_start_for_date(uuid,date) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION app.attendance_workday_starts_between(p_employee uuid, p_from date, p_to date)
 RETURNS TABLE(work_date date, start_time time without time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    and not coalesce((select app.can_edit_org_assignment()) or person.company_id = (select app.company_review_company_id()),false) then
    raise exception '이 직원의 출근 기준을 볼 수 없습니다.' using errcode = '42501';
  end if;
  return query select d.day::date,app.attendance_arrival_start_for_date(p_employee,d.day::date)
    from generate_series(p_from,p_to,interval '1 day') d(day);
end;
$function$;

CREATE OR REPLACE FUNCTION app.get_my_workday_basis(p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid := auth.uid(); company uuid; department uuid; start_at time; lunch_from time; lunch_to time;
begin
  if actor is null then raise exception '로그인이 필요합니다.'; end if;
  if p_date is null then raise exception '조회할 날짜가 필요합니다.'; end if;
  select p.company_id,p.department_id into company,department from public.profiles p where p.id=actor and p.status='active';
  if company is null then raise exception '재직 중인 직원만 조회할 수 있습니다.'; end if;
  start_at := app.attendance_start_for_date(actor,p_date);
  select h.lunch_start,h.lunch_end into lunch_from,lunch_to from public.company_work_hours h where h.company_id=company;
  return jsonb_build_object('quarterArrivalSupported',true,'arrival_start_time',app.attendance_arrival_start_for_date(actor,p_date),'offsiteWorkdayStartSupported',true,'startOptions',coalesce((select jsonb_agg(o.start_time order by o.start_time) from public.attendance_start_options o where o.company_id=company),'[]'::jsonb),'date',p_date,'start_time',start_at,'configured',start_at is not null,
    'lunch_start',coalesce(lunch_from,time '12:00'),'lunch_end',coalesce(lunch_to,time '13:00'));
end;
$function$;

CREATE OR REPLACE FUNCTION app.save_my_late_statement(p_prior text, p_reason text, p_detail text, p_prevention text)
 RETURNS late_arrival_statements
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := auth.uid();
  person public.profiles%rowtype;
  department_name text;
  today date := (pg_catalog.clock_timestamp() at time zone 'Asia/Seoul')::date;
  clock_in time;
  start_at time;
  minutes integer;
  saved public.late_arrival_statements%rowtype;
  prior text := btrim(coalesce(p_prior, ''));
  reason text := btrim(coalesce(p_reason, ''));
  detail text := btrim(coalesce(p_detail, ''));
  prevention text := btrim(coalesce(p_prevention, ''));
begin
  if actor is null then raise exception '로그인이 필요합니다.'; end if;
  select * into person from public.profiles where id = actor and status = 'active';
  if person.id is null then raise exception '재직 중인 직원만 사유서를 제출할 수 있습니다.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
  if prior = '' or reason = '' or detail = '' or prevention = '' then raise exception '사전 승인, 사유 구분, 상세 사유, 재발 방지 대책을 입력해 주세요.'; end if;
  if char_length(prior) > 40 or char_length(reason) > 40 or char_length(detail) > 1000 or char_length(prevention) > 1000 then
    raise exception '사유서 내용이 너무 깁니다.';
  end if;
  select c.clock_in into clock_in from public.attendance_clock_ins c where c.employee_id = actor and c.work_date = today;
  if clock_in is null then raise exception '오늘 출근을 먼저 기록해 주세요.'; end if;
  start_at := app.attendance_arrival_start_for_date(actor,today);
  if start_at is null then raise exception '출근 기준이 없어 지각 사유서를 작성하지 않습니다.'; end if;
  minutes := floor(extract(epoch from (clock_in - start_at)) / 60)::integer;
  if minutes <= 5 then raise exception '지각이 아니라서 사유서가 필요하지 않습니다.'; end if;
  select coalesce(d.name, '소속 없음') into department_name from public.departments d where d.id = person.department_id;
  insert into public.late_arrival_statements(
    company_id, employee_id, work_date, department_name, employee_name, position_name,
    baseline_time, actual_time, late_minutes, prior_approval, reason_kind, detail, prevention, written_on
  ) values (
    person.company_id, actor, today, coalesce(department_name, '소속 없음'),
    coalesce(nullif(btrim(person.display_name), ''), '이름 없음'),
    coalesce(nullif(btrim(person.position), ''), '직위 미지정'),
    start_at, clock_in, minutes, prior, reason, detail, prevention, today
  )
  on conflict (employee_id, work_date) do update set
    prior_approval = excluded.prior_approval,
    reason_kind = excluded.reason_kind,
    detail = excluded.detail,
    prevention = excluded.prevention
  returning * into saved;
  return saved;
end;
$function$;
