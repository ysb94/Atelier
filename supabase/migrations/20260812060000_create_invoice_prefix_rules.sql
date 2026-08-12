create table public.invoice_prefix_rules (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  mall_name text not null
    check (length(btrim(mall_name)) > 0),
  normalized_mall_name text generated always as (
    lower(regexp_replace(btrim(mall_name), '[[:space:]]+', ' ', 'g'))
  ) stored,
  product_name text not null
    check (length(btrim(product_name)) > 0),
  normalized_product_name text generated always as (
    lower(regexp_replace(btrim(product_name), '[[:space:]]+', ' ', 'g'))
  ) stored,
  prefix text not null
    check (length(btrim(prefix)) > 0),
  is_active boolean not null default true,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.invoice_prefix_rules is
  '특정 쇼핑몰의 품목명이 완전 일치할 때 최종 품목명 앞에 붙일 접두어 규칙.';
comment on column public.invoice_prefix_rules.mall_name is
  '사방넷 쇼핑몰명 원문. 화면 표시와 재검토를 위해 원문을 보존한다.';
comment on column public.invoice_prefix_rules.product_name is
  '사방넷 원본 품목명. 자체품번코드 변환 전 값과 완전 일치해야 한다.';
comment on column public.invoice_prefix_rules.prefix is
  '최종 품목명 앞에 붙일 문자열. 실제 결합은 모든 변환이 끝난 뒤 수행한다.';

create unique index invoice_prefix_rules_match_key_uidx
  on public.invoice_prefix_rules (
    brand_id,
    normalized_mall_name,
    normalized_product_name
  );

create index invoice_prefix_rules_active_idx
  on public.invoice_prefix_rules (brand_id)
  where is_active;

create trigger invoice_prefix_rules_set_updated_at
before update on public.invoice_prefix_rules
for each row execute function public.set_updated_at();

alter table public.invoice_prefix_rules enable row level security;

create policy invoice_prefix_rules_all_member
on public.invoice_prefix_rules
for all
to authenticated
using (app.can_read_brand(brand_id))
with check (app.can_edit_brand(brand_id));

grant select, insert, update, delete
on table public.invoice_prefix_rules
to authenticated;
