-- M번호(SKU)와 브랜드 내부 카테고리 연결.
-- 최하위 카테고리에만 연결하고, 상위 분류의 상품은 하위 연결을 모아 계산한다.
-- M번호마다 대표 분류 1개(집계 기준)와 자사몰처럼 여러 칸에 진열하는 추가 분류를 둔다.
-- 기존 styles.category 글자 칸은 이번 단계에서 바꾸지 않는다.

create table public.style_categories (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null,
  style_id uuid not null,
  category_id uuid not null,
  is_primary boolean not null default false,
  sort_order integer not null default 0
    check (sort_order >= 0),
  created_at timestamptz not null default now(),
  constraint style_categories_brand_id_id_key unique (brand_id, id),
  constraint style_categories_style_category_key unique (style_id, category_id),
  constraint style_categories_style_fkey
    foreign key (brand_id, style_id)
    references public.styles (brand_id, id)
    on delete cascade,
  constraint style_categories_category_fkey
    foreign key (brand_id, category_id)
    references public.product_categories (brand_id, id)
    on delete restrict
);

comment on table public.style_categories is
  'M번호(SKU)의 내부 카테고리. 최하위 카테고리에만 연결하고 M번호마다 대표는 1개다.';
comment on column public.style_categories.is_primary is
  '카테고리별 집계에 쓰는 대표 분류. 나머지 행은 추가 진열 분류다.';
comment on column public.style_categories.sort_order is
  '0이 대표, 이후는 추가 분류의 표시 순서.';

create unique index style_categories_primary_key
  on public.style_categories (style_id)
  where is_primary;

create index style_categories_brand_style_idx
  on public.style_categories (brand_id, style_id, sort_order);

create index style_categories_brand_category_idx
  on public.style_categories (brand_id, category_id);

create or replace function public.style_categories_prepare()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (
    select 1
      from public.product_categories child
     where child.brand_id = new.brand_id
       and child.parent_id = new.category_id
  ) then
    raise exception '하위 카테고리가 있는 분류에는 상품을 연결할 수 없습니다. 최하위 카테고리를 고르세요.';
  end if;
  return new;
end;
$$;

drop trigger if exists style_categories_prepare
  on public.style_categories;
create trigger style_categories_prepare
before insert or update on public.style_categories
for each row execute function public.style_categories_prepare();

-- 상품이 연결된 최하위 카테고리 아래에 하위를 만들면 그 상품이 중간 분류에 남는다.
create or replace function public.product_categories_guard_linked_parent()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.parent_id is not null and exists (
    select 1
      from public.style_categories link
     where link.brand_id = new.brand_id
       and link.category_id = new.parent_id
  ) then
    raise exception '상품이 연결된 카테고리 아래에는 하위 카테고리를 만들 수 없습니다. 연결된 상품을 다른 카테고리로 옮긴 뒤 추가하세요.';
  end if;
  return new;
end;
$$;

drop trigger if exists product_categories_guard_linked_parent
  on public.product_categories;
create trigger product_categories_guard_linked_parent
before insert on public.product_categories
for each row execute function public.product_categories_guard_linked_parent();

alter table public.style_categories enable row level security;

create policy style_categories_select_member
on public.style_categories
for select
to authenticated
using (app.can_read_brand(brand_id));

create policy style_categories_insert_editor
on public.style_categories
for insert
to authenticated
with check (app.can_edit_brand(brand_id));

create policy style_categories_update_editor
on public.style_categories
for update
to authenticated
using (app.can_edit_brand(brand_id))
with check (app.can_edit_brand(brand_id));

create policy style_categories_delete_editor
on public.style_categories
for delete
to authenticated
using (app.can_edit_brand(brand_id));

grant select, insert, update, delete
on table public.style_categories
to authenticated;

