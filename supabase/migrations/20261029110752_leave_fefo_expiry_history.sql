begin;
create table app.leave_base_periods (
  employee_id uuid not null references public.profiles(id), company_id uuid not null references public.companies(id),
  period_key text not null, ends_on date not null, opening_days numeric not null,
  primary key(employee_id,period_key)
);
create index leave_base_periods_company on app.leave_base_periods(company_id);
create table app.leave_lifecycle_events (
  id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.profiles(id),
  company_id uuid not null references public.companies(id), source_kind text not null check(source_kind in ('base','extra','allocation')),
  source_key text not null, kind text not null, days numeric not null,
  effective_on date not null, created_at timestamptz not null default clock_timestamp(), actor_id uuid references public.profiles(id), details jsonb not null default '{}'
);
create index leave_lifecycle_employee on app.leave_lifecycle_events(employee_id,created_at,id);
create index leave_lifecycle_company on app.leave_lifecycle_events(company_id,created_at);
create index leave_lifecycle_source on app.leave_lifecycle_events(employee_id,source_kind,source_key,kind);
alter table app.leave_base_periods enable row level security;
alter table app.leave_lifecycle_events enable row level security;
revoke all on app.leave_base_periods,app.leave_lifecycle_events from public,anon,authenticated;
-- Snapshot known current credits only. Do not replay or alter any existing leave or balance.
insert into app.leave_base_periods(employee_id,company_id,period_key,ends_on,opening_days)
select a.employee_id,a.company_id,a.cycle_start::text,a.cycle_end,r.remaining_annual_leave+coalesce((
 select sum((e.allocations->>a.cycle_start::text)::numeric) from app.leave_balance_entries e where e.employee_id=a.employee_id and e.refunded_at is null),0)
from app.employee_leave_accrual a join public.employee_roster r on r.profile_id=a.employee_id where r.remaining_annual_leave is not null;

create function app.fefo_budget(p_employee uuid,p_day date,p_capture boolean default false)
returns table(period_key text,ends_on date,available numeric) language plpgsql security definer set search_path='' as $$
declare s app.employee_leave_accrual%rowtype; c record; company uuid; opening numeric; spent numeric; current_key text;
begin
  select company_id into company from public.profiles where id=p_employee;
  select * into s from app.employee_leave_accrual where employee_id=p_employee;
  if found then
    select * into c from app.employee_leave_cycle(s.hire_date,p_day);
    if not found then raise exception '입사일 이전 연차입니다.'; end if;
    period_key:=c.starts_on::text;ends_on:=c.ends_on;current_key:=s.cycle_start::text;
    select coalesce(sum((e.allocations->>period_key)::numeric),0) into spent from app.leave_balance_entries e where e.employee_id=p_employee and e.refunded_at is null;
    if period_key=current_key and p_capture then
      select r.remaining_annual_leave+spent into opening from public.employee_roster r where r.profile_id=p_employee;
      insert into app.leave_base_periods values(p_employee,company,period_key,ends_on,opening)
      on conflict on constraint leave_base_periods_pkey do update set opening_days=excluded.opening_days;
    elsif c.starts_on>s.cycle_start then
      insert into app.leave_base_periods values(p_employee,company,period_key,ends_on,c.grant_days) on conflict do nothing;
    end if;
  else
    period_key:='legacy';ends_on:='infinity';
    select coalesce(sum(case when e.allocations is null then e.days-coalesce((select sum(u.days) from app.employee_extra_leave_usage u where u.request_id=e.request_id and u.refunded_at is null),0)
      else coalesce((e.allocations->>'legacy')::numeric,0) end),0) into spent from app.leave_balance_entries e where e.employee_id=p_employee and e.refunded_at is null;
    if p_capture then
      select r.remaining_annual_leave+spent into opening from public.employee_roster r where r.profile_id=p_employee;
      insert into app.leave_base_periods values(p_employee,company,period_key,ends_on,opening)
      on conflict on constraint leave_base_periods_pkey do update set opening_days=excluded.opening_days;
    end if;
  end if;
  select b.opening_days into opening from app.leave_base_periods b where b.employee_id=p_employee and b.period_key=fefo_budget.period_key;
  if not found or opening is null then raise exception '과거 연차 기간의 기준값이 없습니다. 운영지원 확인이 필요합니다.'; end if;
  available:=opening-spent;return next;
