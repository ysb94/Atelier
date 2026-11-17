-- Administrative recovery of pre-cutover, quantity-preserving moves only.
-- All source values and the empty destination must still match the recorded request.
set local lock_timeout='3s';
do $recover$
declare
  v_op app.finder_warehouse_placement_operations;
  v_set public.warehouse_inventory_sets;
  v_p public.warehouse_stock_positions;
  v_box public.warehouse_boxes;
  v_slot public.warehouse_registered_slots;
  v_before jsonb;
  v_location uuid;
  v_result jsonb;
begin
  for v_op in
    select o.* from app.finder_warehouse_placement_operations o
    join app.finder_warehouse_db_settings enabled on enabled.brand_id=o.brand_id and o.created_at<enabled.enabled_at
    where o.finished_at is null and o.cancelled_at is null and o.request->>'mode'='place'
      and o.plan->'clear'='[]'::jsonb and nullif(o.plan->'write'->'source','null'::jsonb) is not null
      and o.plan->'write'->'source'->>'place' is distinct from o.plan->'write'->>'place'
    for update of o
  loop
    perform pg_advisory_xact_lock(hashtextextended('finder-placement/' || v_op.brand_id::text,0));
    select * into strict v_set from public.warehouse_inventory_sets
      where brand_id=v_op.brand_id and kind='sandbox' and status='active' for update;
    select * into strict v_p from public.warehouse_stock_positions
      where set_id=v_set.id and external_row_id=v_op.plan->'write'->>'docId' for update;
    if (to_jsonb(v_p)-array['id','set_id','created_at','updated_at','source_row_number']) is distinct from
      ((v_op.plan->'write'->'source'->'row')-array['id','set_id','created_at','updated_at','source_row_number'])
      or v_p.opened_units<>0 or v_p.remaining_boxes<>1
      or v_p.units_per_box is distinct from (v_op.plan->'write'->>'quantity')::integer then
      raise exception 'Pending move source changed: %',v_op.id;
    end if;
    select * into strict v_box from public.warehouse_boxes
      where brand_id=v_op.brand_id and display_code=v_op.plan->'write'->>'qr' for update;
    if v_box.completed_at is not null or v_box.archived_at is not null or v_box.presumed_depleted_at is not null
      or v_box.current_qty is distinct from v_p.units_per_box
      or v_box.initial_qty is distinct from v_p.units_per_box or v_box.location_id is distinct from v_p.location_id then
      raise exception 'Pending move box changed: %',v_op.id;
    end if;
    select * into strict v_slot from public.warehouse_registered_slots
      where warehouse_id=v_set.warehouse_id and upper(code)=upper(v_op.plan->'write'->>'place');
    if v_slot.zone is distinct from v_op.plan->'write'->>'zone'
      or app.finder_warehouse_placement_state(v_set.id,v_slot.code)<>'[]'::jsonb then
      raise exception 'Pending move destination changed: %',v_op.id;
    end if;
    if not exists(select 1 from public.masma_finder_users where brand_id=v_op.brand_id
      and auth_user_id=v_op.actor_id and status='active' and (is_admin or can_use_test)) then
      raise exception 'Pending move actor no longer authorized';
    end if;
    perform set_config('request.jwt.claim.sub',v_op.actor_id::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',v_op.actor_id,'role','authenticated')::text,true);
    v_before := app.warehouse_stock_work_sheet_row(v_p,v_op.plan->'write'->'source'->>'place');
    v_location := app.ensure_warehouse_box_location(v_op.brand_id,v_slot.code,v_slot.zone);
    update public.warehouse_stock_positions set location_id=v_location,is_final_location=false,updated_at=now()
      where id=v_p.id returning * into v_p;
    update public.warehouse_boxes set location_id=v_location,updated_at=now() where id=v_box.id;
    insert into public.warehouse_stock_movements
      (brand_id,set_id,action,style_id,from_location_code,to_location_code,box_count,unit_count,reason,actor_id)
    values(v_op.brand_id,v_set.id,'move',v_p.style_id,v_op.plan->'write'->'source'->>'place',v_slot.code,
      1,v_p.units_per_box,concat_ws(' · ',v_op.plan->'write'->>'reason',v_box.display_code),v_op.actor_id);
    insert into app.warehouse_qr_audit_sheet_exports
      (id,brand_id,before_rows,after_rows,atelier_review,stock_actor_id,stock_request)
    values(v_op.id,v_op.brand_id,jsonb_build_array(v_before),
      jsonb_build_array(app.warehouse_stock_work_sheet_row(v_p,v_slot.code)),true,v_op.actor_id,
      jsonb_build_object('action','finder','operationId',v_op.id,'recovered',true));
    v_result := v_op.plan->'result' || jsonb_build_object('storage','supabase','sheetPending',true,'operationId',v_op.id);
    update app.finder_warehouse_placement_operations set finished_at=clock_timestamp(),plan=jsonb_set(plan,'{result}',v_result)
      where id=v_op.id and finished_at is null and cancelled_at is null;
    update public.warehouse_inventory_sets set updated_at=now() where id=v_set.id;
  end loop;
end;
$recover$;
