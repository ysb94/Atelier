-- Finder completes against Atelier's database. Sheet delivery uses the existing
-- ordered/coalescing Atelier outbox. Install dark; enable only after rollback tests.
create table app.finder_warehouse_db_settings (
  brand_id uuid primary key references public.brands(id),
  enabled_at timestamptz not null default clock_timestamp()
);
alter table app.finder_warehouse_db_settings enable row level security;
revoke all on app.finder_warehouse_db_settings from public, anon, authenticated, service_role;

create function app.finder_warehouse_db_first(p_brand_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select app.atelier_stock_sheet_enabled(p_brand_id) and exists (
    select 1 from app.finder_warehouse_db_settings where brand_id = p_brand_id
  );
$$;

create function app.assert_finder_stock_ready(
  p_brand_id uuid, p_place text, p_qr text default null, p_row_id text default null
)
returns void language plpgsql set search_path = '' as $$
begin
  if app.finder_warehouse_db_first(p_brand_id) then
    perform app.assert_atelier_stock_sheet_ready(p_brand_id,p_place,p_qr,p_row_id);
  else
    perform app.assert_warehouse_qr_audit_sheet_ready(p_brand_id,p_place,p_qr,p_row_id);
  end if;
end;
$$;

-- Preserve validation, permissions, collision checks and transaction locking.
-- Only managed asynchronous exports stop blocking subsequent warehouse actions.
do $migration$
declare v_rule record; v_def text;
begin
  for v_rule in select * from (values
    ('app.finder_warehouse_placement_before_outbound(uuid,text,jsonb)',
      'app.assert_warehouse_qr_audit_sheet_ready(', 'app.assert_finder_stock_ready(', 1),
    ('app.finder_warehouse_placement_before_unplaced_links(uuid,text,jsonb)',
      'app.assert_warehouse_qr_audit_sheet_ready(', 'app.assert_finder_stock_ready(', 1),
    ('app.finder_warehouse_placement_before_unplaced_links(uuid,text,jsonb)',
      'external_row_id = v_position.external_row_id and sheet_synced_at is null)',
      'external_row_id = v_position.external_row_id and sheet_synced_at is null and (not app.finder_warehouse_db_first(p_brand_id) or not atelier_managed))', 1),
    ('app.finder_warehouse_qr_audit(uuid,text,jsonb)',
      'app.assert_warehouse_qr_audit_sheet_ready(', 'app.assert_finder_stock_ready(', 2),
    ('app.finder_warehouse_qr_audit(uuid,text,jsonb)',
      '(id,brand_id,whole_place,before_rows,after_rows)',
      '(id,brand_id,whole_place,before_rows,after_rows,atelier_review)', 1),
    ('app.finder_warehouse_qr_audit(uuid,text,jsonb)',
      'values (v_id,p_brand_id,v_audit.place,v_before,v_after);',
      'values (v_id,p_brand_id,v_audit.place,v_before,v_after,app.finder_warehouse_db_first(p_brand_id));', 1),
    ('app.finder_warehouse_qr_audit_db(uuid,text,jsonb)',
      'app.warehouse_stock_condition_exports where brand_id = p_brand_id and sheet_synced_at is null)',
      'app.warehouse_stock_condition_exports where brand_id = p_brand_id and sheet_synced_at is null and (not app.finder_warehouse_db_first(p_brand_id) or not atelier_managed))', 1),
    ('app.finder_place_named_qr(uuid,text,text,date,integer)',
      'app.assert_warehouse_qr_audit_sheet_ready(', 'app.assert_finder_stock_ready(', 1),
    ('app.finder_place_named_qr(uuid,text,text,date,integer)',
      '(id, brand_id, before_rows, after_rows, stock_actor_id, stock_request)',
      '(id, brand_id, before_rows, after_rows, stock_actor_id, stock_request, atelier_review)', 1),
    ('app.finder_place_named_qr(uuid,text,text,date,integer)',
      'v_actor, v_request);', 'v_actor, v_request, app.finder_warehouse_db_first(p_brand_id));', 1)
  ) as rules(signature,old_text,new_text,expected) loop
    v_def := pg_get_functiondef(v_rule.signature::regprocedure);
    if (length(v_def)-length(replace(v_def,v_rule.old_text,'')))/length(v_rule.old_text) <> v_rule.expected then
      raise exception 'Unexpected Finder definition: %',v_rule.signature;
    end if;
    execute replace(v_def,v_rule.old_text,v_rule.new_text);
  end loop;
end;
$migration$;

alter function app.finder_warehouse_placement(uuid,text,jsonb) rename to finder_warehouse_placement_before_db_first;

create function app.finish_finder_stock_db(p_brand_id uuid,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_op app.finder_warehouse_placement_operations;
  v_set public.warehouse_inventory_sets;
  v_p public.warehouse_stock_positions;
  v_expected public.warehouse_stock_positions;
  v_item jsonb;
  v_before jsonb := '[]';
  v_after jsonb := '[]';
  v_rows jsonb;
  v_result jsonb;
  v_row_number integer;
begin
  if auth.uid() is null or not coalesce(app.can_use_masma_finder_feature(p_brand_id,'test'),false)
    or app.has_masma_finder_sheet_write_key() is not true then
    raise exception 'Finder 창고 작업 권한이 필요합니다.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('finder-placement/' || p_brand_id::text,0));
  select * into strict v_op from app.finder_warehouse_placement_operations
  where id=p_operation_id and brand_id=p_brand_id and actor_id=auth.uid() for update;
  if v_op.finished_at is not null then return v_op.plan->'result'; end if;
  if v_op.cancelled_at is not null then raise exception '이미 취소된 작업입니다.'; end if;
  select * into strict v_set from public.warehouse_inventory_sets
  where brand_id=p_brand_id and kind='sandbox' and status='active' for update;

  v_rows := coalesce(v_op.plan->'clear','[]'::jsonb);
  if nullif(v_op.plan->'write'->'source','null'::jsonb) is not null then
    v_rows := v_rows || jsonb_build_array(v_op.plan->'write'->'source');
  end if;
  for v_item in select value from jsonb_array_elements(v_rows) loop
    v_expected := jsonb_populate_record(null::public.warehouse_stock_positions,v_item->'row');
    select * into v_p from public.warehouse_stock_positions
    where set_id=v_set.id and external_row_id=v_expected.external_row_id for update;
    -- Old sheet-path retries must not overwrite a stock edit made since prepare.
    -- Import-generated row identities and timestamps are not stock values.
    if not found or
      (to_jsonb(v_p)-array['id','set_id','created_at','updated_at','source_row_number']) is distinct from
      (to_jsonb(v_expected)-array['id','set_id','created_at','updated_at','source_row_number']) then
      raise exception '재고가 바뀌었습니다. 현재 자리와 수량을 다시 확인해주세요.' using errcode='40001';
    end if;
    v_before := v_before || jsonb_build_array(app.warehouse_stock_work_sheet_row(v_p,v_item->>'place'));
  end loop;

  -- source_row_number is a display sort key for app-created stock until import.
  -- It is deliberately not a claim that a physical sheet row has been written.
  v_row_number := coalesce((v_op.plan->'write'->'source'->'row'->>'source_row_number')::integer,
    900000+(extract(epoch from now())::bigint % 100000)::integer);
  v_result := app.finder_warehouse_placement_before_db_first(p_brand_id,
    case when v_op.request->>'mode'='outbound' then 'outbound_finish' else 'finish' end,
    jsonb_build_object('operationId',v_op.id,'rowNumber',v_row_number));
  if v_op.plan ? 'write' then
    select * into strict v_p from public.warehouse_stock_positions
    where set_id=v_set.id and external_row_id=v_op.plan->'write'->>'docId';
    v_after := jsonb_build_array(app.warehouse_stock_work_sheet_row(v_p,v_op.plan->'write'->>'place'));
  end if;
  insert into app.warehouse_qr_audit_sheet_exports
    (id,brand_id,before_rows,after_rows,atelier_review,stock_actor_id,stock_request)
  values (v_op.id,p_brand_id,v_before,v_after,true,auth.uid(),
    jsonb_build_object('action','finder','operationId',v_op.id));
  v_result := v_result || jsonb_build_object('storage','supabase','sheetPending',true,'operationId',v_op.id);
  update app.finder_warehouse_placement_operations set plan=jsonb_set(plan,'{result}',v_result) where id=v_op.id;
  return v_result;
end;
$$;

create function app.finder_warehouse_placement(p_brand_id uuid,p_action text,p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if not app.finder_warehouse_db_first(p_brand_id) then
    return app.finder_warehouse_placement_before_db_first(p_brand_id,p_action,p_request);
  end if;
  if p_action in ('finish','outbound_finish') then
    return app.finish_finder_stock_db(p_brand_id,(p_request->>'operationId')::uuid);
  end if;
  v_result := app.finder_warehouse_placement_before_db_first(p_brand_id,p_action,p_request);
  if p_action in ('prepare','outbound_prepare') and v_result->>'status'='prepared' then
    return app.finish_finder_stock_db(p_brand_id,(v_result->>'operationId')::uuid);
  end if;
  return v_result;
end;
$$;

alter function public.run_finder_cargo_background(uuid,uuid,text,jsonb) rename to run_finder_cargo_before_db_first;
create function public.run_finder_cargo_background(p_brand_id uuid,p_actor_id uuid,p_action text,p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_prepared jsonb; v_result jsonb; v_numbers jsonb; v_after jsonb;
begin
  if not app.finder_warehouse_db_first(p_brand_id) or p_action<>'cargo-location-prepare' then
    return public.run_finder_cargo_before_db_first(p_brand_id,p_actor_id,p_action,p_request);
  end if;
  -- Original entry point validates service role, write key, actor, shipment and quantities.
  v_prepared := public.run_finder_cargo_before_audit_sheet(p_brand_id,p_actor_id,p_action,p_request);
  if v_prepared->>'status'='saved' then return v_prepared; end if;
  perform app.assert_finder_stock_ready(p_brand_id,p_request->>'place');
  select jsonb_object_agg(r->>'docId',900000+ord) into v_numbers
    from jsonb_array_elements(v_prepared->'rows') with ordinality as x(r,ord);
  v_result := public.run_finder_cargo_before_audit_sheet(p_brand_id,p_actor_id,'cargo-location-finish',
    jsonb_build_object('receiptId',p_request->>'receiptId','rowNumbers',v_numbers));
  select jsonb_agg(app.warehouse_stock_work_sheet_row(p,l.code) order by p.external_row_id) into v_after
  from public.warehouse_stock_positions p join public.warehouse_locations l on l.id=p.location_id
  join public.warehouse_inventory_sets s on s.id=p.set_id and s.kind='sandbox' and s.status='active'
  where p.brand_id=p_brand_id and p.external_row_id in (
    select r->>'docId' from jsonb_array_elements(v_prepared->'rows') r);
  insert into app.warehouse_qr_audit_sheet_exports
    (id,brand_id,before_rows,after_rows,atelier_review,stock_actor_id,stock_request)
  values ((p_request->>'receiptId')::uuid,p_brand_id,'[]',v_after,true,p_actor_id,
    jsonb_build_object('action','finder-cargo'));
  return v_result || jsonb_build_object('storage','supabase','sheetPending',true);
end;
$$;

alter function app.prepare_masma_finder_inbound_sheet(uuid,text,jsonb) rename to prepare_masma_finder_inbound_before_db_first;
create function app.prepare_masma_finder_inbound_sheet(p_brand_id uuid,p_display_code text,p_registration jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb; v_box uuid; v_aa text; v_after jsonb;
begin
  if not app.finder_warehouse_db_first(p_brand_id) or p_registration is null then
    return app.prepare_masma_finder_inbound_before_db_first(p_brand_id,p_display_code,p_registration);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('finder-placement/' || p_brand_id::text,0));
  -- Retain the original authenticated QR registration and receipt deduplication.
  v_result := app.prepare_masma_finder_inbound_before_audit_sheet(p_brand_id,p_display_code,p_registration);
  if nullif(v_result->>'sheetRowId','') is not null then return v_result; end if;
  perform app.assert_finder_stock_ready(p_brand_id,p_registration->>'p_location_code',p_display_code);
  v_box := (v_result->>'boxId')::uuid;
  -- AA is an identity allocated by the database. Actual delivery is tracked only
  -- by the outbox's sheet_synced_at, never by the presence of this identity.
  v_aa := 'inb_' || replace(v_box::text,'-','');
  perform app.confirm_masma_finder_inbound_sheet(p_brand_id,v_box,v_aa);
  select jsonb_build_array(app.warehouse_stock_work_sheet_row(p,l.code)) into strict v_after
  from public.warehouse_stock_positions p join public.warehouse_locations l on l.id=p.location_id
  join public.warehouse_inventory_sets s on s.id=p.set_id and s.kind='sandbox' and s.status='active'
  where p.brand_id=p_brand_id and p.external_row_id=v_aa;
  insert into app.warehouse_qr_audit_sheet_exports
    (id,brand_id,before_rows,after_rows,atelier_review,stock_actor_id,stock_request)
  values (v_box,p_brand_id,'[]',v_after,true,auth.uid(),jsonb_build_object('action','finder-inbound'));
  return v_result || jsonb_build_object('sheetRowId',v_aa,'storage','supabase','sheetPending',true);
end;
$$;

-- The old pilot must defer to the now-universal transactional prepare path.
alter function public.run_finder_single_inbound_db_first(uuid,uuid,jsonb) rename to run_finder_single_inbound_before_db_first;
create function public.run_finder_single_inbound_db_first(p_brand_id uuid,p_actor_id uuid,p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if app.finder_warehouse_db_first(p_brand_id) then
    return jsonb_build_object('status','use_sheet'); -- compatibility: Worker calls generic prepare next
  end if;
  return public.run_finder_single_inbound_before_db_first(p_brand_id,p_actor_id,p_request);
end;
$$;

revoke all on function app.finder_warehouse_db_first(uuid), app.assert_finder_stock_ready(uuid,text,text,text),
  app.finder_warehouse_placement_before_db_first(uuid,text,jsonb), app.finish_finder_stock_db(uuid,uuid),
  app.finder_warehouse_placement(uuid,text,jsonb), app.prepare_masma_finder_inbound_before_db_first(uuid,text,jsonb),
  app.prepare_masma_finder_inbound_sheet(uuid,text,jsonb),
  public.run_finder_cargo_before_db_first(uuid,uuid,text,jsonb),
  public.run_finder_cargo_background(uuid,uuid,text,jsonb),
  public.run_finder_single_inbound_before_db_first(uuid,uuid,jsonb),
  public.run_finder_single_inbound_db_first(uuid,uuid,jsonb)
from public,anon,authenticated,service_role;
grant execute on function public.run_finder_cargo_background(uuid,uuid,text,jsonb),
  public.run_finder_single_inbound_db_first(uuid,uuid,jsonb) to service_role;
