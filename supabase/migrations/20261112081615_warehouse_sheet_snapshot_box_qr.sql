-- The Finder box QR migration adds warehouse_stock_positions.box_qr.
-- Reuse the existing full snapshot transaction and preserve the Finder-derived
-- value when a sheet row has an empty S cell.
create function public.replace_warehouse_inventory_snapshot_with_box_qr(
  p_brand_id uuid,
  p_source_file_name text,
  p_rows jsonb
)
returns public.warehouse_inventory_sets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_set public.warehouse_inventory_sets;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception '사이트 창고 전체 교체는 동기화 서버만 호출할 수 있습니다.'
      using errcode = '42501';
  end if;

  v_set := public.replace_warehouse_inventory_snapshot(p_brand_id, p_source_file_name, p_rows);

  update public.warehouse_stock_positions as position
  set box_qr = btrim(sheet.box_qr)
  from jsonb_to_recordset(p_rows) as sheet(external_row_id text, box_qr text)
  where position.brand_id = p_brand_id
    and position.set_id = v_set.id
    and position.external_row_id = btrim(sheet.external_row_id)
    and nullif(btrim(sheet.box_qr), '') is not null
    and position.box_qr is distinct from btrim(sheet.box_qr);

  return v_set;
end;
$$;

revoke all on function public.replace_warehouse_inventory_snapshot_with_box_qr(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_warehouse_inventory_snapshot_with_box_qr(uuid, text, jsonb)
  to service_role;
