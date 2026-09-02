-- 오늘 작업은 업로드 후보 키만 조회하고, 기준정보 전체 목록의 정렬을 돕는다.

create index if not exists invoice_product_name_maps_brand_updated_idx
  on public.invoice_product_name_maps (brand_id, updated_at desc);

create or replace function app.list_invoice_product_name_maps_for_keys_core(
  p_brand_id uuid,
  p_texts text[]
)
returns table (
  id uuid,
  brand_id uuid,
  mall_name text,
  normalized_mall_name text,
  product_name text,
  normalized_product_name text,
  item_name_context text,
  normalized_item_name_context text,
  own_product_code text,
  normalized_own_product_code text,
  lookup_key text,
  normalized_lookup_key text,
  style_id uuid,
  is_active boolean,
  note text,
  created_at timestamptz,
  updated_at timestamptz,
  style_no text,
  style_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if p_brand_id is null then
    raise exception 'brand_id is required';
  end if;
  if not app.can_read_brand(p_brand_id) then
    raise exception 'not allowed';
  end if;

  return query
  with queries as (
    select distinct k.q
    from unnest(coalesce(p_texts, array[]::text[])) as t
    cross join lateral (
      select app.normalize_invoice_lookup_key(t) as q
    ) k
    where k.q <> ''
  )
  select
    m.id,
    m.brand_id,
    m.mall_name,
    m.normalized_mall_name,
    m.product_name,
    m.normalized_product_name,
    m.item_name_context,
    m.normalized_item_name_context,
    m.own_product_code,
    m.normalized_own_product_code,
    m.lookup_key,
    m.normalized_lookup_key,
    m.style_id,
    m.is_active,
    m.note,
    m.created_at,
    m.updated_at,
    s.style_no,
    s.name
  from public.invoice_product_name_maps m
  join queries q
    on q.q = m.normalized_lookup_key
  join public.styles s
    on s.id = m.style_id
   and s.brand_id = m.brand_id
  where m.brand_id = p_brand_id
    and m.is_active
    and m.normalized_lookup_key <> '';
end;
$function$;

revoke all on function app.list_invoice_product_name_maps_for_keys_core(uuid, text[])
  from public;
grant execute on function app.list_invoice_product_name_maps_for_keys_core(uuid, text[])
  to authenticated;

create or replace function public.list_invoice_product_name_maps_for_keys(
  p_brand_id uuid,
  p_texts text[]
)
returns table (
  id uuid,
  brand_id uuid,
  mall_name text,
  normalized_mall_name text,
  product_name text,
  normalized_product_name text,
  item_name_context text,
  normalized_item_name_context text,
  own_product_code text,
  normalized_own_product_code text,
  lookup_key text,
  normalized_lookup_key text,
  style_id uuid,
  is_active boolean,
  note text,
  created_at timestamptz,
  updated_at timestamptz,
  style_no text,
  style_name text
)
language sql
stable
security invoker
set search_path = public, app
as $$
  select *
  from app.list_invoice_product_name_maps_for_keys_core(p_brand_id, p_texts);
$$;

comment on function public.list_invoice_product_name_maps_for_keys(uuid, text[]) is
  '업로드 파일 후보 문자열과 정규화 키가 맞는 활성 품목명 원장만 반환한다.';

revoke all on function public.list_invoice_product_name_maps_for_keys(uuid, text[])
  from public;
grant execute on function public.list_invoice_product_name_maps_for_keys(uuid, text[])
  to authenticated;
