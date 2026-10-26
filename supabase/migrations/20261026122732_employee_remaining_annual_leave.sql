-- 직원 명부의 기존 RLS·개인정보·사용자 상태는 변경하지 않는다.
alter table public.employee_roster add column remaining_annual_leave numeric(7,2);
comment on column public.employee_roster.remaining_annual_leave is '연차 대장에서 확인해 등록한 잔여 일수. NULL은 미등록이며 0과 음수를 보존한다. 신청 자동 차감과는 별도 값.';
