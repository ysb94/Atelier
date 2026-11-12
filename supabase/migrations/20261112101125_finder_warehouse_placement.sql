-- The sheet changes and the active inventory publication are retriable as one operation.
create table app.finder_warehouse_placement_operations (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id),
  actor_id uuid not null,
  request jsonb not null,
  plan jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  cancelled_at timestamptz
);

alter table app.finder_warehouse_placement_operations enable row level security;
revoke all on app.finder_warehouse_placement_operations from public, anon, authenticated;
create unique index finder_placement_one_pending_per_brand
  on app.finder_warehouse_placement_operations(brand_id)
  where finished_at is null and cancelled_at is null;
create index finder_placement_latest_finished
  on app.finder_warehouse_placement_operations(brand_id, finished_at desc)
  where finished_at is not null;

create table app.finder_warehouse_presumed_boxes (
  brand_id uuid not null references public.brands(id),
  box_qr text not null,
  snapshot jsonb not null,
  primary key (brand_id, box_qr)
);

alter table app.finder_warehouse_presumed_boxes enable row level security;
revoke all on app.finder_warehouse_presumed_boxes from public, anon, authenticated;

create index warehouse_stock_positions_set_box_qr_idx
  on public.warehouse_stock_positions(set_id, upper(box_qr))
  where box_qr is not null;

alter table public.warehouse_boxes
  alter column location_id drop not null,
  add column presumed_depleted_at timestamptz,
  add constraint warehouse_box_presumed_depletion_location
    check ((presumed_depleted_at is null) = (location_id is not null));

-- Keep the regular box lifecycle trigger in force for every located box.
-- A Finder removal has no location to validate and changes only these fields.
create function app.guard_finder_warehouse_box_location()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if new.presumed_depleted_at is not null or
    (tg_op = 'UPDATE' and old.presumed_depleted_at is not null) then
    if app.has_masma_finder_sheet_write_key() is not true or tg_op <> 'UPDATE' or
      old.archived_at is not null or old.completed_at is not null then
      raise exception '소진 추정 박스는 Finder에서만 수정할 수 있습니다.' using errcode = '42501';
    end if;
    if new.presumed_depleted_at is not null and
      (to_jsonb(new) - array['location_id','presumed_depleted_at','updated_at']) is distinct from
      (to_jsonb(old) - array['location_id','presumed_depleted_at','updated_at']) then
      raise exception '소진 추정 시 박스 위치만 비울 수 있습니다.';
    end if;
  end if;
  return new;
end;
$$;

create trigger guard_finder_warehouse_box_location
before insert or update on public.warehouse_boxes
for each row execute function app.guard_finder_warehouse_box_location();

-- The existing boundary function requires a location. Its ordinary checks still
-- run when a box is recovered or moved. A sealed or opened box may be moved
-- by Finder; other callers retain the existing restriction in box storage.
create or replace function public.enforce_warehouse_box_boundaries()
returns trigger
language plpgsql
security invoker
set search_path to public
as $$
declare
  v_brand_company uuid;
  v_location_company uuid;
  v_location_warehouse uuid;
  v_location_zone text;
  v_expected_warehouse uuid;
