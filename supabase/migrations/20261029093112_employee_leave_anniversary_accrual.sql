begin;
-- Only explicitly initialized employees participate. No historical requests are replayed.
create table app.employee_leave_accrual (
  employee_id uuid primary key references public.profiles(id),
  company_id uuid not null references public.companies(id),
  hire_date date not null,
  cycle_start date not null,
  cycle_end date not null check (cycle_end>=cycle_start),
  calculated_grant numeric(7,2) not null check (calculated_grant>=0),
  source_key text not null,
  initialized_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index employee_leave_accrual_company on app.employee_leave_accrual(company_id);
alter table app.employee_leave_accrual enable row level security;
revoke all on app.employee_leave_accrual from public,anon,authenticated;
alter table app.leave_balance_entries add column allocations jsonb;
comment on column app.leave_balance_entries.allocations is '실제로 차감한 일수를 입사일 기준 연차 기간별로 보존. 과거 기간 취소로 현재 잔여가 늘지 않게 함.';

-- The user chose anniversary + 1 day. Feb 29 anniversaries clamp to Feb 28.
create function app.employee_leave_cycle(p_hire date,p_day date)
returns table(starts_on date,ends_on date,grant_days numeric)
language plpgsql immutable set search_path='' as $$
declare y integer; anniversary date; next_anniversary date; years integer; months integer; month_day date;
begin
  if p_hire is null or p_day is null or p_day<p_hire then return; end if;
  y:=extract(year from p_day)::integer;
  anniversary:=make_date(y,extract(month from p_hire)::integer,1);
  anniversary:=anniversary+least(extract(day from p_hire)::integer,extract(day from anniversary+interval '1 month - 1 day')::integer)-1;
  if anniversary>=p_day then
    y:=y-1;
    anniversary:=make_date(y,extract(month from p_hire)::integer,1);
    anniversary:=anniversary+least(extract(day from p_hire)::integer,extract(day from anniversary+interval '1 month - 1 day')::integer)-1;
  end if;
  years:=greatest(0,y-extract(year from p_hire)::integer);
  starts_on:=case when years=0 then p_hire else anniversary+1 end;
  next_anniversary:=make_date(greatest(y+1,extract(year from p_hire)::integer+1),extract(month from p_hire)::integer,1);
  ends_on:=next_anniversary+least(extract(day from p_hire)::integer,extract(day from next_anniversary+interval '1 month - 1 day')::integer)-1;
  if years=0 then
    months:=(extract(year from p_day-1)::integer-extract(year from p_hire)::integer)*12+extract(month from p_day-1)::integer-extract(month from p_hire)::integer;
    month_day:=date_trunc('month',(p_day-1)::timestamp)::date;
    month_day:=month_day+least(extract(day from p_hire)::integer,extract(day from month_day+interval '1 month - 1 day')::integer)-1;
    if p_day-1<month_day then months:=months-1; end if;
    grant_days:=greatest(0,least(11,months));
  else grant_days:=least(25,15+(years-1)/2); end if;
  return next;
end $$;
revoke all on function app.employee_leave_cycle(date,date) from public,anon,authenticated;

create function app.refresh_employee_leave(p_employee uuid,p_today date)
returns void language plpgsql security definer set search_path='' as $$
declare s app.employee_leave_accrual%rowtype; c record; balance numeric; granted numeric; reserved numeric; delta numeric;
  old_import text:=current_setting('app.roster_import',true); old_sync text:=current_setting('app.leave_balance_sync',true);
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_employee::text,0));
  select * into s from app.employee_leave_accrual where employee_id=p_employee for update;
  if not found then return; end if;
  if not exists(select 1 from public.profiles p where p.id=s.employee_id and p.company_id=s.company_id and p.status='active' and p.hire_date=s.hire_date) then
    raise exception '입사일 또는 직원 상태가 바뀌었습니다. 운영지원에서 연차 기준을 확인해 주세요.';
  end if;
  select * into c from app.employee_leave_cycle(s.hire_date,p_today);
  if not found or c.starts_on<s.cycle_start then raise exception '연차 기준 기간을 확인해 주세요.'; end if;
  if c.starts_on=s.cycle_start and c.grant_days<=s.calculated_grant then return; end if;
  select remaining_annual_leave,accrued_annual_leave into balance,granted from public.employee_roster where profile_id=p_employee and company_id=s.company_id for update;
  if balance is null or granted is null then raise exception '발생일수와 남은 연차를 확인해 주세요.'; end if;
  if c.starts_on>s.cycle_start then
    select coalesce(sum((allocations->>c.starts_on::text)::numeric),0) into reserved
      from app.leave_balance_entries where employee_id=p_employee and company_id=s.company_id and refunded_at is null;
    granted:=c.grant_days; balance:=granted-reserved;
  else
    delta:=c.grant_days-s.calculated_grant;
    granted:=granted+delta; balance:=balance+delta;
  end if;
  perform pg_catalog.set_config('app.roster_import','on',true);
  -- A verified renewal also rebinds the existing reminder cycle; ordinary deductions do not.
  perform pg_catalog.set_config('app.leave_balance_sync',case when c.starts_on>s.cycle_start then '' else 'on' end,true);
  update public.employee_roster set accrued_annual_leave=granted,remaining_annual_leave=balance where profile_id=p_employee;
  update app.employee_leave_accrual set cycle_start=c.starts_on,cycle_end=c.ends_on,calculated_grant=c.grant_days,updated_at=now() where employee_id=p_employee;
  perform pg_catalog.set_config('app.roster_import',coalesce(old_import,''),true);
  perform pg_catalog.set_config('app.leave_balance_sync',coalesce(old_sync,''),true);
