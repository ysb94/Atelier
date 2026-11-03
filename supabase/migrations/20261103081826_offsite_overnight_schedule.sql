-- Single-workday overnight offsite. No original rows, balances or policies are rewritten.
begin;
alter table public.company_leave_requests drop constraint company_leave_requests_span_check;
alter table public.company_leave_requests add constraint company_leave_requests_span_check check (
  (kind in ('annual','official') and not end_next_day) or
  (kind='offsite' and from_date=to_date and end_next_day and end_time<=start_time) or
  (kind in ('overtime','correction') and from_date=to_date and ((end_next_day and end_time<=start_time) or (not end_next_day and end_time>start_time))) or
  (kind not in ('annual','official','overtime','correction') and not end_next_day and end_time>start_time and
   (from_date=to_date or kind in ('offsite','remote')))
);
create or replace function app.advance_offsite_attendance(p_employee uuid,p_date date,p_now timestamptz)
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
    max(((p_date+case when r.end_next_day then 1 else 0 end)+r.end_time) at time zone 'Asia/Seoul'),
    (array_agg(r.id order by r.start_time,r.created_at,r.id) filter(where r.created_at<=((p_date+r.start_time) at time zone 'Asia/Seoul')))[1],
    (array_agg(r.id order by (p_date+r.end_time+case when r.end_next_day then interval '1 day' else interval '0' end) desc,r.created_at desc,r.id))[1]
  into start_at,eligible_start,end_at,start_source_id,source_id from public.company_leave_requests r
  where r.employee_id=p_employee and r.company_id=company and r.kind='offsite' and r.status='approved'
    and r.from_date<=p_date and r.to_date>=p_date
    and r.created_at<=(((p_date+case when r.end_next_day then 1 else 0 end)+r.end_time) at time zone 'Asia/Seoul')
    and (r.from_date=r.to_date or (extract(isodow from p_date)<6 and not exists(select 1 from app.leave_balance_holidays h where h.day=p_date)));
  if start_at is null or end_at<activated then return; end if;
  insert into app.offsite_attendance_days(company_id,employee_id,work_date) values(company,p_employee,p_date) on conflict do nothing;
  select * into d from app.offsite_attendance_days where employee_id=p_employee and work_date=p_date for update;
  if d.returned_at is not null then
    select min((p_date+r.start_time) at time zone 'Asia/Seoul'),
      min((p_date+r.start_time) at time zone 'Asia/Seoul') filter(where r.created_at<=((p_date+r.start_time) at time zone 'Asia/Seoul')),
      max(((p_date+case when r.end_next_day then 1 else 0 end)+r.end_time) at time zone 'Asia/Seoul'),
      (array_agg(r.id order by r.start_time,r.created_at,r.id) filter(where r.created_at<=((p_date+r.start_time) at time zone 'Asia/Seoul')))[1],
      (array_agg(r.id order by (p_date+r.end_time+case when r.end_next_day then interval '1 day' else interval '0' end) desc,r.created_at desc,r.id))[1]
    into start_at,eligible_start,end_at,start_source_id,source_id from public.company_leave_requests r
    where r.employee_id=p_employee and r.company_id=company and r.kind='offsite' and r.status='approved'
      and r.from_date<=p_date and r.to_date>=p_date and ((p_date+r.start_time) at time zone 'Asia/Seoul')>d.returned_at
      and r.created_at<=(((p_date+case when r.end_next_day then 1 else 0 end)+r.end_time) at time zone 'Asia/Seoul')
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

create or replace function app.offsite_attendance_state(p_return boolean default false)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare actor uuid:=auth.uid(); company uuid; today date:=(clock_timestamp() at time zone 'Asia/Seoul')::date;
  work_day date; stamp timestamptz:=clock_timestamp(); start_at timestamptz; end_at timestamptz; d app.offsite_attendance_days%rowtype;
  c public.attendance_clock_ins%rowtype; state text;
