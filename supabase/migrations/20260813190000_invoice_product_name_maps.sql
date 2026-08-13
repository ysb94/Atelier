-- 품목명 변환 전용 exact 기준. 내품명은 조회 문맥일 뿐 출력값이 아니다.
-- 내품명·출고구성은 기존 invoice_option_maps에서만 다룬다.

create table if not exists public.invoice_product_name_maps (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  mall_name text not null default '',
  normalized_mall_name text not null default '',
  product_name text not null
    check (length(btrim(product_name)) > 0),
  normalized_product_name text not null,
  item_name_context text not null default '',
  normalized_item_name_context text not null default '',
  own_product_code text not null default '',
  normalized_own_product_code text not null default '',
  style_id uuid not null,
  is_active boolean not null default true,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_product_name_maps_brand_id_id_key unique (brand_id, id),
  constraint invoice_product_name_maps_combo_key unique (
    brand_id,
    normalized_mall_name,
    normalized_product_name,
    normalized_item_name_context
  ),
  constraint invoice_product_name_maps_style_fkey
    foreign key (brand_id, style_id)
    references public.styles (brand_id, id)
);

comment on table public.invoice_product_name_maps is
  '사방넷 원본 품목명(+내품명 문맥)을 본품 styles.id로 연결하는 품목명 전용 기준.';
comment on column public.invoice_product_name_maps.mall_name is
  '비우면 모든 쇼핑몰에 적용. 값이 있으면 그 쇼핑몰만.';
comment on column public.invoice_product_name_maps.product_name is
  '사방넷 원본 품목명. 조회 키는 normalized_product_name.';
comment on column public.invoice_product_name_maps.item_name_context is
  '매칭 문맥용 원본 내품명. 출력 내품명이 아니며 이 단계에서 바꾸지 않는다.';
comment on column public.invoice_product_name_maps.own_product_code is
  '참고용 자체상품코드. 단독 정답이 아니라 보조 신호.';
comment on column public.invoice_product_name_maps.style_id is
  '본품 공식 상품. 표시 이름은 styles.name을 조인한다.';

create index if not exists invoice_product_name_maps_brand_product_idx
  on public.invoice_product_name_maps (
    brand_id,
    normalized_product_name,
    normalized_item_name_context
  )
  where is_active;

create index if not exists invoice_product_name_maps_style_idx
  on public.invoice_product_name_maps (brand_id, style_id);

create trigger invoice_product_name_maps_set_updated_at
before update on public.invoice_product_name_maps
for each row execute function public.set_updated_at();

alter table public.invoice_product_name_maps enable row level security;

drop policy if exists invoice_product_name_maps_all_member
  on public.invoice_product_name_maps;
create policy invoice_product_name_maps_all_member
on public.invoice_product_name_maps
for all
to authenticated
using (app.can_read_brand(brand_id))
with check (app.can_edit_brand(brand_id));

grant select, insert, update, delete
on table public.invoice_product_name_maps
to authenticated;

-- 내품명 단계에서만 쓰는 표시 문자열. 비우면 원본 내품명을 유지한다.
alter table public.invoice_option_maps
  add column if not exists display_item_name text not null default '';

comment on column public.invoice_option_maps.display_item_name is
  '승인된 변환 내품명. 비우면 CJ 내품명은 원문을 유지하고 구성품만 출고구성에 기록한다.';
