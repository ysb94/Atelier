begin;

-- No cache, backfill, balance reset, policy or grant changes. Keep the existing
-- employee advisory-lock/refresh chain; avoid writing the same captured credit.
create or replace function app.fefo_budget(p_employee uuid,p_day date,p_capture boolean default false)
returns table(period_key text,ends_on date,available numeric) language plpgsql security definer set search_path='' as $$
declare s app.employee_leave_accrual%rowtype; c record; company uuid; opening numeric; spent numeric; current_key text;
begin
  select company_id into company from public.profiles where id=p_employee;
  select * into s from app.employee_leave_accrual where employee_id=p_employee;
  if found then
    select * into c from app.employee_leave_cycle(s.hire_date,p_day);
    if not found then raise exception '입사일 이전 연차입니다.'; end if;
    period_key:=c.starts_on::text;ends_on:=c.ends_on;current_key:=s.cycle_start::text;
    select coalesce(sum((e.allocations->>period_key)::numeric),0) into spent from app.leave_balance_entries e where e.employee_id=p_employee and e.refunded_at is null;
    if period_key=current_key and p_capture then
      select r.remaining_annual_leave+spent into opening from public.employee_roster r where r.profile_id=p_employee;
      -- ON CONFLICT ... WHERE alone still takes a row lock. Skip the statement
      -- entirely when the committed snapshot already equals this capture.
      if not exists(select 1 from app.leave_base_periods b where b.employee_id=p_employee
        and b.period_key=fefo_budget.period_key and b.opening_days is not distinct from opening) then
        insert into app.leave_base_periods values(p_employee,company,period_key,ends_on,opening)
        on conflict on constraint leave_base_periods_pkey do update set opening_days=excluded.opening_days
        where leave_base_periods.opening_days is distinct from excluded.opening_days;
      end if;
    elsif c.starts_on>s.cycle_start then
      insert into app.leave_base_periods values(p_employee,company,period_key,ends_on,c.grant_days) on conflict do nothing;
    end if;
  else
    period_key:='legacy';ends_on:='infinity';
    select coalesce(sum(case when e.allocations is null then e.days-coalesce((select sum(u.days) from app.employee_extra_leave_usage u where u.request_id=e.request_id and u.refunded_at is null),0)
      else coalesce((e.allocations->>'legacy')::numeric,0) end),0) into spent from app.leave_balance_entries e where e.employee_id=p_employee and e.refunded_at is null;
    if p_capture then
      select r.remaining_annual_leave+spent into opening from public.employee_roster r where r.profile_id=p_employee;
      if not exists(select 1 from app.leave_base_periods b where b.employee_id=p_employee
        and b.period_key=fefo_budget.period_key and b.opening_days is not distinct from opening) then
        insert into app.leave_base_periods values(p_employee,company,period_key,ends_on,opening)
        on conflict on constraint leave_base_periods_pkey do update set opening_days=excluded.opening_days
        where leave_base_periods.opening_days is distinct from excluded.opening_days;
      end if;
    end if;
  end if;
  select b.opening_days into opening from app.leave_base_periods b where b.employee_id=p_employee and b.period_key=fefo_budget.period_key;
  if not found or opening is null then raise exception '과거 연차 기간의 기준값이 없습니다. 운영지원 확인이 필요합니다.'; end if;
  available:=opening-spent;return next;
end $$;

create or replace function app.leave_advance_summary(p_employee uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 with periods as materialized (select * from app.advance_periods(p_employee)),
 state as materialized (select a.*, (now() at time zone 'Asia/Seoul')::date today
   from app.employee_leave_accrual a where a.employee_id=p_employee),
 -- Credits can change only on a clamped monthly/annual anniversary + one day.
 -- Tomorrow is included to preserve the old result for an overdue refresh.
 candidates as (
   select s.today+1 as day from state s
   union
   select m.month::date+least(extract(day from s.hire_date)::integer,
     extract(day from m.month+interval '1 month - 1 day')::integer)
   from state s cross join lateral generate_series(date_trunc('month',s.today::timestamp),
     date_trunc('month',(s.cycle_end+1)::timestamp),interval '1 month') m(month)
 )
 select jsonb_build_object('employeeId',p_employee,'limit',coalesce((select days from app.leave_advance_limits where employee_id=p_employee),0),
 'baseBalance',(select remaining_annual_leave from public.employee_roster where profile_id=p_employee),
 'remainingBalance',(select remaining_annual_leave+app.extra_leave_available(p_employee,(now() at time zone 'Asia/Seoul')::date)-app.leave_past_shortfall(p_employee,(now() at time zone 'Asia/Seoul')::date) from public.employee_roster where profile_id=p_employee),
 'outstanding',coalesce((select sum(greatest(least(greatest(spent-original_days,0),authorized)-settled,0)) from periods),0),
 'unclassified',coalesce((select sum(greatest(spent-original_days-authorized,0)) from periods),0),
 'nextDate',(select min(d.day) from state s cross join candidates d
   cross join lateral app.employee_leave_cycle(s.hire_date,d.day) c
   where d.day>s.today and d.day<=s.cycle_end+1 and (c.starts_on>s.cycle_start or c.grant_days>s.calculated_grant)),
 'needsReview',not exists(select 1 from public.profiles p join app.employee_leave_accrual a on a.employee_id=p.id join public.employee_roster r on r.profile_id=p.id
  where p.id=p_employee and p.status='active' and p.hire_date=a.hire_date and r.resigned_on is null),
 'periods',coalesce((select jsonb_agg(jsonb_build_object('period',p.period_key,'expires',ends_on,'authorized',authorized,
 'imported',coalesce((select sum(a.days) from app.leave_advance_authorizations a where a.employee_id=p_employee and a.period_key=p.period_key and a.request_id is null and a.cancelled_at is null),0),
 'unclassified',greatest(spent-original_days-authorized,0),'outstanding',greatest(least(greatest(spent-original_days,0),authorized)-settled,0),'settled',settled) order by p.period_key) from periods p where authorized>0 or spent>original_days or exists(select 1 from app.leave_advance_authorizations a where a.employee_id=p_employee and a.period_key=p.period_key and a.request_id is null and a.cancelled_at is null)),'[]'));
$$;

-- CREATE OR REPLACE keeps the existing private-helper ACLs and function OIDs.
commit;