end $$;
revoke all on function app.fefo_budget(uuid,date,boolean) from public,anon,authenticated;

create function app.record_leave_expiry(p_employee uuid,p_today date)
returns void language plpgsql security definer set search_path='' as $$
declare item record; target numeric; prior numeric;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_employee::text,0));
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
   select coalesce(sum(e.days),0) into prior from app.leave_lifecycle_events e where e.employee_id=p_employee and e.source_kind=item.source_kind and e.source_key=item.source_key and e.kind in ('expired','expiry_adjustment');
   if target<>prior then
     insert into app.leave_lifecycle_events(employee_id,company_id,source_kind,source_key,kind,days,effective_on,actor_id,details)
     values(p_employee,item.company_id,item.source_kind,item.source_key,case when prior=0 then 'expired' else 'expiry_adjustment' end,target-prior,item.ends_on+1,auth.uid(),item.details);
   end if;
 end loop;
end $$;
revoke all on function app.record_leave_expiry(uuid,date) from public,anon,authenticated;

create function app.leave_past_shortfall(p_employee uuid,p_today date)
returns numeric language sql stable security definer set search_path='' as $$
 select coalesce(sum(greatest(coalesce((select sum((e.allocations->>b.period_key)::numeric) from app.leave_balance_entries e where e.employee_id=p_employee and e.refunded_at is null),0)-b.opening_days,0)),0)
 from app.leave_base_periods b where b.employee_id=p_employee and b.ends_on<p_today;
$$;
revoke all on function app.leave_past_shortfall(uuid,date) from public,anon,authenticated;

alter function app.refresh_employee_leave(uuid,date) rename to refresh_employee_leave_before_fefo;
create function app.refresh_employee_leave(p_employee uuid,p_today date)
returns void language plpgsql security definer set search_path='' as $$
declare s app.employee_leave_accrual%rowtype;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_employee::text,0));
 select * into s from app.employee_leave_accrual where employee_id=p_employee;
 -- Capture the old period before the existing renewal replaces its remaining balance.
 if found then perform app.fefo_budget(p_employee,s.cycle_start,true);
 elsif exists(select 1 from public.employee_roster where profile_id=p_employee and remaining_annual_leave is not null) then perform app.fefo_budget(p_employee,p_today,true); end if;
 perform app.refresh_employee_leave_before_fefo(p_employee,p_today);
 if exists(select 1 from public.employee_roster where profile_id=p_employee and remaining_annual_leave is not null) then perform app.fefo_budget(p_employee,p_today,true); end if;
 perform app.record_leave_expiry(p_employee,p_today);
end $$;
revoke all on function app.refresh_employee_leave(uuid,date),app.refresh_employee_leave_before_fefo(uuid,date) from public,anon,authenticated;

