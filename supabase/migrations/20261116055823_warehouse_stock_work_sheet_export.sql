alter table app.warehouse_qr_audit_sheet_exports
  add column stock_actor_id uuid,
  add column stock_request jsonb;

create or replace function public.list_warehouse_qr_audit_sheet_exports(p_brand_id uuid)
returns setof jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('id', id, 'place', whole_place, 'before', before_rows,
    'after', after_rows, 'kind', case when stock_request is null then 'audit' else 'stock' end)
  from app.warehouse_qr_audit_sheet_exports
  where brand_id = p_brand_id and sheet_synced_at is null order by queued_at, id limit 10;
$$;

create or replace function app.assert_warehouse_qr_audit_sheet_ready(p_brand_id uuid, p_place text, p_qr text default null, p_row_id text default null)
returns void language plpgsql set search_path = ''
as $$
begin
  if app.warehouse_qr_audit_sheet_pending(p_brand_id, p_place, p_qr, p_row_id) then
    raise exception '이 자리 또는 박스의 작업이 창고입력에 반영되는 중입니다. 잠시 후 다시 시도해주세요.'
      using errcode = 'PQA01';
  end if;
end;
$$;

create function app.warehouse_stock_work_sheet_row(
  p public.warehouse_stock_positions, p_place text, p_preserve_note boolean default false
)
returns jsonb language sql immutable set search_path = ''
as $$
  select jsonb_build_object('id', p.external_row_id, 'qr', upper(btrim(coalesce(p.box_qr,''))),
    'values', jsonb_build_array(btrim(p.source_style_no), btrim(p.source_product_name),
      p_place || case when p.is_final_location then '//' else '' end, btrim(p.received_on_raw),
      case when p.units_per_box_raw ~ '^-?[0-9,]+$' then replace(p.units_per_box_raw,',','') else btrim(p.units_per_box_raw) end,
      case when p.remaining_boxes_raw ~ '^-?[0-9,]+$' then replace(p.remaining_boxes_raw,',','') else btrim(p.remaining_boxes_raw) end,
      concat_ws(' · ', case when p.opened_units > 0 then '개봉 잔량 ' || p.opened_units || '개' end, nullif(btrim(p.note),''))),
    'opened', p.opened_units, 'rawNote', btrim(p.note), 'preserveNote', p_preserve_note);
$$;
revoke all on function app.warehouse_stock_work_sheet_row(public.warehouse_stock_positions,text,boolean)
  from public,anon,authenticated;

create or replace function public.confirm_warehouse_qr_audit_sheet_export(p_brand_id uuid,p_id uuid,p_rows jsonb)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_expected jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('finder-placement/' || p_brand_id::text, 0));
  select coalesce(jsonb_agg(
    case when r->>'preserveNote' = 'true' and observed.row->'values'->>6 = r->>'rawNote'
      then jsonb_set(r - array['opened','rawNote','preserveNote'], '{values,6}', r->'rawNote')
      else r - array['opened','rawNote','preserveNote']
    end order by r->>'id'), '[]'::jsonb) into v_expected
  from app.warehouse_qr_audit_sheet_exports e
  cross join lateral jsonb_array_elements(e.after_rows) r
  left join lateral (
    select item as row from jsonb_array_elements(p_rows) item where item->>'id' = r->>'id' limit 1
  ) observed on true
  where e.id = p_id and e.brand_id = p_brand_id;
  if v_expected is distinct from p_rows then return false; end if;
  update app.warehouse_qr_audit_sheet_exports set sheet_synced_at = coalesce(sheet_synced_at,clock_timestamp())
  where id = p_id and brand_id = p_brand_id;
  return found;
end;
$$;

