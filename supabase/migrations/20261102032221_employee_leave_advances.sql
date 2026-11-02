begin;
-- Opt-in only. No existing balance, request, policy, grant or personnel row is updated.
alter table public.company_leave_requests add column advance_requested boolean not null default false;
create table app.leave_advance_limits (
 employee_id uuid primary key references public.profiles(id), company_id uuid not null references public.companies(id),
 days numeric not null check(days>=0 and days<=99999.75 and days*4=trunc(days*4)),
 updated_by uuid not null references public.profiles(id), updated_at timestamptz not null default clock_timestamp()
);
create table app.leave_advance_authorizations (
 id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.profiles(id),
 company_id uuid not null references public.companies(id), period_key text not null,
 request_id uuid unique references public.company_leave_requests(id),
 days numeric not null check(days>=0), monthly_repaid numeric not null default 0 check(monthly_repaid>=0 and monthly_repaid<=days), note text not null,
 actor_id uuid not null references public.profiles(id), created_at timestamptz not null default clock_timestamp(),
 cancelled_at timestamptz,
 unique(employee_id,period_key,request_id)
);
create unique index leave_advance_import_once on app.leave_advance_authorizations(employee_id,period_key) where request_id is null;
create index leave_advance_authorizations_employee on app.leave_advance_authorizations(employee_id,period_key);
create index leave_advance_authorizations_company on app.leave_advance_authorizations(company_id);
create table app.leave_advance_transfers (
 employee_id uuid not null references public.profiles(id), company_id uuid not null references public.companies(id),
 source_key text not null, target_key text not null, days numeric not null check(days>=0),
 primary key(employee_id,source_key,target_key), check(source_key<target_key)
);
create table app.leave_advance_events (
 id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.profiles(id),
 company_id uuid not null references public.companies(id), kind text not null, days numeric not null,
 source_key text, target_key text, request_id uuid references public.company_leave_requests(id),
 actor_id uuid references public.profiles(id), note text not null default '', created_at timestamptz not null default clock_timestamp()
);
create index leave_advance_events_company on app.leave_advance_events(company_id,created_at,id);
create index leave_advance_events_employee on app.leave_advance_events(employee_id,created_at,id);
alter table app.leave_advance_limits enable row level security;
alter table app.leave_advance_authorizations enable row level security;
alter table app.leave_advance_transfers enable row level security;
alter table app.leave_advance_events enable row level security;
revoke all on app.leave_advance_limits,app.leave_advance_authorizations,app.leave_advance_transfers,app.leave_advance_events from public,anon,authenticated;

-- Reverse only this feature's accounting transfers to find the original period credit.
-- Additional/birthday leave is never transferred into or used to settle a base advance.
create function app.advance_periods(p_employee uuid)
returns table(period_key text,ends_on date,original_days numeric,spent numeric,authorized numeric,settled numeric)
language sql stable security definer set search_path='' as $$
 select b.period_key,b.ends_on,
 b.opening_days-coalesce((select sum(t.days) from app.leave_advance_transfers t where t.employee_id=b.employee_id and t.source_key=b.period_key),0)
 +coalesce((select sum(t.days) from app.leave_advance_transfers t where t.employee_id=b.employee_id and t.target_key=b.period_key),0),
 coalesce((select sum((e.allocations->>b.period_key)::numeric) from app.leave_balance_entries e where e.employee_id=b.employee_id and e.refunded_at is null),0),
 coalesce((select sum(a.days-a.monthly_repaid) from app.leave_advance_authorizations a where a.employee_id=b.employee_id and a.period_key=b.period_key and a.cancelled_at is null),0),
 coalesce((select sum(t.days) from app.leave_advance_transfers t where t.employee_id=b.employee_id and t.source_key=b.period_key),0)
 from app.leave_base_periods b where b.employee_id=p_employee;
$$;
revoke all on function app.advance_periods(uuid) from public,anon,authenticated;

