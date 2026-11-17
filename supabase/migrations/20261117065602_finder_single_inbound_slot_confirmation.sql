-- Confirm the full picking slot, independently of the token for a product-level "없음".
-- Sheet imports may recreate row IDs or change display order without changing the stock.
create function app.finder_picking_slot_token(p_rows jsonb)
returns text language sql immutable set search_path = ''
as $$
  select md5(coalesce(jsonb_agg(
    item || jsonb_build_object('row', (item->'row') - array['id','set_id','created_at','updated_at','source_row_number'])
    order by ord), '[]'::jsonb)::text)
  from jsonb_array_elements(p_rows) with ordinality as e(item, ord);
$$;

revoke all on function app.finder_picking_slot_token(jsonb) from public, anon, authenticated, service_role;

do $migration$
declare
  v_def text := pg_get_functiondef('app.finder_warehouse_placement_before_audit_sheet(uuid,text,jsonb)'::regprocedure);
  v_read text := $old$return jsonb_build_object('zone', v_zone, 'groups', v_groups,$old$;
  v_match text := $old$if v_clear <> '[]'::jsonb and p_request->>'token' is distinct from v_occupants then$old$;
begin
  if strpos(v_def, v_read) = 0 or strpos(v_def, v_match) = 0 then
    raise exception 'Unexpected Finder placement confirmation definition';
  end if;
  v_def := replace(v_def, v_read, $new$return jsonb_build_object('zone', v_zone, 'groups', v_groups,
      'slotToken', case when v_zone = 'picking' and v_rows <> '[]'::jsonb then app.finder_picking_slot_token(v_rows) end,$new$);
  -- Retain the original matching token for existing clients and retries.
  v_def := replace(v_def, v_match, $new$if v_clear <> '[]'::jsonb and p_request->>'token' is distinct from v_occupants
        and p_request->>'token' is distinct from app.finder_picking_slot_token(v_clear)
        and p_request->>'token' is distinct from app.finder_picking_slot_token(v_rows) then$new$);
  execute v_def;
end;
$migration$;

-- The caller holds the Finder advisory lock and the stock table lock and has
-- checked the slot token. Clear exactly those rows in the same transaction as
-- receiving the QR, and return the old AA rows for the same sheet export.
create function app.clear_finder_confirmed_picking_slot(p_brand_id uuid, p_set_id uuid, p_actor uuid, p_rows jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_item jsonb;
  v_pos public.warehouse_stock_positions;
  v_qr text;
  v_before jsonb := '[]'::jsonb;
begin
  for v_item in select value from jsonb_array_elements(p_rows) loop
    select * into strict v_pos from public.warehouse_stock_positions
    where brand_id = p_brand_id and set_id = p_set_id and id = (v_item->'row'->>'id')::uuid;
    if nullif(v_pos.external_row_id, '') is null then
      raise exception '창고입력 AA 행 ID가 없는 재고가 있습니다. 시트 동기화 후 다시 시도해주세요.' using errcode = '22023';
    end if;
    v_qr := nullif(v_item->'row'->>'box_qr', '');
    v_before := v_before || jsonb_build_array(app.warehouse_stock_work_sheet_row(v_pos, v_item->>'place'));
    if v_qr is not null then
      insert into app.finder_warehouse_presumed_boxes (brand_id, box_qr, snapshot)
      values (p_brand_id, upper(v_qr), v_item)
      on conflict (brand_id, box_qr) do update set snapshot = excluded.snapshot;
    end if;
    -- Detach the source pointer before deleting the position, including closed
    -- boxes whose FK would otherwise try to null their brand.
    update public.warehouse_boxes set source_position_id = null
    where brand_id = p_brand_id and source_position_id = v_pos.id
      and (archived_at is not null or completed_at is not null or presumed_depleted_at is not null);
    update public.warehouse_boxes
    set source_position_id = null, location_id = null, presumed_depleted_at = clock_timestamp()
    where brand_id = p_brand_id and archived_at is null and completed_at is null and presumed_depleted_at is null
      and (source_position_id = v_pos.id or display_code = upper(v_qr));
    insert into public.warehouse_stock_movements
      (brand_id, set_id, action, style_id, from_location_code, box_count, reason, actor_id)
    values (p_brand_id, p_set_id, 'adjust', v_pos.style_id, v_item->>'place', 0,
      concat_ws(' · ', '출고로 소진 추정', v_qr), p_actor);
    delete from public.warehouse_stock_positions
    where brand_id = p_brand_id and set_id = p_set_id and id = v_pos.id;
  end loop;
  return v_before;
end;
$$;

revoke all on function app.clear_finder_confirmed_picking_slot(uuid,uuid,uuid,jsonb)
from public, anon, authenticated, service_role;

-- The confirmation-aware overloads share the existing intake logic and keep
-- the old signatures working for clients that have not been updated yet.
do $migration$
declare
  v_path record;
  v_def text;
  v_guard text;
  v_context constant text := 'insert into app.warehouse_qr_audit_writes values (p_brand_id, pg_current_xact_id());';
  v_count constant text := 'set row_count = row_count + 1 where id = v_set.id;';
  v_export constant text := $old$values (v_link.id, p_brand_id, '[]'::jsonb,$old$;
begin
  for v_path in select * from (values
    ('app.finder_place_photo_qr(uuid,text,text)', 'p_place text)'),
    ('app.finder_place_named_qr(uuid,text,text,date,integer)', 'p_qty integer)')
  ) as t(signature, last_argument) loop
    v_def := pg_get_functiondef(v_path.signature::regprocedure);
    v_guard := substring(v_def from $rx$if v_slot\.zone = 'picking' and exists \([^;]+; end if;$rx$);
    if v_guard is null or strpos(v_def, v_path.last_argument) = 0 or strpos(v_def, v_context) = 0
      or strpos(v_def, v_count) = 0 or strpos(v_def, v_export) = 0 then
      raise exception 'Unexpected Finder QR intake definition: %', v_path.signature;
    end if;
    execute replace(replace(replace(replace(replace(replace(v_def,
      v_path.last_argument, left(v_path.last_argument, -1) || ', p_empty_slot_token text)'),
      '  v_location_id uuid;', $new$  v_location_id uuid;
  v_picking_rows jsonb := '[]'::jsonb;
  v_slot_token text;
  v_before jsonb := '[]'::jsonb;$new$),
      v_guard, $new$if v_slot.zone = 'picking' then
    v_picking_rows := app.finder_warehouse_placement_state(v_set.id, v_place);
    if v_picking_rows <> '[]'::jsonb then
      v_slot_token := app.finder_picking_slot_token(v_picking_rows);
      if p_empty_slot_token is distinct from v_slot_token then
        return jsonb_build_object('status', 'occupied', 'token', v_slot_token);
      end if;
    end if;
  end if;$new$),
      v_context, v_context || $new$
  v_before := app.clear_finder_confirmed_picking_slot(p_brand_id, v_set.id, v_actor, v_picking_rows);$new$),
      v_count, 'set row_count = row_count + 1 - jsonb_array_length(v_before) where id = v_set.id;'),
      v_export, 'values (v_link.id, p_brand_id, v_before,');
  end loop;
end;
$migration$;

create function public.finder_place_photo_qr(p_brand_id uuid, p_qr text, p_place text, p_empty_slot_token text)
returns jsonb language sql security invoker set search_path = ''
as $$ select app.finder_place_photo_qr(p_brand_id, p_qr, p_place, p_empty_slot_token) $$;

create function public.finder_place_named_qr(p_brand_id uuid, p_qr text, p_place text, p_date date, p_qty integer, p_empty_slot_token text)
returns jsonb language sql security invoker set search_path = ''
as $$ select app.finder_place_named_qr(p_brand_id, p_qr, p_place, p_date, p_qty, p_empty_slot_token) $$;

revoke all on function app.finder_place_photo_qr(uuid,text,text,text), public.finder_place_photo_qr(uuid,text,text,text),
  app.finder_place_named_qr(uuid,text,text,date,integer,text), public.finder_place_named_qr(uuid,text,text,date,integer,text)
from public, anon, authenticated, service_role;
grant execute on function app.finder_place_photo_qr(uuid,text,text,text), public.finder_place_photo_qr(uuid,text,text,text),
  app.finder_place_named_qr(uuid,text,text,date,integer,text), public.finder_place_named_qr(uuid,text,text,date,integer,text)
to authenticated;

notify pgrst, 'reload schema';