create or replace function app.allocate_extra_leave(p_request uuid,p_employee uuid,p_kind text,p_from date,p_to date,p_refund boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare day date; needed numeric; g record; b record; take numeric; base_take numeric; used_base jsonb:='{}'; result jsonb:='{}'; total numeric; budget numeric;
begin
 if p_refund then update app.employee_extra_leave_usage set refunded_at=clock_timestamp() where request_id=p_request and refunded_at is null;return result;end if;
 for day in select p_from+i from generate_series(0,p_to-p_from) n(i)
   where extract(isodow from p_from+i) between 1 and 5 and not exists(select 1 from app.leave_balance_holidays h where h.day=p_from+i) order by i loop
   needed:=case p_kind when 'half' then 0.5 when 'quarter' then 0.25 else 1 end;total:=0;
   select * into b from app.fefo_budget(p_employee,day,false);
   budget:=greatest(b.available-coalesce((used_base->>b.period_key)::numeric,0),0);
   for g in select e.id,e.days-coalesce(u.used,0) available,e.expires_on from app.employee_extra_leave e
     left join lateral(select sum(days) used from app.employee_extra_leave_usage where grant_id=e.id and refunded_at is null) u on true
     where e.employee_id=p_employee and e.deleted_at is null and e.granted_on<=day and e.expires_on>=day
     order by e.expires_on,e.created_at,e.id loop
     if b.ends_on<=g.expires_on and budget>0 then
       base_take:=least(budget,needed);needed:=needed-base_take;budget:=budget-base_take;
       used_base:=used_base||jsonb_build_object(b.period_key,coalesce((used_base->>b.period_key)::numeric,0)+base_take);
     end if;
     take:=least(needed,g.available);
     if take>0 then
       insert into app.employee_extra_leave_usage(request_id,grant_id,used_on,days,refunded_at) values(p_request,g.id,day,take,null)
       on conflict(request_id,grant_id,used_on) do update set days=excluded.days,refunded_at=null;
       needed:=needed-take;total:=total+take;
     end if;
     exit when needed=0;
   end loop;
   if needed>0 then used_base:=used_base||jsonb_build_object(b.period_key,coalesce((used_base->>b.period_key)::numeric,0)+needed);end if;
   result:=result||jsonb_build_object(day::text,total);
 end loop;
 return result;
end $$;

create function app.reallocate_employee_leave(p_employee uuid,p_today date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r record; s app.employee_leave_accrual%rowtype; extras jsonb; parts jsonb; current_key text; opening numeric; remaining numeric;
  old_import text:=current_setting('app.roster_import',true);old_sync text:=current_setting('app.leave_balance_sync',true);before_rows jsonb;after_rows jsonb;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_employee::text,0));
 perform app.refresh_employee_leave(p_employee,p_today);
 select * into s from app.employee_leave_accrual where employee_id=p_employee;
 current_key:=case when found then s.cycle_start::text else 'legacy' end;
 select b.opening_days into opening from app.leave_base_periods b where b.employee_id=p_employee and b.period_key=current_key;
 if opening is null then raise exception '기본 연차 기준값을 확인해 주세요.';end if;
 select jsonb_build_object('base',(select jsonb_agg(e order by request_id) from app.leave_balance_entries e where employee_id=p_employee),'extra',(select jsonb_agg(u order by request_id,grant_id,used_on) from app.employee_extra_leave_usage u join app.employee_extra_leave g on g.id=u.grant_id where g.employee_id=p_employee)) into before_rows;
 update app.leave_balance_entries set allocations='{}' where employee_id=p_employee and refunded_at is null;
 update app.employee_extra_leave_usage u set refunded_at=clock_timestamp() from app.employee_extra_leave g where g.id=u.grant_id and g.employee_id=p_employee and u.refunded_at is null;
 for r in select q.* from public.company_leave_requests q join app.leave_balance_entries e on e.request_id=q.id
   where e.employee_id=p_employee and e.refunded_at is null and q.status='approved' order by q.from_date,q.created_at,q.id loop
   extras:=app.allocate_extra_leave(r.id,p_employee,r.kind,r.from_date,r.to_date,false);
   if current_key='legacy' then
     select jsonb_build_object('legacy',app.leave_balance_days(r.kind,r.from_date,r.to_date)-coalesce(sum(value::numeric),0)) into parts from jsonb_each_text(extras);
   else
     select jsonb_object_agg(k,days) into parts from (
       select c.starts_on::text k,sum(case r.kind when 'half' then 0.5 when 'quarter' then 0.25 else 1 end-coalesce((extras->>(r.from_date+n.i)::text)::numeric,0)) days
       from generate_series(0,r.to_date-r.from_date) n(i) cross join lateral app.employee_leave_cycle(s.hire_date,r.from_date+n.i) c
       where extract(isodow from r.from_date+n.i) between 1 and 5 and not exists(select 1 from app.leave_balance_holidays h where h.day=r.from_date+n.i) group by c.starts_on
     ) q;
   end if;
   update app.leave_balance_entries set allocations=parts where request_id=r.id;
 end loop;
 select opening-coalesce(sum((e.allocations->>current_key)::numeric),0) into remaining from app.leave_balance_entries e where e.employee_id=p_employee and e.refunded_at is null;
 perform pg_catalog.set_config('app.roster_import','on',true);perform pg_catalog.set_config('app.leave_balance_sync','on',true);
 update public.employee_roster set remaining_annual_leave=remaining where profile_id=p_employee;
 perform pg_catalog.set_config('app.roster_import',coalesce(old_import,''),true);perform pg_catalog.set_config('app.leave_balance_sync',coalesce(old_sync,''),true);
 select jsonb_build_object('base',(select jsonb_agg(e order by request_id) from app.leave_balance_entries e where employee_id=p_employee),'extra',(select jsonb_agg(u order by request_id,grant_id,used_on) from app.employee_extra_leave_usage u join app.employee_extra_leave g on g.id=u.grant_id where g.employee_id=p_employee)) into after_rows;
 perform app.record_leave_expiry(p_employee,p_today);
 return jsonb_build_object('before',before_rows,'after',after_rows,'shortfall',app.leave_past_shortfall(p_employee,p_today));
