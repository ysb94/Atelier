-- A Finder review can confirm an existing physical box by name when it has
-- no SKU. The verified name follows that QR and its original AA row.
alter table app.finder_placement_reviews add column reviewed_manual_name text;

create function app.finder_has_reviewed_manual_stock(p public.warehouse_stock_positions)
returns boolean language sql stable set search_path='' as $$
  select p.style_id is null
    and coalesce(btrim(p.source_style_no),'')='' and coalesce(p.normalized_style_no,'')=''
    and not exists (
      select 1 from public.warehouse_stock_condition_links c
      where c.brand_id=p.brand_id and c.external_row_id=p.external_row_id
    )
    and exists (
      select 1 from app.finder_placement_reviews r
      where r.brand_id=p.brand_id and r.box_qr=upper(btrim(p.box_qr))
        and r.source->>'aa'=p.external_row_id and r.source->>'kind'='active'
        and r.reviewed_at is not null and r.superseded_at is null and r.reviewed_style_id is null
        and r.reviewed_manual_name=p.source_product_name
    );
$$;
revoke all on function app.finder_has_reviewed_manual_stock(public.warehouse_stock_positions)
  from public,anon,authenticated,service_role;

create or replace function app.finish_finder_placement_review(p_brand uuid,p_request jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare
  v_review app.finder_placement_reviews;
  v_style public.styles;
  v_name text := btrim(coalesce(p_request->>'name', ''), E' \t\n\r');
  v_units integer:=(p_request->>'units')::integer;
  v_pos public.warehouse_stock_positions;
  v_before jsonb;
  v_flags text[];
begin
  if auth.uid() is null or app.can_review_warehouse_qr_audit(p_brand) is not true then
    raise exception '창고 QR 검수 권한이 없습니다.' using errcode='42501';
  end if;
  if v_units is null or v_units not between 1 and 1000000 then
    raise exception '확인한 박스당 수량을 입력해주세요.' using errcode='22023';
  end if;
  if nullif(p_request->>'styleId','') is not null then
    select * into v_style from public.styles where brand_id=p_brand and id=(p_request->>'styleId')::uuid;
    if not found then raise exception '정식 상품을 다시 선택해주세요.' using errcode='22023'; end if;
    v_name := v_style.name;
  elsif jsonb_typeof(p_request->'name') is distinct from 'string'
    or char_length(v_name) not between 1 and 300 or v_name ~* '^M[0-9]{4,}$' then
    raise exception '정식 상품을 선택하거나 M번호 없는 물품명을 입력해주세요.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('finder-placement/'||p_brand::text,0));
  select * into v_review from app.finder_placement_reviews where brand_id=p_brand and id=(p_request->>'rowId')::uuid for update;
  if not found or v_review.superseded_at is not null then raise exception '최신 검수 요청을 확인해주세요.' using errcode='22023'; end if;
  if v_style.id is null and (v_review.source->>'kind' is distinct from 'active'
    or v_review.source->>'style' is not null or v_review.source->>'ledgerId' is not null
    or nullif(btrim(v_review.source->>'number'),'') is not null) then
    raise exception '이 입고 요청은 정식 상품으로 연결해주세요.' using errcode='22023';
  end if;
  if v_review.reviewed_at is not null then
    if (v_review.reviewed_style_id,v_review.reviewed_units,v_review.reviewed_manual_name) is distinct from
      (v_style.id,v_units,case when v_style.id is null then v_name end) then
      raise exception '이미 다른 내용으로 검수된 박스입니다.' using errcode='22023';
    end if;
    return jsonb_build_object('number',coalesce(v_style.style_no,''),'productName',v_name);
  end if;
  lock table public.warehouse_stock_positions in share row exclusive mode;
  perform 1 from public.warehouse_boxes where brand_id=p_brand and display_code=v_review.box_qr for update;
  perform 1 from app.finder_warehouse_presumed_boxes where brand_id=p_brand and box_qr=v_review.box_qr for update;
  perform 1 from app.finder_unplaced_box_qr_links where brand_id=p_brand and box_qr=v_review.box_qr for update;
  if app.finder_placement_review_source(p_brand,v_review.box_qr) is distinct from v_review.source then
    raise exception '검수 접수 이후 재고가 바뀌었습니다. 현재 박스 QR을 다시 확인해주세요.' using errcode='40001';
  end if;
  if exists (select 1 from app.finder_warehouse_placement_operations o where o.brand_id=p_brand
     and o.finished_at is null and o.cancelled_at is null
     and (upper(o.request->>'qr')=v_review.box_qr or upper(o.plan#>>'{write,qr}')=v_review.box_qr)) then
    raise exception '이 박스의 진행 중인 창고 작업을 먼저 확인해주세요.' using errcode='PQA01';
  end if;
  if coalesce((v_review.source->>'opened')::integer,0)>v_units then
    raise exception '박스당 수량이 기존 개봉 잔량보다 작습니다. 실제 수량을 확인해주세요.' using errcode='22023';
  end if;
  case v_review.source->>'kind'
  when 'active' then
    select p.* into strict v_pos from public.warehouse_stock_positions p join public.warehouse_inventory_sets s on s.id=p.set_id
      where s.status='active' and s.kind='sandbox' and p.brand_id=p_brand and s.brand_id=p_brand
        and p.external_row_id=v_review.source->>'aa' and upper(btrim(p.box_qr))=v_review.box_qr;
    if v_style.id is null and nullif(btrim(v_pos.source_style_no),'') is not null then
      raise exception '기존 M번호가 있는 박스는 정식 상품으로 연결해주세요.' using errcode='22023';
    end if;
    perform app.assert_finder_stock_ready(p_brand,v_review.source->>'place',v_review.box_qr,v_pos.external_row_id);
    v_before:=app.warehouse_stock_work_sheet_row(v_pos,v_review.source->>'place');
    insert into app.warehouse_qr_audit_writes values(p_brand,pg_current_xact_id());
    update public.warehouse_stock_positions set style_id=v_style.id,source_style_no=coalesce(v_style.style_no,''),
      normalized_style_no=coalesce(v_style.style_no,''),source_product_name=v_name,units_per_box=v_units,units_per_box_raw=v_units::text,
      quantity_status='known',review_flags=case when v_style.id is null then
        array_append(array_remove(array_remove(review_flags,'quantity_unknown'),'missing_style'),'missing_style')
        else array_remove(array_remove(review_flags,'missing_style'),'quantity_unknown') end
      where id=v_pos.id returning * into strict v_pos;
    perform app.sync_warehouse_qr_audit_box(v_pos,v_style.id,auth.uid());
    delete from app.warehouse_qr_audit_writes where brand_id=p_brand and transaction_id=pg_current_xact_id();
    insert into app.warehouse_qr_audit_sheet_exports(id,brand_id,before_rows,after_rows,stock_actor_id,stock_request,atelier_review)
      values(gen_random_uuid(),p_brand,jsonb_build_array(v_before),jsonb_build_array(app.warehouse_stock_work_sheet_row(v_pos,v_review.source->>'place')),
        auth.uid(),jsonb_build_object('action','review','qr',v_review.box_qr),true);
  when 'presumed_depleted' then
    select (jsonb_populate_record(null::public.warehouse_stock_positions,snapshot->'row')).* into strict v_pos
      from app.finder_warehouse_presumed_boxes where brand_id=p_brand and box_qr=v_review.box_qr;
    v_flags:=array_remove(array_remove(v_pos.review_flags,'missing_style'),'quantity_unknown');
    update app.finder_warehouse_presumed_boxes set snapshot=jsonb_set(snapshot,'{row}',snapshot->'row'||jsonb_build_object(
      'style_id',v_style.id,'source_style_no',v_style.style_no,'normalized_style_no',v_style.style_no,'source_product_name',v_style.name,
      'units_per_box',v_units,'units_per_box_raw',v_units::text,'quantity_status','known','review_flags',v_flags))
      where brand_id=p_brand and box_qr=v_review.box_qr;
    -- Do not reactivate the ledger. Placement will restore this box and its destination later.
    insert into app.warehouse_qr_audit_writes values(p_brand,pg_current_xact_id());
    update public.warehouse_boxes set style_id=v_style.id,initial_qty=v_units,current_qty=coalesce(nullif(v_pos.opened_units,0),v_units),
      updated_at=clock_timestamp() where brand_id=p_brand and display_code=v_review.box_qr and presumed_depleted_at is not null;
    delete from app.warehouse_qr_audit_writes where brand_id=p_brand and transaction_id=pg_current_xact_id();
  when 'unplaced' then
    update app.finder_unplaced_box_qr_links set style_no=v_style.style_no,product_name=v_style.name,units_per_box=v_units,
      photo_path=v_review.photo_path,reviewed_by=auth.uid(),reviewed_at=clock_timestamp()
      where brand_id=p_brand and box_qr=v_review.box_qr and id=(v_review.source->>'id')::uuid and placed_at is null;
  end case;
  update app.finder_placement_reviews set reviewed_at=clock_timestamp(),reviewed_by=auth.uid(),
    reviewed_style_id=v_style.id,reviewed_units=v_units,
    reviewed_manual_name=case when v_style.id is null then v_name end where id=v_review.id;
  return jsonb_build_object('number',coalesce(v_style.style_no,''),'productName',v_name);
end;
$$;

create or replace function app.finder_stock_review_metadata(p_kind text,p public.warehouse_stock_positions,p_place text,b public.warehouse_boxes)
returns jsonb language sql stable set search_path='' as $$
  select case when nullif(btrim(p.external_row_id),'') is not null
    and ((p.remaining_boxes=1 and coalesce(p.opened_units,0)=0) or (coalesce(p.remaining_boxes,0)=0 and p.opened_units>0))
    and ((p.style_id is null and (p_kind <> 'active' or not app.finder_has_reviewed_manual_stock(p)))
      or p.quantity_status='unknown' or coalesce(p.units_per_box,0)<1
      or coalesce(nullif(p.opened_units,0),p.units_per_box,0)>coalesce(b.initial_qty,p.units_per_box,0))
    then case when exists(select 1 from public.warehouse_stock_condition_links c where c.brand_id=p.brand_id and c.external_row_id=p.external_row_id)
      then jsonb_build_object('blocked','상태 재고로 등록된 박스입니다. 아틀리에에서 해당 재고의 상태와 수량을 확인해주세요.')
      else jsonb_build_object('kind',p_kind,'aa',p.external_row_id,'place',p_place,'style',p.style_id,
      'number',p.normalized_style_no,'name',p.source_product_name,'units',p.units_per_box,
      'boxes',p.remaining_boxes,'opened',p.opened_units,'ledgerId',b.id,'ledgerInitial',b.initial_qty,
      'quantityStatus',p.quantity_status,'ledgerCurrent',b.current_qty,'ledgerStyle',b.style_id,
      'depletedAt',extract(epoch from b.presumed_depleted_at)) end end;
$$;

-- Reuse the existing movement plan and sheet export. Name-only stock is
-- represented by the shared AA row, since the individual box ledger needs a SKU.
do $migration$
declare
  rule record;
  definition text := replace(pg_get_functiondef(
    'app.finder_warehouse_placement_before_audit_sheet(uuid,text,jsonb)'::regprocedure), chr(13), '');
begin
  for rule in select * from (values
    ($old$if v_qty is null or v_qty < 1 or v_qty > v_initial or v_position.style_id is null then$old$,
     $new$if v_qty is null or v_qty < 1 or v_qty > v_initial or (
      v_position.style_id is null and (v_state is distinct from 'active'
        or not app.finder_has_reviewed_manual_stock(v_position))
    ) then$new$),
    ($old$      insert into public.warehouse_boxes (
        brand_id, display_code, location_id, style_id, received_on, initial_qty, current_qty, created_by$old$,
     $new$      if v_position.style_id is not null then
      insert into public.warehouse_boxes (
        brand_id, display_code, location_id, style_id, received_on, initial_qty, current_qty, created_by$new$),
    ($old$      where warehouse_boxes.archived_at is null and warehouse_boxes.completed_at is null;
      delete from app.finder_warehouse_presumed_boxes$old$,
     $new$      where warehouse_boxes.archived_at is null and warehouse_boxes.completed_at is null;
      end if;
      delete from app.finder_warehouse_presumed_boxes$new$)
  ) as rules(old_text,new_text) loop
    if length(definition)-length(replace(definition,rule.old_text,'')) <> length(rule.old_text) then
      raise exception 'Unexpected Finder placement definition';
    end if;
    definition := replace(definition,rule.old_text,rule.new_text);
  end loop;
  execute definition;
end;
$migration$;
