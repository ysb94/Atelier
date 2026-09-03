-- 바코드 출고 데이터입력: 업체 그룹 1건을 여러 지점 원장으로 원자 교체한다.
-- 재고 RPC는 호출하지 않는다.

create or replace function public.replace_barcode_data_entry_shipments(
  p_brand_id uuid,
  p_source_ref text,
  p_shipped_on date,
  p_note text,
  p_usage_target_ids uuid[],
  p_entries jsonb
)
returns integer
language plpgsql
security definer
set search_path to 'public', 'app'
as $function$
declare
  item jsonb;
  v_style_id uuid;
  v_target_id uuid;
  v_qty integer;
  v_count integer := 0;
  v_shipped_on date;
begin
  if not app.can_edit_brand(p_brand_id) then
    raise exception '브랜드 편집 권한이 없습니다.';
  end if;
  if p_source_ref is null or btrim(p_source_ref) = '' then
    raise exception '출고 출처가 올바르지 않습니다.';
  end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception '출고 행 형식이 올바르지 않습니다.';
  end if;

  v_shipped_on := coalesce(p_shipped_on, (timezone('Asia/Seoul', now()))::date);

  delete from public.outbound_shipments
  where brand_id = p_brand_id
    and source = 'bulk'
    and shipped_on = v_shipped_on
    and (
      source_ref = p_source_ref
      or (
        source_ref like 'barcode-data-entry:%'
        and usage_target_id = any(coalesce(p_usage_target_ids, array[]::uuid[]))
      )
    );

  for item in select * from jsonb_array_elements(p_entries)
  loop
    begin
      v_style_id := (item->>'styleId')::uuid;
    exception
      when invalid_text_representation then
        v_style_id := null;
    end;
    begin
      v_target_id := (item->>'usageTargetId')::uuid;
    exception
      when invalid_text_representation then
        v_target_id := null;
    end;
    v_qty := coalesce((item->>'quantity')::int, 0);
    if v_style_id is null or v_target_id is null or v_qty <= 0 then
      continue;
    end if;
    if not exists (
      select 1
      from public.styles
      where id = v_style_id and brand_id = p_brand_id
    ) then
      continue;
    end if;
    if not exists (
      select 1
      from public.code_usage_targets
      where id = v_target_id and brand_id = p_brand_id
    ) then
      continue;
    end if;

    insert into public.outbound_shipments (
      brand_id, style_id, usage_target_id, shipped_on, quantity,
      source, source_ref, note
    ) values (
      p_brand_id,
      v_style_id,
      v_target_id,
      v_shipped_on,
      v_qty,
      'bulk',
      p_source_ref,
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

revoke all on function public.replace_barcode_data_entry_shipments(
  uuid, text, date, text, uuid[], jsonb
) from public;
grant execute on function public.replace_barcode_data_entry_shipments(
  uuid, text, date, text, uuid[], jsonb
) to authenticated;

comment on function public.replace_barcode_data_entry_shipments(
  uuid, text, date, text, uuid[], jsonb
) is
  '바코드 출고 데이터입력 반영분을 업체 그룹·출고일 기준으로 지점별 교체한다. 재고는 건드리지 않는다.';
