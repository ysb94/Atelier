create or replace function public.impersonation_subject(p_operator_id uuid, p_target_id uuid)
returns table (
  id uuid,
  email text,
  display_name text,
  job_position text,
  department_name text,
  company_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select * from app.impersonation_subject(p_operator_id, p_target_id)
$$;

revoke all on function public.impersonation_subject(uuid, uuid) from public, anon, authenticated;
grant execute on function public.impersonation_subject(uuid, uuid) to service_role;
