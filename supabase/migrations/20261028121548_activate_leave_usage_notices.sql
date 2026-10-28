-- Enable only the existing Atelier company. No employee, balance or permission rows change.
insert into app.leave_notice_settings(company_id,enabled,enabled_at)
select id,true,now() from public.companies where id='e0000000-0000-4000-8000-000000000001';

insert into app.leave_notice_balance_cycles(employee_id,company_id,hire_date,expires_on)
select p.id,p.company_id,p.hire_date,app.leave_notice_cycle(p.hire_date,(now() at time zone 'Asia/Seoul')::date)-1
from public.profiles p join public.employee_roster r on r.profile_id=p.id and r.company_id=p.company_id
where p.company_id='e0000000-0000-4000-8000-000000000001' and p.status='active'
  and r.remaining_annual_leave is not null and p.hire_date <= (now() at time zone 'Asia/Seoul')::date;

-- pg_cron is already installed. UTC midnight = 09:00 Asia/Seoul.
do $$ begin
  if exists(select 1 from cron.job where jobname='atelier-leave-usage-notices') then
    raise exception '연차 안내 작업 이름이 이미 사용 중입니다. 기존 작업을 덮어쓰지 않습니다.';
  end if;
end $$;
select cron.schedule('atelier-leave-usage-notices','0 0 * * *','select app.dispatch_leave_usage_notices();');
-- One real initial delivery, latest due stage only. Subsequent runs are idempotent.
select app.dispatch_leave_usage_notices();