exception when others then
 perform pg_catalog.set_config('app.roster_import',coalesce(old_import,''),true);perform pg_catalog.set_config('app.leave_balance_sync',coalesce(old_sync,''),true);raise;
end $$;
revoke all on function app.reallocate_employee_leave(uuid,date) from public,anon,authenticated;

create or replace function app.save_employee_extra_leave(p_id uuid,p_employee uuid,p_days numeric,p_expires date,p_note text,p_version integer,p_delete boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare company uuid; g app.employee_extra_leave%rowtype; used numeric; last_use date; changes jsonb; today date:=(now() at time zone 'Asia/Seoul')::date;
begin
  select company_id into company from public.profiles where id=auth.uid() and status='active';
  if company is null or not(app.can_edit_org_assignment() or app.basic_work_allowed('operations')) then raise exception '연차 관리 권한이 없습니다.' using errcode='42501'; end if;
  if p_id is null or p_employee is null or p_version is null or p_delete is null then raise exception '추가 연차 입력을 확인해 주세요.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_employee::text,0));
  if not exists(select 1 from public.profiles p join public.employee_roster r on r.profile_id=p.id and r.company_id=p.company_id
    where p.id=p_employee and p.company_id=company and p.status='active' and r.resigned_on is null and r.remaining_annual_leave is not null) then
    raise exception '재직 직원의 기본 잔여 연차를 먼저 등록해 주세요.'; end if;
  if p_delete and (p_note is null or length(btrim(p_note)) not between 1 and 500) then raise exception '부여 취소 사유를 입력해 주세요.'; end if;
  select * into g from app.employee_extra_leave where id=p_id for update;
  if found then
    if g.employee_id<>p_employee or g.company_id<>company then raise exception '해당 직원의 추가 연차가 아닙니다.' using errcode='42501'; end if;
    if g.deleted_at is not null and p_delete then return p_id; end if;
    -- Retry of the exact successful write is safe; stale differing writes fail.
    if not p_delete and g.deleted_at is null and g.version=p_version+1 and g.days=p_days and g.expires_on=p_expires and g.note=btrim(p_note) then return p_id; end if;
    if g.version<>p_version or g.deleted_at is not null then raise exception '다른 변경이 있습니다. 다시 조회한 뒤 수정해 주세요.' using errcode='40001'; end if;
    select coalesce(sum(days),0),max(used_on) into used,last_use from app.employee_extra_leave_usage where grant_id=p_id and refunded_at is null;
    if p_delete then

      update app.employee_extra_leave set deleted_at=clock_timestamp(),updated_at=clock_timestamp(),updated_by=auth.uid(),version=version+1 where id=p_id;
      changes:=app.reallocate_employee_leave(p_employee,today);
      insert into app.leave_lifecycle_events(employee_id,company_id,source_kind,source_key,kind,days,effective_on,actor_id,details)
      values(p_employee,company,'extra',p_id::text,'revoked',-g.days,today,auth.uid(),jsonb_build_object('reason',btrim(p_note),'note',g.note,'grantBefore',to_jsonb(g),'allocation',changes));
      perform app.record_leave_expiry(p_employee,today);
  return p_id;
    end if;
  else
    if p_version<>0 or p_delete then raise exception '추가 연차를 다시 조회해 주세요.'; end if;
    used:=0;
  end if;
  if p_days is null or p_days::text in ('NaN','Infinity','-Infinity') or p_days<=0 or p_days>99999.99 or p_days<>round(p_days,2)
    or p_expires is null or p_note is null or length(btrim(p_note)) not between 1 and 500 then raise exception '일수·사용 기한·사유를 확인해 주세요.'; end if;
  if p_expires<coalesce(g.granted_on,(now() at time zone 'Asia/Seoul')::date) then
    raise exception '사용·예약 일수나 날짜보다 적게 줄일 수 없습니다.'; end if;
  if g.id is null then
    insert into app.employee_extra_leave(id,employee_id,company_id,days,expires_on,note,created_by,updated_by)
      values(p_id,p_employee,company,p_days,p_expires,btrim(p_note),auth.uid(),auth.uid());
  else update app.employee_extra_leave set days=p_days,expires_on=p_expires,note=btrim(p_note),updated_at=clock_timestamp(),updated_by=auth.uid(),version=version+1 where id=p_id; end if;
  if g.id is not null then changes:=app.reallocate_employee_leave(p_employee,today); end if;
  insert into app.leave_lifecycle_events(employee_id,company_id,source_kind,source_key,kind,days,effective_on,actor_id,details)
  values(p_employee,company,'extra',p_id::text,case when g.id is null then 'granted' else 'edited' end,p_days-coalesce(g.days,0),today,auth.uid(),
    jsonb_build_object('note',btrim(p_note),'expires',p_expires,'grantBefore',to_jsonb(g),'allocation',changes));
  perform app.record_leave_expiry(p_employee,today);
  return p_id;
end $$;
create or replace function app.sync_leave_request_balance()
returns trigger language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); amount numeric; charge numeric; balance numeric; refund boolean:=false;
  s app.employee_leave_accrual%rowtype; extras jsonb; extra_total numeric:=0; parts jsonb; part record; budget numeric; reserved numeric;
  previous_import text:=current_setting('app.roster_import',true); previous_sync text:=current_setting('app.leave_balance_sync',true);
