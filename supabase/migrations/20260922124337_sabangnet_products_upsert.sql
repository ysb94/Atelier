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
  v_updated integer := 0;
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

    select id
      into v_id
      from public.sabangnet_products
     where brand_id = p_brand_id
       and code = v_code;

    if v_id is null then
      insert into public.sabangnet_products (brand_id, code, name)
      values (p_brand_id, v_code, v_name)
      returning id into v_id;
      v_created := v_created + 1;
    else
      update public.sabangnet_products
         set name = v_name
       where brand_id = p_brand_id
         and id = v_id;
      delete from public.sabangnet_product_styles
       where brand_id = p_brand_id
         and product_id = v_id;
      v_updated := v_updated + 1;
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
  end loop;

  return jsonb_build_object(
    'created', v_created,
    'updated', v_updated,
    'skipped', 0
  );
end;
$$;

comment on function public.create_sabangnet_products_bulk(uuid, jsonb) is
  '사방넷 상품을 최대 200행 신규 등록하거나 상품명·M번호 연결을 교체한다.';
