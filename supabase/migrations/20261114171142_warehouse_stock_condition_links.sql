create table public.warehouse_stock_condition_links (
  brand_id uuid not null,
  external_row_id text not null check (btrim(external_row_id) <> ''),
  source_product_name text not null check (btrim(source_product_name) <> ''),
  reference_style_id uuid not null,
  condition text not null check (condition = 'defective'),
  primary key (brand_id, external_row_id),
  constraint warehouse_stock_condition_links_style_fkey
    foreign key (brand_id, reference_style_id)
    references public.styles (brand_id, id) on delete restrict
);

comment on table public.warehouse_stock_condition_links is
  '시트 AA에 연결한 품목과 판매 제외 상태. 정상 재고의 style_id와 M번호에 합치지 않는다.';

alter table public.warehouse_stock_condition_links enable row level security;
revoke all on public.warehouse_stock_condition_links from public, anon, authenticated;
grant select on public.warehouse_stock_condition_links to authenticated;
grant select, insert, update, delete on public.warehouse_stock_condition_links to service_role;

create policy warehouse_stock_condition_links_select_member
  on public.warehouse_stock_condition_links for select to authenticated
  using (app.can_read_brand(brand_id));
