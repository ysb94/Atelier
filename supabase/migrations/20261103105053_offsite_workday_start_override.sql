-- Additive: existing requests/clocks/monthly settings are not rewritten.
alter table public.company_leave_requests add column offsite_work_start time;
alter table public.company_leave_requests add constraint company_leave_offsite_work_start_check check (
  offsite_work_start is null or (kind='offsite' and from_date=to_date
    and offsite_work_start<time '24:00' and extract(second from offsite_work_start)=0));
comment on column public.company_leave_requests.offsite_work_start is '외근 시작 근무일에만 적용하는 출근 기준. 외근 시작 시각/실제 출근 원본과 별개이며 취소 시 적용하지 않음.';
create index company_leave_offsite_work_start on public.company_leave_requests(employee_id,from_date)
  where kind='offsite' and status='approved' and offsite_work_start is not null;

create function app.attendance_start_for_date(p_employee uuid,p_date date)
returns time language sql stable security definer set search_path='' as $$
  select coalesce(
    (select min(r.offsite_work_start) from public.company_leave_requests r
      where r.company_id=p.company_id and r.employee_id=p.id and r.kind='offsite' and r.status='approved'
        and r.from_date=p_date and r.to_date=p_date and r.offsite_work_start is not null),
    (select s.start_time from public.attendance_start_settings s where s.company_id=p.company_id
      and s.month=date_trunc('month',p_date)::date and (s.employee_id=p.id or (s.employee_id is null and s.department_id=p.department_id))
      order by (s.employee_id=p.id) desc nulls last,s.updated_at desc,s.id limit 1))
  from public.profiles p where p.id=p_employee;
$$;
revoke all on function app.attendance_start_for_date(uuid,date) from public,anon,authenticated;

create function app.guard_offsite_workday_start() returns trigger language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare base time;
begin
  if tg_op='UPDATE' then
    if new.offsite_work_start is distinct from old.offsite_work_start then
      raise exception '신청 원본의 당일 출근 기준은 수정할 수 없습니다. 외근을 취소하고 다시 등록해 주세요.' using errcode='23514';
    end if;
    return new;
  end if;
  if new.offsite_work_start is null then return new; end if;
  if auth.uid() is null or new.employee_id is distinct from auth.uid() or not exists(
    select 1 from public.profiles p where p.id=auth.uid() and p.company_id=new.company_id and p.status='active') then
    raise exception '본인의 외근에만 당일 출근 기준을 지정할 수 있습니다.' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.employee_id::text,0));
  if new.kind<>'offsite' or new.from_date<>new.to_date or new.from_date<(clock_timestamp() at time zone 'Asia/Seoul')::date then
    raise exception '당일 출근 기준은 오늘 이후의 하루 외근에만 지정할 수 있습니다.' using errcode='23514';
  end if;
  base:=app.attendance_start_for_date(new.employee_id,new.from_date);
  if base is null then raise exception '월별 출근 기준을 먼저 설정해 주세요.' using errcode='23514'; end if;
  if new.offsite_work_start<>base and not exists(select 1 from public.attendance_start_options o where o.company_id=new.company_id and o.start_time=new.offsite_work_start) then
    raise exception '회사의 출근시간 선택지 중에서 지정해 주세요.' using errcode='23514';
  end if;
  if exists(select 1 from public.company_leave_requests r where r.employee_id=new.employee_id and r.company_id=new.company_id
    and r.kind='offsite' and r.status='approved' and r.from_date=new.from_date and r.to_date=new.from_date
    and r.offsite_work_start is not null and r.offsite_work_start<>new.offsite_work_start) then
    raise exception '같은 날짜에 다른 출근 기준이 등록되어 있습니다. 기존 외근을 확인해 주세요.' using errcode='23514';
  end if;
  return new;
exception when lock_not_available then
  raise exception '다른 근태 처리가 진행 중입니다. 잠시 후 다시 시도해 주세요.' using errcode='55P03';
end $$;
revoke all on function app.guard_offsite_workday_start() from public,anon,authenticated;
create trigger zzz_offsite_workday_start_guard before insert or update on public.company_leave_requests
  for each row execute function app.guard_offsite_workday_start();
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
  return jsonb_build_object('offsiteWorkdayStartSupported',true,'startOptions',coalesce((select jsonb_agg(o.start_time order by o.start_time) from public.attendance_start_options o where o.company_id=company),'[]'::jsonb),'date',p_date,'start_time',start_at,'configured',start_at is not null,
    'lunch_start',coalesce(lunch_from,time '12:00'),'lunch_end',coalesce(lunch_to,time '13:00'));
