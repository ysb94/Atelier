-- 창고정리용 인쇄 목록을 화물별로 고정하고, 완료 때 창고자리만 이어서 저장한다.

alter table public.cargo_inbound_shipments
  add column if not exists tidy_saved_at timestamptz;

comment on column public.cargo_inbound_shipments.tidy_saved_at is
  '창고정리용 목록을 마지막으로 저장한 시각. 없으면 아직 인쇄 저장 전이다.';

create table public.cargo_inbound_tidy_rows (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null,
  shipment_id uuid not null,
  line_id uuid,
  row_no integer not null check (row_no > 0),
  part_index integer not null default 0 check (part_index >= 0),
  item_no text not null default '',
  product_name text not null default '',
  style_no text not null default '',
  quantity integer check (quantity is null or quantity >= 0),
  units_per_box integer check (units_per_box is null or units_per_box > 0),
  box_count integer check (box_count is null or box_count >= 0),
  stow_label text not null default '',
  note text not null default '',
  shipped_code text not null default '',
  latest_slot text not null default '',
  latest_box_count integer check (latest_box_count is null or latest_box_count >= 0),
  warehouse_slot text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cargo_inbound_tidy_rows_brand_id_id_key unique (brand_id, id),
  constraint cargo_inbound_tidy_rows_shipment_row_key unique (shipment_id, row_no),
  constraint cargo_inbound_tidy_rows_shipment_fkey
    foreign key (brand_id, shipment_id)
    references public.cargo_inbound_shipments (brand_id, id) on delete cascade,
  constraint cargo_inbound_tidy_rows_line_fkey
    foreign key (brand_id, line_id)
    references public.cargo_inbound_lines (brand_id, id) on delete set null (line_id)
);

comment on table public.cargo_inbound_tidy_rows is
  '창고정리용 인쇄 시점의 행. 다시 인쇄해도 이 목록을 유지하고, 창고자리는 완료 화면에서 입력한다.';

comment on column public.cargo_inbound_tidy_rows.warehouse_slot is
  '완료 화면에서 입력한 창고자리. 인쇄 저장 때는 비어 있다.';

create index cargo_inbound_tidy_rows_shipment_idx
  on public.cargo_inbound_tidy_rows (brand_id, shipment_id, row_no);

create index cargo_inbound_tidy_rows_line_idx
  on public.cargo_inbound_tidy_rows (brand_id, line_id)
  where line_id is not null;

create trigger cargo_inbound_tidy_rows_set_updated_at
before update on public.cargo_inbound_tidy_rows
for each row execute function public.set_updated_at();

alter table public.cargo_inbound_tidy_rows enable row level security;

create policy cargo_inbound_tidy_rows_select
on public.cargo_inbound_tidy_rows
for select
to authenticated
using (app.can_read_brand(brand_id));

create policy cargo_inbound_tidy_rows_insert
on public.cargo_inbound_tidy_rows
for insert
to authenticated
with check (app.can_edit_brand(brand_id));

create policy cargo_inbound_tidy_rows_update
on public.cargo_inbound_tidy_rows
for update
to authenticated
using (app.can_read_brand(brand_id))
with check (app.can_edit_brand(brand_id));

create policy cargo_inbound_tidy_rows_delete
on public.cargo_inbound_tidy_rows
for delete
to authenticated
using (app.can_edit_brand(brand_id));

grant select, insert, update, delete
on table public.cargo_inbound_tidy_rows
to authenticated;

create or replace function public.save_cargo_inbound_tidy_rows(
  p_brand_id uuid,
  p_shipment_id uuid,
  p_rows jsonb
)
returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_stage text;
  v_saved_at timestamptz;
