create table app.warehouse_qr_audits (
  id uuid primary key,
  brand_id uuid not null references public.brands(id),
  location_id uuid not null references public.warehouse_locations(id),
  place text not null,
  actor_id uuid not null,
  before_rows jsonb not null,
  confirmed_rows jsonb not null,
  confirmed_at timestamptz not null default clock_timestamp()
);

create index warehouse_qr_audits_locations on app.warehouse_qr_audits (brand_id, location_id);

create table app.warehouse_qr_audit_boxes (
  audit_id uuid not null references app.warehouse_qr_audits(id),
  external_row_id text primary key,
  box_qr text not null,
  photo_path text,
  reviewed_at timestamptz,
  reviewed_by uuid
);

create index warehouse_qr_audit_boxes_audit on app.warehouse_qr_audit_boxes (audit_id);
create unique index warehouse_qr_audit_boxes_photo on app.warehouse_qr_audit_boxes (photo_path) where photo_path is not null;

-- When a previously identified box is found at another uncounted slot, its old sheet row must not reappear.
create table app.warehouse_qr_audit_moved_rows (
  brand_id uuid not null references public.brands(id),
  external_row_id text not null,
  primary key (brand_id, external_row_id)
);

alter table app.warehouse_qr_audits enable row level security;
alter table app.warehouse_qr_audit_boxes enable row level security;
alter table app.warehouse_qr_audit_moved_rows enable row level security;
revoke all on app.warehouse_qr_audits, app.warehouse_qr_audit_boxes, app.warehouse_qr_audit_moved_rows
  from public, anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('warehouse-qr-audit', 'warehouse-qr-audit', false, 10485760, array['image/jpeg']);

create function app.can_review_warehouse_qr_audit(p_brand_id uuid)
returns boolean language sql stable security invoker set search_path = ''
as $$
  select auth.uid() is not null and coalesce(
    app.can_edit_brand(p_brand_id) or app.basic_work_allowed('logistics', p_brand_id), false
  );
$$;

create function app.can_upload_warehouse_qr_audit_photo(p_name text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null
    and p_name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'
    and split_part(p_name, '/', 2) = auth.uid()::text
    and exists (select 1 from public.brands b where b.id::text = split_part(p_name, '/', 1)
      and b.slug = 'masmarulez' and app.can_use_masma_finder_feature(b.id, 'test'));
$$;

-- File names are untrusted input. Join on the path before resolving brand permissions.
create function app.can_read_warehouse_qr_audit_photo(p_name text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from app.warehouse_qr_audit_boxes item
    join app.warehouse_qr_audits audit on audit.id = item.audit_id
    where item.photo_path = p_name and app.can_review_warehouse_qr_audit(audit.brand_id)
  );
$$;

revoke all on function app.can_review_warehouse_qr_audit(uuid),
  app.can_upload_warehouse_qr_audit_photo(text), app.can_read_warehouse_qr_audit_photo(text) from public, anon;
grant execute on function app.can_upload_warehouse_qr_audit_photo(text),
  app.can_read_warehouse_qr_audit_photo(text) to authenticated;

create policy warehouse_qr_audit_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'warehouse-qr-audit' and app.can_upload_warehouse_qr_audit_photo(name));
create policy warehouse_qr_audit_read on storage.objects for select to authenticated
  using (bucket_id = 'warehouse-qr-audit' and app.can_read_warehouse_qr_audit_photo(name));

create function app.warehouse_qr_audit_is_active(p public.warehouse_stock_positions)
returns boolean language sql immutable set search_path = ''
as $$
  select p.quantity_status = 'unknown' or coalesce(p.remaining_boxes, 0) > 0 or p.opened_units > 0;
$$;

-- Grant the existing box guards permission only during the audited write's transaction.
create table app.warehouse_qr_audit_writes (
  brand_id uuid not null,
  transaction_id xid8 not null,
  primary key (brand_id, transaction_id)
);
alter table app.warehouse_qr_audit_writes enable row level security;
revoke all on app.warehouse_qr_audit_writes from public, anon, authenticated;

create function app.is_warehouse_qr_audit_write(p_brand_id uuid)
returns boolean language sql volatile security definer set search_path = ''
as $$
  select exists (
    select 1 from app.warehouse_qr_audit_writes
    where brand_id = p_brand_id and transaction_id = pg_current_xact_id_if_assigned()
  );
$$;

revoke all on function app.is_warehouse_qr_audit_write(uuid) from public, anon;
grant execute on function app.is_warehouse_qr_audit_write(uuid) to authenticated, service_role;

create or replace function app.set_warehouse_stock_box_qr()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if app.is_warehouse_qr_audit_write(new.brand_id) then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.brand_id = new.brand_id and old.external_row_id = new.external_row_id
    and exists (select 1 from app.warehouse_qr_audit_boxes i join app.warehouse_qr_audits a on a.id = i.audit_id
      where a.brand_id = new.brand_id and i.external_row_id = new.external_row_id and i.box_qr = old.box_qr) then
    new.box_qr := old.box_qr;
    return new;
  end if;
  new.box_qr := null;
  if new.external_row_id is not null and new.style_id is not null then
    select r.display_code into new.box_qr
    from app.masma_finder_inbound_sheet r
    join public.warehouse_boxes b on b.id = r.box_id and b.brand_id = r.brand_id
    where r.brand_id = new.brand_id and r.sheet_row_id = new.external_row_id
      and b.style_id = new.style_id and (r.receipt->>'receivedOn')::date = new.received_on;
  end if;
  return new;
end;
$$;

