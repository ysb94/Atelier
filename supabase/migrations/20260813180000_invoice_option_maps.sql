-- 사방넷 품목명·내품명 조합을 본품 + 구성품(M번호) 1:N으로 연결한다.
-- 주문 원본·개인정보는 저장하지 않는다. 변환 기준만 둔다.

create table if not exists public.invoice_option_maps (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  mall_name text not null default '',
  normalized_mall_name text not null default '',
  product_name text not null
    check (length(btrim(product_name)) > 0),
  normalized_product_name text not null,
  item_name text not null default '',
  normalized_item_name text not null default '',
  own_product_code text not null default '',
  normalized_own_product_code text not null default '',
  is_active boolean not null default true,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_option_maps_brand_id_id_key unique (brand_id, id),
  constraint invoice_option_maps_combo_key unique (
    brand_id,
    normalized_mall_name,
    normalized_product_name,
    normalized_item_name
  )
);

comment on table public.invoice_option_maps is
  '사방넷 원본 품목명·내품명 조합을 CJ 본품·구성품 M번호로 연결하는 기준.';
comment on column public.invoice_option_maps.mall_name is
  '비우면 모든 쇼핑몰에 적용. 값이 있으면 그 쇼핑몰만.';
comment on column public.invoice_option_maps.product_name is
  '사방넷 원본 품목명. 조회 키는 normalized_product_name.';
comment on column public.invoice_option_maps.item_name is
  '사방넷 원본 내품명(옵션). 비우면 품목명만으로 매칭.';
comment on column public.invoice_option_maps.own_product_code is
  '참고용 자체상품코드. 단독 정답이 아니라 보조 신호.';

create index if not exists invoice_option_maps_brand_product_idx
  on public.invoice_option_maps (brand_id, normalized_product_name, normalized_item_name)
  where is_active;

create trigger invoice_option_maps_set_updated_at
before update on public.invoice_option_maps
for each row execute function public.set_updated_at();

create table if not exists public.invoice_option_map_components (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null,
  map_id uuid not null,
  style_id uuid not null,
  role text not null
    check (role in ('main', 'included', 'required', 'paid_add')),
  quantity integer not null default 1
    check (quantity >= 1),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint invoice_option_map_components_map_fkey
    foreign key (brand_id, map_id)
    references public.invoice_option_maps (brand_id, id)
    on delete cascade,
  constraint invoice_option_map_components_style_fkey
    foreign key (brand_id, style_id)
    references public.styles (brand_id, id),
  constraint invoice_option_map_components_map_style_role_key
    unique (map_id, style_id, role)
);

comment on table public.invoice_option_map_components is
  '조합이 확정됐을 때 실제로 나가는 M번호. main은 본품 1개.';
comment on column public.invoice_option_map_components.role is
  'main=본품, included=기본포함, required=필수옵션, paid_add=유료추가.';
comment on column public.invoice_option_map_components.quantity is
  '주문 1행당 구성 수량. 최종 출고는 내품수량 × 이 값.';

create unique index if not exists invoice_option_map_components_one_main_uidx
  on public.invoice_option_map_components (map_id)
  where role = 'main';

create index if not exists invoice_option_map_components_map_idx
  on public.invoice_option_map_components (map_id, sort_order);

create index if not exists invoice_option_map_components_style_idx
  on public.invoice_option_map_components (brand_id, style_id);

alter table public.invoice_option_maps enable row level security;
alter table public.invoice_option_map_components enable row level security;

drop policy if exists invoice_option_maps_all_member
  on public.invoice_option_maps;
create policy invoice_option_maps_all_member
on public.invoice_option_maps
for all
to authenticated
using (app.can_read_brand(brand_id))
with check (app.can_edit_brand(brand_id));

drop policy if exists invoice_option_map_components_all_member
  on public.invoice_option_map_components;
create policy invoice_option_map_components_all_member
on public.invoice_option_map_components
for all
to authenticated
using (app.can_read_brand(brand_id))
with check (app.can_edit_brand(brand_id));

grant select, insert, update, delete
on table public.invoice_option_maps
to authenticated;

grant select, insert, update, delete
on table public.invoice_option_map_components
to authenticated;