begin
  new.display_code := upper(btrim(new.display_code));
  new.note := coalesce(new.note, '');
  new.usage_priority := coalesce(new.usage_priority, 'fifo');

  if new.presumed_depleted_at is not null then
    return new;
  end if;

  if tg_op = 'UPDATE'
    and old.archived_at is null
    and new.archived_at is not null then
    raise exception '보관 처리는 더 이상 사용할 수 없습니다. 소진 또는 박스 출고로 종료하세요.';
  end if;

  if tg_op = 'UPDATE' and old.archived_at is not null then
    if new.archived_at is distinct from old.archived_at
      or new.completed_at is distinct from old.completed_at
      or new.completion_kind is distinct from old.completion_kind
      or new.current_qty is distinct from old.current_qty
      or new.location_id is distinct from old.location_id
      or new.usage_priority is distinct from old.usage_priority
      or new.note is distinct from old.note
      or new.display_code is distinct from old.display_code
      or new.style_id is distinct from old.style_id
      or new.initial_qty is distinct from old.initial_qty
      or new.received_on is distinct from old.received_on
    then
      raise exception '보관된 박스는 수정할 수 없습니다.';
    end if;
  end if;

  if tg_op = 'UPDATE' and old.completed_at is not null then
    if new.completed_at is distinct from old.completed_at
      or new.completed_by is distinct from old.completed_by
      or new.completion_kind is distinct from old.completion_kind
      or new.current_qty is distinct from old.current_qty
      or new.location_id is distinct from old.location_id
      or new.usage_priority is distinct from old.usage_priority
      or new.note is distinct from old.note
      or new.display_code is distinct from old.display_code
      or new.style_id is distinct from old.style_id
      or new.initial_qty is distinct from old.initial_qty
      or new.received_on is distinct from old.received_on
    then
      raise exception '종료된 박스는 수정할 수 없습니다.';
    end if;
  end if;

  if new.current_qty > new.initial_qty then
    raise exception '현재 수량은 최초 입수보다 많을 수 없습니다.';
  end if;

  select loc.company_id, loc.warehouse_id, loc.zone
    into v_location_company, v_location_warehouse, v_location_zone
  from public.warehouse_locations as loc
  where loc.id = new.location_id;

  if v_location_zone = 'box_storage'
    and new.current_qty <> new.initial_qty
    and new.completion_kind is distinct from 'box_outbound'
    and not (case when coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb ? 'x-finder-write-key'
      then coalesce(app.has_masma_finder_sheet_write_key(), false) else false end) then
    raise exception '박스창고에서는 개봉하거나 수량을 차감할 수 없습니다. 택배 포장 또는 대량 출고 자리로 먼저 이동하세요.';
  end if;

  new.status := app.warehouse_box_status(new.initial_qty, new.current_qty);

  if new.completed_at is not null then
    if new.current_qty <> 0 then
      raise exception '종료된 박스의 현재 수량은 0이어야 합니다.';
    end if;
    if new.completion_kind not in ('depleted', 'box_outbound') then
      raise exception '종료 종류가 올바르지 않습니다.';
    end if;
  end if;

  select brand.company_id
    into v_brand_company
  from public.brands as brand
  where brand.id = new.brand_id;

  select resolved.warehouse_id
    into v_expected_warehouse
  from app.resolve_brand_warehouse(new.brand_id) as resolved;

  if v_brand_company is null
    or v_location_company is distinct from v_brand_company then
    raise exception '박스 자리가 브랜드 창고와 맞지 않습니다.';
  end if;
  if v_expected_warehouse is not null
    and v_location_warehouse is distinct from v_expected_warehouse then
    raise exception '박스 자리가 브랜드 창고와 맞지 않습니다.';
  end if;

  return new;
end;
$$;

create function app.finder_warehouse_placement_state(p_set_id uuid, p_place text)
returns jsonb language sql stable set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object('row', to_jsonb(position) || jsonb_build_object(
      'box_qr', coalesce(nullif(position.box_qr, ''), linked.display_code)
    ), 'place', loc.code, 'zone', loc.zone)
    order by position.external_row_id, position.id
  ), '[]'::jsonb)
  from public.warehouse_stock_positions position
  join public.warehouse_locations loc on loc.id = position.location_id
  left join app.masma_finder_inbound_sheet receipt on receipt.brand_id = position.brand_id
    and receipt.sheet_row_id = position.external_row_id
  left join public.warehouse_boxes linked on linked.id = receipt.box_id
    and linked.style_id = position.style_id and linked.received_on = position.received_on
  where position.set_id = p_set_id and upper(loc.code) = upper(p_place)
    and (position.quantity_status = 'unknown' or coalesce(position.remaining_boxes, 0) > 0
      or position.opened_units > 0);
$$;

revoke all on function app.finder_warehouse_placement_state(uuid, text) from public, anon, authenticated;

