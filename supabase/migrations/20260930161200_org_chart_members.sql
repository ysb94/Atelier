-- 조직도는 재직 중인 직원이 서로의 이름·직책·소속만 본다.
-- 이메일, 관리자 여부, 신청 메모는 반환하지 않는다.

create or replace function public.list_org_chart_members()
returns table (
  id uuid,
  display_name text,
  "position" text,
  department_id uuid
)
language sql
stable
security definer
set search_path to ''
as $function$
  select p.id, p.display_name, p.position, p.department_id
  from public.profiles p
  where p.status = 'active'
    and exists (
      select 1
      from public.profiles me
      where me.id = auth.uid()
        and me.status = 'active'
    )
  order by p.display_name nulls last;
$function$;

revoke all on function public.list_org_chart_members() from public, anon;
grant execute on function public.list_org_chart_members() to authenticated;
