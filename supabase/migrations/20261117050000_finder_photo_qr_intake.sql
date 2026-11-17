alter table app.finder_unplaced_box_qr_links
  add column label_date date,
  add column units_per_box integer check (units_per_box between 1 and 1000000);

create function app.finder_box_qr_link_exists(p_brand_id uuid, p_qr text)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare v_qr text := upper(btrim(coalesce(p_qr, '')));
begin
  if auth.uid() is null or not coalesce(app.can_use_masma_finder_feature(p_brand_id, 'test'), false) then
    raise exception 'QR 연결 권한이 없습니다.' using errcode = '42501';
  end if;
  if length(v_qr) not between 1 and 200 then
    raise exception '박스 QR을 확인해주세요.' using errcode = '22023';
  end if;
  return (exists (select 1 from public.warehouse_registered_slots r
    join public.warehouse_inventory_sets s on s.warehouse_id = r.warehouse_id
    where s.brand_id = p_brand_id and s.kind = 'sandbox' and s.status = 'active' and upper(r.code) = v_qr)
    or exists (select 1 from public.warehouse_boxes where brand_id = p_brand_id and display_code = v_qr)
    or exists (select 1 from public.warehouse_stock_positions p join public.warehouse_inventory_sets s on s.id = p.set_id
      where p.brand_id = p_brand_id and s.kind = 'sandbox' and s.status = 'active' and upper(p.box_qr) = v_qr)
    or exists (select 1 from app.finder_warehouse_presumed_boxes where brand_id = p_brand_id and box_qr = v_qr)
    or exists (select 1 from app.warehouse_qr_audit_boxes b join app.warehouse_qr_audits a on a.id = b.audit_id
      where a.brand_id = p_brand_id and b.box_qr = v_qr)
    or exists (select 1 from app.finder_warehouse_placement_operations o where o.brand_id = p_brand_id
      and o.finished_at is null and o.cancelled_at is null and o.plan->'write'->>'qr' = v_qr)
    or exists (select 1 from public.cargo_inbound_receipts where brand_id = p_brand_id and box_qr = v_qr) or exists (
    select 1 from app.finder_unplaced_box_qr_links where brand_id = p_brand_id and box_qr = v_qr
  ));
end;
$$;

create function app.finder_link_box_qr_photo(
  p_brand_id uuid, p_qr text, p_photo_path text, p_number text, p_date date, p_units integer, p_verified boolean
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_qr text := upper(btrim(coalesce(p_qr, '')));
  v_link app.finder_unplaced_box_qr_links;
  v_style public.styles;
begin
  if auth.uid() is null or not coalesce(app.can_use_masma_finder_feature(p_brand_id, 'test'), false) then
    raise exception 'QR 연결 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_photo_path is null then raise exception '박스 사진을 확인해주세요.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('finder-placement/' || p_brand_id::text, 0));
  select * into v_link from app.finder_unplaced_box_qr_links where brand_id = p_brand_id and box_qr = v_qr;
  if found then
    if v_link.photo_path is distinct from p_photo_path
      or not coalesce(app.can_upload_warehouse_qr_audit_photo(p_photo_path), false) then
      raise exception '이미 등록된 상품입니다' using errcode = '23505';
    end if;
  else
    if app.finder_box_qr_link_exists(p_brand_id, v_qr) then
      raise exception '이미 등록된 상품입니다' using errcode = '23505';
    end if;
    perform app.finder_link_unplaced_box_qr(p_brand_id, v_qr, null, null, p_photo_path);
    select * into v_style from public.styles
    where brand_id = p_brand_id and upper(btrim(style_no)) = upper(btrim(p_number));
    if p_date is not null and not isfinite(p_date) then p_date := null; end if;
    if p_units not between 1 and 1000000 then p_units := null; end if;
    update app.finder_unplaced_box_qr_links
    set label_date = p_date, units_per_box = p_units,
      style_no = v_style.style_no, product_name = v_style.name,
      reviewed_at = case when p_verified and v_style.id is not null and p_date is not null and p_units is not null
        then clock_timestamp() end
    where brand_id = p_brand_id and box_qr = v_qr returning * into v_link;
  end if;
  return jsonb_build_object('qr', v_qr, 'pendingReview', v_link.reviewed_at is null, 'productName', v_link.product_name);
