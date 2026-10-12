begin;
do $$
declare employee uuid; other uuid; stamp timestamptz; first_stamp timestamptz; original time; blocked boolean;
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
  blocked:=false;
  begin perform public.clock_out_today(); exception when others then
    if SQLERRM like '%출근 기록이 없습니다%' then blocked:=true; else raise; end if;
  end;
  if not blocked then raise exception 'Clock-out without arrival was allowed'; end if;
  original:=public.clock_in_today();
  first_stamp:=public.clock_out_today();
  stamp:=public.clock_out_today();
  if first_stamp is null or stamp<>first_stamp then raise exception 'Repeat clock-out changed first stamp'; end if;
  if (select clock_in from public.attendance_clock_ins where employee_id=employee and work_date=(clock_timestamp() at time zone 'Asia/Seoul')::date)<>original then raise exception 'Arrival changed'; end if;
  if (select clock_out_at from public.attendance_clock_ins where employee_id=employee and work_date=(clock_timestamp() at time zone 'Asia/Seoul')::date)<>stamp then raise exception 'Departure not saved'; end if;
  if (stamp at time zone 'Asia/Seoul')::date<>(clock_timestamp() at time zone 'Asia/Seoul')::date or date_part('second',stamp)<>0 then raise exception 'Server minute/date invalid'; end if;
  blocked:=false;
  begin update public.attendance_clock_ins set clock_out_at=now() where employee_id=employee;
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'Direct update allowed'; end if;
  perform set_config('request.jwt.claim.sub',other::text,true);
  if exists(select 1 from public.attendance_clock_ins where employee_id=employee) then raise exception 'Other employee can read attendance'; end if;
  execute 'set local role anon';
  blocked:=false;
  begin perform public.clock_out_today(); exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'Anonymous clock-out allowed'; end if;
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub','',true);
  blocked:=false;
  begin perform public.clock_out_today(); exception when others then if SQLERRM like '%로그인이 필요%' then blocked:=true; else raise; end if; end;
  if not blocked then raise exception 'Missing identity allowed'; end if;
  execute 'reset role';
end;
$$;
rollback;
select 'attendance clock-out: once, server time, arrival preserved, no-arrival/anonymous/direct writes blocked, employee isolation: ok (rolled back)' as result;
