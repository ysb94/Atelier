-- 같은 주문자의 수량·행은 후보가 남는 한 다른 M번호를 우선한다.
-- 기존 매핑·배정 행은 유지하고 컬럼·RPC만 더한다.

alter table public.invoice_gift_source_maps
  add column if not exists unique_per_recipient boolean not null default true;

comment on column public.invoice_gift_source_maps.unique_per_recipient is
  'true면 균등 랜덤에서 같은 주문자(받는분 묶음)의 여러 슬롯은 가능한 한 다른 style을 고른다.';

drop function if exists public.save_invoice_gift_source_map(
  uuid, text, text, text, text, text, uuid[], boolean, text, uuid
);

create function public.save_invoice_gift_source_map(
  p_brand_id uuid,
  p_mall_name text,
  p_normalized_mall_name text,
  p_product_name text,
  p_normalized_product_name text,
  p_assignment_mode text,
  p_style_ids uuid[],
  p_is_active boolean default true,
  p_note text default '',
  p_map_id uuid default null,
  p_unique_per_recipient boolean default true
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_map_id uuid;
  v_style_id uuid;
  v_index integer := 0;
begin
  if p_brand_id is null then
    raise exception 'brand_id가 필요합니다.';
  end if;
  if not app.can_edit_brand(p_brand_id) then
    raise exception '이 브랜드의 사은품 원본행 매핑을 저장할 권한이 없습니다.';
  end if;
  if btrim(coalesce(p_mall_name, '')) = ''
    or btrim(coalesce(p_normalized_mall_name, '')) = ''
  then
    raise exception '쇼핑몰명을 입력하세요.';
  end if;
  if btrim(coalesce(p_product_name, '')) = ''
    or btrim(coalesce(p_normalized_product_name, '')) = ''
  then
    raise exception '원본 품목명을 입력하세요.';
  end if;
  if p_assignment_mode not in ('fixed', 'balanced_random') then
    raise exception '배정 방식이 올바르지 않습니다.';
  end if;
  if p_style_ids is null or cardinality(p_style_ids) = 0 then
    raise exception '후보 M번호를 한 개 이상 고르세요.';
  end if;
  if p_assignment_mode = 'fixed' and cardinality(p_style_ids) <> 1 then
    raise exception '고정 배정은 M번호 1개만 고를 수 있습니다.';
  end if;

  if p_map_id is not null then
    update public.invoice_gift_source_maps
    set
      mall_name = btrim(p_mall_name),
      normalized_mall_name = btrim(p_normalized_mall_name),
      product_name = btrim(p_product_name),
      normalized_product_name = btrim(p_normalized_product_name),
      assignment_mode = p_assignment_mode,
      unique_per_recipient = coalesce(p_unique_per_recipient, true),
      is_active = coalesce(p_is_active, true),
      note = coalesce(p_note, '')
    where brand_id = p_brand_id
      and id = p_map_id
    returning id into v_map_id;
    if v_map_id is null then
      raise exception '사은품 원본행 매핑을 찾지 못했습니다.';
    end if;
  else
    insert into public.invoice_gift_source_maps (
      brand_id,
      mall_name,
      normalized_mall_name,
      product_name,
      normalized_product_name,
      assignment_mode,
      unique_per_recipient,
      is_active,
      note
    )
    values (
      p_brand_id,
      btrim(p_mall_name),
      btrim(p_normalized_mall_name),
      btrim(p_product_name),
      btrim(p_normalized_product_name),
      p_assignment_mode,
      coalesce(p_unique_per_recipient, true),
      coalesce(p_is_active, true),
      coalesce(p_note, '')
    )
    on conflict (brand_id, normalized_mall_name, normalized_product_name)
    do update set
      mall_name = excluded.mall_name,
      product_name = excluded.product_name,
      assignment_mode = excluded.assignment_mode,
      unique_per_recipient = excluded.unique_per_recipient,
      is_active = excluded.is_active,
      note = excluded.note
    returning id into v_map_id;
  end if;

  delete from public.invoice_gift_source_map_products
  where brand_id = p_brand_id
    and map_id = v_map_id
    and not (style_id = any (p_style_ids));

  foreach v_style_id in array p_style_ids loop
    insert into public.invoice_gift_source_map_products (
      brand_id,
      map_id,
      style_id,
      sort_order
    )
    values (
      p_brand_id,
      v_map_id,
      v_style_id,
      v_index
    )
    on conflict (map_id, style_id)
    do update set sort_order = excluded.sort_order;
    v_index := v_index + 1;
  end loop;

  return v_map_id;
end;
$$;

revoke all on function public.save_invoice_gift_source_map(
  uuid, text, text, text, text, text, uuid[], boolean, text, uuid, boolean
) from public, anon;
grant execute on function public.save_invoice_gift_source_map(
  uuid, text, text, text, text, text, uuid[], boolean, text, uuid, boolean
) to authenticated;

create or replace function public.assign_invoice_gift_source_rows(
  p_brand_id uuid,
  p_map_id uuid,
  p_requests jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_mode text;
  v_unique boolean;
  v_request jsonb;
  v_key text;
  v_fingerprint text;
  v_group text;
  v_slot integer;
  v_mall text;
  v_order_no text;
  v_ordered_at timestamp;
  v_file text;
  v_existing uuid;
  v_style_id uuid;
  v_pool uuid[];
  v_pick_pool uuid[];
  v_exclude uuid[];
  v_counts jsonb := '{}'::jsonb;
  v_used jsonb := '{}'::jsonb;
  v_style uuid;
  v_min integer;
  v_candidates uuid[] := array[]::uuid[];
  v_hash bigint;
  v_pick integer;
  v_result jsonb := '[]'::jsonb;
begin
  if p_brand_id is null or p_map_id is null then
    raise exception 'brand_id와 map_id가 필요합니다.';
  end if;
  if not app.can_edit_brand(p_brand_id) then
    raise exception '이 브랜드의 사은품 원본행을 배정할 권한이 없습니다.';
  end if;
  if p_requests is null or jsonb_typeof(p_requests) <> 'array' then
    raise exception '배정 요청 목록이 필요합니다.';
  end if;

  select m.assignment_mode, m.unique_per_recipient
  into v_mode, v_unique
  from public.invoice_gift_source_maps m
  where m.brand_id = p_brand_id
    and m.id = p_map_id
    and m.is_active
  for update;
  if v_mode is null then
    raise exception '활성 사은품 원본행 매핑을 찾지 못했습니다.';
  end if;

  select coalesce(array_agg(p.style_id order by p.sort_order, p.style_id), array[]::uuid[])
  into v_pool
  from public.invoice_gift_source_map_products p
  where p.brand_id = p_brand_id
    and p.map_id = p_map_id;
  if cardinality(v_pool) = 0 then
    raise exception '후보 M번호가 없습니다.';
  end if;
  if v_mode = 'fixed' and cardinality(v_pool) <> 1 then
    raise exception '고정 배정 매핑의 후보가 1개가 아닙니다.';
  end if;

  for v_style in
    select unnest(v_pool)
  loop
    select count(*)::integer
    into v_min
    from public.invoice_gift_source_allocations a
    where a.brand_id = p_brand_id
      and a.map_id = p_map_id
      and a.style_id = v_style;
    v_counts := jsonb_set(v_counts, array[v_style::text], to_jsonb(v_min));
  end loop;

  for v_request in
    select value
    from jsonb_array_elements(p_requests)
    order by value->>'allocation_key'
  loop
    v_key := btrim(coalesce(v_request->>'allocation_key', ''));
    v_fingerprint := btrim(coalesce(v_request->>'order_fingerprint', ''));
    v_group := nullif(btrim(coalesce(v_request->>'uniqueness_group', '')), '');
    if v_group is null then
      v_group := v_fingerprint;
    end if;
    v_slot := coalesce((v_request->>'quantity_slot')::integer, 1);
    v_mall := coalesce(v_request->>'mall_name', '');
    v_order_no := coalesce(v_request->>'customer_order_no', '');
    v_ordered_at := nullif(v_request->>'ordered_at', '')::timestamp;
    v_file := coalesce(v_request->>'source_file_name', '');
    if v_key = '' or v_fingerprint = '' then
      raise exception 'allocation_key와 order_fingerprint가 필요합니다.';
    end if;

    select a.style_id
    into v_existing
    from public.invoice_gift_source_allocations a
    where a.brand_id = p_brand_id
      and a.allocation_key = v_key;
    if v_existing is not null then
      v_used := jsonb_set(
        v_used,
        array[v_group],
        coalesce(v_used->v_group, '[]'::jsonb) || jsonb_build_array(v_existing::text)
      );
      v_result := v_result || jsonb_build_array(jsonb_build_object(
        'allocation_key', v_key,
        'style_id', v_existing,
        'reused', true
      ));
      continue;
    end if;

    if v_mode = 'fixed' then
      v_style_id := v_pool[1];
    else
      v_exclude := array[]::uuid[];
      if coalesce(v_unique, false) then
        select coalesce(array_agg(distinct x), array[]::uuid[])
        into v_exclude
        from (
          select a.style_id as x
          from public.invoice_gift_source_allocations a
          where a.brand_id = p_brand_id
            and a.map_id = p_map_id
            and a.order_fingerprint = v_fingerprint
          union
          select value::uuid
          from jsonb_array_elements_text(coalesce(v_used->v_group, '[]'::jsonb))
        ) excluded;
      end if;

      v_pick_pool := v_pool;
      if cardinality(v_exclude) > 0 then
        select coalesce(array_agg(p), array[]::uuid[])
        into v_pick_pool
        from unnest(v_pool) as p
        where not (p = any (v_exclude));
        if v_pick_pool is null or cardinality(v_pick_pool) = 0 then
          v_pick_pool := v_pool;
        end if;
      end if;

      v_min := null;
      v_candidates := array[]::uuid[];
      foreach v_style in array v_pick_pool loop
        if v_min is null or (v_counts->>v_style::text)::integer < v_min then
          v_min := (v_counts->>v_style::text)::integer;
          v_candidates := array[v_style];
        elsif (v_counts->>v_style::text)::integer = v_min then
          v_candidates := array_append(v_candidates, v_style);
        end if;
      end loop;
      select array_agg(c order by c)
      into v_candidates
      from unnest(v_candidates) as c;
      v_hash := app.fnv1a_32_utf8(v_key);
      v_pick := (v_hash % cardinality(v_candidates))::integer + 1;
      v_style_id := v_candidates[v_pick];
    end if;

    insert into public.invoice_gift_source_allocations (
      brand_id,
      map_id,
      style_id,
      allocation_key,
      order_fingerprint,
      quantity_slot,
      mall_name,
      customer_order_no,
      ordered_at,
      source_file_name
    )
    values (
      p_brand_id,
      p_map_id,
      v_style_id,
      v_key,
      v_fingerprint,
      v_slot,
      v_mall,
      v_order_no,
      v_ordered_at,
      v_file
    );

    v_used := jsonb_set(
      v_used,
      array[v_group],
      coalesce(v_used->v_group, '[]'::jsonb) || jsonb_build_array(v_style_id::text)
    );
    v_counts := jsonb_set(
      v_counts,
      array[v_style_id::text],
      to_jsonb((v_counts->>v_style_id::text)::integer + 1)
    );
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'allocation_key', v_key,
      'style_id', v_style_id,
      'reused', false
    ));
  end loop;

  return v_result;
end;
$$;

revoke all on function public.assign_invoice_gift_source_rows(uuid, uuid, jsonb)
  from public, anon;
grant execute on function public.assign_invoice_gift_source_rows(uuid, uuid, jsonb)
  to authenticated;
