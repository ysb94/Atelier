begin;
alter table public.company_leave_requests add column end_next_day boolean not null default false;
alter table public.company_leave_requests drop constraint company_leave_requests_span_check;
alter table public.company_leave_requests add constraint company_leave_requests_span_check check (
  (kind in ('annual','official') and not end_next_day) or
  (kind in ('overtime','correction') and from_date=to_date and ((end_next_day and end_time<=start_time) or (not end_next_day and end_time>start_time))) or
  (kind not in ('annual','official','overtime','correction') and not end_next_day and end_time>start_time and
   (from_date=to_date or kind in ('offsite','remote')))
);
alter table public.attendance_clock_ins add column clock_in_source text not null default 'manual' check (clock_in_source in ('manual','offsite'));
alter table public.attendance_clock_ins add column clock_out_source text not null default 'manual' check (clock_out_source in ('manual','offsite'));
alter table public.attendance_clock_ins add column offsite_request_id uuid references public.company_leave_requests(id);
alter table public.attendance_clock_ins add column offsite_returned_at timestamptz;

create table app.offsite_attendance_config (id boolean primary key default true check(id), activated_at timestamptz not null default clock_timestamp());
insert into app.offsite_attendance_config(id) values(true);
create table app.offsite_attendance_days (
  company_id uuid not null references public.companies(id), employee_id uuid not null references public.profiles(id),
  work_date date not null, returned_at timestamptz, auto_out_at timestamptz,
  primary key(employee_id,work_date)
);
create table app.offsite_attendance_events (
  id uuid primary key default gen_random_uuid(), company_id uuid not null, employee_id uuid not null,
  work_date date not null, clock_id uuid references public.attendance_clock_ins(id), request_id uuid references public.company_leave_requests(id),
  action text not null check(action in ('auto_in','auto_out','return','approval')),
  recorded_at timestamptz not null default clock_timestamp(), actor_id uuid,
  before_at timestamptz, after_at timestamptz
);
create index offsite_attendance_scheduled_requests on public.company_leave_requests(from_date,to_date,employee_id) where kind='offsite' and status='approved';
alter table app.offsite_attendance_config enable row level security;
alter table app.offsite_attendance_days enable row level security;
alter table app.offsite_attendance_events enable row level security;
revoke all on app.offsite_attendance_config, app.offsite_attendance_days, app.offsite_attendance_events from public,anon,authenticated;