begin
  if actor is null then raise exception '로그인이 필요합니다.'; end if;
  select company_id into company from public.profiles where id=actor and status='active';
  if company is null then raise exception '재직 중인 직원만 이용할 수 있습니다.'; end if;
  if exists(select 1 from public.attendance_exemptions where profile_id=actor) then
    return jsonb_build_object('overnightSupported',true,'state','inactive','serverNow',stamp,'workDate',today,'scheduledStartAt',null,'scheduledEndAt',null); end if;
  perform app.advance_offsite_attendance(actor,today-1,stamp);
  perform app.advance_offsite_attendance(actor,today,stamp);
  work_day:=today;
  -- Keep yesterday's overnight workday until a new attendance day exists.
  if not exists(select 1 from public.attendance_clock_ins where employee_id=actor and work_date=today)
    and exists(select 1 from public.company_leave_requests r
      join app.offsite_attendance_days prior on prior.employee_id=r.employee_id and prior.work_date=today-1
      join public.attendance_clock_ins prior_clock on prior_clock.employee_id=r.employee_id and prior_clock.work_date=today-1
      where r.employee_id=actor and r.company_id=company and r.kind='offsite' and r.status='approved' and r.end_next_day
        and r.from_date=today-1 and r.to_date=today-1 and prior.returned_at is null
        and (prior_clock.clock_out_at is null or prior_clock.clock_out_source='offsite') and prior_clock.auto_closed_at is null)
  then work_day:=today-1; end if;
  -- Returned overnight staff still need to finish their original workday manually.
  if not exists(select 1 from public.attendance_clock_ins where employee_id=actor and work_date=today)
    and exists(select 1 from public.company_leave_requests r
      join app.offsite_attendance_days prior on prior.employee_id=r.employee_id and prior.work_date=today-1
      join public.attendance_clock_ins prior_clock on prior_clock.employee_id=r.employee_id and prior_clock.work_date=today-1
      where r.employee_id=actor and r.company_id=company and r.kind='offsite' and r.status='approved' and r.end_next_day
        and r.from_date=today-1 and r.to_date=today-1 and prior.returned_at is not null and prior_clock.clock_out_at is null
        and prior_clock.auto_closed_at is null)
  then work_day:=today-1; end if;
  if not exists(select 1 from app.leave_balance_calendar_years where year=extract(year from work_day)::integer) then
    raise exception '이 연도의 공휴일 기준이 없어 외근 자동 처리를 확인할 수 없습니다.'; end if;
  select min((work_day+r.start_time) at time zone 'Asia/Seoul'),max(((work_day+case when r.end_next_day then 1 else 0 end)+r.end_time) at time zone 'Asia/Seoul') into start_at,end_at
  from public.company_leave_requests r where r.company_id=company and r.employee_id=actor and r.status='approved' and r.kind='offsite'
    and r.from_date<=work_day and r.to_date>=work_day and r.created_at<=(((work_day+case when r.end_next_day then 1 else 0 end)+r.end_time) at time zone 'Asia/Seoul') and (r.from_date=r.to_date or
      (extract(isodow from work_day)<6 and not exists(select 1 from app.leave_balance_holidays h where h.day=work_day)));
  select * into d from app.offsite_attendance_days where employee_id=actor and work_date=work_day for update;
  select * into c from public.attendance_clock_ins where employee_id=actor and work_date=work_day for update;
  if p_return then
    if start_at is null or stamp<start_at or d.employee_id is null or d.returned_at is not null then raise exception '복귀할 외근이 없습니다.'; end if;
    if c.clock_out_at is not null and c.clock_out_source<>'offsite' then raise exception '직접 기록한 퇴근은 퇴근 무르기를 이용해 주세요.'; end if;
    if c.clock_out_source='offsite' and c.clock_out_at=d.auto_out_at then
      update public.attendance_clock_ins set clock_out_at=null,clock_out_source='manual' where id=c.id;
    end if;
    update public.attendance_clock_ins set offsite_returned_at=stamp where id=c.id;
    update app.offsite_attendance_days set returned_at=stamp where employee_id=actor and work_date=work_day returning * into d;
    insert into app.offsite_attendance_events(company_id,employee_id,work_date,clock_id,request_id,action,actor_id,before_at)
      values(company,actor,work_day,c.id,c.offsite_request_id,'return',actor,c.clock_out_at);
  end if;
  state:=case when start_at is null or (c.clock_out_at is not null and c.clock_out_source<>'offsite') then 'inactive' when d.returned_at is not null then 'returned'
    when d.auto_out_at is not null then 'clocked_out' when stamp<start_at then 'scheduled' else 'offsite' end;
  return jsonb_build_object('overnightSupported',true,'state',state,'serverNow',stamp,'workDate',work_day,'scheduledStartAt',start_at,'scheduledEndAt',end_at);
