-- Add the classification beside the existing agreed overtime field.
-- Existing roster rows, leave balances, policies, grants and guards are preserved.
alter table public.employee_roster
  add column fixed_overtime_plan text not null default ''
    constraint employee_roster_fixed_overtime_plan_valid check (fixed_overtime_plan in ('', '유형 1', '유형 2'));
comment on column public.employee_roster.fixed_overtime_plan is '고정OT 설계 분류. 빈 값은 미설정이며 약정 연장근로시간과 별도로 보관한다.';