create function app.settle_leave_advances(p_employee uuid,p_today date)
returns void language plpgsql security definer set search_path='' as $$
declare s app.employee_leave_accrual%rowtype; source record; target record; change record; periods jsonb; plan jsonb:='{}';
 needed numeric; available numeric; take numeric; k text; old_days numeric; delta numeric;
 old_import text:=current_setting('app.roster_import',true);old_sync text:=current_setting('app.leave_balance_sync',true);
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_employee::text,0));
 select * into s from app.employee_leave_accrual where employee_id=p_employee;
 if not found then return; end if;
 -- Inactive/resigned/changed-hire employees require manual review; never settle payroll.
 if not exists(select 1 from public.profiles p join public.employee_roster r on r.profile_id=p.id
  where p.id=p_employee and p.company_id=s.company_id and p.status='active' and p.hire_date=s.hire_date and r.resigned_on is null) then return;end if;
 select jsonb_agg(to_jsonb(p) order by p.period_key) into periods from app.advance_periods(p_employee) p;
 for source in select * from jsonb_to_recordset(coalesce(periods,'[]')) as p(period_key text,ends_on date,original_days numeric,spent numeric,authorized numeric,settled numeric)
  where authorized>0 order by period_key loop
  needed:=least(greatest(source.spent-source.original_days,0),source.authorized);
  -- A monthly increase within the same first-year period reduces its deficit naturally.
  -- At renewal transfer only available new BASE credits, oldest debt first.
  for target in select * from jsonb_to_recordset(coalesce(periods,'[]')) as p(period_key text,ends_on date,original_days numeric,spent numeric,authorized numeric,settled numeric)
    where period_key>source.period_key and period_key<=s.cycle_start::text order by period_key loop
   select greatest(least(greatest(target.original_days-target.spent,0),
     case when target.ends_on<p_today then coalesce((select sum(t.days) from app.leave_advance_transfers t where t.employee_id=p_employee and t.target_key=target.period_key),0)
     else greatest(target.original_days-target.spent,0) end)-coalesce(sum(value::numeric),0),0) into available
    from jsonb_each_text(plan) where split_part(key,'|',2)=target.period_key;
   take:=least(needed,available);k:=source.period_key||'|'||target.period_key;
   if take>0 then plan:=plan||jsonb_build_object(k,take);needed:=needed-take;end if;
   exit when needed=0;
  end loop;
 end loop;
 -- Apply differences only. Repeated polling/cron produces no duplicate settlement/event.
 for change in select t.source_key,t.target_key,t.days from app.leave_advance_transfers t where t.employee_id=p_employee
  union select split_part(key,'|',1),split_part(key,'|',2),0 from jsonb_each_text(plan) loop
  k:=change.source_key||'|'||change.target_key;
  select coalesce(t.days,0) into old_days from app.leave_advance_transfers t
    where t.employee_id=p_employee and t.source_key=change.source_key and t.target_key=change.target_key;
  old_days:=coalesce(old_days,0);delta:=coalesce((plan->>k)::numeric,0)-old_days;
  if delta=0 then continue;end if;
  update app.leave_base_periods set opening_days=opening_days+delta where employee_id=p_employee and period_key=change.source_key;
  update app.leave_base_periods set opening_days=opening_days-delta where employee_id=p_employee and period_key=change.target_key;
  if change.target_key=s.cycle_start::text then
   perform set_config('app.roster_import','on',true);perform set_config('app.leave_balance_sync','on',true);
   update public.employee_roster set remaining_annual_leave=remaining_annual_leave-delta where profile_id=p_employee;
   perform set_config('app.roster_import',coalesce(old_import,''),true);perform set_config('app.leave_balance_sync',coalesce(old_sync,''),true);
  end if;
  insert into app.leave_advance_transfers values(p_employee,s.company_id,change.source_key,change.target_key,old_days+delta)
   on conflict(employee_id,source_key,target_key) do update set days=excluded.days;
  insert into app.leave_advance_events(employee_id,company_id,kind,days,source_key,target_key,actor_id)
   values(p_employee,s.company_id,case when delta>0 then 'settled' else 'settlement_reversed' end,delta,change.source_key,change.target_key,null);
 end loop;
 perform app.record_leave_expiry(p_employee,p_today);
exception when others then
 perform set_config('app.roster_import',coalesce(old_import,''),true);perform set_config('app.leave_balance_sync',coalesce(old_sync,''),true);raise;
end $$;
revoke all on function app.settle_leave_advances(uuid,date) from public,anon,authenticated;

