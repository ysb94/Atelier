begin;

create function app.is_active_planning_department_member()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.departments d on d.id = p.department_id and d.company_id = p.company_id
    where p.id = (select auth.uid())
      and p.status = 'active'
      and d.is_active
      and d.id = app.work_department('planning')
  )
$$;

create function app.draft_owner_access(p_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.product_drafts d
    join public.profiles p on p.id = (select auth.uid()) and p.status = 'active' and p.company_id = d.company_id
    where d.id = p_id and (app.work_operator() or d.created_by = p.id)
  )
$$;

revoke all on function app.is_active_planning_department_member(), app.draft_owner_access(uuid) from public, anon;
grant execute on function app.is_active_planning_department_member(), app.draft_owner_access(uuid) to authenticated;

create or replace function app.draft_write_allowed(p_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.product_drafts d
    join public.profiles p on p.id = (select auth.uid()) and p.status = 'active' and p.company_id = d.company_id
    where d.id = p_id
      and (app.work_operator() or d.created_by = p.id or app.is_active_planning_department_member())
  )
$$;

create or replace function public.get_my_basic_work_access()
returns jsonb
language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'profileId', auth.uid(),
    'operator', app.work_operator(),
    'legacyEdit', app.can_edit_brand(null),
    'planningDepartmentMember', app.is_active_planning_department_member(),
    'domains', coalesce((select jsonb_agg(d) from unnest(array['planning','design','md','logistics','china','operations']) d where app.basic_work_allowed(d)), '[]'),
    'brandDomains', coalesce((select jsonb_object_agg(b.id, coalesce((select jsonb_agg(d) from unnest(array['planning','design','md','logistics']) d where app.basic_work_allowed(d,b.id)), '[]')) from public.brands b where b.company_id = 'e0000000-0000-4000-8000-000000000001' and app.can_read_brand(b.id)), '{}'),
    'manageOwners', coalesce((select jsonb_agg(d) from unnest(array['planning','design','md','logistics']) d where app.work_manage_allowed(d)), '[]')
  )
$$;

alter policy draft_owner_delete on public.product_drafts
  using (app.draft_owner_access(id));

create or replace function app.guard_draft_owner()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if not app.basic_work_allowed('planning', new.brand_id) or new.company_id <> 'e0000000-0000-4000-8000-000000000001' then
      raise exception '기획안 생성 권한이 없습니다.' using errcode = '42501';
    end if;
    new.created_by := auth.uid();
    return new;
  end if;

  if tg_op = 'DELETE' then
    if not app.draft_owner_access(old.id) then
      raise exception '작성자와 지정된 운영 계정만 기획안을 삭제할 수 있습니다.' using errcode = '42501';
    end if;
    return old;
  end if;

  if new.created_by is distinct from old.created_by then
    raise exception '기획안 작성자는 변경할 수 없습니다.' using errcode = '42501';
  end if;
  if not app.draft_write_allowed(old.id) and not (
    current_user in ('postgres','supabase_admin')
    and coalesce(current_setting('app.china_workorder', true), '') = 'on'
    and app.basic_work_allowed('china')
    and (to_jsonb(new) - array['sample_work_orders','specs','updated_at']) = (to_jsonb(old) - array['sample_work_orders','specs','updated_at'])
  ) then
    raise exception '기획안을 수정할 권한이 없습니다.' using errcode = '42501';
  end if;
  if new.company_id is distinct from old.company_id then raise exception '기획안 회사는 변경할 수 없습니다.'; end if;
  if new.id <> old.id or new.draft_no is distinct from old.draft_no or new.created_at is distinct from old.created_at then
    raise exception '기획안 식별 정보는 변경할 수 없습니다.';
  end if;
  if not app.draft_brand_in_company(new.company_id, new.brand_id) then raise exception '다른 회사 브랜드에는 배정할 수 없습니다.'; end if;
  if old.status = 'confirmed' and new.brand_id is distinct from old.brand_id then raise exception '출시 확정된 기획안은 브랜드를 바꿀 수 없습니다.'; end if;
  return new;
end
$$;

commit;
