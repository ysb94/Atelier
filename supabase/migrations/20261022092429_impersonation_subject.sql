create or replace function app.impersonation_subject(p_operator_id uuid, p_target_id uuid)
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
  select p.id, p.email, p.display_name, p.position, d.name, p.company_id
  from public.profiles operator
  join public.impersonation_operators allowed on allowed.profile_id = operator.id
  join public.profiles p
    on p.company_id = operator.company_id
   and p.status = 'active'
  left join public.departments d on d.id = p.department_id
  where operator.id = p_operator_id
    and operator.status = 'active'
    and operator.company_id is not null
    and (p_target_id is null or p.id = p_target_id)
  order by d.name nulls last, p.display_name
$$;

revoke all on function app.impersonation_subject(uuid, uuid) from public, anon, authenticated;
grant execute on function app.impersonation_subject(uuid, uuid) to service_role;

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
security invoker
set search_path = public
as $$
  select * from app.impersonation_subject(p_operator_id, p_target_id)
$$;

revoke all on function public.impersonation_subject(uuid, uuid) from public, anon, authenticated;
grant execute on function public.impersonation_subject(uuid, uuid) to service_role;
