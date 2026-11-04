begin;

-- Keep reconciliation on every read (including date rollover and late cron
-- catch-up). Do not add a TTL, alter credits/permissions, or change the cron.
-- Only employees who actually need a birthday grant take the employee lock.
create or replace function app.ensure_employee_birthday_leave(p_employee uuid,p_today date)
returns void language plpgsql security definer set search_path='' as $$
declare employee record; y integer; birthday date; grant_id uuid; reason text;
begin
  if p_today is null then return; end if;
  if not exists (
    select 1 from public.profiles p
    join public.employee_roster r on r.profile_id=p.id and r.company_id=p.company_id
    cross join lateral generate_series(extract(year from p_today)::integer-1,
      extract(year from p_today)::integer+1) years(y)
    cross join lateral (select app.birthday_in_year(r.resident_id,years.y) as birthday_date) b
    where p.id=p_employee and p.status='active' and r.resigned_on is null
      and p_today between b.birthday_date-7 and b.birthday_date+7
      and not exists(select 1 from app.employee_extra_leave g
        where g.employee_id=p_employee and g.grant_source='birthday' and g.birthday_year=years.y)
  ) then return; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_employee::text,0));
  -- Re-read eligibility after waiting. The unique key includes cancelled grants;
  -- cancellation must not cause the same birthday credit to be reissued.
  select p.company_id,r.resident_id into employee from public.profiles p
    join public.employee_roster r on r.profile_id=p.id and r.company_id=p.company_id
    where p.id=p_employee and p.status='active' and r.resigned_on is null;
  if not found then return; end if;
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

-- First pass is read-only. If a delta exists, lock and calculate the complete
-- delta again from a fresh READ COMMITTED snapshot before writing any history.
create or replace function app.record_leave_expiry(p_employee uuid,p_today date)
returns void language plpgsql security definer set search_path='' as $$
declare item record; target numeric; prior numeric; pass integer; needs_lock boolean;
begin
 for pass in 1..2 loop
  needs_lock:=false;
  for item in
    select b.company_id,'base'::text source_kind,b.period_key source_key,b.ends_on,
      greatest(b.opening_days-coalesce((select sum((e.allocations->>b.period_key)::numeric) from app.leave_balance_entries e where e.employee_id=p_employee and e.refunded_at is null),0),0) remainder,
      jsonb_build_object('period',b.period_key,'expires',b.ends_on) details
    from app.leave_base_periods b where b.employee_id=p_employee and b.ends_on<p_today
    union all
    select g.company_id,'extra',g.id::text,g.expires_on,
      case when g.deleted_at is not null then 0 else greatest(g.days-coalesce((select sum(u.days) from app.employee_extra_leave_usage u where u.grant_id=g.id and u.refunded_at is null),0),0) end,
      jsonb_build_object('note',g.note,'expires',g.expires_on)
    from app.employee_extra_leave g where g.employee_id=p_employee and g.expires_on<p_today
  loop
    target:=-item.remainder;
    select coalesce(sum(e.days),0) into prior from app.leave_lifecycle_events e
      where e.employee_id=p_employee and e.source_kind=item.source_kind and e.source_key=item.source_key
        and e.kind in ('expired','expiry_adjustment');
    if target<>prior then
      if pass=1 then needs_lock:=true; exit; end if;
      insert into app.leave_lifecycle_events(employee_id,company_id,source_kind,source_key,kind,days,effective_on,actor_id,details)
      values(p_employee,item.company_id,item.source_kind,item.source_key,case when prior=0 then 'expired' else 'expiry_adjustment' end,target-prior,item.ends_on+1,auth.uid(),item.details);
    end if;
  end loop;
  if not needs_lock then return; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_employee::text,0));
 end loop;
end $$;

create or replace function app.refresh_employee_leave_before_birthday(p_employee uuid,p_today date)
returns void language plpgsql security definer set search_path='' as $$
declare s app.employee_leave_accrual%rowtype; refreshed app.employee_leave_accrual%rowtype;
  before_remaining numeric; after_remaining numeric; captured boolean:=false;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_employee::text,0));
 select r.remaining_annual_leave into before_remaining from public.employee_roster r where r.profile_id=p_employee;
 select * into s from app.employee_leave_accrual where employee_id=p_employee;
 -- Always capture the old period before renewal can replace its balance.
 if found then
   perform app.fefo_budget(p_employee,s.cycle_start,true);
   captured:=p_today between s.cycle_start and s.cycle_end;
 elsif before_remaining is not null then
   perform app.fefo_budget(p_employee,p_today,true);captured:=true;
 end if;
 perform app.refresh_employee_leave_before_fefo(p_employee,p_today);
 select * into refreshed from app.employee_leave_accrual where employee_id=p_employee;
 select r.remaining_annual_leave into after_remaining from public.employee_roster r where r.profile_id=p_employee;
 -- A rollover/monthly credit still captures the new budget. Only a provably
 -- identical second capture in this same locked call is omitted.
 if after_remaining is not null and (not captured or s is distinct from refreshed
   or before_remaining is distinct from after_remaining) then
   perform app.fefo_budget(p_employee,p_today,true);
 end if;
 perform app.record_leave_expiry(p_employee,p_today);
end $$;

-- Preserve the existing management gate and payload, without constructing the
-- pre-FEFO balances that the next wrapper immediately overwrote. Internal older
-- wrappers remain in place for compatibility, with their ACLs unchanged.
create or replace function app.employee_extra_leave_records()
returns jsonb language plpgsql security definer set search_path='' as $$
declare company uuid; employee record; today date:=(now() at time zone 'Asia/Seoul')::date;
begin
 select company_id into company from public.profiles where id=auth.uid() and status='active';
 if company is null or not(app.can_edit_org_assignment() or app.basic_work_allowed('operations')) then
   raise exception '연차 관리 권한이 없습니다.' using errcode='42501'; end if;
 for employee in select p.id from public.profiles p where p.company_id=company and p.status='active' order by p.id loop
   -- All company-wide writers acquire employee locks in the same UUID order.
   -- Do not split birthday and expiry into separate loops: selective birthday
   -- locks could otherwise acquire B before an expiry lock for A (A < B).
   perform app.ensure_employee_birthday_leave(employee.id,today);
   perform app.record_leave_expiry(employee.id,today);
 end loop;
 return jsonb_build_object('ready',true,'fefoReady',true,
   'entries',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'employeeId',g.employee_id,'days',g.days,'expires',g.expires_on,'note',g.note,
     'created',g.granted_on,'version',g.version,'used',coalesce(u.used,0)) order by g.created_at desc,g.id)
     from app.employee_extra_leave g
     left join lateral(select sum(days) used from app.employee_extra_leave_usage where grant_id=g.id and refunded_at is null) u on true
     where g.company_id=company and g.deleted_at is null),'[]'::jsonb),
   'balances',coalesce((select jsonb_agg(jsonb_build_object('profileId',p.id,'available',app.extra_leave_available(p.id,today),'shortfall',app.leave_past_shortfall(p.id,today)))
     from public.profiles p where p.company_id=company and p.status='active'),'[]'::jsonb),
   'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'employeeId',e.employee_id,'source',e.source_kind,'kind',e.kind,'days',e.days,'date',e.effective_on,
     'recordedAt',e.created_at,'note',e.details->>'note','reason',e.details->>'reason','expires',e.details->>'expires','actorName',p.display_name,'recalculated',e.details->'allocation' is not null) order by e.created_at desc,e.id)
     from app.leave_lifecycle_events e left join public.profiles p on p.id=e.actor_id where e.company_id=company),'[]'::jsonb));
end $$;

commit;
