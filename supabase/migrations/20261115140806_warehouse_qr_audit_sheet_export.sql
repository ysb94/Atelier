create table app.warehouse_qr_audit_sheet_exports (
  id uuid primary key,
  brand_id uuid not null references public.brands(id),
  whole_place text,
  before_rows jsonb not null,
  after_rows jsonb not null,
  queued_at timestamptz not null default clock_timestamp(),
  sheet_synced_at timestamptz
);

create index warehouse_qr_audit_sheet_exports_pending
  on app.warehouse_qr_audit_sheet_exports (brand_id, queued_at) where sheet_synced_at is null;
alter table app.warehouse_qr_audit_sheet_exports enable row level security;
revoke all on app.warehouse_qr_audit_sheet_exports from public, anon, authenticated;

create function app.warehouse_qr_audit_sheet_row(p public.warehouse_stock_positions, p_place text)
returns jsonb language sql immutable set search_path = ''
as $$
  select jsonb_build_object('id', p.external_row_id, 'qr', coalesce(p.box_qr, ''),
    'values', jsonb_build_array(p.source_style_no, p.source_product_name,
      p_place || case when p.is_final_location then '//' else '' end, p.received_on_raw,
      p.units_per_box_raw, p.remaining_boxes_raw,
      concat_ws(' · ', case when p.opened_units > 0 then '개봉 잔량 ' || p.opened_units || '개' end, nullif(p.note,''))));
$$;

create function app.warehouse_qr_audit_sheet_pending(p_brand_id uuid, p_place text, p_qr text default null, p_row_id text default null)
returns boolean language sql stable set search_path = ''
as $$
  select exists (
    select 1 from app.warehouse_qr_audit_sheet_exports e
    where e.brand_id = p_brand_id and e.sheet_synced_at is null and (
      upper(e.whole_place) = upper(btrim(p_place))
      or exists (
        select 1 from jsonb_array_elements(e.before_rows || e.after_rows) as r
        where (nullif(btrim(p_place), '') is not null and
          upper(regexp_replace(r->'values'->>2, '//[[:space:]]*$', '')) = upper(btrim(p_place)))
          or (nullif(btrim(p_qr), '') is not null and upper(r->>'qr') = upper(btrim(p_qr)))
          or r->>'id' = p_row_id
      )
    )
  );
$$;

create function app.assert_warehouse_qr_audit_sheet_ready(p_brand_id uuid, p_place text, p_qr text default null, p_row_id text default null)
returns void language plpgsql set search_path = ''
as $$
begin
  if app.warehouse_qr_audit_sheet_pending(p_brand_id, p_place, p_qr, p_row_id) then
    raise exception '이 자리 또는 박스의 실사 결과가 창고입력에 반영되는 중입니다. 잠시 후 다시 시도해주세요.'
      using errcode = 'PQA01';
  end if;
end;
$$;

alter function app.finder_warehouse_qr_audit(uuid,text,jsonb) rename to finder_warehouse_qr_audit_db;
revoke execute on function app.finder_warehouse_qr_audit_db(uuid,text,jsonb) from public, anon, authenticated;