exception when lock_not_available then
  raise exception '다른 근태 처리가 진행 중입니다. 잠시 후 다시 시도해 주세요.' using errcode='55P03';
end $$;

create or replace function app.process_attendance_presence() returns void language plpgsql security definer set search_path='' set lock_timeout='100ms' as $$
declare target record; stamp timestamptz:=clock_timestamp(); today date:=(stamp at time zone 'Asia/Seoul')::date; activated timestamptz;
  offsite_skipped integer:=0; presence_skipped integer:=0;
begin
  select activated_at into activated from app.offsite_attendance_config where id;
  for target in select distinct r.employee_id,days.day::date work_date from public.company_leave_requests r
    cross join lateral generate_series(greatest(r.from_date,(activated at time zone 'Asia/Seoul')::date),least(r.to_date,today),interval '1 day') days(day)
    where r.kind='offsite' and r.status='approved' and (((days.day::date+case when r.end_next_day then 1 else 0 end)+r.end_time) at time zone 'Asia/Seoul')>=activated
      and r.created_at<=(((days.day::date+case when r.end_next_day then 1 else 0 end)+r.end_time) at time zone 'Asia/Seoul')
      and (r.from_date=r.to_date or (extract(isodow from days.day)<6 and not exists(select 1 from app.leave_balance_holidays h where h.day=days.day::date)))
      and not exists(select 1 from public.attendance_clock_ins c where c.employee_id=r.employee_id and c.work_date=days.day::date and (c.clock_out_at is not null or c.auto_closed_at is not null))
      and (exists(select 1 from public.attendance_clock_ins c where c.employee_id=r.employee_id and c.work_date=days.day::date)
        or (((days.day::date+r.start_time) at time zone 'Asia/Seoul')>=activated and r.created_at<=((days.day::date+r.start_time) at time zone 'Asia/Seoul')))
      and not exists(select 1 from app.offsite_attendance_days d where d.employee_id=r.employee_id and d.work_date=days.day::date
        and d.returned_at is not null and ((days.day::date+r.start_time) at time zone 'Asia/Seoul')<=d.returned_at)
    order by r.employee_id,days.day::date
  loop
    begin
      -- A busy employee must not hold up the other employees or the next cron run.
      if not pg_try_advisory_xact_lock(hashtextextended(target.employee_id::text,0)) then
        offsite_skipped:=offsite_skipped+1; continue;
      end if;
      perform app.advance_offsite_attendance(target.employee_id,target.work_date,stamp);
    exception when lock_not_available or deadlock_detected then
      -- This employee's changes/locks roll back with the subtransaction. Retry next minute.
      offsite_skipped:=offsite_skipped+1;
    end;
  end loop;
  for target in select s.clock_id,c.employee_id from app.attendance_presence_sessions s
    join public.attendance_clock_ins c on c.id=s.clock_id
    where s.closed_at is null and c.work_date>=today-1
    order by c.employee_id,c.work_date,c.id
  loop
    begin
      if not pg_try_advisory_xact_lock(hashtextextended(target.employee_id::text,0)) then
        presence_skipped:=presence_skipped+1; continue;
      end if;
      perform app.advance_attendance_presence(target.clock_id,stamp);
    exception when lock_not_available or deadlock_detected then
      presence_skipped:=presence_skipped+1;
    end;
  end loop;
  if offsite_skipped+presence_skipped>0 then
    raise warning '[attendance-presence] lock contention; deferred offsite %, presence %; retry on next scheduled run',offsite_skipped,presence_skipped;
  end if;
