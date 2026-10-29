begin;
-- Existing manual grants and their allocations are unchanged. System grants do
-- not pretend that the employee or the manager performed the automatic action.
alter table app.employee_extra_leave
  add column grant_source text not null default 'manual',
  add column birthday_year integer,
  alter column created_by drop not null,
  alter column updated_by drop not null,
  add constraint extra_leave_source_check check (
    (grant_source='manual' and birthday_year is null and created_by is not null and updated_by is not null)
    or (grant_source='birthday' and birthday_year is not null and birthday_year between 1900 and 9998)
  );
-- Include revoked grants: a manager's revocation must not trigger a new gift.
create unique index employee_birthday_leave_once
  on app.employee_extra_leave(employee_id,birthday_year) where grant_source='birthday';

create function app.birthday_in_year(p_resident text,p_year integer)
returns date language plpgsql immutable set search_path='' as $$
declare prefix text; m integer; d integer; month_end date;
begin
  if p_year is null or p_year not between 1900 and 9998 then return null; end if;
  prefix:=substring(regexp_replace(coalesce(p_resident,''),'[[:space:]-]','','g') from '^([0-9]{6})');
  if prefix is null then return null; end if;
  m:=substring(prefix from 3 for 2)::integer; d:=substring(prefix from 5 for 2)::integer;
  if m not between 1 and 12 or d<1 then return null; end if;
  -- Validate against a leap year first; never normalize invalid dates (e.g. 04/31).
  if d>extract(day from (make_date(2000,m,1)+interval '1 month - 1 day')) then return null; end if;
  month_end:=(make_date(p_year,m,1)+interval '1 month - 1 day')::date;
  return make_date(p_year,m,least(d,extract(day from month_end)::integer));
end $$;
revoke all on function app.birthday_in_year(text,integer) from public,anon,authenticated;

create function app.ensure_employee_birthday_leave(p_employee uuid,p_today date)
returns void language plpgsql security definer set search_path='' as $$
declare employee record; y integer; birthday date; grant_id uuid; reason text;
begin
  if p_today is null then return; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_employee::text,0));
  select p.company_id,r.resident_id into employee from public.profiles p
    join public.employee_roster r on r.profile_id=p.id and r.company_id=p.company_id
    where p.id=p_employee and p.status='active' and r.resigned_on is null;
  if not found then return; end if;
  -- Adjacent years cover December/January windows. Expired past birthdays are
  -- never backfilled; a delayed daily job catches up only inside the valid window.
  for y in (extract(year from p_today)::integer-1)..(extract(year from p_today)::integer+1) loop
    birthday:=app.birthday_in_year(employee.resident_id,y);
    if birthday is null or p_today< birthday-7 or p_today>birthday+7 then continue; end if;
    grant_id:=null;
    reason:=y::text||'년 생일 반차 · '||to_char(birthday-7,'YY.MM.DD')||'~'||to_char(birthday+7,'YY.MM.DD')||' 사용 · 자동 부여';
    insert into app.employee_extra_leave(id,employee_id,company_id,days,granted_on,expires_on,note,created_by,updated_by,grant_source,birthday_year)
      values(gen_random_uuid(),p_employee,employee.company_id,0.5,birthday-7,birthday+7,reason,null,null,'birthday',y)
      on conflict(employee_id,birthday_year) where grant_source='birthday' do nothing returning id into grant_id;
    if grant_id is not null then
      insert into app.leave_lifecycle_events(employee_id,company_id,source_kind,source_key,kind,days,effective_on,actor_id,details)
        values(p_employee,employee.company_id,'extra',grant_id::text,'granted',0.5,birthday-7,null,
          jsonb_build_object('note',reason,'expires',birthday+7,'source','birthday','birthdayYear',y));
    end if;
  end loop;
end $$;
revoke all on function app.ensure_employee_birthday_leave(uuid,date) from public,anon,authenticated;

-- Preserve the existing base accrual, negative balance policy and FEFO allocator.
alter function app.refresh_employee_leave(uuid,date) rename to refresh_employee_leave_before_birthday;
revoke all on function app.refresh_employee_leave_before_birthday(uuid,date) from public,anon,authenticated;
create function app.refresh_employee_leave(p_employee uuid,p_today date)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform app.ensure_employee_birthday_leave(p_employee,p_today);
  perform app.refresh_employee_leave_before_birthday(p_employee,p_today);
end $$;
revoke all on function app.refresh_employee_leave(uuid,date) from public,anon,authenticated;

alter function app.employee_extra_leave_records() rename to employee_extra_leave_records_before_birthday;
revoke all on function app.employee_extra_leave_records_before_birthday() from public,anon,authenticated;
create function app.employee_extra_leave_records()
returns jsonb language plpgsql security definer set search_path='' as $$
declare company uuid; employee record;
begin
  select company_id into company from public.profiles where id=auth.uid() and status='active';
  if company is null or not(app.can_edit_org_assignment() or app.basic_work_allowed('operations')) then
    raise exception '연차 관리 권한이 없습니다.' using errcode='42501'; end if;
  for employee in select p.id from public.profiles p where p.company_id=company and p.status='active' order by p.id loop
    perform app.ensure_employee_birthday_leave(employee.id,(now() at time zone 'Asia/Seoul')::date);
  end loop;
  return app.employee_extra_leave_records_before_birthday();
end $$;
revoke all on function app.employee_extra_leave_records() from public,anon;
grant execute on function app.employee_extra_leave_records() to authenticated;

-- Reuse the existing KST midnight job; also cover employees without an accrual
-- setup. No initial refresh/backfill runs as part of this migration.
create or replace function app.refresh_company_leave_balances()
returns void language plpgsql security definer set search_path='' as $$
declare employee record;
begin
  for employee in select p.id from public.profiles p join public.employee_roster r
    on r.profile_id=p.id and r.company_id=p.company_id and r.resigned_on is null
    where p.status='active' order by p.id loop
    begin perform app.refresh_employee_leave(employee.id,(now() at time zone 'Asia/Seoul')::date);
    exception when others then raise warning 'leave-birthday employee %: %',employee.id,sqlerrm; end;
  end loop;
end $$;
revoke all on function app.refresh_company_leave_balances() from public,anon,authenticated;
commit;
