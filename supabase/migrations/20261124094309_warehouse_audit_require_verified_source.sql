-- Keep the audit transaction, original snapshots, scoped photo checks and replay
-- result intact. No previously confirmed audit or warehouse row is rewritten.
do $migration$
declare
  body text := pg_get_functiondef('app.finder_warehouse_qr_audit_db(uuid,text,jsonb)'::regprocedure);
  source_check text := $anchor$if not found then raise exception '선택한 상품이 해당 자리의 QR과 맞지 않습니다.'; end if;$anchor$;
  photo_check text := $anchor$if v_entry.source_id is null then$anchor$;
  place_response text := $anchor$return jsonb_build_object('place', v_slot.code, 'baseline', v_baseline, 'rows', v_before);$anchor$;
  entry_fields text := 'as r(qr text, source_id uuid, photo_path text, units integer, opened boolean)';
  after_upload text := $anchor$raise exception '상품을 확인하지 못한 박스는 사진을 올려주세요.';
      end if;$anchor$;
begin
  if length(body) - length(replace(body, source_check, '')) <> length(source_check)
     or length(body) - length(replace(body, photo_check, '')) <> length(photo_check)
     or length(body) - length(replace(body, place_response, '')) <> length(place_response)
     or length(body) - length(replace(body, entry_fields, '')) <> length(entry_fields)
     or length(body) - length(replace(body, after_upload, '')) <> length(after_upload) then
    raise exception 'Unexpected finder_warehouse_qr_audit_db definition';
  end if;
  body := replace(body, source_check, source_check || $guard$
      if (v_source.style_id is null and not exists (
        select 1 from public.warehouse_stock_condition_links c
        where c.brand_id = p_brand_id and c.external_row_id = v_source.external_row_id
          and c.source_product_name = v_source.source_product_name and c.reference_style_id is not null
      )) or v_source.quantity_status = 'unknown'
        or (v_source.units_per_box between 1 and 1000000) is not true
        or v_entry.units is null then
        raise exception '상품이나 수량을 확인할 수 없습니다. 박스 QR을 스캔하고 검수 사진을 남겨주세요.' using errcode = '22023';
      end if;$guard$);
  -- Condition stock uses a separate reference SKU. Return this existing link
  -- on lookup without changing the baseline hash or the historical snapshots.
  body := replace(body, place_response, $response$
    select coalesce(jsonb_agg(
      case when c.reference_style_id is null then r.item
           else r.item || jsonb_build_object('condition_style_id', c.reference_style_id) end
      order by r.ordinal), '[]'::jsonb) into v_result
    from jsonb_array_elements(v_before) with ordinality as r(item, ordinal)
    left join public.warehouse_stock_condition_links c on c.brand_id = p_brand_id
      and c.external_row_id = r.item->>'external_row_id' and c.source_product_name = r.item->>'source_product_name';
    return jsonb_build_object('place', v_slot.code, 'baseline', v_baseline, 'rows', v_result);$response$);
  body := replace(body, photo_check, photo_check || $guard$
      if v_entry.units is not null or coalesce(v_entry.opened, false) then
        raise exception '검수할 박스의 상품과 수량은 아틀리에에서 확인해주세요.' using errcode = '22023';
      end if;$guard$);
  body := replace(body, entry_fields, 'as r(qr text, source_id uuid, photo_path text, units integer, opened boolean, review_source_id uuid)');
  body := replace(body, after_upload, after_upload || $preserve$
      if v_entry.review_source_id is not null then
        select p.* into v_source from jsonb_populate_recordset(null::public.warehouse_stock_positions, v_before) p
        where p.id = v_entry.review_source_id and upper(p.box_qr) = v_entry.qr;
        if not found then raise exception '기존 박스 QR과 검수 사진이 맞지 않습니다.' using errcode = '22023'; end if;
        -- Preserve a known count on its original, individually identified box
        -- when only the product is unresolved. Never infer units from nearby boxes.
        if v_source.style_id is null and v_source.quantity_status = 'known'
          and v_source.units_per_box between 1 and 1000000
          and coalesce(v_source.opened_units, 0) between 0 and v_source.units_per_box
          and not exists (
            select 1 from public.warehouse_stock_condition_links c where c.brand_id = p_brand_id
              and c.external_row_id = v_source.external_row_id and c.source_product_name = v_source.source_product_name
              and c.reference_style_id is not null
          ) then
          v_entry.opened := coalesce(v_source.opened_units, 0) > 0;
          v_entry.units := coalesce(nullif(v_source.opened_units, 0), v_source.units_per_box);
        end if;
      end if;$preserve$);
  execute body;
end;
$migration$;
