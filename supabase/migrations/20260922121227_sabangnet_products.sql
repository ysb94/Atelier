-- 사방넷 판매 상품과 SKU 단위 M번호 연결.
-- 88바코드 구성품(수량형 출고 키트)과 섞지 않는다. 수량은 저장하지 않는다.

create table public.sabangnet_products (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  code text not null
    check (length(btrim(code)) > 0),
  name text not null
    check (length(btrim(name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sabangnet_products_brand_id_id_key unique (brand_id, id),
  constraint sabangnet_products_brand_code_key unique (brand_id, code)
);

comment on table public.sabangnet_products is
  '사방넷 판매 상품. 품번코드·상품명만 두고 출고 수량 구성은 저장하지 않는다.';
comment on column public.sabangnet_products.code is
  '사방넷 품번코드. 브랜드 안에서 고유하다.';

create index sabangnet_products_brand_updated_idx
  on public.sabangnet_products (brand_id, updated_at desc, id desc);

create or replace function public.sabangnet_products_prepare()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.brand_id is distinct from old.brand_id then
    raise exception '사방넷 상품 브랜드는 바꿀 수 없습니다.';
  end if;

  new.code := btrim(new.code);
  new.name := btrim(new.name);
  if new.code = '' then
    raise exception '사방넷 코드를 입력하세요.';
  end if;
  if new.name = '' then
    raise exception '사방넷 상품명을 입력하세요.';
  end if;
  return new;
end;
$$;

drop trigger if exists sabangnet_products_prepare
  on public.sabangnet_products;
create trigger sabangnet_products_prepare
before insert or update on public.sabangnet_products
for each row execute function public.sabangnet_products_prepare();

drop trigger if exists sabangnet_products_set_updated_at
  on public.sabangnet_products;
create trigger sabangnet_products_set_updated_at
before update on public.sabangnet_products
for each row execute function public.set_updated_at();

create table public.sabangnet_product_styles (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null,
  product_id uuid not null,
  style_id uuid not null,
  sort_order integer not null default 0
    check (sort_order >= 0),
  created_at timestamptz not null default now(),
  constraint sabangnet_product_styles_brand_id_id_key unique (brand_id, id),
  constraint sabangnet_product_styles_product_style_key unique (product_id, style_id),
  constraint sabangnet_product_styles_product_fkey
    foreign key (brand_id, product_id)
    references public.sabangnet_products (brand_id, id)
    on delete cascade,
  constraint sabangnet_product_styles_style_fkey
    foreign key (brand_id, style_id)
    references public.styles (brand_id, id)
    on delete restrict
);

comment on table public.sabangnet_product_styles is
  '사방넷 상품에 연결된 색상·사이즈 SKU(M번호). 수량은 두지 않는다.';
comment on column public.sabangnet_product_styles.sort_order is
  '엑셀·화면에 보이는 M번호 순서.';

create index sabangnet_product_styles_product_idx
  on public.sabangnet_product_styles (brand_id, product_id, sort_order, id);

create index sabangnet_product_styles_style_idx
  on public.sabangnet_product_styles (brand_id, style_id);

alter table public.sabangnet_products enable row level security;
alter table public.sabangnet_product_styles enable row level security;

create policy sabangnet_products_select_member
on public.sabangnet_products
for select
to authenticated
using (app.can_read_brand(brand_id));

create policy sabangnet_products_insert_editor
on public.sabangnet_products
for insert
to authenticated
with check (app.can_edit_brand(brand_id));

create policy sabangnet_products_update_editor
on public.sabangnet_products
for update
to authenticated
using (app.can_edit_brand(brand_id))
with check (app.can_edit_brand(brand_id));

create policy sabangnet_products_delete_editor
on public.sabangnet_products
for delete
to authenticated
using (app.can_edit_brand(brand_id));

create policy sabangnet_product_styles_select_member
on public.sabangnet_product_styles
for select
to authenticated
using (app.can_read_brand(brand_id));

create policy sabangnet_product_styles_insert_editor
on public.sabangnet_product_styles
for insert
to authenticated
with check (app.can_edit_brand(brand_id));

create policy sabangnet_product_styles_update_editor
on public.sabangnet_product_styles
for update
to authenticated
using (app.can_edit_brand(brand_id))
with check (app.can_edit_brand(brand_id));

create policy sabangnet_product_styles_delete_editor
on public.sabangnet_product_styles
for delete
to authenticated
using (app.can_edit_brand(brand_id));

grant select, insert, update, delete
on table public.sabangnet_products
to authenticated;

grant select, insert, update, delete
on table public.sabangnet_product_styles
to authenticated;

create or replace function public.save_sabangnet_product(
  p_brand_id uuid,
  p_id uuid,
  p_code text,
  p_name text,
  p_style_ids uuid[]
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_style_ids uuid[];
  v_found integer;
begin
  if not app.can_edit_brand(p_brand_id) then
    raise exception '이 브랜드의 사방넷 코드를 수정할 권한이 없습니다.';
  end if;

  v_style_ids := coalesce(p_style_ids, '{}');
  if cardinality(v_style_ids) <> (
    select count(distinct style_id) from unnest(v_style_ids) as style_id
  ) then
    raise exception '같은 상품에 M번호가 반복됩니다.';
  end if;

  select count(*)
    into v_found
    from public.styles
   where brand_id = p_brand_id
     and id = any (v_style_ids);

  if v_found <> cardinality(v_style_ids) then
    raise exception '등록된 상품에 없는 M번호가 있습니다.';
  end if;

  if p_id is null then
    insert into public.sabangnet_products (brand_id, code, name)
    values (p_brand_id, p_code, p_name)
    returning id into v_id;
  else
    update public.sabangnet_products
       set code = p_code,
           name = p_name
     where brand_id = p_brand_id
       and id = p_id
    returning id into v_id;

    if v_id is null then
      raise exception '사방넷 상품을 찾을 수 없습니다.';
    end if;

    delete from public.sabangnet_product_styles
     where brand_id = p_brand_id
       and product_id = v_id;
  end if;

  if cardinality(v_style_ids) > 0 then
    insert into public.sabangnet_product_styles (
      brand_id, product_id, style_id, sort_order
    )
    select
      p_brand_id,
      v_id,
      src.style_id,
      src.sort_order
    from unnest(v_style_ids) with ordinality as src(style_id, sort_order);
  end if;

  return v_id;
end;
$$;

comment on function public.save_sabangnet_product(uuid, uuid, text, text, uuid[]) is
  '사방넷 상품과 M번호 연결을 한 트랜잭션에서 저장하거나 교체한다. 빈 연결은 미연결 등록이다.';

revoke all on function public.save_sabangnet_product(uuid, uuid, text, text, uuid[])
  from public, anon;
grant execute on function public.save_sabangnet_product(uuid, uuid, text, text, uuid[])
  to authenticated;

create or replace function public.create_sabangnet_products_bulk(
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
  v_name text;
  v_style_json jsonb;
  v_style_ids uuid[];
  v_found integer;
  v_created integer := 0;
  v_skipped integer := 0;
  v_id uuid;
begin
  if not app.can_edit_brand(p_brand_id) then
    raise exception '이 브랜드의 사방넷 코드를 수정할 권한이 없습니다.';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception '일괄 등록 형식이 올바르지 않습니다.';
  end if;
  if jsonb_array_length(p_rows) > 200 then
    raise exception '한 번에 200행까지 등록할 수 있습니다.';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    if jsonb_typeof(v_row) <> 'object' then
      raise exception '일괄 등록 행 형식이 올바르지 않습니다.';
    end if;

    v_code := btrim(coalesce(v_row->>'code', ''));
    v_name := btrim(coalesce(v_row->>'name', ''));
    if v_code = '' then
      raise exception '사방넷 코드를 입력하세요.';
    end if;
    if v_name = '' then
      raise exception '사방넷 상품명을 입력하세요.';
    end if;

    if exists (
      select 1
        from public.sabangnet_products
       where brand_id = p_brand_id
         and code = v_code
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_style_json := coalesce(v_row->'style_ids', v_row->'styleIds', '[]'::jsonb);
    if jsonb_typeof(v_style_json) <> 'array' then
      raise exception 'M번호 연결 형식이 올바르지 않습니다.';
    end if;

    select coalesce(array_agg(style_id::uuid order by ordinality), '{}')
      into v_style_ids
      from jsonb_array_elements_text(v_style_json) with ordinality as src(style_id, ordinality);

    if cardinality(v_style_ids) <> (
      select count(distinct style_id) from unnest(v_style_ids) as style_id
    ) then
      raise exception '같은 상품에 M번호가 반복됩니다.';
    end if;

    select count(*)
      into v_found
      from public.styles
     where brand_id = p_brand_id
       and id = any (v_style_ids);

    if v_found <> cardinality(v_style_ids) then
      raise exception '등록된 상품에 없는 M번호가 있습니다.';
    end if;

    insert into public.sabangnet_products (brand_id, code, name)
    values (p_brand_id, v_code, v_name)
    returning id into v_id;

    if cardinality(v_style_ids) > 0 then
      insert into public.sabangnet_product_styles (
        brand_id, product_id, style_id, sort_order
      )
      select
        p_brand_id,
        v_id,
        src.style_id,
        src.sort_order
      from unnest(v_style_ids) with ordinality as src(style_id, sort_order);
    end if;

    v_created := v_created + 1;
  end loop;

  return jsonb_build_object('created', v_created, 'skipped', v_skipped);
end;
$$;

comment on function public.create_sabangnet_products_bulk(uuid, jsonb) is
  '사방넷 상품을 최대 200행 신규 등록한다. 이미 있는 코드는 건너뛰고 덮어쓰지 않는다.';

revoke all on function public.create_sabangnet_products_bulk(uuid, jsonb)
  from public, anon;
grant execute on function public.create_sabangnet_products_bulk(uuid, jsonb)
  to authenticated;
