-- 근로자 명부의 개인정보는 profiles에 두지 않는다.
-- profiles 조회와 조직도 RPC가 더 넓은 범위에서 읽히기 때문이다.

create table public.employee_roster (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  company_id uuid not null references public.companies (id),
  phone text not null default '',
  bank_name text not null default '',
  bank_account text not null default '',
  resident_id text not null default '',
  home_address text not null default '',
  gmail text not null default '',
  naver_email text not null default '',
  workplace text not null default '',
  employment_type text not null default '',
  gender text not null default '',
  resigned_on date,
  job_description text not null default '',
  work_days text not null default '',
  work_hours text not null default '',
  break_time text not null default '',
  pay_basis text not null default '',
  annual_salary text not null default '',
  monthly_wage text not null default '',
  meal_allowance text not null default '',
  car_allowance text not null default '',
  childcare_allowance text not null default '',
  duty_allowance text not null default '',
  note text not null default '',
  extra text not null default '',
  updated_at timestamptz not null default now(),
  constraint employee_roster_phone_len check (char_length(phone) <= 40),
  constraint employee_roster_bank_name_len check (char_length(bank_name) <= 40),
  constraint employee_roster_bank_account_len check (char_length(bank_account) <= 40),
  constraint employee_roster_resident_len check (char_length(resident_id) <= 20),
  constraint employee_roster_address_len check (char_length(home_address) <= 300),
  constraint employee_roster_gmail_len check (char_length(gmail) <= 200),
  constraint employee_roster_naver_len check (char_length(naver_email) <= 200),
  constraint employee_roster_workplace_len check (char_length(workplace) <= 80),
  constraint employee_roster_employment_len check (char_length(employment_type) <= 40),
  constraint employee_roster_gender_len check (char_length(gender) <= 10),
  constraint employee_roster_job_len check (char_length(job_description) <= 200),
  constraint employee_roster_days_len check (char_length(work_days) <= 80),
  constraint employee_roster_hours_len check (char_length(work_hours) <= 80),
  constraint employee_roster_break_len check (char_length(break_time) <= 80),
  constraint employee_roster_pay_basis_len check (char_length(pay_basis) <= 40),
  constraint employee_roster_annual_len check (char_length(annual_salary) <= 20),
  constraint employee_roster_monthly_len check (char_length(monthly_wage) <= 30),
  constraint employee_roster_meal_len check (char_length(meal_allowance) <= 20),
  constraint employee_roster_car_len check (char_length(car_allowance) <= 20),
  constraint employee_roster_child_len check (char_length(childcare_allowance) <= 20),
  constraint employee_roster_duty_allow_len check (char_length(duty_allowance) <= 20),
  constraint employee_roster_note_len check (char_length(note) <= 500),
  constraint employee_roster_extra_len check (char_length(extra) <= 200)
);

alter table public.employee_roster enable row level security;

revoke all on public.employee_roster from public, anon, authenticated;
grant select, insert, update on public.employee_roster to authenticated;

create or replace function app.guard_employee_roster()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  company uuid;
  mine uuid;
begin
  select target.company_id
  into company
  from public.profiles as target
  where target.id = new.profile_id
    and target.status = 'active';

  if company is null then
    raise exception '같은 회사의 재직 직원만 기록할 수 있습니다.';
  end if;

  -- 엑셀 일괄 입력은 DB 관리 세션에서만 app.roster_import 를 켠다.
  -- 앱 사용자는 이 설정을 바꿀 SQL을 실행할 수 없다.
  if current_setting('app.roster_import', true) is distinct from 'on' then
    select me.company_id
    into mine
    from public.profiles as me
    where me.id = (select auth.uid())
      and me.status = 'active';

    if (select auth.uid()) is null
       or not (select app.can_edit_org_assignment())
       or company is distinct from mine then
      raise exception '운영지원만 같은 회사 근로자 명부를 저장할 수 있습니다.';
    end if;
  end if;

  new.company_id := company;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function app.guard_employee_roster() from public, anon, authenticated;

create trigger employee_roster_guard
before insert or update on public.employee_roster
for each row
execute function app.guard_employee_roster();

create policy employee_roster_org_editor
on public.employee_roster
for all
to authenticated
using (
  (select app.can_edit_org_assignment())
  and company_id = (
    select me.company_id
    from public.profiles as me
    where me.id = (select auth.uid())
      and me.status = 'active'
  )
)
with check (
  (select app.can_edit_org_assignment())
  and company_id = (
    select me.company_id
    from public.profiles as me
    where me.id = (select auth.uid())
      and me.status = 'active'
  )
  and exists (
    select 1
    from public.profiles as target
    where target.id = profile_id
      and target.company_id = company_id
      and target.status = 'active'
  )
);
