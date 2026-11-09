-- Include the current month in the existing daily reminder job.
create or replace function app.dispatch_attendance_start_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  stamp timestamp := clock_timestamp() at time zone 'Asia/Seoul';
  today date := stamp::date;
  current_month date := date_trunc('month', stamp)::date;
  next_month date := (current_month + interval '1 month')::date;
  reminder record;
  progress record;
  changed integer := 0;
begin
  if stamp::time < time '09:00' then return 0; end if;
  if not pg_try_advisory_xact_lock(182574, 903) then return 0; end if;

  insert into app.attendance_start_reminders(company_id, department_id, target_month)
  select d.company_id, d.id, m.target_month
  from public.departments d
  cross join (values (current_month), (next_month)) as m(target_month)
  where d.is_active
    and (m.target_month = current_month or today >= next_month - 7)
  on conflict (company_id, department_id, target_month) do nothing;

  for reminder in
    select n.*
    from app.attendance_start_reminders n
    where n.current or n.target_month >= current_month
    order by n.company_id, n.department_id, n.target_month
  loop
    select * into progress
    from app.attendance_start_progress(reminder.company_id, reminder.department_id, reminder.target_month);

    if not exists (
      select 1 from public.departments d
      where d.id = reminder.department_id and d.company_id = reminder.company_id and d.is_active
    ) then
      progress.missing := 0;
    end if;

    if progress.missing > 0 and (reminder.issued_on is distinct from today or not reminder.current) then
      update app.attendance_start_reminders
      set current = true, issued_on = today, version = version + 1
      where id = reminder.id;
      changed := changed + 1;
    elsif progress.missing = 0 and reminder.current then
      update app.attendance_start_reminders set current = false where id = reminder.id;
    end if;
  end loop;

  return changed;
end;
$function$;

-- Use the normal time and deduplication checks for the first current-month run.
select app.dispatch_attendance_start_reminders();
