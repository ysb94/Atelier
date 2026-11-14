-- Apply after the Finder migration that creates this contract.
do $$
begin
  perform brand_id, sheet_synced_at from app.finder_warehouse_sheet_exports limit 0;
end;
$$;

create or replace function public.replace_warehouse_inventory_snapshot_with_box_qr(
  p_brand_id uuid, p_source_file_name text, p_rows jsonb, p_snapshot_at timestamptz
)
returns public.warehouse_inventory_sets
language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception '동기화 서버만 실행할 수 있습니다.' using errcode = '42501';
  end if;
  if p_snapshot_at is null or not isfinite(p_snapshot_at) then
    raise exception '시트 조회 시작 시각이 필요합니다. 시트를 새로 읽고 동기화해주세요.' using errcode = '22023';
  end if;

  -- Finder's DB-first intake holds this same lock through stock and export insertion.
  perform pg_advisory_xact_lock(hashtextextended('finder-placement/' || p_brand_id::text, 0));
  if exists (
    select 1 from app.finder_warehouse_sheet_exports
    where brand_id = p_brand_id and sheet_synced_at is null
  ) then
    raise exception '시트에 아직 반영되지 않은 Finder 입고가 있습니다. 반영 후 시트를 새로 읽고 동기화해주세요.'
      using errcode = 'PWS01';
  end if;
  if exists (
    select 1 from app.finder_warehouse_sheet_exports
    where brand_id = p_brand_id and sheet_synced_at >= p_snapshot_at
  ) then
    raise exception 'Finder 입고가 시트에 반영되기 전에 읽은 데이터입니다. 시트를 새로 읽고 동기화해주세요.'
      using errcode = 'PWS02';
  end if;

  if exists (
    select 1 from app.finder_warehouse_placement_operations
    where brand_id = p_brand_id and cancelled_at is null and (finished_at is null or finished_at >= p_snapshot_at)
  ) or exists (
    select 1 from public.cargo_inbound_receipts
    where brand_id = p_brand_id and receiving_mode = 'location_only' and received_at >= p_snapshot_at
  ) then
    raise exception 'Finder에서 창고 재고가 변경되었습니다. 시트에서 전체 동기화를 다시 실행해주세요.';
  end if;

  if exists (
    select 1
    from public.warehouse_inventory_sets as inventory
    join public.warehouse_stock_positions as position on position.set_id = inventory.id
      and position.brand_id = inventory.brand_id
    join app.finder_warehouse_sheet_exports as export on export.brand_id = position.brand_id
      and export.sheet_row_id = position.external_row_id
    left join public.warehouse_boxes as box on box.brand_id = export.brand_id
      and box.display_code = upper(export.payload->>'boxQr')
    where inventory.brand_id = p_brand_id and inventory.kind = 'sandbox' and inventory.status = 'active'
      and export.sheet_synced_at is not null
      and (position.quantity_status = 'unknown' or position.remaining_boxes > 0 or position.opened_units > 0)
      and box.completed_at is null and box.archived_at is null and box.presumed_depleted_at is null
      and (box.id is null or box.current_qty > 0)
      and not exists (
        select 1 from jsonb_to_recordset(p_rows) as incoming(external_row_id text)
        where btrim(incoming.external_row_id) = export.sheet_row_id
      )
  ) then
    raise exception '시트에서 아직 재고가 남은 Finder 입고의 AA 행을 찾지 못했습니다. 창고입력의 AA 열과 동기화 범위를 확인해주세요.'
      using errcode = 'PWS03';
  end if;
  return public.replace_warehouse_inventory_snapshot_with_box_qr(p_brand_id, p_source_file_name, p_rows);
end;
$$;

-- Both legacy writers are internal steps of the protected SECURITY DEFINER entry point.
revoke execute on function public.replace_warehouse_inventory_snapshot_with_box_qr(uuid, text, jsonb)
  from service_role;
revoke execute on function public.replace_warehouse_inventory_snapshot(uuid, text, jsonb)
  from service_role;
