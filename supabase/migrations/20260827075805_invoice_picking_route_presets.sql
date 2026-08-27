-- 피킹표 미리보기에서 쓰는 이름 있는 동선 사전.
-- 브랜드·창고 존별 기준정보이며 재고·예약·송장 원장은 바꾸지 않는다.

create table if not exists public.invoice_picking_route_presets (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  warehouse_zone text not null
    check (warehouse_zone in ('picking', 'box_storage')),
  name text not null
    check (length(btrim(name)) > 0),
  sort_order integer not null default 0,
  route_groups jsonb not null default '[]'::jsonb
    check (jsonb_typeof(route_groups) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_picking_route_presets_brand_id_id_key
    unique (brand_id, id),
  constraint invoice_picking_route_presets_name_key
    unique (brand_id, warehouse_zone, name)
);

comment on table public.invoice_picking_route_presets is
  '브랜드·창고 존별 피킹표 동선 사전. 재고·예약·송장 원장은 바꾸지 않는다.';
comment on column public.invoice_picking_route_presets.warehouse_zone is
  '출고창고 picking 또는 박스창고 box_storage. 목록은 이 존으로만 나눈다.';
comment on column public.invoice_picking_route_presets.route_groups is
  '카드 순서 JSON. 예: [{"zonePrefixes":["2","4"]}]. 미지정은 넣지 않는다.';

create index if not exists invoice_picking_route_presets_zone_idx
  on public.invoice_picking_route_presets (brand_id, warehouse_zone, sort_order, name);

create or replace function public.invoice_picking_route_presets_normalize()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.name := btrim(new.name);
  if new.name = '' then
    raise exception '동선 이름을 입력하세요.';
  end if;
  if jsonb_typeof(new.route_groups) <> 'array' then
    raise exception '동선 카드 형식이 올바르지 않습니다.';
  end if;
  return new;
end;
$$;

drop trigger if exists invoice_picking_route_presets_normalize
  on public.invoice_picking_route_presets;
create trigger invoice_picking_route_presets_normalize
before insert or update on public.invoice_picking_route_presets
for each row execute function public.invoice_picking_route_presets_normalize();

drop trigger if exists invoice_picking_route_presets_set_updated_at
  on public.invoice_picking_route_presets;
create trigger invoice_picking_route_presets_set_updated_at
before update on public.invoice_picking_route_presets
for each row execute function public.set_updated_at();

alter table public.invoice_picking_route_presets enable row level security;

drop policy if exists invoice_picking_route_presets_select_member
  on public.invoice_picking_route_presets;
create policy invoice_picking_route_presets_select_member
on public.invoice_picking_route_presets
for select
to authenticated
using (app.can_read_brand(brand_id));

drop policy if exists invoice_picking_route_presets_insert_editor
  on public.invoice_picking_route_presets;
create policy invoice_picking_route_presets_insert_editor
on public.invoice_picking_route_presets
for insert
to authenticated
with check (app.can_edit_brand(brand_id));

drop policy if exists invoice_picking_route_presets_update_editor
  on public.invoice_picking_route_presets;
create policy invoice_picking_route_presets_update_editor
on public.invoice_picking_route_presets
for update
to authenticated
using (app.can_edit_brand(brand_id))
with check (app.can_edit_brand(brand_id));

drop policy if exists invoice_picking_route_presets_delete_editor
  on public.invoice_picking_route_presets;
create policy invoice_picking_route_presets_delete_editor
on public.invoice_picking_route_presets
for delete
to authenticated
using (app.can_edit_brand(brand_id));

grant select, insert, update, delete
on table public.invoice_picking_route_presets
to authenticated;