alter function app.refresh_employee_leave(uuid,date) rename to refresh_employee_leave_before_advance;
revoke all on function app.refresh_employee_leave_before_advance(uuid,date) from public,anon,authenticated;
create function app.refresh_employee_leave(p_employee uuid,p_today date)
returns void language plpgsql security definer set search_path='' as $$
declare before_cycle app.employee_leave_accrual%rowtype;after_cycle app.employee_leave_accrual%rowtype;owed numeric;pay numeric;part numeric;a record;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_employee::text,0));
 select * into before_cycle from app.employee_leave_accrual where employee_id=p_employee;
 select coalesce(sum(greatest(least(greatest(spent-original_days,0),authorized)-settled,0)),0) into owed
  from app.advance_periods(p_employee) where period_key=before_cycle.cycle_start::text;
 perform app.refresh_employee_leave_before_advance(p_employee,p_today);
 select * into after_cycle from app.employee_leave_accrual where employee_id=p_employee;
 if after_cycle.cycle_start=before_cycle.cycle_start and after_cycle.calculated_grant>before_cycle.calculated_grant then
  pay:=least(owed,after_cycle.calculated_grant-before_cycle.calculated_grant);
  for a in select * from app.leave_advance_authorizations where employee_id=p_employee and period_key=after_cycle.cycle_start::text and cancelled_at is null and days>monthly_repaid order by created_at,id for update loop
   part:=least(pay,a.days-a.monthly_repaid);
   if part>0 then
    update app.leave_advance_authorizations set monthly_repaid=monthly_repaid+part where id=a.id;
    insert into app.leave_advance_events(employee_id,company_id,kind,days,source_key,target_key,request_id,actor_id)
     values(p_employee,a.company_id,'monthly_settled',part,a.period_key,a.period_key,a.request_id,null);
    pay:=pay-part;
   end if;
   exit when pay=0;
  end loop;
 end if;
 perform app.settle_leave_advances(p_employee,p_today);
end $$;
revoke all on function app.refresh_employee_leave(uuid,date) from public,anon,authenticated;

create function app.leave_advance_summary(p_employee uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('employeeId',p_employee,'limit',coalesce((select days from app.leave_advance_limits where employee_id=p_employee),0),
 'baseBalance',(select remaining_annual_leave from public.employee_roster where profile_id=p_employee),
 'remainingBalance',(select remaining_annual_leave+app.extra_leave_available(p_employee,(now() at time zone 'Asia/Seoul')::date)-app.leave_past_shortfall(p_employee,(now() at time zone 'Asia/Seoul')::date) from public.employee_roster where profile_id=p_employee),
 'outstanding',coalesce((select sum(greatest(least(greatest(spent-original_days,0),authorized)-settled,0)) from app.advance_periods(p_employee)),0),
 'unclassified',coalesce((select sum(greatest(spent-original_days-authorized,0)) from app.advance_periods(p_employee)),0),
 'nextDate',(select min(d.day::date) from app.employee_leave_accrual a
   cross join lateral generate_series((now() at time zone 'Asia/Seoul')::date+1,a.cycle_end+1,interval '1 day') d(day)
   cross join lateral app.employee_leave_cycle(a.hire_date,d.day::date) c
   where a.employee_id=p_employee and (c.starts_on>a.cycle_start or c.grant_days>a.calculated_grant)),
 'needsReview',not exists(select 1 from public.profiles p join app.employee_leave_accrual a on a.employee_id=p.id join public.employee_roster r on r.profile_id=p.id
  where p.id=p_employee and p.status='active' and p.hire_date=a.hire_date and r.resigned_on is null),
 'periods',coalesce((select jsonb_agg(jsonb_build_object('period',p.period_key,'expires',ends_on,'authorized',authorized,
 'imported',coalesce((select sum(a.days) from app.leave_advance_authorizations a where a.employee_id=p_employee and a.period_key=p.period_key and a.request_id is null and a.cancelled_at is null),0),
 'unclassified',greatest(spent-original_days-authorized,0),'outstanding',greatest(least(greatest(spent-original_days,0),authorized)-settled,0),'settled',settled) order by p.period_key) from app.advance_periods(p_employee) p where authorized>0 or spent>original_days or exists(select 1 from app.leave_advance_authorizations a where a.employee_id=p_employee and a.period_key=p.period_key and a.request_id is null and a.cancelled_at is null)),'[]'));
$$;
revoke all on function app.leave_advance_summary(uuid) from public,anon,authenticated;

create function app.employee_leave_advances(p_manage boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare company uuid; managed boolean; employee record;today date:=(now() at time zone 'Asia/Seoul')::date;
begin
 select company_id into company from public.profiles where id=auth.uid() and status='active';
 if company is null then raise exception '재직 중인 직원만 조회할 수 있습니다.' using errcode='42501';end if;
 managed:=app.can_edit_org_assignment() or app.basic_work_allowed('operations');
 if p_manage and not managed then raise exception '연차 관리 권한이 없습니다.' using errcode='42501';end if;
 for employee in select p.id from public.profiles p join public.employee_roster r on r.profile_id=p.id
  where p.company_id=company and (p_manage or p.id=auth.uid()) order by p.id loop
  -- A stopped employee remains visible for review; don't mutate their balance.
  if exists(select 1 from public.profiles p join app.employee_leave_accrual a on a.employee_id=p.id join public.employee_roster r on r.profile_id=p.id
   where p.id=employee.id and p.status='active' and p.hire_date=a.hire_date and r.resigned_on is null) then
   perform app.refresh_employee_leave(employee.id,today);
  end if;
 end loop;
 return jsonb_build_object('ready',true,'employees',coalesce((select jsonb_agg(app.leave_advance_summary(p.id) order by p.id)
  from public.profiles p where p.company_id=company and (p_manage or p.id=auth.uid())),'[]'),
 'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'employeeId',e.employee_id,'kind',e.kind,'days',e.days,'source',e.source_key,'target',e.target_key,'requestId',e.request_id,'note',e.note,'actor',p.display_name,'created',e.created_at) order by e.created_at desc,e.id)
  from app.leave_advance_events e left join public.profiles p on p.id=e.actor_id where e.company_id=company and (p_manage or e.employee_id=auth.uid())),'[]'));
