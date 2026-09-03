-- 잘못 만든 출고 단위는 연결된 이력이 없을 때만 지운다.
-- 별칭·표시 설정처럼 업체 자체 부속은 CASCADE로 함께 지운다.

create or replace function public.outbound_partner_unit_link_labels(p_id uuid)
returns text[]
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_brand_id uuid;
  v_labels text[] := '{}';
begin
  select brand_id
    into v_brand_id
    from public.code_usage_targets
   where id = p_id;

  if v_brand_id is null then
    raise exception '출고업체를 찾을 수 없습니다.';
  end if;

  if not app.can_read_brand(v_brand_id) then
    raise exception '이 브랜드를 볼 권한이 없습니다.';
  end if;

  if exists (
    select 1
      from public.code_usage_assignments
     where usage_target_id = p_id
  ) then
    v_labels := v_labels || '바코드 연결';
  end if;

  if exists (
    select 1
      from public.product_codes
     where usage_target_id = p_id
  ) then
    v_labels := v_labels || '거래처 바코드';
  end if;

  if exists (
    select 1
      from public.outbound_shipments
     where usage_target_id = p_id
  ) then
    v_labels := v_labels || '출고 이력';
  end if;

  if exists (
    select 1
      from public.invoice_work_site_summaries
     where usage_target_id = p_id
  ) then
    v_labels := v_labels || '송장 작업 이력';
  end if;

  if exists (
    select 1
      from public.bulk_outbound_jobs
     where usage_target_id = p_id
  ) then
    v_labels := v_labels || '바코드 출고 작업';
  end if;

  if exists (
    select 1
      from public.bulk_outbound_partner_configs
     where usage_target_id = p_id
  ) then
    v_labels := v_labels || '바코드 출고 등록';
  end if;

  if exists (
    select 1
      from public.partner_barcode_fields
     where usage_target_id = p_id
  ) then
    v_labels := v_labels || '거래처 바코드 항목';
  end if;

  return v_labels;
end;
$$;

comment on function public.outbound_partner_unit_link_labels(uuid) is
  '출고 단위를 막으면 안 되는 연결 이름. 비어 있으면 삭제할 수 있다.';

revoke all on function public.outbound_partner_unit_link_labels(uuid) from public;
grant execute on function public.outbound_partner_unit_link_labels(uuid) to authenticated;

create or replace function public.delete_outbound_partner_unit(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_brand_id uuid;
  v_group_id uuid;
  v_labels text[];
  v_remaining_count integer;
  v_remaining_id uuid;
begin
  select brand_id, group_id
    into v_brand_id, v_group_id
    from public.code_usage_targets
   where id = p_id;

  if v_brand_id is null then
    raise exception '출고업체를 찾을 수 없습니다.';
  end if;

  if not app.can_edit_brand(v_brand_id) then
    raise exception '이 브랜드를 수정할 권한이 없습니다.';
  end if;

  v_labels := public.outbound_partner_unit_link_labels(p_id);
  if cardinality(v_labels) > 0 then
    raise exception '%이(가) 있어 삭제할 수 없습니다. 비활성화하세요.',
      array_to_string(v_labels, ', ');
  end if;

  if v_group_id is not null then
    select count(*), min(id)
      into v_remaining_count, v_remaining_id
      from public.code_usage_targets
     where brand_id = v_brand_id
       and group_id = v_group_id
       and id <> p_id
       and active;
  else
    v_remaining_count := 0;
    v_remaining_id := null;
  end if;

  delete from public.code_usage_targets
   where id = p_id
     and brand_id = v_brand_id;

  if v_group_id is null then
    return;
  end if;

  if not exists (
    select 1
      from public.code_usage_targets
     where brand_id = v_brand_id
       and group_id = v_group_id
  ) then
    delete from public.outbound_partner_groups
     where id = v_group_id
       and brand_id = v_brand_id;
    return;
  end if;

  if v_remaining_count = 1 and v_remaining_id is not null then
    update public.code_usage_targets
       set site_name = '',
           normalized_site_name = ''
     where id = v_remaining_id
       and brand_id = v_brand_id;
  end if;
end;
$$;

comment on function public.delete_outbound_partner_unit(uuid) is
  '바코드·출고·송장 연결이 없는 출고 단위만 삭제한다. 마지막 단위면 빈 업체 그룹도 지운다.';

revoke all on function public.delete_outbound_partner_unit(uuid) from public;
grant execute on function public.delete_outbound_partner_unit(uuid) to authenticated;
