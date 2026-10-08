-- Run as postgres; every fixture and temporary profile change is rolled back.
begin;
do $$
declare ceo uuid; employee uuid; foreign_employee uuid; company uuid; other_company uuid;
  own_request uuid; foreign_request uuid; own_setting uuid; foreign_setting uuid; brand uuid;
  affected integer; blocked boolean;
begin
  select id,company_id into ceo,company from public.profiles where status='active' and position='대표이사' and not is_admin limit 1;
  select id into employee from public.profiles where status='active' and company_id=company
    and id<>ceo and email<>'dev@atelier.local' and (position is null or position='사원') order by id limit 1;
  select id into foreign_employee from public.profiles where status='active' and company_id=company
    and id not in(ceo,employee) and email<>'dev@atelier.local' order by id limit 1;
  if ceo is null or employee is null or foreign_employee is null then raise exception 'Needs representative director and two employees'; end if;
  perform set_config('request.jwt.claim.sub','',true);
  insert into public.companies(name) values('company-review-rollback-only') returning id into other_company;
  update public.profiles set company_id=other_company,department_id=null,position=null,job_grade=null where id=foreign_employee;
  update public.profiles set hire_date='2000-01-01' where id=employee;
  insert into public.profile_capabilities(profile_id,capability) values(employee,'data'),(foreign_employee,'data') on conflict do nothing;
  select id into brand from public.brands where company_id=company limit 1;
  if brand is null then raise exception 'Needs same-company brand'; end if;
  insert into public.brand_members(brand_id,profile_id,is_lead) values(brand,employee,false),(brand,foreign_employee,false) on conflict do nothing;
  insert into public.attendance_start_settings(company_id,month,employee_id,source,start_time,updated_by)
    values(company,'2098-07-01',employee,'individual','09:00',ceo) returning id into own_setting;
  insert into public.attendance_start_settings(company_id,month,employee_id,source,start_time,updated_by)
    values(other_company,'2098-07-01',foreign_employee,'individual','10:00',foreign_employee) returning id into foreign_setting;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub',employee::text,true);
  insert into public.company_leave_requests(company_id,employee_id,employee_name,department_name,kind,from_date,to_date,note)
    values(company,employee,'','','annual','2098-07-02','2098-07-02','company-review rollback fixture') returning id into own_request;
  perform set_config('request.jwt.claim.sub',foreign_employee::text,true);
  insert into public.company_leave_requests(company_id,employee_id,employee_name,department_name,kind,from_date,to_date,note)
    values(other_company,foreign_employee,'','','annual','2098-07-02','2098-07-02','company-review rollback fixture') returning id into foreign_request;
  perform set_config('request.jwt.claim.sub',ceo::text,true);
  if app.company_review_company_id() is distinct from company then raise exception 'Reviewer company missing'; end if;
  if not exists(select 1 from public.profiles where id=employee) or exists(select 1 from public.profiles where id=foreign_employee) then raise exception 'Profile company isolation failed'; end if;
  if not exists(select 1 from public.profile_capabilities where profile_id=employee and capability='data') or exists(select 1 from public.profile_capabilities where profile_id=foreign_employee) then raise exception 'Capability company isolation failed'; end if;
  if not exists(select 1 from public.brand_members where profile_id=employee and brand_id=brand) then raise exception 'Member stewardship missing'; end if;
  if not app.is_brand_lead(brand) and exists(select 1 from public.brand_members where profile_id=foreign_employee and brand_id=brand) then raise exception 'Stewardship company isolation failed'; end if;
  if not exists(select 1 from public.company_leave_requests where id=own_request) or exists(select 1 from public.company_leave_requests where id=foreign_request) then raise exception 'Request company isolation failed'; end if;
  if not exists(select 1 from public.attendance_start_settings where id=own_setting) or exists(select 1 from public.attendance_start_settings where id=foreign_setting) then raise exception 'Schedule company isolation failed'; end if;
  if not exists(select 1 from public.list_org_chart_members() where id=employee and hire_date='2000-01-01') then raise exception 'Reviewer hire date missing'; end if;
  if app.can_edit_org_assignment() or app.can_manage_personnel() or app.is_admin() then raise exception 'Reviewer gained write privileges'; end if;
  update public.company_leave_requests set status='approved' where id=own_request;
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Reviewer approved without assignment'; end if;
  update public.profiles set position='팀장' where id=employee;
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Reviewer changed employee position'; end if;
  update public.department_request_approvers set approver_id=ceo where company_id=company;
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Reviewer assigned approval permissions'; end if;
  blocked:=false;
  begin perform public.save_attendance_start_settings('2098-07-01','2098-07-01',null,employee,'10:00',5);
  exception when others then if SQLERRM like '%운영지원팀만%' then blocked:=true; else raise; end if; end;
  if not blocked then raise exception 'Reviewer saved schedule'; end if;
  blocked:=false;
  begin update public.profiles set position='팀장' where id=ceo;
  exception when others then if SQLERRM like '%직책%' then blocked:=true; else raise; end if; end;
  if not blocked then raise exception 'Reviewer self-promoted'; end if;
  perform set_config('request.jwt.claim.sub',employee::text,true);
  if app.company_review_company_id() is not null or exists(select 1 from public.attendance_start_settings where id=own_setting) then raise exception 'Ordinary employee gained reviewer access'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub','',true);
  update public.profiles set status='disabled' where id=ceo;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub',ceo::text,true);
  if app.company_review_company_id() is not null or exists(select 1 from public.company_leave_requests where id=own_request) then raise exception 'Disabled reviewer retained access'; end if;
  execute 'set local role anon';
  blocked:=false;
  begin perform app.company_review_company_id(); exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'Anonymous reviewer function access'; end if;
  execute 'reset role';
end;
$$;
rollback;
select 'representative director read, company isolation, disabled/anonymous denial, unchanged writes: ok (rolled back)' as result;
