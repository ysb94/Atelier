-- Match the same ECMAScript trim characters and NFC as the room-list grid.
create function app.room_list_product_name_key(p_name text)
returns text
language sql immutable strict parallel safe security invoker
set search_path = ''
as $$
  select normalize(btrim(
    p_name, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
  ), NFC);
$$;

revoke all on function app.room_list_product_name_key(text) from public, anon;
grant execute on function app.room_list_product_name_key(text) to authenticated, service_role;

-- Keep the index key bounded even for long import names. Also compare the full name below.
create index warehouse_stock_positions_room_list_name_idx
  on public.warehouse_stock_positions (brand_id, set_id, md5(app.room_list_product_name_key(source_product_name)));

create function public.list_room_list_stock_positions(
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

  return query
  with names as materialized (
    select distinct app.room_list_product_name_key(n) collate "C" as key
    from unnest(p_names) as requested(n)
    where app.room_list_product_name_key(n) <> ''
  )
  select p.id, p.warehouse_id, l.zone, l.code, p.style_id, p.normalized_style_no,
    p.source_style_no, p.source_product_name, p.received_on, p.received_on_raw,
    p.quantity_status, p.units_per_box, p.remaining_boxes, p.opened_units,
    p.source_row_number, p.created_at
  from public.warehouse_stock_positions p
  join public.warehouse_locations l on l.id = p.location_id
  where p.brand_id = p_brand_id and p.set_id = p_set_id
    and md5(app.room_list_product_name_key(p.source_product_name)) = any(array(select md5(key) from names))
    and (app.room_list_product_name_key(p.source_product_name) collate "C") in (select key from names)
  order by p.source_row_number, p.id
  limit 250 offset p_offset;
end;
$$;

revoke all on function public.list_room_list_stock_positions(uuid, uuid, text[], integer) from public, anon;
grant execute on function public.list_room_list_stock_positions(uuid, uuid, text[], integer) to authenticated;