end;
$$;

create function app.finder_place_photo_qr(p_brand_id uuid, p_qr text, p_place text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_qr text := upper(btrim(p_qr));
  v_place text := upper(btrim(p_place));
  v_link app.finder_unplaced_box_qr_links;
  v_slot public.warehouse_registered_slots;
  v_set public.warehouse_inventory_sets;
  v_position public.warehouse_stock_positions;
  v_style_id uuid;
  v_location_id uuid;
  v_aa text;
  v_pending boolean;
begin
  if v_actor is null or not coalesce(app.can_use_masma_finder_feature(p_brand_id, 'test'), false) then
    raise exception '창고 입고 권한이 없습니다.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('finder-placement/' || p_brand_id::text, 0));
  select * into v_link from app.finder_unplaced_box_qr_links
  where brand_id = p_brand_id and box_qr = v_qr and photo_path is not null;
  if not found then raise exception '사진을 연결한 박스 QR을 확인해주세요.' using errcode = '22023'; end if;
  v_aa := 'at_manual_' || replace(v_link.id::text, '-', '');
  v_pending := v_link.reviewed_at is null or v_link.units_per_box is null;
  lock table public.warehouse_stock_positions in share row exclusive mode;
  select * into strict v_set from public.warehouse_inventory_sets
  where brand_id = p_brand_id and kind = 'sandbox' and status = 'active';
  select * into v_slot from public.warehouse_registered_slots
  where warehouse_id = v_set.warehouse_id and upper(code) = v_place;
  if not found or v_slot.zone not in ('box_storage', 'picking') then
    raise exception '등록된 입고 자리를 찍어주세요.' using errcode = '22023';
  end if;
  if v_link.placed_at is not null then
    if exists (select 1 from public.warehouse_stock_positions p join public.warehouse_locations l on l.id = p.location_id
      where p.set_id = v_set.id and p.external_row_id = v_aa and upper(l.code) = v_place
        and app.warehouse_qr_audit_is_active(p)) then
      return jsonb_build_object('pendingReview', v_pending, 'alreadyPlaced', true);
    end if;
    raise exception '이미 입고된 박스입니다.' using errcode = '22023';
  end if;
  perform app.assert_atelier_stock_sheet_ready(p_brand_id, v_slot.code, v_qr);
  if exists (select 1 from app.finder_warehouse_placement_operations o
    where o.brand_id = p_brand_id and o.finished_at is null and o.cancelled_at is null
    and (upper(o.plan->'write'->>'qr') = v_qr or (v_slot.zone = 'picking' and upper(o.plan->'write'->>'place') = v_place))) then
    raise exception '앞선 창고 작업을 확인해주세요.' using errcode = 'PQA01';
  end if;
  if exists (select 1 from public.warehouse_boxes where brand_id = p_brand_id and display_code = v_qr)
    or exists (select 1 from public.warehouse_stock_positions where set_id = v_set.id and upper(box_qr) = v_qr) then
    raise exception '이미 입고된 박스입니다.' using errcode = '22023';
  end if;
  v_location_id := app.ensure_warehouse_box_location(p_brand_id, v_slot.code, v_slot.zone);
  if v_slot.zone = 'picking' and exists (
    select 1 from public.warehouse_stock_positions p where p.set_id = v_set.id and p.location_id = v_location_id
    and app.warehouse_qr_audit_is_active(p)
  ) then raise exception '출고창고에 이미 박스가 있습니다. 빈 자리를 선택해주세요.' using errcode = '23505'; end if;

  if not v_pending then
    select id into v_style_id from public.styles where brand_id = p_brand_id and style_no = v_link.style_no;
  end if;
  insert into app.warehouse_qr_audit_writes values (p_brand_id, pg_current_xact_id());
  insert into public.warehouse_stock_positions (
    brand_id, set_id, warehouse_id, location_id, style_id, source_style_no, normalized_style_no, source_product_name,
    received_on, received_on_raw, units_per_box, remaining_boxes, opened_units, units_per_box_raw, remaining_boxes_raw,
    quantity_status, review_flags, source_row_number, external_row_id, box_qr
  ) values (
    p_brand_id, v_set.id, v_set.warehouse_id, v_location_id, v_style_id,
    case when v_pending then '' else coalesce(v_link.style_no, '') end,
    case when v_pending then '' else coalesce(v_link.style_no, '') end,
    case when v_pending then '상품 확인 대기' else v_link.product_name end,
    case when not v_pending then v_link.label_date end,
    case when v_pending then '' else coalesce(to_char(v_link.label_date, 'YYMMDD'), '') end,
    case when not v_pending then v_link.units_per_box end, 1, 0,
    case when v_pending then '' else v_link.units_per_box::text end, '1',
    case when v_pending then 'unknown' else 'known' end,
    case when v_pending then array['missing_style', 'quantity_unknown']
      when v_style_id is null then array['missing_style'] else array[]::text[] end,
    1000001, v_aa, v_qr
  ) returning * into v_position;
  perform app.sync_warehouse_qr_audit_box(v_position, v_style_id, v_actor);
  delete from app.warehouse_qr_audit_writes where brand_id = p_brand_id and transaction_id = pg_current_xact_id();

  if v_pending then
    update app.finder_unplaced_box_qr_links set reviewed_at = null, reviewed_by = null
    where id = v_link.id;
  end if;
  insert into public.warehouse_stock_movements
    (brand_id, set_id, action, position_id, style_id, to_location_code, box_count, unit_count, reason, actor_id)
  values (p_brand_id, v_set.id, 'receive', v_position.id, v_style_id, v_slot.code, 1,
    coalesce(v_position.units_per_box, 0), 'Finder QR 입고', v_actor);
  update public.warehouse_inventory_sets set row_count = row_count + 1 where id = v_set.id;
  insert into app.warehouse_qr_audit_sheet_exports
    (id, brand_id, before_rows, after_rows, stock_actor_id, stock_request, atelier_review)
  values (v_link.id, p_brand_id, '[]'::jsonb,
    jsonb_build_array(app.warehouse_stock_work_sheet_row(v_position, v_slot.code)), v_actor,
    jsonb_build_object('action', 'receive', 'qr', v_qr, 'place', v_place), true);
  return jsonb_build_object('pendingReview', v_pending, 'alreadyPlaced', false);
end;
$$;

create or replace function app.mark_finder_unplaced_box_qr_placed()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from app.finder_unplaced_box_qr_links l
    where l.brand_id = new.brand_id and l.box_qr = upper(btrim(new.box_qr)) and l.reviewed_at is null
      and l.photo_path is not null and new.external_row_id is distinct from 'at_manual_' || replace(l.id::text, '-', '')) then
    raise exception '검수 대기 QR은 사진 연결 입고를 사용해주세요.' using errcode = '22023';
  end if;
  update app.finder_unplaced_box_qr_links set placed_at = clock_timestamp()
  where brand_id = new.brand_id and box_qr = upper(btrim(new.box_qr)) and placed_at is null;
  return new;
