create or replace function public.save_warehouse_stock_condition(
  p_brand_id uuid,
  p_request_id uuid,
  p_position_id uuid,
  p_condition text,
  p_expected_condition text,
  p_receive jsonb default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_place text;
  v_zone text;
  v_name text;
  v_row_id text;
  v_set public.warehouse_inventory_sets;
  v_position public.warehouse_stock_positions;
  v_existing app.warehouse_stock_condition_exports;
begin
  if not app.can_review_warehouse_qr_audit(p_brand_id) then
    raise exception '창고 재고를 수정할 권한이 없습니다.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('finder-placement/' || p_brand_id::text, 0));

  if p_position_id is not null or p_receive is null then
    select * into v_position from public.warehouse_stock_positions
    where id = p_position_id and brand_id = p_brand_id;
    select code into v_place from public.warehouse_locations where id = v_position.location_id;
    perform app.assert_warehouse_qr_audit_sheet_ready(
      p_brand_id, coalesce(v_place, p_receive->>'location_code'), v_position.box_qr, v_position.external_row_id
    );
    return public.save_warehouse_stock_condition_before_qr_audit(
      p_brand_id, p_request_id, p_position_id, p_condition, p_expected_condition, p_receive
    );
  end if;

  if not exists (select 1 from public.brands where id = p_brand_id and slug = 'masmarulez') then
    raise exception '창고입력 연동 브랜드에서만 입고할 수 있습니다.' using errcode = '22023';
  end if;
  if p_request_id is null then
    raise exception '신규 입고 요청을 확인해주세요.' using errcode = '22023';
  end if;
  select * into v_existing from app.warehouse_stock_condition_exports
  where brand_id = p_brand_id and request_id = p_request_id;
  if found then
    return jsonb_build_object('sheetPending', v_existing.sheet_synced_at is null);
  end if;

  v_place := btrim(coalesce(p_receive->>'location_code', ''));
  v_zone := coalesce(nullif(btrim(p_receive->>'zone'), ''), 'box_storage');
  if v_place = '' or v_zone not in ('box_storage', 'picking') or
    char_length(v_place) + (case when p_receive->>'is_final_location' = 'true' then 2 else 0 end) > 80 then
    raise exception '입고할 창고와 자리번호를 확인해주세요.' using errcode = '22023';
  end if;
  perform app.assert_warehouse_qr_audit_sheet_ready(p_brand_id, v_place);

  select * into v_set from public.warehouse_inventory_sets
  where brand_id = p_brand_id and kind = 'sandbox' and status = 'active'
  for update;
  if not found then
    raise exception '입고할 활성 창고 재고가 없습니다.';
  end if;
  -- The sheet infers the zone from the registered place. Do not reclassify existing stock during intake.
  if exists (
    select 1 from public.warehouse_registered_slots
    where warehouse_id = v_set.warehouse_id and code = v_place and zone <> v_zone
  ) or exists (
    select 1 from public.warehouse_stock_positions p
    join public.warehouse_locations l on l.id = p.location_id
    where p.set_id = v_set.id and l.code = v_place and l.zone <> v_zone
      and (p.quantity_status = 'unknown' or p.remaining_boxes > 0 or p.opened_units > 0)
  ) then
    raise exception '다른 구역에 있는 자리입니다. 해당 창고 탭에서 입고해주세요.' using errcode = '22023';
  end if;
  p_receive := p_receive || jsonb_build_object('location_code', v_place, 'zone', v_zone);

  if nullif(p_receive->>'style_id', '') is not null then
    return public.save_warehouse_stock_condition_before_qr_audit(
      p_brand_id, p_request_id, null, p_condition, p_expected_condition, p_receive
    );
  end if;

  v_name := btrim(coalesce(p_receive->>'source_product_name', ''), E' \t\n\r');
  if jsonb_typeof(p_receive->'source_product_name') is distinct from 'string' or
    char_length(v_name) not between 1 and 300 then
    raise exception '상품명을 1~300자로 입력해주세요.' using errcode = '22023';
  end if;
  if p_condition is distinct from 'normal' then
    raise exception '재고 상태를 지정하려면 등록 상품을 선택해주세요.' using errcode = '22023';
  end if;

  select * into v_position from jsonb_populate_record(
    null::public.warehouse_stock_positions,
    public.apply_warehouse_stock_action(p_brand_id, 'receive', p_receive || jsonb_build_object(
      'style_id', null, 'source_style_no', '', 'normalized_style_no', '', 'source_product_name', v_name
    ))
  );
  v_row_id := 'at_manual_' || replace(p_request_id::text, '-', '');
  update public.warehouse_stock_positions set external_row_id = v_row_id where id = v_position.id;

  insert into app.warehouse_stock_condition_exports
    (brand_id, request_id, external_row_id, before_values, sheet_values, restore_values)
  values (p_brand_id, p_request_id, v_row_id, null,
    jsonb_build_object(
      'number', '', 'productName', v_name,
      'place', v_place || case when v_position.is_final_location then '//' else '' end,
      'receivedOn', v_position.received_on_raw, 'units', v_position.units_per_box_raw,
      'boxes', v_position.remaining_boxes_raw, 'note', v_position.note, 'boxQr', ''
    ),
    jsonb_build_object('number', '', 'productName', v_name)
  );
  update public.warehouse_inventory_sets
  set row_count = (select count(*) from public.warehouse_stock_positions where set_id = v_set.id), updated_at = now()
  where id = v_set.id;
  return jsonb_build_object('sheetPending', true);
end;
$$;
