-- 쇼핑몰+품목명+내품명 exact 조합을 최종 송장에서 빼는 기준.
-- 본품 연결이 없고, 모든 쇼핑몰에 적용하는 광범위 규칙은 허용하지 않는다.

create table if not exists public.invoice_product_name_exclusions (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  mall_name text not null,
  normalized_mall_name text not null,
  product_name text not null
    check (length(btrim(product_name)) > 0),
  normalized_product_name text not null,
  item_name text not null
    check (length(btrim(item_name)) > 0),
  normalized_item_name text not null,
  is_active boolean not null default true,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_product_name_exclusions_brand_id_id_key unique (brand_id, id),
  constraint invoice_product_name_exclusions_combo_key unique (
    brand_id,
    normalized_mall_name,
    normalized_product_name,
    normalized_item_name
  ),
  constraint invoice_product_name_exclusions_mall_required check (
    length(btrim(mall_name)) > 0
    and length(btrim(normalized_mall_name)) > 0
  )
);

comment on table public.invoice_product_name_exclusions is
  '사방넷 원본 쇼핑몰·품목명·내품명 exact 조합을 최종 송장 출력에서 제외하는 기준. 본품 연결 없음.';
comment on column public.invoice_product_name_exclusions.mall_name is
  '적용 쇼핑몰. 비울 수 없다. 모든 쇼핑몰 규칙은 허용하지 않는다.';
comment on column public.invoice_product_name_exclusions.product_name is
  '사방넷 원본 품목명. 조회 키는 normalized_product_name.';
comment on column public.invoice_product_name_exclusions.item_name is
  '사방넷 원본 내품명. 조회 키는 normalized_item_name.';

create index if not exists invoice_product_name_exclusions_brand_combo_idx
  on public.invoice_product_name_exclusions (
    brand_id,
    normalized_mall_name,
    normalized_product_name,
    normalized_item_name
  )
  where is_active;

create trigger invoice_product_name_exclusions_set_updated_at
before update on public.invoice_product_name_exclusions
for each row execute function public.set_updated_at();

alter table public.invoice_product_name_exclusions enable row level security;

drop policy if exists invoice_product_name_exclusions_all_member
  on public.invoice_product_name_exclusions;
create policy invoice_product_name_exclusions_all_member
on public.invoice_product_name_exclusions
for all
to authenticated
using (app.can_read_brand(brand_id))
with check (app.can_edit_brand(brand_id));

grant select, insert, update, delete
on table public.invoice_product_name_exclusions
to authenticated;
