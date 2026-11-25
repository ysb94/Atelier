-- Load the date from the already identified stock row so old pending photo
-- reviews keep matching their original source fingerprints.
alter table app.finder_placement_reviews add column reviewed_label_date date;

create function app.finder_placement_review_label_date(p_brand uuid,p_qr text,p_source jsonb)
returns date language sql stable set search_path='' as $$
  select case p_source->>'kind'
    when 'active' then (
      select p.received_on
      from public.warehouse_inventory_sets s
      join public.warehouse_stock_positions p on p.set_id=s.id and p.brand_id=s.brand_id
      where s.brand_id=p_brand and s.kind='sandbox' and s.status='active'
        and p.external_row_id=p_source->>'aa' and upper(btrim(p.box_qr))=p_qr
    )
    when 'presumed_depleted' then (
      select (p.snapshot#>>'{row,received_on}')::date
      from app.finder_warehouse_presumed_boxes p where p.brand_id=p_brand and p.box_qr=p_qr
    )
    when 'unplaced' then (
      select l.label_date from app.finder_unplaced_box_qr_links l
      where l.brand_id=p_brand and l.box_qr=p_qr and l.id=(p_source->>'id')::uuid
    )
  end;
$$;
revoke all on function app.finder_placement_review_label_date(uuid,text,jsonb)
  from public,anon,authenticated,service_role;

-- Use the same review transaction, permissions, and sheet export as the
-- product and quantity confirmation.
do $migration$
declare
  rule record;
  list_definition text := pg_get_functiondef('app.review_warehouse_qr_audit(uuid,text,jsonb)'::regprocedure);
  definition text := pg_get_functiondef('app.finish_finder_placement_review(uuid,jsonb)'::regprocedure);
  list_anchor text := $old$'suggested_name',source->>'name','suggested_number',source->>'number','units_per_box',(source->>'units')::integer,$old$;
begin
  if length(list_definition)-length(replace(list_definition,list_anchor,'')) <> length(list_anchor) then
    raise exception 'Unexpected Finder review queue definition';
  end if;
  execute replace(list_definition,list_anchor,list_anchor || $new$
      'label_date',app.finder_placement_review_label_date(brand_id,box_qr,source),$new$);

  for rule in select * from (values
    ($old$  v_flags text[];$old$,
     $new$  v_flags text[];
  v_date date;
  v_date_text text := nullif(p_request->>'date','');$new$),
    ($old$  if v_units is null or v_units not between 1 and 1000000 then$old$,
     $new$  if v_date_text is not null then
    if jsonb_typeof(p_request->'date') is distinct from 'string'
      or v_date_text !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' then
      raise exception '선적일을 2000년부터 2099년 사이의 날짜로 입력해주세요.' using errcode='22023';
    end if;
    v_date := v_date_text::date;
  end if;
  if v_units is null or v_units not between 1 and 1000000 then$new$),
    ($old$(v_style.id,v_units,case when v_style.id is null then v_name end) then$old$,
     $new$(v_style.id,v_units,case when v_style.id is null then v_name end)
      or (v_date is not null and v_date is distinct from v_review.reviewed_label_date) then$new$),
    ($old$  if coalesce((v_review.source->>'opened')::integer,0)>v_units then$old$,
     $new$  if v_date is not null and (not (p_request ? 'previousDate')
    or (p_request->>'previousDate') is distinct from to_char(
      app.finder_placement_review_label_date(v_review.brand_id,v_review.box_qr,v_review.source),'YYYY-MM-DD')) then
    raise exception '검수 중 선적일이 바뀌었습니다. 목록을 새로고침해주세요.' using errcode='40001';
  end if;
  if coalesce((v_review.source->>'opened')::integer,0)>v_units then$new$),
    ($old$      quantity_status='known',review_flags=case when v_style.id is null then$old$,
     $new$      received_on=coalesce(v_date,received_on),
      received_on_raw=case when v_date is distinct from received_on and v_date is not null
        then to_char(v_date,'YYMMDD') else received_on_raw end,
      quantity_status='known',review_flags=case when v_style.id is null then$new$),
    ($old$    perform app.sync_warehouse_qr_audit_box(v_pos,v_style.id,auth.uid());$old$,
     $new$    perform app.sync_warehouse_qr_audit_box(v_pos,v_style.id,auth.uid());
    if v_date is not null and v_style.id is not null then
      update public.warehouse_boxes set received_on=v_date
      where brand_id=p_brand and display_code=v_review.box_qr and received_on is distinct from v_date;
    end if;$new$),
    ($old$'units_per_box',v_units,'units_per_box_raw',v_units::text,'quantity_status','known','review_flags',v_flags))$old$,
     $new$'units_per_box',v_units,'units_per_box_raw',v_units::text,'quantity_status','known','review_flags',v_flags)
      || case when v_date is null or v_date=v_pos.received_on then '{}'::jsonb else
        jsonb_build_object('received_on',v_date,'received_on_raw',to_char(v_date,'YYMMDD')) end)$new$),
    ($old$    update public.warehouse_boxes set style_id=v_style.id,initial_qty=v_units,current_qty=coalesce(nullif(v_pos.opened_units,0),v_units),$old$,
     $new$    update public.warehouse_boxes set style_id=v_style.id,received_on=coalesce(v_date,received_on),
      initial_qty=v_units,current_qty=coalesce(nullif(v_pos.opened_units,0),v_units),$new$),
    ($old$    update app.finder_unplaced_box_qr_links set style_no=v_style.style_no,product_name=v_style.name,units_per_box=v_units,$old$,
     $new$    update app.finder_unplaced_box_qr_links set style_no=v_style.style_no,product_name=v_style.name,units_per_box=v_units,
      label_date=coalesce(v_date,label_date),$new$),
    ($old$    reviewed_manual_name=case when v_style.id is null then v_name end where id=v_review.id;$old$,
     $new$    reviewed_manual_name=case when v_style.id is null then v_name end,
    reviewed_label_date=v_date where id=v_review.id;$new$)
  ) as rules(old_text,new_text) loop
    if length(definition)-length(replace(definition,rule.old_text,'')) <> length(rule.old_text) then
      raise exception 'Unexpected Finder review definition';
    end if;
    definition := replace(definition,rule.old_text,rule.new_text);
  end loop;
  execute definition;
end;
$migration$;
