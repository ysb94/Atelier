-- Run as postgres via MCP. All test requests are rolled back; no HR record is retained.
begin;
do $$
declare employee uuid; other_employee uuid; reviewer uuid; company uuid; dept uuid; reviewer_dept uuid;
  first_id uuid; half_id uuid; quarter_id uuid; cancelled_id uuid; affected integer; blocked boolean;
begin
  select id, company_id into employee, company from public.profiles
  where status = 'active' and email <> 'dev@atelier.local' order by id limit 1;
  select id into other_employee from public.profiles
  where status = 'active' and id <> employee and email <> 'dev@atelier.local' order by id limit 1;
  select id into reviewer from public.profiles where status = 'active' and email = 'dev@atelier.local';
  if employee is null or other_employee is null or reviewer is null then raise exception 'Test needs two active employees and developer reviewer'; end if;
  select department_id into dept from public.profiles where id=employee;
  select department_id into reviewer_dept from public.profiles where id=reviewer;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', reviewer::text, true);
  insert into public.department_request_approvers(company_id,department_id,request_type,approver_id)
    select company,d,'leave',reviewer from (select distinct unnest(array[dept,reviewer_dept]) as d) targets where d is not null
    on conflict(company_id,department_id,request_type) do update set approver_id=excluded.approver_id,substitute_id=null;
  perform set_config('request.jwt.claim.sub', employee::text, true);
  insert into public.company_leave_requests(company_id,employee_id,employee_name,department_name,kind,from_date,to_date,note)
  values(company,employee,'FORGED','FORGED','annual','2098-06-01','2098-06-02','Rollback test') returning id into first_id;
  if not exists(select 1 from public.company_leave_requests where id=first_id and status='pending' and employee_name <> 'FORGED') then raise exception 'Snapshot/state not enforced'; end if;
  blocked := false;
  begin
    insert into public.company_leave_requests(company_id,employee_id,employee_name,department_name,kind,from_date,to_date)
    values(company,employee,'','','annual','2098-06-02','2098-06-03');
  exception when others then if SQLERRM like '%같은 시간%' then blocked:=true; else raise; end if; end;
  if not blocked then raise exception 'Duplicate request allowed'; end if;
  blocked := false;
  begin update public.company_leave_requests set status='approved' where id=first_id;
  exception when others then if SQLERRM like '%지정 승인자%' then blocked:=true; else raise; end if; end;
  if not blocked then raise exception 'Employee approved own request'; end if;
  blocked := false;
  begin update public.company_leave_requests set note='tamper' where id=first_id;
  exception when others then if SQLERRM like '%원본%' then blocked:=true; else raise; end if; end;
  if not blocked then raise exception 'Request content tampering allowed'; end if;
  insert into public.company_leave_requests(company_id,employee_id,employee_name,department_name,kind,from_date,to_date,start_time,end_time)
  values(company,employee,'','','half','2098-06-04','2098-06-04','09:00','14:00') returning id into half_id;
  insert into public.company_leave_requests(company_id,employee_id,employee_name,department_name,kind,from_date,to_date,start_time,end_time)
  values(company,employee,'','','quarter','2098-06-05','2098-06-05','09:00','11:00') returning id into quarter_id;
  blocked := false;
  begin
    insert into public.company_leave_requests(company_id,employee_id,employee_name,department_name,kind,from_date,to_date,start_time,end_time)
    values(company,employee,'','','half','2098-06-06','2098-06-06','09:00','10:00');
  exception when others then if SQLERRM like '%4시간%' then blocked:=true; else raise; end if; end;
  if not blocked then raise exception 'Invalid half-day duration allowed'; end if;
  perform set_config('request.jwt.claim.sub', other_employee::text, true);
  if exists(select 1 from public.company_leave_requests where id in(first_id,half_id,quarter_id)) then raise exception 'Another employee read private requests'; end if;
  update public.company_leave_requests set status='approved' where id=first_id;
  get diagnostics affected=row_count;
  if affected <> 0 then raise exception 'Another department approved request'; end if;
  blocked := false;
  begin
    insert into public.company_leave_requests(company_id,employee_id,employee_name,department_name,kind,from_date,to_date)
    values(company,employee,'','','annual','2098-07-01','2098-07-01');
  exception when others then if SQLERRM like '%본인 신청%' then blocked:=true; else raise; end if; end;
  if not blocked then raise exception 'Forged employee ownership allowed'; end if;
  perform set_config('request.jwt.claim.sub', reviewer::text, true);
  if (select count(*) from public.company_leave_requests where id in(first_id,half_id,quarter_id)) <> 3 then raise exception 'Operations reviewer cannot read queue'; end if;
  update public.company_leave_requests set status='approved', decision_note='Rollback approval' where id=first_id;
  blocked := false;
  begin update public.company_leave_requests set status='rejected', decision_note='' where id=half_id;
  exception when others then if SQLERRM like '%반려 사유%' then blocked:=true; else raise; end if; end;
  if not blocked then raise exception 'Rejection without reason allowed'; end if;
  update public.company_leave_requests set status='rejected',decision_note='Rollback rejection' where id=half_id;
  perform set_config('request.jwt.claim.sub', employee::text, true);
  if not exists(select 1 from public.company_leave_requests where id=first_id and status='approved' and decided_by=reviewer and decided_at is not null) then raise exception 'Applicant cannot see approval'; end if;
  if not exists(select 1 from public.company_leave_requests where id=half_id and status='rejected' and decision_note='Rollback rejection') then raise exception 'Applicant cannot see rejection reason'; end if;
  update public.company_leave_requests set status='cancelled' where id=quarter_id;
  update public.company_leave_requests set status='cancelled' where id=first_id and status='pending';
  get diagnostics affected=row_count;
  if affected <> 0 then raise exception 'Processed request modified'; end if;
  insert into public.company_leave_requests(company_id,employee_id,employee_name,department_name,kind,from_date,to_date)
  values(company,employee,'','','annual','2098-06-05','2098-06-05') returning id into cancelled_id;
  update public.company_leave_requests set status='cancelled' where id=cancelled_id;
  blocked := false;
  begin delete from public.company_leave_requests where id=cancelled_id;
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'HR history deleted'; end if;
  perform set_config('request.jwt.claim.sub', reviewer::text, true);
  insert into public.company_leave_requests(company_id,employee_id,employee_name,department_name,kind,from_date,to_date)
  values(company,reviewer,'','','annual','2098-08-01','2098-08-01') returning id into cancelled_id;
  blocked := false;
  begin update public.company_leave_requests set status='approved' where id=cancelled_id;
  exception when others then if SQLERRM like '%다른 지정 승인자%' then blocked:=true; else raise; end if; end;
  if not blocked then raise exception 'Reviewer self-approval allowed'; end if;
  execute 'set local role anon';
  blocked := false;
  begin perform count(*) from public.company_leave_requests;
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'Anonymous access allowed'; end if;
  execute 'reset role';
end;
$$;
rollback;
select 'leave approval, rejection, cancellation, duplicate and RLS tests: ok (rolled back)' as result;