create function app.finder_warehouse_qr_audit(p_brand_id uuid, p_action text, p_request jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid := (p_request->>'id')::uuid;
  v_place text := upper(btrim(p_request->>'place'));
  v_result jsonb;
  v_audit app.warehouse_qr_audits;
  v_before jsonb;
  v_after jsonb;
begin
  if p_action = 'confirm' then
    if auth.uid() is null or not coalesce(app.can_use_masma_finder_feature(p_brand_id, 'test'), false) then
      raise exception 'QR 연결 권한이 없습니다.' using errcode = '42501';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('finder-placement/' || p_brand_id::text, 0));
    if not exists (select 1 from app.warehouse_qr_audit_sheet_exports
      where id = v_id and brand_id = p_brand_id) then
      perform app.assert_warehouse_qr_audit_sheet_ready(p_brand_id, v_place);
      perform app.assert_warehouse_qr_audit_sheet_ready(p_brand_id, null, item->>'qr')
      from jsonb_array_elements(p_request->'entries') item;
      if exists (select 1 from app.masma_finder_inbound_sheet
        where brand_id = p_brand_id and sheet_row_id is null
          and upper(registration->>'p_location_code') = v_place)
        or exists (select 1 from public.cargo_inbound_receipts
          where brand_id = p_brand_id and receiving_mode = 'location_only' and received_at is null
            and upper(received_location_code) = v_place) then
        raise exception '해당 자리의 입고를 시트까지 저장한 뒤 실사를 확정해주세요.' using errcode = 'PQA01';
      end if;
    end if;
  end if;
  v_result := app.finder_warehouse_qr_audit_db(p_brand_id, p_action, p_request);
  if p_action = 'confirm' and not exists (
    select 1 from app.warehouse_qr_audit_sheet_exports where id = v_id
  ) then
    select * into strict v_audit from app.warehouse_qr_audits
    where id = v_id and brand_id = p_brand_id and actor_id = auth.uid();
    select coalesce(jsonb_agg(item), '[]'::jsonb) into v_before from (
      select app.warehouse_qr_audit_sheet_row(p, v_audit.place) as item
      from jsonb_populate_recordset(null::public.warehouse_stock_positions, v_audit.before_rows) p
      where nullif(p.external_row_id, '') is not null
      union all
      select app.warehouse_qr_audit_sheet_row(
        jsonb_populate_record(null::public.warehouse_stock_positions, i->'original'), i->>'fromPlace')
      from jsonb_array_elements(v_audit.confirmed_rows) i
      where i->>'fromPlace' is not null and nullif(i->'original'->>'external_row_id', '') is not null
    ) rows;
    select coalesce(jsonb_agg(app.warehouse_qr_audit_sheet_row(p, v_audit.place) ||
      jsonb_build_object('opened', p.opened_units) order by p.source_row_number, p.id), '[]'::jsonb)
    into v_after from app.warehouse_qr_audit_boxes i
    join public.warehouse_stock_positions p on p.external_row_id = i.external_row_id and p.brand_id = p_brand_id
    join public.warehouse_inventory_sets s on s.id = p.set_id and s.status = 'active' and s.kind = 'sandbox'
    where i.audit_id = v_id;
    insert into app.warehouse_qr_audit_sheet_exports (id,brand_id,whole_place,before_rows,after_rows)
    values (v_id,p_brand_id,v_audit.place,v_before,v_after);
  end if;
  if p_action = 'confirm' or v_result->>'complete' = 'true' then
    return v_result || jsonb_build_object('sheetPending', exists (
      select 1 from app.warehouse_qr_audit_sheet_exports
      where id = v_id and brand_id = p_brand_id and sheet_synced_at is null
    ));
  end if;
  return v_result;
end;
$$;