create or replace function app.guard_finder_warehouse_box_location()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if new.presumed_depleted_at is not null or
    (tg_op = 'UPDATE' and old.presumed_depleted_at is not null) then
    if (app.has_masma_finder_sheet_write_key() is not true and not app.is_warehouse_qr_audit_write(new.brand_id)) or tg_op <> 'UPDATE' or
      old.archived_at is not null or old.completed_at is not null then
      raise exception '소진 추정 박스는 Finder에서만 수정할 수 있습니다.' using errcode = '42501';
    end if;
    if new.presumed_depleted_at is not null and not app.is_warehouse_qr_audit_write(new.brand_id) and
      (to_jsonb(new) - array['location_id','presumed_depleted_at','updated_at']) is distinct from
      (to_jsonb(old) - array['location_id','presumed_depleted_at','updated_at']) then
      raise exception '소진 추정 시 박스 위치만 비울 수 있습니다.';
    end if;
  end if;
  return new;
end;
$$;

-- The existing boundary function requires a location. Its ordinary checks still
-- run when a box is recovered or moved. A sealed or opened box may be moved
-- by Finder; other callers retain the existing restriction in box storage.
create or replace function public.enforce_warehouse_box_boundaries()
returns trigger
language plpgsql
security invoker
set search_path to public
as $$
declare
  v_brand_company uuid;
  v_location_company uuid;
  v_location_warehouse uuid;
  v_location_zone text;
  v_expected_warehouse uuid;
begin
  new.display_code := upper(btrim(new.display_code));
  new.note := coalesce(new.note, '');
  new.usage_priority := coalesce(new.usage_priority, 'fifo');

  if new.presumed_depleted_at is not null then
    return new;
  end if;

  if tg_op = 'UPDATE'
    and old.archived_at is null
    and new.archived_at is not null then
    raise exception '보관 처리는 더 이상 사용할 수 없습니다. 소진 또는 박스 출고로 종료하세요.';
  end if;

  if tg_op = 'UPDATE' and old.archived_at is not null then
    if new.archived_at is distinct from old.archived_at
      or new.completed_at is distinct from old.completed_at
      or new.completion_kind is distinct from old.completion_kind
      or new.current_qty is distinct from old.current_qty
      or new.location_id is distinct from old.location_id
      or new.usage_priority is distinct from old.usage_priority
      or new.note is distinct from old.note
      or new.display_code is distinct from old.display_code
      or new.style_id is distinct from old.style_id
      or new.initial_qty is distinct from old.initial_qty
      or new.received_on is distinct from old.received_on
    then
      raise exception '보관된 박스는 수정할 수 없습니다.';
    end if;
  end if;

  if tg_op = 'UPDATE' and old.completed_at is not null then
    if new.completed_at is distinct from old.completed_at
      or new.completed_by is distinct from old.completed_by
      or new.completion_kind is distinct from old.completion_kind
      or new.current_qty is distinct from old.current_qty
      or new.location_id is distinct from old.location_id
      or new.usage_priority is distinct from old.usage_priority
      or new.note is distinct from old.note
      or new.display_code is distinct from old.display_code
      or new.style_id is distinct from old.style_id
      or new.initial_qty is distinct from old.initial_qty
      or new.received_on is distinct from old.received_on
    then
      raise exception '종료된 박스는 수정할 수 없습니다.';
    end if;
  end if;

  if new.current_qty > new.initial_qty then
    raise exception '현재 수량은 최초 입수보다 많을 수 없습니다.';
  end if;

  select loc.company_id, loc.warehouse_id, loc.zone
    into v_location_company, v_location_warehouse, v_location_zone
  from public.warehouse_locations as loc
  where loc.id = new.location_id;

  if v_location_zone = 'box_storage'
    and new.current_qty <> new.initial_qty
    and new.completion_kind is distinct from 'box_outbound'
    and not app.is_warehouse_qr_audit_write(new.brand_id)
    and not (case when coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb ? 'x-finder-write-key'
      then coalesce(app.has_masma_finder_sheet_write_key(), false) else false end) then
    raise exception '박스창고에서는 개봉하거나 수량을 차감할 수 없습니다. 택배 포장 또는 대량 출고 자리로 먼저 이동하세요.';
  end if;

  new.status := app.warehouse_box_status(new.initial_qty, new.current_qty);

  if new.completed_at is not null then
    if new.current_qty <> 0 then
      raise exception '종료된 박스의 현재 수량은 0이어야 합니다.';
    end if;
    if new.completion_kind not in ('depleted', 'box_outbound') then
      raise exception '종료 종류가 올바르지 않습니다.';
    end if;
  end if;

  select brand.company_id
    into v_brand_company
  from public.brands as brand
  where brand.id = new.brand_id;

  select resolved.warehouse_id
    into v_expected_warehouse
  from app.resolve_brand_warehouse(new.brand_id) as resolved;

  if v_brand_company is null
    or v_location_company is distinct from v_brand_company then
    raise exception '박스 자리가 브랜드 창고와 맞지 않습니다.';
  end if;
  if v_expected_warehouse is not null
    and v_location_warehouse is distinct from v_expected_warehouse then
    raise exception '박스 자리가 브랜드 창고와 맞지 않습니다.';
  end if;

  return new;
end;
$$;



create function app.sync_warehouse_qr_audit_box(p public.warehouse_stock_positions, p_style_id uuid, p_actor_id uuid)
returns void language plpgsql set search_path = ''
as $$
declare
  v_current integer;