-- Idempotent reconciliation uses the employee advisory lock shared by request creation.
create function app.advance_offsite_attendance(p_employee uuid,p_date date,p_now timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare company uuid; start_at timestamptz; eligible_start timestamptz; end_at timestamptz; source_id uuid; start_source_id uuid; c public.attendance_clock_ins%rowtype;
  d app.offsite_attendance_days%rowtype; activated timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_employee::text,0));
  select activated_at into activated from app.offsite_attendance_config where id;
  select company_id into company from public.profiles where id=p_employee and status='active';
  if company is null or exists(select 1 from public.attendance_exemptions where profile_id=p_employee) then return; end if;
  if not exists(select 1 from app.leave_balance_calendar_years where year=extract(year from p_date)::integer) then return; end if;
  select min((p_date+r.start_time) at time zone 'Asia/Seoul'),
    min((p_date+r.start_time) at time zone 'Asia/Seoul') filter(where r.created_at<=((p_date+r.start_time) at time zone 'Asia/Seoul')),
    max((p_date+r.end_time) at time zone 'Asia/Seoul'),
    (array_agg(r.id order by r.start_time,r.created_at,r.id) filter(where r.created_at<=((p_date+r.start_time) at time zone 'Asia/Seoul')))[1],
    (array_agg(r.id order by r.end_time desc,r.created_at desc,r.id))[1]
  into start_at,eligible_start,end_at,start_source_id,source_id from public.company_leave_requests r
  where r.employee_id=p_employee and r.company_id=company and r.kind='offsite' and r.status='approved'
    and r.from_date<=p_date and r.to_date>=p_date
    and r.created_at<=((p_date+r.end_time) at time zone 'Asia/Seoul')
    and (r.from_date=r.to_date or (extract(isodow from p_date)<6 and not exists(select 1 from app.leave_balance_holidays h where h.day=p_date)));
  if start_at is null or end_at<activated then return; end if;
  insert into app.offsite_attendance_days(company_id,employee_id,work_date) values(company,p_employee,p_date) on conflict do nothing;
  select * into d from app.offsite_attendance_days where employee_id=p_employee and work_date=p_date for update;
  if d.returned_at is not null then
    select min((p_date+r.start_time) at time zone 'Asia/Seoul'),
      min((p_date+r.start_time) at time zone 'Asia/Seoul') filter(where r.created_at<=((p_date+r.start_time) at time zone 'Asia/Seoul')),
      max((p_date+r.end_time) at time zone 'Asia/Seoul'),
      (array_agg(r.id order by r.start_time,r.created_at,r.id) filter(where r.created_at<=((p_date+r.start_time) at time zone 'Asia/Seoul')))[1],
      (array_agg(r.id order by r.end_time desc,r.created_at desc,r.id))[1]
    into start_at,eligible_start,end_at,start_source_id,source_id from public.company_leave_requests r
    where r.employee_id=p_employee and r.company_id=company and r.kind='offsite' and r.status='approved'
      and r.from_date<=p_date and r.to_date>=p_date and ((p_date+r.start_time) at time zone 'Asia/Seoul')>d.returned_at
      and r.created_at<=((p_date+r.end_time) at time zone 'Asia/Seoul')
      and (r.from_date=r.to_date or (extract(isodow from p_date)<6 and not exists(select 1 from app.leave_balance_holidays h where h.day=p_date)));
    if start_at is null or p_now<start_at then return; end if;
    update app.offsite_attendance_days set returned_at=null,auto_out_at=null where employee_id=p_employee and work_date=p_date returning * into d;
  end if;
  if eligible_start is not null and p_now>=eligible_start and eligible_start>=activated then
    if not exists(select 1 from public.attendance_clock_ins where employee_id=p_employee and work_date=p_date)
      and app.prior_attendance_end(p_employee,p_date)>eligible_start then return; end if;
    insert into public.attendance_clock_ins(company_id,employee_id,work_date,clock_in,clock_in_source,offsite_request_id)
    values(company,p_employee,p_date,(eligible_start at time zone 'Asia/Seoul')::time,'offsite',start_source_id)
    on conflict(employee_id,work_date) do nothing returning * into c;
    if found then insert into app.offsite_attendance_events(company_id,employee_id,work_date,clock_id,request_id,action,after_at)
      values(company,p_employee,p_date,c.id,start_source_id,'auto_in',eligible_start); end if;
  end if;
  select * into c from public.attendance_clock_ins where employee_id=p_employee and work_date=p_date for update;
  if not found or p_now<end_at or c.clock_out_at is not null or c.auto_closed_at is not null then return; end if;
  if end_at < ((c.work_date+c.clock_in) at time zone 'Asia/Seoul') then return; end if;
  update public.attendance_clock_ins set clock_out_at=end_at,clock_out_source='offsite',offsite_request_id=source_id where id=c.id;
  update app.offsite_attendance_days set auto_out_at=end_at where employee_id=p_employee and work_date=p_date;
  insert into app.offsite_attendance_events(company_id,employee_id,work_date,clock_id,request_id,action,after_at)
    values(company,p_employee,p_date,c.id,source_id,'auto_out',end_at);
end $$;
revoke all on function app.advance_offsite_attendance(uuid,date,timestamptz) from public,anon,authenticated;

create function app.offsite_attendance_state(p_return boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); company uuid; today date:=(clock_timestamp() at time zone 'Asia/Seoul')::date;
  stamp timestamptz:=clock_timestamp(); start_at timestamptz; end_at timestamptz; d app.offsite_attendance_days%rowtype;
  c public.attendance_clock_ins%rowtype; state text;
