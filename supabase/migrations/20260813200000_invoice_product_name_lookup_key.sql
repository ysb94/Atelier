-- 기존 VLOOKUP 원장은 조합 열이 아니라 조회 키 문자열 한 개로 정답을 찾는다.
-- 조회 키는 `품목명 + " " + 옵션 앞부분`처럼 수식이 만든 문자열 그대로다.

alter table public.invoice_product_name_maps
  add column if not exists lookup_key text not null default '',
  add column if not exists normalized_lookup_key text not null default '';

comment on column public.invoice_product_name_maps.lookup_key is
  '기존 원장 조회 키 문자열. 품목명+옵션 앞부분 등 후보 수식 결과를 그대로 담는다.';
comment on column public.invoice_product_name_maps.normalized_lookup_key is
  '조회 키 매칭용 정규화 값. 빈 값이면 쇼핑몰+품목명+내품명 문맥 조합으로 매칭한다.';

-- 같은 조회 키가 서로 다른 공식명을 가리키면 저장 자체를 막는다.
create unique index if not exists invoice_product_name_maps_lookup_key_uidx
  on public.invoice_product_name_maps (brand_id, normalized_lookup_key)
  where normalized_lookup_key <> '';

create index if not exists invoice_product_name_maps_lookup_active_idx
  on public.invoice_product_name_maps (brand_id, normalized_lookup_key)
  where is_active and normalized_lookup_key <> '';