begin
  if p_style_id is null or p.quantity_status = 'unknown' or p.units_per_box is null then
    -- The shared position still records this physical box and QR for review.
    return;
  end if;
  v_current := case when p.opened_units > 0 then p.opened_units else p.units_per_box end;
  insert into public.warehouse_boxes (
    brand_id, display_code, location_id, style_id, received_on, initial_qty, current_qty,
    source_position_id, note, usage_priority, created_by
  ) values (
    p.brand_id, upper(p.box_qr), p.location_id, p_style_id, p.received_on,
    p.units_per_box, v_current, p.id, p.note, p.usage_priority, p_actor_id
  ) on conflict (brand_id, display_code) do update set
    location_id = excluded.location_id, style_id = excluded.style_id,
    received_on = coalesce(public.warehouse_boxes.received_on, excluded.received_on),
    initial_qty = excluded.initial_qty, current_qty = excluded.current_qty,
    source_position_id = excluded.source_position_id, presumed_depleted_at = null,
    updated_at = now()
  where public.warehouse_boxes.archived_at is null and public.warehouse_boxes.completed_at is null;
  if not found then raise exception '출고 또는 보관된 박스는 실사로 다시 열 수 없습니다.'; end if;
  delete from app.finder_warehouse_presumed_boxes where brand_id = p.brand_id and box_qr = upper(p.box_qr);
end;
$$;

revoke all on function app.sync_warehouse_qr_audit_box(public.warehouse_stock_positions,uuid,uuid)
  from public, anon, authenticated;