begin
  if actor is null then raise exception '로그인이 필요합니다.'; end if;
  select company_id into company from public.profiles where id=actor and status='active';
  if company is null then raise exception '재직 중인 직원만 이용할 수 있습니다.'; end if;
  if exists(select 1 from public.attendance_exemptions where profile_id=actor) then
    return jsonb_build_object('state','inactive','serverNow',stamp,'workDate',today,'scheduledStartAt',null,'scheduledEndAt',null); end if;
  if not exists(select 1 from app.leave_balance_calendar_years where year=extract(year from today)::integer) then
    raise exception '이 연도의 공휴일 기준이 없어 외근 자동 처리를 확인할 수 없습니다.'; end if;
  perform app.advance_offsite_attendance(actor,today,stamp);
  select min((today+r.start_time) at time zone 'Asia/Seoul'),max((today+r.end_time) at time zone 'Asia/Seoul') into start_at,end_at
  from public.company_leave_requests r where r.company_id=company and r.employee_id=actor and r.status='approved' and r.kind='offsite'
    and r.from_date<=today and r.to_date>=today and r.created_at<=((today+r.end_time) at time zone 'Asia/Seoul') and (r.from_date=r.to_date or
      (extract(isodow from today)<6 and not exists(select 1 from app.leave_balance_holidays h where h.day=today)));
  select * into d from app.offsite_attendance_days where employee_id=actor and work_date=today for update;
  select * into c from public.attendance_clock_ins where employee_id=actor and work_date=today for update;
  if p_return then
    if start_at is null or stamp<start_at or d.employee_id is null or d.returned_at is not null then raise exception '복귀할 외근이 없습니다.'; end if;
    if c.clock_out_at is not null and c.clock_out_source<>'offsite' then raise exception '직접 기록한 퇴근은 퇴근 무르기를 이용해 주세요.'; end if;
    if c.clock_out_source='offsite' and c.clock_out_at=d.auto_out_at then
      update public.attendance_clock_ins set clock_out_at=null,clock_out_source='manual' where id=c.id;
    end if;
    update public.attendance_clock_ins set offsite_returned_at=stamp where id=c.id;
    update app.offsite_attendance_days set returned_at=stamp where employee_id=actor and work_date=today returning * into d;
    insert into app.offsite_attendance_events(company_id,employee_id,work_date,clock_id,request_id,action,actor_id,before_at)
      values(company,actor,today,c.id,c.offsite_request_id,'return',actor,c.clock_out_at);
  end if;
  state:=case when start_at is null or (c.clock_out_at is not null and c.clock_out_source<>'offsite') then 'inactive' when d.returned_at is not null then 'returned'
    when d.auto_out_at is not null then 'clocked_out' when stamp<start_at then 'scheduled' else 'offsite' end;
  return jsonb_build_object('state',state,'serverNow',stamp,'workDate',today,'scheduledStartAt',start_at,'scheduledEndAt',end_at);
end $$;
revoke all on function app.offsite_attendance_state(boolean) from public,anon,authenticated;
grant execute on function app.offsite_attendance_state(boolean) to authenticated;
create function public.my_offsite_attendance() returns jsonb language sql security invoker set search_path='' as $$ select app.offsite_attendance_state(false) $$;
create function public.return_from_offsite() returns jsonb language sql security invoker set search_path='' as $$ select app.offsite_attendance_state(true) $$;
revoke all on function public.my_offsite_attendance(),public.return_from_offsite() from public,anon;
grant execute on function public.my_offsite_attendance(),public.return_from_offsite() to authenticated;

-- Older clients' existing undo button must also cancel the offsite reservation.
alter function app.undo_clock_out_today() rename to undo_clock_out_today_original;
revoke all on function app.undo_clock_out_today_original() from public,anon,authenticated;
create function app.undo_clock_out_today() returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); today date:=(clock_timestamp() at time zone 'Asia/Seoul')::date; source text;
begin
  select clock_out_source into source from public.attendance_clock_ins where employee_id=actor and work_date=today;
  if source='offsite' then perform app.offsite_attendance_state(true);
  else perform app.undo_clock_out_today_original(); end if;
end $$;
revoke all on function app.undo_clock_out_today() from public,anon,authenticated;
grant execute on function app.undo_clock_out_today() to authenticated;

