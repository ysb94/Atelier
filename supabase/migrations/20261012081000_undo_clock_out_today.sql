-- 오늘 퇴근만 비운다. 출근 시각과 다른 날 기록은 바꾸지 않는다.
create function app.undo_clock_out_today()
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  company uuid;
  today date := (pg_catalog.clock_timestamp() at time zone 'Asia/Seoul')::date;
  record public.attendance_clock_ins%rowtype;
begin
  if actor is null then raise exception '로그인이 필요합니다.'; end if;
  select company_id into company from public.profiles where id = actor and status = 'active';
  if company is null then raise exception '재직 중인 직원만 퇴근을 취소할 수 있습니다.'; end if;
  select * into record from public.attendance_clock_ins
    where employee_id = actor and company_id = company and work_date = today for update;
  if not found then raise exception '오늘 출근 기록이 없습니다.'; end if;
  if record.clock_out_at is null then raise exception '취소할 오늘 퇴근 기록이 없습니다.'; end if;
  update public.attendance_clock_ins set clock_out_at = null where id = record.id;
end;
$$;
revoke all on function app.undo_clock_out_today() from public, anon, authenticated;
grant execute on function app.undo_clock_out_today() to authenticated;

create function public.undo_clock_out_today()
returns void language sql security invoker set search_path = '' as $$
  select app.undo_clock_out_today();
$$;
revoke all on function public.undo_clock_out_today() from public, anon, authenticated;
grant execute on function public.undo_clock_out_today() to authenticated;