begin
  if new.kind not in ('annual','half','quarter') then return new; end if;
  if TG_OP='INSERT' then
    if new.status<>'approved' then return new; end if;
  elsif not (old.status='approved' and new.status='cancelled') then return new;
  else refund:=true; end if;
  if actor is null or actor<>new.employee_id or not exists(select 1 from public.profiles p where p.id=actor and p.status='active' and p.company_id=new.company_id) then
    raise exception '본인의 휴가만 차감·복원할 수 있습니다.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,0));
  perform app.refresh_employee_leave(actor,(now() at time zone 'Asia/Seoul')::date);

  if refund then
    select days,allocations into amount,parts from app.leave_balance_entries
      where request_id=new.id and employee_id=actor and company_id=new.company_id and refunded_at is null for update;
    if not found then return new; end if;
  else amount:=app.leave_balance_days(new.kind,new.from_date,new.to_date); end if;

  if refund then
    select coalesce(sum(days),0) into extra_total from app.employee_extra_leave_usage where request_id=new.id and refunded_at is null;
    perform app.allocate_extra_leave(new.id,actor,new.kind,new.from_date,new.to_date,true);
  else
    extras:=app.allocate_extra_leave(new.id,actor,new.kind,new.from_date,new.to_date,false);
    select coalesce(sum(value::numeric),0) into extra_total from jsonb_each_text(extras);
  end if;

  select * into s from app.employee_leave_accrual where employee_id=actor;
  charge:=amount-extra_total;
  if found then
    if not refund then
      if new.from_date<s.hire_date then raise exception '입사일 이전 휴가를 등록할 수 없습니다.'; end if;
      select jsonb_object_agg(k,days) into parts from (
        select c.starts_on::text k,sum(case new.kind when 'half' then 0.5 when 'quarter' then 0.25 else 1 end - coalesce((extras->>(new.from_date+n.i)::text)::numeric,0)) days
        from pg_catalog.generate_series(0,new.to_date-new.from_date) n(i)
        cross join lateral app.employee_leave_cycle(s.hire_date,new.from_date+n.i) c
        where extract(isodow from new.from_date+n.i) between 1 and 5
          and not exists(select 1 from app.leave_balance_holidays h where h.day=new.from_date+n.i)
        group by c.starts_on
      ) q;
      -- Future bookings reserve that future period instead of consuming this year's balance.
      for part in select key,value::numeric days from jsonb_each_text(parts) loop
        if part.key::date>s.cycle_start then
          select grant_days into budget from app.employee_leave_cycle(s.hire_date,part.key::date);
          select coalesce(sum((allocations->>part.key)::numeric),0) into reserved from app.leave_balance_entries
            where employee_id=actor and company_id=new.company_id and refunded_at is null;
          if part.days>0 and reserved+part.days>budget then raise exception '다음 연차 기간의 남은 연차가 부족합니다.'; end if;
        end if;
      end loop;
    end if;
    charge:=coalesce((parts->>s.cycle_start::text)::numeric,0);
  end if;
  select remaining_annual_leave into balance from public.employee_roster where profile_id=actor and company_id=new.company_id for update;
  if balance is null then raise exception '남은 연차가 등록되지 않았습니다. 운영지원에 잔여일 등록을 요청해 주세요.'; end if;
  if not refund and balance<charge and charge>0 then raise exception '남은 연차가 부족합니다. 잔여 %일 · 필요한 연차 %일',balance,charge; end if;

  if refund then update app.leave_balance_entries set refunded_at=clock_timestamp() where request_id=new.id;
  else insert into app.leave_balance_entries(request_id,employee_id,company_id,days,allocations) values(new.id,actor,new.company_id,amount,parts); end if;
  perform pg_catalog.set_config('app.roster_import','on',true);
  perform pg_catalog.set_config('app.leave_balance_sync','on',true);
  update public.employee_roster set remaining_annual_leave=balance+case when refund then charge else -charge end where profile_id=actor and company_id=new.company_id;
  perform pg_catalog.set_config('app.roster_import',coalesce(previous_import,''),true);
  perform pg_catalog.set_config('app.leave_balance_sync',coalesce(previous_sync,''),true);
  perform app.record_leave_expiry(actor,(now() at time zone 'Asia/Seoul')::date);
  return new;