begin
  if p_brand_id is null or p_shipment_id is null then
    raise exception '화물을 확인하세요.' using errcode = '22023';
  end if;
  if not app.can_edit_brand(p_brand_id) then
    raise exception '이 브랜드를 수정할 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_rows is null
    or jsonb_typeof(p_rows) <> 'array'
    or jsonb_array_length(p_rows) = 0
    or jsonb_array_length(p_rows) > 5000 then
    raise exception '창고정리용 목록은 1행 이상 5000행 이하로 저장해야 합니다.'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_rows) element
    where jsonb_typeof(element) <> 'object'
  ) then
    raise exception '창고정리용 목록 형식이 올바르지 않습니다.'
      using errcode = '22023';
  end if;

  select shipment.stage
  into v_stage
  from public.cargo_inbound_shipments shipment
  where shipment.brand_id = p_brand_id
    and shipment.id = p_shipment_id
  for update;

  if not found then
    raise exception '화물을 찾지 못했습니다.' using errcode = 'P0002';
  end if;
  if v_stage <> 'scheduled' then
    raise exception '입고일 협의 단계에서만 창고정리용 목록을 저장할 수 있습니다.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from rows from (
      jsonb_to_recordset(p_rows) as (
        line_id uuid,
        part_index integer,
        quantity integer,
        units_per_box integer,
        box_count integer,
        latest_box_count integer
      )
    ) as row(
      line_id,
      part_index,
      quantity,
      units_per_box,
      box_count,
      latest_box_count
    )
    where coalesce(row.part_index, 0) < 0
      or coalesce(row.quantity, 0) < 0
      or (row.units_per_box is not null and row.units_per_box <= 0)
      or coalesce(row.box_count, 0) < 0
      or coalesce(row.latest_box_count, 0) < 0
  ) then
    raise exception '창고정리용 수량을 확인하세요.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from rows from (
      jsonb_to_recordset(p_rows) as (line_id uuid)
    ) as row(line_id)
    where row.line_id is not null
      and not exists (
        select 1
        from public.cargo_inbound_lines line
        where line.brand_id = p_brand_id
          and line.shipment_id = p_shipment_id
          and line.id = row.line_id
      )
  ) then
    raise exception '이 화물에 없는 품목이 포함되어 있습니다.'
      using errcode = '22023';
  end if;

  delete from public.cargo_inbound_tidy_rows tidy
  where tidy.brand_id = p_brand_id
    and tidy.shipment_id = p_shipment_id;

  insert into public.cargo_inbound_tidy_rows (
    brand_id,
    shipment_id,
    line_id,
    row_no,
    part_index,
    item_no,
    product_name,
    style_no,
    quantity,
    units_per_box,
    box_count,
    stow_label,
    note,
    shipped_code,
    latest_slot,
    latest_box_count
  )
  select
    p_brand_id,
    p_shipment_id,
    src.line_id,
    src.row_no::integer,
    coalesce(src.part_index, 0),
    btrim(coalesce(src.item_no, '')),
    btrim(coalesce(src.product_name, '')),
    btrim(coalesce(src.style_no, '')),
    src.quantity,
    src.units_per_box,
    src.box_count,
    btrim(coalesce(src.stow_label, '')),
    btrim(coalesce(src.note, '')),
    btrim(coalesce(src.shipped_code, '')),
    btrim(coalesce(src.latest_slot, '')),
    src.latest_box_count
  from rows from (
    jsonb_to_recordset(p_rows) as (
      line_id uuid,
      part_index integer,
      item_no text,
      product_name text,
      style_no text,
      quantity integer,
      units_per_box integer,
      box_count integer,
      stow_label text,
      note text,
      shipped_code text,
      latest_slot text,
      latest_box_count integer
    )
  ) with ordinality as src(
    line_id,
    part_index,
    item_no,
    product_name,
    style_no,
    quantity,
    units_per_box,
    box_count,
    stow_label,
    note,
    shipped_code,
    latest_slot,
    latest_box_count,
    row_no
  );

  update public.cargo_inbound_shipments shipment
  set tidy_saved_at = now()
  where shipment.brand_id = p_brand_id
    and shipment.id = p_shipment_id
  returning shipment.tidy_saved_at into v_saved_at;

  return v_saved_at;
end;
$function$;

comment on function public.save_cargo_inbound_tidy_rows(uuid, uuid, jsonb) is
  '입고일 협의 화물의 창고정리용 목록을 인쇄 순서 그대로 교체 저장한다.';

