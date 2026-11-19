-- Keep picking classification; relax capacity only for exact saved popular locations.
create function app.warehouse_location_allows_multiple_boxes(p_brand_id uuid, p_code text)
returns boolean
language sql stable set search_path = ''
as $$
  select exists (
    select 1 from public.warehouse_popular_locations l
    cross join lateral unnest(l.location_codes) as slot(code)
    where l.brand_id = p_brand_id and upper(btrim(slot.code)) =
      upper(btrim(regexp_replace(coalesce(p_code, ''), '//[[:space:]]*$', '')))
  );
$$;
revoke all on function app.warehouse_location_allows_multiple_boxes(uuid,text) from public, anon, authenticated;

-- Preserve the existing brand, warehouse and Finder permissions of the slot list.
create function public.list_masma_finder_slots_with_capacity(p_brand_id uuid, p_warehouse_id uuid)
returns table (code text, zone text, allows_multiple boolean)
language sql stable security definer set search_path = ''
as $$
  select s.code, s.zone, s.zone = 'picking' and app.warehouse_location_allows_multiple_boxes(p_brand_id, s.code)
  from public.list_masma_finder_registered_slots(p_brand_id, p_warehouse_id) s;
$$;
revoke all on function public.list_masma_finder_slots_with_capacity(uuid,uuid) from public, anon, authenticated;
grant execute on function public.list_masma_finder_slots_with_capacity(uuid,uuid) to authenticated;

-- Edit only capacity predicates in the deployed routines. QR identity, live-stock
-- locking, operation permissions and sheet row identity remain in those routines.
do $migration$
declare
  v_rule record;
  v_proc regprocedure;
  v_definition text;
  v_occurrences integer;
begin
  for v_rule in select * from (values
    ('app.finder_warehouse_placement_before_audit_sheet(uuid,text,jsonb)',
      $old$v_zone = 'picking' and v_rows$old$,
      $new$v_zone = 'picking' and not app.warehouse_location_allows_multiple_boxes(p_brand_id, v_place) and v_rows$new$),
    ('app.finder_warehouse_placement_before_audit_sheet(uuid,text,jsonb)',
      $old$if v_zone = 'picking' then$old$,
      $new$if v_zone = 'picking' and not app.warehouse_location_allows_multiple_boxes(p_brand_id, v_place) then$new$),
    ('app.finder_place_photo_qr(uuid,text,text,text)',
      $old$if v_slot.zone = 'picking' then$old$,
      $new$if v_slot.zone = 'picking' and not app.warehouse_location_allows_multiple_boxes(p_brand_id, v_place) then$new$),
    ('app.finder_place_photo_qr(uuid,text,text)',
      $old$if v_slot.zone = 'picking' and exists ($old$,
      $new$if v_slot.zone = 'picking' and not app.warehouse_location_allows_multiple_boxes(p_brand_id, v_place) and exists ($new$),
    ('app.finder_place_photo_qr(uuid,text,text,text)',
      $old$(v_slot.zone = 'picking' and upper(o.plan->'write'->>'place') = v_place)$old$,
      $new$(v_slot.zone = 'picking' and not app.warehouse_location_allows_multiple_boxes(p_brand_id, v_place) and upper(o.plan->'write'->>'place') = v_place)$new$),
    ('app.finder_place_photo_qr(uuid,text,text)',
      $old$(v_slot.zone = 'picking' and upper(o.plan->'write'->>'place') = v_place)$old$,
      $new$(v_slot.zone = 'picking' and not app.warehouse_location_allows_multiple_boxes(p_brand_id, v_place) and upper(o.plan->'write'->>'place') = v_place)$new$),
    ('app.finder_place_named_qr(uuid,text,text,date,integer,text)',
      $old$if v_slot.zone = 'picking' then$old$,
      $new$if v_slot.zone = 'picking' and not app.warehouse_location_allows_multiple_boxes(p_brand_id, v_slot.code) then$new$),
    ('app.finder_place_named_qr(uuid,text,text,date,integer)',
      $old$if v_slot.zone = 'picking' and exists ($old$,
      $new$if v_slot.zone = 'picking' and not app.warehouse_location_allows_multiple_boxes(p_brand_id, v_slot.code) and exists ($new$),
    ('app.assert_atelier_stock_sheet_picking(uuid,jsonb,jsonb)',
      $old$where app.warehouse_qr_audit_is_active(p)$old$,
      $new$where app.warehouse_qr_audit_is_active(p)
      and not app.warehouse_location_allows_multiple_boxes(p_brand_id, l.code)$new$),
    ('public.claim_atelier_stock_sheet_jobs(uuid,integer)',
      $old$where key like 'pick:%')$old$,
      $new$where key like 'pick:%'
      and not app.warehouse_location_allows_multiple_boxes(p_brand_id, substring(key from 6)))$new$),
    ('public.replace_warehouse_inventory_snapshot_with_box_qr(uuid,text,jsonb,timestamptz)',
      $old$where d->>'zone' = 'picking' and upper(d->>'location_code') = upper(btrim(r.value->>'location_code'))$old$,
      $new$where d->>'zone' = 'picking' and upper(d->>'location_code') = upper(btrim(r.value->>'location_code'))
          and not app.warehouse_location_allows_multiple_boxes(p_brand_id, d->>'location_code')$new$),
    ('app.save_masma_finder_missing_style_stock(uuid,uuid,timestamptz,uuid,text,text,integer)',
      $old$if v_zone = 'picking' and ($old$,
      $new$if v_zone = 'picking' and not app.warehouse_location_allows_multiple_boxes(p_brand_id, v_code) and ($new$),
    ('app.save_masma_finder_missing_style_stock(uuid,uuid,timestamptz,uuid,text,text,integer)',
      $old$and (v_zone = 'picking' or l.zone <> v_zone)$old$,
      $new$and ((v_zone = 'picking' and not app.warehouse_location_allows_multiple_boxes(p_brand_id, v_code)) or l.zone <> v_zone)$new$)
  ) as patches(signature, before_text, after_text)
  loop
    v_proc := to_regprocedure(v_rule.signature);
    v_definition := pg_get_functiondef(v_proc);
    v_occurrences := (length(v_definition) - length(replace(v_definition, v_rule.before_text, ''))) / length(v_rule.before_text);
    if v_definition is null or v_occurrences <> 1 then
      raise exception 'Review popular-location capacity patch for % (found %)', v_rule.signature, v_occurrences;
    end if;
    execute replace(v_definition, v_rule.before_text, v_rule.after_text);
  end loop;
end;
$migration$;
