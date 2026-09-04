-- 송장 출고반영: 같은 파일 지문의 invoice 원장을 주문일·업체·SKU별로 원자 교체한다.
-- 재고 RPC는 호출하지 않는다.

create or replace function public.replace_invoice_outbound_shipments(
  p_brand_id uuid,
  p_source_ref text,
  p_note text,
  p_entries jsonb
)
returns integer
language plpgsql
security invoker
set search_path to 'public'
as $function$
declare
  item jsonb;
  v_style_id uuid;
  v_target_id uuid;
  v_shipped_on date;
  v_qty integer;
  v_count integer := 0;
  v_source_ref text;
  v_key text;
  v_seen text[] := array[]::text[];
begin
  if not app.can_edit_brand(p_brand_id) then
    raise exception '브랜드 편집 권한이 없습니다.';
  end if;
  v_source_ref := btrim(coalesce(p_source_ref, ''));
  if v_source_ref = '' then
    raise exception '출고 출처가 올바르지 않습니다.';
  end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception '출고 행 형식이 올바르지 않습니다.';
  end if;
  if jsonb_array_length(p_entries) = 0 then
    raise exception '반영할 출고 행이 없습니다.';
  end if;

  for item in select value from jsonb_array_elements(p_entries)
  loop
    begin
      v_style_id := (item->>'styleId')::uuid;
    exception
      when invalid_text_representation then
        raise exception '상품 정보가 올바르지 않습니다.';
    end;
    begin
      v_target_id := (item->>'usageTargetId')::uuid;
    exception
      when invalid_text_representation then
        raise exception '출고업체 정보가 올바르지 않습니다.';
    end;
    begin
      v_shipped_on := (item->>'shippedOn')::date;
    exception
      when invalid_datetime_format then
        raise exception '주문일을 확인하세요.';
      when datetime_field_overflow then
        raise exception '주문일을 확인하세요.';
    end;
    v_qty := coalesce((item->>'quantity')::int, 0);
    if v_style_id is null then
      raise exception '상품 정보가 올바르지 않습니다.';
    end if;
    if v_target_id is null then
      raise exception '출고업체 정보가 올바르지 않습니다.';
    end if;
    if v_shipped_on is null then
      raise exception '주문일을 확인하세요.';
    end if;
    if v_qty <= 0 then
      raise exception '출고 수량은 1 이상이어야 합니다.';
    end if;
    if not exists (
      select 1
      from public.styles
      where id = v_style_id and brand_id = p_brand_id
    ) then
      raise exception '같은 브랜드의 상품만 반영할 수 있습니다.';
    end if;
    if not exists (
      select 1
      from public.code_usage_targets
      where id = v_target_id and brand_id = p_brand_id
    ) then
      raise exception '같은 브랜드의 출고업체만 반영할 수 있습니다.';
    end if;

    v_key := v_style_id::text || '|' || v_target_id::text || '|' || v_shipped_on::text;
    if v_key = any (v_seen) then
      raise exception '같은 상품·업체·주문일이 두 번 들어 있습니다.';
    end if;
    v_seen := array_append(v_seen, v_key);
  end loop;

  perform 1
    from public.outbound_shipments
   where brand_id = p_brand_id
     and source = 'invoice'
     and source_ref = v_source_ref
   for update;

  delete from public.outbound_shipments
  where brand_id = p_brand_id
    and source = 'invoice'
    and source_ref = v_source_ref;

  for item in
    select value
      from jsonb_array_elements(p_entries)
     order by value->>'shippedOn', value->>'usageTargetId', value->>'styleId'
  loop
    insert into public.outbound_shipments (
      brand_id, style_id, usage_target_id, shipped_on, quantity,
      source, source_ref, note
    ) values (
      p_brand_id,
      (item->>'styleId')::uuid,
      (item->>'usageTargetId')::uuid,
      (item->>'shippedOn')::date,
      (item->>'quantity')::int,
      'invoice',
      v_source_ref,
      coalesce(p_note, '')
    )
    on conflict (
      brand_id, source, source_ref, style_id, usage_target_id, shipped_on
    )
    do update set
      quantity = excluded.quantity,
      note = excluded.note,
      updated_at = now();

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

revoke all on function public.replace_invoice_outbound_shipments(
  uuid, text, text, jsonb
) from public;
grant execute on function public.replace_invoice_outbound_shipments(
  uuid, text, text, jsonb
) to authenticated;

comment on function public.replace_invoice_outbound_shipments(
  uuid, text, text, jsonb
) is
  '송장 출고반영분을 파일 지문 기준으로 주문일·업체·SKU별 교체한다. 재고는 건드리지 않는다.';

comment on column public.outbound_shipments.source_ref is
  'bulk면 job id 또는 barcode-data-entry:*. invoice면 비개인정보 파일 SHA-256 지문.';