-- 여러 M번호의 카테고리를 같은 목록으로 교체한다. 첫 번째가 대표이고 빈 목록은 연결 해제다.
create or replace function public.set_style_categories(
  p_brand_id uuid,
  p_style_ids uuid[],
  p_category_ids uuid[]
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_style_ids uuid[];
  v_category_ids uuid[] := coalesce(p_category_ids, '{}'::uuid[]);
  v_found integer;
begin
  if not app.can_edit_brand(p_brand_id) then
    raise exception '이 브랜드의 상품 카테고리를 수정할 권한이 없습니다.';
  end if;

  select coalesce(array_agg(distinct style_id), '{}'::uuid[])
    into v_style_ids
    from unnest(coalesce(p_style_ids, '{}'::uuid[])) as style_id
   where style_id is not null;

  if cardinality(v_style_ids) = 0 then
    return 0;
  end if;

  if array_position(v_category_ids, null) is not null then
    raise exception '비어 있는 카테고리가 있습니다.';
  end if;
  if cardinality(v_category_ids) <> (
    select count(distinct category_id)
      from unnest(v_category_ids) as category_id
  ) then
    raise exception '같은 카테고리가 두 번 들어 있습니다.';
  end if;

  select count(*)
    into v_found
    from public.styles
   where brand_id = p_brand_id
     and id = any (v_style_ids);
  if v_found <> cardinality(v_style_ids) then
    raise exception '이 브랜드에 없는 M번호가 있습니다.';
  end if;

  select count(*)
    into v_found
    from public.product_categories category
   where category.brand_id = p_brand_id
     and category.id = any (v_category_ids)
     and category.is_active
     and not exists (
       select 1
         from public.product_categories child
        where child.brand_id = p_brand_id
          and child.parent_id = category.id
     );
  if v_found <> cardinality(v_category_ids) then
    raise exception '사용 중인 최하위 카테고리만 연결할 수 있습니다.';
  end if;

  delete from public.style_categories
   where brand_id = p_brand_id
     and style_id = any (v_style_ids);

  insert into public.style_categories (
    brand_id,
    style_id,
    category_id,
    is_primary,
    sort_order
  )
  select
    p_brand_id,
    target.style_id,
    picked.category_id,
    picked.position = 1,
    (picked.position - 1)::integer
  from unnest(v_style_ids) as target(style_id)
  cross join unnest(v_category_ids) with ordinality as picked(category_id, position);

  return cardinality(v_style_ids);
end;
$$;

comment on function public.set_style_categories(uuid, uuid[], uuid[]) is
  'M번호들의 카테고리를 같은 최하위 카테고리 목록으로 교체한다. 첫 번째가 대표다.';

revoke all on function public.set_style_categories(uuid, uuid[], uuid[])
  from public, anon;
grant execute on function public.set_style_categories(uuid, uuid[], uuid[])
  to authenticated;

-- 사방넷 코드별 카테고리를 그 코드에 연결된 M번호 전체에 적용한다.
-- 파일에 있는 코드만 바꾸고, 없는 코드와 M번호가 연결되지 않은 코드는 건너뛴 수만 돌려준다.
create or replace function public.apply_sabangnet_style_categories(
  p_brand_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row jsonb;
  v_code text;
  v_product_id uuid;
  v_style_ids uuid[];
  v_category_ids uuid[];
  v_applied integer := 0;
  v_styles integer := 0;
  v_no_styles integer := 0;
  v_missing integer := 0;
begin
  if not app.can_edit_brand(p_brand_id) then
    raise exception '이 브랜드의 상품 카테고리를 수정할 권한이 없습니다.';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception '카테고리 적용 형식이 올바르지 않습니다.';
  end if;
  if jsonb_array_length(p_rows) > 200 then
    raise exception '한 번에 200행까지 적용할 수 있습니다.';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    if jsonb_typeof(v_row) <> 'object'
       or jsonb_typeof(coalesce(v_row -> 'category_ids', 'null'::jsonb)) <> 'array' then
      raise exception '카테고리 적용 행 형식이 올바르지 않습니다.';
    end if;

    v_code := btrim(coalesce(v_row ->> 'code', ''));
    if v_code = '' then
      raise exception '사방넷 코드가 비어 있는 행이 있습니다.';
    end if;

    select coalesce(array_agg(item.value::uuid order by item.position), '{}'::uuid[])
      into v_category_ids
      from jsonb_array_elements_text(v_row -> 'category_ids')
        with ordinality as item(value, position);
    if cardinality(v_category_ids) = 0 then
      raise exception '사방넷 코드 %의 카테고리가 비어 있습니다.', v_code;
    end if;

    select id
      into v_product_id
      from public.sabangnet_products
     where brand_id = p_brand_id
       and code = v_code;
    if v_product_id is null then
      v_missing := v_missing + 1;
      continue;
    end if;

    select coalesce(array_agg(style_id order by sort_order, id), '{}'::uuid[])
      into v_style_ids
      from public.sabangnet_product_styles
     where brand_id = p_brand_id
       and product_id = v_product_id;
    if cardinality(v_style_ids) = 0 then
      v_no_styles := v_no_styles + 1;
      continue;
    end if;

    perform public.set_style_categories(p_brand_id, v_style_ids, v_category_ids);
    v_applied := v_applied + 1;
    v_styles := v_styles + cardinality(v_style_ids);
  end loop;

  return jsonb_build_object(
    'applied', v_applied,
    'styles', v_styles,
    'no_styles', v_no_styles,
    'missing', v_missing
  );
end;
$$;

comment on function public.apply_sabangnet_style_categories(uuid, jsonb) is
  '사방넷 코드별 최하위 카테고리 목록을 연결된 M번호 전체에 적용한다. 한 번에 200행까지.';

revoke all on function public.apply_sabangnet_style_categories(uuid, jsonb)
  from public, anon;
grant execute on function public.apply_sabangnet_style_categories(uuid, jsonb)
  to authenticated;
