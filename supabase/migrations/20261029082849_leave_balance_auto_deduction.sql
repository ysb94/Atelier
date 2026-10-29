-- Start from the currently registered balance. Never replay existing requests.
-- The private ledger records only deductions made after this migration.
begin;

-- Preserve the existing employee/company checks; allow the already guarded offsite state.
alter policy leave_create on public.company_leave_requests with check (
  company_id=(select p.company_id from public.profiles p where p.id=(select auth.uid()) and p.status='active')
  and employee_id=(select auth.uid())
  and (status='pending' or (status='approved' and kind in ('annual','half','quarter','offsite')))
);

create table app.leave_balance_calendar_years (year integer primary key);
create table app.leave_balance_holidays (day date primary key, label text not null);
create table app.leave_balance_entries (
  request_id uuid primary key references public.company_leave_requests(id),
  employee_id uuid not null references public.profiles(id),
  company_id uuid not null references public.companies(id),
  days numeric(7,2) not null check (days > 0),
  debited_at timestamptz not null default clock_timestamp(),
  refunded_at timestamptz,
  check (refunded_at is null or refunded_at >= debited_at)
);
create index leave_balance_entries_employee on app.leave_balance_entries(employee_id);
create index leave_balance_entries_company on app.leave_balance_entries(company_id);
alter table app.leave_balance_calendar_years enable row level security;
alter table app.leave_balance_holidays enable row level security;
alter table app.leave_balance_entries enable row level security;
revoke all on app.leave_balance_calendar_years, app.leave_balance_holidays, app.leave_balance_entries from public, anon, authenticated;

