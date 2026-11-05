-- Read-only minimum schedule projection. No table, row, existing policy or approval change.
create function app.my_department_absences(p_from date,p_to date)
returns table(request_id uuid,employee_id uuid,display_name text,kind text,from_date date,to_date date,start_time time,end_time time,end_next_day boolean,offsite_continuous boolean)
language plpgsql stable security definer set search_path='' as $$
declare actor public.profiles;
begin
 if auth.uid() is null then raise exception '로그인이 필요합니다.' using errcode='42501';end if;
 select * into actor from public.profiles p where p.id=auth.uid() and p.status='active';
 if not found or actor.company_id is null then raise exception '재직 직원만 부서 일정을 조회할 수 있습니다.' using errcode='42501';end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>61 then raise exception '62일 이내의 조회 기간을 선택해 주세요.' using errcode='22023';end if;
 if actor.department_id is null or not exists(select 1 from public.departments d where d.id=actor.department_id and d.company_id=actor.company_id and d.is_active) then return;end if;
 return query
 select r.id,p.id,p.display_name,r.kind,r.from_date,r.to_date,r.start_time,r.end_time,r.end_next_day,r.offsite_continuous
 from public.profiles p join public.company_leave_requests r on r.employee_id=p.id and r.company_id=actor.company_id
 where p.company_id=actor.company_id and p.department_id=actor.department_id and p.status='active' and p.id<>actor.id
  and r.status='approved' and r.kind in('annual','half','quarter','offsite','official') and r.from_date<=p_to
  and (r.to_date+case when r.kind='offsite' and r.end_next_day then 1 else 0 end)>=p_from
 order by r.from_date,p.display_name,r.start_time,r.id;
end $$;
revoke all on function app.my_department_absences(date,date) from public,anon;
grant execute on function app.my_department_absences(date,date) to authenticated;

create function public.list_my_department_absences(p_from date,p_to date)
returns table(request_id uuid,employee_id uuid,display_name text,kind text,from_date date,to_date date,start_time time,end_time time,end_next_day boolean,offsite_continuous boolean)
language sql stable security invoker set search_path='' as $$select * from app.my_department_absences(p_from,p_to)$$;
revoke all on function public.list_my_department_absences(date,date) from public,anon;
grant execute on function public.list_my_department_absences(date,date) to authenticated;
notify pgrst,'reload schema';
