-- 창고 파인더 RPC는 Atelier 회사 승인과 Finder 전용 승인을 OR로만 연다.
-- can_read_brand 자체는 넓히지 않는다.

create or replace function app.search_warehouse_finder_rows_core(
  p_brand_id uuid,
  p_mode text,
  p_query text,
  p_limit integer
)
returns table (
  position_id uuid,
  set_id uuid,
  external_row_id text,
  location_code text,
  is_final_location boolean,
  zone text,
  style_id uuid,
  source_style_no text,
  normalized_style_no text,
  source_product_name text,
  official_style_name text,
  received_on date,
  received_on_raw text,
  usage_priority text,
  quantity_status text,
  units_per_box numeric,
  remaining_boxes numeric,
  opened_units integer,
  review_flags text[],
  note text,
  inbound_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 200));
  v_query text := btrim(coalesce(p_query, ''));
  v_style_nos text[] := app.warehouse_finder_style_candidates(v_query);
begin
  if p_brand_id is null then
    raise exception '브랜드를 지정하세요.';
  end if;
  if not app.can_access_warehouse_finder(p_brand_id) then
    raise exception '창고 파인더를 조회할 권한이 없습니다.';
  end if;
  if p_mode not in ('product', 'warehouse', 'mnumber') then
    raise exception '지원하지 않는 검색 모드입니다.';
  end if;
  if v_query = '' then
    return;
  end if;

  return query
  with active_set as (
    select inventory_set.id
    from public.warehouse_inventory_sets as inventory_set
    where inventory_set.brand_id = p_brand_id
      and inventory_set.kind = 'sandbox'
      and inventory_set.status = 'active'
    limit 1
  ),
  location_kind_counts as (
    select
      location.code as location_code,
      count(distinct app.warehouse_finder_product_kind_key(
        position.normalized_style_no,
        position.source_style_no,
        position.source_product_name
      ))::integer as inbound_count
    from public.warehouse_stock_positions as position
    join active_set
      on active_set.id = position.set_id
    join public.warehouse_locations as location
      on location.id = position.location_id
    where position.brand_id = p_brand_id
    group by location.code
  ),
  matched as (
    select
      position.id as position_id,
      position.set_id,
      position.external_row_id,
      location.code as location_code,
      position.is_final_location,
      location.zone,
      position.style_id,
      position.source_style_no,
      position.normalized_style_no,
      position.source_product_name,
      style.name as official_style_name,
      position.received_on,
      position.received_on_raw,
      position.usage_priority,
      position.quantity_status,
      position.units_per_box,
      position.remaining_boxes,
      position.opened_units,
      position.review_flags,
      position.note,
      coalesce(location_kind_counts.inbound_count, 0) as inbound_count
    from public.warehouse_stock_positions as position
    join active_set
      on active_set.id = position.set_id
    join public.warehouse_locations as location
      on location.id = position.location_id
    left join public.styles as style
      on style.id = position.style_id
     and style.brand_id = position.brand_id
    left join location_kind_counts
      on location_kind_counts.location_code = location.code
    where position.brand_id = p_brand_id
      and (
        (
          p_mode = 'product'
          and (
            strpos(lower(position.source_product_name), lower(v_query)) = 1
            or strpos(lower(coalesce(style.name, '')), lower(v_query)) = 1
          )
        )
        or (
          p_mode = 'warehouse'
          and strpos(lower(location.code), lower(v_query)) = 1
        )
        or (
          p_mode = 'mnumber'
          and (
            position.normalized_style_no = any(v_style_nos)
            or upper(regexp_replace(position.source_style_no, '\s+', '', 'g')) = any(v_style_nos)
          )
        )
      )
  )
  select
    matched.position_id,
    matched.set_id,
    matched.external_row_id,
    matched.location_code,
    matched.is_final_location,
    matched.zone,
    matched.style_id,
    matched.source_style_no,
    matched.normalized_style_no,
    matched.source_product_name,
    matched.official_style_name,
    matched.received_on,
    matched.received_on_raw,
    matched.usage_priority,
    matched.quantity_status,
    matched.units_per_box::numeric,
    matched.remaining_boxes::numeric,
    matched.opened_units,
    matched.review_flags,
    matched.note,
    matched.inbound_count
  from matched
  order by
    case matched.usage_priority
      when 'first' then 0
      when 'second' then 1
      when 'fifo' then 2
      else 3
    end,
    matched.received_on nulls first,
    matched.is_final_location,
    matched.location_code
  limit v_limit;