-- Use invoker privileges so the existing clock and request row policies remain authoritative.
create function public.list_effective_attendance_clocks(p_from date,p_to date,p_employee_id uuid default null)
returns table(employee_id uuid,work_date date,clock_in time,clock_out_at timestamptz,
  clock_out_reported_at timestamptz,auto_closed_at timestamptz,work_confirmed_at timestamptz,
  clock_in_source text,clock_out_source text)
language sql stable security invoker set search_path='' as $$
  select c.employee_id,c.work_date,coalesce(fix.start_time,c.clock_in),
    case when fix.id is not null and coalesce(fix.decided_at,fix.created_at)>coalesce(c.offsite_returned_at,'-infinity'::timestamptz)
      then ((c.work_date + fix.end_time + case when fix.end_next_day then interval '1 day' else interval '0' end) at time zone 'Asia/Seoul')
      when c.clock_out_source='offsite' then greatest(c.clock_out_at,ot.end_at) else c.clock_out_at end,
    c.clock_out_reported_at,c.auto_closed_at,c.work_confirmed_at,case when fix.id is not null then 'correction' else c.clock_in_source end,
    case when fix.id is not null and coalesce(fix.decided_at,fix.created_at)>coalesce(c.offsite_returned_at,'-infinity'::timestamptz)
      then 'correction' when c.clock_out_source='offsite' and ot.end_at>c.clock_out_at then 'overtime' else c.clock_out_source end
  from public.attendance_clock_ins c
  left join lateral (select r.id,r.start_time,r.end_time,r.end_next_day,r.decided_at,r.created_at from public.company_leave_requests r
    where r.employee_id=c.employee_id and r.company_id=c.company_id and r.kind='correction' and r.status='approved' and r.from_date=c.work_date
    order by r.created_at desc,r.id desc limit 1) fix on true
  left join lateral (select max((r.from_date+r.end_time+case when r.end_next_day then interval '1 day' else interval '0' end) at time zone 'Asia/Seoul') end_at
    from public.company_leave_requests r where r.employee_id=c.employee_id and r.company_id=c.company_id and r.kind='overtime' and r.status='approved'
      and r.from_date=c.work_date and r.created_at >= ((r.from_date+r.end_time+case when r.end_next_day then interval '1 day' else interval '0' end) at time zone 'Asia/Seoul')) ot on true
  where c.work_date between p_from and p_to and (p_employee_id is null or c.employee_id=p_employee_id)
  union all
  select r.employee_id,r.from_date,r.start_time,
    (r.from_date+r.end_time+case when r.end_next_day then interval '1 day' else interval '0' end) at time zone 'Asia/Seoul',
    null::timestamptz,null::timestamptz,null::timestamptz,'correction'::text,'correction'::text
  from public.company_leave_requests r
  where r.kind='correction' and r.status='approved' and r.from_date between p_from and p_to
    and (p_employee_id is null or r.employee_id=p_employee_id)
    and (r.employee_id=auth.uid() or (r.company_id=(select p.company_id from public.profiles p where p.id=auth.uid() and p.status='active')
      and (app.can_edit_org_assignment() or r.company_id=app.company_review_company_id())))
    and not exists(select 1 from public.attendance_clock_ins c where c.employee_id=r.employee_id and c.work_date=r.from_date)
    and not exists(select 1 from public.company_leave_requests newer where newer.employee_id=r.employee_id and newer.company_id=r.company_id
      and newer.kind='correction' and newer.status='approved' and newer.from_date=r.from_date
      and (newer.created_at,newer.id)>(r.created_at,r.id))
$$;
revoke all on function public.list_effective_attendance_clocks(date,date,uuid) from public,anon;
grant execute on function public.list_effective_attendance_clocks(date,date,uuid) to authenticated;

create function app.prior_attendance_end(p_employee uuid,p_date date) returns timestamptz
language sql stable security definer set search_path='' as $$
  select max(v.ends) from (
    select e.clock_out_at ends from public.list_effective_attendance_clocks(p_date-1,p_date-1,p_employee) e
    union all
    select (r.from_date+r.end_time+case when r.end_next_day then interval '1 day' else interval '0' end) at time zone 'Asia/Seoul'
    from public.company_leave_requests r where r.employee_id=p_employee and r.from_date=p_date-1 and r.kind='correction' and r.status='approved'
      and not exists(select 1 from public.attendance_clock_ins n where n.employee_id=r.employee_id and n.work_date=r.from_date)
      and not exists(select 1 from public.company_leave_requests newer where newer.employee_id=r.employee_id and newer.company_id=r.company_id
        and newer.from_date=r.from_date and newer.kind='correction' and newer.status='approved' and (newer.created_at,newer.id)>(r.created_at,r.id))
  ) v
