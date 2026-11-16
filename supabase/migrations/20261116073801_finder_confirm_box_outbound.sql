-- Reuse the placement journal so sheet imports and warehouse writers see a
-- pending operation until its sheet transaction has been acknowledged.
alter function app.finder_warehouse_placement(uuid,text,jsonb)
  rename to finder_warehouse_placement_before_outbound;
revoke all on function app.finder_warehouse_placement_before_outbound(uuid,text,jsonb)
  from public, anon, authenticated;

create function app.finder_warehouse_placement(p_brand_id uuid,p_action text,p_request jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_op app.finder_warehouse_placement_operations;
  v_set public.warehouse_inventory_sets;
  v_position public.warehouse_stock_positions;
  v_box public.warehouse_boxes;
  v_location text;
  v_qr text;
  v_codes jsonb;
  v_request jsonb;
  v_clear jsonb := '[]';
  v_entry jsonb;
  v_plan jsonb;
  v_result jsonb;
  v_existing integer := 0;
  v_units integer;
  v_zone text := p_request->>'zone';
begin
  if p_action not in ('outbound_pending','outbound_prepare','outbound_finish','outbound_cancel') then
    -- An ordinary placement retry must not consume a pending outbound plan.
    if p_action = 'prepare' and p_request->>'mode' = 'resume' and exists (
      select 1 from app.finder_warehouse_placement_operations
      where brand_id = p_brand_id and actor_id = v_actor and request->>'mode' = 'outbound'
        and finished_at is null and cancelled_at is null
    ) then
      raise exception '출고 화면에서 같은 박스 목록으로 저장을 다시 시도해주세요.';
    end if;
    if p_action in ('finish','cancel') and exists (
      select 1 from app.finder_warehouse_placement_operations
      where brand_id = p_brand_id and actor_id = v_actor and request->>'mode' = 'outbound'
        and id = (p_request->>'operationId')::uuid
    ) then
      raise exception '출고 화면에서 작업을 완료해주세요.';
    end if;
    return app.finder_warehouse_placement_before_outbound(p_brand_id,p_action,p_request);
  end if;

  if v_actor is null or not coalesce(app.can_use_masma_finder_feature(p_brand_id,'test'),false)
    or app.has_masma_finder_sheet_write_key() is not true then
    raise exception 'Finder 창고 작업 권한이 필요합니다.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('finder-placement/' || p_brand_id::text,0));

  if p_action = 'outbound_pending' then
    select * into v_op from app.finder_warehouse_placement_operations
    where brand_id = p_brand_id and actor_id = v_actor and request->>'mode' = 'outbound'
      and finished_at is null and cancelled_at is null;
    return jsonb_build_object('pending', case when found then v_op.request end);
  end if;

  if p_action in ('outbound_finish','outbound_cancel') then
    select * into strict v_op from app.finder_warehouse_placement_operations
    where brand_id = p_brand_id and actor_id = v_actor and request->>'mode' = 'outbound'
      and id = (p_request->>'operationId')::uuid for update;
    if v_op.finished_at is not null then return v_op.plan->'result'; end if;
    if v_op.cancelled_at is not null then raise exception '이미 취소된 출고입니다.'; end if;
    if p_action = 'outbound_cancel' then
      update app.finder_warehouse_placement_operations set cancelled_at = clock_timestamp() where id = v_op.id;
      return jsonb_build_object('status','cancelled');
    end if;
  end if;

  select * into strict v_set from public.warehouse_inventory_sets
  where brand_id = p_brand_id and kind = 'sandbox' and status = 'active' for update;

  if p_action = 'outbound_prepare' then
    if v_zone is null or v_zone not in ('parcel_pack','bulk_out')
      or jsonb_typeof(p_request->'qrs') is distinct from 'array' then
      raise exception '출고 구역과 박스 QR을 확인해주세요.' using errcode = '22023';
    end if;
    if jsonb_array_length(p_request->'qrs') not between 1 and 50 or exists (
      select 1 from jsonb_array_elements(p_request->'qrs') q
      where jsonb_typeof(q) <> 'string' or length(btrim(q #>> '{}')) not between 1 and 200
    ) then
      raise exception '박스 QR은 한 번에 1~50개를 등록할 수 있습니다.' using errcode = '22023';
    end if;
    select jsonb_agg(q order by q) into v_codes
    from (select distinct upper(btrim(value)) q from jsonb_array_elements_text(p_request->'qrs')) codes;
    v_request := jsonb_build_object('mode','outbound','zone',v_zone,'qrs',v_codes);
    select * into v_op from app.finder_warehouse_placement_operations
    where brand_id = p_brand_id and finished_at is null and cancelled_at is null;
    if found then
      if v_op.actor_id = v_actor and v_op.request = v_request then
        return jsonb_build_object('status','prepared','operationId',v_op.id,'plan',v_op.plan);
      end if;
      raise exception '앞선 창고 작업의 저장 확인이 남아 있습니다. 같은 작업을 먼저 완료해주세요.';
    end if;
    for v_qr in select value from jsonb_array_elements_text(v_codes) loop
      select * into v_box from public.warehouse_boxes
      where brand_id = p_brand_id and display_code = v_qr for update;
      if v_box.completion_kind = 'box_outbound' and v_box.completed_at is not null then
        v_existing := v_existing + 1;
        continue;
      end if;
      if v_box.archived_at is not null or v_box.completed_at is not null or v_box.presumed_depleted_at is not null then
        raise exception '출고할 수 없는 박스입니다. QR %', v_qr;
      end if;
      select p.* into v_position from public.warehouse_stock_positions p
      where p.set_id = v_set.id and p.brand_id = p_brand_id and p.box_qr is not null and upper(p.box_qr) = v_qr
      and app.warehouse_qr_audit_is_active(p)
      order by p.id limit 1 for update;
      if not found then raise exception '현재 재고에 연결된 박스를 찾을 수 없습니다. QR %', v_qr; end if;
      if v_position.quantity_status is distinct from 'known' or v_position.units_per_box is null
        or not coalesce(((v_position.remaining_boxes = 1 and v_position.opened_units = 0)
          or (coalesce(v_position.remaining_boxes,0) = 0 and v_position.opened_units > 0)),false)
        or nullif(btrim(v_position.external_row_id),'') is null or exists (
          select 1 from public.warehouse_stock_positions p where p.set_id = v_set.id
            and p.id <> v_position.id and (upper(p.box_qr) = v_qr or p.external_row_id = v_position.external_row_id)
        ) then
        raise exception '한 박스의 수량과 창고입력 행을 확인해주세요. QR %', v_qr;
      end if;
      if v_box.id is null and v_position.style_id is null then
        raise exception '출고할 박스의 상품을 확인해주세요. QR %', v_qr;
      end if;
      if exists (select 1 from public.warehouse_stock_condition_links c
        where c.brand_id = p_brand_id and c.external_row_id = v_position.external_row_id
          and c.source_product_name = v_position.source_product_name) then
        raise exception '판매 불가 상태의 박스입니다. QR %', v_qr;
      end if;
      select code into strict v_location from public.warehouse_locations where id = v_position.location_id;
      perform app.assert_warehouse_qr_audit_sheet_ready(p_brand_id,v_location,v_qr,v_position.external_row_id);
      if exists (select 1 from app.finder_warehouse_sheet_exports
        where brand_id = p_brand_id and sheet_row_id = v_position.external_row_id and sheet_synced_at is null)
        or exists (select 1 from app.warehouse_stock_condition_exports
        where brand_id = p_brand_id and external_row_id = v_position.external_row_id and sheet_synced_at is null) then
        raise exception '이 박스의 창고입력 반영이 대기 중입니다. QR %', v_qr;
      end if;
      v_clear := v_clear || jsonb_build_array(jsonb_build_object('row',to_jsonb(v_position),'place',v_location));
    end loop;
    v_result := jsonb_build_object('status','outbound_saved','shipped',jsonb_array_length(v_clear),'alreadyShipped',v_existing);
    if v_clear = '[]'::jsonb then return v_result; end if;
    v_plan := jsonb_build_object('mode','clear','outbound',true,'clear',v_clear,'result',v_result);
    insert into app.finder_warehouse_placement_operations (brand_id,actor_id,request,plan)
    values (p_brand_id,v_actor,v_request,v_plan) returning * into v_op;
    return jsonb_build_object('status','prepared','operationId',v_op.id,'plan',v_plan);
  end if;

  for v_entry in select value from jsonb_array_elements(v_op.plan->'clear') loop
    select * into strict v_position from public.warehouse_stock_positions
    where id = (v_entry->'row'->>'id')::uuid and brand_id = p_brand_id and set_id = v_set.id for update;
    if to_jsonb(v_position) is distinct from v_entry->'row' then
      raise exception '출고 중 재고가 변경됐습니다. QR %', v_position.box_qr;
    end if;
    v_qr := upper(v_position.box_qr);
    v_units := coalesce(nullif(v_position.opened_units,0),v_position.units_per_box);
    select * into v_box from public.warehouse_boxes
    where brand_id = p_brand_id and display_code = v_qr for update;
    if v_box.id is null then
      perform app.sync_warehouse_qr_audit_box(v_position,v_position.style_id,v_actor);
      select * into strict v_box from public.warehouse_boxes
      where brand_id = p_brand_id and display_code = v_qr for update;
    end if;
    if v_box.completed_at is not null or v_box.archived_at is not null or v_box.presumed_depleted_at is not null then
      raise exception '출고 중 박스 상태가 변경됐습니다. QR %', v_qr;
    end if;
    update public.warehouse_boxes set current_qty = 0, completed_at = clock_timestamp(),
      completed_by = v_actor, completion_kind = 'box_outbound', source_position_id = null
    where id = v_box.id;
    perform app.insert_warehouse_box_movement(p_brand_id,v_box.id,'box_outbound',
      v_position.location_id,null,v_units,0,
      case v_op.request->>'zone' when 'parcel_pack' then '택배포장 출고 확정' else '대량출고 확정' end);
    insert into public.warehouse_stock_movements
      (brand_id,set_id,action,position_id,style_id,from_location_code,box_count,unit_count,reason,actor_id)
    values (p_brand_id,v_set.id,'deplete',v_position.id,v_position.style_id,v_entry->>'place',1,v_units,
      concat_ws(' · ','박스 출고 확정',v_qr),v_actor);
    delete from app.finder_warehouse_presumed_boxes where brand_id = p_brand_id and box_qr = v_qr;
    delete from public.warehouse_stock_positions where id = v_position.id;
  end loop;
  update public.warehouse_inventory_sets set row_count = (
    select count(*) from public.warehouse_stock_positions where set_id = v_set.id
  ), updated_at = now() where id = v_set.id;
  update app.finder_warehouse_placement_operations set finished_at = clock_timestamp() where id = v_op.id;
  return v_op.plan->'result';
end;
$$;

revoke all on function app.finder_warehouse_placement(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function app.finder_warehouse_placement(uuid,text,jsonb) to authenticated;
create or replace function public.finder_warehouse_placement(p_brand_id uuid,p_action text,p_request jsonb)
returns jsonb language sql security invoker set search_path = ''
as $$ select app.finder_warehouse_placement(p_brand_id,p_action,p_request) $$;
