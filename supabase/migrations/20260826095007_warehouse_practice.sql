-- 창고 연습 운영. 엑셀 원본은 유지하고 사이트에는 교체 가능한 연습 세트를 둔다.
-- 현재의 위치별 미식별 박스와 향후 개별 박스 ID를 같은 경계에서 관리한다.

create table if not exists public.warehouses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint warehouses_company_id_id_key unique (company_id, id),
  constraint warehouses_company_name_key unique (company_id, name)
);

comment on table public.warehouses is
  '회사 공통 창고. 브랜드는 재고 행의 brand_id로만 구분한다.';

create table if not exists public.warehouse_locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  warehouse_id uuid not null,
  code text not null check (length(btrim(code)) > 0),
  zone text not null
    check (zone in ('box_storage', 'picking')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint warehouse_locations_company_id_id_key unique (company_id, id),
  constraint warehouse_locations_warehouse_fkey
    foreign key (company_id, warehouse_id)
    references public.warehouses (company_id, id)
    on delete cascade,
  constraint warehouse_locations_code_key unique (warehouse_id, zone, code)
);

comment on table public.warehouse_locations is
  '자유 적치 자리. 상품 고정석이 아니라 현재 적치 코드다.';

create table if not exists public.warehouse_inventory_sets (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  warehouse_id uuid not null,
  kind text not null default 'sandbox'
    check (kind in ('sandbox', 'live')),
  status text not null default 'active'
    check (status in ('active', 'archived')),
  source_file_name text not null,
  row_count integer not null default 0 check (row_count >= 0),
  imported_at timestamptz not null default now(),
  imported_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint warehouse_inventory_sets_brand_id_id_key unique (brand_id, id),
  constraint warehouse_inventory_sets_warehouse_fkey
    foreign key (warehouse_id)
    references public.warehouses (id)
    on delete restrict
);

comment on table public.warehouse_inventory_sets is
  'XLSX 가져오기 단위. 연습 세트는 보관 후 새로 활성화한다.';

create unique index if not exists warehouse_inventory_sets_active_sandbox_idx
  on public.warehouse_inventory_sets (brand_id)
  where kind = 'sandbox' and status = 'active';

create table if not exists public.warehouse_stock_positions (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null,
  set_id uuid not null,
  warehouse_id uuid not null,
  location_id uuid not null,
  style_id uuid,
  source_style_no text not null,
  normalized_style_no text not null,
  source_product_name text not null default '',
  received_on date,
  received_on_raw text not null,
  is_forced_priority boolean not null default false,
  is_final_location boolean not null default false,
  units_per_box integer not null check (units_per_box > 0),
  remaining_boxes integer not null check (remaining_boxes >= 0),
  opened_units integer not null default 0 check (opened_units >= 0),
  review_flags text[] not null default '{}',
  source_row_number integer not null check (source_row_number > 0),
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint warehouse_stock_positions_brand_id_id_key unique (brand_id, id),
  constraint warehouse_stock_positions_set_fkey
    foreign key (brand_id, set_id)
    references public.warehouse_inventory_sets (brand_id, id)
    on delete cascade,
  constraint warehouse_stock_positions_style_fkey
    foreign key (brand_id, style_id)
    references public.styles (brand_id, id)
    on delete restrict,
  constraint warehouse_stock_positions_location_fkey
    foreign key (location_id)
    references public.warehouse_locations (id)
    on delete restrict
);

comment on table public.warehouse_stock_positions is
  '미식별 박스 묶음. 박스 ID가 붙기 전 위치·입고일·잔여 박스 수다.';

create index if not exists warehouse_stock_positions_set_idx
  on public.warehouse_stock_positions (brand_id, set_id, normalized_style_no);

create index if not exists warehouse_stock_positions_location_idx
  on public.warehouse_stock_positions (location_id);