end $$;

create or replace function app.attendance_presence_end(p_clock_id uuid) returns timestamptz language plpgsql stable security definer set search_path='' as $$
declare c public.attendance_clock_ins%rowtype;
begin
  select * into c from public.attendance_clock_ins where id=p_clock_id;
  if exists(select 1 from app.offsite_attendance_days d join public.company_leave_requests r
    on r.employee_id=d.employee_id and r.company_id=d.company_id and r.kind='offsite' and r.status='approved'
      and r.from_date<=d.work_date and r.to_date>=d.work_date
    where d.employee_id=c.employee_id and d.work_date=c.work_date and d.returned_at is null
      and clock_timestamp()>=((d.work_date+r.start_time) at time zone 'Asia/Seoul')
      and clock_timestamp()<(((d.work_date+case when r.end_next_day then 1 else 0 end)+r.end_time) at time zone 'Asia/Seoul')) then return null; end if;
  return app.attendance_presence_end_original(p_clock_id);
end $$;

create or replace function app.clock_in_today() returns time language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare actor uuid:=auth.uid(); today date:=(clock_timestamp() at time zone 'Asia/Seoul')::date; stamp timestamptz:=date_trunc('minute',clock_timestamp());
begin
  if actor is null then raise exception '로그인이 필요합니다.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
  perform app.advance_offsite_attendance(actor,today-1,clock_timestamp());
  if not exists(select 1 from public.attendance_clock_ins where employee_id=actor and work_date=today)
    and exists(select 1 from public.company_leave_requests r join public.attendance_clock_ins c
      on c.employee_id=r.employee_id and c.work_date=r.from_date
      where r.employee_id=actor and r.kind='offsite' and r.status='approved' and r.end_next_day
        and r.from_date=today-1 and r.to_date=today-1 and c.clock_out_at is null and c.auto_closed_at is null)
  then raise exception '전날 시작한 외근이 근무 중입니다. 기존 근무의 퇴근을 먼저 기록해 주세요.'; end if;
  if not exists(select 1 from public.attendance_clock_ins where employee_id=actor and work_date=today)
    and app.prior_attendance_end(actor,today)>stamp then raise exception '직전 퇴근시각보다 이르게 출근할 수 없습니다.'; end if;
  return app.clock_in_today_original();
end $$;

create or replace function app.clock_out_today()
returns timestamptz language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare
  actor uuid := auth.uid();
  company uuid;
  today date := (pg_catalog.clock_timestamp() at time zone 'Asia/Seoul')::date;
  record public.attendance_clock_ins%rowtype;
  stamp timestamptz;
