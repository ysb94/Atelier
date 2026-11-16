create function public.correct_warehouse_stock_row(
  p_brand_id uuid, p_request_id uuid, p_position_id uuid, p_expected_updated_at timestamptz, p_changes jsonb
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_old public.warehouse_stock_positions;
  v_new public.warehouse_stock_positions;
  v_location public.warehouse_locations;
  v_link public.warehouse_stock_condition_links;
  v_box public.warehouse_boxes;
  v_style_id uuid;
  v_condition text;
  v_condition_label text;
  v_place text;
  v_zone text;
  v_number text;
  v_name text;
  v_restore jsonb;
  v_before jsonb;
  v_after jsonb;
  v_qty integer;
begin
  if not app.can_review_warehouse_qr_audit(p_brand_id) then
    raise exception '창고 재고를 수정할 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_request_id is null or not exists (select 1 from public.brands where id = p_brand_id and slug = 'masmarulez')
    or jsonb_typeof(p_changes) is distinct from 'object' then
    raise exception '수정할 창고입력 재고를 확인해주세요.' using errcode = '22023';
  end if;
  if p_changes - array['number','productName','place','zone','receivedOn','date','priority','units','boxes','note','condition'] <> '{}'::jsonb then
    raise exception 'QR 번호는 변경할 수 없습니다.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('finder-placement/' || p_brand_id::text, 0));
  if exists (select 1 from app.warehouse_stock_condition_exports where brand_id = p_brand_id and request_id = p_request_id) then
    return jsonb_build_object('saved', true);
  end if;
  select p.* into v_old from public.warehouse_stock_positions p
  join public.warehouse_inventory_sets s on s.id = p.set_id and s.kind = 'sandbox' and s.status = 'active'
  where p.brand_id = p_brand_id and p.id = p_position_id for update of p;
  if not found or v_old.updated_at is distinct from p_expected_updated_at or nullif(v_old.external_row_id, '') is null then
    raise exception '수정 가능한 재고가 바뀌었습니다. 새로고침 후 다시 확인해주세요.' using errcode = '40001';
  end if;
  select * into strict v_location from public.warehouse_locations where id = v_old.location_id;
  perform app.assert_warehouse_qr_audit_sheet_ready(p_brand_id, v_location.code, v_old.box_qr, v_old.external_row_id);
  if exists (select 1 from app.warehouse_stock_condition_exports where brand_id = p_brand_id and external_row_id = v_old.external_row_id and sheet_synced_at is null)
    or exists (select 1 from app.finder_warehouse_sheet_exports where brand_id = p_brand_id and sheet_row_id = v_old.external_row_id and sheet_synced_at is null)
    or exists (select 1 from app.finder_warehouse_placement_operations o
      where o.brand_id = p_brand_id and o.finished_at is null and o.cancelled_at is null and
        (o.plan->'write'->>'docId' = v_old.external_row_id or exists (
          select 1 from jsonb_array_elements(coalesce(o.plan->'clear', '[]'::jsonb)) c
          where c->'row'->>'external_row_id' = v_old.external_row_id))) then
    raise exception '이 재고의 시트 반영이 끝난 뒤 수정해주세요.' using errcode = 'PQA01';
  end if;

  v_before := jsonb_build_object('number', v_old.source_style_no, 'productName', v_old.source_product_name,
    'place', v_location.code || case when v_old.is_final_location then '//' else '' end,
    'receivedOn', v_old.received_on_raw, 'units', v_old.units_per_box_raw,
    'boxes', v_old.remaining_boxes_raw, 'note', v_old.note, 'boxQr', coalesce(v_old.box_qr, ''),
    'openedUnits', v_old.opened_units);
  select * into v_link from public.warehouse_stock_condition_links where brand_id = p_brand_id
    and external_row_id = v_old.external_row_id and source_product_name = v_old.source_product_name;
  select restore_values into v_restore from app.warehouse_stock_condition_exports
    where brand_id = p_brand_id and external_row_id = v_old.external_row_id order by saved_at desc limit 1;
  v_number := btrim(coalesce(p_changes->>'number', case when v_link.condition is not null then v_restore->>'number' end, v_old.source_style_no));
  v_name := btrim(coalesce(p_changes->>'productName', case when v_link.condition is not null then v_restore->>'productName' end, v_old.source_product_name));
  if char_length(v_number) > 80 or char_length(v_name) not between 1 and 300 then
    raise exception 'M번호와 상품명을 확인해주세요.' using errcode = '22023';
  end if;
  v_style_id := coalesce(v_link.reference_style_id, v_old.style_id);
  if p_changes ? 'number' then
    select id into v_style_id from public.styles where brand_id = p_brand_id and upper(style_no) = upper(v_number) and v_number <> '';
    if v_number <> '' and v_style_id is null then raise exception '상품 목록에 있는 M번호를 입력해주세요.' using errcode = '22023'; end if;
  end if;
  v_condition := coalesce(p_changes->>'condition', v_link.condition, 'normal');
  v_condition_label := case v_condition
    when 'defective' then '불량' when 'needs_repair' then '수선 필요' when 'under_repair' then '수선 중'
    when 'needs_inspection' then '검수 필요' when 'awaiting_inspection' then '검수전'
    when 'sale_hold' then '판매보류' when 'production_error' then '오제작'
  end;
  if v_condition <> 'normal' and (v_style_id is null or v_condition_label is null) then
    raise exception '재고 상태를 지정하려면 등록 상품의 M번호가 필요합니다.' using errcode = '22023';
  end if;

  v_after := v_before || (p_changes - array['zone','date','priority','number','productName','condition']) || jsonb_build_object(
    'number', case when v_condition = 'normal' then v_number else '' end,
    'productName', v_name || coalesce('_(' || v_condition_label || ')', '')
  );
  v_place := btrim(regexp_replace(v_after->>'place', '//$', ''));
  v_zone := coalesce(p_changes->>'zone', v_location.zone);
  if v_place = '' or char_length(v_after->>'place') > 80 or v_zone not in ('box_storage','picking')
    or char_length(v_after->>'note') > 500 or char_length(v_after->>'receivedOn') > 40
    or char_length(v_after->>'productName') > 300 then
    raise exception '자리번호·입고일·메모를 확인해주세요.' using errcode = '22023';
  end if;
  v_new := v_old;
  if v_place <> v_location.code or v_zone <> v_location.zone then
    perform app.assert_warehouse_qr_audit_sheet_ready(p_brand_id, v_place);
    if (v_zone = 'box_storage' and v_old.opened_units > 0)
      or exists (select 1 from public.warehouse_registered_slots where warehouse_id = v_old.warehouse_id and code = v_place and zone <> v_zone)
      or exists (select 1 from public.warehouse_stock_positions p join public.warehouse_locations l on l.id = p.location_id
        where p.set_id = v_old.set_id and p.id <> v_old.id and l.code = v_place and l.zone <> v_zone
          and (p.quantity_status = 'unknown' or p.remaining_boxes > 0 or p.opened_units > 0)) then
      raise exception '입고 위치의 창고 구역과 개봉 재고를 확인해주세요.' using errcode = '22023';
    end if;
    insert into public.warehouse_locations(company_id,warehouse_id,code,zone)
    values (v_location.company_id,v_old.warehouse_id,v_place,v_zone)
    on conflict (warehouse_id,zone,code) do update set code = excluded.code returning id into v_new.location_id;
    perform public.touch_warehouse_registered_slot(v_old.warehouse_id, v_place, v_zone);
  end if;
  if (p_changes ? 'units' and coalesce(p_changes->>'units','') !~ '^([1-9][0-9]{0,5})?$')
    or (p_changes ? 'boxes' and coalesce(p_changes->>'boxes','') !~ '^([0-9]{1,5})?$') then
    raise exception '박스당 수량과 박스 수를 확인해주세요.' using errcode = '22023';
  end if;
  if p_changes ? 'units' then v_new.units_per_box := nullif(p_changes->>'units','')::integer; end if;
  if p_changes ? 'boxes' then v_new.remaining_boxes := nullif(p_changes->>'boxes','')::integer; end if;
  select * into v_box from public.warehouse_boxes where brand_id = p_brand_id and display_code = upper(v_old.box_qr) for update;
  if found then
    if v_style_id is null or v_new.units_per_box is null or v_new.remaining_boxes is null or v_new.remaining_boxes > 1 or
      v_box.completed_at is not null or v_box.archived_at is not null or v_box.presumed_depleted_at is not null then
      raise exception '연결된 QR 박스의 상품·수량 또는 완료 상태를 확인해주세요.' using errcode = '22023';
    end if;
    v_qty := case when p_changes ?| array['units','boxes'] then v_new.units_per_box * v_new.remaining_boxes + v_old.opened_units
      else v_box.current_qty end;
    if v_qty < 1 then raise exception '수량이 0이면 기존 소진 기능을 이용해주세요.' using errcode = '22023'; end if;
  end if;
  if v_after = v_before and v_new.location_id = v_old.location_id and v_condition = coalesce(v_link.condition,'normal') then
    return jsonb_build_object('saved', true);
  end if;

  if v_old.box_qr is not null then
    insert into app.warehouse_qr_audit_writes values (p_brand_id, pg_current_xact_id());
  end if;
  update public.warehouse_stock_positions set
    location_id = v_new.location_id, is_final_location = right(v_after->>'place',2) = '//',
    style_id = case when v_condition = 'normal' then v_style_id end,
    source_style_no = v_after->>'number',
    normalized_style_no = case when p_changes ? 'number' or v_condition <> coalesce(v_link.condition,'normal')
      then upper(regexp_replace(v_after->>'number','\s+','','g')) else v_old.normalized_style_no end,
    source_product_name = v_after->>'productName', received_on_raw = v_after->>'receivedOn',
    received_on = case when p_changes ? 'receivedOn' then (p_changes->>'date')::date else v_old.received_on end,
    usage_priority = coalesce(p_changes->>'priority', v_old.usage_priority),
    is_forced_priority = case when p_changes ? 'receivedOn' then p_changes->>'priority' = 'first' else v_old.is_forced_priority end,
    units_per_box = v_new.units_per_box, remaining_boxes = v_new.remaining_boxes,
    units_per_box_raw = v_after->>'units', remaining_boxes_raw = v_after->>'boxes',
    quantity_status = case when v_new.units_per_box is null or v_new.remaining_boxes is null then 'unknown' else 'known' end,
    note = v_after->>'note',
    review_flags = array_remove(array_remove(
      case when p_changes ? 'receivedOn' then array_remove(v_old.review_flags,'date_review') else v_old.review_flags end,
      'missing_style'),'quantity_unknown')
      || case when v_style_id is null then array['missing_style'] else '{}'::text[] end
      || case when v_new.units_per_box is null or v_new.remaining_boxes is null then array['quantity_unknown'] else '{}'::text[] end
  where id = v_old.id returning * into v_new;
  if v_new.box_qr is distinct from v_old.box_qr then
    raise exception 'QR 번호를 보존하지 못했습니다. 최신 재고를 확인해주세요.' using errcode = '22023';
  end if;
  if v_condition = 'normal' then
    delete from public.warehouse_stock_condition_links where brand_id = p_brand_id and external_row_id = v_old.external_row_id;
  else
    insert into public.warehouse_stock_condition_links (brand_id,external_row_id,source_product_name,reference_style_id,condition)
    values (p_brand_id,v_old.external_row_id,v_new.source_product_name,v_style_id,v_condition)
    on conflict (brand_id,external_row_id) do update set source_product_name = excluded.source_product_name,
      reference_style_id = excluded.reference_style_id, condition = excluded.condition;
  end if;
  if v_box.id is not null then
    update public.warehouse_boxes set style_id = v_style_id, location_id = v_new.location_id,
      received_on = case when p_changes ? 'receivedOn' then v_new.received_on else received_on end,
      usage_priority = case when p_changes ? 'receivedOn' then v_new.usage_priority else usage_priority end,
      note = case when p_changes ? 'note' then v_new.note else note end,
      current_qty = v_qty,
      initial_qty = case when p_changes ?| array['units','boxes'] then greatest(v_new.units_per_box,v_qty) else initial_qty end
    where id = v_box.id;
  end if;
  if v_old.box_qr is not null then
    delete from app.warehouse_qr_audit_writes where brand_id = p_brand_id and transaction_id = pg_current_xact_id();
  end if;
  insert into public.warehouse_stock_movements (brand_id,set_id,action,position_id,style_id,from_location_code,to_location_code,
    box_count,unit_count,reason,actor_id)
  values (p_brand_id,v_old.set_id,'adjust',v_old.id,v_new.style_id,v_location.code,v_place,
    coalesce(v_new.remaining_boxes,0),coalesce(v_qty,least(2147483647,
      coalesce(v_new.units_per_box::bigint * v_new.remaining_boxes,0) + v_new.opened_units)::integer),'입고 행 정정',auth.uid());
  insert into app.warehouse_stock_condition_exports (brand_id,request_id,external_row_id,before_values,sheet_values,restore_values)
  values (p_brand_id,p_request_id,v_old.external_row_id,v_before,v_after,jsonb_build_object('number',v_number,'productName',v_name));
  update public.warehouse_inventory_sets set updated_at = clock_timestamp() where id = v_old.set_id;
  return jsonb_build_object('saved', true);
end;
$$;

revoke all on function public.correct_warehouse_stock_row(uuid,uuid,uuid,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.correct_warehouse_stock_row(uuid,uuid,uuid,timestamptz,jsonb) to authenticated;
