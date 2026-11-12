begin;

-- Operations Support can review another employee's advance request in the same company.
create function app.can_review_leave_advance(p_company uuid, p_employee uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select (select app.is_operations_department_member()) and app.workforce_mode(p_employee)='head-office' and exists (
    select 1 from public.profiles p join public.departments d
      on d.id=p.department_id and d.company_id=p.company_id and d.is_active
    join public.profiles employee on employee.id=p_employee and employee.company_id=p.company_id
    where p.id=(select auth.uid()) and p.company_id=p_company and p.id<>p_employee
  );
$$;
revoke all on function app.can_review_leave_advance(uuid,uuid) from public,anon,authenticated;
grant execute on function app.can_review_leave_advance(uuid,uuid) to authenticated;

create policy leave_advance_operations_read on public.company_leave_requests for select to authenticated
  using (advance_requested and app.can_review_leave_advance(company_id,employee_id));
create policy leave_advance_operations_decide on public.company_leave_requests for update to authenticated
  using (advance_requested and status='pending' and app.can_review_leave_advance(company_id,employee_id))
  with check (advance_requested and status in ('approved','rejected') and app.can_review_leave_advance(company_id,employee_id));

-- Patch only the approval gates. Existing accrual, allocation, cancellation and offsite logic stay in place.
do $migration$
declare
  definition text;
  department_guard constant text := 'elsif not app.is_department_request_approver(old.company_id,old.department_id,old.kind) then';
  advance_guard constant text := $guard$elsif old.advance_requested then
        if not app.can_review_leave_advance(old.company_id,old.employee_id) then
          raise exception '선사용은 신청자 본인 외 운영지원 담당자만 처리할 수 있습니다.' using errcode='42501';
        end if;
      elsif not app.is_department_request_approver(old.company_id,old.department_id,old.kind) then$guard$;
  charge_guard constant text := 'app.is_department_request_approver(new.company_id,new.department_id,new.kind)';
  limit_check constant text := replace($limit$    select days into limit_days from app.leave_advance_limits where employee_id=actor;
    outstanding:=(app.leave_advance_summary(actor)->>'outstanding')::numeric;
    if borrowed<0 or outstanding+borrowed>coalesce(limit_days,0) or coalesce(limit_days,0)=0 then raise exception '선사용 한도를 초과합니다. 한도 %일 · 기존 선사용 %일 · 이번 부족분 %일',coalesce(limit_days,0),outstanding,borrowed;end if;
$limit$,E'\r\n',E'\n');
  submission_limit constant text := replace($limit$ if not exists(select 1 from app.leave_advance_limits where employee_id=new.employee_id and days>0) then raise exception '선사용 한도가 설정되지 않았습니다. 운영지원에 문의해 주세요.';end if;
$limit$,E'\r\n',E'\n');
begin
  definition := pg_get_functiondef('app.guard_company_leave_request()'::regprocedure);
  if strpos(definition,department_guard)=0 or strpos(definition,'elsif old.advance_requested then')>0 then
    raise exception 'Unexpected leave request guard definition';
  end if;
  execute replace(definition,department_guard,advance_guard);

  definition := replace(pg_get_functiondef('app.sync_leave_request_balance()'::regprocedure),E'\r\n',E'\n');
  if strpos(definition,charge_guard)=0 or strpos(definition,limit_check)=0 then
    raise exception 'Unexpected leave balance charge definition';
  end if;
  execute replace(replace(replace(replace(definition,charge_guard,'app.can_review_leave_advance(new.company_id,new.employee_id)'),
    '본인 또는 지정 승인자의 선사용 승인만 처리할 수 있습니다.','본인 등록 또는 운영지원의 선사용 승인만 처리할 수 있습니다.'),
    ' limit_days numeric; outstanding numeric;',''),limit_check,'');

  definition := replace(pg_get_functiondef('app.guard_leave_advance()'::regprocedure),E'\r\n',E'\n');
  if strpos(definition,submission_limit)=0 then raise exception 'Unexpected leave advance submission guard definition'; end if;
  execute replace(definition,submission_limit,'');
end $migration$;

-- The personal approval queue retains unrelated work and historical decisions by former approvers.
create or replace function public.list_my_approval_requests()
returns setof public.company_leave_requests language sql stable security invoker set search_path='' as $$
  select r.* from public.company_leave_requests r
  where ((r.kind in ('overtime','correction')
      or (r.advance_requested and r.status<>'pending' and not (select app.is_operations_department_member())))
    and app.is_department_request_approver(r.company_id,r.department_id,r.kind))
    or (r.status<>'pending' and r.decided_by=(select auth.uid())
      and (not r.advance_requested or not (select app.is_operations_department_member())))
  order by r.created_at desc,r.id;
$$;

create or replace function public.employee_leave_advances(p_manage boolean default false)
returns jsonb language sql volatile security invoker set search_path='' as $$
  select app.employee_leave_advances(p_manage)||jsonb_build_object('approvalMode','operations');
$$;

create function app.leave_advance_operations_notifications()
returns jsonb language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'event_key','request-approval:'||r.id,'entity_id',r.id,'created_at',r.created_at,
    'event_type','approval','tab','operations-leave','title',r.employee_name||' · 연차 선사용 승인 요청',
    'kind',r.kind,'employee_name',r.employee_name,'from_date',r.from_date,'to_date',r.to_date,
    'start_time',r.start_time,'end_time',r.end_time,'note','','decision_note',r.decision_note,
    'action_needed',r.status='pending','status',r.status,'current',r.status='pending','read_at',h.read_at
  ) order by r.created_at desc,r.id),'[]'::jsonb)
  from public.company_leave_requests r
  left join public.my_home_notification_reads h on h.reader_id=(select auth.uid()) and h.event_key='request-approval:'||r.id
  where (select app.is_operations_department_member()) and r.advance_requested
    and r.company_id=(select p.company_id from public.profiles p where p.id=(select auth.uid()))
    and (r.status='pending' or h.read_at is not null)
    and app.can_review_leave_advance(r.company_id,r.employee_id);
$$;

-- Keep existing notice sources, shared read records and employee approval results.
do $migration$
declare definition text;
begin
  definition := pg_get_functiondef('public.list_my_home_work_notifications()'::regprocedure);
  if strpos(definition,'FUNCTION public.list_my_home_work_notifications(')=0 then
    raise exception 'Unexpected work notification definition';
  end if;
  execute replace(definition,'FUNCTION public.list_my_home_work_notifications(',
    'FUNCTION app.list_my_home_work_notifications_before_ops_advance(');
end $migration$;

create or replace function public.list_my_home_work_notifications()
returns jsonb language sql stable security invoker set search_path='' as $$
  select app.list_my_home_work_notifications_before_ops_advance()||app.leave_advance_operations_notifications();
$$;
revoke all on function app.leave_advance_operations_notifications(),app.list_my_home_work_notifications_before_ops_advance() from public,anon,authenticated;
grant execute on function app.leave_advance_operations_notifications(),app.list_my_home_work_notifications_before_ops_advance() to authenticated;

commit;