create function app.finder_warehouse_qr_audit(p_brand_id uuid, p_action text, p_request jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_place text := upper(btrim(p_request->>'place'));
  v_id uuid := (p_request->>'id')::uuid;
  v_entries jsonb := p_request->'entries';
  v_set public.warehouse_inventory_sets;
  v_slot public.warehouse_registered_slots;
  v_location uuid;
  v_before jsonb;
  v_baseline text;
  v_plan jsonb := '[]'::jsonb;
  v_token text;
  v_result jsonb;
  v_entry record;
  v_source public.warehouse_stock_positions;
  v_original public.warehouse_stock_positions;
  v_external text;
  v_style_no text;
  v_name text;
  v_units integer;
  v_boxes integer;
  v_opened integer;
  v_unknown boolean;
  v_other_place text;
  v_new public.warehouse_stock_positions;
  v_reference_id uuid;
begin
  if v_actor is null or not coalesce(app.can_use_masma_finder_feature(p_brand_id, 'test'), false)
    or not exists (select 1 from public.brands where id = p_brand_id and slug = 'masmarulez') then
    raise exception 'QR 연결 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('place', 'preview', 'confirm') or coalesce(v_place, '') = '' then
    raise exception '자리와 작업을 확인해주세요.' using errcode = '22023';
  end if;

  if p_action = 'confirm' then
    perform pg_advisory_xact_lock(hashtextextended('finder-placement/' || p_brand_id::text, 0));
  end if;
  if p_action in ('preview', 'confirm') then
    select jsonb_build_object('boxes', jsonb_array_length(a.confirmed_rows), 'place', a.place, 'complete', true)
    into v_result from app.warehouse_qr_audits a
    where a.id = v_id and a.brand_id = p_brand_id and a.actor_id = v_actor and a.place = v_place;
    if found then return v_result; end if;
  end if;
  if p_action = 'confirm' then
    -- Normal stock edits also take this lock implicitly when writing to the table.
    lock table public.warehouse_stock_positions in share row exclusive mode;
    if exists (select 1 from app.finder_warehouse_placement_operations where brand_id = p_brand_id
      and finished_at is null and cancelled_at is null)
      or exists (select 1 from app.finder_warehouse_sheet_exports where brand_id = p_brand_id and sheet_synced_at is null)
      or exists (select 1 from app.warehouse_stock_condition_exports where brand_id = p_brand_id and sheet_synced_at is null) then
      raise exception '시트 저장이 대기 중인 창고 작업이 있습니다. 완료 후 다시 시도해주세요.';
    end if;
  end if;

  select * into v_set from public.warehouse_inventory_sets
  where brand_id = p_brand_id and kind = 'sandbox' and status = 'active';
  if not found then raise exception '활성 창고 재고가 없습니다.'; end if;

  select * into v_slot from public.warehouse_registered_slots
  where warehouse_id = v_set.warehouse_id and upper(code) = v_place;
  if not found then raise exception '등록된 창고 자리를 입력하거나 자리 QR을 찍어주세요.'; end if;
  select l.id into v_location from public.warehouse_locations l
  where l.warehouse_id = v_set.warehouse_id and l.zone = v_slot.zone and upper(l.code) = v_place;

  select coalesce(jsonb_agg(to_jsonb(p) order by p.id), '[]'::jsonb) into v_before
  from public.warehouse_stock_positions p
  where p.set_id = v_set.id and p.brand_id = p_brand_id and p.location_id = v_location;
  v_baseline := md5(v_set.id::text || v_before::text);

  if p_action = 'place' then
    return jsonb_build_object('place', v_slot.code, 'baseline', v_baseline, 'rows', v_before);
  end if;
  if p_request->>'baseline' is distinct from v_baseline then
    raise exception '실사 중 기존 자리 재고가 바뀌었습니다. 자리를 다시 조회해 목록을 비교해주세요.' using errcode = '40001';
  end if;
  if v_id is null or jsonb_typeof(v_entries) is distinct from 'array' or jsonb_array_length(v_entries) > 2000 then
    raise exception '실사 작업과 박스 목록을 확인해주세요.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(v_entries) as i(qr text)
    group by upper(btrim(i.qr)) having count(*) > 1
  ) then raise exception '같은 박스 QR이 실사 목록에 두 번 들어 있습니다.'; end if;

  for v_entry in
    select * from jsonb_to_recordset(v_entries)
      as r(qr text, source_id uuid, photo_path text, units integer, opened boolean)
  loop
    v_entry.qr := upper(btrim(v_entry.qr));
    v_source := null;
    v_original := null;
    v_other_place := null;
    if v_entry.qr is null or v_entry.qr = '' or length(v_entry.qr) > 200
      or exists (select 1 from public.warehouse_registered_slots
        where warehouse_id = v_set.warehouse_id and upper(code) = v_entry.qr) then
      raise exception '박스 QR을 확인해주세요. 자리 QR은 연결할 수 없습니다.';
    end if;
    if v_entry.units is not null and (v_entry.units < 1 or v_entry.units > 1000000) then
      raise exception '박스 수량을 확인해주세요.';
    end if;
    if v_entry.source_id is null then
      if v_entry.photo_path is null or not app.can_upload_warehouse_qr_audit_photo(v_entry.photo_path)
        or split_part(v_entry.photo_path, '/', 1) <> p_brand_id::text
        or split_part(v_entry.photo_path, '/', 3) <> v_id::text or not exists (
          select 1 from storage.objects
          where bucket_id = 'warehouse-qr-audit' and name = v_entry.photo_path
        ) then
        raise exception '상품을 확인하지 못한 박스는 사진을 올려주세요.';
      end if;
    else
      if v_entry.photo_path is not null then raise exception '박스의 상품이나 사진 중 하나를 선택해주세요.'; end if;
      select p.* into v_source from jsonb_populate_recordset(null::public.warehouse_stock_positions, v_before) p
      where p.id = v_entry.source_id and btrim(p.source_product_name) not in ('', '상품 확인 대기')
        and (coalesce(p.box_qr, '') = '' or upper(p.box_qr) = v_entry.qr);
      if not found then raise exception '선택한 상품이 해당 자리의 QR과 맞지 않습니다.'; end if;
    end if;

    if exists (
      select 1 from public.warehouse_boxes b where b.brand_id = p_brand_id and b.display_code = v_entry.qr
        and (b.completed_at is not null or b.archived_at is not null)
    ) then raise exception '이미 출고 또는 보관 처리된 QR이 있습니다.'; end if;

    select p.* into v_original from public.warehouse_stock_positions p
    where p.set_id = v_set.id and p.brand_id = p_brand_id and upper(p.box_qr) = v_entry.qr;
    if found then
      if (select count(*) from public.warehouse_stock_positions p
        where p.set_id = v_set.id and p.brand_id = p_brand_id and upper(p.box_qr) = v_entry.qr) > 1 then
        raise exception '이미 여러 재고 행에 연결된 QR이 있습니다. 중복을 먼저 확인해주세요.';
      end if;
      if v_original.location_id is distinct from v_location then
        select code into v_other_place from public.warehouse_locations where id = v_original.location_id;
      end if;
      if v_source.id is not null and (v_source.style_id is distinct from v_original.style_id
        or v_source.source_product_name is distinct from v_original.source_product_name) then
        raise exception '이미 다른 상품에 연결된 QR입니다. 사진을 남겨 검수로 넘겨주세요.';
      end if;
    elsif exists (
      select 1 from public.warehouse_boxes b where b.brand_id = p_brand_id and b.display_code = v_entry.qr
        and b.location_id is distinct from v_location and b.presumed_depleted_at is null
    ) then
      raise exception '개별 박스 원장에 다른 위치로 등록된 QR입니다. 기존 위치를 먼저 확인해주세요.';
    end if;

    v_plan := v_plan || jsonb_build_array(jsonb_build_object(
      'qr', v_entry.qr, 'source', to_jsonb(v_source), 'original', to_jsonb(v_original),
      'fromPlace', v_other_place, 'photoPath', v_entry.photo_path,
      'units', v_entry.units, 'opened', coalesce(v_entry.opened, false), 'name', v_source.source_product_name
    ));
  end loop;

  if (select count(distinct p->>'photoPath') from jsonb_array_elements(v_plan) p) <>
    (select count(*) from jsonb_array_elements(v_plan) p where p->>'photoPath' is not null) then
    raise exception '같은 사진이 여러 박스에 연결되어 있습니다.';
  end if;
  v_token := md5(v_baseline || v_id::text || v_plan::text);
  if p_action = 'preview' then
    return jsonb_build_object('token', v_token, 'before', v_before, 'boxes', (
      select coalesce(jsonb_agg(jsonb_build_object('qr', p->>'qr', 'name', p->>'name',
        'fromPlace', p->>'fromPlace', 'units', p->'units', 'opened', p->'opened')), '[]'::jsonb)
      from jsonb_array_elements(v_plan) p
    ));
  end if;
  if p_request->>'token' is distinct from v_token then
    raise exception '변경 내역이 달라졌습니다. 다시 확인해주세요.' using errcode = '40001';
  end if;

  v_location := app.ensure_warehouse_box_location(p_brand_id, v_slot.code, v_slot.zone);
  insert into app.warehouse_qr_audits (id, brand_id, location_id, place, actor_id, before_rows, confirmed_rows)
  values (v_id, p_brand_id, v_location, v_slot.code, v_actor, v_before, v_plan);
  insert into app.warehouse_qr_audit_writes values (p_brand_id, pg_current_xact_id());

  insert into app.warehouse_qr_audit_moved_rows (brand_id, external_row_id)
  select p_brand_id, i.value->'original'->>'external_row_id'
  from jsonb_array_elements(v_plan) i
  where i.value->>'fromPlace' is not null and nullif(i.value->'original'->>'external_row_id', '') is not null
  on conflict do nothing;

  insert into app.finder_warehouse_presumed_boxes (brand_id, box_qr, snapshot)
  select p_brand_id, upper(p.box_qr), jsonb_build_object('row', to_jsonb(p), 'place', v_slot.code, 'zone', v_slot.zone)
  from jsonb_populate_recordset(null::public.warehouse_stock_positions, v_before) p
  where nullif(p.box_qr, '') is not null and not exists (
    select 1 from jsonb_array_elements(v_plan) i where i->>'qr' = upper(p.box_qr)
  ) and exists (select 1 from public.warehouse_boxes b where b.brand_id = p_brand_id
    and b.display_code = upper(p.box_qr) and b.completed_at is null and b.archived_at is null)
  on conflict (brand_id, box_qr) do update set snapshot = excluded.snapshot;

  -- Remove the old location from the box ledger until the observed box has a usable product and quantity.
  update public.warehouse_boxes b set location_id = null, source_position_id = null,
    presumed_depleted_at = clock_timestamp()
  where b.brand_id = p_brand_id and b.archived_at is null and b.completed_at is null
    and (
      exists (select 1 from jsonb_populate_recordset(null::public.warehouse_stock_positions, v_before) p
        where p.id = b.source_position_id or upper(p.box_qr) = b.display_code)
      or exists (select 1 from jsonb_array_elements(v_plan) i where i->>'qr' = b.display_code)
    );

  delete from public.warehouse_stock_positions p
  where p.set_id = v_set.id and p.brand_id = p_brand_id
    and (p.location_id = v_location or p.id in (
      select (item->'original'->>'id')::uuid from jsonb_array_elements(v_plan) item
    ));

  for v_entry in select value as item, ordinality as ordinal
    from jsonb_array_elements(v_plan) with ordinality
  loop
    v_source := jsonb_populate_record(null::public.warehouse_stock_positions, nullif(v_entry.item->'source', 'null'::jsonb));
    v_original := jsonb_populate_record(null::public.warehouse_stock_positions, nullif(v_entry.item->'original', 'null'::jsonb));
    v_external := 'qa_' || replace(v_id::text, '-', '') || '_' || v_entry.ordinal;
    v_style_no := case when v_source.style_id is null then '' else v_source.normalized_style_no end;
    v_name := coalesce(v_source.source_product_name, '상품 확인 대기');
    v_units := (v_entry.item->>'units')::integer;
    v_unknown := v_units is null;
    v_opened := case when (v_entry.item->>'opened')::boolean then coalesce(v_units, 0) else 0 end;
    v_boxes := case when v_opened > 0 then 0 else 1 end;

    insert into public.warehouse_stock_positions (
      brand_id, set_id, warehouse_id, location_id, style_id, source_style_no, normalized_style_no,
      source_product_name, received_on, received_on_raw, usage_priority, is_final_location,
      is_forced_priority, quantity_status, units_per_box, remaining_boxes, opened_units, units_per_box_raw,
      remaining_boxes_raw, review_flags, source_row_number, note, external_row_id, box_qr
    ) values (
      p_brand_id, v_set.id, v_set.warehouse_id, v_location, v_source.style_id,
      case when v_source.style_id is null then '' else v_source.source_style_no end,
      v_style_no, v_name, coalesce(v_original.received_on, v_source.received_on),
      coalesce(v_original.received_on_raw, v_source.received_on_raw, ''), coalesce(v_original.usage_priority, v_source.usage_priority, 'fifo'),
      coalesce(v_source.is_final_location, false), coalesce(v_source.is_forced_priority, false), case when v_unknown then 'unknown' else 'known' end,
      case when v_opened > 0 then greatest(coalesce(v_source.units_per_box, 0), v_units) else v_units end,
      v_boxes, v_opened,
      coalesce((case when v_opened > 0 then greatest(coalesce(v_source.units_per_box, 0), v_units) else v_units end)::text, ''),
      v_boxes::text, array_remove(array[case when v_source.style_id is null then 'missing_style' end,
        case when v_unknown then 'quantity_unknown' end], null), 1000000 + v_entry.ordinal,
      coalesce(v_source.note, ''), v_external, v_entry.item->>'qr'
    ) returning * into v_new;

    insert into public.warehouse_stock_condition_links (brand_id, external_row_id, source_product_name, reference_style_id, condition)
    select p_brand_id, v_external, source_product_name, reference_style_id, condition
    from public.warehouse_stock_condition_links
    where brand_id = p_brand_id and external_row_id = v_source.external_row_id and source_product_name = v_name;

    select reference_style_id into v_reference_id from public.warehouse_stock_condition_links
    where brand_id = p_brand_id and external_row_id = v_external;
    perform app.sync_warehouse_qr_audit_box(v_new, coalesce(v_new.style_id, v_reference_id), v_actor);

    insert into app.warehouse_qr_audit_boxes (audit_id, external_row_id, box_qr, photo_path)
    values (v_id, v_external, v_entry.item->>'qr', v_entry.item->>'photoPath');
  end loop;

  insert into public.warehouse_stock_movements (brand_id, set_id, action, from_location_code, to_location_code, box_count, reason, actor_id)
  values (p_brand_id, v_set.id, 'adjust', v_slot.code, v_slot.code, jsonb_array_length(v_plan), '자리 실사 및 QR 연결', v_actor);
  update public.warehouse_inventory_sets s
  set row_count = (select count(*) from public.warehouse_stock_positions p where p.set_id = s.id), updated_at = now()
  where s.id = v_set.id;
  delete from app.warehouse_qr_audit_writes where brand_id = p_brand_id and transaction_id = pg_current_xact_id();
  return jsonb_build_object('boxes', jsonb_array_length(v_plan), 'place', v_slot.code);
