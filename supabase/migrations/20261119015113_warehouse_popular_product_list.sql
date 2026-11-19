alter table public.warehouse_popular_locations add column product_entries text[] not null default '{}';
grant insert (product_entries), update (product_entries) on public.warehouse_popular_locations to authenticated;

create function app.prepare_warehouse_popular_products() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.product_entries is null then
    raise exception '인기상품 목록을 확인해 주세요.' using errcode = '22023';
  end if;
  select coalesce(array_agg(clean.entry order by clean.first_pos), '{}'::text[])
  into new.product_entries
  from (
    select entry, min(pos) as first_pos
    from unnest(new.product_entries) with ordinality as item(value, pos)
    cross join lateral (select regexp_replace(item.value, '^[[:space:]]+|[[:space:]]+$', '', 'g') as entry) trimmed
    where entry <> ''
    group by entry
  ) clean;
  return new;
end $$;

revoke all on function app.prepare_warehouse_popular_products() from public, anon, authenticated;
create trigger prepare_warehouse_popular_products
before insert or update of product_entries on public.warehouse_popular_locations
for each row execute function app.prepare_warehouse_popular_products();
