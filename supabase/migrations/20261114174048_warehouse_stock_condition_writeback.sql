create table app.warehouse_stock_condition_exports (
  brand_id uuid not null references public.brands (id),
  request_id uuid not null,
  external_row_id text not null,
  before_values jsonb,
  sheet_values jsonb not null,
  restore_values jsonb not null,
  saved_at timestamptz not null default clock_timestamp(),
  sheet_synced_at timestamptz,
  primary key (brand_id, request_id)
);

alter table app.warehouse_stock_condition_exports enable row level security;
revoke all on app.warehouse_stock_condition_exports from public, anon, authenticated;

create unique index warehouse_stock_condition_exports_one_pending
  on app.warehouse_stock_condition_exports (brand_id, external_row_id)
  where sheet_synced_at is null;

create index warehouse_stock_condition_exports_latest
  on app.warehouse_stock_condition_exports (brand_id, external_row_id, saved_at desc);

create function public.save_warehouse_stock_condition(
  p_brand_id uuid,
  p_request_id uuid,
  p_position_id uuid,
  p_condition text,
  p_expected_condition text,
  p_receive jsonb default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_set public.warehouse_inventory_sets;
  v_position public.warehouse_stock_positions;
  v_link public.warehouse_stock_condition_links;
  v_style public.styles;
  v_location public.warehouse_locations;
  v_box public.warehouse_boxes;
  v_external_id text;
  v_condition_label text;
  v_expected jsonb;
  v_values jsonb;
  v_name text;
  v_number text;
  v_restore jsonb;
  v_existing app.warehouse_stock_condition_exports;
begin
  if auth.uid() is null or not coalesce(
    app.can_edit_brand(p_brand_id) or app.basic_work_allowed('logistics', p_brand_id), false
  ) then
    raise exception '창고 재고를 수정할 권한이 없습니다.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.brands where id = p_brand_id and slug = 'masmarulez'
  ) then
    raise exception '창고입력 연동 브랜드에서만 재고 상태를 바꿀 수 있습니다.' using errcode = '22023';
  end if;
  if p_request_id is null or (p_position_id is null) = (p_receive is null) then
    raise exception '변경할 재고 또는 신규 입고 정보를 확인해주세요.' using errcode = '22023';
  end if;

  v_condition_label := case p_condition
    when 'defective' then '불량'
    when 'needs_repair' then '수선 필요'
    when 'under_repair' then '수선 중'
    when 'needs_inspection' then '검수 필요'
    when 'awaiting_inspection' then '검수전'
    when 'sale_hold' then '판매보류'
    when 'production_error' then '오제작'
  end;
  if p_condition is null or (p_condition <> 'normal' and v_condition_label is null) then
    raise exception '재고 상태를 확인해주세요.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('finder-placement/' || p_brand_id::text, 0));

  select * into v_existing from app.warehouse_stock_condition_exports
  where brand_id = p_brand_id and request_id = p_request_id;
  if found then
    return jsonb_build_object('sheetPending', v_existing.sheet_synced_at is null);
  end if;

  select * into strict v_set from public.warehouse_inventory_sets
  where brand_id = p_brand_id and kind = 'sandbox' and status = 'active'
  for update;

  if p_receive is not null then
    select * into strict v_style from public.styles
    where brand_id = p_brand_id and id = (p_receive->>'style_id')::uuid;
    if btrim(v_style.style_no) = '' or btrim(v_style.name) = '' then
      raise exception '정식 상품의 M번호와 상품명을 확인해주세요.';
    end if;
    select * into v_position from jsonb_populate_record(
      null::public.warehouse_stock_positions,
      public.apply_warehouse_stock_action(
        p_brand_id, 'receive', p_receive || jsonb_build_object(
          'style_id', case when p_condition = 'normal' then v_style.id end,
          'source_style_no', case when p_condition = 'normal' then v_style.style_no else '' end,
          'normalized_style_no', case when p_condition = 'normal' then v_style.style_no else '' end,
          'source_product_name', v_style.name
        )
      )
    );
  else
    select * into strict v_position from public.warehouse_stock_positions
    where id = p_position_id and brand_id = p_brand_id and set_id = v_set.id
    for update;

    if v_position.quantity_status <> 'unknown' and
      coalesce(v_position.remaining_boxes, 0) = 0 and v_position.opened_units = 0 then
      raise exception '소진된 재고입니다. 최신 목록을 확인해주세요.';
    end if;
    select * into v_box from public.warehouse_boxes
    where brand_id = p_brand_id and display_code = upper(v_position.box_qr) for update;
    if found and (v_box.completed_at is not null or v_box.archived_at is not null
      or v_box.presumed_depleted_at is not null or v_box.current_qty <= 0) then
      raise exception '출고 또는 소진된 박스입니다. 최신 목록을 확인해주세요.';
    end if;
    select * into v_link from public.warehouse_stock_condition_links
    where brand_id = p_brand_id and external_row_id = v_position.external_row_id
      and source_product_name = v_position.source_product_name;

    if p_condition = coalesce(v_link.condition, 'normal') then
      return jsonb_build_object('sheetPending', exists (
        select 1 from app.warehouse_stock_condition_exports
        where brand_id = p_brand_id and external_row_id = v_position.external_row_id
          and sheet_synced_at is null
      ));
    end if;
    if p_expected_condition is distinct from coalesce(v_link.condition, 'normal') then
      raise exception '다른 작업자가 상태를 바꿨습니다. 새로고침 후 다시 확인해주세요.';
    end if;
    select * into v_style from public.styles
    where brand_id = p_brand_id and id = coalesce(v_link.reference_style_id, v_position.style_id);
    if not found then raise exception '정식 상품이 연결된 재고만 상태를 바꿀 수 있습니다.'; end if;
  end if;

  v_external_id := coalesce(nullif(v_position.external_row_id, ''), 'at_' || replace(p_request_id::text, '-', ''));
  if exists (
    select 1 from app.warehouse_stock_condition_exports
    where brand_id = p_brand_id and external_row_id = v_external_id and sheet_synced_at is null
  ) or exists (
    select 1 from app.finder_warehouse_sheet_exports
    where brand_id = p_brand_id and sheet_row_id = v_external_id and sheet_synced_at is null
  ) then
    raise exception '이 재고의 시트 반영을 기다리고 있습니다. 반영 뒤 다시 변경해주세요.';
  end if;
  if exists (
    select 1 from app.finder_warehouse_placement_operations
    where brand_id = p_brand_id and finished_at is null and cancelled_at is null
      and (plan->'write'->>'docId' = v_external_id or exists (
        select 1 from jsonb_array_elements(coalesce(plan->'clear', '[]'::jsonb)) as cleared(row)
        where cleared.row->'row'->>'external_row_id' = v_external_id
      ))
  ) then
    raise exception 'Finder에서 이 재고를 처리 중입니다. 작업이 끝난 후 다시 변경해주세요.';
  end if;

  select * into strict v_location from public.warehouse_locations where id = v_position.location_id;
  select restore_values into v_restore from app.warehouse_stock_condition_exports
  where brand_id = p_brand_id and external_row_id = v_external_id order by saved_at desc limit 1;
  if p_receive is null and v_link.condition is null then
    v_restore := jsonb_build_object('number', v_position.source_style_no, 'productName', v_position.source_product_name);
  end if;
  v_restore := coalesce(v_restore, jsonb_build_object('number', v_style.style_no, 'productName', v_style.name));
  v_number := case when p_condition = 'normal' then v_restore->>'number' else '' end;
  v_name := case when p_condition = 'normal' then v_restore->>'productName' else v_style.name || '_(' || v_condition_label || ')' end;

  v_values := jsonb_build_object('number', v_number, 'productName', v_name,
    'place', v_location.code || case when v_position.is_final_location then '//' else '' end,
    'receivedOn', v_position.received_on_raw,
    'units', v_position.units_per_box_raw, 'boxes', v_position.remaining_boxes_raw, 'note', v_position.note,
    'boxQr', coalesce(v_position.box_qr, ''));
  if v_position.external_row_id is not null then
    v_expected := jsonb_build_object(
      'number', v_position.source_style_no, 'productName', v_position.source_product_name,
      'place', v_values->>'place', 'boxQr', coalesce(v_position.box_qr, '')
    );
  end if;

  update public.warehouse_stock_positions set
    external_row_id = v_external_id,
    style_id = case when p_condition = 'normal' then v_style.id end,
    source_style_no = v_number,
    normalized_style_no = case when p_condition = 'normal' then upper(regexp_replace(v_style.style_no, '\s+', '', 'g')) else '' end,
    source_product_name = v_name,
    review_flags = array_remove(review_flags, 'missing_style')
  where id = v_position.id;

  if p_condition = 'normal' then
    delete from public.warehouse_stock_condition_links
    where brand_id = p_brand_id and external_row_id = v_external_id;
  else
    insert into public.warehouse_stock_condition_links (brand_id, external_row_id, source_product_name, reference_style_id, condition)
    values (p_brand_id, v_external_id, v_name, v_style.id, p_condition)
    on conflict (brand_id, external_row_id) do update set
      source_product_name = excluded.source_product_name,
      reference_style_id = excluded.reference_style_id,
      condition = excluded.condition;
  end if;

  if p_receive is null then
    insert into public.warehouse_stock_movements (
      brand_id, set_id, action, position_id, style_id, from_location_code, box_count, unit_count, reason, actor_id
    ) values (
      p_brand_id, v_set.id, 'adjust', v_position.id, v_style.id, v_location.code, 0, 0,
      '재고 상태 변경: ' || coalesce(v_condition_label, '정상'), auth.uid()
    );
  end if;

  insert into app.warehouse_stock_condition_exports
    (brand_id, request_id, external_row_id, before_values, sheet_values, restore_values)
  values (p_brand_id, p_request_id, v_external_id, v_expected, v_values, v_restore);
  update public.warehouse_inventory_sets
  set row_count = (select count(*) from public.warehouse_stock_positions where set_id = v_set.id), updated_at = now()
  where id = v_set.id;
  return jsonb_build_object('sheetPending', true);
