-- 작업 지시가 Gift box 같은 포장재를 셀 수 있게 나가는 제품(M번호)과 산정 단위를 둔다.
-- 실재고 테이블은 아직 만들지 않는다. 오늘 작업 집계가 이후 stock_reservations의 입력이 된다.

alter table public.invoice_work_instructions
  add column if not exists count_basis text not null default 'per_shipment';

alter table public.invoice_work_instructions
  drop constraint if exists invoice_work_instructions_count_basis_check;

alter table public.invoice_work_instructions
  add constraint invoice_work_instructions_count_basis_check
  check (
    count_basis in ('per_shipment', 'per_order', 'per_row', 'per_quantity')
  );

comment on column public.invoice_work_instructions.count_basis is
  '나가는 포장재 산정. per_shipment=합포장 상자당 1, per_order=주문건당 1, per_row=대상 행당 1, per_quantity=내품수량 합.';

create table if not exists public.invoice_work_instruction_products (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null,
  instruction_id uuid not null,
  style_id uuid not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint invoice_work_instruction_products_instruction_fkey
    foreign key (brand_id, instruction_id)
    references public.invoice_work_instructions (brand_id, id)
    on delete cascade,
  constraint invoice_work_instruction_products_style_fkey
    foreign key (brand_id, style_id)
    references public.styles (brand_id, id),
  constraint invoice_work_instruction_products_instruction_style_key
    unique (instruction_id, style_id)
);

comment on table public.invoice_work_instruction_products is
  '작업 지시가 적용될 때 나가는 포장재·부자재. styles(M번호)를 가리킨다.';
comment on column public.invoice_work_instruction_products.style_id is
  '나가는 제품. styles.id. 이름은 읽을 때 styles.name을 쓴다.';

create index if not exists invoice_work_instruction_products_instruction_idx
  on public.invoice_work_instruction_products (instruction_id, sort_order);

create index if not exists invoice_work_instruction_products_style_idx
  on public.invoice_work_instruction_products (brand_id, style_id);

alter table public.invoice_work_instruction_products enable row level security;

drop policy if exists invoice_work_instruction_products_all_member
  on public.invoice_work_instruction_products;

create policy invoice_work_instruction_products_all_member
on public.invoice_work_instruction_products
for all
to authenticated
using (app.can_read_brand(brand_id))
with check (app.can_edit_brand(brand_id));

grant select, insert, update, delete
on table public.invoice_work_instruction_products
to authenticated;
