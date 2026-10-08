-- Even an administrator in Operations Support must stay within their own company.
alter policy leave_read on public.company_leave_requests
using (company_id = (select company_id from public.profiles where id = (select auth.uid()) and status = 'active')
  and (employee_id = (select auth.uid()) or (select app.can_edit_org_assignment())));
alter policy leave_create on public.company_leave_requests
with check (company_id = (select company_id from public.profiles where id = (select auth.uid()) and status = 'active')
  and employee_id = (select auth.uid()) and status = 'pending');
alter policy leave_transition on public.company_leave_requests
using (company_id = (select company_id from public.profiles where id = (select auth.uid()) and status = 'active')
  and status = 'pending' and (employee_id = (select auth.uid()) or (select app.can_edit_org_assignment())))
with check (company_id = (select company_id from public.profiles where id = (select auth.uid()) and status = 'active')
  and (employee_id = (select auth.uid()) or (select app.can_edit_org_assignment())));
create index company_leave_requests_department on public.company_leave_requests(department_id);
create index company_leave_requests_decider on public.company_leave_requests(decided_by);
