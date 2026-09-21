-- 종료된 개별 박스는 파인더 현재 목록에서도 빼 둔다.

create or replace function public.list_masma_finder_warehouse_boxes(
  p_brand_id uuid
)
returns table (
  box_id uuid,
  display_code text,
  location_code text,
  zone text,
  style_no text,
  product_name text,
  received_on date,
  initial_qty integer,
  current_qty integer,
  status text,
  note text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path to ''
as $$
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if p_brand_id is null then
    raise exception '브랜드를 지정하세요.';
  end if;

  if not exists (
    select 1
    from public.masma_finder_users finder
    where finder.brand_id = p_brand_id
      and finder.auth_user_id = auth.uid()
      and finder.status = 'active'
  ) then
    raise exception 'Masma Finder 접근 권한이 없습니다.';
  end if;

  return query
  select
    box.id,
    box.display_code,
    loc.code,
    loc.zone,
    style.style_no,
    style.name,
    box.received_on,
    box.initial_qty,
    box.current_qty,
    box.status,
    box.note,
    box.updated_at
  from public.warehouse_boxes as box
  join public.warehouse_locations as loc
    on loc.id = box.location_id
  join public.styles as style
    on style.id = box.style_id
    and style.brand_id = box.brand_id
  where box.brand_id = p_brand_id
    and box.archived_at is null
    and box.completed_at is null
  order by box.created_at desc, box.id desc;
end;
$$;

comment on function public.list_masma_finder_warehouse_boxes(uuid) is
  '파인더 현재 박스 목록. 보관·소진·박스 출고로 종료된 행은 제외한다.';
