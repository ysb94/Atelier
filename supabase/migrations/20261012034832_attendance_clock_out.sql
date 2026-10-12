-- 기존 출근 원본과 RLS/테이블 권한은 그대로 두고 퇴근 시각만 추가한다.
alter table public.attendance_clock_ins add column clock_out_at timestamptz;
alter table public.attendance_clock_ins add constraint attendance_clock_out_after_in
  check (clock_out_at is null or clock_out_at >= ((work_date + clock_in) at time zone 'Asia/Seoul'));

create function app.clock_out_today()
returns timestamptz language plpgsql security definer set search_path = '' as $$
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
revoke all on function app.clock_out_today() from public, anon, authenticated;
grant execute on function app.clock_out_today() to authenticated;

create function public.clock_out_today()
returns timestamptz language sql security invoker set search_path = '' as $$
  select app.clock_out_today();
$$;
revoke all on function public.clock_out_today() from public, anon, authenticated;
grant execute on function public.clock_out_today() to authenticated;