-- The same national holiday data as the existing attendance calendar.
insert into app.leave_balance_calendar_years(year) values (2018),(2019),(2020),(2021),(2022),(2023),(2024),(2025),(2026),(2027);
insert into app.leave_balance_holidays(day,label) values
('2018-01-01','1월 1일'),
('2018-02-15','설날 전날'),
('2018-02-16','설날'),
('2018-02-17','설날 다음 날'),
('2018-03-01','3ㆍ1절'),
('2018-05-05','어린이날'),
('2018-05-07','대체공휴일(어린이날)'),
('2018-05-22','부처님 오신 날'),
('2018-06-06','현충일'),
('2018-06-13','전국동시지방선거'),
('2018-08-15','광복절'),
('2018-09-23','추석 전날'),
('2018-09-24','추석'),
('2018-09-25','추석 다음 날'),
('2018-09-26','대체공휴일(추석)'),
('2018-10-03','개천절'),
('2018-10-09','한글날'),
('2018-12-25','기독탄신일'),
('2019-01-01','1월 1일'),
('2019-02-04','설날 전날'),
('2019-02-05','설날'),
('2019-02-06','설날 다음 날'),
('2019-03-01','3ㆍ1절'),
('2019-05-05','어린이날'),
('2019-05-06','대체공휴일(어린이날)'),
('2019-05-12','부처님 오신 날'),
('2019-06-06','현충일'),
('2019-08-15','광복절'),
('2019-09-12','추석 전날'),
('2019-09-13','추석'),
('2019-09-14','추석 다음 날'),
('2019-10-03','개천절'),
('2019-10-09','한글날'),
('2019-12-25','기독탄신일'),
('2020-01-01','1월 1일'),
('2020-01-24','설날 전날'),
('2020-01-25','설날'),
('2020-01-26','설날 다음 날'),
('2020-01-27','대체공휴일(설날)'),
('2020-03-01','3ㆍ1절'),
('2020-04-15','제21대 국회의원선거'),
('2020-04-30','부처님 오신 날'),
('2020-05-05','어린이날'),
('2020-06-06','현충일'),
('2020-08-15','광복절'),
('2020-08-17','임시공휴일'),
('2020-09-30','추석 전날'),
('2020-10-01','추석'),
('2020-10-02','추석 다음 날'),
('2020-10-03','개천절'),
('2020-10-09','한글날'),
('2020-12-25','기독탄신일'),
('2021-01-01','1월 1일'),
('2021-02-11','설날 전날'),
('2021-02-12','설날'),
('2021-02-13','설날 다음 날'),
('2021-03-01','3ㆍ1절'),
('2021-05-05','어린이날'),
('2021-05-19','부처님 오신 날'),
('2021-06-06','현충일'),
('2021-08-15','광복절'),
('2021-08-16','대체공휴일(광복절)'),
('2021-09-20','추석 전날'),
('2021-09-21','추석'),
('2021-09-22','추석 다음 날'),
('2021-10-03','개천절'),
('2021-10-04','대체공휴일(개천절)'),
('2021-10-09','한글날'),
('2021-10-11','대체공휴일(한글날)'),
('2021-12-25','기독탄신일'),
('2022-01-01','1월 1일'),
('2022-01-31','설날 전날'),
('2022-02-01','설날'),
('2022-02-02','설날 다음 날'),
('2022-03-01','3ㆍ1절'),
('2022-03-09','대통령선거'),
('2022-05-05','어린이날'),
('2022-05-08','부처님 오신 날'),
('2022-06-01','전국동시지방선거'),
('2022-06-06','현충일'),
('2022-08-15','광복절'),
('2022-09-09','추석 전날'),
('2022-09-10','추석'),
('2022-09-11','추석 다음 날'),
('2022-09-12','대체공휴일(추석)'),
('2022-10-03','개천절'),
('2022-10-09','한글날'),
('2022-10-10','대체공휴일(한글날)'),
('2022-12-25','기독탄신일'),
('2023-01-01','1월 1일'),
('2023-01-21','설날 전날'),
('2023-01-22','설날'),
('2023-01-23','설날 다음 날'),
('2023-01-24','대체공휴일(설날)'),
('2023-03-01','3ㆍ1절'),
('2023-05-05','어린이날'),
('2023-05-27','부처님 오신 날'),
('2023-05-29','대체공휴일(부처님 오신 날)'),
('2023-06-06','현충일'),
('2023-08-15','광복절'),
('2023-09-28','추석 전날'),
('2023-09-29','추석'),
('2023-09-30','추석 다음 날'),
('2023-10-02','임시공휴일'),
('2023-10-03','개천절'),
('2023-10-09','한글날'),
('2023-12-25','기독탄신일'),
('2024-01-01','1월 1일'),
('2024-02-09','설날 전날'),
('2024-02-10','설날'),
('2024-02-11','설날 다음 날'),
('2024-02-12','대체공휴일(설날)'),
('2024-03-01','3ㆍ1절'),
('2024-04-10','제22대국회의원선거'),
('2024-05-05','어린이날'),
('2024-05-06','대체공휴일(어린이날)'),
('2024-05-15','부처님 오신 날'),
('2024-06-06','현충일'),
('2024-08-15','광복절'),
('2024-09-16','추석 전날'),
('2024-09-17','추석'),
('2024-09-18','추석 다음 날'),
('2024-10-01','임시공휴일'),
('2024-10-03','개천절'),
('2024-10-09','한글날'),
('2024-12-25','기독탄신일'),
('2025-01-01','1월 1일'),
('2025-01-27','임시공휴일'),
('2025-01-28','설날 전날'),
('2025-01-29','설날'),
('2025-01-30','설날 다음 날'),
('2025-03-01','3ㆍ1절'),
('2025-03-03','대체공휴일(3ㆍ1절)'),
('2025-05-05','어린이날 · 부처님 오신 날'),
('2025-05-06','대체공휴일(부처님 오신 날)'),
('2025-06-03','임시공휴일(대통령선거)'),
('2025-06-06','현충일'),
('2025-08-15','광복절'),
('2025-10-03','개천절'),
('2025-10-05','추석 전날'),
('2025-10-06','추석'),
('2025-10-07','추석 다음 날'),
('2025-10-08','대체공휴일(추석)'),
('2025-10-09','한글날'),
('2025-12-25','기독탄신일'),
('2026-01-01','1월 1일'),
('2026-02-16','설날 전날'),
('2026-02-17','설날'),
('2026-02-18','설날 다음 날'),
('2026-03-01','3ㆍ1절'),
('2026-03-02','대체공휴일(3ㆍ1절)'),
('2026-05-01','노동절'),
('2026-05-05','어린이날'),
('2026-05-24','부처님 오신 날'),
('2026-05-25','대체공휴일(부처님 오신 날)'),
('2026-06-03','전국동시지방선거'),
('2026-06-06','현충일'),
('2026-07-17','제헌절'),
('2026-08-15','광복절'),
('2026-08-17','대체공휴일(광복절)'),
('2026-09-24','추석 전날'),
('2026-09-25','추석'),
('2026-09-26','추석 다음 날'),
('2026-10-03','개천절'),
('2026-10-05','대체공휴일(개천절)'),
('2026-10-09','한글날'),
('2026-12-25','기독탄신일'),
('2027-01-01','1월 1일'),
('2027-02-06','설날 전날'),
('2027-02-07','설날'),
('2027-02-08','설날 다음 날'),
('2027-02-09','대체공휴일(설날)'),
('2027-03-01','3ㆍ1절'),
('2027-05-01','노동절'),
('2027-05-03','대체공휴일(노동절)'),
('2027-05-05','어린이날'),
('2027-05-13','부처님 오신 날'),
('2027-06-06','현충일'),
('2027-07-17','제헌절'),
('2027-07-19','대체공휴일(제헌절)'),
('2027-08-15','광복절'),
('2027-08-16','대체공휴일(광복절)'),
('2027-09-14','추석 전날'),
('2027-09-15','추석'),
('2027-09-16','추석 다음 날'),
('2027-10-03','개천절'),
('2027-10-04','대체공휴일(개천절)'),
('2027-10-09','한글날'),
('2027-10-11','대체공휴일(한글날)'),
('2027-12-25','기독탄신일'),
('2027-12-27','대체공휴일(기독탄신일)');