$$;
revoke all on function app.prior_attendance_end(uuid,date) from public,anon,authenticated;

alter function app.clock_in_today() rename to clock_in_today_original;
revoke all on function app.clock_in_today_original() from public,anon,authenticated;
create function app.clock_in_today() returns time language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); today date:=(clock_timestamp() at time zone 'Asia/Seoul')::date; stamp timestamptz:=date_trunc('minute',clock_timestamp());
begin
  if actor is null then raise exception '로그인이 필요합니다.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
  if not exists(select 1 from public.attendance_clock_ins where employee_id=actor and work_date=today)
    and app.prior_attendance_end(actor,today)>stamp then raise exception '직전 퇴근시각보다 이르게 출근할 수 없습니다.'; end if;
  return app.clock_in_today_original();
end $$;
revoke all on function app.clock_in_today() from public,anon,authenticated;
grant execute on function app.clock_in_today() to authenticated;

create function app.get_overtime_checkout_preview(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); r public.company_leave_requests%rowtype; before_at timestamptz; source text; requested_at timestamptz; after_at timestamptz;
begin
  if actor is null then raise exception '로그인이 필요합니다.'; end if;
  select * into r from public.company_leave_requests where id=p_request_id and kind='overtime';
  if not found or not exists(select 1 from public.profiles where id=actor and company_id=r.company_id and status='active')
    or not (actor=r.employee_id or app.is_department_request_approver(r.company_id,r.department_id,r.kind)) then
    raise exception '이 신청을 확인할 권한이 없습니다.' using errcode='42501'; end if;
  select clock_out_at,clock_out_source into before_at,source
    from public.list_effective_attendance_clocks(r.from_date,r.from_date,r.employee_id);
  requested_at:=(r.from_date+r.end_time+case when r.end_next_day then interval '1 day' else interval '0' end) at time zone 'Asia/Seoul';
  after_at:=case when source in ('offsite','overtime') and r.created_at>=requested_at then greatest(before_at,requested_at) else before_at end;
  return jsonb_build_object('before',before_at,'after',after_at);