end;
$function$
;

CREATE OR REPLACE FUNCTION app.attendance_presence_end_original(p_clock_id uuid)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.attendance_clock_ins%rowtype; department uuid; start_time time; lunch_start time; lunch_end time;
  starts timestamptz; ends timestamptz; lunch_from timestamptz; lunch_to timestamptz; periods tstzmultirange; r record;
begin
  select * into c from public.attendance_clock_ins where id=p_clock_id;
  if not found then return null; end if;
  select p.department_id into department from public.profiles p where p.id=c.employee_id and p.company_id=c.company_id and p.status='active';
  if not found or exists(select 1 from public.attendance_exemptions e where e.profile_id=c.employee_id) then return null; end if;
  if exists(select 1 from public.company_leave_requests l where l.employee_id=c.employee_id and l.company_id=c.company_id and l.status='approved'
    and l.from_date<=c.work_date and l.to_date>=c.work_date and l.kind in ('annual','official')) then return null; end if;
  start_time := app.attendance_start_for_date(c.employee_id,c.work_date);
  if start_time is null then return null; end if;
  select h.lunch_start,h.lunch_end into lunch_start,lunch_end from public.company_work_hours h where h.company_id=c.company_id;
  starts:=(c.work_date+start_time) at time zone 'Asia/Seoul';
  lunch_from:=(c.work_date+coalesce(lunch_start,time '12:00')) at time zone 'Asia/Seoul';
  lunch_to:=(c.work_date+coalesce(lunch_end,time '13:00')) at time zone 'Asia/Seoul';
  if lunch_to<lunch_from then return null; end if;
  ends:=starts+interval '8 hours';
  if starts<lunch_to and ends>lunch_from then ends:=ends+(lunch_to-greatest(starts,lunch_from)); end if;
  periods:=tstzmultirange(tstzrange(starts,ends,'[)'))-tstzmultirange(tstzrange(lunch_from,lunch_to,'[)'));
  for r in select * from public.company_leave_requests l where l.employee_id=c.employee_id and l.company_id=c.company_id
    and l.status='approved' and l.from_date<=c.work_date and l.to_date>=c.work_date and l.kind in ('half','quarter')
  loop
    periods:=periods-tstzmultirange(tstzrange((c.work_date+r.start_time) at time zone 'Asia/Seoul',(c.work_date+r.end_time) at time zone 'Asia/Seoul','[)'));
  end loop;
  for r in select * from public.company_leave_requests l where l.employee_id=c.employee_id and l.company_id=c.company_id
    and l.status='approved' and l.from_date=c.work_date and l.to_date=c.work_date and l.kind='overtime'
  loop
    periods:=periods+tstzmultirange(tstzrange((c.work_date+r.start_time) at time zone 'Asia/Seoul',(c.work_date+r.end_time) at time zone 'Asia/Seoul','[)'));
  end loop;
  select max(upper(part)) into ends from unnest(periods) part;
  return case when ends is null then null else greatest(ends,(c.work_date+c.clock_in) at time zone 'Asia/Seoul') end;
end $function$
;

CREATE OR REPLACE FUNCTION app.save_my_late_statement(p_prior text, p_reason text, p_detail text, p_prevention text)
 RETURNS public.late_arrival_statements
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
  start_at := app.attendance_start_for_date(actor,today);
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
$function$
;

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
  return query select d.day::date,app.attendance_start_for_date(p_employee,d.day::date)
    from generate_series(p_from,p_to,interval '1 day') d(day);
end;
$function$
;

revoke all on function app.attendance_workday_starts_between(uuid,date,date) from public,anon,authenticated;
grant execute on function app.attendance_workday_starts_between(uuid,date,date) to authenticated;
create function public.attendance_workday_starts_between(p_employee uuid,p_from date,p_to date)
returns table(work_date date,start_time time) language sql stable security invoker set search_path='' as $$
  select * from app.attendance_workday_starts_between(p_employee,p_from,p_to);
$$;
revoke all on function public.attendance_workday_starts_between(uuid,date,date) from public,anon,authenticated;
grant execute on function public.attendance_workday_starts_between(uuid,date,date) to authenticated;