end;
$$;

-- Both the QR outbound action and the stock replenishment path may be called
-- without going through the warehouse management screen.
create function app.check_warehouse_condition_box_outbound()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.completion_kind = 'box_outbound' and old.completed_at is null and new.completed_at is not null
    and exists (
      select 1 from public.warehouse_inventory_sets s
      join public.warehouse_stock_positions p on p.set_id = s.id and p.brand_id = s.brand_id
      join public.warehouse_stock_condition_links c on c.brand_id = p.brand_id
        and c.external_row_id = p.external_row_id and c.source_product_name = p.source_product_name
      where s.brand_id = new.brand_id and s.kind = 'sandbox' and s.status = 'active'
        and (p.id = new.source_position_id or upper(p.box_qr) = new.display_code)
    ) then
    raise exception '판매 불가 상태의 박스는 출고할 수 없습니다.';
  end if;
  return new;
end;
$$;

revoke all on function app.check_warehouse_condition_box_outbound() from public, anon, authenticated;
create trigger check_warehouse_condition_box_outbound
  before update of completed_at on public.warehouse_boxes
  for each row execute function app.check_warehouse_condition_box_outbound();

revoke all on function public.save_warehouse_stock_condition(uuid,uuid,uuid,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.save_warehouse_stock_condition(uuid,uuid,uuid,text,text,jsonb) to authenticated;

create function public.list_warehouse_stock_condition_exports(p_brand_id uuid)
returns setof jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'requestId', request_id, 'rowId', external_row_id,
    'before', before_values, 'values', sheet_values
  )
  from app.warehouse_stock_condition_exports
  where brand_id = p_brand_id and sheet_synced_at is null
  order by saved_at
  limit 40;