exception when others then
  perform pg_catalog.set_config('app.roster_import',coalesce(previous_import,''),true);
  perform pg_catalog.set_config('app.leave_balance_sync',coalesce(previous_sync,''),true);
  raise;
end $$;
create or replace function app.get_my_attendance_basis(p_month date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := auth.uid(); company uuid; department uuid;
begin
  if actor is null then raise exception '로그인이 필요합니다.' using errcode = '42501'; end if;
  if p_month is null or extract(day from p_month) <> 1 then raise exception '조회 월을 확인해 주세요.'; end if;
  select p.company_id, p.department_id into company, department
    from public.profiles p where p.id = actor and p.status = 'active';
  if company is null then raise exception '재직 중인 직원만 조회할 수 있습니다.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'departmentId', department,
    'remainingAnnualLeave', (
      select r.remaining_annual_leave + app.extra_leave_available(actor,(now() at time zone 'Asia/Seoul')::date)-app.leave_past_shortfall(actor,(now() at time zone 'Asia/Seoul')::date) from public.employee_roster r
      where r.profile_id = actor and r.company_id = company
    ),
    'settings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'month', s.month,
        'departmentId', s.department_id,
        'employeeId', s.employee_id,
        'source', s.source,
        'start', s.start_time,
        'grace', s.grace_minutes
      ) order by s.employee_id nulls last, s.id)
      from public.attendance_start_settings s
      where s.company_id = company and s.month = p_month
        and (s.employee_id = actor or (s.employee_id is null and s.department_id = department))
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function app.save_employee_leave_total(p_employee uuid,p_total numeric)
returns void language plpgsql security definer set search_path='' as $$
declare company uuid; bonus numeric; old_import text:=current_setting('app.roster_import',true);
begin
  select company_id into company from public.profiles where id=auth.uid() and status='active';
  if company is null or not(app.can_edit_org_assignment() or app.basic_work_allowed('operations')) then raise exception '연차 관리 권한이 없습니다.' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_employee::text,0));
  if not exists(select 1 from public.profiles where id=p_employee and company_id=company and status='active') then raise exception '직원을 확인해 주세요.'; end if;
  bonus:=app.extra_leave_available(p_employee,(now() at time zone 'Asia/Seoul')::date)-app.leave_past_shortfall(p_employee,(now() at time zone 'Asia/Seoul')::date);
  if p_total is null and bonus<>0 then raise exception '추가 연차가 있는 직원은 잔여값을 비울 수 없습니다.'; end if;
  if p_total is not null and (p_total::text in ('NaN','Infinity','-Infinity') or abs(p_total)>99999.99 or p_total<>round(p_total,2) or abs(p_total-bonus)>99999.99) then raise exception '잔여 일수를 확인해 주세요.'; end if;
  perform pg_catalog.set_config('app.roster_import','on',true);
  insert into public.employee_roster(profile_id,company_id,remaining_annual_leave) values(p_employee,company,p_total-bonus)
    on conflict(profile_id) do update set remaining_annual_leave=excluded.remaining_annual_leave;
  perform pg_catalog.set_config('app.roster_import',coalesce(old_import,''),true);
