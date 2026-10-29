begin;
-- An automatic close is an unresolved state, never a fabricated actual clock-out.
alter table public.attendance_clock_ins add column auto_closed_at timestamptz;
alter table public.attendance_clock_ins add column work_confirmed_at timestamptz;
comment on column public.attendance_clock_ins.auto_closed_at is '전달된 근무 확인 5회 연속 무응답에 따른 자동 종료 시각. 실제 퇴근은 clock_out_at이며 다음 출근 때 기존 누락 퇴근 확인으로 입력한다.';

create table app.attendance_presence_sessions (
  clock_id uuid primary key references public.attendance_clock_ins(id),
  expected_end timestamptz not null,
  next_prompt_at timestamptz not null,
  missed_count integer not null default 0 check (missed_count between 0 and 5),
  last_confirmed_at timestamptz,
  closed_at timestamptz
);
create table app.attendance_presence_checks (
  id uuid primary key default gen_random_uuid(),
  clock_id uuid not null references app.attendance_presence_sessions(clock_id),
  due_at timestamptz not null,
  delivered_at timestamptz,
  deadline_at timestamptz,
  answered_at timestamptz,
  outcome text not null default 'awaiting_delivery' check (outcome in ('awaiting_delivery','waiting','missed','confirmed','clocked_out','delivery_unconfirmed','cancelled')),
  check (deadline_at is null or delivered_at is not null)
);
create unique index attendance_presence_one_open_check on app.attendance_presence_checks(clock_id) where outcome in ('awaiting_delivery','waiting');
create index attendance_presence_checks_history on app.attendance_presence_checks(clock_id,due_at);
alter table app.attendance_presence_sessions enable row level security;
alter table app.attendance_presence_checks enable row level security;
revoke all on app.attendance_presence_sessions, app.attendance_presence_checks from public,anon,authenticated;

-- Match workdayGuidance: saved start + 8 working hours, lunch, partial leave, approved overtime.
create function app.attendance_presence_end(p_clock_id uuid)
returns timestamptz language plpgsql stable security definer set search_path='' as $$
declare c public.attendance_clock_ins%rowtype; department uuid; start_time time; lunch_start time; lunch_end time;
  starts timestamptz; ends timestamptz; lunch_from timestamptz; lunch_to timestamptz; periods tstzmultirange; r record;
begin
  select * into c from public.attendance_clock_ins where id=p_clock_id;
  if not found then return null; end if;
  select p.department_id into department from public.profiles p where p.id=c.employee_id and p.company_id=c.company_id and p.status='active';
  if not found or exists(select 1 from public.attendance_exemptions e where e.profile_id=c.employee_id) then return null; end if;
  if exists(select 1 from public.company_leave_requests l where l.employee_id=c.employee_id and l.company_id=c.company_id and l.status='approved'
    and l.from_date<=c.work_date and l.to_date>=c.work_date and l.kind in ('annual','official')) then return null; end if;
  select s.start_time into start_time from public.attendance_start_settings s where s.company_id=c.company_id
    and s.month=date_trunc('month',c.work_date)::date and (s.employee_id=c.employee_id or (s.employee_id is null and s.department_id=department))
    order by (s.employee_id=c.employee_id) desc nulls last,s.updated_at desc,s.id limit 1;
  if start_time is null then return null; end if;
  select h.lunch_start,h.lunch_end into lunch_start,lunch_end from public.company_work_hours h where h.company_id=c.company_id;
  starts:=(c.work_date+start_time) at time zone 'Asia/Seoul';
  lunch_from:=(c.work_date+coalesce(lunch_start,time '12:00')) at time zone 'Asia/Seoul';
  lunch_to:=(c.work_date+coalesce(lunch_end,time '13:00')) at time zone 'Asia/Seoul';
  if lunch_to<lunch_from then return null; end if;
  ends:=starts+interval '8 hours';
  if starts<lunch_to and ends>lunch_from then ends:=ends+(lunch_to-greatest(starts,lunch_from)); end if;
  periods:=tstzmultirange(tstzrange(starts,ends,'[)'))-tstzmultirange(tstzrange(lunch_from,lunch_to,'[)'));
  for r in select * from public.company_leave_requests l where l.employee_id=c.employee_id and l.company_id=c.company_id
    and l.status='approved' and l.from_date<=c.work_date and l.to_date>=c.work_date and l.kind in ('half','quarter')
  loop
    periods:=periods-tstzmultirange(tstzrange((c.work_date+r.start_time) at time zone 'Asia/Seoul',(c.work_date+r.end_time) at time zone 'Asia/Seoul','[)'));
  end loop;
  for r in select * from public.company_leave_requests l where l.employee_id=c.employee_id and l.company_id=c.company_id
    and l.status='approved' and l.from_date=c.work_date and l.to_date=c.work_date and l.kind='overtime'
  loop
    periods:=periods+tstzmultirange(tstzrange((c.work_date+r.start_time) at time zone 'Asia/Seoul',(c.work_date+r.end_time) at time zone 'Asia/Seoul','[)'));
  end loop;
  select max(upper(part)) into ends from unnest(periods) part;
  return case when ends is null then null else greatest(ends,(c.work_date+c.clock_in) at time zone 'Asia/Seoul') end;
end $$;
revoke all on function app.attendance_presence_end(uuid) from public,anon,authenticated;

-- Clock row -> session -> check is the lock order for both clients and the scheduler.
-- Only private callers may supply a clock/time, so clients cannot fast-forward timers.
create function app.advance_attendance_presence(p_clock_id uuid,p_now timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare c public.attendance_clock_ins%rowtype; s app.attendance_presence_sessions%rowtype;
  q app.attendance_presence_checks%rowtype; finish timestamptz;
begin
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

create function app.my_attendance_presence(p_action text default 'poll',p_check_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); company uuid; c public.attendance_clock_ins%rowtype; q app.attendance_presence_checks%rowtype;
  s app.attendance_presence_sessions%rowtype; stamp timestamptz:=clock_timestamp(); today date:=(clock_timestamp() at time zone 'Asia/Seoul')::date;
begin
  if actor is null then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
  select p.company_id into company from public.profiles p where p.id=actor and p.status='active';
  if company is null then raise exception '재직 중인 직원만 근무 확인을 할 수 있습니다.' using errcode='42501'; end if;
  if p_action not in ('poll','present','continue','clock_out') or p_action is null then raise exception '근무 확인 동작을 다시 확인해 주세요.'; end if;
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
end $$;
revoke all on function app.my_attendance_presence(text,uuid) from public,anon,authenticated;
grant execute on function app.my_attendance_presence(text,uuid) to authenticated;
create function public.my_attendance_presence(p_action text default 'poll',p_check_id uuid default null)
returns jsonb language sql security invoker set search_path='' as $$ select app.my_attendance_presence(p_action,p_check_id); $$;
revoke all on function public.my_attendance_presence(text,uuid) from public,anon,authenticated;
grant execute on function public.my_attendance_presence(text,uuid) to authenticated;

create function app.process_attendance_presence()
returns void language plpgsql security definer set search_path='' as $$
declare target uuid; stamp timestamptz:=clock_timestamp();
begin
  for target in select s.clock_id from app.attendance_presence_sessions s join public.attendance_clock_ins c on c.id=s.clock_id
    where s.closed_at is null and c.work_date>=(stamp at time zone 'Asia/Seoul')::date-1
  loop perform app.advance_attendance_presence(target,stamp); end loop;
end $$;
revoke all on function app.process_attendance_presence() from public,anon,authenticated;
select cron.schedule('atelier-attendance-presence','* * * * *','select app.process_attendance_presence();');
commit;