end $$;
revoke all on function app.employee_leave_advances(boolean) from public,anon;
grant execute on function app.employee_leave_advances(boolean) to authenticated;
create function public.employee_leave_advances(p_manage boolean default false)
returns jsonb language sql volatile security invoker set search_path='' as $$select app.employee_leave_advances(p_manage)$$;
revoke all on function public.employee_leave_advances(boolean) from public,anon;
grant execute on function public.employee_leave_advances(boolean) to authenticated;

create function app.manage_leave_advance(p_employee uuid,p_action text,p_days numeric,p_note text,p_period text default null)
returns void language plpgsql security definer set search_path='' as $$
declare company uuid;s app.employee_leave_accrual%rowtype;deficit numeric;source text;today date:=(now() at time zone 'Asia/Seoul')::date;
begin
 select company_id into company from public.profiles where id=auth.uid() and status='active';
 if company is null or not(app.can_edit_org_assignment() or app.basic_work_allowed('operations')) then raise exception '연차 관리 권한이 없습니다.' using errcode='42501';end if;
 if not exists(select 1 from public.profiles p join public.employee_roster r on r.profile_id=p.id where p.id=p_employee and p.company_id=company and p.status='active' and r.resigned_on is null) then raise exception '재직 직원과 퇴사일을 확인해 주세요.';end if;
 if p_days is null or p_days::text in ('NaN','Infinity','-Infinity') or p_days<0 or p_days>99999.75 or p_days*4<>trunc(p_days*4) or length(btrim(coalesce(p_note,''))) not between 1 and 2000 then raise exception '일수를 0.25일 단위로 입력하고 사유를 남겨 주세요.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_employee::text,0));
 perform app.refresh_employee_leave(p_employee,today);
 if p_action='limit' then
  insert into app.leave_advance_limits values(p_employee,company,p_days,auth.uid(),clock_timestamp()) on conflict(employee_id) do update set days=excluded.days,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
 elsif p_action='import' then
  select * into s from app.employee_leave_accrual where employee_id=p_employee;
  if not found then raise exception '연차 발생 기준을 먼저 확인해 주세요.';end if;
  source:=coalesce(p_period,s.cycle_start::text);
  select greatest(spent-original_days-authorized,0) into deficit from app.advance_periods(p_employee) where period_key=source and period_key<=s.cycle_start::text;
  if p_days=0 or p_days>coalesce(deficit,0) then raise exception '선택한 기간의 미분류 음수 잔액 범위만 이월 등록할 수 있습니다.';end if;
  insert into app.leave_advance_authorizations(employee_id,company_id,period_key,days,note,actor_id)
   values(p_employee,company,source,p_days,btrim(p_note),auth.uid())
   on conflict(employee_id,period_key) where request_id is null do update
    set days=case when app.leave_advance_authorizations.cancelled_at is null then app.leave_advance_authorizations.days+excluded.days else excluded.days end,
    monthly_repaid=case when app.leave_advance_authorizations.cancelled_at is null then app.leave_advance_authorizations.monthly_repaid else 0 end,cancelled_at=null;
 elsif p_action='import_cancel' then
  source:=p_period;
  update app.leave_advance_authorizations set cancelled_at=clock_timestamp()
   where employee_id=p_employee and period_key=source and request_id is null and cancelled_at is null;
  if not found then raise exception '취소할 기존 이월 분류가 없습니다. 다시 조회해 주세요.';end if;
 else raise exception '올바른 관리 작업이 아닙니다.';end if;
 insert into app.leave_advance_events(employee_id,company_id,kind,days,source_key,actor_id,note)
 values(p_employee,company,p_action,p_days,source,auth.uid(),btrim(p_note));
 perform app.settle_leave_advances(p_employee,today);
