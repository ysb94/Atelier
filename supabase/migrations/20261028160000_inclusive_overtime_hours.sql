-- 직원 명부의 기존 값·권한은 바꾸지 않고 약정 연장근로시간만 추가한다.
alter table public.employee_roster add column inclusive_overtime_hours numeric(7,2);
comment on column public.employee_roster.inclusive_overtime_hours is '포괄임금에 포함된 약정 연장근로시간(시간). NULL은 미등록이며 0은 포함 연장이 없다는 뜻이다. 월 추가 근무가 이 시간을 넘으면 추가수당 대상이다.';
