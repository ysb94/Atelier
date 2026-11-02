begin;
-- Function definitions only: no business rows, permissions, schedules or time rules change.
-- Consistent order: employee advisory lock -> clock -> presence session -> presence check.
-- Interactive calls fail explicitly on contention; only the scheduled worker may defer a row.

create or replace function app.advance_attendance_presence(p_clock_id uuid,p_now timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare c public.attendance_clock_ins%rowtype; s app.attendance_presence_sessions%rowtype;
  q app.attendance_presence_checks%rowtype; finish timestamptz; employee uuid;
begin
  -- All attendance writers take the employee lock before any clock/session/check row.
  select employee_id into employee from public.attendance_clock_ins where id=p_clock_id;
  if not found then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(employee::text,0));
  select * into c from public.attendance_clock_ins where id=p_clock_id for update;
  if not found then return; end if;
  select * into s from app.attendance_presence_sessions where clock_id=c.id for update;
  if c.clock_out_at is not null or c.auto_closed_at is not null
    or exists(select 1 from public.attendance_clock_ins newer where newer.employee_id=c.employee_id and newer.work_date>c.work_date) then
    update app.attendance_presence_checks set outcome='cancelled' where clock_id=c.id and outcome in ('awaiting_delivery','waiting');
    update app.attendance_presence_sessions set closed_at=coalesce(closed_at,p_now) where clock_id=c.id;
    return;
  end if;
  finish:=app.attendance_presence_end(c.id);
  if finish is null then
    update app.attendance_presence_checks set outcome='cancelled' where clock_id=c.id and outcome in ('awaiting_delivery','waiting');
    update app.attendance_presence_sessions set missed_count=0 where clock_id=c.id;
    return;
  end if;
  if s.clock_id is null then
    insert into app.attendance_presence_sessions(clock_id,expected_end,next_prompt_at) values(c.id,finish,finish+interval '10 minutes') returning * into s;
  elsif s.closed_at is not null then
    -- A genuine manual clock-out cancellation reopens monitoring, never an auto close.
    update app.attendance_presence_sessions set closed_at=null,missed_count=0,next_prompt_at=greatest(finish+interval '10 minutes',p_now+interval '30 minutes') where clock_id=c.id returning * into s;
  elsif s.expected_end is distinct from finish then
    update app.attendance_presence_checks set outcome='cancelled' where clock_id=c.id and outcome in ('awaiting_delivery','waiting');
    update app.attendance_presence_sessions set expected_end=finish,next_prompt_at=finish+interval '10 minutes',missed_count=0 where clock_id=c.id returning * into s;
  end if;
  select * into q from app.attendance_presence_checks where clock_id=c.id and outcome in ('awaiting_delivery','waiting') for update;
  if found then
    if q.outcome='waiting' and q.deadline_at<=p_now then
      update app.attendance_presence_checks set outcome='missed' where id=q.id;
      update app.attendance_presence_sessions set missed_count=missed_count+1,next_prompt_at=q.due_at+interval '30 minutes' where clock_id=c.id returning * into s;
      if s.missed_count=5 then
        update app.attendance_presence_sessions set closed_at=q.deadline_at where clock_id=c.id;
        update public.attendance_clock_ins set auto_closed_at=q.deadline_at where id=c.id and clock_out_at is null and auto_closed_at is null;
        return;
      end if;
    elsif q.outcome='awaiting_delivery' and q.due_at+interval '5 minutes'<=p_now then
      update app.attendance_presence_checks set outcome='delivery_unconfirmed' where id=q.id;
      update app.attendance_presence_sessions set next_prompt_at=q.due_at+interval '30 minutes' where clock_id=c.id returning * into s;
    else return;
    end if;
  end if;
  if p_now>=s.next_prompt_at then
    -- A delayed scheduler must never invent historical displayed prompts or missed replies.
    insert into app.attendance_presence_checks(clock_id,due_at) values(c.id,greatest(s.next_prompt_at,p_now));
  end if;
end $$;
revoke all on function app.advance_attendance_presence(uuid,timestamptz) from public,anon,authenticated;

