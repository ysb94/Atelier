-- 시트 동기화: 행 ID·미확인 수량·사용 우선순위·출고 자리 등록·전체 교체 RPC.

alter table public.warehouse_stock_positions
  drop constraint if exists warehouse_stock_positions_units_per_box_check;

alter table public.warehouse_stock_positions
  drop constraint if exists warehouse_stock_positions_remaining_boxes_check;

alter table public.warehouse_stock_positions
  alter column units_per_box drop not null;

alter table public.warehouse_stock_positions
  alter column remaining_boxes drop not null;

alter table public.warehouse_stock_positions
  add column if not exists usage_priority text not null default 'fifo';

alter table public.warehouse_stock_positions
  add column if not exists quantity_status text not null default 'known';

alter table public.warehouse_stock_positions
  add column if not exists units_per_box_raw text not null default '';

alter table public.warehouse_stock_positions
  add column if not exists remaining_boxes_raw text not null default '';

alter table public.warehouse_stock_positions
  add column if not exists external_row_id text;

update public.warehouse_stock_positions
set
  usage_priority = case
    when is_forced_priority or received_on_raw in ('', '000000') then 'first'
    when received_on_raw = '000001' then 'second'
    when received_on_raw = '999999' then 'last'
    else 'fifo'
  end,
  units_per_box_raw = case
    when btrim(units_per_box_raw) = '' then coalesce(units_per_box::text, '')
    else units_per_box_raw
  end,
  remaining_boxes_raw = case
    when btrim(remaining_boxes_raw) = '' then coalesce(remaining_boxes::text, '')
    else remaining_boxes_raw
  end,
  quantity_status = case
    when units_per_box is null or remaining_boxes is null then 'unknown'
    else 'known'
  end;

alter table public.warehouse_stock_positions
  drop constraint if exists warehouse_stock_positions_usage_priority_check;

alter table public.warehouse_stock_positions
  add constraint warehouse_stock_positions_usage_priority_check
  check (usage_priority in ('first', 'second', 'fifo', 'last'));

alter table public.warehouse_stock_positions
  drop constraint if exists warehouse_stock_positions_quantity_status_check;

alter table public.warehouse_stock_positions
  add constraint warehouse_stock_positions_quantity_status_check
  check (quantity_status in ('known', 'unknown'));

alter table public.warehouse_stock_positions
  add constraint warehouse_stock_positions_units_per_box_check
  check (units_per_box is null or units_per_box > 0);

alter table public.warehouse_stock_positions
  add constraint warehouse_stock_positions_remaining_boxes_check
  check (remaining_boxes is null or remaining_boxes >= 0);

alter table public.warehouse_stock_positions
  drop constraint if exists warehouse_stock_positions_quantity_known_check;

alter table public.warehouse_stock_positions
  add constraint warehouse_stock_positions_quantity_known_check
  check (
    (
      quantity_status = 'known'
      and units_per_box is not null
      and remaining_boxes is not null
    )
    or quantity_status = 'unknown'
  );

create unique index if not exists warehouse_stock_positions_set_external_row_id_idx
  on public.warehouse_stock_positions (set_id, external_row_id)
  where external_row_id is not null and btrim(external_row_id) <> '';

comment on column public.warehouse_stock_positions.external_row_id is
  'Google 시트 AA 외부 행 ID. 세트 안에서 고유하다.';
comment on column public.warehouse_stock_positions.quantity_status is
  'known이면 입수·박스 수가 확정, unknown이면 빈 칸을 0/1로 추정하지 않는다.';
comment on column public.warehouse_stock_positions.usage_priority is
  '000000 최우선, 000001 차순위, 정상 입고일 FIFO, 999999 마지막.';

