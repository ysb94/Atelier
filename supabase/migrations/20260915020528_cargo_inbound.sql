-- 화문에서 선적된 화물과 품목별 입고 명세를 회사 공용 DB에 보관한다.

create table public.cargo_inbound_shipments (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete restrict,
  shipment_no text not null,
  stage text not null default 'shipped'
    check (stage in ('shipped', 'scheduled', 'done')),
  shipped_on date not null,
  scheduled_inbound_on date,
  port_contact_note text not null default '',
  vessel_name text not null default '',
  origin_port text not null default '',
  warehouse_summary text not null default '',
  completed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cargo_inbound_shipments_brand_no_key unique (brand_id, shipment_no),
  constraint cargo_inbound_shipments_brand_id_id_key unique (brand_id, id),
  constraint cargo_inbound_shipments_stage_dates_check check (
    (stage = 'shipped')
    or (stage = 'scheduled' and scheduled_inbound_on is not null)
    or (
      stage = 'done'
      and scheduled_inbound_on is not null
      and completed_at is not null
    )
  )
);

comment on table public.cargo_inbound_shipments is
  '화문 선적 화물 1건. 선적됨, 입고일 협의, 창고 정리 완료 단계를 관리한다.';

create index cargo_inbound_shipments_brand_stage_idx
  on public.cargo_inbound_shipments (brand_id, stage, shipped_on desc, created_at desc);

create trigger cargo_inbound_shipments_set_updated_at
before update on public.cargo_inbound_shipments
for each row execute function public.set_updated_at();

alter table public.cargo_inbound_shipments enable row level security;

create policy cargo_inbound_shipments_select
on public.cargo_inbound_shipments
for select
to authenticated
using (app.can_read_brand(brand_id));

create policy cargo_inbound_shipments_insert
on public.cargo_inbound_shipments
for insert
to authenticated
with check (app.can_edit_brand(brand_id));

create policy cargo_inbound_shipments_update
on public.cargo_inbound_shipments
for update
to authenticated
using (app.can_read_brand(brand_id))
with check (app.can_edit_brand(brand_id));

create policy cargo_inbound_shipments_delete
on public.cargo_inbound_shipments
for delete
to authenticated
using (app.can_edit_brand(brand_id));

grant select, insert, update, delete
on table public.cargo_inbound_shipments
to authenticated;

create table public.cargo_inbound_lines (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null,
  shipment_id uuid not null,
  source_row_no integer not null check (source_row_no > 0),
  item_no text not null default '',
  product_name text not null default '',
  style_id uuid,
  source_style_no text not null default '',
  quantity integer check (quantity is null or quantity >= 0),
  units_per_box integer check (units_per_box is null or units_per_box > 0),
  box_count integer check (box_count is null or box_count >= 0),
  photo_ref text not null default '',
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cargo_inbound_lines_brand_id_id_key unique (brand_id, id),
  constraint cargo_inbound_lines_shipment_row_key unique (shipment_id, source_row_no),
  constraint cargo_inbound_lines_shipment_fkey
    foreign key (brand_id, shipment_id)
    references public.cargo_inbound_shipments (brand_id, id) on delete cascade,
  constraint cargo_inbound_lines_style_fkey
    foreign key (brand_id, style_id)
    references public.styles (brand_id, id) on delete set null (style_id)
);

comment on table public.cargo_inbound_lines is
  '화물 엑셀의 SKU 단위 입고 명세. M번호 원문과 등록 시점 상품 연결을 함께 보관한다.';

create index cargo_inbound_lines_shipment_idx
  on public.cargo_inbound_lines (brand_id, shipment_id, source_row_no);

create index cargo_inbound_lines_style_idx
  on public.cargo_inbound_lines (brand_id, style_id)
  where style_id is not null;

create trigger cargo_inbound_lines_set_updated_at
before update on public.cargo_inbound_lines
for each row execute function public.set_updated_at();

alter table public.cargo_inbound_lines enable row level security;

create policy cargo_inbound_lines_select
on public.cargo_inbound_lines
for select
to authenticated
using (app.can_read_brand(brand_id));

create policy cargo_inbound_lines_insert
on public.cargo_inbound_lines
for insert
to authenticated
with check (app.can_edit_brand(brand_id));

create policy cargo_inbound_lines_update
on public.cargo_inbound_lines
for update
to authenticated
using (app.can_read_brand(brand_id))
with check (app.can_edit_brand(brand_id));

create policy cargo_inbound_lines_delete
on public.cargo_inbound_lines
for delete
to authenticated
using (app.can_edit_brand(brand_id));

grant select, insert, update, delete
on table public.cargo_inbound_lines
to authenticated;

create or replace function public.save_cargo_inbound(
  p_brand_id uuid,
  p_shipped_on date,
  p_lines jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_shipment_id uuid := gen_random_uuid();
  v_shipment_no text;
begin
  if p_brand_id is null or p_shipped_on is null then
    raise exception '브랜드와 선적일은 필수입니다.' using errcode = '22023';
  end if;

  if p_lines is null
    or jsonb_typeof(p_lines) <> 'array'
    or jsonb_array_length(p_lines) = 0
    or jsonb_array_length(p_lines) > 5000 then
    raise exception '화물 품목은 1행 이상 5000행 이하로 저장해야 합니다.'
      using errcode = '22023';
  end if;

  v_shipment_no := 'CI-' || to_char(p_shipped_on, 'YYYYMMDD') || '-'
    || upper(substr(replace(v_shipment_id::text, '-', ''), 1, 8));

  insert into public.cargo_inbound_shipments (
    id, brand_id, shipment_no, shipped_on
  ) values (
    v_shipment_id, p_brand_id, v_shipment_no, p_shipped_on
  );

  insert into public.cargo_inbound_lines (
    brand_id,
    shipment_id,
    source_row_no,
    item_no,
    product_name,
    style_id,
    source_style_no,
    quantity,
    units_per_box,
    box_count,
    photo_ref,
    note
  )
  select
    p_brand_id,
    v_shipment_id,
    line.source_row_no,
    btrim(coalesce(line.item_no, '')),
    btrim(coalesce(line.product_name, '')),
    (
      select style.id
      from public.styles style
      where style.brand_id = p_brand_id
        and style.style_no = btrim(coalesce(line.source_style_no, ''))
      limit 1
    ),
    btrim(coalesce(line.source_style_no, '')),
    line.quantity,
    line.units_per_box,
    line.box_count,
    btrim(coalesce(line.photo_ref, '')),
    btrim(coalesce(line.note, ''))
  from jsonb_to_recordset(p_lines) as line(
    source_row_no integer,
    item_no text,
    product_name text,
    source_style_no text,
    quantity integer,
    units_per_box integer,
    box_count integer,
    photo_ref text,
    note text
  );

  return v_shipment_id;
end;
$function$;

revoke all on function public.save_cargo_inbound(uuid, date, jsonb) from public;
grant execute on function public.save_cargo_inbound(uuid, date, jsonb) to authenticated;
