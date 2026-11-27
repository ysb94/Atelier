-- Canonical spellings already have the Finder (brand_id, set_id, source_product_name) index.
-- This partial index covers imports whose raw spelling differs from the room-list key.
-- A live warehouse can prebuild this same index concurrently before switching the RPC.
create index if not exists warehouse_stock_positions_room_list_variant_idx
  on public.warehouse_stock_positions (brand_id, set_id)
  where source_product_name collate "C" <> app.room_list_product_name_key(source_product_name) collate "C";

create or replace function public.list_room_list_stock_positions(
  p_brand_id uuid,
  p_set_id uuid,
  p_names text[],
  p_offset integer default 0
)
returns table (
  id uuid, warehouse_id uuid, zone text, location_code text,
  style_id uuid, normalized_style_no text, source_style_no text, source_product_name text,
  received_on date, received_on_raw text, quantity_status text,
  units_per_box integer, remaining_boxes integer, opened_units integer,
  source_row_number integer, created_at timestamptz
)
language plpgsql stable security invoker
set search_path = ''
as $$
declare
  normalized_names text[];
begin
  if not coalesce(app.can_read_brand(p_brand_id), false) then
    raise exception 'Warehouse brand is not visible' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_names), 0) > 100 or p_offset is null or p_offset < 0 then
    raise exception 'Invalid room list lookup batch' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_names), 0) = 0 then
    return;
  end if;
  if not exists (
    select 1 from public.warehouse_inventory_sets s
    where s.brand_id = p_brand_id and s.id = p_set_id
      and s.kind = 'sandbox' and s.status = 'active'
  ) then
    raise exception 'Warehouse inventory set is no longer active' using errcode = 'P0002';
  end if;

  select array(
    select distinct app.room_list_product_name_key(n) collate "C"
    from unnest(p_names) as requested(n)
    where app.room_list_product_name_key(n) <> ''
  ) into normalized_names;

  -- The two branches are disjoint: every requested name is already canonical.
  return query
  with matched as (
    select raw.*
    from public.warehouse_stock_positions raw
    where raw.brand_id = p_brand_id and raw.set_id = p_set_id
      and raw.source_product_name = any(normalized_names)
    union all
    select variant.*
    from public.warehouse_stock_positions variant
    where variant.brand_id = p_brand_id and variant.set_id = p_set_id
      and variant.source_product_name collate "C" <> app.room_list_product_name_key(variant.source_product_name) collate "C"
      and (app.room_list_product_name_key(variant.source_product_name) collate "C") = any(normalized_names)
  )
  select p.id, p.warehouse_id, l.zone, l.code, p.style_id, p.normalized_style_no,
    p.source_style_no, p.source_product_name, p.received_on, p.received_on_raw,
    p.quantity_status, p.units_per_box, p.remaining_boxes, p.opened_units,
    p.source_row_number, p.created_at
  from matched p
  join public.warehouse_locations l on l.id = p.location_id
  order by p.source_row_number, p.id
  limit 250 offset p_offset;
end;
$$;