end $$;
revoke all on function app.manage_leave_advance(uuid,text,numeric,text,text) from public,anon;
grant execute on function app.manage_leave_advance(uuid,text,numeric,text,text) to authenticated;
create function public.manage_leave_advance(p_employee uuid,p_action text,p_days numeric,p_note text,p_period text default null)
returns void language sql volatile security invoker set search_path='' as $$select app.manage_leave_advance(p_employee,p_action,p_days,p_note,p_period)$$;
revoke all on function public.manage_leave_advance(uuid,text,numeric,text,text) from public,anon;
grant execute on function public.manage_leave_advance(uuid,text,numeric,text,text) to authenticated;

CREATE OR REPLACE FUNCTION app.guard_company_leave_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare actor public.profiles%rowtype; starts timestamp; ends timestamp; minutes integer;
  today date := (pg_catalog.now() at time zone 'Asia/Seoul')::date;
begin
  select * into actor from public.profiles where id = auth.uid() and status = 'active';
  if actor.id is null then raise exception '재직 중인 직원만 신청할 수 있습니다.'; end if;
  if TG_OP = 'INSERT' then
    if new.employee_id <> actor.id then raise exception '본인 신청만 등록할 수 있습니다.'; end if;
    new.company_id := actor.company_id;
    new.employee_name := coalesce(nullif(btrim(actor.display_name), ''), '이름 없음');
    new.department_id := actor.department_id;
    select coalesce(d.name, '소속 없음') into new.department_name from public.departments d where d.id = actor.department_id;
    new.department_name := coalesce(new.department_name, '소속 없음');
    new.created_at := now();
    new.note := btrim(new.note);
    new.place := case when new.kind in ('offsite','remote') then btrim(coalesce(new.place, '')) else '' end;
    if new.kind = 'remote' then raise exception '재택은 등록할 수 없습니다.'; end if;
    if new.kind = 'official' and new.note = '' then raise exception '공가 사유를 입력해 주세요.'; end if;
    if new.kind in ('annual','half','quarter','offsite') and not new.advance_requested then
      new.status := 'approved';
      new.decided_at := now();
      new.decided_by := null;
      new.decided_by_name := null;
      new.decision_note := null;
    else
      new.status := 'pending';
      new.decided_at := null; new.decided_by := null; new.decided_by_name := null; new.decision_note := null;
    end if;
    if new.kind='overtime' and (new.from_date<>new.to_date or new.end_time<=new.start_time or new.note='') then
      raise exception '야근은 날짜별로 시작·종료 시각과 사유를 입력해 주세요.';
    end if;
    if new.kind = 'offsite' and new.place = '' then raise exception '외근 장소를 입력해 주세요.'; end if;
    if new.kind = 'correction' then
      if new.from_date <> new.to_date or new.end_time <= new.start_time or new.note = '' then
        raise exception '출퇴근 정정은 날짜별로 실제 출근·퇴근 시각과 사유를 입력해 주세요.';
      end if;
      if new.from_date > today then raise exception '앞으로의 날짜는 출퇴근 정정을 신청할 수 없습니다.'; end if;
    end if;
    if new.kind in ('half','quarter') then
      minutes := extract(epoch from (new.end_time - new.start_time)) / 60
        - greatest(0, extract(epoch from (least(new.end_time, time '13:00') - greatest(new.start_time, time '12:00'))) / 60);
      if new.start_time < time '09:00' or new.end_time > time '18:00'
        or minutes <> (case when new.kind = 'half' then 240 else 120 end) then
        raise exception '반차는 4시간, 반반차는 2시간으로 신청해 주세요. 휴게시간 12–13시는 제외합니다.';
      end if;
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor.id::text, 0));
    if new.kind = 'correction' then
      if exists (select 1 from public.company_leave_requests r where r.employee_id = actor.id and r.kind = 'correction'
        and r.status = 'pending' and r.from_date = new.from_date) then
        raise exception '같은 날짜에 승인 대기 중인 출퇴근 정정 신청이 있습니다.';
      end if;
    else
      starts := new.from_date + case when new.kind in ('annual','official') then time '00:00' else new.start_time end;
      ends := case when new.kind in ('annual','official') then new.to_date + interval '1 day' else new.to_date + new.end_time end;
      if exists (select 1 from public.company_leave_requests r where r.employee_id = actor.id and r.status in ('pending','approved')
        and r.kind <> 'correction'
        and not ((r.kind in ('offsite','remote') and new.kind in ('half','quarter','overtime'))
          or (new.kind in ('offsite','remote') and r.kind in ('half','quarter','overtime')))
        and tsrange(r.from_date + case when r.kind in ('annual','official') then time '00:00' else r.start_time end,
          case when r.kind in ('annual','official') then r.to_date + interval '1 day' else r.to_date + r.end_time end, '[)')
          && tsrange(starts, ends, '[)')) then
        raise exception '같은 시간에 대기 중이거나 승인된 신청이 있습니다.';
      end if;
    end if;
  else
    if new.advance_requested is distinct from old.advance_requested then raise exception '선사용 신청 여부는 변경할 수 없습니다.';end if;
    if row(new.id,new.company_id,new.employee_id,new.employee_name,new.department_id,new.department_name,new.kind,new.from_date,new.to_date,new.start_time,new.end_time,new.note,new.place,new.created_at)
      is distinct from row(old.id,old.company_id,old.employee_id,old.employee_name,old.department_id,old.department_name,old.kind,old.from_date,old.to_date,old.start_time,old.end_time,old.note,old.place,old.created_at) then
      raise exception '신청 원본은 수정할 수 없습니다. 대기 신청을 취소하고 다시 신청해 주세요.';
    end if;
    if old.status <> 'pending' and not (
      old.status = 'approved' and old.kind in ('annual','half','quarter','offsite') and new.status = 'cancelled' and actor.id = old.employee_id
    ) then raise exception '이미 처리된 신청입니다. 목록을 새로고침해 주세요.'; end if;
    if new.status = 'cancelled' then
      if actor.id <> old.employee_id then raise exception '본인 신청만 취소할 수 있습니다.'; end if;
      new.decision_note := null;
    elsif new.status in ('approved','rejected') then
      if old.kind not in ('overtime','correction','official') and not old.advance_requested then raise exception '이 항목은 승인 없이 등록됩니다.'; end if;
      if old.kind = 'official' then
        if not app.can_edit_org_assignment() then raise exception '공가 서류는 운영지원만 처리할 수 있습니다.'; end if;
        if new.status = 'approved' and not exists(select 1 from public.company_leave_files f where f.request_id = old.id and f.ready) then
          raise exception '공가 서류가 없으면 처리할 수 없습니다.';
        end if;
      elsif not app.is_department_request_approver(old.company_id,old.department_id,old.kind) then
        raise exception '이 부서와 신청 종류의 지정 승인자만 처리할 수 있습니다.';
      end if;
      if actor.id = old.employee_id and (old.kind not in ('overtime','correction') or new.status <> 'approved') then
        raise exception '본인 처리는 지정된 야근·출퇴근 정정의 승인만 가능합니다.';
      end if;
      new.decision_note := nullif(btrim(new.decision_note), '');
      if new.status = 'rejected' and new.decision_note is null then raise exception '반려 사유를 입력해 주세요.'; end if;
    else raise exception '올바른 처리 상태가 아닙니다.';
    end if;
    new.decided_at := now(); new.decided_by := actor.id;
    new.decided_by_name := coalesce(nullif(btrim(actor.display_name), ''), '이름 없음');
  end if;
  return new;
