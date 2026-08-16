-- 품목명 원장 저장을 안전하게 되돌린다.
-- 저장 직후 다른 수정이 있으면면 updated_at 불일치로 거절한다.

create or replace function public.undo_invoice_product_name_map(
  p_brand_id uuid,
  p_map_id uuid,
  p_expected_updated_at timestamptz,
  p_previous jsonb default null
)
returns text
language plpgsql
security invoker
set search_path = public, app
as $$
declare
  v_current public.invoice_product_name_maps%rowtype;
  v_norm_lookup text := '';
  v_old_norm text := '';
  v_keys text[];
begin
  if not app.can_edit_brand(p_brand_id) then
    raise exception '이 브랜드의 품목명 기준을 되돌릴 권한이 없습니다.';
  end if;

  select *
  into v_current
  from public.invoice_product_name_maps m
  where m.id = p_map_id
    and m.brand_id = p_brand_id
  for update;

  if not found then
    raise exception '되돌릴 품목명 기준을 찾지 못했습니다.';
  end if;

  if v_current.updated_at is distinct from p_expected_updated_at then
    raise exception '다른 곳에서 이미 바뀐 항목이라 되돌릴 수 없습니다.';
  end if;

  v_old_norm := coalesce(v_current.normalized_lookup_key, '');

  if p_previous is null then
    delete from public.invoice_product_name_maps
    where id = p_map_id
      and brand_id = p_brand_id
      and updated_at is not distinct from p_expected_updated_at;

    if not found then
      raise exception '다른 곳에서 이미 바뀐 항목이라 되돌릴 수 없습니다.';
    end if;

    perform app.invalidate_ai_recommendation_cache(
      p_brand_id,
      array_remove(array[nullif(v_old_norm, '')], null)
    );
    return 'deleted';
  end if;

  if coalesce(btrim(p_previous->>'product_name'), '') = ''
     or (p_previous->>'style_id') is null then
    raise exception '복원할 원장 스냅샷이 올바르지 않습니다.';
  end if;

  v_norm_lookup := coalesce(btrim(p_previous->>'normalized_lookup_key'), '');

  update public.invoice_product_name_maps
  set
    mall_name = coalesce(p_previous->>'mall_name', ''),
    normalized_mall_name = coalesce(p_previous->>'normalized_mall_name', ''),
    product_name = btrim(coalesce(p_previous->>'product_name', '')),
    normalized_product_name = coalesce(p_previous->>'normalized_product_name', ''),
    item_name_context = coalesce(p_previous->>'item_name_context', ''),
    normalized_item_name_context = coalesce(
      p_previous->>'normalized_item_name_context',
      ''
    ),
    own_product_code = coalesce(p_previous->>'own_product_code', ''),
    normalized_own_product_code = coalesce(
      p_previous->>'normalized_own_product_code',
      ''
    ),
    lookup_key = coalesce(p_previous->>'lookup_key', ''),
    normalized_lookup_key = v_norm_lookup,
    style_id = (p_previous->>'style_id')::uuid,
    is_active = coalesce((p_previous->>'is_active')::boolean, true),
    note = coalesce(p_previous->>'note', '')
  where id = p_map_id
    and brand_id = p_brand_id
    and updated_at is not distinct from p_expected_updated_at;

  if not found then
    raise exception '다른 곳에서 이미 바뀐 항목이라 되돌릴 수 없습니다.';
  end if;

  v_keys := array_remove(
    array[
      nullif(v_norm_lookup, ''),
      nullif(v_old_norm, '')
    ],
    null
  );
  perform app.invalidate_ai_recommendation_cache(p_brand_id, v_keys);
  return 'restored';
end;
$$;

comment on function public.undo_invoice_product_name_map(uuid, uuid, timestamptz, jsonb) is
  '품목명 원장 저장을 이전 스냅샷으로 복원하거나 신규 행을 삭제한다. updated_at이 같아야 한다.';

revoke all on function public.undo_invoice_product_name_map(uuid, uuid, timestamptz, jsonb)
  from public;
grant execute on function public.undo_invoice_product_name_map(uuid, uuid, timestamptz, jsonb)
  to authenticated;
