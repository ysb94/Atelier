-- 오늘 작업은 업로드 파일의 고유 조합·내품명만 조회한다.
-- 권한은 기존 품목명 파일 조회와 같이 app.can_read_brand를 한 번만 확인한다.

create or replace function app.list_invoice_option_map_ids_for_combos_core(
  p_brand_id uuid,
  p_malls text[],
  p_products text[],
  p_items text[]
)
returns table (id uuid)
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
  if cardinality(coalesce(p_malls, array[]::text[]))
    is distinct from cardinality(coalesce(p_products, array[]::text[]))
    or cardinality(coalesce(p_malls, array[]::text[]))
    is distinct from cardinality(coalesce(p_items, array[]::text[]))
  then
    raise exception 'combo arrays must match';
  end if;

  return query
  with queries as (
    select distinct
      app.normalize_invoice_lookup_key(coalesce(q.mall, '')) as mall,
      app.normalize_invoice_lookup_key(coalesce(q.product, '')) as product,
      app.normalize_invoice_lookup_key(coalesce(q.item, '')) as item
    from unnest(
      coalesce(p_malls, array[]::text[]),
      coalesce(p_products, array[]::text[]),
      coalesce(p_items, array[]::text[])
    ) as q(mall, product, item)
  )
  select distinct m.id
  from public.invoice_option_maps m
  join queries q
    on q.product = m.normalized_product_name
   and q.item = m.normalized_item_name
  where m.brand_id = p_brand_id
    and m.is_active
    and (
      m.normalized_mall_name = ''
      or m.normalized_mall_name = q.mall
    );
end;
$function$;

revoke all on function app.list_invoice_option_map_ids_for_combos_core(uuid, text[], text[], text[])
  from public;
grant execute on function app.list_invoice_option_map_ids_for_combos_core(uuid, text[], text[], text[])
  to authenticated;

create or replace function public.list_invoice_option_map_ids_for_combos(
  p_brand_id uuid,
  p_malls text[],
  p_products text[],
  p_items text[]
)
returns table (id uuid)
language sql
stable
security invoker
set search_path = public, app
as $$
  select *
  from app.list_invoice_option_map_ids_for_combos_core(
    p_brand_id,
    p_malls,
    p_products,
    p_items
  );
$$;

comment on function public.list_invoice_option_map_ids_for_combos(uuid, text[], text[], text[]) is
  '업로드 파일의 쇼핑몰·품목명·내품명 조합과 맞는 활성 옵션맵 id만 반환한다.';

revoke all on function public.list_invoice_option_map_ids_for_combos(uuid, text[], text[], text[])
  from public;
grant execute on function public.list_invoice_option_map_ids_for_combos(uuid, text[], text[], text[])
  to authenticated;

create or replace function app.list_invoice_item_name_rule_ids_for_names_core(
  p_brand_id uuid,
  p_item_names text[]
)
returns table (id uuid)
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
    select distinct app.normalize_invoice_lookup_key(t) as q
    from unnest(coalesce(p_item_names, array[]::text[])) as t
    where app.normalize_invoice_lookup_key(t) <> ''
  )
  select distinct r.id
  from public.invoice_item_name_rules r
  join queries q
    on q.q = r.normalized_item_name
  where r.brand_id = p_brand_id
    and r.is_active;
end;
$function$;

revoke all on function app.list_invoice_item_name_rule_ids_for_names_core(uuid, text[])
  from public;
grant execute on function app.list_invoice_item_name_rule_ids_for_names_core(uuid, text[])
  to authenticated;

create or replace function public.list_invoice_item_name_rule_ids_for_names(
  p_brand_id uuid,
  p_item_names text[]
)
returns table (id uuid)
language sql
stable
security invoker
set search_path = public, app
as $$
  select *
  from app.list_invoice_item_name_rule_ids_for_names_core(p_brand_id, p_item_names);
$$;

comment on function public.list_invoice_item_name_rule_ids_for_names(uuid, text[]) is
  '업로드 파일의 내품명과 정규화 키가 맞는 활성 내품명 규칙 id만 반환한다.';

revoke all on function public.list_invoice_item_name_rule_ids_for_names(uuid, text[])
  from public;
grant execute on function public.list_invoice_item_name_rule_ids_for_names(uuid, text[])
  to authenticated;
