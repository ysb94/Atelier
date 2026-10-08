-- Representative directors may review development screens and same-company HR data.
-- Do not widen write functions, administrator flags, or approval assignments.
create function app.company_review_company_id()
returns uuid language sql stable security definer set search_path='' as $$
  select p.company_id from public.profiles p
  where auth.uid() is not null and p.id=auth.uid()
    and p.status='active' and p.position='대표이사';
$$;
revoke all on function app.company_review_company_id() from public,anon,authenticated;
grant execute on function app.company_review_company_id() to authenticated;

alter policy profiles_select_self_or_approver on public.profiles
using (id=auth.uid() or app.can_view_members()
  or company_id=(select app.company_review_company_id()));

alter policy attendance_start_read on public.attendance_start_settings
using (((select app.can_edit_org_assignment())
  and company_id=(select company_id from public.profiles where id=(select auth.uid()) and status='active'))
  or company_id=(select app.company_review_company_id()));

alter policy leave_read on public.company_leave_requests
using (company_id=(select company_id from public.profiles where id=(select auth.uid()) and status='active')
  and (employee_id=(select auth.uid()) or (select app.can_edit_org_assignment())
    or decided_by=(select auth.uid()) or app.is_department_request_approver(company_id,department_id,kind)
    or company_id=(select app.company_review_company_id())));

-- Existing narrow directory RPC: disclose hire dates to same-company reviewers only.
create or replace function public.list_org_chart_members()
returns table(id uuid,display_name text,"position" text,job_grade text,department_id uuid,hire_date date)
language sql stable security definer set search_path='' as $$
  select p.id,p.display_name,p.position,p.job_grade,p.department_id,
    case when app.can_edit_org_assignment() or p.company_id=(select app.company_review_company_id())
      then p.hire_date else null end
  from public.profiles p
  where p.status='active' and exists(select 1 from public.profiles me where me.id=auth.uid() and me.status='active')
  order by p.display_name nulls last;
$$;
revoke all on function public.list_org_chart_members() from public,anon;
grant execute on function public.list_org_chart_members() to authenticated;