create or replace function app.my_attendance_presence(p_action text default 'poll',p_check_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare actor uuid:=auth.uid(); company uuid; c public.attendance_clock_ins%rowtype; q app.attendance_presence_checks%rowtype;
  s app.attendance_presence_sessions%rowtype; stamp timestamptz:=clock_timestamp(); today date:=(clock_timestamp() at time zone 'Asia/Seoul')::date;
begin
  if actor is null then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
  select p.company_id into company from public.profiles p where p.id=actor and p.status='active';
  if company is null then raise exception '재직 중인 직원만 근무 확인을 할 수 있습니다.' using errcode='42501'; end if;
  if p_action not in ('poll','present','continue','clock_out') or p_action is null then raise exception '근무 확인 동작을 다시 확인해 주세요.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
  select * into c from public.attendance_clock_ins where employee_id=actor and company_id=company and work_date=today for update;
  if not found then
    if p_action<>'poll' then raise exception '응답할 근무 확인이 없습니다. 다시 조회해 주세요.'; end if;
    return jsonb_build_object('serverNow',stamp,'state','inactive');
  end if;
  stamp:=clock_timestamp();
  if today<>(stamp at time zone 'Asia/Seoul')::date then raise exception '날짜가 바뀌었습니다. 다시 조회해 주세요.'; end if;
  perform app.advance_attendance_presence(c.id,stamp);
  select * into c from public.attendance_clock_ins where id=c.id;
  select * into s from app.attendance_presence_sessions where clock_id=c.id;
  select * into q from app.attendance_presence_checks where clock_id=c.id and outcome in ('awaiting_delivery','waiting');
  if p_action<>'poll' then
    if p_check_id is null or q.id is distinct from p_check_id or c.auto_closed_at is not null or c.clock_out_at is not null then
      raise exception '이미 처리되었거나 응답 시간이 지난 확인입니다. 다시 조회해 주세요.';
    end if;
    if p_action='present' and q.outcome='awaiting_delivery' then
      update app.attendance_presence_checks set delivered_at=stamp,deadline_at=stamp+interval '5 minutes',outcome='waiting' where id=q.id returning * into q;
    elsif p_action in ('continue','clock_out') then
      if q.outcome<>'waiting' then raise exception '근무 확인창을 다시 열어 주세요.'; end if;
      update app.attendance_presence_checks set answered_at=stamp,outcome=case when p_action='continue' then 'confirmed' else 'clocked_out' end where id=q.id;
      if p_action='continue' then
        update app.attendance_presence_sessions set missed_count=0,last_confirmed_at=stamp,next_prompt_at=stamp+interval '30 minutes' where clock_id=c.id returning * into s;
        update public.attendance_clock_ins set work_confirmed_at=stamp where id=c.id;
      else
        perform app.clock_out_today();
        update app.attendance_presence_sessions set closed_at=stamp where clock_id=c.id returning * into s;
      end if;
      q:=null;
      select * into c from public.attendance_clock_ins where id=c.id;
    end if;
  end if;
  return jsonb_build_object('serverNow',stamp,'state',case when c.clock_out_at is not null then 'clocked_out' when c.auto_closed_at is not null then 'auto_closed' when s.clock_id is null then 'unconfigured' when q.id is not null then q.outcome else 'scheduled' end,
    'clockDate',c.work_date,'autoClosedAt',c.auto_closed_at,'lastConfirmedAt',s.last_confirmed_at,'missedCount',coalesce(s.missed_count,0),'nextPromptAt',s.next_prompt_at,
    'check',case when q.id is null then null else jsonb_build_object('id',q.id,'dueAt',q.due_at,'deliveredAt',q.delivered_at,'deadlineAt',q.deadline_at) end);
exception when lock_not_available then
  raise exception '다른 근태 처리가 진행 중입니다. 잠시 후 다시 시도해 주세요.' using errcode='55P03';
end $$;
revoke all on function app.my_attendance_presence(text,uuid) from public,anon;
grant execute on function app.my_attendance_presence(text,uuid) to authenticated;

create or replace function app.offsite_attendance_state(p_return boolean default false)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
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
exception when lock_not_available then
  raise exception '다른 근태 처리가 진행 중입니다. 잠시 후 다시 시도해 주세요.' using errcode='55P03';
end $$;
revoke all on function app.offsite_attendance_state(boolean) from public,anon;
grant execute on function app.offsite_attendance_state(boolean) to authenticated;

create or replace function app.process_attendance_presence() returns void language plpgsql security definer set search_path='' set lock_timeout='100ms' as $$
declare target record; stamp timestamptz:=clock_timestamp(); today date:=(stamp at time zone 'Asia/Seoul')::date; activated timestamptz;
  offsite_skipped integer:=0; presence_skipped integer:=0;
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
revoke all on function app.process_attendance_presence() from public,anon,authenticated;
-- Manual checkout/undo/previous-day confirmation use the same employee-first order.
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
  if not found then raise exception '오늘 출근 기록이 없습니다. 출근을 먼저 기록해 주세요.'; end if;
  if record.clock_out_at is not null then return record.clock_out_at; end if;
  -- 잠금을 얻은 뒤 서버 시각을 계산한다. 브라우저 시각/사용자/날짜를 인자로 받지 않는다.
  stamp := pg_catalog.date_trunc('minute', pg_catalog.clock_timestamp());
  if stamp < ((record.work_date + record.clock_in) at time zone 'Asia/Seoul') then
    raise exception '퇴근 시각이 출근 시각보다 빠릅니다. 출근 기록을 확인해 주세요.';
  end if;
  update public.attendance_clock_ins set clock_out_at = stamp where id = record.id;
  return stamp;
end;
$$;
create or replace function app.undo_clock_out_today() returns void language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare actor uuid:=auth.uid(); today date:=(clock_timestamp() at time zone 'Asia/Seoul')::date; source text;
begin
  if actor is null then raise exception '로그인이 필요합니다.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
  select clock_out_source into source from public.attendance_clock_ins where employee_id=actor and work_date=today;
  if source='offsite' then perform app.offsite_attendance_state(true);
  else perform app.undo_clock_out_today_original(); end if;
end $$;
create or replace function app.confirm_previous_clock_out(p_work_date date,p_clock_out_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare
  actor uuid := auth.uid(); company uuid;
  today date := (clock_timestamp() at time zone 'Asia/Seoul')::date;
  current_clock public.attendance_clock_ins%rowtype;
  previous_clock public.attendance_clock_ins%rowtype;
  correction_status text;
  result_kind text;
begin
  if actor is null then raise exception '로그인이 필요합니다.'; end if;
  select p.company_id into company from public.profiles p where p.id=actor and p.status='active';
  if company is null then raise exception '재직 중인 직원만 퇴근을 확인할 수 있습니다.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
  -- 직원 잠금 뒤 오늘 행을 먼저 잠가 본인의 여러 창에서 보낸 확인 요청을 직렬화한다.
  select c.* into current_clock from public.attendance_clock_ins c
    where c.company_id=company and c.employee_id=actor and c.work_date=today for update;
  if not found then raise exception '오늘 출근을 먼저 기록해 주세요.'; end if;
  select c.* into previous_clock from public.attendance_clock_ins c
    where c.company_id=company and c.employee_id=actor and c.work_date<today
    order by c.work_date desc limit 1 for update;
  if not found or previous_clock.work_date<date '2026-10-26' then raise exception '확인할 직전 출근 기록이 없습니다.'; end if;
  if p_work_date is null or p_work_date<>previous_clock.work_date then raise exception '직전 출근일만 확인할 수 있습니다. 기록을 다시 조회해 주세요.'; end if;
  if today<>(clock_timestamp() at time zone 'Asia/Seoul')::date then raise exception '날짜가 바뀌었습니다. 기록을 다시 조회해 주세요.'; end if;
  if previous_clock.clock_out_at is not null then
    result_kind := 'already_recorded';
  else
    select r.status into correction_status from public.company_leave_requests r
      where r.company_id=company and r.employee_id=actor and r.kind='correction'
        and r.from_date=previous_clock.work_date and r.status in ('pending','approved')
      order by (r.status='approved') desc,r.created_at desc,r.id desc limit 1;
    if correction_status is not null then
      result_kind := case when correction_status='approved' then 'corrected' else 'correction_pending' end;
    else
      if p_clock_out_at is null or p_clock_out_at<>date_trunc('minute',p_clock_out_at)
        or p_clock_out_at<((previous_clock.work_date+previous_clock.clock_in) at time zone 'Asia/Seoul')
        or p_clock_out_at>((current_clock.work_date+current_clock.clock_in) at time zone 'Asia/Seoul')
        or p_clock_out_at>clock_timestamp() then
        raise exception '퇴근 시각은 직전 출근 시각부터 오늘 출근 시각 사이의 분 단위로 입력해 주세요.';
      end if;
      update public.attendance_clock_ins c set clock_out_at=p_clock_out_at,clock_out_reported_at=clock_timestamp()
        where c.id=previous_clock.id and c.employee_id=actor and c.company_id=company and c.clock_out_at is null
        returning c.* into previous_clock;
      result_kind := 'recorded';
    end if;
  end if;
  return jsonb_build_object('work_date',previous_clock.work_date,'clock_out_at',previous_clock.clock_out_at,
    'clock_out_reported_at',previous_clock.clock_out_reported_at,'outcome',result_kind);
end;
$$;
alter function app.clock_in_today() set lock_timeout='2s';
revoke all on function app.clock_out_today() from public,anon;
grant execute on function app.clock_out_today() to authenticated;
revoke all on function app.undo_clock_out_today() from public,anon;
grant execute on function app.undo_clock_out_today() to authenticated;
revoke all on function app.confirm_previous_clock_out(date,timestamptz) from public,anon;
grant execute on function app.confirm_previous_clock_out(date,timestamptz) to authenticated;
commit;
