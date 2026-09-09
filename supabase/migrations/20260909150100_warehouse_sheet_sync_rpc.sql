-- 수량 미확인 가드와 Apps Script 전용 전체 교체 RPC.

create or replace function public.apply_warehouse_stock_action(
  p_brand_id uuid,
  p_action text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_set public.warehouse_inventory_sets;
  v_company_id uuid;
  v_position public.warehouse_stock_positions;
  v_target public.warehouse_stock_positions;
  v_location public.warehouse_locations;
  v_to_location_id uuid;
  v_to_code text;
  v_to_zone text;
  v_box_count integer;
  v_remaining integer;
  v_opened integer;
  v_units integer;
begin
  if not app.can_edit_brand(p_brand_id) then
    raise exception '창고 연습 데이터를 수정할 권한이 없습니다.';
  end if;
  if p_action not in ('receive', 'move', 'deplete', 'adjust', 'replenish', 'open') then
    raise exception '지원하지 않는 창고 작업입니다.';
  end if;

  select *
    into v_set
  from public.warehouse_inventory_sets
  where brand_id = p_brand_id
    and kind = 'sandbox'
    and status = 'active'
  limit 1;
  if v_set.id is null then
    raise exception '활성 연습 데이터가 없습니다. 엑셀을 먼저 가져오세요.';
  end if;

  select brand.company_id
    into v_company_id
  from public.brands as brand
  where brand.id = p_brand_id;

  if p_action = 'receive' then
    v_to_code := btrim(p_payload ->> 'location_code');
    v_to_zone := coalesce(nullif(btrim(p_payload ->> 'zone'), ''), 'box_storage');
    v_box_count := (p_payload ->> 'remaining_boxes')::integer;
    v_units := (p_payload ->> 'units_per_box')::integer;
    if v_to_code = '' or v_box_count is null or v_box_count < 1 or v_units is null or v_units < 1 then
      raise exception '자리번호·입수·박스 수를 확인하세요.';
    end if;

    insert into public.warehouse_locations (company_id, warehouse_id, code, zone)
    values (v_company_id, v_set.warehouse_id, v_to_code, v_to_zone)
    on conflict (warehouse_id, zone, code) do update
      set code = excluded.code
    returning id into v_to_location_id;

    perform public.touch_warehouse_registered_slot(
      v_set.warehouse_id,
      v_to_code,
      v_to_zone
    );

    insert into public.warehouse_stock_positions (
      brand_id,
      set_id,
      warehouse_id,
      location_id,
      style_id,
      source_style_no,
      normalized_style_no,
      source_product_name,
      received_on,
      received_on_raw,
      is_forced_priority,
      is_final_location,
      usage_priority,
      quantity_status,
      units_per_box,
      remaining_boxes,
      units_per_box_raw,
      remaining_boxes_raw,
      review_flags,
      source_row_number,
      note
    )
    values (
      p_brand_id,
      v_set.id,
      v_set.warehouse_id,
      v_to_location_id,
      nullif(p_payload ->> 'style_id', '')::uuid,
      coalesce(p_payload ->> 'source_style_no', ''),
      coalesce(p_payload ->> 'normalized_style_no', p_payload ->> 'source_style_no'),
      coalesce(p_payload ->> 'source_product_name', ''),
      nullif(p_payload ->> 'received_on', '')::date,
      coalesce(p_payload ->> 'received_on_raw', p_payload ->> 'received_on', ''),
      coalesce((p_payload ->> 'is_forced_priority')::boolean, false),
      coalesce((p_payload ->> 'is_final_location')::boolean, false),
      coalesce(
        nullif(p_payload ->> 'usage_priority', ''),
        case
          when coalesce((p_payload ->> 'is_forced_priority')::boolean, false) then 'first'
          when coalesce(p_payload ->> 'received_on_raw', '') = '000001' then 'second'
          when coalesce(p_payload ->> 'received_on_raw', '') = '999999' then 'last'
          else 'fifo'
        end
      ),
      'known',
      v_units,
      v_box_count,
      v_units::text,
      v_box_count::text,
      case
        when nullif(p_payload ->> 'style_id', '') is null then array['missing_style']::text[]
        else '{}'::text[]
      end,
      900000 + (extract(epoch from now())::integer % 100000),
      coalesce(p_payload ->> 'note', '')
    )
    returning * into v_position;

    insert into public.warehouse_stock_movements (
      brand_id, set_id, action, position_id, style_id,
      to_location_code, box_count, unit_count, reason, actor_id
    )
    values (
      p_brand_id, v_set.id, 'receive', v_position.id, v_position.style_id,
      v_to_code, v_box_count, v_box_count * v_units,
      coalesce(p_payload ->> 'reason', '신규 입고'),
      auth.uid()
    );

    return to_jsonb(v_position);
  end if;

  select *
    into v_position
  from public.warehouse_stock_positions
  where brand_id = p_brand_id
    and set_id = v_set.id
    and id = (p_payload ->> 'position_id')::uuid;
  if v_position.id is null then
    raise exception '창고 자리를 찾지 못했습니다.';
  end if;

  select *
    into v_location
  from public.warehouse_locations
  where id = v_position.location_id;

  if p_action = 'adjust' then
    v_remaining := (p_payload ->> 'remaining_boxes')::integer;
    v_opened := coalesce((p_payload ->> 'opened_units')::integer, v_position.opened_units);
    v_units := coalesce((p_payload ->> 'units_per_box')::integer, v_position.units_per_box);
    if v_remaining is null or v_remaining < 0 or v_opened < 0 or v_units is null or v_units < 1 then
      raise exception '입수와 잔여 수량을 확인하세요.';
    end if;
    update public.warehouse_stock_positions
    set remaining_boxes = v_remaining,
        opened_units = v_opened,
        units_per_box = v_units,
        quantity_status = 'known',
        units_per_box_raw = v_units::text,
        remaining_boxes_raw = v_remaining::text
    where id = v_position.id
    returning * into v_position;

    insert into public.warehouse_stock_movements (
      brand_id, set_id, action, position_id, style_id,
      from_location_code, box_count, unit_count, reason, actor_id
    )
    values (
      p_brand_id, v_set.id, 'adjust', v_position.id, v_position.style_id,
      v_location.code, v_remaining, v_opened,
      coalesce(p_payload ->> 'reason', '실사 수정'),
      auth.uid()
    );
    return to_jsonb(v_position);
  end if;

  if v_position.quantity_status = 'unknown'
    or v_position.units_per_box is null
    or v_position.remaining_boxes is null then
    raise exception '수량 미확인 행은 수량 작업을 할 수 없습니다.';
  end if;

  if p_action = 'deplete' then
    v_box_count := v_position.remaining_boxes;
    v_opened := v_position.opened_units;
    update public.warehouse_stock_positions
    set remaining_boxes = 0,
        opened_units = 0,
        remaining_boxes_raw = '0'
    where id = v_position.id
    returning * into v_position;

    insert into public.warehouse_stock_movements (
      brand_id, set_id, action, position_id, style_id,
      from_location_code, box_count, unit_count, reason, actor_id
    )
    values (
      p_brand_id, v_set.id, 'deplete', v_position.id, v_position.style_id,
      v_location.code, v_box_count, v_opened,
      coalesce(p_payload ->> 'reason', '자리 소진'),
      auth.uid()
    );
    return to_jsonb(v_position);
  end if;

  if p_action = 'open' then
    if v_location.zone <> 'picking' then
      raise exception '개봉은 출고창고에서만 할 수 있습니다. 먼저 박스를 충원하세요.';
    end if;
    v_box_count := (p_payload ->> 'box_count')::integer;
    if v_box_count is null or v_box_count < 1 then
      raise exception '개봉할 박스 수를 입력하세요.';
    end if;
    if v_box_count > v_position.remaining_boxes then
      raise exception '남은 박스보다 많이 개봉할 수 없습니다.';
    end if;
    update public.warehouse_stock_positions
    set remaining_boxes = remaining_boxes - v_box_count,
        opened_units = opened_units + v_box_count * units_per_box,
        remaining_boxes_raw = (remaining_boxes - v_box_count)::text
    where id = v_position.id
    returning * into v_position;

    insert into public.warehouse_stock_movements (
      brand_id, set_id, action, position_id, style_id,
      from_location_code, to_location_code, box_count, unit_count, reason, actor_id
    )
    values (
      p_brand_id, v_set.id, 'open', v_position.id, v_position.style_id,
      v_location.code, v_location.code, v_box_count,
      v_box_count * v_position.units_per_box,
      coalesce(p_payload ->> 'reason', '박스 개봉'),
      auth.uid()
    );
    return to_jsonb(v_position);
  end if;

  v_to_code := btrim(coalesce(p_payload ->> 'to_location_code', ''));
  v_to_zone := coalesce(
    nullif(btrim(p_payload ->> 'to_zone'), ''),
    case when p_action = 'replenish' then 'picking' else v_location.zone end
  );
  v_box_count := coalesce(
    (p_payload ->> 'box_count')::integer,
    v_position.remaining_boxes
  );
  if v_to_code = '' then
    raise exception '옮길 자리번호를 입력하세요.';
  end if;
  if v_box_count < 1 then
    raise exception '옮길 박스 수는 1 이상이어야 합니다.';
  end if;
  if v_box_count > v_position.remaining_boxes then
    raise exception '남은 박스보다 많이 옮길 수 없습니다.';
  end if;
  if p_action = 'move' and v_location.zone = 'box_storage' and v_to_zone <> 'box_storage' then
    raise exception '박스창고에서는 박스 단위 자리 이동만 할 수 있습니다. 출고 충원은 충원 작업을 쓰세요.';
  end if;

  insert into public.warehouse_locations (company_id, warehouse_id, code, zone)
  values (v_company_id, v_set.warehouse_id, v_to_code, v_to_zone)
  on conflict (warehouse_id, zone, code) do update
    set code = excluded.code
  returning id into v_to_location_id;

  perform public.touch_warehouse_registered_slot(
    v_set.warehouse_id,
    v_to_code,
    v_to_zone
  );

  if v_box_count = v_position.remaining_boxes then
    update public.warehouse_stock_positions
    set location_id = v_to_location_id
    where id = v_position.id
    returning * into v_position;
  else
    update public.warehouse_stock_positions
    set remaining_boxes = remaining_boxes - v_box_count,
        remaining_boxes_raw = (remaining_boxes - v_box_count)::text
    where id = v_position.id
    returning * into v_position;

    insert into public.warehouse_stock_positions (
      brand_id, set_id, warehouse_id, location_id, style_id,
      source_style_no, normalized_style_no, source_product_name,
      received_on, received_on_raw, is_forced_priority, is_final_location,
      usage_priority, quantity_status, units_per_box, remaining_boxes,
      units_per_box_raw, remaining_boxes_raw, review_flags, source_row_number, note
    )
    values (
      v_position.brand_id, v_position.set_id, v_position.warehouse_id, v_to_location_id,
      v_position.style_id, v_position.source_style_no, v_position.normalized_style_no,
      v_position.source_product_name, v_position.received_on, v_position.received_on_raw,
      v_position.is_forced_priority, v_position.is_final_location,
      v_position.usage_priority, v_position.quantity_status,
      v_position.units_per_box, v_box_count,
      v_position.units_per_box_raw, v_box_count::text,
      v_position.review_flags, v_position.source_row_number, v_position.note
    )
    returning * into v_target;
  end if;

  insert into public.warehouse_stock_movements (
    brand_id, set_id, action, position_id, style_id,
    from_location_code, to_location_code, box_count, unit_count, reason, actor_id
  )
  values (
    p_brand_id, v_set.id, p_action, coalesce(v_target.id, v_position.id),
    v_position.style_id, v_location.code, v_to_code, v_box_count,
    v_box_count * v_position.units_per_box,
    coalesce(
      p_payload ->> 'reason',
      case when p_action = 'replenish' then '출고창고 박스 충원' else '자리 이동' end
    ),
    auth.uid()
  );

  return jsonb_build_object(
    'source', to_jsonb(v_position),
    'moved', to_jsonb(v_target)
  );
end;
$$;

comment on function public.apply_warehouse_stock_action(uuid, text, jsonb) is
  '연습 창고 입고·이동·소진·실사·충원·개봉. 수량 미확인 행은 수량 작업을 막는다.';

create or replace function public.replace_warehouse_inventory_snapshot(
  p_brand_id uuid,
  p_source_file_name text,
  p_rows jsonb
)
returns public.warehouse_inventory_sets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_warehouse_id uuid;
  v_previous_set public.warehouse_inventory_sets;
  v_set public.warehouse_inventory_sets;
  v_row_count integer;
begin
  perform set_config('statement_timeout', '120s', true);

  if auth.role() is distinct from 'service_role' then
    raise exception '사이트 창고 전체 교체는 동기화 서버만 호출할 수 있습니다.';
  end if;
  if p_brand_id is null then
    raise exception '브랜드를 지정하세요.';
  end if;
  if p_source_file_name is null or btrim(p_source_file_name) = '' then
    raise exception '원본 파일 이름을 입력하세요.';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception '가져올 창고 행이 없습니다.';
  end if;

  select brand.company_id
    into v_company_id
  from public.brands as brand
  where brand.id = p_brand_id;
  if v_company_id is null then
    raise exception '브랜드를 찾을 수 없습니다.';
  end if;

  select *
    into v_previous_set
  from public.warehouse_inventory_sets
  where brand_id = p_brand_id
    and kind = 'sandbox'
    and status = 'active'
  limit 1
  for update;

  if v_previous_set.id is null then
    insert into public.warehouses (company_id, name)
    values (v_company_id, '연습 창고')
    on conflict (company_id, name) do update
      set name = excluded.name
    returning id into v_warehouse_id;
  else
    v_warehouse_id := v_previous_set.warehouse_id;
    update public.warehouse_inventory_sets
    set status = 'archived'
    where id = v_previous_set.id;
  end if;

  insert into public.warehouse_inventory_sets (
    brand_id,
    warehouse_id,
    kind,
    status,
    source_file_name,
    row_count,
    imported_by
  )
  values (
    p_brand_id,
    v_warehouse_id,
    'sandbox',
    'active',
    btrim(p_source_file_name),
    0,
    null
  )
  returning * into v_set;

  insert into public.warehouse_locations (
    company_id,
    warehouse_id,
    code,
    zone
  )
  select distinct
    v_company_id,
    v_warehouse_id,
    coalesce(nullif(btrim(item ->> 'location_code'), ''), '(빈 자리)'),
    coalesce(nullif(btrim(item ->> 'zone'), ''), 'box_storage')
  from jsonb_array_elements(p_rows) as item
  on conflict (warehouse_id, zone, code) do nothing;

  insert into public.warehouse_stock_positions (
    brand_id,
    set_id,
    warehouse_id,
    location_id,
    style_id,
    source_style_no,
    normalized_style_no,
    source_product_name,
    received_on,
    received_on_raw,
    is_forced_priority,
    is_final_location,
    usage_priority,
    quantity_status,
    units_per_box,
    remaining_boxes,
    units_per_box_raw,
    remaining_boxes_raw,
    opened_units,
    review_flags,
    source_row_number,
    note,
    external_row_id
  )
  select
    p_brand_id,
    v_set.id,
    v_warehouse_id,
    loc.id,
    nullif(parsed.item ->> 'style_id', '')::uuid,
    coalesce(parsed.item ->> 'source_style_no', ''),
    coalesce(parsed.item ->> 'normalized_style_no', ''),
    coalesce(parsed.item ->> 'source_product_name', ''),
    nullif(parsed.item ->> 'received_on', '')::date,
    coalesce(parsed.item ->> 'received_on_raw', ''),
    coalesce((parsed.item ->> 'is_forced_priority')::boolean, false),
    coalesce((parsed.item ->> 'is_final_location')::boolean, false),
    coalesce(nullif(parsed.item ->> 'usage_priority', ''), 'fifo'),
    parsed.quantity_status,
    parsed.units_per_box,
    parsed.remaining_boxes,
    coalesce(parsed.item ->> 'units_per_box_raw', ''),
    coalesce(parsed.item ->> 'remaining_boxes_raw', ''),
    0,
    coalesce(
      array(
        select jsonb_array_elements_text(
          coalesce(parsed.item -> 'review_flags', '[]'::jsonb)
        )
      ),
      '{}'::text[]
    ),
    (parsed.item ->> 'source_row_number')::integer,
    coalesce(parsed.item ->> 'note', ''),
    nullif(btrim(coalesce(parsed.item ->> 'external_row_id', '')), '')
  from (
    select
      item,
      case
        when nullif(item ->> 'units_per_box', '') is null then null
        when (item ->> 'units_per_box')::integer < 1 then null
        else (item ->> 'units_per_box')::integer
      end as units_per_box,
      case
        when nullif(item ->> 'remaining_boxes', '') is null then null
        when (item ->> 'remaining_boxes')::integer < 0 then null
        else (item ->> 'remaining_boxes')::integer
      end as remaining_boxes,
      case
        when coalesce(item ->> 'quantity_status', '') = 'unknown' then 'unknown'
        when nullif(item ->> 'units_per_box', '') is null
          or nullif(item ->> 'remaining_boxes', '') is null
          then 'unknown'
        else 'known'
      end as quantity_status
    from jsonb_array_elements(p_rows) as item
  ) as parsed
  join public.warehouse_locations as loc
    on loc.warehouse_id = v_warehouse_id
    and loc.zone = coalesce(nullif(btrim(parsed.item ->> 'zone'), ''), 'box_storage')
    and loc.code = coalesce(
      nullif(btrim(parsed.item ->> 'location_code'), ''),
      '(빈 자리)'
    );

  select count(*)::integer
    into v_row_count
  from public.warehouse_stock_positions
  where brand_id = p_brand_id
    and set_id = v_set.id;

  if v_row_count <> jsonb_array_length(p_rows) then
    raise exception '창고 행을 모두 저장하지 못했습니다. 자리번호와 구역을 확인하세요.';
  end if;

  update public.warehouse_inventory_sets
  set row_count = v_row_count
  where id = v_set.id
  returning * into v_set;

  insert into public.warehouse_stock_movements (
    brand_id,
    set_id,
    action,
    box_count,
    reason,
    actor_id
  )
  values (
    p_brand_id,
    v_set.id,
    'import',
    v_row_count,
    'Google 시트 전체 동기화',
    null
  );

  return v_set;
end;
$$;

comment on function public.replace_warehouse_inventory_snapshot(uuid, text, jsonb) is
  'Apps Script 전용. 활성 연습 세트를 보관하고 시트 전체 스냅샷으로 교체한다.';

revoke all on function public.replace_warehouse_inventory_snapshot(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_warehouse_inventory_snapshot(uuid, text, jsonb)
  to service_role;