create function app.finder_warehouse_placement(
  p_brand_id uuid, p_action text, p_request jsonb
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_set public.warehouse_inventory_sets;
  v_op app.finder_warehouse_placement_operations;
  v_box public.warehouse_boxes;
  v_position public.warehouse_stock_positions;
  v_style public.styles;
  v_place text := upper(btrim(coalesce(p_request->>'place', '')));
  v_qr text := upper(btrim(coalesce(p_request->>'qr', '')));
  v_number text := upper(btrim(coalesce(p_request->>'number', '')));
  v_mode text := p_request->>'mode';
  v_zone text;
  v_location_id uuid;
  v_rows jsonb := '[]';
  v_clear jsonb := '[]';
  v_source jsonb;
  v_write jsonb;
  v_plan jsonb;
  v_groups jsonb;
  v_item jsonb;
  v_state text;
  v_initial integer;
  v_qty integer;
  v_date date;
  v_doc text;
  v_count integer;
  v_occupants text;
  v_row_number integer;
  v_receipt_doc text;
begin
  if auth.uid() is null or not exists (
    select 1 from public.masma_finder_users
    where brand_id = p_brand_id and auth_user_id = auth.uid() and status = 'active'
      and (is_admin or can_use_test)
  ) or app.has_masma_finder_sheet_write_key() is not true then
    raise exception 'Finder 창고 작업 권한이 필요합니다.' using errcode = '42501';
  end if;

  if p_action <> 'read' then
    perform pg_advisory_xact_lock(hashtextextended('finder-placement/' || p_brand_id::text, 0));
  end if;
  select * into strict v_set from public.warehouse_inventory_sets
  where brand_id = p_brand_id and kind = 'sandbox' and status = 'active';
  if p_action in ('finish', 'cancel') then
    select * into strict v_op from app.finder_warehouse_placement_operations
    where id = (p_request->>'operationId')::uuid and brand_id = p_brand_id and actor_id = auth.uid()
    for update;
    if v_op.finished_at is not null then return v_op.plan->'result'; end if;
    if v_op.cancelled_at is not null then raise exception '이미 취소된 작업입니다.'; end if;
    if p_action = 'cancel' then
      update app.finder_warehouse_placement_operations set cancelled_at = clock_timestamp() where id = v_op.id;
      return jsonb_build_object('status', 'cancelled');
    end if;

    select * into strict v_set from public.warehouse_inventory_sets where id = v_set.id for update;
    v_plan := v_op.plan;
    v_write := v_plan->'write';
    for v_item in select value from jsonb_array_elements(v_plan->'clear') loop
      v_doc := v_item->'row'->>'external_row_id';
      insert into public.warehouse_stock_movements (
        brand_id, set_id, action, style_id, from_location_code, box_count, reason, actor_id
      ) values (
        p_brand_id, v_set.id, 'adjust', (v_item->'row'->>'style_id')::uuid,
        v_item->>'place', 0,
        concat_ws(' · ', '출고로 소진 추정', nullif(v_item->'row'->>'box_qr', '')), auth.uid()
      );
      delete from public.warehouse_stock_positions
      where brand_id = p_brand_id and set_id = v_set.id and external_row_id = v_doc;
      if nullif(v_item->'row'->>'box_qr', '') is not null then
        insert into app.finder_warehouse_presumed_boxes (brand_id, box_qr, snapshot)
        values (p_brand_id, upper(v_item->'row'->>'box_qr'), v_item)
        on conflict (brand_id, box_qr) do update set snapshot = excluded.snapshot;
      end if;
      update public.warehouse_boxes
      set location_id = null, presumed_depleted_at = clock_timestamp(), updated_at = now()
      where brand_id = p_brand_id and (
        display_code = upper(v_item->'row'->>'box_qr') or (
          location_id = (v_item->'row'->>'location_id')::uuid and style_id = (v_item->'row'->>'style_id')::uuid
        )
      )
        and archived_at is null and completed_at is null and presumed_depleted_at is null;
    end loop;

    if v_write is not null then
      v_row_number := (p_request->>'rowNumber')::integer;
      if v_row_number is null or v_row_number < 3 then raise exception '시트 행 확인이 필요합니다.'; end if;
      v_position := jsonb_populate_record(null::public.warehouse_stock_positions, v_write->'position');
      v_qr := v_write->>'qr';
      v_qty := (v_write->>'quantity')::integer;
      v_initial := (v_write->>'initialQty')::integer;
      v_doc := v_write->>'docId';
      v_location_id := app.ensure_warehouse_box_location(p_brand_id, v_write->>'place', v_write->>'zone');
      update public.warehouse_stock_positions
      set location_id = v_location_id, units_per_box = v_qty, units_per_box_raw = v_qty::text,
        remaining_boxes = 1, remaining_boxes_raw = '1', opened_units = 0,
        quantity_status = 'known',
        is_final_location = coalesce((v_write->>'keepFinalLocation')::boolean, false),
        box_qr = v_qr, source_row_number = v_row_number, updated_at = now()
      where brand_id = p_brand_id and set_id = v_set.id and external_row_id = v_doc;
      if not found then
        insert into public.warehouse_stock_positions (
          brand_id, set_id, warehouse_id, location_id, style_id, source_style_no, normalized_style_no,
          source_product_name, received_on, received_on_raw, is_forced_priority, is_final_location,
          usage_priority, quantity_status, units_per_box, remaining_boxes, units_per_box_raw,
          remaining_boxes_raw, opened_units, source_row_number, external_row_id, note, box_qr
        ) values (
          p_brand_id, v_set.id, v_set.warehouse_id, v_location_id, v_position.style_id,
          v_write->>'number', v_write->>'number', v_write->>'productName', v_position.received_on,
          v_write->>'labelDate', coalesce(v_position.is_forced_priority, false),
          false, coalesce(v_position.usage_priority, 'fifo'),
          'known', v_qty, 1, v_qty::text, '1', 0, v_row_number, v_doc,
          coalesce(v_position.note, ''), v_qr
        );
        -- Older Finder deployments may still have a trigger deriving S from an inbound receipt.
        update public.warehouse_stock_positions set box_qr = v_qr
        where set_id = v_set.id and external_row_id = v_doc and box_qr is distinct from v_qr;
      end if;

      insert into public.warehouse_boxes (
        brand_id, display_code, location_id, style_id, received_on, initial_qty, current_qty, created_by
      ) values (
        p_brand_id, v_qr, v_location_id, v_position.style_id, v_position.received_on, v_initial, v_qty, auth.uid()
      ) on conflict (brand_id, display_code) do update
      set location_id = excluded.location_id, current_qty = excluded.current_qty,
        presumed_depleted_at = null, updated_at = now()
      where warehouse_boxes.archived_at is null and warehouse_boxes.completed_at is null;
      delete from app.finder_warehouse_presumed_boxes
      where brand_id = p_brand_id and box_qr = v_qr;
      insert into public.warehouse_stock_movements (
        brand_id, set_id, action, style_id, from_location_code, to_location_code,
        box_count, unit_count, reason, actor_id
      ) values (
        p_brand_id, v_set.id,
        case when v_write->'source' = 'null'::jsonb then 'receive'
          when v_write->'source'->>'place' = v_write->>'place' then 'adjust' else 'move' end,
        v_position.style_id, v_write->'source'->>'place', v_write->>'place', 1, v_qty,
        concat_ws(' · ', v_write->>'reason', v_qr), auth.uid()
      );
    end if;

    update public.warehouse_inventory_sets
    set row_count = (select count(*) from public.warehouse_stock_positions where set_id = v_set.id),
      updated_at = now()
    where id = v_set.id;
    update app.finder_warehouse_placement_operations set finished_at = clock_timestamp() where id = v_op.id;
    return v_plan->'result';
  end if;

  select zone into v_zone from public.warehouse_registered_slots
  where warehouse_id = v_set.warehouse_id and upper(code) = v_place;
  if v_zone is null then raise exception '등록된 박스창고 또는 출고창고 자리를 스캔해주세요.'; end if;

  v_rows := app.finder_warehouse_placement_state(v_set.id, v_place);
  select coalesce(jsonb_agg(jsonb_build_object(
    'number', number, 'productName', product_name, 'count', boxes, 'token', token
  ) order by number), '[]'::jsonb) into v_groups
  from (
    select item->'row'->>'normalized_style_no' as number,
      max(item->'row'->>'source_product_name') as product_name,
      sum(case when (item->'row'->>'opened_units')::integer > 0 then 1
        else coalesce((item->'row'->>'remaining_boxes')::integer, 1) end) as boxes,
      md5(jsonb_agg(item order by ord)::text) as token
    from jsonb_array_elements(v_rows) with ordinality as e(item, ord)
    group by 1
  ) grouped;

  if v_qr <> '' then
    select * into v_box from public.warehouse_boxes where brand_id = p_brand_id and display_code = v_qr;
    select sheet_row_id into v_receipt_doc from app.masma_finder_inbound_sheet
    where brand_id = p_brand_id and box_id = v_box.id;
    select count(*), jsonb_agg(jsonb_build_object('row', to_jsonb(pos), 'place', loc.code, 'zone', loc.zone))->0
    into v_count, v_source
    from public.warehouse_stock_positions pos
    join public.warehouse_locations loc on loc.id = pos.location_id
    where pos.set_id = v_set.id and (
      (pos.box_qr is not null and upper(pos.box_qr) = v_qr)
      or (nullif(pos.box_qr, '') is null and (
        pos.external_row_id = v_receipt_doc or (pos.id = v_box.source_position_id and pos.remaining_boxes = 1)
      ))
    );
    if v_count > 1 then raise exception '같은 QR이 여러 재고 행에 있습니다. 시트를 확인해주세요.'; end if;
    v_state := case
      when v_box.completed_at is not null or v_box.archived_at is not null then 'closed'
      when v_source is not null then 'active'
      else null
    end;
    if v_state is null then
      select snapshot into v_source from app.finder_warehouse_presumed_boxes
      where brand_id = p_brand_id and box_qr = v_qr;
      if v_source is not null then v_state := 'presumed_depleted'; end if;
    end if;
    if v_source is not null then
      v_position := jsonb_populate_record(null::public.warehouse_stock_positions, v_source->'row');
      v_initial := coalesce(v_box.initial_qty, v_position.units_per_box);
      v_qty := coalesce(nullif(v_position.opened_units, 0), v_position.units_per_box, v_box.current_qty);
    elsif v_state is null and v_box.id is not null then
      select * into strict v_style from public.styles where id = v_box.style_id and brand_id = p_brand_id;
      v_position.style_id := v_box.style_id;
      v_position.normalized_style_no := v_style.style_no;
      v_position.source_product_name := v_style.name;
      v_position.received_on := v_box.received_on;
      v_position.received_on_raw := coalesce(to_char(v_box.received_on, 'YYMMDD'), '');
      v_position.note := v_box.note;
      v_initial := v_box.initial_qty;
      v_qty := v_box.current_qty;
      v_state := case when v_box.presumed_depleted_at is not null then 'presumed_depleted'
      when exists (
        select 1 from app.masma_finder_inbound_sheet receipt
        where receipt.box_id = v_box.id and receipt.sheet_row_id is null
      ) or exists (
        select 1 from public.warehouse_stock_positions pos
        where pos.set_id = v_set.id and pos.location_id = v_box.location_id
          and pos.style_id = v_box.style_id and nullif(pos.box_qr, '') is null
      ) then 'unlinked' else 'detached' end;
    end if;
  end if;

  if p_action = 'read' then
    return jsonb_build_object('zone', v_zone, 'groups', v_groups, 'box',
      case when v_state is not null then jsonb_build_object(
        'state', v_state, 'qr', v_qr, 'place', case when v_state = 'active' then v_source->>'place' end,
        'number', v_position.normalized_style_no, 'productName', v_position.source_product_name,
        'initialQty', v_initial, 'currentQty', v_qty,
        'labelDate', v_position.received_on_raw
      ) end, 'pending', exists (
        select 1 from app.finder_warehouse_placement_operations
        where brand_id = p_brand_id and actor_id = auth.uid() and finished_at is null and cancelled_at is null
      ));
  end if;
  if p_action is distinct from 'prepare' then raise exception '지원하지 않는 작업입니다.'; end if;

  select * into v_op from app.finder_warehouse_placement_operations
  where brand_id = p_brand_id and finished_at is null and cancelled_at is null;
  if found then
    if v_op.actor_id = auth.uid() and (
      v_mode = 'resume' or v_op.request - 'token' = p_request - 'token'
    ) then
      return jsonb_build_object('status', 'prepared', 'operationId', v_op.id, 'plan', v_op.plan);
    end if;
    raise exception '앞선 창고 작업의 저장 확인이 남아 있습니다. 같은 작업을 다시 저장해주세요.';
  end if;
  if v_mode = 'resume' then return jsonb_build_object('status', 'unchanged'); end if;

  if v_mode = 'clear' then
    if v_zone <> 'box_storage' or v_number = '' then raise exception '박스창고와 상품을 확인해주세요.'; end if;
    select coalesce(jsonb_agg(item order by ord), '[]'::jsonb) into v_clear
    from jsonb_array_elements(v_rows) with ordinality as e(item, ord)
    where item->'row'->>'normalized_style_no' = v_number;
    if v_clear = '[]'::jsonb then return jsonb_build_object('status', 'unchanged'); end if;
    if md5(v_clear::text) is distinct from p_request->>'token' then
      raise exception '자리 재고가 바뀌었습니다. 상품을 다시 확인해주세요.';
    end if;
  elsif v_mode = 'place' then
    if v_qr = '' or length(v_qr) > 200 then raise exception '박스 QR을 확인해주세요.'; end if;
    if v_state = 'closed' then raise exception '확정 출고 또는 보관 처리된 박스입니다.'; end if;
    if v_state = 'unlinked' then
      raise exception '이 QR의 기존 창고입력 기록을 확인할 수 없습니다. 기존 입고 저장을 완료하거나 시트를 동기화해주세요.';
    end if;
    if v_state is null then
      select * into v_style from public.styles
      where brand_id = p_brand_id and upper(style_no) = v_number;
      if not found then raise exception '없는 M번호입니다. 상품 라벨을 확인해주세요.'; end if;
      v_date := (p_request->>'receivedOn')::date;
      v_initial := (p_request->>'quantity')::integer;
      if v_initial is null or v_initial < 1 or v_date is null then
        raise exception '처음 보는 QR입니다. 상품, 선적일, 최초 입수를 입력해주세요.';
      end if;
      v_qty := v_initial;
      v_position.style_id := v_style.id;
      v_position.normalized_style_no := v_style.style_no;
      v_position.source_product_name := v_style.name;
      v_position.received_on := v_date;
      v_position.received_on_raw := to_char(v_date, 'YYMMDD');
    elsif v_source is not null and v_position.remaining_boxes is distinct from 1 and coalesce(v_position.opened_units, 0) = 0 then
      raise exception '한 행에 여러 박스가 묶여 있습니다. 개별 QR 행을 확인해주세요.';
    end if;

    if p_request ? 'currentQty' then v_qty := (p_request->>'currentQty')::integer; end if;
    if v_qty is null or v_qty < 1 or v_qty > v_initial or v_position.style_id is null then
      raise exception '현재 수량은 1개부터 최초 입수까지 입력할 수 있습니다.';
    end if;
    if v_state = 'active' and upper(v_source->>'place') = v_place
      and v_qty = coalesce(nullif(v_position.opened_units, 0), v_position.units_per_box, v_box.current_qty) then
      return jsonb_build_object('status', 'already_registered');
    end if;

    if v_zone = 'picking' then
      select coalesce(jsonb_agg(item order by ord), '[]'::jsonb) into v_clear
      from jsonb_array_elements(v_rows) with ordinality as e(item, ord)
      where upper(coalesce(item->'row'->>'box_qr', '')) <> v_qr;
      v_occupants := md5(v_clear::text);
      if v_clear <> '[]'::jsonb and p_request->>'token' is distinct from v_occupants then
        return jsonb_build_object('status', 'occupied', 'token', v_occupants, 'boxes', (
          select jsonb_agg(jsonb_build_object(
            'number', item->'row'->>'normalized_style_no', 'productName', item->'row'->>'source_product_name',
            'qr', item->'row'->>'box_qr', 'quantity',
            coalesce(nullif((item->'row'->>'opened_units')::integer, 0), (item->'row'->>'units_per_box')::integer)
          )) from jsonb_array_elements(v_clear) as e(item)
        ));
      end if;
    end if;

    v_doc := case when v_state = 'active' then v_position.external_row_id
      else 'fp_' || replace(gen_random_uuid()::text, '-', '') end;
    if nullif(v_doc, '') is null then raise exception '창고입력 AA 행 ID가 필요합니다.'; end if;
    v_write := jsonb_build_object(
      'docId', v_doc, 'place', v_place, 'zone', v_zone, 'qr', v_qr,
      'number', v_position.normalized_style_no, 'productName', v_position.source_product_name,
      'labelDate', v_position.received_on_raw, 'quantity', v_qty, 'initialQty', v_initial,
      'keepFinalLocation', v_state = 'active' and upper(v_source->>'place') = v_place and v_position.is_final_location,
      'reason', case when v_state in ('presumed_depleted', 'detached') then 'Finder 재발견'
        when v_state is null then 'Finder 입고'
        when upper(v_source->>'place') = v_place then 'Finder 현재 수량 수정' else 'Finder 자리 이동' end,
      'position', to_jsonb(v_position),
      'source', case when v_state = 'active' then v_source end
    );
  else
    raise exception '지원하지 않는 작업입니다.';
  end if;

  if exists (
    select 1 from jsonb_array_elements(v_clear) as e(item)
    where nullif(item->'row'->>'external_row_id', '') is null
  ) then raise exception '창고입력 AA 행 ID가 없는 재고가 있습니다. 시트 동기화 후 다시 시도해주세요.'; end if;
  v_plan := jsonb_build_object(
    'mode', v_mode, 'place', v_place, 'zone', v_zone, 'number', v_number, 'clear', v_clear,
    'result', jsonb_build_object('status', 'saved', 'clearedRows', jsonb_array_length(v_clear))
  );
  if v_write is not null then v_plan := v_plan || jsonb_build_object('write', v_write); end if;
  insert into app.finder_warehouse_placement_operations (brand_id, actor_id, request, plan)
  values (p_brand_id, auth.uid(), p_request, v_plan) returning * into v_op;
  return jsonb_build_object('status', 'prepared', 'operationId', v_op.id, 'plan', v_plan);
end;
$$;

revoke all on function app.finder_warehouse_placement(uuid, text, jsonb) from public, anon;
grant execute on function app.finder_warehouse_placement(uuid, text, jsonb) to authenticated;

create function public.finder_warehouse_placement(p_brand_id uuid, p_action text, p_request jsonb)
returns jsonb language sql security invoker set search_path = ''
as $$ select app.finder_warehouse_placement(p_brand_id, p_action, p_request); $$;

revoke all on function public.finder_warehouse_placement(uuid, text, jsonb) from public, anon;
grant execute on function public.finder_warehouse_placement(uuid, text, jsonb) to authenticated;

create function public.replace_warehouse_inventory_snapshot_with_box_qr(
  p_brand_id uuid, p_source_file_name text, p_rows jsonb, p_snapshot_at timestamptz
)
returns public.warehouse_inventory_sets
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception '동기화 서버만 실행할 수 있습니다.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('finder-placement/' || p_brand_id::text, 0));
  if p_snapshot_at is null or exists (
    select 1 from app.finder_warehouse_placement_operations
    where brand_id = p_brand_id and cancelled_at is null
      and (finished_at is null or finished_at >= p_snapshot_at)
  ) then
    raise exception 'Finder에서 창고 재고가 변경되었습니다. 시트에서 전체 동기화를 다시 실행해주세요.';
  end if;
  return public.replace_warehouse_inventory_snapshot_with_box_qr(p_brand_id, p_source_file_name, p_rows);
end;
$$;

revoke all on function public.replace_warehouse_inventory_snapshot_with_box_qr(uuid, text, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.replace_warehouse_inventory_snapshot_with_box_qr(uuid, text, jsonb, timestamptz)
  to service_role;
