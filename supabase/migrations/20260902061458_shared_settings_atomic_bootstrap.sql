-- localStorage의 기존 값을 공용 설정이 없을 때만 최초 1회 저장한다.
-- 범위별 advisory transaction lock으로 동시 최초 접속의 덮어쓰기를 막는다.

create or replace function public.initialize_bulk_outbound_template_fields(
  p_brand_id uuid,
  p_usage_target_id uuid,
  p_barcode_source text,
  p_fields jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if not app.can_edit_brand(p_brand_id) then
    raise exception '브랜드 편집 권한이 없습니다.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_brand_id::text || ':bulk-template:' ||
      p_usage_target_id::text || ':' || coalesce(p_barcode_source, ''),
      0
    )
  );

  if exists (
    select 1
    from public.bulk_outbound_template_fields
    where brand_id = p_brand_id
      and usage_target_id = p_usage_target_id
      and barcode_source = p_barcode_source
  ) then
    return false;
  end if;

  perform public.replace_bulk_outbound_template_fields(
    p_brand_id,
    p_usage_target_id,
    p_barcode_source,
    p_fields
  );
  return true;
end;
$function$;

revoke all on function public.initialize_bulk_outbound_template_fields(
  uuid,
  uuid,
  text,
  jsonb
) from public, anon;
grant execute on function public.initialize_bulk_outbound_template_fields(
  uuid,
  uuid,
  text,
  jsonb
) to authenticated;

create or replace function public.initialize_barcode_partner_display_targets(
  p_brand_id uuid,
  p_display_scope text,
  p_usage_target_ids uuid[]
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if not app.can_edit_brand(p_brand_id) then
    raise exception '브랜드 편집 권한이 없습니다.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_brand_id::text || ':barcode-display:' ||
      coalesce(p_display_scope, ''),
      0
    )
  );

  if exists (
    select 1
    from public.barcode_partner_display_settings
    where brand_id = p_brand_id
      and display_scope = p_display_scope
  ) then
    return false;
  end if;

  perform public.replace_barcode_partner_display_targets(
    p_brand_id,
    p_display_scope,
    p_usage_target_ids
  );
  return true;
end;
$function$;

revoke all on function public.initialize_barcode_partner_display_targets(
  uuid,
  text,
  uuid[]
) from public, anon;
grant execute on function public.initialize_barcode_partner_display_targets(
  uuid,
  text,
  uuid[]
) to authenticated;
