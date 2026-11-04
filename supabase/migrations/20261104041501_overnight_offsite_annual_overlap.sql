-- Only a preceding overnight/continuous offsite ending by the annual day's start is exempt.
create function app.overnight_offsite_before_annual(p_employee uuid,l public.company_leave_requests,r public.company_leave_requests)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare o public.company_leave_requests; a public.company_leave_requests; basis time;
begin
 if l.kind='offsite' and r.kind='annual' then o:=l; a:=r;
 elsif r.kind='offsite' and l.kind='annual' then o:=r; a:=l;
 else return false; end if;
 if o.from_date>=a.from_date or not (o.end_next_day or o.offsite_continuous) then return false; end if;
 basis:=app.attendance_start_for_date(p_employee,a.from_date);
 return coalesce(basis is not null and app.offsite_finish(o,o.from_date)<=((a.from_date+basis) at time zone 'Asia/Seoul'),false);
end $$;
revoke all on function app.overnight_offsite_before_annual(uuid,public.company_leave_requests,public.company_leave_requests) from public,anon,authenticated;
do $$declare source text; needle text:='and r.kind <> ''correction'''; begin
 source:=pg_get_functiondef('app.guard_company_leave_request()'::regprocedure);
 if position(needle in source)=0 then raise exception 'Unexpected request overlap guard'; end if;
 source:=replace(source,needle,needle||' and not app.overnight_offsite_before_annual(actor.id,new,r)');
 execute source;
end $$;
-- A later start change must not invalidate an already accepted annual/offsite pair.
create function app.guard_annual_offsite_start() returns trigger language plpgsql security definer set search_path='' as $$
declare basis time;
begin
 if new.offsite_work_start is not distinct from old.offsite_work_start or new.kind<>'offsite' or new.status<>'approved' then return new; end if;
 perform pg_advisory_xact_lock(hashtextextended(new.employee_id::text,0));
 basis:=new.offsite_work_start;
 if basis is null then
 select s.start_time into basis from public.attendance_start_settings s join public.profiles p on p.id=new.employee_id and p.company_id=s.company_id
 where s.month=date_trunc('month',new.from_date)::date and (s.employee_id=p.id or (s.employee_id is null and s.department_id=p.department_id))
 order by (s.employee_id=p.id) desc nulls last,s.updated_at desc,s.id limit 1;
 end if;
 if exists(select 1 from public.company_leave_requests a join public.company_leave_requests o on o.employee_id=a.employee_id and o.company_id=a.company_id
 where a.employee_id=new.employee_id and a.kind='annual' and a.status in ('pending','approved') and a.from_date=new.from_date
 and o.kind='offsite' and o.status in ('pending','approved') and o.from_date<a.from_date and (o.end_next_day or o.offsite_continuous)
 and app.offsite_finish(o,o.from_date)>((a.from_date+time '00:00') at time zone 'Asia/Seoul')
 and (basis is null or app.offsite_finish(o,o.from_date)>((a.from_date+basis) at time zone 'Asia/Seoul'))) then
 raise exception '변경할 출근 기준 이후까지 이어지는 외근과 연차가 있습니다. 외근·연차 일정을 먼저 확인해 주세요.' using errcode='23514';
 end if;
 return new;
end $$;
revoke all on function app.guard_annual_offsite_start() from public,anon,authenticated;
create trigger zz_annual_offsite_start before update of offsite_work_start on public.company_leave_requests for each row execute function app.guard_annual_offsite_start();
