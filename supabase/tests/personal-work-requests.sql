-- Run as postgres via MCP. Approver settings and requests are rolled back; no HR record is retained.
begin;
do $$
declare employee uuid; reviewer uuid; substitute uuid; operator uuid; company uuid; dept uuid;
  remote_id uuid; offsite_id uuid; correction_id uuid; affected integer; blocked boolean;
  clocks_before text; clocks_after text;
  today date := (now() at time zone 'Asia/Seoul')::date;
begin
  select id,company_id,department_id into employee,company,dept from public.profiles
    where status='active' and department_id is not null and email<>'dev@atelier.local' order by id limit 1;
  select id into reviewer from public.profiles where status='active' and company_id=company and id<>employee and email<>'dev@atelier.local' order by id limit 1;
  select id into substitute from public.profiles where status='active' and company_id=company and id not in(employee,reviewer) and email<>'dev@atelier.local' order by id limit 1;
  select id into operator from public.profiles where status='active' and company_id=company and email='dev@atelier.local';
  if employee is null or reviewer is null or substitute is null or operator is null then raise exception 'Needs three active employees and developer'; end if;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub',operator::text,true);
  insert into public.department_request_approvers(company_id,department_id,request_type,approver_id,substitute_id)
    values(company,dept,'leave',reviewer,null),(company,dept,'overtime',substitute,null)
    on conflict(company_id,department_id,request_type) do update set approver_id=excluded.approver_id,substitute_id=excluded.substitute_id;

  perform set_config('request.jwt.claim.sub',employee::text,true);
  select coalesce(string_agg(work_date::text||clock_in::text||coalesce(clock_out_at::text,''),',' order by work_date),'') into clocks_before
    from public.attendance_clock_ins where employee_id=employee;
  insert into public.company_leave_requests(company_id,employee_id,employee_name,department_name,kind,from_date,to_date,start_time,end_time,place)
    values(company,employee,'','','remote','2098-09-01','2098-09-03','09:00','18:00',' 집 ') returning id into remote_id;
  if not exists(select 1 from public.company_leave_requests where id=remote_id and place='집' and status='pending') then raise exception 'Remote range or place not saved'; end if;
  insert into public.company_leave_requests(company_id,employee_id,employee_name,department_name,kind,from_date,to_date,start_time,end_time)
    values(company,employee,'','','half','2098-09-02','2098-09-02','09:00','14:00');
  insert into public.company_leave_requests(company_id,employee_id,employee_name,department_name,kind,from_date,to_date,start_time,end_time,note)
    values(company,employee,'','','overtime','2098-09-02','2098-09-02','18:00','21:00','rollback overtime');
  blocked:=false;
  begin insert into public.company_leave_requests(company_id,employee_id,employee_name,department_name,kind,from_date,to_date)
    values(company,employee,'','','annual','2098-09-03','2098-09-03');
  exception when others then if SQLERRM like '%같은 시간%' then blocked:=true; else raise; end if; end;
  if not blocked then raise exception 'Annual leave overlapped remote work'; end if;

  blocked:=false;
  begin insert into public.company_leave_requests(company_id,employee_id,employee_name,department_name,kind,from_date,to_date,start_time,end_time,place)
    values(company,employee,'','','offsite','2098-09-10','2098-09-10','13:00','15:00','  ');
  exception when others then if SQLERRM like '%외근 장소%' then blocked:=true; else raise; end if; end;
  if not blocked then raise exception 'Offsite without place accepted'; end if;
  blocked:=false;
  begin insert into public.company_leave_requests(company_id,employee_id,employee_name,department_name,kind,from_date,to_date,start_time,end_time,place)
    values(company,employee,'','','offsite','2098-09-02','2098-09-02','13:00','15:00','거래처');
  exception when others then if SQLERRM like '%같은 시간%' then blocked:=true; else raise; end if; end;
  if not blocked then raise exception 'Offsite overlapped remote work'; end if;
  insert into public.company_leave_requests(company_id,employee_id,employee_name,department_name,kind,from_date,to_date,start_time,end_time,place)
    values(company,employee,'','','offsite','2098-09-10','2098-09-11','10:00','17:00','거래처') returning id into offsite_id;
  blocked:=false;
  begin insert into public.company_leave_requests(company_id,employee_id,employee_name,department_name,kind,from_date,to_date,start_time,end_time)
    values(company,employee,'','','half','2098-09-15','2098-09-16','09:00','14:00');
  exception when check_violation then blocked:=true; end;
  if not blocked then raise exception 'Multi-day half leave accepted'; end if;

  blocked:=false;
  begin insert into public.company_leave_requests(company_id,employee_id,employee_name,department_name,kind,from_date,to_date,start_time,end_time,note)
    values(company,employee,'','','correction',today+1,today+1,'09:00','18:00','future');
  exception when others then if SQLERRM like '%앞으로의 날짜%' then blocked:=true; else raise; end if; end;
  if not blocked then raise exception 'Future correction accepted'; end if;
  blocked:=false;
  begin insert into public.company_leave_requests(company_id,employee_id,employee_name,department_name,kind,from_date,to_date,start_time,end_time,note)
    values(company,employee,'','','correction',today-1,today-1,'09:00','18:00','  ');
  exception when others then if SQLERRM like '%사유%' then blocked:=true; else raise; end if; end;
  if not blocked then raise exception 'Correction without reason accepted'; end if;
  insert into public.company_leave_requests(company_id,employee_id,employee_name,department_name,kind,from_date,to_date,start_time,end_time,note,place)
    values(company,employee,'','','correction',today-1,today-1,'09:00','18:00','rollback correction','ignored') returning id into correction_id;
  if not exists(select 1 from public.company_leave_requests where id=correction_id and place='') then raise exception 'Correction kept a place'; end if;
  blocked:=false;
  begin insert into public.company_leave_requests(company_id,employee_id,employee_name,department_name,kind,from_date,to_date,start_time,end_time,note)
    values(company,employee,'','','correction',today-1,today-1,'09:30','18:00','duplicate');
  exception when others then if SQLERRM like '%승인 대기 중인 출퇴근 정정%' then blocked:=true; else raise; end if; end;
  if not blocked then raise exception 'Duplicate pending correction accepted'; end if;
  insert into public.company_leave_requests(company_id,employee_id,employee_name,department_name,kind,from_date,to_date,note)
    values(company,employee,'','','annual','2020-03-02','2020-03-02','rollback past annual');
  insert into public.company_leave_requests(company_id,employee_id,employee_name,department_name,kind,from_date,to_date,start_time,end_time,note)
    values(company,employee,'','','correction','2020-03-02','2020-03-02','09:00','18:00','rollback correction on leave day');
  blocked:=false;
  begin update public.company_leave_requests set place='changed' where id=offsite_id;
  exception when others then if SQLERRM like '%원본%' then blocked:=true; else raise; end if; end;
  if not blocked then raise exception 'Place tampering allowed'; end if;

  perform set_config('request.jwt.claim.sub',substitute::text,true);
  update public.company_leave_requests set status='approved' where id in(remote_id,offsite_id,correction_id);
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Overtime approver approved work or correction requests'; end if;
  perform set_config('request.jwt.claim.sub',reviewer::text,true);
  if (select count(*) from public.list_my_approval_requests() where id in(remote_id,offsite_id,correction_id))<>3 then raise exception 'Leave approver queue missing work requests'; end if;
  if not exists(select 1 from public.list_my_approval_requests() where id=offsite_id and place='거래처') then raise exception 'Approval queue lost the place'; end if;
  update public.company_leave_requests set status='approved' where id in(remote_id,offsite_id,correction_id);
  get diagnostics affected=row_count;
  if affected<>3 then raise exception 'Leave approver could not approve work or correction requests'; end if;

  perform set_config('request.jwt.claim.sub',employee::text,true);
  select coalesce(string_agg(work_date::text||clock_in::text||coalesce(clock_out_at::text,''),',' order by work_date),'') into clocks_after
    from public.attendance_clock_ins where employee_id=employee;
  if clocks_after is distinct from clocks_before then raise exception 'Approved correction changed attendance records'; end if;
  if not exists(select 1 from public.company_leave_requests where id=correction_id and status='approved' and decided_by=reviewer) then raise exception 'Applicant cannot see correction approval'; end if;
  execute 'reset role';
end;
$$;
rollback;
select 'personal work requests: remote, offsite, correction rules and leave-approver routing ok (rolled back)' as result;