end;
$function$;

create or replace function app.sync_leave_request_balance()
returns trigger language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); amount numeric; charge numeric; balance numeric; refund boolean:=false;
  s app.employee_leave_accrual%rowtype; extras jsonb; extra_total numeric:=0; pool numeric; parts jsonb; part record; budget numeric; reserved numeric; borrowed numeric; limit_days numeric; outstanding numeric;
  previous_import text:=current_setting('app.roster_import',true); previous_sync text:=current_setting('app.leave_balance_sync',true);
begin
  if new.kind not in ('annual','half','quarter') then return new; end if;
  if TG_OP='INSERT' then
    if new.status<>'approved' then return new; end if;
  elsif old.status='pending' and new.status='approved' and new.advance_requested then refund:=false;
  elsif not (old.status='approved' and new.status='cancelled') then return new;
  else refund:=true; end if;
  if actor is null or (actor<>new.employee_id and not(new.advance_requested and TG_OP='UPDATE' and old.status='pending' and new.status='approved' and app.is_department_request_approver(new.company_id,new.department_id,new.kind))) or not exists(select 1 from public.profiles p where p.id=actor and p.status='active' and p.company_id=new.company_id) then
    raise exception '본인 또는 지정 승인자의 선사용 승인만 처리할 수 있습니다.';
  end if;
  actor:=new.employee_id;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,0));
  perform app.refresh_employee_leave(actor,(now() at time zone 'Asia/Seoul')::date);
  pool:=app.extra_leave_available(actor,(now() at time zone 'Asia/Seoul')::date)-app.leave_past_shortfall(actor,(now() at time zone 'Asia/Seoul')::date);

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
  if not refund and not new.advance_requested and charge+extra_total>0 and balance+pool<charge+extra_total then raise exception '총 남은 연차가 부족합니다. 잔여 %일',balance+pool;end if;
  if not refund and not new.advance_requested and balance<charge and charge>0 then raise exception '남은 연차가 부족합니다. 잔여 %일 · 필요한 연차 %일',balance,charge; end if;

  if not refund and new.advance_requested then
    borrowed:=greatest(charge-balance,0)-greatest(-balance,0);
    select days into limit_days from app.leave_advance_limits where employee_id=actor;
    outstanding:=(app.leave_advance_summary(actor)->>'outstanding')::numeric;
    if borrowed<0 or outstanding+borrowed>coalesce(limit_days,0) or coalesce(limit_days,0)=0 then raise exception '선사용 한도를 초과합니다. 한도 %일 · 기존 선사용 %일 · 이번 부족분 %일',coalesce(limit_days,0),outstanding,borrowed;end if;
    insert into app.leave_advance_authorizations(employee_id,company_id,period_key,request_id,days,note,actor_id)
      values(actor,new.company_id,s.cycle_start::text,new.id,borrowed,new.note,auth.uid());
    insert into app.leave_advance_events(employee_id,company_id,kind,days,source_key,request_id,actor_id,note)
      values(actor,new.company_id,'approved',borrowed,s.cycle_start::text,new.id,auth.uid(),coalesce(new.decision_note,''));
  elsif refund and new.advance_requested then
    update app.leave_advance_authorizations set cancelled_at=clock_timestamp() where request_id=new.id and cancelled_at is null;
    insert into app.leave_advance_events(employee_id,company_id,kind,days,request_id,actor_id)
      values(actor,new.company_id,'cancelled',0,new.id,auth.uid());
  end if;
  if refund then update app.leave_balance_entries set refunded_at=clock_timestamp() where request_id=new.id;
  else insert into app.leave_balance_entries(request_id,employee_id,company_id,days,allocations) values(new.id,actor,new.company_id,amount,parts); end if;
  perform pg_catalog.set_config('app.roster_import','on',true);
  perform pg_catalog.set_config('app.leave_balance_sync','on',true);
  update public.employee_roster set remaining_annual_leave=balance+case when refund then charge else -charge end where profile_id=actor and company_id=new.company_id;
  perform pg_catalog.set_config('app.roster_import',coalesce(previous_import,''),true);
  perform pg_catalog.set_config('app.leave_balance_sync',coalesce(previous_sync,''),true);
  perform app.settle_leave_advances(actor,(now() at time zone 'Asia/Seoul')::date);
  perform app.record_leave_expiry(actor,(now() at time zone 'Asia/Seoul')::date);
  return new;