create function app.leave_balance_days(kind text, first_day date, last_day date)
returns numeric language plpgsql stable set search_path = '' as $$
declare working_days integer;
begin
  if kind not in ('annual','half','quarter') or first_day is null or last_day is null
    or last_day < first_day or last_day - first_day > 365
    or (kind in ('half','quarter') and first_day <> last_day) then
    raise exception '연차 차감 기간을 확인해 주세요.';
  end if;
  if exists (
    select 1 from pg_catalog.generate_series(extract(year from first_day)::integer, extract(year from last_day)::integer) y(year)
    where not exists(select 1 from app.leave_balance_calendar_years c where c.year=y.year)
  ) then
    raise exception '해당 연도의 공휴일 기준이 없습니다. 운영지원에 문의해 주세요.';
  end if;
  select count(*) into working_days from pg_catalog.generate_series(0,last_day-first_day) n(day_offset)
  where extract(isodow from first_day+n.day_offset) between 1 and 5
    and not exists(select 1 from app.leave_balance_holidays h where h.day=first_day+n.day_offset);
  if working_days=0 then raise exception '주말·공휴일을 제외한 근무일에 휴가를 등록해 주세요.'; end if;
  return case kind when 'half' then 0.5 when 'quarter' then 0.25 else working_days end;
end $$;
revoke all on function app.leave_balance_days(text,date,date) from public, anon, authenticated;

