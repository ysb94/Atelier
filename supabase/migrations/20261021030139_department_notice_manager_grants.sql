create or replace function public.save_company_notice(
  p_id uuid,
  p_slot text,
  p_department_id uuid,
  p_title text,
  p_body text,
  p_starts date,
  p_ends date,
  p_published boolean
) returns uuid
language sql
security definer
set search_path = ''
as $$
  select app.save_company_notice(p_id, p_slot, p_department_id, p_title, p_body, p_starts, p_ends, p_published);
$$;

create or replace function public.delete_company_notice(p_id uuid) returns void
language sql
security definer
set search_path = ''
as $$
  select app.delete_company_notice(p_id);
$$;

revoke all on function public.save_company_notice(uuid, text, uuid, text, text, date, date, boolean) from public, anon;
revoke all on function public.delete_company_notice(uuid) from public, anon;
grant execute on function public.save_company_notice(uuid, text, uuid, text, text, date, date, boolean) to authenticated;
grant execute on function public.delete_company_notice(uuid) to authenticated;;