revoke all on function public.save_cargo_inbound_tidy_rows(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_cargo_inbound_tidy_rows(uuid, uuid, jsonb)
  to authenticated;

create or replace function public.save_cargo_inbound_tidy_slots(
  p_brand_id uuid,
  p_shipment_id uuid,
  p_slots jsonb,
  p_complete boolean
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_stage text;
  v_saved_at timestamptz;
  v_total integer;
  v_filled integer;
begin
  if p_brand_id is null or p_shipment_id is null then
    raise exception '화물을 확인하세요.' using errcode = '22023';
  end if;
  if not app.can_edit_brand(p_brand_id) then
    raise exception '이 브랜드를 수정할 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_slots is null or jsonb_typeof(p_slots) <> 'array' then
    raise exception '창고자리 목록이 올바르지 않습니다.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_slots) > 5000 then
    raise exception '창고자리 목록이 올바르지 않습니다.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_slots) element
    where jsonb_typeof(element) <> 'object'
  ) then
    raise exception '창고자리 목록이 올바르지 않습니다.' using errcode = '22023';
  end if;

  select shipment.stage, shipment.tidy_saved_at
  into v_stage, v_saved_at
  from public.cargo_inbound_shipments shipment
  where shipment.brand_id = p_brand_id
    and shipment.id = p_shipment_id
  for update;

  if not found then
    raise exception '화물을 찾지 못했습니다.' using errcode = 'P0002';
  end if;
  if v_stage <> 'scheduled' then
    raise exception '입고일 협의 단계에서만 창고자리를 저장할 수 있습니다.'
      using errcode = '22023';
  end if;
  if v_saved_at is null then
    raise exception '창고정리용 목록이 없습니다. 먼저 인쇄하세요.'
      using errcode = '22023';
  end if;

  select count(*)::integer
  into v_total
  from public.cargo_inbound_tidy_rows tidy
  where tidy.brand_id = p_brand_id
    and tidy.shipment_id = p_shipment_id;

  if v_total = 0 then
    raise exception '창고정리용 목록이 없습니다. 먼저 인쇄하세요.'
      using errcode = '22023';
  end if;

  if (
    select count(*)
    from jsonb_to_recordset(p_slots) as slot(id uuid)
  ) <> (
    select count(distinct slot.id)
    from jsonb_to_recordset(p_slots) as slot(id uuid)
  ) then
    raise exception '창고자리 목록이 올바르지 않습니다.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_slots) as slot(warehouse_slot text)
    where char_length(btrim(coalesce(slot.warehouse_slot, ''))) > 80
  ) then
    raise exception '창고자리는 80자 이하로 입력하세요.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_slots) as slot(id uuid)
    where slot.id is null
      or not exists (
        select 1
        from public.cargo_inbound_tidy_rows tidy
        where tidy.brand_id = p_brand_id
          and tidy.shipment_id = p_shipment_id
          and tidy.id = slot.id
      )
  ) then
    raise exception '목록이 바뀌었습니다. 다시 열어 주세요.'
      using errcode = '22023';
  end if;

  update public.cargo_inbound_tidy_rows tidy
  set warehouse_slot = btrim(coalesce(slot.warehouse_slot, ''))
  from jsonb_to_recordset(p_slots) as slot(id uuid, warehouse_slot text)
  where tidy.brand_id = p_brand_id
    and tidy.shipment_id = p_shipment_id
    and tidy.id = slot.id;

  if coalesce(p_complete, false) then
    select
      count(*)::integer,
      count(*) filter (where btrim(tidy.warehouse_slot) <> '')::integer
    into v_total, v_filled
    from public.cargo_inbound_tidy_rows tidy
    where tidy.brand_id = p_brand_id
      and tidy.shipment_id = p_shipment_id;

    update public.cargo_inbound_shipments shipment
    set
      stage = 'done',
      completed_at = now(),
      warehouse_summary = '창고자리 ' || v_filled::text || '/' || v_total::text || '행 입력'
    where shipment.brand_id = p_brand_id
      and shipment.id = p_shipment_id;
  end if;
end;
$function$;

comment on function public.save_cargo_inbound_tidy_slots(uuid, uuid, jsonb, boolean) is
  '저장된 창고정리용 목록의 창고자리를 갱신한다. 완료면 같은 작업에서 정리 완료로 바꾼다.';

revoke all on function public.save_cargo_inbound_tidy_slots(uuid, uuid, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.save_cargo_inbound_tidy_slots(uuid, uuid, jsonb, boolean)
  to authenticated;
