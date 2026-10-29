begin;
-- Independent grants: the existing roster balance remains the base balance.
create table app.employee_extra_leave (
  id uuid primary key,
  employee_id uuid not null references public.profiles(id),
  company_id uuid not null references public.companies(id),
  days numeric(7,2) not null check(days>0),
  expires_on date not null,
  note text not null check(length(btrim(note)) between 1 and 500),
  granted_on date not null default (now() at time zone 'Asia/Seoul')::date,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles(id),
  version integer not null default 1,
  deleted_at timestamptz,
  check(expires_on>=granted_on)
);
create index employee_extra_leave_employee on app.employee_extra_leave(employee_id,expires_on,id);
create index employee_extra_leave_company on app.employee_extra_leave(company_id,created_at);
create table app.employee_extra_leave_usage (
  request_id uuid not null references public.company_leave_requests(id),
  grant_id uuid not null references app.employee_extra_leave(id),
  used_on date not null,
  days numeric(7,2) not null check(days>0),
  refunded_at timestamptz,
  primary key(request_id,grant_id,used_on)
);
create index employee_extra_leave_usage_grant on app.employee_extra_leave_usage(grant_id) where refunded_at is null;
alter table app.employee_extra_leave enable row level security;
alter table app.employee_extra_leave_usage enable row level security;
revoke all on app.employee_extra_leave,app.employee_extra_leave_usage from public,anon,authenticated;

create function app.extra_leave_available(p_employee uuid,p_today date)
returns numeric language sql stable security definer set search_path='' as $$
  select coalesce(sum(g.days-coalesce(u.used,0)),0) from app.employee_extra_leave g
  left join lateral(select sum(days) used from app.employee_extra_leave_usage where grant_id=g.id and refunded_at is null) u on true
  where g.employee_id=p_employee and g.deleted_at is null and g.granted_on<=p_today and g.expires_on>=p_today;
$$;
revoke all on function app.extra_leave_available(uuid,date) from public,anon,authenticated;

create function app.employee_extra_leave_records()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare company uuid;
begin
  select company_id into company from public.profiles where id=auth.uid() and status='active';
  if company is null or not(app.can_edit_org_assignment() or app.basic_work_allowed('operations')) then raise exception '연차 관리 권한이 없습니다.' using errcode='42501'; end if;
  return jsonb_build_object('ready',true,'entries',coalesce((
    select jsonb_agg(jsonb_build_object('id',g.id,'employeeId',g.employee_id,'days',g.days,'expires',g.expires_on,'note',g.note,
      'created',g.granted_on,'version',g.version,'used',coalesce(u.used,0)) order by g.created_at desc,g.id)
    from app.employee_extra_leave g
    left join lateral(select sum(days) used from app.employee_extra_leave_usage where grant_id=g.id and refunded_at is null) u on true
    where g.company_id=company and g.deleted_at is null),'[]'::jsonb),
    'balances',coalesce((select jsonb_agg(jsonb_build_object('profileId',p.id,'available',app.extra_leave_available(p.id,(now() at time zone 'Asia/Seoul')::date)))
      from public.profiles p where p.company_id=company and p.status='active'),'[]'::jsonb));
end $$;
create function public.employee_extra_leave_records() returns jsonb language sql stable set search_path='' as $$ select app.employee_extra_leave_records(); $$;

