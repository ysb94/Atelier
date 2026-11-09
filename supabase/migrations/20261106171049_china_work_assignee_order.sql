-- Editing the assignee roster follows the same manager role as the China work board.
grant execute on function app.china_work_screen_role() to authenticated;

alter policy china_work_assignees_insert on public.china_work_assignees
with check (
  company_id=(select app.permission_company_id())
  and (select app.china_work_screen_role())='manager'
  and exists (
    select from public.profiles p
    join public.departments d on d.id=p.department_id and d.company_id=p.company_id and d.is_active
    where p.id=china_work_assignees.profile_id and p.status='active'
      and p.company_id=china_work_assignees.company_id and p.department_id=app.work_department('china')
  )
);

alter policy china_work_assignees_update on public.china_work_assignees
using (company_id=(select app.permission_company_id()) and (select app.china_work_screen_role())='manager')
with check (company_id=(select app.permission_company_id()) and (select app.china_work_screen_role())='manager');

create function public.save_china_work_assignee_order(p_expected uuid[],p_ordered uuid[])
returns void language plpgsql security invoker set search_path='' set lock_timeout='3s' as $$
declare
  v_company uuid := app.permission_company_id();
  v_current uuid[];
begin
  if v_company is null or app.china_work_screen_role() is distinct from 'manager' then
    raise exception '중국 업무 관리자만 담당자 순서를 바꿀 수 있습니다.' using errcode='42501';
  end if;
  if p_expected is null or p_ordered is null then
    raise exception '저장할 담당자 순서를 확인해 주세요.' using errcode='22023';
  end if;

  -- The roster is small. The lock also covers inserts and deletes from older clients.
  lock table public.china_work_assignees in share row exclusive mode;
  select coalesce(array_agg(a.profile_id order by a.sort_order,a.created_at,a.profile_id),'{}') into v_current
  from public.china_work_assignees a where a.company_id=v_company;
  if p_ordered=v_current then return; end if;
  if p_expected is distinct from v_current then
    raise exception '담당자 목록이 변경되었습니다. 새로 조회해 주세요.' using errcode='40001';
  end if;
  if array(select id from unnest(p_ordered) as item(id) order by id)
      is distinct from array(select id from unnest(v_current) as item(id) order by id) then
    raise exception '저장할 담당자 순서를 확인해 주세요.' using errcode='22023';
  end if;
  update public.china_work_assignees a set sort_order=item.position::integer
  from unnest(p_ordered) with ordinality as item(id,position)
  where a.company_id=v_company and a.profile_id=item.id
    and a.sort_order is distinct from item.position::integer;
end $$;

revoke all on function public.save_china_work_assignee_order(uuid[],uuid[]) from public,anon,authenticated;
grant execute on function public.save_china_work_assignee_order(uuid[],uuid[]) to authenticated;
