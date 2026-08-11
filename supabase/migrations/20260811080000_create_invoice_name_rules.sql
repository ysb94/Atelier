create table public.invoice_name_rules (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  match_type text not null
    check (
      match_type in (
        'own_product_code',
        'product_name',
        'product_and_item'
      )
    ),
  source_value text not null
    check (length(btrim(source_value)) > 0),
  normalized_source_value text generated always as (
    lower(regexp_replace(btrim(source_value), '[[:space:]]+', ' ', 'g'))
  ) stored,
  target_name text not null
    check (length(btrim(target_name)) > 0),
  is_active boolean not null default true,
  is_test boolean not null default false,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.invoice_name_rules is
  '사방넷 품목명을 CJ 송장용 표준 품목명으로 바꾸는 브랜드별 exact-match 규칙.';
comment on column public.invoice_name_rules.match_type is
  '적용 순서: 자체상품코드, 품목명, 품목명+내품명.';
comment on column public.invoice_name_rules.source_value is
  '엑셀에서 가져온 원본 식별값. 화면 표시와 재검토를 위해 원문을 보존한다.';
comment on column public.invoice_name_rules.normalized_source_value is
  '앞뒤/연속 공백과 영문 대소문자를 정규화한 exact-match 키.';
comment on column public.invoice_name_rules.is_test is
  '운영 기준정보로 확정하기 전 검증용 규칙인지 표시한다.';

create unique index invoice_name_rules_match_key_uidx
  on public.invoice_name_rules (
    brand_id,
    match_type,
    normalized_source_value
  );

create index invoice_name_rules_active_type_idx
  on public.invoice_name_rules (brand_id, match_type)
  where is_active;

create trigger invoice_name_rules_set_updated_at
before update on public.invoice_name_rules
for each row execute function public.set_updated_at();

alter table public.invoice_name_rules enable row level security;

create policy invoice_name_rules_all_member
on public.invoice_name_rules
for all
to authenticated
using (app.can_read_brand(brand_id))
with check (app.can_edit_brand(brand_id));

grant select, insert, update, delete
on table public.invoice_name_rules
to authenticated;