end;
$$;

create function public.finder_warehouse_qr_audit(p_brand_id uuid, p_action text, p_request jsonb)
returns jsonb language sql security invoker set search_path = ''
as $$ select app.finder_warehouse_qr_audit(p_brand_id, p_action, p_request) $$;

revoke all on function app.finder_warehouse_qr_audit(uuid,text,jsonb),
  public.finder_warehouse_qr_audit(uuid,text,jsonb), app.warehouse_qr_audit_is_active(public.warehouse_stock_positions)
  from public, anon, authenticated;
grant execute on function app.finder_warehouse_qr_audit(uuid,text,jsonb),
  public.finder_warehouse_qr_audit(uuid,text,jsonb) to authenticated;

create function app.review_warehouse_qr_audit(p_brand_id uuid, p_action text, p_request jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_set public.warehouse_inventory_sets;
  v_item app.warehouse_qr_audit_boxes;
  v_audit app.warehouse_qr_audits;
  v_position public.warehouse_stock_positions;
  v_old public.warehouse_stock_positions;
  v_style public.styles;
  v_condition public.warehouse_stock_condition_links;
  v_name text;
  v_number text;
  v_units integer;
  v_opened boolean;
begin
  if not app.can_review_warehouse_qr_audit(p_brand_id) then
    raise exception '창고 QR 검수 권한이 없습니다.' using errcode = '42501';
  end if;

  if p_action = 'link' then
    perform pg_advisory_xact_lock(hashtextextended('finder-placement/' || p_brand_id::text, 0));
    lock table public.warehouse_stock_positions in share row exclusive mode;
  end if;

  select * into v_set from public.warehouse_inventory_sets
  where brand_id = p_brand_id and kind = 'sandbox' and status = 'active';

  if p_action = 'list' then
    return jsonb_build_object(
      'auditedPlaces', (select count(distinct location_id) from app.warehouse_qr_audits where brand_id = p_brand_id),
      'pending', (
        select count(*) from app.warehouse_qr_audit_boxes i
        join app.warehouse_qr_audits a on a.id = i.audit_id
        join public.warehouse_stock_positions p on p.brand_id = a.brand_id and p.set_id = v_set.id
          and p.external_row_id = i.external_row_id
        where a.brand_id = p_brand_id and i.photo_path is not null and i.reviewed_at is null
      ),
      'items', (
        select coalesce(jsonb_agg(to_jsonb(r) order by r.confirmed_at, r.external_row_id), '[]'::jsonb)
        from (
          select i.external_row_id, i.box_qr, i.photo_path, a.place, a.confirmed_at,
            (select coalesce(jsonb_agg(jsonb_build_object('id', old.id, 'name', old.source_product_name,
              'number', coalesce(ref.style_no, old.normalized_style_no), 'units', old.units_per_box,
              'boxes', old.remaining_boxes, 'opened', old.opened_units, 'date', old.received_on_raw)
              order by old.source_product_name, old.received_on, old.id), '[]'::jsonb)
              from jsonb_populate_recordset(null::public.warehouse_stock_positions, a.before_rows) old
              left join public.warehouse_stock_condition_links c on c.brand_id = a.brand_id
                and c.external_row_id = old.external_row_id and c.source_product_name = old.source_product_name
              left join public.styles ref on ref.brand_id = a.brand_id and ref.id = c.reference_style_id
            ) as candidates
          from app.warehouse_qr_audit_boxes i
          join app.warehouse_qr_audits a on a.id = i.audit_id
          join public.warehouse_stock_positions p on p.brand_id = a.brand_id and p.set_id = v_set.id
            and p.external_row_id = i.external_row_id
          where a.brand_id = p_brand_id and i.photo_path is not null and i.reviewed_at is null
          order by a.confirmed_at, i.external_row_id limit 100
        ) r
      )
    );
  end if;

  if p_action is distinct from 'link' then
    raise exception 'QR 검수 작업을 확인해주세요.' using errcode = '22023';
  end if;
  select i.* into v_item from app.warehouse_qr_audit_boxes i
  join app.warehouse_qr_audits a on a.id = i.audit_id and a.brand_id = p_brand_id
  where i.external_row_id = p_request->>'rowId' and i.photo_path is not null for update of i;
  if not found then raise exception '검수할 박스를 찾지 못했습니다.'; end if;
  if v_item.reviewed_at is not null then raise exception '이미 검수한 박스입니다. 목록을 새로고침해주세요.'; end if;

  select * into v_audit from app.warehouse_qr_audits where id = v_item.audit_id;
  select * into v_position from public.warehouse_stock_positions
  where brand_id = p_brand_id and set_id = v_set.id and external_row_id = v_item.external_row_id;
  if not found then raise exception '활성 재고에 없는 박스입니다. 최신 목록을 확인해주세요.'; end if;

  v_units := (p_request->>'units')::integer;
  v_opened := coalesce((p_request->>'opened')::boolean, false);
  if v_units is not null and (v_units < 1 or v_units > 1000000) then raise exception '박스 수량을 확인해주세요.'; end if;
  if nullif(p_request->>'candidateId', '') is not null then
    select old.* into v_old from jsonb_populate_recordset(null::public.warehouse_stock_positions, v_audit.before_rows) old
    where old.id = (p_request->>'candidateId')::uuid;
    if not found then raise exception '실사 전 자리 목록에서 상품을 다시 선택해주세요.'; end if;
    select * into v_condition from public.warehouse_stock_condition_links c
    where c.brand_id = p_brand_id and c.external_row_id = v_old.external_row_id
      and c.source_product_name = v_old.source_product_name;
    v_name := v_old.source_product_name;
    if v_old.style_id is not null then
      select * into strict v_style from public.styles where brand_id = p_brand_id and id = v_old.style_id;
      v_number := v_old.normalized_style_no;
    end if;
  elsif nullif(p_request->>'styleId', '') is not null then
    select * into v_style from public.styles where brand_id = p_brand_id and id = (p_request->>'styleId')::uuid;
    if not found then raise exception '같은 브랜드의 정식 상품을 선택해주세요.'; end if;
    v_name := v_style.name;
    v_number := upper(regexp_replace(v_style.style_no, '\s+', '', 'g'));
  else
    v_name := btrim(p_request->>'name');
  end if;
  if coalesce(v_name, '') in ('', '상품 확인 대기') or length(v_name) > 300 then
    raise exception '확인한 상품명을 입력해주세요.';
  end if;

  update public.warehouse_stock_positions set style_id = v_style.id,
    source_style_no = coalesce(v_style.style_no, ''), normalized_style_no = coalesce(v_number, ''),
    source_product_name = v_name, received_on = coalesce(v_old.received_on, received_on),
    received_on_raw = coalesce(v_old.received_on_raw, received_on_raw),
    quantity_status = case when v_units is null then 'unknown' else 'known' end,
    units_per_box = case when v_opened and v_units is not null then greatest(coalesce(v_old.units_per_box, 0), v_units) else v_units end,
    remaining_boxes = case when v_opened and v_units is not null then 0 else 1 end,
    opened_units = case when v_opened then coalesce(v_units, 0) else 0 end,
    units_per_box_raw = case when v_units is null then '' when v_opened then greatest(coalesce(v_old.units_per_box, 0), v_units)::text else v_units::text end,
    remaining_boxes_raw = case when v_opened and v_units is not null then '0' else '1' end,
    review_flags = array_remove(array[case when v_style.id is null then 'missing_style' end,
      case when v_units is null then 'quantity_unknown' end], null)
  where id = v_position.id returning * into v_position;
  if v_condition.reference_style_id is not null then
    insert into public.warehouse_stock_condition_links (brand_id, external_row_id, source_product_name, reference_style_id, condition)
    values (p_brand_id, v_item.external_row_id, v_name, v_condition.reference_style_id, v_condition.condition);
  end if;
  insert into app.warehouse_qr_audit_writes values (p_brand_id, pg_current_xact_id());
  perform app.sync_warehouse_qr_audit_box(v_position, coalesce(v_style.id, v_condition.reference_style_id), auth.uid());
  delete from app.warehouse_qr_audit_writes where brand_id = p_brand_id and transaction_id = pg_current_xact_id();
  update app.warehouse_qr_audit_boxes
    set reviewed_at = clock_timestamp(), reviewed_by = auth.uid() where external_row_id = v_item.external_row_id;
  update public.warehouse_inventory_sets set updated_at = now() where id = v_set.id;
  return jsonb_build_object('ok', true);
end;
$$;

create function public.review_warehouse_qr_audit(p_brand_id uuid, p_action text, p_request jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path = ''
as $$ select app.review_warehouse_qr_audit(p_brand_id, p_action, p_request) $$;

revoke all on function app.review_warehouse_qr_audit(uuid,text,jsonb),
  public.review_warehouse_qr_audit(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function app.review_warehouse_qr_audit(uuid,text,jsonb),
  public.review_warehouse_qr_audit(uuid,text,jsonb) to authenticated;

-- Audited slots use the current database inventory when an older worksheet is imported.
alter function public.replace_warehouse_inventory_snapshot_with_box_qr(uuid,text,jsonb,timestamptz)
  rename to replace_warehouse_inventory_snapshot_before_qr_audit;
revoke all on function public.replace_warehouse_inventory_snapshot_before_qr_audit(uuid,text,jsonb,timestamptz)
  from public, anon, authenticated, service_role;

create function public.replace_warehouse_inventory_snapshot_with_box_qr(
  p_brand_id uuid, p_source_file_name text, p_rows jsonb, p_snapshot_at timestamptz
)
returns public.warehouse_inventory_sets
language plpgsql security definer set search_path = ''
as $$
declare
  v_set public.warehouse_inventory_sets;
  v_db_rows jsonb;
  v_sheet_rows jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception '동기화 서버만 실행할 수 있습니다.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('finder-placement/' || p_brand_id::text, 0));

  if not exists (select 1 from app.warehouse_qr_audits where brand_id = p_brand_id) then
    return public.replace_warehouse_inventory_snapshot_before_qr_audit(p_brand_id, p_source_file_name, p_rows, p_snapshot_at);
  end if;

  lock table public.warehouse_stock_positions in share row exclusive mode;

  select coalesce(jsonb_agg(to_jsonb(p) || jsonb_build_object('location_code', l.code, 'zone', l.zone,
    'external_row_id', coalesce(p.external_row_id, 'qd_' || replace(p.id::text, '-', ''))) order by p.source_row_number, p.id), '[]'::jsonb)
  into v_db_rows
  from public.warehouse_stock_positions p
  join public.warehouse_inventory_sets s on s.id = p.set_id and s.kind = 'sandbox' and s.status = 'active'
  join public.warehouse_locations l on l.id = p.location_id
  where p.brand_id = p_brand_id and (
    exists (select 1 from app.warehouse_qr_audits a where a.brand_id = p_brand_id and a.location_id = p.location_id)
    or exists (select 1 from app.warehouse_qr_audit_boxes i where i.external_row_id = p.external_row_id)
  ) and app.warehouse_qr_audit_is_active(p);

  select coalesce(jsonb_agg(r.value order by r.ordinality), '[]'::jsonb) into v_sheet_rows
  from jsonb_array_elements(p_rows) with ordinality r
  where not exists (
    select 1 from app.warehouse_qr_audits a
    join public.warehouse_inventory_sets s on s.brand_id = a.brand_id and s.kind = 'sandbox' and s.status = 'active'
    join public.warehouse_locations l on l.id = a.location_id and l.warehouse_id = s.warehouse_id
    where a.brand_id = p_brand_id and upper(a.place) = upper(btrim(r.value->>'location_code'))
  ) and not exists (
    select 1 from app.warehouse_qr_audit_moved_rows m
    where m.brand_id = p_brand_id and m.external_row_id = btrim(r.value->>'external_row_id')
      and not exists (select 1 from public.warehouse_stock_positions p
        join public.warehouse_inventory_sets s on s.id = p.set_id and s.kind = 'sandbox' and s.status = 'active'
        where p.brand_id = p_brand_id and p.external_row_id = m.external_row_id and app.warehouse_qr_audit_is_active(p))
  ) and not exists (
    select 1 from jsonb_array_elements(v_db_rows) d
    where d->>'external_row_id' = btrim(r.value->>'external_row_id')
      or (nullif(btrim(r.value->>'box_qr'), '') is not null and upper(d->>'box_qr') = upper(btrim(r.value->>'box_qr')))
  );

  v_set := public.replace_warehouse_inventory_snapshot_before_qr_audit(
    p_brand_id, p_source_file_name, v_sheet_rows || v_db_rows, p_snapshot_at);

  update public.warehouse_stock_positions p
  set opened_units = r.opened_units
  from jsonb_to_recordset(v_db_rows) r(external_row_id text, opened_units integer)
  where p.set_id = v_set.id and p.external_row_id = r.external_row_id and r.opened_units > 0;

  return v_set;
end;
$$;

revoke all on function public.replace_warehouse_inventory_snapshot_with_box_qr(uuid,text,jsonb,timestamptz)
  from public, anon, authenticated;
grant execute on function public.replace_warehouse_inventory_snapshot_with_box_qr(uuid,text,jsonb,timestamptz)
  to service_role;

-- A physical count can create AA identities that do not exist in the source sheet.
-- Keep condition history for those boxes in the DB without putting them in the sheet-export queue.
create table app.warehouse_qr_audit_conditions (
  brand_id uuid not null references public.brands(id),
  request_id uuid not null,
  external_row_id text not null,
  restore_values jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (brand_id, request_id)
);
create index warehouse_qr_audit_conditions_row on app.warehouse_qr_audit_conditions (brand_id, external_row_id);
alter table app.warehouse_qr_audit_conditions enable row level security;
revoke all on app.warehouse_qr_audit_conditions from public, anon, authenticated;

alter function public.save_warehouse_stock_condition(uuid,uuid,uuid,text,text,jsonb)
  rename to save_warehouse_stock_condition_before_qr_audit;
revoke all on function public.save_warehouse_stock_condition_before_qr_audit(uuid,uuid,uuid,text,text,jsonb)
  from public, anon, authenticated;

create function public.save_warehouse_stock_condition(
  p_brand_id uuid, p_request_id uuid, p_position_id uuid, p_condition text,
  p_expected_condition text, p_receive jsonb default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_external text;
  v_export app.warehouse_stock_condition_exports;
  v_restore jsonb;
  v_result jsonb;
begin
  if not app.can_review_warehouse_qr_audit(p_brand_id) then
    raise exception '창고 재고를 수정할 권한이 없습니다.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('finder-placement/' || p_brand_id::text, 0));
  if exists (select 1 from app.warehouse_qr_audit_conditions where brand_id = p_brand_id and request_id = p_request_id) then
    return jsonb_build_object('sheetPending', false);
  end if;
  select p.external_row_id into v_external from public.warehouse_stock_positions p
  join app.warehouse_qr_audit_boxes i on p.external_row_id = i.external_row_id
  join app.warehouse_qr_audits a on a.id = i.audit_id and a.brand_id = p.brand_id
  where p.brand_id = p_brand_id and p.id = p_position_id;
  v_result := public.save_warehouse_stock_condition_before_qr_audit(
    p_brand_id, p_request_id, p_position_id, p_condition, p_expected_condition, p_receive
  );
  if v_external is null then return v_result; end if;

  delete from app.warehouse_stock_condition_exports e
  where e.brand_id = p_brand_id and e.request_id = p_request_id and e.external_row_id = v_external
  returning * into v_export;
  if not found then return v_result; end if;

  -- Every row in a single condition cycle keeps the normal label used before the change.
  select c.restore_values into v_restore from app.warehouse_qr_audit_conditions c
  where c.brand_id = p_brand_id and c.external_row_id = v_external
  order by c.created_at desc, c.request_id limit 1;
  if p_expected_condition = 'normal' or v_restore is null then
    v_restore := v_export.restore_values;
  end if;
  if p_condition = 'normal' then
    update public.warehouse_stock_positions set source_product_name = v_restore->>'productName',
      source_style_no = v_restore->>'number' where id = p_position_id and brand_id = p_brand_id;
  end if;
  insert into app.warehouse_qr_audit_conditions (brand_id, request_id, external_row_id, restore_values)
  values (p_brand_id, p_request_id, v_external, v_restore);
  return jsonb_build_object('sheetPending', false);
end;
$$;

revoke all on function public.save_warehouse_stock_condition(uuid,uuid,uuid,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.save_warehouse_stock_condition(uuid,uuid,uuid,text,text,jsonb) to authenticated;