create table if not exists public.warehouse_boxes (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null,
  set_id uuid not null,
  display_code text not null check (length(btrim(display_code)) > 0),
  location_id uuid not null,
  style_id uuid not null,
  received_on date,
  initial_qty integer not null check (initial_qty > 0),
  current_qty integer not null check (current_qty >= 0),
  status text not null default 'sealed'
    check (status in ('sealed', 'opened', 'depleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint warehouse_boxes_brand_id_id_key unique (brand_id, id),
  constraint warehouse_boxes_set_code_key unique (brand_id, set_id, display_code),
  constraint warehouse_boxes_set_fkey
    foreign key (brand_id, set_id)
    references public.warehouse_inventory_sets (brand_id, id)
    on delete cascade,
  constraint warehouse_boxes_style_fkey
    foreign key (brand_id, style_id)
    references public.styles (brand_id, id)
    on delete restrict,
  constraint warehouse_boxes_location_fkey
    foreign key (location_id)
    references public.warehouse_locations (id)
    on delete restrict
);

comment on table public.warehouse_boxes is
  '향후 고유 박스 ID. 한 박스는 M번호 1종과 입고일 1개만 가진다.';

create table if not exists public.warehouse_stock_movements (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null,
  set_id uuid not null,
  action text not null
    check (
      action in (
        'import',
        'receive',
        'move',
        'deplete',
        'adjust',
        'replenish',
        'open',
        'label'
      )
    ),
  position_id uuid,
  box_id uuid,
  style_id uuid,
  from_location_code text,
  to_location_code text,
  box_count integer not null default 0 check (box_count >= 0),
  unit_count integer not null default 0 check (unit_count >= 0),
  reason text not null default '',
  actor_id uuid,
  created_at timestamptz not null default now(),
  constraint warehouse_stock_movements_set_fkey
    foreign key (brand_id, set_id)
    references public.warehouse_inventory_sets (brand_id, id)
    on delete cascade
);

comment on table public.warehouse_stock_movements is
  '연습 창고 입고·이동·소진·실사·박스 ID 전환 이력. 송장 예약과 연결하지 않는다.';

create index if not exists warehouse_stock_movements_set_idx
  on public.warehouse_stock_movements (brand_id, set_id, created_at desc);

drop trigger if exists warehouses_set_updated_at on public.warehouses;
create trigger warehouses_set_updated_at
before update on public.warehouses
for each row execute function public.set_updated_at();

drop trigger if exists warehouse_locations_set_updated_at
  on public.warehouse_locations;
create trigger warehouse_locations_set_updated_at
before update on public.warehouse_locations
for each row execute function public.set_updated_at();

drop trigger if exists warehouse_inventory_sets_set_updated_at
  on public.warehouse_inventory_sets;
create trigger warehouse_inventory_sets_set_updated_at
before update on public.warehouse_inventory_sets
for each row execute function public.set_updated_at();

drop trigger if exists warehouse_stock_positions_set_updated_at
  on public.warehouse_stock_positions;
create trigger warehouse_stock_positions_set_updated_at
before update on public.warehouse_stock_positions
for each row execute function public.set_updated_at();

drop trigger if exists warehouse_boxes_set_updated_at
  on public.warehouse_boxes;
create trigger warehouse_boxes_set_updated_at
before update on public.warehouse_boxes
for each row execute function public.set_updated_at();

alter table public.warehouses enable row level security;
alter table public.warehouse_locations enable row level security;
alter table public.warehouse_inventory_sets enable row level security;
alter table public.warehouse_stock_positions enable row level security;
alter table public.warehouse_boxes enable row level security;
alter table public.warehouse_stock_movements enable row level security;

create policy warehouses_select_member on public.warehouses
for select to authenticated
using (
  exists (
    select 1
    from public.brands as brand
    where brand.company_id = warehouses.company_id
      and app.can_read_brand(brand.id)
  )
);

create policy warehouses_write_editor on public.warehouses
for all to authenticated
using (
  exists (
    select 1
    from public.brands as brand
    where brand.company_id = warehouses.company_id
      and app.can_edit_brand(brand.id)
  )
)
with check (
  exists (
    select 1
    from public.brands as brand
    where brand.company_id = warehouses.company_id
      and app.can_edit_brand(brand.id)
  )
);

create policy warehouse_locations_select_member on public.warehouse_locations
for select to authenticated
using (
  exists (
    select 1
    from public.brands as brand
    where brand.company_id = warehouse_locations.company_id
      and app.can_read_brand(brand.id)
  )
);

create policy warehouse_locations_write_editor on public.warehouse_locations
for all to authenticated
using (
  exists (
    select 1
    from public.brands as brand
    where brand.company_id = warehouse_locations.company_id
      and app.can_edit_brand(brand.id)
  )
)
with check (
  exists (
    select 1
    from public.brands as brand
    where brand.company_id = warehouse_locations.company_id
      and app.can_edit_brand(brand.id)
  )
);

create policy warehouse_inventory_sets_select_member
on public.warehouse_inventory_sets
for select to authenticated
using (app.can_read_brand(brand_id));

create policy warehouse_inventory_sets_write_editor
on public.warehouse_inventory_sets
for all to authenticated
using (app.can_edit_brand(brand_id))
with check (app.can_edit_brand(brand_id));

create policy warehouse_stock_positions_select_member
on public.warehouse_stock_positions
for select to authenticated
using (app.can_read_brand(brand_id));

create policy warehouse_stock_positions_write_editor
on public.warehouse_stock_positions
for all to authenticated
using (app.can_edit_brand(brand_id))
with check (app.can_edit_brand(brand_id));

create policy warehouse_boxes_select_member
on public.warehouse_boxes
for select to authenticated
using (app.can_read_brand(brand_id));

create policy warehouse_boxes_write_editor
on public.warehouse_boxes
for all to authenticated
using (app.can_edit_brand(brand_id))
with check (app.can_edit_brand(brand_id));

create policy warehouse_stock_movements_select_member
on public.warehouse_stock_movements
for select to authenticated
using (app.can_read_brand(brand_id));

create policy warehouse_stock_movements_write_editor
on public.warehouse_stock_movements
for all to authenticated
using (app.can_edit_brand(brand_id))
with check (app.can_edit_brand(brand_id));

grant select, insert, update, delete on table public.warehouses to authenticated;
grant select, insert, update, delete on table public.warehouse_locations to authenticated;
grant select, insert, update, delete on table public.warehouse_inventory_sets to authenticated;
grant select, insert, update, delete on table public.warehouse_stock_positions to authenticated;
grant select, insert, update, delete on table public.warehouse_boxes to authenticated;
grant select, insert, update, delete on table public.warehouse_stock_movements to authenticated;

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
      units_per_box,
      remaining_boxes,
      opened_units,
      review_flags,
      source_row_number,
      note
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
      pos.units_per_box,
      pos.remaining_boxes,
      pos.opened_units,
      pos.review_flags,
      pos.source_row_number,
      pos.note
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
    units_per_box,
    remaining_boxes,
    opened_units,
    review_flags,
    source_row_number,
    note
  )
  select
    p_brand_id,
    v_set.id,
    v_warehouse_id,
    loc.id,
    nullif(item ->> 'style_id', '')::uuid,
    coalesce(item ->> 'source_style_no', ''),
    coalesce(item ->> 'normalized_style_no', ''),
    coalesce(item ->> 'source_product_name', ''),
    nullif(item ->> 'received_on', '')::date,
    coalesce(item ->> 'received_on_raw', ''),
    coalesce((item ->> 'is_forced_priority')::boolean, false),
    coalesce((item ->> 'is_final_location')::boolean, false),
    greatest(coalesce((item ->> 'units_per_box')::integer, 1), 1),
    greatest(coalesce((item ->> 'remaining_boxes')::integer, 0), 0),
    0,
    coalesce(
      array(
        select jsonb_array_elements_text(
          coalesce(item -> 'review_flags', '[]'::jsonb)
        )
      ),
      '{}'::text[]
    ),
    (item ->> 'source_row_number')::integer,
    coalesce(item ->> 'note', '')
  from jsonb_array_elements(p_rows) as item
  join public.warehouse_locations as loc
    on loc.warehouse_id = v_warehouse_id
    and loc.zone = v_zone
    and loc.code = coalesce(
      nullif(btrim(item ->> 'location_code'), ''),
      '(빈 자리)'
    );

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

revoke all on function public.import_warehouse_inventory_set(uuid, text, jsonb)
  from public, anon;
grant execute on function public.import_warehouse_inventory_set(uuid, text, jsonb)
  to authenticated;

create or replace function public.apply_warehouse_stock_action(
  p_brand_id uuid,
  p_action text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_set public.warehouse_inventory_sets;
  v_company_id uuid;
  v_position public.warehouse_stock_positions;
  v_target public.warehouse_stock_positions;
  v_location public.warehouse_locations;
  v_to_location_id uuid;
  v_to_code text;
  v_to_zone text;
  v_box_count integer;
  v_remaining integer;
  v_opened integer;
  v_units integer;
begin
  if not app.can_edit_brand(p_brand_id) then
    raise exception '창고 연습 데이터를 수정할 권한이 없습니다.';
  end if;
  if p_action not in ('receive', 'move', 'deplete', 'adjust', 'replenish', 'open') then
    raise exception '지원하지 않는 창고 작업입니다.';
  end if;

  select *
    into v_set
  from public.warehouse_inventory_sets
  where brand_id = p_brand_id
    and kind = 'sandbox'
    and status = 'active'
  limit 1;
  if v_set.id is null then
    raise exception '활성 연습 데이터가 없습니다. 엑셀을 먼저 가져오세요.';
  end if;

  select brand.company_id
    into v_company_id
  from public.brands as brand
  where brand.id = p_brand_id;

  if p_action = 'receive' then
    v_to_code := btrim(p_payload ->> 'location_code');
    v_to_zone := coalesce(nullif(btrim(p_payload ->> 'zone'), ''), 'box_storage');
    v_box_count := (p_payload ->> 'remaining_boxes')::integer;
    v_units := (p_payload ->> 'units_per_box')::integer;
    if v_to_code = '' or v_box_count is null or v_box_count < 1 or v_units is null or v_units < 1 then
      raise exception '자리번호·입수·박스 수를 확인하세요.';
    end if;

    insert into public.warehouse_locations (company_id, warehouse_id, code, zone)
    values (v_company_id, v_set.warehouse_id, v_to_code, v_to_zone)
    on conflict (warehouse_id, zone, code) do update
      set code = excluded.code
    returning id into v_to_location_id;

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
      units_per_box,
      remaining_boxes,
      review_flags,
      source_row_number,
      note
    )
    values (
      p_brand_id,
      v_set.id,
      v_set.warehouse_id,
      v_to_location_id,
      nullif(p_payload ->> 'style_id', '')::uuid,
      coalesce(p_payload ->> 'source_style_no', ''),
      coalesce(p_payload ->> 'normalized_style_no', p_payload ->> 'source_style_no'),
      coalesce(p_payload ->> 'source_product_name', ''),
      nullif(p_payload ->> 'received_on', '')::date,
      coalesce(p_payload ->> 'received_on_raw', p_payload ->> 'received_on', ''),
      coalesce((p_payload ->> 'is_forced_priority')::boolean, false),
      coalesce((p_payload ->> 'is_final_location')::boolean, false),
      v_units,
      v_box_count,
      case
        when nullif(p_payload ->> 'style_id', '') is null then array['missing_style']::text[]
        else '{}'::text[]
      end,
      900000 + (extract(epoch from now())::integer % 100000),
      coalesce(p_payload ->> 'note', '')
    )
    returning * into v_position;

    insert into public.warehouse_stock_movements (
      brand_id, set_id, action, position_id, style_id,
      to_location_code, box_count, unit_count, reason, actor_id
    )
    values (
      p_brand_id, v_set.id, 'receive', v_position.id, v_position.style_id,
      v_to_code, v_box_count, v_box_count * v_units,
      coalesce(p_payload ->> 'reason', '신규 입고'),
      auth.uid()
    );

    return to_jsonb(v_position);
  end if;

  select *
    into v_position
  from public.warehouse_stock_positions
  where brand_id = p_brand_id
    and set_id = v_set.id
    and id = (p_payload ->> 'position_id')::uuid;
  if v_position.id is null then
    raise exception '창고 자리를 찾지 못했습니다.';
  end if;

  select *
    into v_location
  from public.warehouse_locations
  where id = v_position.location_id;

  if p_action = 'deplete' then
    v_box_count := v_position.remaining_boxes;
    v_opened := v_position.opened_units;
    update public.warehouse_stock_positions
    set remaining_boxes = 0,
        opened_units = 0
    where id = v_position.id
    returning * into v_position;

    insert into public.warehouse_stock_movements (
      brand_id, set_id, action, position_id, style_id,
      from_location_code, box_count, unit_count, reason, actor_id
    )
    values (
      p_brand_id, v_set.id, 'deplete', v_position.id, v_position.style_id,
      v_location.code, v_box_count, v_opened,
      coalesce(p_payload ->> 'reason', '자리 소진'),
      auth.uid()
    );
    return to_jsonb(v_position);
  end if;

  if p_action = 'adjust' then
    v_remaining := (p_payload ->> 'remaining_boxes')::integer;
    v_opened := coalesce((p_payload ->> 'opened_units')::integer, v_position.opened_units);
    if v_remaining is null or v_remaining < 0 or v_opened < 0 then
      raise exception '잔여 수량은 0 미만이 될 수 없습니다.';
    end if;
    update public.warehouse_stock_positions
    set remaining_boxes = v_remaining,
        opened_units = v_opened
    where id = v_position.id
    returning * into v_position;

    insert into public.warehouse_stock_movements (
      brand_id, set_id, action, position_id, style_id,
      from_location_code, box_count, unit_count, reason, actor_id
    )
    values (
      p_brand_id, v_set.id, 'adjust', v_position.id, v_position.style_id,
      v_location.code, v_remaining, v_opened,
      coalesce(p_payload ->> 'reason', '실사 수정'),
      auth.uid()
    );
    return to_jsonb(v_position);
  end if;

  if p_action = 'open' then
    if v_location.zone <> 'picking' then
      raise exception '개봉은 출고창고에서만 할 수 있습니다. 먼저 박스를 충원하세요.';
    end if;
    v_box_count := (p_payload ->> 'box_count')::integer;
    if v_box_count is null or v_box_count < 1 then
      raise exception '개봉할 박스 수를 입력하세요.';
    end if;
    if v_box_count > v_position.remaining_boxes then
      raise exception '남은 박스보다 많이 개봉할 수 없습니다.';
    end if;
    update public.warehouse_stock_positions
    set remaining_boxes = remaining_boxes - v_box_count,
        opened_units = opened_units + v_box_count * units_per_box
    where id = v_position.id
    returning * into v_position;

    insert into public.warehouse_stock_movements (
      brand_id, set_id, action, position_id, style_id,
      from_location_code, to_location_code, box_count, unit_count, reason, actor_id
    )
    values (
      p_brand_id, v_set.id, 'open', v_position.id, v_position.style_id,
      v_location.code, v_location.code, v_box_count,
      v_box_count * v_position.units_per_box,
      coalesce(p_payload ->> 'reason', '박스 개봉'),
      auth.uid()
    );
    return to_jsonb(v_position);
  end if;

  v_to_code := btrim(coalesce(p_payload ->> 'to_location_code', ''));
  v_to_zone := coalesce(
    nullif(btrim(p_payload ->> 'to_zone'), ''),
    case when p_action = 'replenish' then 'picking' else v_location.zone end
  );
  v_box_count := coalesce(
    (p_payload ->> 'box_count')::integer,
    v_position.remaining_boxes
  );
  if v_to_code = '' then
    raise exception '옮길 자리번호를 입력하세요.';
  end if;
  if v_box_count < 1 then
    raise exception '옮길 박스 수는 1 이상이어야 합니다.';
  end if;
  if v_box_count > v_position.remaining_boxes then
    raise exception '남은 박스보다 많이 옮길 수 없습니다.';
  end if;
  if p_action = 'move' and v_location.zone = 'box_storage' and v_to_zone <> 'box_storage' then
    raise exception '박스창고에서는 박스 단위 자리 이동만 할 수 있습니다. 출고 충원은 충원 작업을 쓰세요.';
  end if;

  insert into public.warehouse_locations (company_id, warehouse_id, code, zone)
  values (v_company_id, v_set.warehouse_id, v_to_code, v_to_zone)
  on conflict (warehouse_id, zone, code) do update
    set code = excluded.code
  returning id into v_to_location_id;

  if v_box_count = v_position.remaining_boxes then
    update public.warehouse_stock_positions
    set location_id = v_to_location_id
    where id = v_position.id
    returning * into v_position;
  else
    update public.warehouse_stock_positions
    set remaining_boxes = remaining_boxes - v_box_count
    where id = v_position.id
    returning * into v_position;

    insert into public.warehouse_stock_positions (
      brand_id, set_id, warehouse_id, location_id, style_id,
      source_style_no, normalized_style_no, source_product_name,
      received_on, received_on_raw, is_forced_priority, is_final_location,
      units_per_box, remaining_boxes, review_flags, source_row_number, note
    )
    values (
      v_position.brand_id, v_position.set_id, v_position.warehouse_id, v_to_location_id,
      v_position.style_id, v_position.source_style_no, v_position.normalized_style_no,
      v_position.source_product_name, v_position.received_on, v_position.received_on_raw,
      v_position.is_forced_priority, v_position.is_final_location,
      v_position.units_per_box, v_box_count, v_position.review_flags,
      v_position.source_row_number, v_position.note
    )
    returning * into v_target;
  end if;

  insert into public.warehouse_stock_movements (
    brand_id, set_id, action, position_id, style_id,
    from_location_code, to_location_code, box_count, unit_count, reason, actor_id
  )
  values (
    p_brand_id, v_set.id, p_action, coalesce(v_target.id, v_position.id),
    v_position.style_id, v_location.code, v_to_code, v_box_count,
    v_box_count * v_position.units_per_box,
    coalesce(
      p_payload ->> 'reason',
      case when p_action = 'replenish' then '출고창고 박스 충원' else '자리 이동' end
    ),
    auth.uid()
  );

  return jsonb_build_object(
    'source', to_jsonb(v_position),
    'moved', to_jsonb(v_target)
  );
end;
$$;

comment on function public.apply_warehouse_stock_action(uuid, text, jsonb) is
  '연습 창고 입고·이동·소진·실사·충원·개봉. 잔여 박스는 음수가 될 수 없다.';

revoke all on function public.apply_warehouse_stock_action(uuid, text, jsonb)
  from public, anon;
grant execute on function public.apply_warehouse_stock_action(uuid, text, jsonb)
  to authenticated;

create or replace function public.restore_warehouse_inventory_set(
  p_brand_id uuid,
  p_set_id uuid
)
returns public.warehouse_inventory_sets
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_set public.warehouse_inventory_sets;
begin
  if not app.can_edit_brand(p_brand_id) then
    raise exception '창고 연습 데이터를 복원할 권한이 없습니다.';
  end if;

  select *
    into v_set
  from public.warehouse_inventory_sets
  where brand_id = p_brand_id
    and id = p_set_id;
  if v_set.id is null then
    raise exception '복원할 연습 세트를 찾지 못했습니다.';
  end if;
  if v_set.kind <> 'sandbox' then
    raise exception '연습 세트만 복원할 수 있습니다.';
  end if;
  if v_set.status = 'active' then
    return v_set;
  end if;

  update public.warehouse_inventory_sets
  set status = 'archived'
  where brand_id = p_brand_id
    and kind = 'sandbox'
    and status = 'active'
    and id <> p_set_id;

  update public.warehouse_inventory_sets
  set status = 'active'
  where brand_id = p_brand_id
    and id = p_set_id
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
    v_set.row_count,
    '이전 연습 세트 복원',
    auth.uid()
  );

  return v_set;
end;
$$;

comment on function public.restore_warehouse_inventory_set(uuid, uuid) is
  '보관한 연습 세트를 다시 활성화하고 현재 세트는 보관한다.';

revoke all on function public.restore_warehouse_inventory_set(uuid, uuid)
  from public, anon;
grant execute on function public.restore_warehouse_inventory_set(uuid, uuid)
  to authenticated;