-- Deductions/refunds do not certify an old balance as a new leave year's balance.
-- Explicit Operations Support balance saves retain their existing cycle behaviour.
create or replace function app.capture_leave_notice_balance_cycle()
returns trigger language plpgsql security definer set search_path = '' as $$
declare h date; c uuid; reset_on date;
begin
  if current_setting('app.leave_balance_sync',true)='on' then return new; end if;
  select hire_date, company_id into h,c from public.profiles where id = new.profile_id;
  reset_on := app.leave_notice_cycle(h,(now() at time zone 'Asia/Seoul')::date);
  if reset_on is not null and new.remaining_annual_leave is not null then
    insert into app.leave_notice_balance_cycles(employee_id,company_id,hire_date,expires_on)
      values(new.profile_id,c,h,reset_on-1)
      on conflict(employee_id) do update set company_id=excluded.company_id,hire_date=excluded.hire_date,expires_on=excluded.expires_on,recorded_at=now();
  end if;
  return new;
end $$;

-- Trigger-only privileged bookkeeping: no new client API or roster write grant.
-- Uses the existing internal roster import guard, scoped to this update and restored.
create function app.sync_leave_request_balance()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid(); amount numeric; balance numeric; refund boolean := false;
  previous_import text := current_setting('app.roster_import',true);
  previous_sync text := current_setting('app.leave_balance_sync',true);
begin
  if new.kind not in ('annual','half','quarter') then return new; end if;
  if TG_OP='INSERT' then
    if new.status<>'approved' then return new; end if;
  elsif not (old.status='approved' and new.status='cancelled') then
    return new;
  else
    refund := true;
  end if;
  if actor is null or actor<>new.employee_id or not exists (
    select 1 from public.profiles p where p.id=actor and p.status='active' and p.company_id=new.company_id
  ) then raise exception '본인의 휴가만 차감·복원할 수 있습니다.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,0));

  if refund then
    select e.days into amount from app.leave_balance_entries e
      where e.request_id=new.id and e.employee_id=actor and e.company_id=new.company_id and e.refunded_at is null for update;
    -- Existing requests were never debited by this system: cancellation must not add days.
    if not found then return new; end if;
  else
    amount := app.leave_balance_days(new.kind,new.from_date,new.to_date);
  end if;

  select r.remaining_annual_leave into balance from public.employee_roster r
    where r.profile_id=actor and r.company_id=new.company_id for update;
  if balance is null then raise exception '남은 연차가 등록되지 않았습니다. 운영지원에 잔여일 등록을 요청해 주세요.'; end if;
  if not refund and balance<amount then
    raise exception '남은 연차가 부족합니다. 잔여 %일 · 필요한 연차 %일',balance,amount;
  end if;

  if refund then
    update app.leave_balance_entries set refunded_at=clock_timestamp() where request_id=new.id;
  else
    insert into app.leave_balance_entries(request_id,employee_id,company_id,days) values(new.id,actor,new.company_id,amount);
  end if;

  perform pg_catalog.set_config('app.roster_import','on',true);
  perform pg_catalog.set_config('app.leave_balance_sync','on',true);
  update public.employee_roster set remaining_annual_leave=balance+case when refund then amount else -amount end
    where profile_id=actor and company_id=new.company_id;
  perform pg_catalog.set_config('app.roster_import',coalesce(previous_import,''),true);
  perform pg_catalog.set_config('app.leave_balance_sync',coalesce(previous_sync,''),true);
  return new;
exception when others then
  perform pg_catalog.set_config('app.roster_import',coalesce(previous_import,''),true);
  perform pg_catalog.set_config('app.leave_balance_sync',coalesce(previous_sync,''),true);
  raise;
end $$;
revoke all on function app.sync_leave_request_balance() from public, anon, authenticated;
create trigger company_leave_balance_sync after insert or update of status on public.company_leave_requests
  for each row execute function app.sync_leave_request_balance();
comment on column public.employee_roster.remaining_annual_leave is '운영지원이 등록한 잔여 일수에서 신규 연차·반차·반반차 등록 시 자동 차감하고 해당 등록 취소 시 복원. 기존 신청은 재차감하지 않음. 연차 부여·연도 초기화는 별도.';
commit;