$$;

create function public.confirm_warehouse_stock_condition_exports(p_brand_id uuid, p_confirmed jsonb)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('finder-placement/' || p_brand_id::text, 0));
  update app.warehouse_stock_condition_exports as e set sheet_synced_at = clock_timestamp()
  from jsonb_to_recordset(p_confirmed) as observed(request_id uuid, row_id text, "number" text, product_name text)
  where e.brand_id = p_brand_id and e.sheet_synced_at is null
    and e.request_id = observed.request_id and e.external_row_id = observed.row_id
    and e.sheet_values->>'number' = observed."number" and e.sheet_values->>'productName' = observed.product_name;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.list_warehouse_stock_condition_exports(uuid),
  public.confirm_warehouse_stock_condition_exports(uuid,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.list_warehouse_stock_condition_exports(uuid),
  public.confirm_warehouse_stock_condition_exports(uuid,jsonb) to service_role;

-- Keep the existing Finder snapshot checks as the final step of this entry point.
alter function public.replace_warehouse_inventory_snapshot_with_box_qr(uuid,text,jsonb,timestamptz)
  rename to replace_warehouse_inventory_snapshot_before_conditions;
revoke execute on function public.replace_warehouse_inventory_snapshot_before_conditions(uuid,text,jsonb,timestamptz)
  from public, anon, authenticated, service_role;

create function public.replace_warehouse_inventory_snapshot_with_box_qr(
  p_brand_id uuid, p_source_file_name text, p_rows jsonb, p_snapshot_at timestamptz
)
returns public.warehouse_inventory_sets
language plpgsql security definer set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('finder-placement/' || p_brand_id::text, 0));
  if exists (
    select 1 from app.warehouse_stock_condition_exports
    where brand_id = p_brand_id and sheet_synced_at is null
  ) then
    raise exception '시트에 반영되지 않은 아틀리에 입고 또는 상태 변경이 있습니다.' using errcode = 'PWS04';
  end if;

  if exists (
    select 1 from app.warehouse_stock_condition_exports
    where brand_id = p_brand_id and sheet_synced_at >= p_snapshot_at
  ) then
    raise exception '상태 변경 반영 전의 시트입니다. 시트를 새로 읽고 동기화해주세요.' using errcode = 'PWS05';
  end if;

  if exists (
    with latest as (
      select distinct on (external_row_id) external_row_id, sheet_values
      from app.warehouse_stock_condition_exports
      where brand_id = p_brand_id
      order by external_row_id, saved_at desc
    ), incoming as (
      select * from jsonb_to_recordset(p_rows) as r(external_row_id text, source_style_no text, source_product_name text)
    )
    select 1 from latest
    join public.warehouse_inventory_sets s on s.brand_id = p_brand_id and s.status = 'active' and s.kind = 'sandbox'
    join public.warehouse_stock_positions p on p.set_id = s.id and p.external_row_id = latest.external_row_id
    left join incoming r on r.external_row_id = latest.external_row_id
    left join public.warehouse_boxes b on b.brand_id = p_brand_id and b.display_code = upper(p.box_qr)
    where (p.quantity_status = 'unknown' or p.remaining_boxes > 0 or p.opened_units > 0)
      and (b.id is null or (b.current_qty > 0 and b.completed_at is null and b.archived_at is null and b.presumed_depleted_at is null))
      and (r.external_row_id is null or r.source_style_no is distinct from latest.sheet_values->>'number'
        or r.source_product_name is distinct from latest.sheet_values->>'productName')
  ) then
    raise exception '시트에서 상태를 변경한 재고의 AA 행 또는 B·C 값을 확인하지 못했습니다.' using errcode = 'PWS06';
  end if;

  return public.replace_warehouse_inventory_snapshot_before_conditions(
    p_brand_id, p_source_file_name, p_rows, p_snapshot_at
  );
end;
$$;

revoke all on function public.replace_warehouse_inventory_snapshot_with_box_qr(uuid,text,jsonb,timestamptz)
  from public, anon, authenticated;
grant execute on function public.replace_warehouse_inventory_snapshot_with_box_qr(uuid,text,jsonb,timestamptz)
  to service_role;
