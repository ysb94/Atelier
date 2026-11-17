-- Run with the migration runner (temporary function DDL is included).
-- Every fixture, flag, permission stub and stock mutation is rolled back by the
-- sentinel subtransaction. A failed assertion propagates and fails verification.
set local lock_timeout = '3s';
set local statement_timeout = '25s';
do $verify$
declare
  b uuid := 'b0000000-0000-4000-8000-000000000001';
  actor uuid;
  sid uuid;
  place_a text;
  place_b text;
  pick text;
  r jsonb;
  first_result jsonb;
  request jsonb;
  audit_request jsonb;
  reg jsonb;
  aa text;
  box_id uuid;
  row_id uuid;
  audit_id uuid := gen_random_uuid();
  shipment uuid := gen_random_uuid();
  line_id uuid := gen_random_uuid();
  receipt uuid := gen_random_uuid();
  job text := gen_random_uuid()::text || ':0';
  qr text := upper('VERIFY-DB-FIRST-' || gen_random_uuid()::text);
  count_before integer;
  result_count integer;
  key_definition text := pg_get_functiondef('app.has_masma_finder_sheet_write_key()'::regprocedure);
begin
  begin
    perform pg_advisory_xact_lock(hashtextextended('finder-placement/' || b::text,0));
    select auth_user_id into strict actor from public.masma_finder_users
      where brand_id=b and status='active' and (is_admin or can_use_test) order by is_admin desc limit 1;
    perform set_config('request.jwt.claim.sub',actor::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','service_role')::text,true);
    perform set_config('request.headers','{}',true);
    insert into app.finder_warehouse_db_settings(brand_id) values(b) on conflict do nothing;
    if not app.finder_warehouse_db_first(b) then raise exception 'DB-first flag is not active'; end if;
    -- A missing Worker key is still rejected before we stub only that key for SQL tests.
    begin
      perform app.finder_warehouse_placement(b,'prepare','{}');
      raise exception 'missing write key accepted';
    exception when insufficient_privilege then null;
    end;
    execute 'create or replace function app.has_masma_finder_sheet_write_key() returns boolean language sql stable set search_path='''' as ''select true''';
    perform set_config('request.headers','{"x-finder-write-key":"rollback-verification"}',true);
    -- Isolate rollback fixtures from live pending work. No live cancellation commits.
    update app.finder_warehouse_placement_operations set cancelled_at=clock_timestamp()
      where brand_id=b and finished_at is null and cancelled_at is null;
    select id into strict sid from public.warehouse_inventory_sets
      where brand_id=b and kind='sandbox' and status='active';
    select code into strict place_a from public.warehouse_registered_slots r
      join public.warehouse_inventory_sets s on s.warehouse_id=r.warehouse_id and s.id=sid
      where r.zone='box_storage' and not exists(select 1 from public.warehouse_stock_positions p
        join public.warehouse_locations l on l.id=p.location_id where p.set_id=sid and upper(l.code)=upper(r.code))
      order by code limit 1;
    select code into strict place_b from public.warehouse_registered_slots r
      join public.warehouse_inventory_sets s on s.warehouse_id=r.warehouse_id and s.id=sid
      where r.zone='box_storage' and r.code<>place_a and not exists(select 1 from public.warehouse_stock_positions p
        join public.warehouse_locations l on l.id=p.location_id where p.set_id=sid and upper(l.code)=upper(r.code))
      order by code limit 1;
    select code into strict pick from public.warehouse_registered_slots r
      join public.warehouse_inventory_sets s on s.warehouse_id=r.warehouse_id and s.id=sid
      where r.zone='picking' and not exists(select 1 from public.warehouse_stock_positions p
        join public.warehouse_locations l on l.id=p.location_id where p.set_id=sid and upper(l.code)=upper(r.code))
      order by code limit 1;

    request := jsonb_build_object('mode','place','place',place_a,'qr',qr,'number','M0641',
      'receivedOn','2026-11-17','quantity',12,'backgroundJobId',job);
    first_result := public.run_finder_warehouse_background(b,actor,'prepare',request);
    if first_result->>'status' is distinct from 'saved' or first_result->>'storage' is distinct from 'supabase' then
      raise exception 'receipt still waits for Sheets: %',first_result;
    end if;
    select external_row_id,id into strict aa,row_id from public.warehouse_stock_positions where set_id=sid and box_qr=qr;
    perform set_config('role','authenticated',true);
    r := public.finder_warehouse_placement(b,'read',jsonb_build_object('place',place_a,'qr',qr));
    if r->'box'->>'qr' is distinct from qr then raise exception 'authenticated public RPC cannot read DB receipt'; end if;
    r := public.prepare_masma_finder_inbound_sheet(b,null,null);
    perform set_config('role','postgres',true);
    if has_function_privilege('authenticated','app.finish_finder_stock_db(uuid,uuid)','execute')
      or has_function_privilege('anon','app.finder_warehouse_placement(uuid,text,jsonb)','execute') then
      raise exception 'private completion helper exposed';
    end if;
    if not exists(select 1 from app.warehouse_qr_audit_sheet_exports where id=(first_result->>'operationId')::uuid
      and atelier_managed and sheet_synced_at is null) then raise exception 'receipt outbox missing'; end if;
    if public.run_finder_warehouse_background(b,actor,'prepare',request) is distinct from first_result then
      raise exception 'background replay not idempotent'; end if;
    r := app.finder_warehouse_placement(b,'prepare',request-'backgroundJobId');
    if r->>'status'<>'already_registered' then raise exception 'duplicate QR not detected'; end if;

    r := app.finder_warehouse_placement(b,'prepare',jsonb_build_object('mode','place','place',place_b,'qr',qr));
    if r->>'status'<>'saved' then raise exception 'move waits for pending receipt'; end if;
    r := app.finder_warehouse_placement(b,'prepare',jsonb_build_object('mode','place','place',place_b,'qr',qr,'currentQty',9));
    if r->>'status'<>'saved' or not exists(select 1 from public.warehouse_stock_positions where set_id=sid and box_qr=qr and units_per_box=9)
      then raise exception 'quantity adjustment waits for pending move'; end if;

    -- QR audit also operates on the new DB row while its earlier exports remain pending.
    r := app.finder_warehouse_qr_audit(b,'place',jsonb_build_object('place',place_b));
    audit_request := jsonb_build_object('id',audit_id,'place',place_b,'baseline',r->>'baseline',
      'entries',jsonb_build_array(jsonb_build_object('qr',qr,'source_id',row_id,'units',9,'opened',true)));
    r := app.finder_warehouse_qr_audit(b,'preview',audit_request);
    r := app.finder_warehouse_qr_audit(b,'confirm',audit_request || jsonb_build_object('token',r->>'token'));
    if r->>'sheetPending'<>'true' or not exists(select 1 from app.warehouse_qr_audit_sheet_exports where id=audit_id and atelier_managed)
      then raise exception 'audit does not use managed outbox'; end if;
    r := app.finder_warehouse_placement(b,'prepare',jsonb_build_object('mode','place','place',pick,'qr',qr));
    if r->>'status'<>'saved' or not exists(select 1 from public.warehouse_stock_positions where set_id=sid and box_qr=qr and opened_units=9 and remaining_boxes=0)
      then raise exception 'opened box move lost quantity'; end if;

    -- Picking occupancy still requires the worker's explicit field confirmation.
    request := jsonb_build_object('mode','place','place',pick,'qr',qr || '-OTHER','number','M0641','receivedOn','2026-11-17','quantity',5);
    r := app.finder_warehouse_placement(b,'prepare',request);
    if r->>'status'<>'occupied' then raise exception 'picking collision not detected'; end if;
    r := app.finder_warehouse_placement(b,'prepare',request || jsonb_build_object('token',r->>'token'));
    if r->>'status'<>'saved' or exists(select 1 from public.warehouse_stock_positions where set_id=sid and box_qr=qr)
      or not exists(select 1 from app.finder_warehouse_presumed_boxes where brand_id=b and box_qr=qr)
      then raise exception 'confirmed replacement failed'; end if;
    r := app.finder_warehouse_placement(b,'outbound_prepare',jsonb_build_object('zone','parcel_pack','qrs',jsonb_build_array(qr || '-OTHER')));
    if r->>'status'<>'outbound_saved' or r->>'shipped'<>'1' then raise exception 'outbound waits for receipt'; end if;
    r := app.finder_warehouse_placement(b,'outbound_prepare',jsonb_build_object('zone','parcel_pack','qrs',jsonb_build_array(qr || '-OTHER')));
    if r->>'alreadyShipped'<>'1' then raise exception 'outbound retry duplicated'; end if;

    -- Legacy manual receipt compatibility returns a DB identity without a sheet call.
    reg := jsonb_build_object('p_location_code',place_a,'p_zone','box_storage','p_style_no','M0641',
      'p_received_on','2026-11-17','p_qty',7,'p_note','');
    r := app.prepare_masma_finder_inbound_sheet(b,qr || '-LEGACY',reg);
    box_id := (r->>'boxId')::uuid;
    if r->>'storage'<>'supabase' or not exists(select 1 from public.warehouse_stock_positions where set_id=sid and box_qr=qr || '-LEGACY')
      then raise exception 'legacy receipt did not publish stock'; end if;
    r := app.prepare_masma_finder_inbound_sheet(b,qr || '-LEGACY',reg);
    if (r->>'boxId')::uuid<>box_id then raise exception 'legacy receipt retry duplicated'; end if;

    -- Cargo grouped receipt creates every row and its outbox in the same transaction.
    insert into public.cargo_inbound_shipments(id,brand_id,shipment_no,stage,shipped_on,scheduled_inbound_on)
      values(shipment,b,'VERIFY-' || shipment,'scheduled','2026-11-17','2026-11-17');
    insert into public.cargo_inbound_lines(id,brand_id,shipment_id,source_row_no,source_style_no,style_id,product_name)
      select line_id,b,shipment,1,style_no,id,name from public.styles where brand_id=b and style_no='M0641';
    request := jsonb_build_object('receiptId',receipt,'lineId',line_id,'shipmentId',shipment,'place',place_a,
      'groups',jsonb_build_array(jsonb_build_object('quantity',10,'boxCount',2),jsonb_build_object('quantity',8,'boxCount',1)));
    r := public.run_finder_cargo_background(b,actor,'cargo-location-prepare',request);
    if r->>'status'<>'saved' or not exists(select 1 from public.cargo_inbound_receipts where receipt_id=receipt and received_at is not null)
      or (select jsonb_array_length(after_rows) from app.warehouse_qr_audit_sheet_exports where id=receipt)<>2
      then raise exception 'cargo still waits for Sheets'; end if;
    r := public.run_finder_cargo_background(b,actor,'cargo-location-prepare',request);
    if r->>'status'<>'saved' then raise exception 'cargo replay failed'; end if;

    -- Clear removes only the selected product, regardless of outstanding exports.
    r := app.finder_warehouse_placement(b,'read',jsonb_build_object('place',place_a));
    select item into request from jsonb_array_elements(r->'groups') item where item->>'number'='M0641';
    r := app.finder_warehouse_placement(b,'prepare',jsonb_build_object('mode','clear','place',place_a,
      'number','M0641','token',request->>'token'));
    if r->>'status'<>'saved' or app.finder_warehouse_placement_state(sid,place_a)<>'[]'::jsonb
      then raise exception 'clear failed while exports pending'; end if;

    -- Wrong actors and malformed tokens cannot use the new private completion path.
    perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',auth.uid(),'role','authenticated')::text,true);
    begin
      perform app.finish_finder_stock_db(b,(first_result->>'operationId')::uuid);
      raise exception 'unauthorized actor accepted';
    exception when insufficient_privilege then null;
    end;
    perform set_config('request.jwt.claim.sub',actor::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','service_role')::text,true);
    if exists(select 1 from app.finder_warehouse_placement_operations o where brand_id=b and o.request->>'qr' like qr || '%'
      and finished_at is null and cancelled_at is null) then raise exception 'unfinished DB operation left behind'; end if;

    -- Claim the fixture exports only; ensure receipt/move/clear collapse to the final state.
    update app.atelier_stock_sheet_events set completed_at=clock_timestamp()
      where brand_id=b and not exists(select 1 from jsonb_array_elements(before_rows || after_rows) x where x->>'qr' like qr || '%')
      and source_id<>receipt;
    update app.atelier_stock_sheet_jobs set completed_at=clock_timestamp() where brand_id=b and completed_at is null;
    r := public.claim_atelier_stock_sheet_jobs(b,10);
    if jsonb_array_length(r->'jobs')<1 then raise exception 'no async delivery jobs claimed'; end if;
    if exists(select 1 from jsonb_array_elements(r->'jobs') j cross join lateral jsonb_array_elements(j->'after') x
      where x->>'qr' like qr || '%') then raise exception 'sheet export resurrects a cleared/outbound box'; end if;
    r := app.finder_warehouse_qr_audit(b,'place',jsonb_build_object('place',place_b));
    audit_request := jsonb_build_object('id',gen_random_uuid(),'place',place_b,'baseline',r->>'baseline','entries','[]'::jsonb);
    r := app.finder_warehouse_qr_audit(b,'preview',audit_request);
    r := app.finder_warehouse_qr_audit(b,'confirm',audit_request || jsonb_build_object('token',r->>'token'));
    if r->>'sheetPending' is distinct from 'false' then raise exception 'empty audit created a delivery'; end if;
    result_count := 19;
    raise exception using errcode='ZX001',message='rollback verification fixtures';
  exception when sqlstate 'ZX001' then null;
  end;
  if pg_get_functiondef('app.has_masma_finder_sheet_write_key()'::regprocedure) is distinct from key_definition
    then raise exception 'write-key guard was not restored'; end if;
  if exists(select 1 from public.warehouse_boxes where brand_id=b and display_code like qr || '%')
    then raise exception 'verification rows survived rollback'; end if;
  raise notice 'Finder DB-first verification passed: % scenarios, no committed stock changes',result_count;
end;
$verify$;
