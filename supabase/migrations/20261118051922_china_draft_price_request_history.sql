-- Keep every round for the China manager board. The planning view still reads
-- only its pending request and latest reply per draft.
create or replace function app.list_draft_price_requests(p_scope text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_company uuid := app.permission_company_id();
begin
  if v_actor is null or v_company is null
    or (p_scope = 'china' and app.china_work_screen_role() is distinct from 'manager') then
    raise exception '단가요청 조회 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_scope is null or p_scope not in ('planning', 'china') then
    raise exception '단가요청 조회 범위를 확인해 주세요.' using errcode = '22023';
  end if;

  return coalesce((
    select jsonb_agg(app.draft_price_summary(r, d.draft_no)
      order by (r.round <> 1), (r.answered_at is not null), r.requested_at, r.id)
    from (
      select id
      from app.draft_price_requests
      where company_id = v_company and p_scope = 'china'
      union all
      (
        select distinct on (draft_id, (answered_at is not null)) id
        from app.draft_price_requests
        where company_id = v_company and p_scope = 'planning'
        order by draft_id, (answered_at is not null), round desc
      )
    ) visible
    join app.draft_price_requests r on r.id = visible.id
    join public.product_drafts d on d.company_id = r.company_id and d.id = r.draft_id
    where p_scope = 'china' or d.created_by = v_actor or app.basic_work_allowed('planning', d.brand_id)
  ), '[]'::jsonb);
end $$;
