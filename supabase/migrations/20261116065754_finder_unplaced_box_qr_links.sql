create table app.finder_unplaced_box_qr_links (
  brand_id uuid not null references public.brands(id),
  box_qr text not null,
  id uuid not null unique default gen_random_uuid(),
  style_no text,
  product_name text,
  photo_path text unique,
  linked_by uuid not null,
  linked_at timestamptz not null default clock_timestamp(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  placed_at timestamptz,
  check (product_name is not null or photo_path is not null),
  primary key (brand_id, box_qr)
);
alter table app.finder_unplaced_box_qr_links enable row level security;
revoke all on app.finder_unplaced_box_qr_links from public, anon, authenticated;

create function app.finder_link_unplaced_box_qr(p_brand_id uuid, p_qr text, p_style_no text, p_product_name text, p_photo_path text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_qr text := upper(btrim(coalesce(p_qr, '')));
  v_number text := nullif(upper(btrim(p_style_no)), '');
  v_name text := nullif(btrim(p_product_name), '');
  v_link app.finder_unplaced_box_qr_links;
begin
  if v_actor is null or not coalesce(app.can_use_masma_finder_feature(p_brand_id, 'test'), false)
    or not exists (select 1 from public.brands where id = p_brand_id and slug = 'masmarulez') then
    raise exception 'QR 연결 권한이 없습니다.' using errcode = '42501';
  end if;
  if length(v_qr) not between 1 and 200 then
    raise exception '박스 QR을 확인해주세요.' using errcode = '22023';
  end if;
  if v_number is not null then
    select s.name, s.style_no into v_name, v_number from public.styles s
    where s.brand_id = p_brand_id and upper(btrim(s.style_no)) = v_number;
    if not found then
      raise exception '등록된 M번호를 확인하거나 상품명으로 연결해주세요.' using errcode = '22023';
    end if;
  end if;
  if p_photo_path is not null then
    if v_number is not null or v_name is not null or not coalesce(app.can_upload_warehouse_qr_audit_photo(p_photo_path), false)
      or split_part(p_photo_path, '/', 1) <> p_brand_id::text
      or not exists (select 1 from storage.objects where bucket_id = 'warehouse-qr-audit' and name = p_photo_path) then
      raise exception '검수에 보낼 박스 사진을 확인해주세요.' using errcode = '22023';
    end if;
  elsif coalesce(length(v_name), 0) not between 1 and 300 then
    raise exception '상품 이름을 확인해주세요.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('finder-placement/' || p_brand_id::text, 0));
  select * into v_link from app.finder_unplaced_box_qr_links
  where brand_id = p_brand_id and box_qr = v_qr;
  if found then
    if p_photo_path is not null and p_photo_path = v_link.photo_path then
      return jsonb_build_object('qr', v_qr, 'pendingReview', v_link.product_name is null, 'productName', v_link.product_name);
    end if;
    if v_link.placed_at is null and v_link.style_no is not distinct from v_number and
      (v_number is not null or v_link.product_name = v_name) then
      return jsonb_build_object('qr', v_qr, 'productName', v_link.product_name, 'number', v_link.style_no);
    end if;
    raise exception '이미 다른 상품이나 창고 재고에 연결된 QR입니다.' using errcode = '22023';
  end if;
  if exists (select 1 from public.warehouse_registered_slots r
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
    or exists (select 1 from public.cargo_inbound_receipts where brand_id = p_brand_id and box_qr = v_qr) then
    raise exception '이미 사용 중인 박스 QR이거나 자리 QR입니다.' using errcode = '22023';
  end if;

  insert into app.finder_unplaced_box_qr_links (brand_id, box_qr, style_no, product_name, photo_path, linked_by)
  values (p_brand_id, v_qr, v_number, v_name, p_photo_path, v_actor);
  if p_photo_path is not null then return jsonb_build_object('qr', v_qr, 'pendingReview', true); end if;
  return jsonb_build_object('qr', v_qr, 'productName', v_name, 'number', v_number);
end;
$$;

create function public.finder_link_unplaced_box_qr(p_brand_id uuid, p_qr text, p_style_no text, p_product_name text, p_photo_path text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select app.finder_link_unplaced_box_qr(p_brand_id, p_qr, p_style_no, p_product_name, p_photo_path) $$;
revoke all on function app.finder_link_unplaced_box_qr(uuid,text,text,text,text),
  public.finder_link_unplaced_box_qr(uuid,text,text,text,text) from public, anon, authenticated;
grant execute on function app.finder_link_unplaced_box_qr(uuid,text,text,text,text),
  public.finder_link_unplaced_box_qr(uuid,text,text,text,text) to authenticated;

alter function app.finder_warehouse_placement(uuid,text,jsonb) rename to finder_warehouse_placement_before_unplaced_links;
revoke all on function app.finder_warehouse_placement_before_unplaced_links(uuid,text,jsonb) from public, anon, authenticated;

create function app.finder_warehouse_placement(p_brand_id uuid, p_action text, p_request jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_result jsonb;
  v_link jsonb;
begin
  if p_action = 'prepare' and auth.uid() is not null
    and app.can_use_masma_finder_feature(p_brand_id, 'test') and app.has_masma_finder_sheet_write_key() then
    perform pg_advisory_xact_lock(hashtextextended('finder-placement/' || p_brand_id::text, 0));
    if exists (select 1 from app.finder_unplaced_box_qr_links
      where brand_id = p_brand_id and box_qr = upper(btrim(p_request->>'qr')) and product_name is null) then
      raise exception '아틀리에에서 상품을 검수한 뒤 입고해주세요.' using errcode = '22023';
    end if;
  end if;
  v_result := app.finder_warehouse_placement_before_unplaced_links(p_brand_id,p_action,p_request);
  if p_action = 'read' and nullif(v_result->'box', 'null'::jsonb) is null then
    select case when l.product_name is null then jsonb_build_object('pendingReview', true)
      else jsonb_build_object('productName', l.product_name, 'number', l.style_no) end
    into v_link from app.finder_unplaced_box_qr_links l
    where l.brand_id = p_brand_id and l.box_qr = upper(btrim(p_request->>'qr')) and l.placed_at is null;
    if found then return v_result || jsonb_build_object('qrLink', v_link); end if;
  end if;
  return v_result;
end;
$$;
revoke all on function app.finder_warehouse_placement(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function app.finder_warehouse_placement(uuid,text,jsonb) to authenticated;
create or replace function public.finder_warehouse_placement(p_brand_id uuid, p_action text, p_request jsonb)
returns jsonb language sql security invoker set search_path = ''
as $$ select app.finder_warehouse_placement(p_brand_id,p_action,p_request) $$;

create function app.mark_finder_unplaced_box_qr_placed()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from app.finder_unplaced_box_qr_links
    where brand_id = new.brand_id and box_qr = upper(btrim(new.box_qr)) and product_name is null) then
    raise exception '아틀리에에서 상품을 검수한 뒤 입고해주세요.' using errcode = '22023';
  end if;
  update app.finder_unplaced_box_qr_links set placed_at = clock_timestamp()
  where brand_id = new.brand_id and box_qr = upper(btrim(new.box_qr)) and placed_at is null;
  return new;
end;
$$;
revoke all on function app.mark_finder_unplaced_box_qr_placed() from public, anon, authenticated;
create trigger mark_finder_unplaced_box_qr_placed
after insert or update of box_qr on public.warehouse_stock_positions
for each row when (new.box_qr is not null) execute function app.mark_finder_unplaced_box_qr_placed();

create function app.guard_cargo_unplaced_box_qr()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.brand_id = old.brand_id and new.box_qr is not distinct from old.box_qr then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('finder-placement/' || new.brand_id::text, 0));
  if exists (select 1 from app.finder_unplaced_box_qr_links
    where brand_id = new.brand_id and box_qr = upper(btrim(new.box_qr))) then
    raise exception '이미 상품에 연결된 박스 QR입니다.' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_cargo_unplaced_box_qr() from public, anon, authenticated;
create trigger guard_cargo_unplaced_box_qr
before insert or update of box_qr on public.cargo_inbound_receipts
for each row when (new.box_qr is not null) execute function app.guard_cargo_unplaced_box_qr();

create or replace function app.can_read_warehouse_qr_audit_photo(p_name text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from app.warehouse_qr_audit_boxes item
    join app.warehouse_qr_audits audit on audit.id = item.audit_id
    where item.photo_path = p_name and app.can_review_warehouse_qr_audit(audit.brand_id)
  ) or exists (
    select 1 from app.finder_unplaced_box_qr_links item
    where item.photo_path = p_name and app.can_review_warehouse_qr_audit(item.brand_id)
  );
$$;

alter function app.review_warehouse_qr_audit(uuid,text,jsonb) rename to review_warehouse_qr_audit_before_unplaced_links;
revoke all on function app.review_warehouse_qr_audit_before_unplaced_links(uuid,text,jsonb) from public, anon, authenticated;
create function app.review_warehouse_qr_audit(p_brand_id uuid, p_action text, p_request jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_result jsonb;
  v_items jsonb;
  v_count bigint;
  v_number text;
  v_name text := nullif(btrim(p_request->>'name'), '');
  v_id uuid;
begin
  if not app.can_review_warehouse_qr_audit(p_brand_id) then
    raise exception '창고 QR 검수 권한이 없습니다.' using errcode = '42501';
  end if;

  if p_action = 'link_unplaced' then
    v_id := (p_request->>'rowId')::uuid;
    if p_request->>'styleId' is not null then
      select style_no, name into v_number, v_name from public.styles
      where brand_id = p_brand_id and id = (p_request->>'styleId')::uuid;
      if not found then raise exception '등록 상품을 확인해주세요.' using errcode = '22023'; end if;
    end if;
    if coalesce(length(v_name), 0) not between 1 and 300 then
      raise exception '상품 이름을 확인해주세요.' using errcode = '22023';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('finder-placement/' || p_brand_id::text, 0));
    update app.finder_unplaced_box_qr_links set style_no = v_number, product_name = v_name,
      reviewed_at = clock_timestamp(), reviewed_by = auth.uid()
    where brand_id = p_brand_id and id = v_id and photo_path is not null and product_name is null and placed_at is null;
    if not found and not exists (
      select 1 from app.finder_unplaced_box_qr_links where brand_id = p_brand_id and id = v_id
        and photo_path is not null and product_name = v_name and style_no is not distinct from v_number
    ) then
      raise exception '이미 검수했거나 찾을 수 없는 박스입니다. 목록을 다시 불러와주세요.' using errcode = '22023';
    end if;
    return jsonb_build_object('productName', v_name, 'number', v_number);
  end if;

  v_result := app.review_warehouse_qr_audit_before_unplaced_links(p_brand_id,p_action,p_request);
  if p_action = 'list' and p_request->>'includeUnplaced' = 'true' then
    select count(*) into v_count from app.finder_unplaced_box_qr_links
    where brand_id = p_brand_id and photo_path is not null and product_name is null and placed_at is null;
    select coalesce(jsonb_agg(jsonb_build_object(
      'external_row_id', l.id, 'box_qr', l.box_qr, 'photo_path', l.photo_path, 'unplaced', true,
      'place', null, 'candidates', '[]'::jsonb
    ) order by l.linked_at, l.id), '[]'::jsonb) into v_items
    from (select * from app.finder_unplaced_box_qr_links
      where brand_id = p_brand_id and photo_path is not null and product_name is null and placed_at is null
      order by linked_at, id limit 100) l;
    return v_result || jsonb_build_object('pending', (v_result->>'pending')::bigint + v_count,
      'items', v_items || (v_result->'items'));
  end if;
  return v_result;
end;
$$;
revoke all on function app.review_warehouse_qr_audit(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function app.review_warehouse_qr_audit(uuid,text,jsonb) to authenticated;
create or replace function public.review_warehouse_qr_audit(p_brand_id uuid,p_action text,p_request jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path = ''
as $$ select app.review_warehouse_qr_audit(p_brand_id,p_action,p_request) $$;

-- Name-only boxes have no style ID for the individual-box ledger used by standard Finder intake.
-- Use the same AA-addressed stock outbox as Atelier's other warehouse stock actions.
create function app.finder_place_named_qr(p_brand_id uuid, p_qr text, p_place text, p_date date, p_qty integer)
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
  v_location_id uuid;
  v_request jsonb := jsonb_build_object('qr', v_qr, 'place', v_place, 'date', p_date, 'qty', p_qty);
  v_sheet_pending boolean;
begin
  if v_actor is null or not coalesce(app.can_use_masma_finder_feature(p_brand_id,'test'), false) then
    raise exception '창고 입고 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_date is null or not isfinite(p_date) or p_qty is null or p_qty not between 1 and 1000000 then
    raise exception '선적일과 박스당 수량을 확인해주세요.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('finder-placement/' || p_brand_id::text, 0));
  select * into v_link from app.finder_unplaced_box_qr_links
  where brand_id = p_brand_id and box_qr = v_qr and product_name is not null and style_no is null;
  if not found then
    raise exception '상품을 연결한 M번호 없는 박스인지 확인해주세요.' using errcode = '22023';
  end if;
  if v_link.placed_at is not null then
    select sheet_synced_at is null into v_sheet_pending from app.warehouse_qr_audit_sheet_exports
    where brand_id = p_brand_id and id = v_link.id and stock_request = v_request;
    if found then return jsonb_build_object('sheetPending', v_sheet_pending); end if;
    raise exception '이미 입고된 박스입니다.' using errcode = '22023';
  end if;

  lock table public.warehouse_stock_positions in share row exclusive mode;
  select * into strict v_set from public.warehouse_inventory_sets
  where brand_id = p_brand_id and kind = 'sandbox' and status = 'active';
  select * into v_slot from public.warehouse_registered_slots
  where warehouse_id = v_set.warehouse_id and upper(code) = v_place;
  if not found or v_slot.zone not in ('box_storage', 'picking') then
    raise exception '등록된 입고 자리를 찍어주세요.' using errcode = '22023';
  end if;
  perform app.assert_warehouse_qr_audit_sheet_ready(p_brand_id, v_slot.code, v_qr);
  if exists (select 1 from app.finder_warehouse_placement_operations o
    where o.brand_id = p_brand_id and o.finished_at is null and o.cancelled_at is null) then
    raise exception '앞선 창고 작업의 시트 저장을 확인해주세요.' using errcode = 'PQA01';
  end if;
  if exists (select 1 from public.warehouse_boxes where brand_id = p_brand_id and display_code = v_qr)
    or exists (select 1 from public.warehouse_stock_positions where set_id = v_set.id and upper(box_qr) = v_qr) then
    raise exception '이미 입고된 박스입니다.' using errcode = '22023';
  end if;

  v_location_id := app.ensure_warehouse_box_location(p_brand_id, v_slot.code, v_slot.zone);
  if v_slot.zone = 'picking' and exists (
    select 1 from public.warehouse_stock_positions p where p.set_id = v_set.id
      and p.location_id = v_location_id and app.warehouse_qr_audit_is_active(p)
  ) then raise exception '기존 출고창고 재고를 먼저 정리하거나 빈 자리를 선택해주세요.' using errcode = '22023'; end if;

  insert into app.warehouse_qr_audit_writes values (p_brand_id, pg_current_xact_id());
  insert into public.warehouse_stock_positions (
    brand_id, set_id, warehouse_id, location_id, source_style_no, normalized_style_no, source_product_name,
    received_on, received_on_raw, units_per_box, remaining_boxes, opened_units, units_per_box_raw, remaining_boxes_raw,
    quantity_status, review_flags, source_row_number, external_row_id, box_qr
  ) values (
    p_brand_id, v_set.id, v_set.warehouse_id, v_location_id, '', '', v_link.product_name,
    p_date, to_char(p_date, 'YYMMDD'), p_qty, 1, 0, p_qty::text, '1',
    'known', array['missing_style'], 1000001, 'at_manual_' || replace(v_link.id::text, '-', ''), v_qr
  ) returning * into v_position;
  delete from app.warehouse_qr_audit_writes where brand_id = p_brand_id and transaction_id = pg_current_xact_id();

  insert into public.warehouse_stock_movements
    (brand_id, set_id, action, position_id, to_location_code, box_count, unit_count, reason, actor_id)
  values (p_brand_id, v_set.id, 'receive', v_position.id, v_slot.code, 1, p_qty, 'Finder QR 상품명 입고', v_actor);
  update public.warehouse_inventory_sets set row_count = row_count + 1 where id = v_set.id;
  insert into app.warehouse_qr_audit_sheet_exports
    (id, brand_id, before_rows, after_rows, stock_actor_id, stock_request)
  values (v_link.id, p_brand_id, '[]'::jsonb,
    jsonb_build_array(app.warehouse_stock_work_sheet_row(v_position,v_slot.code)), v_actor, v_request);
  return jsonb_build_object('sheetPending', true);
end;
$$;

create function public.finder_place_named_qr(p_brand_id uuid, p_qr text, p_place text, p_date date, p_qty integer)
returns jsonb language sql security invoker set search_path = ''
as $$ select app.finder_place_named_qr(p_brand_id, p_qr, p_place, p_date, p_qty) $$;
revoke all on function app.finder_place_named_qr(uuid,text,text,date,integer),
  public.finder_place_named_qr(uuid,text,text,date,integer) from public, anon, authenticated;
grant execute on function app.finder_place_named_qr(uuid,text,text,date,integer),
  public.finder_place_named_qr(uuid,text,text,date,integer) to authenticated;