create function app.save_employee_extra_leave(p_id uuid,p_employee uuid,p_days numeric,p_expires date,p_note text,p_version integer,p_delete boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare company uuid; g app.employee_extra_leave%rowtype; used numeric; last_use date;
begin
  select company_id into company from public.profiles where id=auth.uid() and status='active';
  if company is null or not(app.can_edit_org_assignment() or app.basic_work_allowed('operations')) then raise exception '연차 관리 권한이 없습니다.' using errcode='42501'; end if;
  if p_id is null or p_employee is null or p_version is null or p_delete is null then raise exception '추가 연차 입력을 확인해 주세요.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_employee::text,0));
  if not exists(select 1 from public.profiles p join public.employee_roster r on r.profile_id=p.id and r.company_id=p.company_id
    where p.id=p_employee and p.company_id=company and p.status='active' and r.resigned_on is null and r.remaining_annual_leave is not null) then
    raise exception '재직 직원의 기본 잔여 연차를 먼저 등록해 주세요.'; end if;
  select * into g from app.employee_extra_leave where id=p_id for update;
  if found then
    if g.employee_id<>p_employee or g.company_id<>company then raise exception '해당 직원의 추가 연차가 아닙니다.' using errcode='42501'; end if;
    if g.deleted_at is not null and p_delete then return p_id; end if;
    -- Retry of the exact successful write is safe; stale differing writes fail.
    if not p_delete and g.deleted_at is null and g.version=p_version+1 and g.days=p_days and g.expires_on=p_expires and g.note=btrim(p_note) then return p_id; end if;
    if g.version<>p_version or g.deleted_at is not null then raise exception '다른 변경이 있습니다. 다시 조회한 뒤 수정해 주세요.' using errcode='40001'; end if;
    select coalesce(sum(days),0),max(used_on) into used,last_use from app.employee_extra_leave_usage where grant_id=p_id and refunded_at is null;
    if p_delete then
      if used>0 then raise exception '이미 사용·예약한 추가 연차는 삭제할 수 없습니다. 해당 신청을 먼저 취소해 주세요.'; end if;
      update app.employee_extra_leave set deleted_at=clock_timestamp(),updated_at=clock_timestamp(),updated_by=auth.uid(),version=version+1 where id=p_id;
      return p_id;
    end if;
  else
    if p_version<>0 or p_delete then raise exception '추가 연차를 다시 조회해 주세요.'; end if;
    used:=0;
  end if;
  if p_days is null or p_days::text in ('NaN','Infinity','-Infinity') or p_days<=0 or p_days>99999.99 or p_days<>round(p_days,2)
    or p_expires is null or p_note is null or length(btrim(p_note)) not between 1 and 500 then raise exception '일수·사용 기한·사유를 확인해 주세요.'; end if;
  if p_expires<coalesce(g.granted_on,(now() at time zone 'Asia/Seoul')::date) or p_days<used or p_expires<last_use then
    raise exception '사용·예약 일수나 날짜보다 적게 줄일 수 없습니다.'; end if;
  if g.id is null then
    insert into app.employee_extra_leave(id,employee_id,company_id,days,expires_on,note,created_by,updated_by)
      values(p_id,p_employee,company,p_days,p_expires,btrim(p_note),auth.uid(),auth.uid());
  else update app.employee_extra_leave set days=p_days,expires_on=p_expires,note=btrim(p_note),updated_at=clock_timestamp(),updated_by=auth.uid(),version=version+1 where id=p_id; end if;
  return p_id;
end $$;
create function public.save_employee_extra_leave(p_id uuid,p_employee uuid,p_days numeric,p_expires date,p_note text,p_version integer,p_delete boolean default false)
returns uuid language sql set search_path='' as $$ select app.save_employee_extra_leave(p_id,p_employee,p_days,p_expires,p_note,p_version,p_delete); $$;

-- Called only by the existing validated leave trigger, under the same employee lock.
create function app.allocate_extra_leave(p_request uuid,p_employee uuid,p_kind text,p_from date,p_to date,p_refund boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare day date; needed numeric; g record; take numeric; result jsonb:='{}'; total numeric;
begin
  if p_refund then update app.employee_extra_leave_usage set refunded_at=clock_timestamp() where request_id=p_request and refunded_at is null; return result; end if;
  for day in select p_from+i from generate_series(0,p_to-p_from) n(i)
    where extract(isodow from p_from+i) between 1 and 5 and not exists(select 1 from app.leave_balance_holidays h where h.day=p_from+i) loop
    needed:=case p_kind when 'half' then 0.5 when 'quarter' then 0.25 else 1 end; total:=0;
    for g in select e.id,e.days-coalesce(u.used,0) available from app.employee_extra_leave e
      left join lateral(select sum(days) used from app.employee_extra_leave_usage where grant_id=e.id and refunded_at is null) u on true
      where e.employee_id=p_employee and e.deleted_at is null and e.granted_on<=day and e.expires_on>=day
      order by e.expires_on,e.created_at,e.id loop
      take:=least(needed,g.available);
      if take>0 then
        insert into app.employee_extra_leave_usage(request_id,grant_id,used_on,days) values(p_request,g.id,day,take);
        needed:=needed-take; total:=total+take;
      end if;
      exit when needed=0;
    end loop;
    result:=result||jsonb_build_object(day::text,total);
  end loop;
  return result;
end $$;
revoke all on function app.allocate_extra_leave(uuid,uuid,text,date,date,boolean) from public,anon,authenticated;

-- Adjusting a displayed total changes only the base portion; expiry is never baked into it.
create function app.save_employee_leave_total(p_employee uuid,p_total numeric)
returns void language plpgsql security definer set search_path='' as $$
declare company uuid; bonus numeric; old_import text:=current_setting('app.roster_import',true);
begin
  select company_id into company from public.profiles where id=auth.uid() and status='active';
  if company is null or not(app.can_edit_org_assignment() or app.basic_work_allowed('operations')) then raise exception '연차 관리 권한이 없습니다.' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_employee::text,0));
  if not exists(select 1 from public.profiles where id=p_employee and company_id=company and status='active') then raise exception '직원을 확인해 주세요.'; end if;
  bonus:=app.extra_leave_available(p_employee,(now() at time zone 'Asia/Seoul')::date);
  if p_total is null and bonus>0 then raise exception '추가 연차가 있는 직원은 잔여값을 비울 수 없습니다.'; end if;
  if p_total is not null and (p_total::text in ('NaN','Infinity','-Infinity') or abs(p_total)>99999.99 or p_total<>round(p_total,2) or abs(p_total-bonus)>99999.99) then raise exception '잔여 일수를 확인해 주세요.'; end if;
  perform pg_catalog.set_config('app.roster_import','on',true);
  insert into public.employee_roster(profile_id,company_id,remaining_annual_leave) values(p_employee,company,p_total-bonus)
    on conflict(profile_id) do update set remaining_annual_leave=excluded.remaining_annual_leave;
  perform pg_catalog.set_config('app.roster_import',coalesce(old_import,''),true);