exception when others then
  perform pg_catalog.set_config('app.roster_import',coalesce(previous_import,''),true);
  perform pg_catalog.set_config('app.leave_balance_sync',coalesce(previous_sync,''),true);
  raise;
end $$;

create function app.guard_leave_advance() returns trigger
language plpgsql security definer set search_path='' as $$
declare s app.employee_leave_accrual%rowtype;today date:=(now() at time zone 'Asia/Seoul')::date;
begin
 if not new.advance_requested then return new;end if;
 if new.kind not in ('annual','half','quarter') then raise exception '연차·반차·반반차만 선사용 신청할 수 있습니다.';end if;
 if TG_OP='INSERT' or (old.status='pending' and new.status='approved') then
  perform pg_advisory_xact_lock(hashtextextended(new.employee_id::text,0));
  if not exists(select 1 from public.profiles p join public.employee_roster r on r.profile_id=p.id
   where p.id=new.employee_id and p.company_id=new.company_id and p.status='active' and r.resigned_on is null) then raise exception '재직 상태를 확인해 주세요.';end if;
  perform app.refresh_employee_leave(new.employee_id,today);
  select * into s from app.employee_leave_accrual where employee_id=new.employee_id;
  if not found then raise exception '운영지원에서 연차 발생 기준을 먼저 확인해 주세요.';end if;
  if new.from_date<today or new.from_date<s.cycle_start or new.to_date>s.cycle_end then raise exception '선사용은 오늘 이후 현재 연차 기간 안에서 신청해 주세요. 다음 기간의 휴가는 일반 등록을 이용해 주세요.';end if;
  if length(btrim(coalesce(new.note,'')))=0 then raise exception '연차 선사용 사유를 입력해 주세요.';end if;
  if not exists(select 1 from app.leave_advance_limits where employee_id=new.employee_id and days>0) then raise exception '선사용 한도가 설정되지 않았습니다. 운영지원에 문의해 주세요.';end if;
  if (app.leave_advance_summary(new.employee_id)->>'unclassified')::numeric>0 then raise exception '기존 부족분 분류를 운영지원에서 먼저 확인해 주세요.';end if;
  perform app.leave_balance_days(new.kind,new.from_date,new.to_date);
 end if;
 return new;
