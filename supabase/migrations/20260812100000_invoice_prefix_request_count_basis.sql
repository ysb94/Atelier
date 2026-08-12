-- 요청 건마다 사은품을 몇 개 낼지, 합포장 상자에서는 어떻게 줄일지를 저장한다.
alter table public.invoice_prefix_requests
  add column if not exists count_basis text not null default 'per_order',
  add column if not exists merge_basis text not null default 'per_order';

alter table public.invoice_prefix_requests
  drop constraint if exists invoice_prefix_requests_count_basis_check;

alter table public.invoice_prefix_requests
  add constraint invoice_prefix_requests_count_basis_check
  check (count_basis in ('per_order', 'per_product', 'per_quantity'));

alter table public.invoice_prefix_requests
  drop constraint if exists invoice_prefix_requests_merge_basis_check;

alter table public.invoice_prefix_requests
  add constraint invoice_prefix_requests_merge_basis_check
  check (merge_basis in ('per_order', 'per_shipment'));

comment on column public.invoice_prefix_requests.count_basis is
  '사은품 산정 단위. per_order=주문당 1개, per_product=대상 상품 종류당 1개, per_quantity=대상 수량만큼.';
comment on column public.invoice_prefix_requests.merge_basis is
  '합포장 처리. per_order=주문 수만큼, per_shipment=상자당 1개만.';
