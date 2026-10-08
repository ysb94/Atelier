-- Run as postgres. Assignment and request fixtures are rolled back, including existing settings.
begin;
do $$
declare employee uuid; reviewer uuid; substitute uuid; operator uuid; company uuid; dept uuid;
  annual_id uuid; overtime_id uuid; half_id uuid; quarter_id uuid; affected integer; blocked boolean;
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
    values(company,dept,'leave',reviewer,substitute),(company,dept,'overtime',substitute,null)
    on conflict(company_id,department_id,request_type) do update set approver_id=excluded.approver_id,substitute_id=excluded.substitute_id;
  blocked:=false;
  begin update public.department_request_approvers set approver_id=gen_random_uuid() where company_id=company and department_id=dept and request_type='leave';
  exception when others then if SQLERRM like '%재직 직원%' then blocked:=true; else raise; end if; end;
  if not blocked then raise exception 'Invalid approver accepted'; end if;
  perform set_config('request.jwt.claim.sub',employee::text,true);
  update public.department_request_approvers set approver_id=employee where company_id=company and department_id=dept;
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Employee changed assignments'; end if;
  insert into public.company_leave_requests(company_id,employee_id,employee_name,department_name,kind,from_date,to_date,note)
    values(company,employee,'FORGED','FORGED','annual','2098-08-04','2098-08-04','rollback annual') returning id into annual_id;
  insert into public.company_leave_requests(company_id,employee_id,employee_name,department_name,kind,from_date,to_date,start_time,end_time,note)
    values(company,employee,'','','overtime','2098-08-05','2098-08-05','18:00','21:00','rollback overtime') returning id into overtime_id;
  insert into public.company_leave_requests(company_id,employee_id,employee_name,department_name,kind,from_date,to_date,start_time,end_time)
    values(company,employee,'','','half','2098-08-06','2098-08-06','09:00','14:00') returning id into half_id;
  insert into public.company_leave_requests(company_id,employee_id,employee_name,department_name,kind,from_date,to_date,start_time,end_time)
    values(company,employee,'','','quarter','2098-08-07','2098-08-07','09:00','11:00') returning id into quarter_id;
  if exists(select 1 from public.company_leave_requests where id=annual_id and (employee_name='FORGED' or department_id<>dept)) then raise exception 'Snapshot spoofed'; end if;
  blocked:=false;
  begin update public.company_leave_requests set status='approved' where id=annual_id;
  exception when others then if SQLERRM like '%지정 승인자%' then blocked:=true; else raise; end if; end;
  if not blocked then raise exception 'Self approval allowed'; end if;
  blocked:=false;
  begin update public.company_leave_requests set note='tamper' where id=annual_id;
  exception when others then if SQLERRM like '%원본%' then blocked:=true; else raise; end if; end;
  if not blocked then raise exception 'Source tampering allowed'; end if;
  blocked:=false;
  begin insert into public.company_leave_requests(company_id,employee_id,employee_name,department_name,kind,from_date,to_date,start_time,end_time,note)
    values(company,employee,'','','overtime','2098-08-05','2098-08-05','19:00','22:00','duplicate');
  exception when others then if SQLERRM like '%같은 시간%' then blocked:=true; else raise; end if; end;
  if not blocked then raise exception 'Overtime duplicate accepted'; end if;
  perform set_config('request.jwt.claim.sub',operator::text,true);
  if not exists(select 1 from public.company_leave_requests where id=annual_id) then raise exception 'Operations cannot monitor'; end if;
  update public.company_leave_requests set status='approved' where id=annual_id;
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Operations approved without assignment'; end if;
  if exists(select 1 from public.list_my_approval_requests() where id=annual_id) then raise exception 'Operations leaked into personal approval queue'; end if;
  perform set_config('request.jwt.claim.sub',reviewer::text,true);
  if (select count(*) from public.list_my_approval_requests() where id in(annual_id,half_id,quarter_id))<>3 then raise exception 'Assigned leave queue missing'; end if;
  if exists(select 1 from public.company_leave_requests where id=overtime_id) then raise exception 'Leave approver sees overtime'; end if;
  update public.company_leave_requests set status='approved' where id=overtime_id;
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Leave approver approved overtime'; end if;
  blocked:=false;
  begin update public.company_leave_requests set status='rejected',decision_note='' where id=half_id;
  exception when others then if SQLERRM like '%반려 사유%' then blocked:=true; else raise; end if; end;
  if not blocked then raise exception 'Rejection reason not enforced'; end if;
  update public.company_leave_requests set status='approved',decision_note='rollback approved' where id=annual_id;
  perform set_config('request.jwt.claim.sub',substitute::text,true);
  update public.company_leave_requests set status='approved' where id=overtime_id;
  update public.company_leave_requests set status='rejected',decision_note='rollback rejected' where id=half_id;
  perform set_config('request.jwt.claim.sub',operator::text,true);
  update public.department_request_approvers set approver_id=substitute,substitute_id=null where department_id=dept and request_type='leave';
  perform set_config('request.jwt.claim.sub',reviewer::text,true);
  update public.company_leave_requests set status='approved' where id=quarter_id;
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Removed approver retains pending permission'; end if;
  if not exists(select 1 from public.list_my_approval_requests() where id=annual_id and decided_by=reviewer) then raise exception 'Decision history lost after reassignment'; end if;
  perform set_config('request.jwt.claim.sub',employee::text,true);
  if not exists(select 1 from public.company_leave_requests where id=overtime_id and status='approved' and decided_by=substitute and decided_at is not null) then raise exception 'Applicant cannot see overtime approval'; end if;
  update public.company_leave_requests set status='cancelled' where id=quarter_id;
  if has_table_privilege('authenticated','public.department_request_approvers','delete') or has_table_privilege('authenticated','public.company_leave_requests','delete') then raise exception 'Destructive privilege granted'; end if;
  -- Even an explicitly assigned reviewer cannot approve their own request.
  perform set_config('request.jwt.claim.sub',operator::text,true);
  update public.department_request_approvers set approver_id=employee,substitute_id=substitute where department_id=dept and request_type='leave';
  perform set_config('request.jwt.claim.sub',employee::text,true);
  insert into public.company_leave_requests(company_id,employee_id,employee_name,department_name,kind,from_date,to_date)
    values(company,employee,'','','annual','2098-08-08','2098-08-08') returning id into annual_id;
  blocked:=false;
  begin update public.company_leave_requests set status='approved' where id=annual_id;
  exception when others then if SQLERRM like '%본인 신청%' then blocked:=true; else raise; end if; end;
  if not blocked then raise exception 'Assigned employee self approval allowed'; end if;
  if exists(select 1 from public.list_my_approval_requests() where id=annual_id) then raise exception 'Own request appears in approval queue'; end if;
  execute 'reset role';
end;
$$;
rollback;