end $$;
revoke all on function app.guard_leave_advance() from public,anon,authenticated;
create trigger zz_leave_advance_guard before insert or update on public.company_leave_requests
for each row execute function app.guard_leave_advance();

-- The existing RLS already restricts department approvers by company/type. Keep it unchanged.
create or replace function public.list_my_approval_requests() returns setof public.company_leave_requests
language sql stable security invoker set search_path='' as $$
 select r.* from public.company_leave_requests r
 where ((r.kind in ('overtime','correction') or r.advance_requested) and app.is_department_request_approver(r.company_id,r.department_id,r.kind))
    or (r.status<>'pending' and r.decided_by=(select auth.uid()))
 order by r.created_at desc,r.id;
$$;

-- Reallocating after an extra grant change must also reconcile any advance settlements.
alter function app.reallocate_employee_leave(uuid,date) rename to reallocate_employee_leave_before_advance;
revoke all on function app.reallocate_employee_leave_before_advance(uuid,date) from public,anon,authenticated;
create function app.reallocate_employee_leave(p_employee uuid,p_today date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 result:=app.reallocate_employee_leave_before_advance(p_employee,p_today);
 perform app.settle_leave_advances(p_employee,p_today);
 return result;
end $$;
revoke all on function app.reallocate_employee_leave(uuid,date) from public,anon,authenticated;
commit;