end $$;
revoke all on function app.get_overtime_checkout_preview(uuid) from public,anon,authenticated;
grant execute on function app.get_overtime_checkout_preview(uuid) to authenticated;
create function public.get_overtime_checkout_preview(p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select app.get_overtime_checkout_preview(p_request_id) $$;
revoke all on function public.get_overtime_checkout_preview(uuid) from public,anon;
grant execute on function public.get_overtime_checkout_preview(uuid) to authenticated;

create function app.audit_offsite_request_approval() returns trigger language plpgsql security definer set search_path='' as $$
declare c public.attendance_clock_ins%rowtype; finish timestamptz; next_start timestamptz; prior_end timestamptz; starts timestamptz;
begin
  if old.status<>'pending' or new.status<>'approved' or new.kind not in ('overtime','correction') then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.employee_id::text,0));
  finish:=(new.from_date+new.end_time+case when new.end_next_day then interval '1 day' else interval '0' end) at time zone 'Asia/Seoul';
  if new.kind='correction' and finish>clock_timestamp() then raise exception '실제 퇴근시각은 현재 시각보다 늦을 수 없습니다.'; end if;
  select min(v.starts) into next_start from (
    select (n.work_date+coalesce(f.start_time,n.clock_in)) at time zone 'Asia/Seoul' starts
    from public.attendance_clock_ins n left join lateral (
      select r.start_time from public.company_leave_requests r where r.employee_id=n.employee_id and r.company_id=n.company_id
        and r.from_date=n.work_date and r.kind='correction' and r.status='approved' order by r.created_at desc,r.id desc limit 1
    ) f on true where n.employee_id=new.employee_id and n.company_id=new.company_id and n.work_date>new.from_date
    union all
    select (r.from_date+r.start_time) at time zone 'Asia/Seoul' from public.company_leave_requests r
    where r.employee_id=new.employee_id and r.company_id=new.company_id and r.from_date>new.from_date and r.kind='correction' and r.status='approved'
      and not exists(select 1 from public.attendance_clock_ins n where n.employee_id=r.employee_id and n.work_date=r.from_date)
      and not exists(select 1 from public.company_leave_requests newer where newer.employee_id=r.employee_id and newer.company_id=r.company_id
        and newer.from_date=r.from_date and newer.kind='correction' and newer.status='approved' and (newer.created_at,newer.id)>(r.created_at,r.id))
  ) v;
  if next_start is not null and finish>next_start then raise exception '퇴근시각이 다음 출근 기록과 겹칩니다.'; end if;
  if new.kind='correction' then
    starts:=(new.from_date+new.start_time) at time zone 'Asia/Seoul';
    select max(v.ends) into prior_end from (
      select e.clock_out_at ends from public.list_effective_attendance_clocks(new.from_date-1,new.from_date-1,new.employee_id) e
      union all
      select (r.from_date+r.end_time+case when r.end_next_day then interval '1 day' else interval '0' end) at time zone 'Asia/Seoul'
      from public.company_leave_requests r where r.employee_id=new.employee_id and r.company_id=new.company_id
        and r.from_date=new.from_date-1 and r.kind='correction' and r.status='approved'
        and not exists(select 1 from public.attendance_clock_ins n where n.employee_id=r.employee_id and n.work_date=r.from_date)
        and not exists(select 1 from public.company_leave_requests newer where newer.employee_id=r.employee_id and newer.company_id=r.company_id
          and newer.from_date=r.from_date and newer.kind='correction' and newer.status='approved' and (newer.created_at,newer.id)>(r.created_at,r.id))
    ) v;
    if prior_end is not null and starts<prior_end then raise exception '출근시각이 직전 퇴근 기록과 겹칩니다.'; end if;
  end if;
  select * into c from public.attendance_clock_ins where employee_id=new.employee_id and work_date=new.from_date for update;
  if not found then return new; end if;
  if (new.kind='overtime' and c.clock_out_source='offsite' and new.created_at>=finish and finish>c.clock_out_at)
    or (new.kind='correction' and (c.clock_in_source='offsite' or c.clock_out_source='offsite')) then
    insert into app.offsite_attendance_events(company_id,employee_id,work_date,clock_id,request_id,action,actor_id,before_at,after_at)
      values(new.company_id,new.employee_id,new.from_date,c.id,new.id,'approval',new.decided_by,c.clock_out_at,finish);
  end if;
  return new;
end $$;
revoke all on function app.audit_offsite_request_approval() from public,anon,authenticated;
create trigger offsite_request_approval after update of status on public.company_leave_requests for each row execute function app.audit_offsite_request_approval();

alter function app.attendance_presence_end(uuid) rename to attendance_presence_end_original;
create function app.attendance_presence_end(p_clock_id uuid) returns timestamptz language plpgsql stable security definer set search_path='' as $$
declare c public.attendance_clock_ins%rowtype;
begin
  select * into c from public.attendance_clock_ins where id=p_clock_id;
  if exists(select 1 from app.offsite_attendance_days d join public.company_leave_requests r
    on r.employee_id=d.employee_id and r.company_id=d.company_id and r.kind='offsite' and r.status='approved'
      and r.from_date<=d.work_date and r.to_date>=d.work_date
    where d.employee_id=c.employee_id and d.work_date=c.work_date and d.returned_at is null
      and clock_timestamp()>=((d.work_date+r.start_time) at time zone 'Asia/Seoul')
      and clock_timestamp()<((d.work_date+r.end_time) at time zone 'Asia/Seoul')) then return null; end if;
  return app.attendance_presence_end_original(p_clock_id);
end $$;
revoke all on function app.attendance_presence_end(uuid) from public,anon,authenticated;

