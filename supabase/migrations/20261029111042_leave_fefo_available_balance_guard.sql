begin;
create or replace function app.sync_leave_request_balance()
returns trigger language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); amount numeric; charge numeric; balance numeric; refund boolean:=false;
  s app.employee_leave_accrual%rowtype; extras jsonb; extra_total numeric:=0; pool numeric; parts jsonb; part record; budget numeric; reserved numeric;
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
  if not refund and charge+extra_total>0 and balance+pool<charge+extra_total then raise exception '총 남은 연차가 부족합니다. 잔여 %일',balance+pool;end if;
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
commit;