exception when others then
  perform pg_catalog.set_config('app.roster_import',coalesce(old_import,''),true);
  perform pg_catalog.set_config('app.leave_balance_sync',coalesce(old_sync,''),true);
  raise;
end $$;
revoke all on function app.refresh_employee_leave(uuid,date) from public,anon,authenticated;

create or replace function app.sync_leave_request_balance()
returns trigger language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); amount numeric; charge numeric; balance numeric; refund boolean:=false;
  s app.employee_leave_accrual%rowtype; parts jsonb; part record; budget numeric; reserved numeric;
  previous_import text:=current_setting('app.roster_import',true); previous_sync text:=current_setting('app.leave_balance_sync',true);
begin
  if new.kind not in ('annual','half','quarter') then return new; end if;
  if TG_OP='INSERT' then
    if new.status<>'approved' then return new; end if;
  elsif not (old.status='approved' and new.status='cancelled') then return new;
  else refund:=true; end if;
  if actor is null or actor<>new.employee_id or not exists(select 1 from public.profiles p where p.id=actor and p.status='active' and p.company_id=new.company_id) then
    raise exception '본인의 휴가만 차감·복원할 수 있습니다.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,0));
  if refund then
    select days,allocations into amount,parts from app.leave_balance_entries
      where request_id=new.id and employee_id=actor and company_id=new.company_id and refunded_at is null for update;
    if not found then return new; end if;
  else amount:=app.leave_balance_days(new.kind,new.from_date,new.to_date); end if;
  perform app.refresh_employee_leave(actor,(now() at time zone 'Asia/Seoul')::date);
  select * into s from app.employee_leave_accrual where employee_id=actor;
  charge:=amount;
  if found then
    if not refund then
      if new.from_date<s.hire_date then raise exception '입사일 이전 휴가를 등록할 수 없습니다.'; end if;
      select jsonb_object_agg(k,days) into parts from (
        select c.starts_on::text k,sum(case new.kind when 'half' then 0.5 when 'quarter' then 0.25 else 1 end) days
        from pg_catalog.generate_series(0,new.to_date-new.from_date) n(i)
        cross join lateral app.employee_leave_cycle(s.hire_date,new.from_date+n.i) c
        where extract(isodow from new.from_date+n.i) between 1 and 5
          and not exists(select 1 from app.leave_balance_holidays h where h.day=new.from_date+n.i)
        group by c.starts_on
      ) q;
      -- Future bookings reserve that future period instead of consuming this year's balance.
      for part in select key,value::numeric days from jsonb_each_text(parts) loop
        if part.key::date>s.cycle_start then
          select grant_days into budget from app.employee_leave_cycle(s.hire_date,part.key::date);
          select coalesce(sum((allocations->>part.key)::numeric),0) into reserved from app.leave_balance_entries
            where employee_id=actor and company_id=new.company_id and refunded_at is null;
          if reserved+part.days>budget then raise exception '다음 연차 기간의 남은 연차가 부족합니다.'; end if;
        end if;
      end loop;
    end if;
    charge:=coalesce((parts->>s.cycle_start::text)::numeric,0);
  end if;
  select remaining_annual_leave into balance from public.employee_roster where profile_id=actor and company_id=new.company_id for update;
  if balance is null then raise exception '남은 연차가 등록되지 않았습니다. 운영지원에 잔여일 등록을 요청해 주세요.'; end if;
  if not refund and balance<charge and charge>0 then raise exception '남은 연차가 부족합니다. 잔여 %일 · 필요한 연차 %일',balance,charge; end if;
  if refund then update app.leave_balance_entries set refunded_at=clock_timestamp() where request_id=new.id;
  else insert into app.leave_balance_entries(request_id,employee_id,company_id,days,allocations) values(new.id,actor,new.company_id,amount,parts); end if;
  perform pg_catalog.set_config('app.roster_import','on',true);
  perform pg_catalog.set_config('app.leave_balance_sync','on',true);
  update public.employee_roster set remaining_annual_leave=balance+case when refund then charge else -charge end where profile_id=actor and company_id=new.company_id;
  perform pg_catalog.set_config('app.roster_import',coalesce(previous_import,''),true);
  perform pg_catalog.set_config('app.leave_balance_sync',coalesce(previous_sync,''),true);
  return new;
exception when others then
  perform pg_catalog.set_config('app.roster_import',coalesce(previous_import,''),true);
  perform pg_catalog.set_config('app.leave_balance_sync',coalesce(previous_sync,''),true);
  raise;
end $$;

create function app.refresh_company_leave_balances()
returns void language plpgsql security definer set search_path='' as $$
declare employee record;
begin
  for employee in select a.employee_id from app.employee_leave_accrual a
    join public.profiles p on p.id=a.employee_id and p.company_id=a.company_id and p.status='active'
    join public.employee_roster r on r.profile_id=p.id and r.resigned_on is null order by a.employee_id loop
    begin perform app.refresh_employee_leave(employee.employee_id,(now() at time zone 'Asia/Seoul')::date);
    exception when others then raise warning 'leave-accrual employee %: %',employee.employee_id,sqlerrm; end;
  end loop;
end $$;
revoke all on function app.refresh_company_leave_balances() from public,anon,authenticated;
commit;