alter function app.process_attendance_presence() rename to process_attendance_presence_original;
create function app.process_attendance_presence() returns void language plpgsql security definer set search_path='' as $$
declare target record; stamp timestamptz:=clock_timestamp(); today date:=(stamp at time zone 'Asia/Seoul')::date; activated timestamptz;
begin
  select activated_at into activated from app.offsite_attendance_config where id;
  for target in select distinct r.employee_id,days.day::date work_date from public.company_leave_requests r
    cross join lateral generate_series(greatest(r.from_date,(activated at time zone 'Asia/Seoul')::date),least(r.to_date,today),interval '1 day') days(day)
    where r.kind='offsite' and r.status='approved' and ((days.day::date+r.end_time) at time zone 'Asia/Seoul')>=activated
      and r.created_at<=((days.day::date+r.end_time) at time zone 'Asia/Seoul')
      and (r.from_date=r.to_date or (extract(isodow from days.day)<6 and not exists(select 1 from app.leave_balance_holidays h where h.day=days.day::date)))
      and not exists(select 1 from public.attendance_clock_ins c where c.employee_id=r.employee_id and c.work_date=days.day::date and (c.clock_out_at is not null or c.auto_closed_at is not null))
      and (exists(select 1 from public.attendance_clock_ins c where c.employee_id=r.employee_id and c.work_date=days.day::date)
        or (((days.day::date+r.start_time) at time zone 'Asia/Seoul')>=activated and r.created_at<=((days.day::date+r.start_time) at time zone 'Asia/Seoul')))
      and not exists(select 1 from app.offsite_attendance_days d where d.employee_id=r.employee_id and d.work_date=days.day::date
        and d.returned_at is not null and ((days.day::date+r.start_time) at time zone 'Asia/Seoul')<=d.returned_at)
  loop perform app.advance_offsite_attendance(target.employee_id,target.work_date,stamp); end loop;
  perform app.process_attendance_presence_original();
end $$;
revoke all on function app.process_attendance_presence() from public,anon,authenticated;

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
    if new.kind='overtime' and (new.from_date<>new.to_date or (new.end_time<=new.start_time and not new.end_next_day) or new.note='') then
      raise exception '야근은 날짜별로 시작·종료 시각과 사유를 입력해 주세요.';
    end if;
    if new.kind = 'offsite' and new.place = '' then raise exception '외근 장소를 입력해 주세요.'; end if;
    if new.kind = 'correction' then
      if new.from_date <> new.to_date or (new.end_time <= new.start_time and not new.end_next_day) or new.note = '' then
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
      ends := case when new.kind in ('annual','official') then new.to_date + interval '1 day' else new.to_date + new.end_time + case when new.end_next_day then interval '1 day' else interval '0' end end;
      if exists (select 1 from public.company_leave_requests r where r.employee_id = actor.id and r.status in ('pending','approved')
        and r.kind <> 'correction'
        and not ((r.kind in ('offsite','remote') and new.kind in ('half','quarter','overtime'))
          or (new.kind in ('offsite','remote') and r.kind in ('half','quarter','overtime')))
        and tsrange(r.from_date + case when r.kind in ('annual','official') then time '00:00' else r.start_time end,
          case when r.kind in ('annual','official') then r.to_date + interval '1 day' else r.to_date + r.end_time + case when r.end_next_day then interval '1 day' else interval '0' end end, '[)')
          && tsrange(starts, ends, '[)')) then
        raise exception '같은 시간에 대기 중이거나 승인된 신청이 있습니다.';
      end if;
    end if;
  else
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.employee_id::text, 0));
    if new.advance_requested is distinct from old.advance_requested then raise exception '선사용 신청 여부는 변경할 수 없습니다.';end if;
    if row(new.id,new.company_id,new.employee_id,new.employee_name,new.department_id,new.department_name,new.kind,new.from_date,new.to_date,new.start_time,new.end_time,new.end_next_day,new.note,new.place,new.created_at)
      is distinct from row(old.id,old.company_id,old.employee_id,old.employee_name,old.department_id,old.department_name,old.kind,old.from_date,old.to_date,old.start_time,old.end_time,old.end_next_day,old.note,old.place,old.created_at) then
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
commit;
