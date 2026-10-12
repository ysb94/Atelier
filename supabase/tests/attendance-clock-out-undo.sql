begin;
do $$
declare employee uuid; other uuid; arrival time; stamp timestamptz; blocked boolean;
begin
  select p.id into employee from public.profiles p left join public.attendance_clock_ins c
    on c.employee_id=p.id and c.work_date=(clock_timestamp() at time zone 'Asia/Seoul')::date
    where p.status='active' and c.id is null order by p.id limit 1;
  select p.id into other from public.profiles p left join public.departments d on d.id=p.department_id
    where p.status='active' and p.id<>employee and p.email<>'dev@atelier.local'
    and not p.is_admin and coalesce(p.position,'')<>'대표이사' and coalesce(d.name,'')<>'운영지원팀' order by p.id limit 1;
  if employee is null or other is null then raise exception 'Need active employees without today attendance and ordinary employee'; end if;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub',employee::text,true);
  arrival:=public.clock_in_today();
  stamp:=public.clock_out_today();
  perform public.undo_clock_out_today();
  if (select clock_in from public.attendance_clock_ins where employee_id=employee and work_date=(clock_timestamp() at time zone 'Asia/Seoul')::date)<>arrival then raise exception 'Undo changed arrival'; end if;
  if (select clock_out_at from public.attendance_clock_ins where employee_id=employee and work_date=(clock_timestamp() at time zone 'Asia/Seoul')::date) is not null then raise exception 'Undo left departure'; end if;
  blocked:=false;
  begin perform public.undo_clock_out_today(); exception when others then
    if SQLERRM like '%취소할 오늘 퇴근 기록이 없습니다%' then blocked:=true; else raise; end if;
  end;
  if not blocked then raise exception 'Second undo was allowed'; end if;
  perform set_config('request.jwt.claim.sub',other::text,true);
  blocked:=false;
  begin perform public.undo_clock_out_today(); exception when others then
    if SQLERRM like '%오늘 출근 기록이 없습니다%' then blocked:=true; else raise; end if;
  end;
  if not blocked then raise exception 'Other employee undid attendance'; end if;
  if exists(select 1 from public.attendance_clock_ins where employee_id=employee) then raise exception 'Other employee can read attendance'; end if;
  execute 'set local role anon';
  blocked:=false;
  begin perform public.undo_clock_out_today(); exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'Anonymous undo allowed'; end if;
  if stamp is null then raise exception 'Clock-out stamp missing'; end if;
  execute 'reset role';
end;
$$;
rollback;
select 'attendance clock-out undo: clears today departure only, arrival kept, repeat/other/anonymous blocked: ok (rolled back)' as result;
