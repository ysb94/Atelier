-- 브라우저가 결정한 품목명 대체 배정을 한 트랜잭션에서 검증·확정한다.
-- 기존 assign_invoice_gift_source_rows는 호환용으로 남긴다.
-- 수령인 키/PII는 저장하지 않는다.

create or replace function public.confirm_invoice_gift_source_allocations(
  p_brand_id uuid,
  p_candidates jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_candidate jsonb;
  v_map_ids uuid[] := array[]::uuid[];
  v_map_id uuid;
  v_style_id uuid;
  v_key text;
  v_fingerprint text;
  v_slot integer;
  v_mall text;
  v_order_no text;
  v_ordered_at timestamp;
  v_file text;
  v_existing uuid;
  v_in_pool boolean;
  v_result jsonb := '[]'::jsonb;
begin
  if p_brand_id is null then
    raise exception 'brand_id가 필요합니다.';
  end if;
  if not app.can_edit_brand(p_brand_id) then
    raise exception '이 브랜드의 사은품 원본행을 확정할 권한이 없습니다.';
  end if;
  if p_candidates is null or jsonb_typeof(p_candidates) <> 'array' then
    raise exception '배정 확정 목록이 필요합니다.';
  end if;

  for v_candidate in
    select value from jsonb_array_elements(p_candidates)
  loop
    v_map_id := (v_candidate->>'map_id')::uuid;
    if v_map_id is not null and not (v_map_id = any (v_map_ids)) then
      v_map_ids := array_append(v_map_ids, v_map_id);
    end if;
  end loop;

  perform 1
  from public.invoice_gift_source_maps m
  where m.brand_id = p_brand_id
    and m.id = any (v_map_ids)
  order by m.id
  for update;

  for v_candidate in
    select value
    from jsonb_array_elements(p_candidates)
    order by value->>'allocation_key'
  loop
    v_map_id := (v_candidate->>'map_id')::uuid;
    v_style_id := (v_candidate->>'style_id')::uuid;
    v_key := btrim(coalesce(v_candidate->>'allocation_key', ''));
    v_fingerprint := btrim(coalesce(v_candidate->>'order_fingerprint', ''));
    v_slot := coalesce((v_candidate->>'quantity_slot')::integer, 1);
    v_mall := coalesce(v_candidate->>'mall_name', '');
    v_order_no := coalesce(v_candidate->>'customer_order_no', '');
    v_ordered_at := nullif(v_candidate->>'ordered_at', '')::timestamp;
    v_file := coalesce(v_candidate->>'source_file_name', '');

    if v_map_id is null or v_style_id is null or v_key = '' or v_fingerprint = '' then
      raise exception 'map_id, style_id, allocation_key, order_fingerprint가 필요합니다.';
    end if;

    if not exists (
      select 1
      from public.invoice_gift_source_maps m
      where m.brand_id = p_brand_id
        and m.id = v_map_id
        and m.is_active
    ) then
      raise exception '활성 사은품 원본행 매핑을 찾지 못했습니다.';
    end if;

    select a.style_id
    into v_existing
    from public.invoice_gift_source_allocations a
    where a.brand_id = p_brand_id
      and a.allocation_key = v_key
    limit 1;

    if v_existing is not null then
      v_result := v_result || jsonb_build_array(jsonb_build_object(
        'allocation_key', v_key,
        'style_id', v_existing,
        'reused', true
      ));
      continue;
    end if;

    select exists (
      select 1
      from public.invoice_gift_source_map_products p
      where p.brand_id = p_brand_id
        and p.map_id = v_map_id
        and p.style_id = v_style_id
    )
    into v_in_pool;
    if not v_in_pool then
      raise exception '후보 풀에 없는 M번호는 확정할 수 없습니다.';
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
      v_map_id,
      v_style_id,
      v_key,
      v_fingerprint,
      v_slot,
      v_mall,
      v_order_no,
      v_ordered_at,
      v_file
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

comment on function public.confirm_invoice_gift_source_allocations(uuid, jsonb) is
  '브라우저가 고른 map_id+allocation_key+style_id를 검증한 뒤 확정한다. 기존 키는 재사용하고 수령인 PII는 저장하지 않는다.';

revoke all on function public.confirm_invoice_gift_source_allocations(uuid, jsonb)
  from public, anon;
grant execute on function public.confirm_invoice_gift_source_allocations(uuid, jsonb)
  to authenticated;