begin
  if actor is null then raise exception '로그인이 필요합니다.'; end if;
  select company_id into company from public.profiles where id = actor and status = 'active';
  if company is null then raise exception '재직 중인 직원만 퇴근을 기록할 수 있습니다.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
  select * into record from public.attendance_clock_ins
    where employee_id = actor and company_id = company and work_date = today for update;
  if not found then
    select c.* into record from public.attendance_clock_ins c
      where c.employee_id=actor and c.company_id=company and c.work_date=today-1
        and c.clock_out_at is null and c.auto_closed_at is null
        and exists(select 1 from public.company_leave_requests r where r.employee_id=actor and r.company_id=company
          and r.kind='offsite' and r.status='approved' and r.end_next_day and r.from_date=c.work_date and r.to_date=c.work_date)
      for update;
  end if;
  if not found then raise exception '오늘 출근 기록이 없습니다. 출근을 먼저 기록해 주세요.'; end if;
  if record.clock_out_at is not null then return record.clock_out_at; end if;
  -- 잠금을 얻은 뒤 서버 시각을 계산한다. 브라우저 시각/사용자/날짜를 인자로 받지 않는다.
  stamp := pg_catalog.date_trunc('minute', pg_catalog.clock_timestamp());
  if stamp < ((record.work_date + record.clock_in) at time zone 'Asia/Seoul') then
    raise exception '퇴근 시각이 출근 시각보다 빠릅니다. 출근 기록을 확인해 주세요.';
  end if;
  update public.attendance_clock_ins set clock_out_at = stamp, clock_out_source='manual' where id = record.id;
  return stamp;
end;
$$;
create or replace function app.meeting_availability(p_series uuid,p_date date,p_people uuid[],p_exclude_round uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare company uuid:=app.meeting_company_id();
begin
 if company is null or p_date is null or cardinality(p_people) not between 1 and 200 or p_people is null then
  raise exception '회의 일정 조회 대상을 확인해 주세요.' using errcode='42501'; end if;
 if not exists(select 1 from public.meeting_series where id=p_series and company_id=company and deleted_at is null
   and (host_id=auth.uid() or created_by=auth.uid())) then raise exception '회의 조율 권한이 없습니다.' using errcode='42501'; end if;
 if exists(select 1 from unnest(p_people) x where not exists(select 1 from public.profiles where id=x and company_id=company and status='active')) then
  raise exception '같은 회사의 재직자만 조회할 수 있습니다.' using errcode='42501'; end if;
 if p_exclude_round is not null and not exists(select 1 from public.meeting_rounds where id=p_exclude_round and series_id=p_series) then
  raise exception '변경할 회차를 확인해 주세요.' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(item),'[]'::jsonb) from (
  select jsonb_build_object('id',r.id::text||':'||p.id,'personId',p.id,'kind','meeting','status','approved',
   'start',to_char(r.starts_at at time zone 'Asia/Seoul','HH24:MI'),
   'end',to_char((r.starts_at+make_interval(mins=>r.duration_minutes)) at time zone 'Asia/Seoul','HH24:MI')) as item
  from public.meeting_rounds r join public.meeting_series s on s.id=r.series_id
  join public.profiles p on p.id=any(p_people) and (s.host_id=p.id or exists(select 1 from public.meeting_members m where m.series_id=s.id and m.profile_id=p.id))
  where r.company_id=company and s.deleted_at is null and r.deleted_at is null and s.phase='published' and r.confirmed_at is not null
   and r.id is distinct from p_exclude_round and not coalesce((app.meeting_round_decision(r.id)->'excludedIds') ? p.id::text,false) and (r.starts_at at time zone 'Asia/Seoul')::date=p_date
  union all
  select jsonb_build_object('id',l.id,'personId',l.employee_id,'kind',l.kind,'status',l.status,
   'start',case when l.kind in ('annual','official') or (l.kind in ('offsite','remote') and p_date>l.from_date) then '00:00' else to_char(l.start_time,'HH24:MI') end,
   'end',case when l.kind in ('annual','official') or (l.kind in ('offsite','remote') and p_date<(l.to_date+case when l.kind='offsite' and l.end_next_day then 1 else 0 end)) then '24:00' else to_char(l.end_time,'HH24:MI') end)
  from public.company_leave_requests l where l.company_id=company and l.employee_id=any(p_people)
   and l.status in ('approved','pending') and l.kind in ('annual','half','quarter','offsite','remote','official') and p_date between l.from_date and (l.to_date+case when l.kind='offsite' and l.end_next_day then 1 else 0 end)
 ) rows);
end $$;
notify pgrst,'reload schema';
commit;