create function public.save_warehouse_stock_work(
  p_brand_id uuid, p_request_id uuid, p_position_id uuid, p_expected_updated_at timestamptz,
  p_action text, p_payload jsonb
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_request jsonb := jsonb_build_object('positionId',p_position_id,'updatedAt',p_expected_updated_at,
    'action',p_action,'payload',p_payload);
  v_saved app.warehouse_qr_audit_sheet_exports;
  v_old public.warehouse_stock_positions;
  v_source public.warehouse_stock_positions;
  v_target public.warehouse_stock_positions;
  v_origin public.warehouse_locations;
  v_dest public.warehouse_registered_slots;
  v_box public.warehouse_boxes;
  v_units integer;
  v_boxes integer;
  v_opened integer;
  v_count integer;
  v_before jsonb;
  v_after jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  if not app.can_review_warehouse_qr_audit(p_brand_id)
    or not exists (select 1 from public.brands where id = p_brand_id and slug = 'masmarulez') then
    raise exception '이 창고 재고를 수정할 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_request_id is null or p_action is null or p_action not in ('move','adjust','deplete')
    or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception '창고 작업을 확인해주세요.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('finder-placement/' || p_brand_id::text, 0));
  select * into v_saved from app.warehouse_qr_audit_sheet_exports where id = p_request_id;
  if found then
    if v_saved.brand_id = p_brand_id and v_saved.stock_actor_id = v_actor and v_saved.stock_request = v_request then
      return jsonb_build_object('sheetPending', v_saved.sheet_synced_at is null);
    end if;
    raise exception '이미 사용한 창고 작업 번호입니다.' using errcode = '22023';
  end if;

  select p.* into v_old from public.warehouse_stock_positions p
  join public.warehouse_inventory_sets s on s.id = p.set_id and s.kind = 'sandbox' and s.status = 'active'
  where p.brand_id = p_brand_id and p.id = p_position_id for update of p;
  if not found or v_old.updated_at is distinct from p_expected_updated_at then
    raise exception '재고가 바뀌었습니다. 목록을 다시 불러온 뒤 확인해주세요.' using errcode = '40001';
  end if;
  if nullif(btrim(v_old.external_row_id), '') is null
    or exists (select 1 from public.warehouse_stock_positions where set_id = v_old.set_id
      and external_row_id = v_old.external_row_id and id <> v_old.id) then
    raise exception '재고의 창고입력 AA 행을 확인해주세요.' using errcode = '22023';
  end if;
  if not app.warehouse_qr_audit_is_active(v_old) then
    raise exception '소진된 재고입니다. 새로 입고해주세요.' using errcode = '22023';
  end if;
  select * into strict v_origin from public.warehouse_locations where id = v_old.location_id;
  perform app.assert_warehouse_qr_audit_sheet_ready(p_brand_id, v_origin.code, v_old.box_qr, v_old.external_row_id);
  if exists (select 1 from app.finder_warehouse_sheet_exports
    where brand_id = p_brand_id and sheet_row_id = v_old.external_row_id and sheet_synced_at is null)
    or exists (select 1 from app.warehouse_stock_condition_exports
      where brand_id = p_brand_id and external_row_id = v_old.external_row_id and sheet_synced_at is null)
    or exists (select 1 from app.finder_warehouse_placement_operations o
      where o.brand_id = p_brand_id and o.finished_at is null and o.cancelled_at is null
      and (o.plan->'write'->>'docId' = v_old.external_row_id or exists (
        select 1 from jsonb_array_elements(o.plan->'clear') c
        where c->'row'->>'external_row_id' = v_old.external_row_id))) then
    raise exception '앞선 작업의 창고입력 반영을 완료한 뒤 다시 저장해주세요.' using errcode = 'PQA01';
  end if;

  if nullif(v_old.box_qr, '') is not null then
    select * into v_box from public.warehouse_boxes where brand_id = p_brand_id
      and display_code = upper(v_old.box_qr) for update;
    if v_box.archived_at is not null or v_box.completed_at is not null then
      raise exception '이미 종료된 박스입니다.' using errcode = '22023';
    end if;
    insert into app.warehouse_qr_audit_writes values (p_brand_id, pg_current_xact_id());
  end if;
  v_before := app.warehouse_stock_work_sheet_row(v_old,v_origin.code);

  if p_action = 'move' then
    select * into v_dest from public.warehouse_registered_slots
    where warehouse_id = v_old.warehouse_id and upper(code) = upper(btrim(p_payload->>'to_location_code'));
    if not found or v_dest.zone not in ('box_storage','picking') then
      raise exception '등록된 도착 자리번호를 입력하세요.' using errcode = '22023';
    end if;
    if v_dest.code = v_origin.code and v_dest.zone = v_origin.zone then
      raise exception '현재 자리와 다른 도착 자리를 선택해주세요.' using errcode = '22023';
    end if;
    perform app.assert_warehouse_qr_audit_sheet_ready(p_brand_id, v_dest.code);
    v_count := (p_payload->>'box_count')::integer;
    if v_old.quantity_status <> 'known' or v_old.units_per_box is null or
      v_count is null or v_count < 0 or v_count > v_old.remaining_boxes or
      (v_count = 0 and (v_old.remaining_boxes <> 0 or v_old.opened_units = 0)) then
      raise exception '옮길 박스 수를 확인해주세요.' using errcode = '22023';
    end if;
    if nullif(v_old.box_qr,'') is not null and v_count <> v_old.remaining_boxes then
      raise exception 'QR이 연결된 박스는 한 박스 단위로 이동해주세요.' using errcode = '22023';
    end if;
    v_target := v_old;
    v_target.location_id := app.ensure_warehouse_box_location(p_brand_id, v_dest.code, v_dest.zone);
    if v_count = v_old.remaining_boxes then
      update public.warehouse_stock_positions set location_id = v_target.location_id
      where id = v_old.id returning * into v_target;
    else
      update public.warehouse_stock_positions set remaining_boxes = remaining_boxes - v_count,
        remaining_boxes_raw = (remaining_boxes - v_count)::text
      where id = v_old.id returning * into v_source;
      v_target.id := gen_random_uuid();
      -- The sheet importer recognizes this prefix for manually registered products without an M number.
      v_target.external_row_id := case when v_old.external_row_id ~ '^at_manual_[0-9a-f]{32}$'
        then 'at_manual_' || replace(v_target.id::text, '-', '')
        else 'at_move_' || replace(p_request_id::text, '-', '') end;
      v_target.remaining_boxes := v_count;
      v_target.remaining_boxes_raw := v_count::text;
      v_target.opened_units := 0;
      v_target.created_at := now();
      v_target.updated_at := now();
      insert into public.warehouse_stock_positions select (v_target).* returning * into v_target;
      update public.warehouse_inventory_sets set row_count = (
        select count(*) from public.warehouse_stock_positions where set_id = v_target.set_id
      ) where id = v_target.set_id;
      insert into public.warehouse_stock_condition_links (brand_id, external_row_id, source_product_name, reference_style_id, condition)
      select brand_id, v_target.external_row_id, source_product_name, reference_style_id, condition
      from public.warehouse_stock_condition_links
      where brand_id = p_brand_id and external_row_id = v_old.external_row_id
        and source_product_name = v_old.source_product_name;
      v_after := jsonb_build_array(app.warehouse_stock_work_sheet_row(v_source,v_origin.code,true));
    end if;
    insert into public.warehouse_stock_movements (brand_id,set_id,action,position_id,style_id,
      from_location_code,to_location_code,box_count,unit_count,reason,actor_id)
    values (p_brand_id,v_old.set_id,'move',v_target.id,v_target.style_id,v_origin.code,v_dest.code,
      v_count,(v_count * v_old.units_per_box) + v_target.opened_units,'자리 이동',v_actor);
  else
    if p_action = 'adjust' then
      v_units := (p_payload->>'units_per_box')::integer;
      v_boxes := (p_payload->>'remaining_boxes')::integer;
      v_opened := coalesce((p_payload->>'opened_units')::integer, v_old.opened_units);
      if v_units is null or v_units < 1 or v_boxes is null or v_boxes < 0 or v_opened < 0
        or (nullif(v_old.box_qr,'') is not null and (v_boxes > 1 or v_opened > v_units or
          (v_boxes > 0 and v_opened > 0))) then
        raise exception '입수와 잔여 수량을 확인하세요.' using errcode = '22023';
      end if;
    end if;
    v_result := public.apply_warehouse_stock_action(p_brand_id,p_action,
      p_payload || jsonb_build_object('position_id',p_position_id));
    v_target := jsonb_populate_record(null::public.warehouse_stock_positions,v_result);
  end if;

  if app.warehouse_qr_audit_is_active(v_target) then
    v_after := v_after || jsonb_build_array(app.warehouse_stock_work_sheet_row(
      v_target,coalesce(v_dest.code,v_origin.code),p_action = 'move' and v_target.id = v_old.id));
  end if;

  if nullif(v_old.box_qr, '') is not null then
    if not app.warehouse_qr_audit_is_active(v_target) then
      update public.warehouse_boxes set current_qty = 0, completed_at = clock_timestamp(),
        completed_by = v_actor, completion_kind = 'depleted', presumed_depleted_at = null,
        source_position_id = null
      where id = v_box.id;
      delete from app.finder_warehouse_presumed_boxes where brand_id = p_brand_id and box_qr = upper(v_old.box_qr);
    elsif p_action = 'move' then
      update public.warehouse_boxes set location_id = v_target.location_id, source_position_id = v_target.id
      where id = v_box.id;
    else
      perform app.sync_warehouse_qr_audit_box(v_target,
        coalesce(v_box.style_id, v_target.style_id),v_actor);
    end if;
  end if;

  if not app.warehouse_qr_audit_is_active(v_target) then
    -- The movement keeps its original position ID across inventory replacements.
    if exists (select 1 from public.warehouse_boxes where brand_id = p_brand_id and source_position_id = v_target.id) then
      insert into app.warehouse_qr_audit_writes values (p_brand_id, pg_current_xact_id()) on conflict do nothing;
      update public.warehouse_boxes set source_position_id = null
      where brand_id = p_brand_id and source_position_id = v_target.id;
    end if;
    delete from public.warehouse_stock_positions where id = v_target.id;
    update public.warehouse_inventory_sets set row_count = (
      select count(*) from public.warehouse_stock_positions where set_id = v_target.set_id
    ) where id = v_target.set_id;
  end if;
  delete from app.warehouse_qr_audit_writes where brand_id = p_brand_id and transaction_id = pg_current_xact_id();

  insert into app.warehouse_qr_audit_sheet_exports (id,brand_id,before_rows,after_rows,stock_actor_id,stock_request)
  values (p_request_id,p_brand_id,jsonb_build_array(v_before),v_after,v_actor,v_request);
  return jsonb_build_object('sheetPending',true);
end;
$$;

revoke all on function public.save_warehouse_stock_work(uuid,uuid,uuid,timestamptz,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_warehouse_stock_work(uuid,uuid,uuid,timestamptz,text,jsonb) to authenticated;

create or replace function public.replace_warehouse_inventory_snapshot_with_box_qr(
  p_brand_id uuid,p_source_file_name text,p_rows jsonb,p_snapshot_at timestamptz
)
returns public.warehouse_inventory_sets
language plpgsql security definer set search_path = ''
as $$
declare v_set public.warehouse_inventory_sets;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception '동기화 서버만 실행할 수 있습니다.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('finder-placement/' || p_brand_id::text, 0));
  if exists (select 1 from app.warehouse_qr_audit_sheet_exports
    where brand_id = p_brand_id and (sheet_synced_at is null or sheet_synced_at >= p_snapshot_at)) then
    raise exception '창고 작업을 반영하기 전의 창고입력입니다. 시트 반영 후 다시 동기화해주세요.' using errcode = 'PWS07';
  end if;
  v_set := public.replace_warehouse_inventory_snapshot_with_qr_audit_overlay(p_brand_id,p_source_file_name,p_rows,p_snapshot_at);
  -- A full move changes only D. Legacy moved rows may still have an ordinary H note.
  with latest as (
    select distinct on (r->>'id') r as projection
    from app.warehouse_qr_audit_sheet_exports e
    cross join lateral jsonb_array_elements(e.after_rows) r
    where e.brand_id = p_brand_id and e.stock_request is not null
    order by r->>'id', e.queued_at desc, e.id desc
  )
  update public.warehouse_stock_positions p set
    opened_units = (projection->>'opened')::integer,
    note = projection->>'rawNote'
  from latest
  where p.set_id = v_set.id and p.brand_id = p_brand_id and p.opened_units = 0
    and p.external_row_id = projection->>'id' and (projection->>'opened')::integer > 0
    and (p.note = projection->'values'->>6 or
      (projection->>'preserveNote' = 'true' and p.note = projection->>'rawNote'));
  return v_set;
end;
$$;
