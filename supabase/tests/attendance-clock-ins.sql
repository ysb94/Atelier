begin;
do $$
declare employee uuid; other uuid; first time; second time; blocked boolean;
begin
  select id into employee from public.profiles where status='active' and email<>'dev@atelier.local' order by id limit 1;
  select p.id into other from public.profiles p left join public.departments d on d.id=p.department_id where p.status='active' and p.id<>employee and p.email<>'dev@atelier.local' and coalesce(p.position,'')<>'대표이사' and coalesce(d.name,'')<>'운영지원팀' order by p.id limit 1;
  if employee is null or other is null then raise exception 'Need two active employees'; end if;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', employee::text, true);
  first := public.clock_in_today();
  second := public.clock_in_today();
  if first is null or first <> second then raise exception 'Repeat clock-in changed the time'; end if;
  if (select count(*) from public.attendance_clock_ins where employee_id=employee and work_date=(clock_timestamp() at time zone 'Asia/Seoul')::date) <> 1 then raise exception 'Clock-in was not stored once'; end if;
  perform set_config('request.jwt.claim.sub', other::text, true);
  if exists(select 1 from public.attendance_clock_ins where employee_id=employee) then raise exception 'Another employee can read the clock-in'; end if;
  blocked := false;
  begin insert into public.attendance_clock_ins(company_id, employee_id, work_date, clock_in) values((select company_id from public.profiles where id=other), other, '2098-01-01', '09:00');
  exception when insufficient_privilege then blocked := true; end;
  if not blocked then raise exception 'Direct clock-in insert allowed'; end if;
  execute 'set local role anon';
  blocked := false;
  begin perform public.clock_in_today();
  exception when insufficient_privilege then blocked := true; end;
  if not blocked then raise exception 'Anonymous clock-in allowed'; end if;
  execute 'reset role';
end;
$$;
rollback;
select 'attendance clock-in once, isolation, direct write blocked: ok (rolled back)' as result;
