-- 내품명 규칙에 조회 키 exact 범위를 추가한다.
-- 기존 global·main_style 규칙은 유지하고, 조회 키가 다른 행은 독립 규칙으로 둔다.

alter table public.invoice_item_name_rules
  add column if not exists product_lookup_key text not null default '',
  add column if not exists normalized_product_lookup_key text not null default '';

comment on column public.invoice_item_name_rules.product_lookup_key is
  '품목명 단계에서 본품을 맞춘 조회 키 원문. lookup_key 범위에서만 채운다.';
comment on column public.invoice_item_name_rules.normalized_product_lookup_key is
  '조회 키 exact 비교 키. normalizeInvoiceText와 같다.';

alter table public.invoice_item_name_rules
  drop constraint if exists invoice_item_name_rules_scope_check;
alter table public.invoice_item_name_rules
  add constraint invoice_item_name_rules_scope_check
  check (scope in ('global', 'main_style', 'lookup_key'));

alter table public.invoice_item_name_rules
  drop constraint if exists invoice_item_name_rules_scope_main_check;
alter table public.invoice_item_name_rules
  add constraint invoice_item_name_rules_scope_main_check
  check (
    (
      scope = 'global'
      and main_style_id is null
      and length(btrim(product_lookup_key)) = 0
      and length(btrim(normalized_product_lookup_key)) = 0
    )
    or (
      scope = 'main_style'
      and main_style_id is not null
      and length(btrim(product_lookup_key)) = 0
      and length(btrim(normalized_product_lookup_key)) = 0
    )
    or (
      scope = 'lookup_key'
      and main_style_id is not null
      and length(btrim(product_lookup_key)) > 0
      and length(btrim(normalized_product_lookup_key)) > 0
    )
  );

create unique index if not exists invoice_item_name_rules_lookup_active_uidx
  on public.invoice_item_name_rules (
    brand_id,
    main_style_id,
    normalized_item_name,
    normalized_product_lookup_key
  )
  where is_active and scope = 'lookup_key';

create index if not exists invoice_item_name_rules_lookup_idx
  on public.invoice_item_name_rules (
    brand_id,
    main_style_id,
    normalized_item_name,
    normalized_product_lookup_key
  )
  where is_active and scope = 'lookup_key';