revoke all on function app.finder_warehouse_qr_audit(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function app.finder_warehouse_qr_audit(uuid,text,jsonb) to authenticated;
create or replace function public.finder_warehouse_qr_audit(p_brand_id uuid, p_action text, p_request jsonb)
returns jsonb language sql security invoker set search_path = ''
as $$ select app.finder_warehouse_qr_audit(p_brand_id, p_action, p_request) $$;

alter function app.review_warehouse_qr_audit(uuid,text,jsonb) rename to review_warehouse_qr_audit_db;
revoke execute on function app.review_warehouse_qr_audit_db(uuid,text,jsonb) from public, anon, authenticated;

create function app.review_warehouse_qr_audit(p_brand_id uuid, p_action text, p_request jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_row_id text := p_request->>'rowId';
  v_place text;
  v_old jsonb;
  v_new jsonb;
  v_result jsonb;
begin
  if not app.can_review_warehouse_qr_audit(p_brand_id) then
    raise exception '창고 QR 검수 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_action is distinct from 'link' then return app.review_warehouse_qr_audit_db(p_brand_id, p_action, p_request); end if;
  perform pg_advisory_xact_lock(hashtextextended('finder-placement/' || p_brand_id::text, 0));
  select app.warehouse_qr_audit_sheet_row(p, l.code), l.code into v_old, v_place
  from public.warehouse_stock_positions p
  join public.warehouse_inventory_sets s on s.id = p.set_id and s.status = 'active' and s.kind = 'sandbox'
  join public.warehouse_locations l on l.id = p.location_id
  where p.brand_id = p_brand_id and p.external_row_id = v_row_id;
  perform app.assert_warehouse_qr_audit_sheet_ready(p_brand_id, v_place, v_old->>'qr', v_row_id);
  if exists (select 1 from app.finder_warehouse_placement_operations o
    where o.brand_id = p_brand_id and o.finished_at is null and o.cancelled_at is null
      and (o.plan->'write'->>'docId' = v_row_id or exists (
        select 1 from jsonb_array_elements(coalesce(o.plan->'clear', '[]'::jsonb)) r
        where r->'row'->>'external_row_id' = v_row_id
      )))
    or exists (select 1 from app.warehouse_stock_condition_exports e
      where e.brand_id = p_brand_id and e.external_row_id = v_row_id and e.sheet_synced_at is null) then
    raise exception '이 박스의 시트 저장을 완료한 뒤 검수해주세요.' using errcode = 'PQA01';
  end if;
  v_result := app.review_warehouse_qr_audit_db(p_brand_id,p_action,p_request);
  select app.warehouse_qr_audit_sheet_row(p,l.code) || jsonb_build_object('opened', p.opened_units) into strict v_new
  from public.warehouse_stock_positions p
  join public.warehouse_inventory_sets s on s.id = p.set_id and s.status = 'active' and s.kind = 'sandbox'
  join public.warehouse_locations l on l.id = p.location_id
  where p.brand_id = p_brand_id and p.external_row_id = v_row_id;
  insert into app.warehouse_qr_audit_sheet_exports (id,brand_id,before_rows,after_rows)
  values (gen_random_uuid(),p_brand_id,jsonb_build_array(v_old),jsonb_build_array(v_new));
  return v_result;
end;
$$;

revoke all on function app.review_warehouse_qr_audit(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function app.review_warehouse_qr_audit(uuid,text,jsonb) to authenticated;
create or replace function public.review_warehouse_qr_audit(p_brand_id uuid,p_action text,p_request jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path = ''
as $$ select app.review_warehouse_qr_audit(p_brand_id,p_action,p_request) $$;

create function public.list_warehouse_qr_audit_sheet_exports(p_brand_id uuid)
returns setof jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('id',id,'place',whole_place,'before',before_rows,'after',after_rows)
  from app.warehouse_qr_audit_sheet_exports
  where brand_id = p_brand_id and sheet_synced_at is null order by queued_at,id limit 10;
$$;

create function public.confirm_warehouse_qr_audit_sheet_export(p_brand_id uuid,p_id uuid,p_rows jsonb)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_expected jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('finder-placement/' || p_brand_id::text, 0));
  select coalesce(jsonb_agg(r - 'opened' order by r->>'id'), '[]'::jsonb) into v_expected
  from app.warehouse_qr_audit_sheet_exports e cross join lateral jsonb_array_elements(e.after_rows) r
  where e.id = p_id and e.brand_id = p_brand_id;
  if v_expected is distinct from p_rows then return false; end if;
  update app.warehouse_qr_audit_sheet_exports set sheet_synced_at = coalesce(sheet_synced_at,clock_timestamp())
  where id = p_id and brand_id = p_brand_id;
  return found;
end;
$$;
revoke all on function public.list_warehouse_qr_audit_sheet_exports(uuid), public.confirm_warehouse_qr_audit_sheet_export(uuid,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.list_warehouse_qr_audit_sheet_exports(uuid), public.confirm_warehouse_qr_audit_sheet_export(uuid,uuid,jsonb) to service_role;

alter function public.replace_warehouse_inventory_snapshot_with_box_qr(uuid,text,jsonb,timestamptz)
  rename to replace_warehouse_inventory_snapshot_with_qr_audit_overlay;
revoke execute on function public.replace_warehouse_inventory_snapshot_with_qr_audit_overlay(uuid,text,jsonb,timestamptz)
  from public, anon, authenticated, service_role;

create function public.replace_warehouse_inventory_snapshot_with_box_qr(
  p_brand_id uuid,p_source_file_name text,p_rows jsonb,p_snapshot_at timestamptz
)
returns public.warehouse_inventory_sets
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception '동기화 서버만 실행할 수 있습니다.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('finder-placement/' || p_brand_id::text, 0));
  if exists (select 1 from app.warehouse_qr_audit_sheet_exports
    where brand_id = p_brand_id and (sheet_synced_at is null or sheet_synced_at >= p_snapshot_at)) then
    raise exception 'QR 실사 결과를 반영하기 전의 창고입력입니다. 시트 반영 후 다시 동기화해주세요.' using errcode = 'PWS07';
  end if;
  return public.replace_warehouse_inventory_snapshot_with_qr_audit_overlay(p_brand_id,p_source_file_name,p_rows,p_snapshot_at);
end;
$$;
revoke all on function public.replace_warehouse_inventory_snapshot_with_box_qr(uuid,text,jsonb,timestamptz)
  from public, anon, authenticated;
grant execute on function public.replace_warehouse_inventory_snapshot_with_box_qr(uuid,text,jsonb,timestamptz) to service_role;

-- Audited boxes now have a real AA row. The original condition job can update B:C again.
create or replace function public.save_warehouse_stock_condition(
  p_brand_id uuid,p_request_id uuid,p_position_id uuid,p_condition text,p_expected_condition text,p_receive jsonb default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_place text; v_position public.warehouse_stock_positions;
begin
  if not app.can_review_warehouse_qr_audit(p_brand_id) then
    raise exception '창고 재고를 수정할 권한이 없습니다.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('finder-placement/' || p_brand_id::text, 0));
  select p.* into v_position from public.warehouse_stock_positions p
    where p.id = p_position_id and p.brand_id = p_brand_id;
  select code into v_place from public.warehouse_locations where id = v_position.location_id;
  perform app.assert_warehouse_qr_audit_sheet_ready(p_brand_id, coalesce(v_place,p_receive->>'location_code'),
    v_position.box_qr,v_position.external_row_id);
  return public.save_warehouse_stock_condition_before_qr_audit(
    p_brand_id,p_request_id,p_position_id,p_condition,p_expected_condition,p_receive);
end;
$$;

alter function app.finder_warehouse_placement(uuid,text,jsonb) rename to finder_warehouse_placement_before_audit_sheet;
revoke execute on function app.finder_warehouse_placement_before_audit_sheet(uuid,text,jsonb) from public, anon, authenticated;

create function app.finder_warehouse_placement(p_brand_id uuid,p_action text,p_request jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_result jsonb;
  v_op app.finder_warehouse_placement_operations;
  v_write jsonb;
  v_position public.warehouse_stock_positions;
begin
  if p_action in ('prepare','finish') then
    if auth.uid() is null or not coalesce(app.can_use_masma_finder_feature(p_brand_id,'test'),false)
      or app.has_masma_finder_sheet_write_key() is not true then
      raise exception 'Finder 창고 작업 권한이 필요합니다.' using errcode = '42501';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('finder-placement/' || p_brand_id::text,0));
    if p_action = 'prepare' then
      perform app.assert_warehouse_qr_audit_sheet_ready(p_brand_id,p_request->>'place',p_request->>'qr');
    else
      select * into v_op from app.finder_warehouse_placement_operations
      where brand_id = p_brand_id and actor_id = auth.uid() and id = (p_request->>'operationId')::uuid;
    end if;
  end if;
  v_result := app.finder_warehouse_placement_before_audit_sheet(p_brand_id,p_action,p_request);
  if p_action = 'prepare' and v_result->>'status' = 'prepared' then
    v_write := v_result->'plan'->'write';
    v_position := jsonb_populate_record(null::public.warehouse_stock_positions, nullif(v_write->'position','null'::jsonb));
    if v_position.opened_units > 0 and exists (select 1 from app.warehouse_qr_audit_boxes
      where external_row_id = v_position.external_row_id) then
      v_write := v_write || jsonb_build_object('auditOpened', true);
      v_result := jsonb_set(v_result, '{plan,write}', v_write);
      update app.finder_warehouse_placement_operations set plan = v_result->'plan'
      where id = (v_result->>'operationId')::uuid and brand_id = p_brand_id and actor_id = auth.uid();
    end if;
  elsif p_action = 'finish' and v_op.finished_at is null and v_op.id is not null
    and v_op.plan->'write'->>'auditOpened' = 'true' then
    v_write := v_op.plan->'write';
    v_position := jsonb_populate_record(null::public.warehouse_stock_positions, v_write->'position');
    update public.warehouse_stock_positions p set
      units_per_box = greatest(v_position.units_per_box,(v_write->>'quantity')::integer),
      units_per_box_raw = greatest(v_position.units_per_box,(v_write->>'quantity')::integer)::text,
      remaining_boxes = 0, remaining_boxes_raw = '0', opened_units = (v_write->>'quantity')::integer
    from public.warehouse_inventory_sets s
    where s.id = p.set_id and s.kind = 'sandbox' and s.status = 'active'
      and p.brand_id = p_brand_id and p.external_row_id = v_write->>'docId';
  end if;
  return v_result;
end;
$$;
revoke all on function app.finder_warehouse_placement(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function app.finder_warehouse_placement(uuid,text,jsonb) to authenticated;
create or replace function public.finder_warehouse_placement(p_brand_id uuid,p_action text,p_request jsonb)
returns jsonb language sql security invoker set search_path = ''
as $$ select app.finder_warehouse_placement(p_brand_id,p_action,p_request) $$;

alter function public.run_finder_single_inbound_db_first(uuid,uuid,jsonb) rename to run_finder_single_inbound_before_audit_sheet;
revoke execute on function public.run_finder_single_inbound_before_audit_sheet(uuid,uuid,jsonb) from public, anon, authenticated, service_role;
create function public.run_finder_single_inbound_db_first(p_brand_id uuid,p_actor_id uuid,p_request jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('finder-placement/' || p_brand_id::text,0));
  if not exists (select 1 from app.finder_warehouse_sheet_exports e
    join app.finder_warehouse_placement_operations o on o.id = e.operation_id
    where e.brand_id = p_brand_id and e.job_id = p_request->>'backgroundJobId' and o.actor_id = p_actor_id) then
    perform app.assert_warehouse_qr_audit_sheet_ready(p_brand_id,p_request->>'place',p_request->>'qr');
  end if;
  return public.run_finder_single_inbound_before_audit_sheet(p_brand_id,p_actor_id,p_request);
end;
$$;
revoke all on function public.run_finder_single_inbound_db_first(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.run_finder_single_inbound_db_first(uuid,uuid,jsonb) to service_role;

alter function app.prepare_masma_finder_inbound_sheet(uuid,text,jsonb) rename to prepare_masma_finder_inbound_before_audit_sheet;
revoke execute on function app.prepare_masma_finder_inbound_before_audit_sheet(uuid,text,jsonb) from public, anon, authenticated;
create function app.prepare_masma_finder_inbound_sheet(p_brand_id uuid,p_display_code text,p_registration jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if app.can_use_masma_finder(p_brand_id) is not true then
    raise exception 'Masma Finder 접근 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_registration is not null then
    if app.has_masma_finder_sheet_write_key() is not true then
      raise exception 'Finder 저장 권한이 필요합니다.' using errcode = '42501';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('finder-placement/' || p_brand_id::text,0));
    perform app.assert_warehouse_qr_audit_sheet_ready(p_brand_id,p_registration->>'p_location_code',p_display_code);
  end if;
  return app.prepare_masma_finder_inbound_before_audit_sheet(p_brand_id,p_display_code,p_registration);
end;
$$;
revoke all on function app.prepare_masma_finder_inbound_sheet(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function app.prepare_masma_finder_inbound_sheet(uuid,text,jsonb) to authenticated;
create or replace function public.prepare_masma_finder_inbound_sheet(p_brand_id uuid,p_display_code text,p_registration jsonb)
returns jsonb language sql set search_path = ''
as $$ select app.prepare_masma_finder_inbound_sheet(p_brand_id,p_display_code,p_registration) $$;

alter function public.run_finder_cargo_background(uuid,uuid,text,jsonb) rename to run_finder_cargo_before_audit_sheet;
revoke execute on function public.run_finder_cargo_before_audit_sheet(uuid,uuid,text,jsonb) from public, anon, authenticated, service_role;
create function public.run_finder_cargo_background(p_brand_id uuid,p_actor_id uuid,p_action text,p_request jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if p_action = 'cargo-location-prepare' then
    perform pg_advisory_xact_lock(hashtextextended('finder-placement/' || p_brand_id::text,0));
    if not exists (select 1 from public.cargo_inbound_receipts r
      where r.receipt_id = (p_request->>'receiptId')::uuid and r.brand_id = p_brand_id and r.created_by = p_actor_id) then
      perform app.assert_warehouse_qr_audit_sheet_ready(p_brand_id,p_request->>'place');
    end if;
  end if;
  return public.run_finder_cargo_before_audit_sheet(p_brand_id,p_actor_id,p_action,p_request);
end;
$$;
revoke all on function public.run_finder_cargo_background(uuid,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.run_finder_cargo_background(uuid,uuid,text,jsonb) to service_role;