exception when others then perform pg_catalog.set_config('app.roster_import',coalesce(old_import,''),true); raise;
end $$;

alter function app.employee_extra_leave_records() rename to employee_extra_leave_records_before_fefo;
revoke all on function app.employee_extra_leave_records_before_fefo() from public,anon,authenticated;
create function app.employee_extra_leave_records()
returns jsonb language plpgsql security definer set search_path='' as $$
declare payload jsonb; employee record; company uuid; today date:=(now() at time zone 'Asia/Seoul')::date;
begin
 payload:=app.employee_extra_leave_records_before_fefo(); -- Existing management and company gate.
 select company_id into company from public.profiles where id=auth.uid() and status='active';
 for employee in select p.id from public.profiles p where p.company_id=company and p.status='active' order by p.id loop
   perform app.record_leave_expiry(employee.id,today);
 end loop;
 return payload||jsonb_build_object('fefoReady',true,'balances',coalesce((select jsonb_agg(jsonb_build_object('profileId',p.id,'available',app.extra_leave_available(p.id,today),'shortfall',app.leave_past_shortfall(p.id,today)))
   from public.profiles p where p.company_id=company and p.status='active'),'[]'::jsonb),
   'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'employeeId',e.employee_id,'source',e.source_kind,'kind',e.kind,'days',e.days,'date',e.effective_on,
      'recordedAt',e.created_at,'note',e.details->>'note','reason',e.details->>'reason','expires',e.details->>'expires','actorName',p.display_name,'recalculated',e.details->'allocation' is not null) order by e.created_at desc,e.id)
    from app.leave_lifecycle_events e left join public.profiles p on p.id=e.actor_id where e.company_id=company),'[]'::jsonb));
end $$;
revoke all on function app.employee_extra_leave_records() from public,anon;
grant execute on function app.employee_extra_leave_records() to authenticated;
alter function public.employee_extra_leave_records() volatile;

-- The existing midnight job keeps its schedule and also records extra-only expiry.
create or replace function app.refresh_company_leave_balances()
returns void language plpgsql security definer set search_path='' as $$
declare employee record;
begin
 for employee in select p.id from public.profiles p join public.employee_roster r on r.profile_id=p.id and r.resigned_on is null where p.status='active' and (
    exists(select 1 from app.employee_leave_accrual a where a.employee_id=p.id)
    or exists(select 1 from app.employee_extra_leave g where g.employee_id=p.id)) order by p.id loop
   begin perform app.refresh_employee_leave(employee.id,(now() at time zone 'Asia/Seoul')::date);
   exception when others then raise warning 'leave-fefo employee %: %',employee.id,sqlerrm;end;
 end loop;
end $$;
revoke all on function app.refresh_company_leave_balances() from public,anon,authenticated;
commit;
