-- 접두어 항목에서 채널상품번호를 빼고,
-- 접두어에 따라 실제로 나가는 제품명 목록과 랜덤 여부를 담는다.
alter table public.invoice_prefix_items
  drop column if exists channel_product_no;

alter table public.invoice_prefix_items
  add column if not exists outgoing_product_names text[] not null default '{}',
  add column if not exists is_random boolean not null default false;

comment on column public.invoice_prefix_items.outgoing_product_names is
  '접두어가 붙을 때 함께 나가는 제품명. 데이터 시트 상품명에서 고른다.';
comment on column public.invoice_prefix_items.is_random is
  '나가는 제품이 여러 개일 때 그중 하나를 랜덤으로 출고하는지 여부.';

alter table public.invoice_prefix_items
  drop constraint if exists invoice_prefix_items_random_check;

alter table public.invoice_prefix_items
  add constraint invoice_prefix_items_random_check
  check (not is_random or cardinality(outgoing_product_names) >= 2);