create table if not exists public.warehouse_registered_slots (
  warehouse_id uuid not null references public.warehouses (id) on delete cascade,
  code text not null check (length(btrim(code)) > 0),
  zone text not null check (zone in ('box_storage', 'picking')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (warehouse_id, code)
);

comment on table public.warehouse_registered_slots is
  '창고 안에서 자리번호가 속하는 구역. 등록된 picking 자리만 출고창고로 분류한다.';

drop trigger if exists warehouse_registered_slots_set_updated_at
  on public.warehouse_registered_slots;
create trigger warehouse_registered_slots_set_updated_at
before update on public.warehouse_registered_slots
for each row execute function public.set_updated_at();

alter table public.warehouse_registered_slots enable row level security;

drop policy if exists warehouse_registered_slots_select_member
  on public.warehouse_registered_slots;
create policy warehouse_registered_slots_select_member
on public.warehouse_registered_slots
for select to authenticated
using (
  exists (
    select 1
    from public.warehouses as warehouse
    join public.brands as brand
      on brand.company_id = warehouse.company_id
    where warehouse.id = warehouse_registered_slots.warehouse_id
      and app.can_read_brand(brand.id)
  )
);

drop policy if exists warehouse_registered_slots_write_editor
  on public.warehouse_registered_slots;
create policy warehouse_registered_slots_write_editor
on public.warehouse_registered_slots
for all to authenticated
using (
  exists (
    select 1
    from public.warehouses as warehouse
    join public.brands as brand
      on brand.company_id = warehouse.company_id
    where warehouse.id = warehouse_registered_slots.warehouse_id
      and app.can_edit_brand(brand.id)
  )
)
with check (
  exists (
    select 1
    from public.warehouses as warehouse
    join public.brands as brand
      on brand.company_id = warehouse.company_id
    where warehouse.id = warehouse_registered_slots.warehouse_id
      and app.can_edit_brand(brand.id)
  )
);

grant select, insert, update, delete on table public.warehouse_registered_slots
  to authenticated;

create or replace function public.touch_warehouse_registered_slot(
  p_warehouse_id uuid,
  p_code text,
  p_zone text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_zone is distinct from 'picking' then
    return;
  end if;
  if p_warehouse_id is null or btrim(coalesce(p_code, '')) = '' then
    return;
  end if;
  insert into public.warehouse_registered_slots (warehouse_id, code, zone)
  values (p_warehouse_id, btrim(p_code), 'picking')
  on conflict (warehouse_id, code) do update
    set zone = 'picking';
end;
$$;

create or replace function public.import_warehouse_inventory_set(
  p_brand_id uuid,
  p_source_file_name text,
  p_rows jsonb
)
returns public.warehouse_inventory_sets
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_company_id uuid;
  v_warehouse_id uuid;
  v_previous_set public.warehouse_inventory_sets;
  v_set public.warehouse_inventory_sets;
  v_zone text;
  v_zone_count integer;
  v_row_count integer;
begin
  perform set_config('statement_timeout', '60s', true);

  if p_brand_id is null then
    raise exception '브랜드를 지정하세요.';
  end if;
  if not app.can_edit_brand(p_brand_id) then
    raise exception '창고 연습 데이터를 가져올 권한이 없습니다.';
  end if;
  if p_source_file_name is null or btrim(p_source_file_name) = '' then
    raise exception '원본 파일 이름을 입력하세요.';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception '가져올 창고 행이 없습니다.';
  end if;
  select
    count(distinct coalesce(nullif(btrim(item ->> 'zone'), ''), 'box_storage')),
    min(coalesce(nullif(btrim(item ->> 'zone'), ''), 'box_storage'))
    into v_zone_count, v_zone
  from jsonb_array_elements(p_rows) as item;

  if v_zone_count <> 1 or v_zone not in ('box_storage', 'picking') then
    raise exception '한 번에 한 창고 구역의 행만 가져올 수 있습니다.';
  end if;

  select brand.company_id
    into v_company_id
  from public.brands as brand
  where brand.id = p_brand_id;
  if v_company_id is null then
    raise exception '브랜드를 찾을 수 없습니다.';
  end if;

  select *
    into v_previous_set
  from public.warehouse_inventory_sets
  where brand_id = p_brand_id
    and kind = 'sandbox'
    and status = 'active'
  limit 1
  for update;

  if v_previous_set.id is null then
    insert into public.warehouses (company_id, name)
    values (v_company_id, '연습 창고')
    on conflict (company_id, name) do update
      set name = excluded.name
    returning id into v_warehouse_id;
  else
    v_warehouse_id := v_previous_set.warehouse_id;

    update public.warehouse_inventory_sets
    set status = 'archived'
    where id = v_previous_set.id;
  end if;

  insert into public.warehouse_inventory_sets (
    brand_id,
    warehouse_id,
    kind,
    status,
    source_file_name,
    row_count,
    imported_by
  )
  values (
    p_brand_id,
    v_warehouse_id,
    'sandbox',
    'active',
    btrim(p_source_file_name),
    0,
    auth.uid()
  )
  returning * into v_set;

  if v_previous_set.id is not null then
    insert into public.warehouse_stock_positions (
      brand_id,
      set_id,
      warehouse_id,
      location_id,
      style_id,
      source_style_no,
      normalized_style_no,
      source_product_name,
      received_on,
      received_on_raw,
      is_forced_priority,
      is_final_location,
      usage_priority,
      quantity_status,
      units_per_box,
      remaining_boxes,
      units_per_box_raw,
      remaining_boxes_raw,
      opened_units,
      review_flags,
      source_row_number,
      note,
      external_row_id
    )
    select
      pos.brand_id,
      v_set.id,
      pos.warehouse_id,
      pos.location_id,
      pos.style_id,
      pos.source_style_no,
      pos.normalized_style_no,
      pos.source_product_name,
      pos.received_on,
      pos.received_on_raw,
      pos.is_forced_priority,
      pos.is_final_location,
      pos.usage_priority,
      pos.quantity_status,
      pos.units_per_box,
      pos.remaining_boxes,
      pos.units_per_box_raw,
      pos.remaining_boxes_raw,
      pos.opened_units,
      pos.review_flags,
      pos.source_row_number,
      pos.note,
      pos.external_row_id
    from public.warehouse_stock_positions as pos
    join public.warehouse_locations as loc
      on loc.id = pos.location_id
    where pos.brand_id = p_brand_id
      and pos.set_id = v_previous_set.id
      and loc.zone <> v_zone;

    insert into public.warehouse_boxes (
      brand_id,
      set_id,
      display_code,
      location_id,
      style_id,
      received_on,
      initial_qty,
      current_qty,
      status
    )
    select
      stock_box.brand_id,
      v_set.id,
      stock_box.display_code,
      stock_box.location_id,
      stock_box.style_id,
      stock_box.received_on,
      stock_box.initial_qty,
      stock_box.current_qty,
      stock_box.status
    from public.warehouse_boxes as stock_box
    join public.warehouse_locations as loc
      on loc.id = stock_box.location_id
    where stock_box.brand_id = p_brand_id
      and stock_box.set_id = v_previous_set.id
      and loc.zone <> v_zone;
  end if;

  insert into public.warehouse_locations (
    company_id,
    warehouse_id,
    code,
    zone
  )
  select distinct
    v_company_id,
    v_warehouse_id,
    coalesce(nullif(btrim(item ->> 'location_code'), ''), '(빈 자리)'),
    v_zone
  from jsonb_array_elements(p_rows) as item
  on conflict (warehouse_id, zone, code) do nothing;

  insert into public.warehouse_stock_positions (
    brand_id,
    set_id,
    warehouse_id,
    location_id,
    style_id,
    source_style_no,
    normalized_style_no,
    source_product_name,
    received_on,
    received_on_raw,
    is_forced_priority,
    is_final_location,
    usage_priority,
    quantity_status,
    units_per_box,
    remaining_boxes,
    units_per_box_raw,
    remaining_boxes_raw,
    opened_units,
    review_flags,
    source_row_number,
    note,
    external_row_id
  )
  select
    p_brand_id,
    v_set.id,
    v_warehouse_id,
    loc.id,
    nullif(parsed.item ->> 'style_id', '')::uuid,
    coalesce(parsed.item ->> 'source_style_no', ''),
    coalesce(parsed.item ->> 'normalized_style_no', ''),
    coalesce(parsed.item ->> 'source_product_name', ''),
    nullif(parsed.item ->> 'received_on', '')::date,
    coalesce(parsed.item ->> 'received_on_raw', ''),
    coalesce((parsed.item ->> 'is_forced_priority')::boolean, false),
    coalesce((parsed.item ->> 'is_final_location')::boolean, false),
    coalesce(
      nullif(parsed.item ->> 'usage_priority', ''),
      case
        when coalesce((parsed.item ->> 'is_forced_priority')::boolean, false)
          or coalesce(parsed.item ->> 'received_on_raw', '') in ('', '000000')
          then 'first'
        when coalesce(parsed.item ->> 'received_on_raw', '') = '000001' then 'second'
        when coalesce(parsed.item ->> 'received_on_raw', '') = '999999' then 'last'
        else 'fifo'
      end
    ),
    parsed.quantity_status,
    parsed.units_per_box,
    parsed.remaining_boxes,
    coalesce(parsed.item ->> 'units_per_box_raw', coalesce(parsed.item ->> 'units_per_box', '')),
    coalesce(parsed.item ->> 'remaining_boxes_raw', coalesce(parsed.item ->> 'remaining_boxes', '')),
    0,
    coalesce(
      array(
        select jsonb_array_elements_text(
          coalesce(parsed.item -> 'review_flags', '[]'::jsonb)
        )
      ),
      '{}'::text[]
    ),
    (parsed.item ->> 'source_row_number')::integer,
    coalesce(parsed.item ->> 'note', ''),
    nullif(btrim(coalesce(parsed.item ->> 'external_row_id', '')), '')
  from (
    select
      item,
      case
        when nullif(item ->> 'units_per_box', '') is null then null
        when (item ->> 'units_per_box')::integer < 1 then null
        else (item ->> 'units_per_box')::integer
      end as units_per_box,
      case
        when nullif(item ->> 'remaining_boxes', '') is null then null
        when (item ->> 'remaining_boxes')::integer < 0 then null
        else (item ->> 'remaining_boxes')::integer
      end as remaining_boxes,
      case
        when coalesce(item ->> 'quantity_status', '') = 'unknown' then 'unknown'
        when nullif(item ->> 'units_per_box', '') is null
          or nullif(item ->> 'remaining_boxes', '') is null
          or coalesce((item ->> 'units_per_box')::integer, 0) < 1
          then 'unknown'
        else 'known'
      end as quantity_status
    from jsonb_array_elements(p_rows) as item
  ) as parsed
  join public.warehouse_locations as loc
    on loc.warehouse_id = v_warehouse_id
    and loc.zone = v_zone
    and loc.code = coalesce(
      nullif(btrim(parsed.item ->> 'location_code'), ''),
      '(빈 자리)'
    );

  if v_zone = 'picking' then
    insert into public.warehouse_registered_slots (warehouse_id, code, zone)
    select distinct
      v_warehouse_id,
      coalesce(nullif(btrim(item ->> 'location_code'), ''), '(빈 자리)'),
      'picking'
    from jsonb_array_elements(p_rows) as item
    on conflict (warehouse_id, code) do update
      set zone = 'picking';
  end if;

  select count(*)::integer
    into v_row_count
  from public.warehouse_stock_positions
  where brand_id = p_brand_id
    and set_id = v_set.id;

  update public.warehouse_inventory_sets
  set row_count = v_row_count
  where id = v_set.id
  returning * into v_set;

  insert into public.warehouse_stock_movements (
    brand_id,
    set_id,
    action,
    box_count,
    reason,
    actor_id
  )
  values (
    p_brand_id,
    v_set.id,
    'import',
    jsonb_array_length(p_rows),
    case
      when v_zone = 'picking' then '출고창고 엑셀 교체'
      else '박스창고 엑셀 교체'
    end,
    auth.uid()
  );

  return v_set;
end;
$$;

comment on function public.import_warehouse_inventory_set(uuid, text, jsonb) is
  '선택한 연습 창고 존만 엑셀로 교체하고 다른 존은 새 활성 스냅샷에 보존한다.';