end;
$$;

create or replace function app.finder_warehouse_placement(p_brand_id uuid, p_action text, p_request jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_result jsonb;
  v_link app.finder_unplaced_box_qr_links;
  v_qr text := upper(btrim(p_request->>'qr'));
begin
  if p_action = 'prepare' and auth.uid() is not null
    and app.can_use_masma_finder_feature(p_brand_id, 'test') and app.has_masma_finder_sheet_write_key() then
    perform pg_advisory_xact_lock(hashtextextended('finder-placement/' || p_brand_id::text, 0));
    if exists (select 1 from app.finder_unplaced_box_qr_links
      where brand_id = p_brand_id and box_qr = v_qr and photo_path is not null and reviewed_at is null) then
      raise exception '검수 대기 QR은 사진 연결 입고를 사용해주세요.' using errcode = '22023';
    end if;
  end if;
  v_result := app.finder_warehouse_placement_before_unplaced_links(p_brand_id, p_action, p_request);
  if p_action = 'read' and v_qr is not null then
    select * into v_link from app.finder_unplaced_box_qr_links where brand_id = p_brand_id and box_qr = v_qr;
    if found and v_link.photo_path is not null and
      (v_link.placed_at is null or v_link.reviewed_at is null) then
      return v_result || jsonb_build_object('qrLink', jsonb_build_object('photoLinked', true,
        'productName', v_link.product_name, 'number', v_link.style_no,
        'pendingReview', v_link.reviewed_at is null or v_link.units_per_box is null));
    end if;
    if found and v_link.placed_at is null and nullif(v_result->'box', 'null'::jsonb) is null then
      return v_result || jsonb_build_object('qrLink', jsonb_build_object('productName', v_link.product_name, 'number', v_link.style_no));
    end if;
  end if;
  return v_result;
end;
$$;

create or replace function app.review_warehouse_qr_audit(p_brand_id uuid, p_action text, p_request jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_result jsonb;
  v_items jsonb;
  v_count bigint;
  v_link app.finder_unplaced_box_qr_links;
  v_style public.styles;
  v_name text := nullif(btrim(p_request->>'name'), '');
  v_date date;
  v_units integer;
  v_position public.warehouse_stock_positions;
  v_place text;
  v_before jsonb;
begin
  if not coalesce(app.can_review_warehouse_qr_audit(p_brand_id), false) then
    raise exception '창고 QR 검수 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_action = 'link_unplaced' then
    perform pg_advisory_xact_lock(hashtextextended('finder-placement/' || p_brand_id::text, 0));
    select * into v_link from app.finder_unplaced_box_qr_links
    where brand_id = p_brand_id and id = (p_request->>'rowId')::uuid and photo_path is not null;
    if not found then raise exception '검수할 박스를 찾지 못했습니다.' using errcode = '22023'; end if;
    if p_request->>'styleId' is not null then
      select * into v_style from public.styles where brand_id = p_brand_id and id = (p_request->>'styleId')::uuid;
      if not found then raise exception '같은 브랜드의 상품을 선택해주세요.' using errcode = '22023'; end if;
      v_name := v_style.name;
    end if;
    if coalesce(length(v_name), 0) not between 1 and 300 or v_name = '상품 확인 대기' then
      raise exception '확인한 상품명을 입력해주세요.' using errcode = '22023';
    end if;
    v_date := nullif(p_request->>'date', '')::date;
    v_units := nullif(p_request->>'units', '')::integer;
    if (v_date is not null and not isfinite(v_date)) or v_units is null or v_units not between 1 and 1000000 then
      raise exception '박스당 수량과 입력한 선적일을 확인해주세요.' using errcode = '22023';
    end if;
    if v_link.reviewed_at is not null then
      if (v_link.product_name, v_link.style_no, v_link.label_date, v_link.units_per_box)
        is not distinct from (v_name, v_style.style_no, v_date, v_units) then
        return jsonb_build_object('productName', v_name, 'number', v_style.style_no);
      end if;
      raise exception '이미 검수한 박스입니다. 목록을 다시 불러와주세요.' using errcode = '22023';
    end if;
    if v_link.placed_at is not null then
      lock table public.warehouse_stock_positions in share row exclusive mode;
      select p.* into v_position from public.warehouse_stock_positions p
      join public.warehouse_inventory_sets s on s.id = p.set_id and s.status = 'active' and s.kind = 'sandbox'
      where p.brand_id = p_brand_id and p.external_row_id = 'at_manual_' || replace(v_link.id::text, '-', '')
        and upper(p.box_qr) = v_link.box_qr and app.warehouse_qr_audit_is_active(p);
      if not found then raise exception '활성 재고에 없는 박스입니다. 최신 목록을 확인해주세요.' using errcode = '22023'; end if;
      select code into strict v_place from public.warehouse_locations where id = v_position.location_id;
      v_before := app.warehouse_stock_work_sheet_row(v_position, v_place);
      insert into app.warehouse_qr_audit_writes values (p_brand_id, pg_current_xact_id());
      update public.warehouse_stock_positions set
        style_id = v_style.id, source_style_no = coalesce(v_style.style_no, ''), normalized_style_no = coalesce(v_style.style_no, ''),
        source_product_name = v_name, received_on = v_date, received_on_raw = coalesce(to_char(v_date, 'YYMMDD'), ''),
        units_per_box = v_units, units_per_box_raw = v_units::text, quantity_status = 'known',
        review_flags = case when v_style.id is null then array['missing_style'] else array[]::text[] end
      where id = v_position.id returning * into v_position;
      perform app.sync_warehouse_qr_audit_box(v_position, v_style.id, auth.uid());
      delete from app.warehouse_qr_audit_writes where brand_id = p_brand_id and transaction_id = pg_current_xact_id();
      insert into app.warehouse_qr_audit_sheet_exports
        (id, brand_id, before_rows, after_rows, stock_actor_id, stock_request, atelier_review)
      values (gen_random_uuid(), p_brand_id, jsonb_build_array(v_before),
        jsonb_build_array(app.warehouse_stock_work_sheet_row(v_position, v_place)), auth.uid(),
        jsonb_build_object('action', 'review', 'qr', v_link.box_qr), true);
    end if;
    update app.finder_unplaced_box_qr_links set style_no = v_style.style_no, product_name = v_name,
      label_date = v_date, units_per_box = v_units, reviewed_at = clock_timestamp(), reviewed_by = auth.uid()
    where id = v_link.id;
    return jsonb_build_object('productName', v_name, 'number', v_style.style_no);
  end if;

  v_result := app.review_warehouse_qr_audit_before_unplaced_links(p_brand_id, p_action, p_request);
  if p_action = 'list' and p_request->>'includeUnplaced' = 'true' then
    select count(*) into v_count from app.finder_unplaced_box_qr_links
    where brand_id = p_brand_id and photo_path is not null and reviewed_at is null;
    select coalesce(jsonb_agg(jsonb_build_object(
      'external_row_id', l.id, 'box_qr', l.box_qr, 'photo_path', l.photo_path, 'unplaced', true,
      'place', location.code, 'label_date', l.label_date, 'units_per_box', l.units_per_box,
      'suggested_name', l.product_name, 'suggested_number', l.style_no, 'candidates', '[]'::jsonb
    ) order by l.linked_at, l.id), '[]'::jsonb) into v_items
    from (select * from app.finder_unplaced_box_qr_links
      where brand_id = p_brand_id and photo_path is not null and reviewed_at is null
      order by linked_at, id limit 100) l
    left join public.warehouse_inventory_sets s on s.brand_id = l.brand_id and s.status = 'active' and s.kind = 'sandbox'
    left join public.warehouse_stock_positions p on p.set_id = s.id and p.external_row_id = 'at_manual_' || replace(l.id::text, '-', '')
    left join public.warehouse_locations location on location.id = p.location_id;
    return v_result || jsonb_build_object('pending', (v_result->>'pending')::bigint + v_count, 'items', v_items || (v_result->'items'));
  end if;
  return v_result;
end;
$$;

create function public.finder_box_qr_link_exists(p_brand_id uuid, p_qr text)
returns boolean language sql stable security invoker set search_path = ''
as $$ select app.finder_box_qr_link_exists(p_brand_id, p_qr) $$;

create function public.finder_link_box_qr_photo(
  p_brand_id uuid, p_qr text, p_photo_path text, p_number text default null,
  p_date date default null, p_units integer default null, p_verified boolean default false
)
returns jsonb language sql security invoker set search_path = ''
as $$ select app.finder_link_box_qr_photo(p_brand_id, p_qr, p_photo_path, p_number, p_date, p_units, p_verified) $$;

create function public.finder_place_photo_qr(p_brand_id uuid, p_qr text, p_place text)
returns jsonb language sql security invoker set search_path = ''
as $$ select app.finder_place_photo_qr(p_brand_id, p_qr, p_place) $$;

revoke all on function
  app.finder_box_qr_link_exists(uuid,text), public.finder_box_qr_link_exists(uuid,text),
  app.finder_link_box_qr_photo(uuid,text,text,text,date,integer,boolean), public.finder_link_box_qr_photo(uuid,text,text,text,date,integer,boolean),
  app.finder_place_photo_qr(uuid,text,text), public.finder_place_photo_qr(uuid,text,text)
from public, anon, authenticated;
grant execute on function
  app.finder_box_qr_link_exists(uuid,text), public.finder_box_qr_link_exists(uuid,text),
  app.finder_link_box_qr_photo(uuid,text,text,text,date,integer,boolean), public.finder_link_box_qr_photo(uuid,text,text,text,date,integer,boolean),
  app.finder_place_photo_qr(uuid,text,text), public.finder_place_photo_qr(uuid,text,text)
to authenticated;