exception when others then perform pg_catalog.set_config('app.roster_import',coalesce(old_import,''),true); raise;
end $$;
create function public.save_employee_leave_total(p_employee uuid,p_total numeric) returns void language sql set search_path='' as $$ select app.save_employee_leave_total(p_employee,p_total); $$;

revoke all on function app.employee_extra_leave_records(),public.employee_extra_leave_records(),
  app.save_employee_extra_leave(uuid,uuid,numeric,date,text,integer,boolean),public.save_employee_extra_leave(uuid,uuid,numeric,date,text,integer,boolean),
  app.save_employee_leave_total(uuid,numeric),public.save_employee_leave_total(uuid,numeric) from public,anon;
grant execute on function app.employee_extra_leave_records(),public.employee_extra_leave_records(),
  app.save_employee_extra_leave(uuid,uuid,numeric,date,text,integer,boolean),public.save_employee_extra_leave(uuid,uuid,numeric,date,text,integer,boolean),
  app.save_employee_leave_total(uuid,numeric),public.save_employee_leave_total(uuid,numeric) to authenticated;

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
  perform app.refresh_employee_leave(actor,(now() at time zone 'Asia/Seoul')::date);
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
          if reserved+part.days>budget then raise exception '다음 연차 기간의 남은 연차가 부족합니다.'; end if;
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
      select r.remaining_annual_leave + app.extra_leave_available(actor,(now() at time zone 'Asia/Seoul')::date) from public.employee_roster r
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
revoke all on function app.get_my_attendance_basis(date) from public,anon;
grant execute on function app.get_my_attendance_basis(date) to authenticated;
commit;
