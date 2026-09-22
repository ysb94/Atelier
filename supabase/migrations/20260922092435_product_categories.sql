-- 브랜드별 계층형 상품 카테고리.
-- 카페24 번호와 ALL 메뉴는 저장하지 않고, 상품이 연결될 내부 분류 트리만 관리한다.

create table public.product_categories (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  parent_id uuid,
  name text not null
    check (length(btrim(name)) > 0),
  normalized_name text not null,
  depth smallint not null default 1
    check (depth >= 1),
  sort_order integer not null default 0
    check (sort_order >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_categories_brand_id_id_key unique (brand_id, id),
  constraint product_categories_parent_fkey
    foreign key (brand_id, parent_id)
    references public.product_categories (brand_id, id)
    on delete restrict,
  constraint product_categories_not_self_parent
    check (parent_id is null or parent_id <> id)
);

comment on table public.product_categories is
  '브랜드별 내부 상품 카테고리 트리. 상품은 이후 최하위 카테고리에만 연결한다.';
comment on column public.product_categories.parent_id is
  '상위 내부 카테고리. null이면 최상위다.';
comment on column public.product_categories.depth is
  '트리 깊이. 최상위가 1이며 트리 준비 트리거가 계산한다.';
comment on column public.product_categories.is_active is
  'false면 신규 분류에서 숨긴다. 이번 단계에서는 상품 연결을 만들지 않는다.';

create unique index product_categories_root_name_key
  on public.product_categories (brand_id, normalized_name)
  where parent_id is null;

create unique index product_categories_child_name_key
  on public.product_categories (brand_id, parent_id, normalized_name)
  where parent_id is not null;

create index product_categories_parent_sort_idx
  on public.product_categories (brand_id, parent_id, sort_order, name);

create index product_categories_active_tree_idx
  on public.product_categories (brand_id, parent_id, sort_order)
  where is_active;

create or replace function public.product_categories_prepare()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_parent_depth smallint;
begin
  if tg_op = 'UPDATE' and new.brand_id is distinct from old.brand_id then
    raise exception '카테고리 브랜드는 바꿀 수 없습니다.';
  end if;

  if tg_op = 'UPDATE' and new.parent_id is distinct from old.parent_id then
    raise exception '상위 카테고리 이동은 지원하지 않습니다. 새 위치에 다시 만들어주세요.';
  end if;

  new.name := btrim(new.name);
  if new.name = '' then
    raise exception '카테고리 이름을 입력하세요.';
  end if;
  new.normalized_name := app.normalize_select_label(new.name);

  if new.parent_id is null then
    new.depth := 1;
    return new;
  end if;

  select depth
    into v_parent_depth
    from public.product_categories
   where brand_id = new.brand_id
     and id = new.parent_id;

  if v_parent_depth is null then
    raise exception '상위 카테고리를 찾을 수 없습니다.';
  end if;

  new.depth := v_parent_depth + 1;
  return new;
end;
$$;

drop trigger if exists product_categories_prepare
  on public.product_categories;
create trigger product_categories_prepare
before insert or update on public.product_categories
for each row execute function public.product_categories_prepare();

drop trigger if exists product_categories_set_updated_at
  on public.product_categories;
create trigger product_categories_set_updated_at
before update on public.product_categories
for each row execute function public.set_updated_at();

alter table public.product_categories enable row level security;

create policy product_categories_select_member
on public.product_categories
for select
to authenticated
using (app.can_read_brand(brand_id));

create policy product_categories_insert_editor
on public.product_categories
for insert
to authenticated
with check (app.can_edit_brand(brand_id));

create policy product_categories_update_editor
on public.product_categories
for update
to authenticated
using (app.can_edit_brand(brand_id))
with check (app.can_edit_brand(brand_id));

create policy product_categories_delete_editor
on public.product_categories
for delete
to authenticated
using (app.can_edit_brand(brand_id));

grant select, insert, update, delete
on table public.product_categories
to authenticated;

create or replace function public.move_product_category(
  p_brand_id uuid,
  p_category_id uuid,
  p_direction smallint
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_target public.product_categories%rowtype;
  v_sibling public.product_categories%rowtype;
begin
  if p_direction not in (-1, 1) then
    raise exception '이동 방향이 올바르지 않습니다.';
  end if;
  if not app.can_edit_brand(p_brand_id) then
    raise exception '이 브랜드의 카테고리를 수정할 권한이 없습니다.';
  end if;

  select *
    into v_target
    from public.product_categories
   where brand_id = p_brand_id
     and id = p_category_id
   for update;

  if not found then
    raise exception '카테고리를 찾을 수 없습니다.';
  end if;

  if p_direction = -1 then
    select *
      into v_sibling
      from public.product_categories
     where brand_id = p_brand_id
       and parent_id is not distinct from v_target.parent_id
       and (sort_order, id) < (v_target.sort_order, v_target.id)
     order by sort_order desc, id desc
     limit 1
     for update;
  else
    select *
      into v_sibling
      from public.product_categories
     where brand_id = p_brand_id
       and parent_id is not distinct from v_target.parent_id
       and (sort_order, id) > (v_target.sort_order, v_target.id)
     order by sort_order, id
     limit 1
     for update;
  end if;

  if not found then
    return;
  end if;

  update public.product_categories
     set sort_order = v_sibling.sort_order
   where brand_id = p_brand_id
     and id = v_target.id;

  update public.product_categories
     set sort_order = v_target.sort_order
   where brand_id = p_brand_id
     and id = v_sibling.id;
end;
$$;

comment on function public.move_product_category(uuid, uuid, smallint) is
  '같은 상위 분류 안에서 카테고리 순서를 한 칸 원자 이동한다.';

revoke all on function public.move_product_category(uuid, uuid, smallint)
  from public, anon;
grant execute on function public.move_product_category(uuid, uuid, smallint)
  to authenticated;

-- 현재 Masmarulez 내부 분류를 카페24 번호와 ALL 노드 없이 시작한다.
do $$
declare
  v_brand_id uuid;
begin
  select id
    into v_brand_id
    from public.brands
   where slug = 'masmarulez';

  if v_brand_id is null then
    raise notice 'masmarulez 브랜드가 없어 상품 카테고리 초기값을 건너뜁니다.';
    return;
  end if;

  insert into public.product_categories (
    brand_id,
    parent_id,
    name,
    normalized_name,
    sort_order
  )
  select
    v_brand_id,
    null,
    seed.name,
    app.normalize_select_label(seed.name),
    seed.sort_order
  from (
    values
      ('BAG'::text, 0),
      ('POUCH'::text, 1),
      ('APPAREL'::text, 2),
      ('ACCESSORIES'::text, 3)
  ) as seed(name, sort_order)
  on conflict do nothing;

  insert into public.product_categories (
    brand_id,
    parent_id,
    name,
    normalized_name,
    sort_order
  )
  select
    v_brand_id,
    root.id,
    seed.name,
    app.normalize_select_label(seed.name),
    seed.sort_order
  from (
    values
      ('BAG'::text, 'BACKPACK'::text, 0),
      ('BAG'::text, 'SHOULDER'::text, 1),
      ('BAG'::text, 'CROSS'::text, 2),
      ('BAG'::text, 'TOTE'::text, 3),
      ('POUCH'::text, 'PET'::text, 0),
      ('POUCH'::text, 'STRAP'::text, 1),
      ('POUCH'::text, 'BASIC'::text, 2),
      ('POUCH'::text, 'MINI STRAP'::text, 3),
      ('POUCH'::text, 'HAPOOM'::text, 4),
      ('POUCH'::text, 'STAND'::text, 5),
      ('POUCH'::text, 'STRING'::text, 6),
      ('POUCH'::text, 'ETC'::text, 7),
      ('APPAREL'::text, 'TOP'::text, 0),
      ('APPAREL'::text, 'BOTTOM'::text, 1),
      ('APPAREL'::text, 'OUTER'::text, 2),
      ('APPAREL'::text, 'HOMEWEAR'::text, 3),
      ('ACCESSORIES'::text, 'CAP'::text, 0),
      ('ACCESSORIES'::text, 'KEYRING'::text, 1),
      ('ACCESSORIES'::text, 'BAG STRAP'::text, 2),
      ('ACCESSORIES'::text, 'DIGITAL'::text, 3),
      ('ACCESSORIES'::text, 'SEASON'::text, 4),
      ('ACCESSORIES'::text, 'ETC'::text, 5)
  ) as seed(root_name, name, sort_order)
  join public.product_categories root
    on root.brand_id = v_brand_id
   and root.parent_id is null
   and root.normalized_name = app.normalize_select_label(seed.root_name)
  on conflict do nothing;

  insert into public.product_categories (
    brand_id,
    parent_id,
    name,
    normalized_name,
    sort_order
  )
  select
    v_brand_id,
    parent.id,
    seed.name,
    app.normalize_select_label(seed.name),
    seed.sort_order
  from (
    values
      ('BAG'::text, 'BACKPACK'::text, 'Daily'::text, 0),
      ('BAG'::text, 'BACKPACK'::text, 'Flap'::text, 1),
      ('BAG'::text, 'BACKPACK'::text, 'Gym sack'::text, 2),
      ('BAG'::text, 'BACKPACK'::text, 'Mini'::text, 3),
      ('BAG'::text, 'BACKPACK'::text, 'Layered'::text, 4),
      ('BAG'::text, 'BACKPACK'::text, 'Etc'::text, 5),
      ('BAG'::text, 'SHOULDER'::text, 'Eco'::text, 0),
      ('BAG'::text, 'SHOULDER'::text, 'Leather'::text, 1),
      ('BAG'::text, 'SHOULDER'::text, 'Hobo'::text, 2),
      ('BAG'::text, 'SHOULDER'::text, 'Duffel'::text, 3),
      ('BAG'::text, 'SHOULDER'::text, 'Etc'::text, 4),
      ('BAG'::text, 'CROSS'::text, 'Halfmoon'::text, 0),
      ('BAG'::text, 'CROSS'::text, 'Strap'::text, 1),
      ('BAG'::text, 'CROSS'::text, 'String'::text, 2),
      ('BAG'::text, 'CROSS'::text, 'Plumpy'::text, 3),
      ('BAG'::text, 'CROSS'::text, 'Leather'::text, 4),
      ('BAG'::text, 'CROSS'::text, 'Brief'::text, 5),
      ('BAG'::text, 'CROSS'::text, 'Etc'::text, 6),
      ('BAG'::text, 'TOTE'::text, 'Glossy'::text, 0),
      ('BAG'::text, 'TOTE'::text, 'Fur'::text, 1),
      ('BAG'::text, 'TOTE'::text, 'String'::text, 2),
      ('BAG'::text, 'TOTE'::text, 'Etc'::text, 3),
      ('APPAREL'::text, 'TOP'::text, 'T-shirt'::text, 0),
      ('APPAREL'::text, 'TOP'::text, 'Long Sleeve'::text, 1),
      ('APPAREL'::text, 'TOP'::text, 'Sweatshirt'::text, 2),
      ('APPAREL'::text, 'TOP'::text, 'Hoodie'::text, 3),
      ('APPAREL'::text, 'TOP'::text, 'Sleeveless'::text, 4),
      ('APPAREL'::text, 'BOTTOM'::text, 'Pants'::text, 0),
      ('APPAREL'::text, 'BOTTOM'::text, 'Skirt'::text, 1),
      ('APPAREL'::text, 'BOTTOM'::text, 'Shorts'::text, 2),
      ('APPAREL'::text, 'OUTER'::text, 'Set-Up'::text, 0),
      ('APPAREL'::text, 'OUTER'::text, 'Windbreaker'::text, 1),
      ('APPAREL'::text, 'HOMEWEAR'::text, 'Top'::text, 0),
      ('APPAREL'::text, 'HOMEWEAR'::text, 'Bottom'::text, 1),
      ('APPAREL'::text, 'HOMEWEAR'::text, 'Dress'::text, 2),
      ('APPAREL'::text, 'HOMEWEAR'::text, 'Set'::text, 3)
  ) as seed(root_name, parent_name, name, sort_order)
  join public.product_categories root
    on root.brand_id = v_brand_id
   and root.parent_id is null
   and root.normalized_name = app.normalize_select_label(seed.root_name)
  join public.product_categories parent
    on parent.brand_id = v_brand_id
   and parent.parent_id = root.id
   and parent.normalized_name = app.normalize_select_label(seed.parent_name)
  on conflict do nothing;
end;
$$;
