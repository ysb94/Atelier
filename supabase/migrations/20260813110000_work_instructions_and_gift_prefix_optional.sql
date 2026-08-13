-- 사은품 항목의 prefix는 더 이상 쓰지 않는다(빈 값 허용).
-- 작업 지시(전체 선물포장 등)는 별도 테이블로 관리한다.

-- ---------------------------------------------------------------------------
-- 1) 사은품 항목: prefix optional / deprecated
-- ---------------------------------------------------------------------------
alter table public.invoice_prefix_items
  drop constraint if exists invoice_prefix_items_prefix_check;

alter table public.invoice_prefix_items
  alter column prefix set default '';

update public.invoice_prefix_items
set prefix = ''
where prefix is null;

alter table public.invoice_prefix_items
  alter column prefix set not null;

comment on column public.invoice_prefix_items.prefix is
  'deprecated. 사은품은 별도 행으로 나가며 원상품 접두어를 쓰지 않는다.';

-- ---------------------------------------------------------------------------
-- 2) 작업 지시
-- ---------------------------------------------------------------------------
create table if not exists public.invoice_work_instructions (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  title text not null
    check (length(btrim(title)) > 0),
  label_text text not null
    check (length(btrim(label_text)) > 0),
  is_active boolean not null default true,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_work_instructions_brand_id_key unique (brand_id, id)
);

comment on table public.invoice_work_instructions is
  '포장·특이사항 작업 지시. 원본 품목명 앞에 표시 문구를 붙인다.';
comment on column public.invoice_work_instructions.label_text is
  '최종 품목명 앞에 붙일 표시 문구. 예: [전체 선물포장]';

create table if not exists public.invoice_work_instruction_items (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null,
  instruction_id uuid not null,
  product_name text not null
    check (length(btrim(product_name)) > 0),
  normalized_product_name text generated always as (
    lower(regexp_replace(btrim(product_name), '[[:space:]]+', ' ', 'g'))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_work_instruction_items_instruction_fkey
    foreign key (brand_id, instruction_id)
    references public.invoice_work_instructions (brand_id, id)
    on delete cascade
);

comment on table public.invoice_work_instruction_items is
  '작업 지시 대상. 사방넷 원본 품목명과 완전 일치로 찾는다.';
comment on column public.invoice_work_instruction_items.product_name is
  '사방넷 품목명. 쇼핑몰·기간과 무관하게 exact-match한다.';

-- 브랜드 안에서 같은 원본 품목명은 한 지시에만 속한다.
create unique index if not exists invoice_work_instruction_items_brand_product_uidx
  on public.invoice_work_instruction_items (brand_id, normalized_product_name);

create index if not exists invoice_work_instructions_brand_active_idx
  on public.invoice_work_instructions (brand_id)
  where is_active;

create trigger invoice_work_instructions_set_updated_at
before update on public.invoice_work_instructions
for each row execute function public.set_updated_at();

create trigger invoice_work_instruction_items_set_updated_at
before update on public.invoice_work_instruction_items
for each row execute function public.set_updated_at();

alter table public.invoice_work_instructions enable row level security;
alter table public.invoice_work_instruction_items enable row level security;

drop policy if exists invoice_work_instructions_all_member
  on public.invoice_work_instructions;
create policy invoice_work_instructions_all_member
on public.invoice_work_instructions
for all
to authenticated
using (app.can_read_brand(brand_id))
with check (app.can_edit_brand(brand_id));

drop policy if exists invoice_work_instruction_items_all_member
  on public.invoice_work_instruction_items;
create policy invoice_work_instruction_items_all_member
on public.invoice_work_instruction_items
for all
to authenticated
using (app.can_read_brand(brand_id))
with check (app.can_edit_brand(brand_id));

grant select, insert, update, delete
on table public.invoice_work_instructions
to authenticated;

grant select, insert, update, delete
on table public.invoice_work_instruction_items
to authenticated;
