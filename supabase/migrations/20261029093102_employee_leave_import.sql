begin;
-- Current Excel grant/balance snapshot only. No historical leave applications are imported.
alter table public.employee_roster add column accrued_annual_leave numeric(7,2)
  check (accrued_annual_leave is null or accrued_annual_leave >= 0);
comment on column public.employee_roster.accrued_annual_leave is '확인된 연차 기간의 발생일수. 기존 직원의 미등록 값은 null로 보존.';

commit;