end;
$$;

create or replace function app.list_warehouse_finder_inbounds_core(
  p_brand_id uuid,
  p_location_base text,
  p_limit integer
)
returns table (
  position_id uuid,
  set_id uuid,
  external_row_id text,
  location_code text,
  is_final_location boolean,
  zone text,
  style_id uuid,
  source_style_no text,
  normalized_style_no text,
  source_product_name text,
  official_style_name text,
  received_on date,
  received_on_raw text,
  usage_priority text,
  quantity_status text,
  units_per_box numeric,
  remaining_boxes numeric,
  opened_units integer,
  review_flags text[],
  note text,
  inbound_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 200), 200));
  v_base text := btrim(coalesce(p_location_base, ''));
begin
  if p_brand_id is null then
    raise exception '브랜드를 지정하세요.';
  end if;
  if not app.can_access_warehouse_finder(p_brand_id) then
    raise exception '창고 파인더를 조회할 권한이 없습니다.';
  end if;
  if v_base = '' then
    return;
  end if;

  return query
  with active_set as (
    select inventory_set.id
    from public.warehouse_inventory_sets as inventory_set
    where inventory_set.brand_id = p_brand_id
      and inventory_set.kind = 'sandbox'
      and inventory_set.status = 'active'
    limit 1
  ),
  location_kind_counts as (
    select
      count(distinct app.warehouse_finder_product_kind_key(
        position.normalized_style_no,
        position.source_style_no,
        position.source_product_name
      ))::integer as inbound_count
    from public.warehouse_stock_positions as position
    join active_set
      on active_set.id = position.set_id
    join public.warehouse_locations as location
      on location.id = position.location_id
    where position.brand_id = p_brand_id
      and location.code = v_base
  ),
  matched as (
    select
      position.id as position_id,
      position.set_id,
      position.external_row_id,
      location.code as location_code,
      position.is_final_location,
      location.zone,
      position.style_id,
      position.source_style_no,
      position.normalized_style_no,
      position.source_product_name,
      style.name as official_style_name,
      position.received_on,
      position.received_on_raw,
      position.usage_priority,
      position.quantity_status,
      position.units_per_box,
      position.remaining_boxes,
      position.opened_units,
      position.review_flags,
      position.note,
      position.source_row_number,
      coalesce((select location_kind_counts.inbound_count from location_kind_counts), 0)
        as inbound_count
    from public.warehouse_stock_positions as position
    join active_set
      on active_set.id = position.set_id
    join public.warehouse_locations as location
      on location.id = position.location_id
    left join public.styles as style
      on style.id = position.style_id
     and style.brand_id = position.brand_id
    where position.brand_id = p_brand_id
      and location.code = v_base
  )
  select
    matched.position_id,
    matched.set_id,
    matched.external_row_id,
    matched.location_code,
    matched.is_final_location,
    matched.zone,
    matched.style_id,
    matched.source_style_no,
    matched.normalized_style_no,
    matched.source_product_name,
    matched.official_style_name,
    matched.received_on,
    matched.received_on_raw,
    matched.usage_priority,
    matched.quantity_status,
    matched.units_per_box::numeric,
    matched.remaining_boxes::numeric,
    matched.opened_units,
    matched.review_flags,
    matched.note,
    matched.inbound_count
  from matched
  order by
    matched.received_on desc nulls last,
    matched.received_on_raw desc,
    matched.source_row_number
  limit v_limit;
end;
$$;
