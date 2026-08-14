-- 등록 시 관련 조회 키 캐시만 지운다. 브랜드 전체 삭제는 1인자 함수에 남긴다.

create or replace function app.invalidate_ai_recommendation_cache(
  p_brand_id uuid,
  p_normalized_lookup_keys text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_keys text[];
begin
  if not app.can_edit_brand(p_brand_id) then
    raise exception 'not allowed';
  end if;

  select coalesce(array_agg(distinct k), array[]::text[])
  into v_keys
  from (
    select app.normalize_invoice_lookup_key(t) as k
    from unnest(coalesce(p_normalized_lookup_keys, array[]::text[])) as t
  ) n
  where n.k <> '';

  if coalesce(array_length(v_keys, 1), 0) = 0 then
    return;
  end if;

  delete from public.ai_recommendation_cache c
  where c.brand_id = p_brand_id
    and c.feature_key = 'invoice_product_recommendation'
    and exists (
      select 1
      from jsonb_array_elements_text(coalesce(c.lookup_keys, '[]'::jsonb)) as t(cached_key)
      where app.normalize_invoice_lookup_key(t.cached_key) = any (v_keys)
    );
end;
$$;

revoke all on function app.invalidate_ai_recommendation_cache(uuid, text[])
  from public;
grant execute on function app.invalidate_ai_recommendation_cache(uuid, text[])
  to authenticated;

create or replace function public.record_ai_recommendation_feedback(
  p_brand_id uuid,
  p_lookup_key text,
  p_style_id uuid,
  p_source text,
  p_cache_id uuid default null,
  p_shown_rank integer default null,
  p_provider text default null,
  p_model_id text default null
)
returns void
language plpgsql
security invoker
set search_path = public, app
as $$
begin
  if not app.can_edit_brand(p_brand_id) then
    raise exception '이 브랜드의 품목명 기준을 저장할 권한이 없습니다.';
  end if;
  if p_lookup_key is null or btrim(p_lookup_key) = '' or p_style_id is null then
    return;
  end if;
  if p_source not in ('manual', 'local', 'ai') then
    raise exception '지원하지 않는 피드백 출처입니다.';
  end if;

  insert into public.ai_recommendation_feedback (
    brand_id,
    user_id,
    cache_id,
    lookup_key,
    normalized_lookup_key,
    style_id,
    shown_rank,
    source,
    provider,
    model_id
  ) values (
    p_brand_id,
    auth.uid(),
    p_cache_id,
    btrim(p_lookup_key),
    app.normalize_invoice_lookup_key(p_lookup_key),
    p_style_id,
    p_shown_rank,
    p_source,
    p_provider,
    p_model_id
  );

  perform app.invalidate_ai_recommendation_cache(
    p_brand_id,
    array[app.normalize_invoice_lookup_key(p_lookup_key)]
  );
end;
$$;

create or replace function public.save_invoice_product_name_map_with_feedback(
  p_brand_id uuid,
  p_row jsonb,
  p_map_id uuid default null,
  p_feedback jsonb default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, app
as $$
declare
  v_id uuid;
  v_lookup text := coalesce(btrim(p_row->>'lookup_key'), '');
  v_norm_lookup text := coalesce(btrim(p_row->>'normalized_lookup_key'), '');
  v_old_norm text := '';
  v_source text;
  v_keys text[];
begin
  if not app.can_edit_brand(p_brand_id) then
    raise exception '이 브랜드의 품목명 기준을 저장할 권한이 없습니다.';
  end if;
  if coalesce(btrim(p_row->>'product_name'), '') = '' or (p_row->>'style_id') is null then
    raise exception '원본 품목명과 본품을 입력하세요.';
  end if;

  if p_map_id is not null then
    v_id := p_map_id;
  elsif v_norm_lookup <> '' then
    select m.id into v_id
    from public.invoice_product_name_maps m
    where m.brand_id = p_brand_id
      and m.normalized_lookup_key = v_norm_lookup
    limit 1;
  else
    select m.id into v_id
    from public.invoice_product_name_maps m
    where m.brand_id = p_brand_id
      and m.normalized_mall_name = coalesce(p_row->>'normalized_mall_name', '')
      and m.normalized_product_name = coalesce(p_row->>'normalized_product_name', '')
      and m.normalized_item_name_context = coalesce(p_row->>'normalized_item_name_context', '')
      and m.normalized_lookup_key = ''
    limit 1;
  end if;

  if v_id is not null then
    select coalesce(m.normalized_lookup_key, '')
    into v_old_norm
    from public.invoice_product_name_maps m
    where m.id = v_id
      and m.brand_id = p_brand_id;
  end if;

  if v_id is null then
    insert into public.invoice_product_name_maps (
      brand_id,
      mall_name,
      normalized_mall_name,
      product_name,
      normalized_product_name,
      item_name_context,
      normalized_item_name_context,
      own_product_code,
      normalized_own_product_code,
      lookup_key,
      normalized_lookup_key,
      style_id,
      is_active,
      note
    ) values (
      p_brand_id,
      coalesce(p_row->>'mall_name', ''),
      coalesce(p_row->>'normalized_mall_name', ''),
      btrim(p_row->>'product_name'),
      coalesce(p_row->>'normalized_product_name', ''),
      coalesce(p_row->>'item_name_context', ''),
      coalesce(p_row->>'normalized_item_name_context', ''),
      coalesce(p_row->>'own_product_code', ''),
      coalesce(p_row->>'normalized_own_product_code', ''),
      v_lookup,
      v_norm_lookup,
      (p_row->>'style_id')::uuid,
      coalesce((p_row->>'is_active')::boolean, true),
      coalesce(p_row->>'note', '')
    )
    returning id into v_id;
  else
    update public.invoice_product_name_maps
    set
      mall_name = coalesce(p_row->>'mall_name', ''),
      normalized_mall_name = coalesce(p_row->>'normalized_mall_name', ''),
      product_name = btrim(p_row->>'product_name'),
      normalized_product_name = coalesce(p_row->>'normalized_product_name', ''),
      item_name_context = coalesce(p_row->>'item_name_context', ''),
      normalized_item_name_context = coalesce(p_row->>'normalized_item_name_context', ''),
      own_product_code = coalesce(p_row->>'own_product_code', ''),
      normalized_own_product_code = coalesce(p_row->>'normalized_own_product_code', ''),
      lookup_key = v_lookup,
      normalized_lookup_key = v_norm_lookup,
      style_id = (p_row->>'style_id')::uuid,
      is_active = coalesce((p_row->>'is_active')::boolean, true),
      note = coalesce(p_row->>'note', '')
    where id = v_id
      and brand_id = p_brand_id;
  end if;

  v_keys := array_remove(
    array[
      nullif(v_norm_lookup, ''),
      nullif(v_old_norm, ''),
      nullif(app.normalize_invoice_lookup_key(v_lookup), ''),
      nullif(app.normalize_invoice_lookup_key(p_row->>'product_name'), '')
    ],
    null
  );

  v_source := nullif(btrim(coalesce(p_feedback->>'source', '')), '');
  if v_source is not null then
    perform public.record_ai_recommendation_feedback(
      p_brand_id,
      case when v_lookup <> '' then v_lookup else btrim(p_row->>'product_name') end,
      (p_row->>'style_id')::uuid,
      v_source,
      nullif(p_feedback->>'cache_id', '')::uuid,
      nullif(p_feedback->>'shown_rank', '')::integer,
      nullif(p_feedback->>'provider', ''),
      nullif(p_feedback->>'model_id', '')
    );
    if v_old_norm <> '' and v_old_norm is distinct from v_norm_lookup then
      perform app.invalidate_ai_recommendation_cache(p_brand_id, array[v_old_norm]);
    end if;
  else
    perform app.invalidate_ai_recommendation_cache(p_brand_id, v_keys);
  end if;

  return v_id;
end;
$$;
