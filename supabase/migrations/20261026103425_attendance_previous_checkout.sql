-- 기존 출퇴근·사용자·승인 상태는 수정하지 않는 추가 마이그레이션.
alter table public.attendance_clock_ins add column clock_out_reported_at timestamptz;
comment on column public.attendance_clock_ins.clock_out_reported_at is '직원이 직전 근무일의 누락 퇴근을 나중에 직접 확인한 시각. 실제 퇴근시각은 clock_out_at.';

create function app.get_my_workday_basis(p_date date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := auth.uid(); company uuid; department uuid; start_at time; lunch_from time; lunch_to time;
begin
  if actor is null then raise exception '로그인이 필요합니다.'; end if;
  if p_date is null then raise exception '조회할 날짜가 필요합니다.'; end if;
  select p.company_id,p.department_id into company,department from public.profiles p where p.id=actor and p.status='active';
  if company is null then raise exception '재직 중인 직원만 조회할 수 있습니다.'; end if;
  select s.start_time into start_at from public.attendance_start_settings s
    where s.company_id=company and s.month=date_trunc('month',p_date)::date
      and (s.employee_id=actor or (s.employee_id is null and s.department_id=department))
    order by (s.employee_id=actor) desc nulls last,s.updated_at desc,s.id limit 1;
  select h.lunch_start,h.lunch_end into lunch_from,lunch_to from public.company_work_hours h where h.company_id=company;
  return jsonb_build_object('date',p_date,'start_time',start_at,'configured',start_at is not null,
    'lunch_start',coalesce(lunch_from,time '12:00'),'lunch_end',coalesce(lunch_to,time '13:00'));
end;
$$;
revoke all on function app.get_my_workday_basis(date) from public,anon,authenticated;
grant execute on function app.get_my_workday_basis(date) to authenticated;
create function public.get_my_workday_basis(p_date date)
returns jsonb language sql stable security invoker set search_path = '' as $$ select app.get_my_workday_basis(p_date); $$;
revoke all on function public.get_my_workday_basis(date) from public,anon,authenticated;
grant execute on function public.get_my_workday_basis(date) to authenticated;

create function app.confirm_previous_clock_out(p_work_date date,p_clock_out_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
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
  -- 오늘 행을 먼저 잠가 본인의 여러 창에서 보낸 확인 요청을 직렬화한다.
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
revoke all on function app.confirm_previous_clock_out(date,timestamptz) from public,anon,authenticated;
grant execute on function app.confirm_previous_clock_out(date,timestamptz) to authenticated;
create function public.confirm_previous_clock_out(p_work_date date,p_clock_out_at timestamptz)
returns jsonb language sql security invoker set search_path = '' as $$ select app.confirm_previous_clock_out(p_work_date,p_clock_out_at); $$;
revoke all on function public.confirm_previous_clock_out(date,timestamptz) from public,anon,authenticated;
grant execute on function public.confirm_previous_clock_out(date,timestamptz) to authenticated;
